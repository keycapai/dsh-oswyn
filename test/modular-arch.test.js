import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compressOutputOnly,
  discardInputAndOutput,
  inspectToolCall,
  isCallArgDiscarded
} from '../lib/core/primitives.js';
import {
  applyActiveTruncate,
  applyActiveReplace,
  applyActiveDiscardTargets
} from '../lib/modes/index.js';
import {
  applyFromAssistantMessage,
  resolveSessionPreset
} from '../lib/presets/index.js';
import {
  buildStandardProtocolPrompt,
  buildPtcProtocolPrompt,
  collectNudgeCandidates,
  buildNudgePromptText
} from '../lib/prompts/index.js';
import {
  assembleClientSource,
  CLIENT_MODULE_ORDER
} from '../lib/client/build.js';
import { MockSession } from './fixtures/mock-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeSessionWithCall({ callId = 'c_mod_1', toolName = 'bash', argsObj = { cmd: 'ls' }, outputText = 'out', isError = false } = {}) {
  const session = new MockSession();
  session.id = 'test_mod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const argsStr = typeof argsObj === 'string' ? argsObj : JSON.stringify(argsObj);
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'run' }] }, { surfaceOp: 'append' });
  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Calling tool' },
        { type: 'tool-call', id: callId, callId, name: toolName, arguments: argsStr }
      ]
    }
  }, { surfaceOp: 'append' });
  session.seed('tool/call', { callId, name: toolName, arguments: argsStr }, {});
  const resEv = session.seed('tool/result', {
    message: {
      role: 'tool',
      source: { toolName, callId },
      toolCallId: callId,
      isError,
      content: [{ type: 'text', text: outputText }]
    }
  }, { surfaceOp: 'append' });
  return { session, resEv, argsStr };
}

test('Modular Architecture: client/build.js assembles the 5 client sub-modules byte-for-byte into lib/client.js', () => {
  assert.equal(CLIENT_MODULE_ORDER.length, 5);
  for (const file of CLIENT_MODULE_ORDER) {
    const p = path.join(__dirname, '..', 'lib', 'client', file);
    assert.ok(fs.existsSync(p), `client module ${file} exists`);
  }
  const assembled = assembleClientSource();
  const diskBundle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  assert.equal(assembled, diskBundle, 'assembled client modules match lib/client.js byte-for-byte');
});

test('Boundary Distinction: Compress (truncate / replace) replaces OUTPUT ONLY and preserves input arguments intact', () => {
  const bigInput = { command: 'python3 -c "' + 'A'.repeat(1200) + '"' };
  const bigOutput = Array.from({ length: 50 }, (_, i) => `LINE_${i}_${'B'.repeat(40)}`).join('\n');

  // 1) Truncate: only replaces output; before == outputChars, inputChars == 0, call args NOT discarded
  const s1 = makeSessionWithCall({ callId: 'c_trunc_only', toolName: 'bash', argsObj: bigInput, outputText: bigOutput });
  const truncRes = applyActiveTruncate(
    s1.session,
    { seq: s1.resEv.seq, event: s1.resEv },
    { explicitMode: 'truncate', mode: 'truncate', keepCount: 5, keepUnit: 'lines', summary: '- kept 5 lines' }
  );
  assert.equal(truncRes.ok, true);
  assert.equal(truncRes.appliedEntry.mode, 'truncate');
  assert.equal(truncRes.appliedEntry.before, bigOutput.length, 'truncate before equals outputChars only');
  assert.equal(truncRes.appliedEntry.inputChars, 0, 'truncate does not claim discarded inputChars');
  assert.equal(isCallArgDiscarded(s1.session, 'c_trunc_only'), false, 'truncate keeps tool-call input arguments intact');

  // 2) Replace: only replaces output; before == outputChars, inputChars == 0, call args NOT discarded
  const s2 = makeSessionWithCall({ callId: 'c_rep_only', toolName: 'read', argsObj: bigInput, outputText: bigOutput });
  const repRes = applyActiveReplace(
    s2.session,
    { seq: s2.resEv.seq, event: s2.resEv },
    { explicitMode: 'replace', mode: 'replace', summary: '- Read and verified module logic' }
  );
  assert.equal(repRes.ok, true);
  assert.equal(repRes.appliedEntry.mode, 'replace');
  assert.equal(repRes.appliedEntry.before, bigOutput.length, 'replace before equals outputChars only');
  assert.equal(repRes.appliedEntry.inputChars, 0, 'replace does not claim discarded inputChars');
  assert.equal(isCallArgDiscarded(s2.session, 'c_rep_only'), false, 'replace keeps tool-call input arguments intact');
});

test('Boundary Distinction: Discard replaces BOTH input and output (succeeds on large-input + short-output where replace is rejected)', () => {
  const hugeScriptArgs = { description: 'One-off probe', code: 'const x = "' + 'Z'.repeat(1500) + '";' };
  const shortOutput = 'Probe finished: status=ok (42ms)'; // only 32 chars!

  // Attempting `replace` (output-only) on a 32-char output with a 60-char summary is rejected because replace only replaces output
  const sReplace = makeSessionWithCall({ callId: 'c_short_rep', toolName: 'bash', argsObj: hugeScriptArgs, outputText: shortOutput });
  const repAttempt = compressOutputOnly(
    sReplace.session,
    { seq: sReplace.resEv.seq, event: sReplace.resEv },
    { mode: 'replace', seq: sReplace.resEv.seq, summary: '- Long summary that exceeds the 32-char output length and thus cannot shrink output' }
  );
  assert.equal(repAttempt.ok, false, 'replace must be rejected when output alone is shorter than the rewrite');
  assert.match(repAttempt.rejectedReason, /not worth it/);
  assert.equal(isCallArgDiscarded(sReplace.session, 'c_short_rep'), false);

  // Executing `discard` (input + output) on the exact same call succeeds and reclaims the 1500+ char input!
  const sDiscard = makeSessionWithCall({ callId: 'c_short_disc', toolName: 'bash', argsObj: hugeScriptArgs, outputText: shortOutput });
  const discAttempt = discardInputAndOutput(
    sDiscard.session,
    { seq: sDiscard.resEv.seq, event: sDiscard.resEv },
    { fact: '- Probe completed, script and output discarded' }
  );
  assert.equal(discAttempt.ok, true, 'discard succeeds because before = inputChars + outputChars');
  assert.equal(discAttempt.appliedEntry.inputChars, sDiscard.argsStr.length);
  assert.equal(discAttempt.appliedEntry.before, shortOutput.length + sDiscard.argsStr.length);
  assert.ok(discAttempt.appliedEntry.after < discAttempt.appliedEntry.before);
  assert.equal(isCallArgDiscarded(sDiscard.session, 'c_short_disc'), true, 'discard marks tool-call input arguments to be cleared to "{}"');
});

test('Prompts & Smart Nudge: explicitly contrast Discard (replaces input+output) vs Compress (replaces output only) and isolate presets', () => {
  const stdPrompt = buildStandardProtocolPrompt();
  const ptcPrompt = buildPtcProtocolPrompt();

  // Standard prompt has no PTC noise, PTC prompt has PTC MODE
  assert.ok(!stdPrompt.includes('PTC MODE'), 'standard prompt excludes PTC MODE');
  assert.ok(ptcPrompt.includes('PTC MODE'), 'PTC prompt includes PTC MODE');

  // Both prompts explicitly explain the Discard (input+output) vs Compress (output-only) boundary and 3-step decision tree
  for (const p of [stdPrompt, ptcPrompt]) {
    assert.match(p, /Discard \(Replaces Input \+ Output\) vs\. Compress \(Replaces Output Only\)/);
    assert.match(p, /同时替换输入 \+ 输出/);
    assert.match(p, /只替换输出，保留输入/);
    assert.match(p, /Proactive 3-Step Decision Tree/);
  }

  // Smart Nudge inspects both inputChars and outputChars and explains Discard vs Compress
  const outgoing = [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'c_nudge_1', name: 'bash', arguments: JSON.stringify({ command: 'echo ' + 'X'.repeat(500) }) }]
    },
    {
      role: 'tool',
      toolCallId: 'c_nudge_1',
      source: { toolName: 'bash', callId: 'c_nudge_1' },
      content: [{ type: 'text', text: 'output line\n'.repeat(30) }]
    }
  ];
  const candidates = collectNudgeCandidates(outgoing, { nudgeThresholdChars: 100, nudgeThresholdLines: 10 });
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].inputChars > 500, 'nudge candidate measures tool-call inputChars');
  const nudgeText = buildNudgePromptText(candidates);
  assert.match(nudgeText, /调用入参约 \d+ 字符/);
  assert.match(nudgeText, /同时替换输入 \+ 输出/);
  assert.match(nudgeText, /只替换输出，保留输入/);
});
