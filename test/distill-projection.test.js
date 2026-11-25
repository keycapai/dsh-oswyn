/**
 * dsh-oswyn — deep distillation as a message projection.
 *
 * These lock the contract that makes the feature real: a distill decision must
 * change MESSAGE CONTENT only (same node, same identity), leave the current turn
 * byte-identical, and be idempotent so re-deriving a session is stable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OSWYN_DISTILL_EVENT,
  oswynDistillProjection,
  buildDistillReplacements,
  distillAssistantMessage,
  distillToolMessage
} from '../lib/core/distill-projection.js';

const pairs = () => ([
  { seq: 0, type: 'system/message', message: { role: 'system', content: 'sys' } },
  { seq: 1, type: 'user/message', message: { role: 'user', content: 'first question' } },
  { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: '<think>secret</think>visible answer' }], tool_calls: [{ id: 'c1' }] } },
  { seq: 3, type: 'tool/result', message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(5000) }] } },
  { seq: 4, type: 'user/message', message: { role: 'user', content: 'current question' } },
  { seq: 5, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: '<think>live</think>current answer' }] } },
]);

test('distill [1]: historical assistant messages lose reasoning but keep tool pairing', () => {
  const out = distillAssistantMessage({
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'long private reasoning' },
      { type: 'text', text: '<think>hidden</think>answer' },
      { type: 'tool-call', id: 'x' },
    ],
    tool_calls: [{ id: 'x' }],
  });
  assert.ok(out, 'must change');
  // Reasoning is the token hog and is safe to drop.
  assert.equal(out.content.some((b) => b.type === 'reasoning'), false);
  assert.deepEqual(out.content[0], { type: 'text', text: 'answer' });
  // Tool calls MUST survive: the kernel projection cannot drop the paired
  // tool/result nodes, so removing the call would orphan them.
  assert.ok(Array.isArray(out.tool_calls) && out.tool_calls.length === 1);
  assert.ok(out.content.some((b) => b.type === 'tool-call'));
});

test('distill [2]: historical tool results collapse to a short placeholder', () => {
  const out = distillToolMessage({ role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'y'.repeat(4000) }] });
  assert.ok(out);
  assert.equal(out.toolCallId, 'c1', 'pairing fields must survive');
  assert.match(out.content[0].text, /已蒸馏省略/);
  assert.ok(out.content[0].text.length < 80);
});

test('distill [3]: the current turn is never touched', () => {
  const repl = buildDistillReplacements(pairs());
  const seqs = repl.map((r) => r.seq);
  assert.deepEqual(seqs, [2, 3], 'only historical assistant + tool nodes change');
  assert.equal(seqs.includes(4), false, 'current user prompt untouched');
  assert.equal(seqs.includes(5), false, 'current assistant answer untouched');
});

test('distill [4]: distillation is idempotent', () => {
  const repl = buildDistillReplacements(pairs());
  // Feed the replaced content back in: a second pass must produce no further change.
  const again = buildDistillReplacements(pairs().map((p) => {
    const hit = repl.find((r) => r.seq === p.seq);
    return hit ? { ...p, message: hit.message } : p;
  }));
  assert.deepEqual(again, [], 're-distilling an already distilled surface must be a no-op');
});

test('distill [5]: the projection rejects a seq that is not on the surface', () => {
  assert.throws(() => oswynDistillProjection.project(
    { type: OSWYN_DISTILL_EVENT, data: { replacements: [{ seq: 99, message: { role: 'assistant', content: 'x' } }] } },
    { nodes: [0, 1], events: [], baseSeq: 0, messages: new Map() }
  ), /not a current surface node/);
});

test('distill [6]: the projection returns the replacement map keyed by seq', () => {
  const message = { role: 'assistant', content: [{ type: 'text', text: 'compact' }] };
  const map = oswynDistillProjection.project(
    { type: OSWYN_DISTILL_EVENT, data: { replacements: [{ seq: 2, message }] } },
    { nodes: [0, 1, 2], events: [], baseSeq: 0, messages: new Map() }
  );
  assert.equal(map.size, 1);
  assert.deepEqual(map.get(2), message);
});

test('distill [7]: windowed replay (baseSeq > 0) skips pre-window seqs without throwing', () => {
  const message = { role: 'assistant', content: [{ type: 'text', text: 'compact' }] };
  const map = oswynDistillProjection.project(
    {
      type: OSWYN_DISTILL_EVENT,
      data: {
        replacements: [
          { seq: 2, message },
          { seq: 12, message }
        ]
      }
    },
    { nodes: [10, 11, 12], events: [], baseSeq: 10, messages: new Map() }
  );
  assert.equal(map.size, 1);
  assert.deepEqual(map.get(12), message);
});

test('distill [8]: tiny tool results are not inflated by the placeholder', () => {
  const out = distillToolMessage({ role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] });
  assert.equal(out, null);
});

test('distill [9]: ignorable oswyn/distill folds cleanly both with and without the projection registered', async () => {
  const { foldSurface, deriveEventMessage } = await import('./fixtures/kernel-surface.js');
  const events = [
    { seq: 0, type: 'system/message', surfaceOp: 'append', data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
    { seq: 1, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: 'q1' }] } },
    { seq: 2, type: 'assistant/message', surfaceOp: 'append', data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'long thought' }, { type: 'text', text: 'a1' }] } } },
    { seq: 3, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: 'q2' }] } },
    {
      seq: 4,
      type: OSWYN_DISTILL_EVENT,
      ignorable: true,
      data: {
        replacements: [
          { seq: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'a1' }] } }
        ]
      }
    }
  ];

  // With projection registered: seq 2 derives to the distilled message.
  const withProj = foldSurface(events, [oswynDistillProjection]);
  const derivedWith = deriveEventMessage(events[2], withProj.projectedMessages);
  assert.deepEqual(derivedWith.content, [{ type: 'text', text: 'a1' }]);

  // Without projection registered (e.g. plugin disabled / plain reader): ignorable event does not crash fold.
  const withoutProj = foldSurface(events, []);
  const derivedWithout = deriveEventMessage(events[2], withoutProj.projectedMessages);
  assert.equal(derivedWithout.content.length, 2, 'original message remains intact when plugin is absent');
});

test('distill [10]: historical assistant tool-call arguments (content blocks + tool_calls) are compressed safely and idempotently', () => {
  const longCode = 'const x = ' + '1+'.repeat(200) + '0;';
  const msg = {
    role: 'assistant',
    reasoning_content: 'private deep reasoning',
    content: [
      { type: 'reasoning', text: 'chain of thought' },
      { type: 'text', text: 'Running script' },
      { type: 'tool-call', callId: 'c1', name: 'run_code', arguments: JSON.stringify({ path: 'a.js', code: longCode, retries: 2 }) }
    ],
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'run_code', arguments: JSON.stringify({ path: 'a.js', code: longCode, retries: 2 }) } }
    ]
  };
  const first = distillAssistantMessage(msg);
  assert.ok(first, 'must compress reasoning and tool-call arguments');
  assert.equal('reasoning_content' in first, false, 'reasoning_content must be stripped');
  assert.equal(first.content.some((b) => b.type === 'reasoning'), false);

  const callBlock = first.content.find((b) => b.type === 'tool-call');
  assert.ok(callBlock, 'tool-call block must remain for pairing');
  const parsedBlockArgs = JSON.parse(callBlock.arguments);
  assert.equal(parsedBlockArgs.path, 'a.js', 'short key value should not be inflated');
  assert.equal(parsedBlockArgs.code, '[oswyn: 已蒸馏省略]', 'oversized arg must be distilled');
  assert.equal(parsedBlockArgs.retries, 2, 'numeric arg preserved');

  const parsedOpenAiArgs = JSON.parse(first.tool_calls[0].function.arguments);
  assert.equal(parsedOpenAiArgs.code, '[oswyn: 已蒸馏省略]', 'OpenAI tool_calls arguments must also be distilled');

  // Second pass must be idempotent (returns null).
  assert.equal(distillAssistantMessage(first), null, 'tool-call arg distillation must be idempotent');
});

test('distill [11]: history_recall works after oswyn/distill, recalls post-intra-step-compression results by default, and reinstates surface', async () => {
  const { MockSession } = await import('./fixtures/mock-session.js');
  const { registerHistoryRecallTool } = await import('../lib/tools/history-recall.js');
  const { collectSurfaceMessages } = await import('../lib/session/surface.js');

  const tools = {};
  registerHistoryRecallTool({ tools: { register: (t) => { tools[t.name] = t; } } });
  const historyRecall = tools['history_recall'];

  const session = new MockSession([oswynDistillProjection]);
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' });
  // Turn 1
  session.seed('user/message', { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Inspect logs' }] }, { surfaceOp: 'append' });
  const longCmd = 'grep -rn "CRITICAL_TOKEN" ' + '/var/log/service/'.repeat(10);
  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Step 1 private reasoning: need to inspect service logs carefully' },
        { type: 'tool-call', callId: 'call_log_1', name: 'bash', arguments: JSON.stringify({ command: longCmd }) }
      ]
    }
  }, { surfaceOp: 'append' });
  const rawOutput = 'RAW_LINE_0\n' + 'LOG_NOISE '.repeat(400) + '\nRAW_TAIL_NEEDLE=98765';
  const origToolEv = session.seed('tool/result', {
    message: {
      role: 'tool',
      source: { toolName: 'bash', callId: 'call_log_1' },
      content: [{ type: 'text', text: rawOutput }]
    }
  }, { surfaceOp: 'append' });

  // Intra-step compression replaces origToolEv on the surface with a compact summary.
  const intraCompressedText = '[oswyn-meta: before=4050 after=120 keep=0 mode=replace seq=' + origToolEv.seq + ']\n- Found CRITICAL_TOKEN in worker.log (count=3, errCode=E42)';
  session.append('tool/result', {
    message: {
      role: 'tool',
      source: { toolName: 'bash', callId: 'call_log_1' },
      content: [{ type: 'text', text: intraCompressedText }]
    }
  }, {
    surfaceOp: { op: 'replace', startSeq: origToolEv.seq, endSeq: origToolEv.seq },
    sourceEventSeqs: [origToolEv.seq]
  });

  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Step 2 reasoning: summarizing error E42' },
        { type: 'text', text: 'Found 3 occurrences of CRITICAL_TOKEN (errCode=E42).' }
      ]
    }
  }, { surfaceOp: 'append' });

  // Turn 2 opens
  session.seed('user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Recall turn 1 details' }] }, { surfaceOp: 'append' });

  // Apply v2.4 turn distillation via oswyn/distill projection
  const surfaceBefore = collectSurfaceMessages(session);
  const replacements = buildDistillReplacements(surfaceBefore);
  assert.ok(replacements.length >= 3, 'assistant messages and tool result in Turn 1 must all be distilled');
  session.append(OSWYN_DISTILL_EVENT, { replacements }, { ignorable: true });

  // Verify projected surface has distilled BOTH thinking AND tool call args AND tool result
  const distilledMsgs = session.deriveMessages();
  const distilledStep1Assistant = distilledMsgs[2];
  assert.equal(distilledStep1Assistant.content.some((b) => b.type === 'reasoning'), false, 'thinking stripped in distilled surface');
  const distilledCallBlock = distilledStep1Assistant.content.find((b) => b.type === 'tool-call');
  assert.equal(JSON.parse(distilledCallBlock.arguments).command, '[oswyn: 已蒸馏省略]', 'tool-call args distilled in surface');
  const distilledToolMsg = distilledMsgs[3];
  assert.match(distilledToolMsg.content[0].text, /历史工具输出已蒸馏省略/, 'tool result distilled in surface');

  const exec = { agent: { session } };

  // 1. Recall thinking after oswyn/distill
  const recallThink = historyRecall.execute({ round: 1, mode: 'think' }, exec);
  assert.equal(recallThink.found, true);
  assert.ok(recallThink.text.includes('Step 1 private reasoning'), 'must recall reasoning block after oswyn/distill');
  assert.ok(recallThink.text.includes('Step 2 reasoning'), 'must recall step 2 reasoning');
  assert.ok(!recallThink.text.includes('CRITICAL_TOKEN in worker.log'), 'think mode must not include tool output');
  assert.equal(session.activeRecalls.get(1), 'think', 'activeRecalls must record think mode');

  // 2. Recall tools (default original: false) -> MUST return post-intra-step-compression result!
  const recallTool = historyRecall.execute({ round: 1, mode: 'tool' }, exec);
  assert.equal(recallTool.found, true);
  assert.equal(recallTool.isOriginal, false);
  assert.ok(recallTool.text.includes('Call call_log_1: bash'), 'must recall content-embedded tool-call');
  assert.ok(recallTool.text.includes('CRITICAL_TOKEN'), 'must recall original command arg');
  assert.ok(recallTool.text.includes('[oswyn-meta:'), 'default history_recall must return intra-step compressed tool result');
  assert.ok(recallTool.text.includes('errCode=E42'), 'must contain intra-step compressed summary text');
  assert.ok(!recallTool.text.includes('历史工具输出已蒸馏省略'), 'must NOT return v2.4 distill placeholder');
  assert.ok(!recallTool.text.includes('RAW_TAIL_NEEDLE=98765'), 'default must NOT return raw uncompressed output');
  assert.equal(session.activeRecalls.get(1), 'tool', 'activeRecalls must record tool mode');

  // Verify subsequent buildDistillReplacements respects session.activeRecalls and does NOT re-distill Round 1 tools
  const nextRepl = buildDistillReplacements(collectSurfaceMessages(session), { activeRecalls: session.activeRecalls });
  assert.equal(nextRepl.some((r) => r.seq === origToolEv.seq + 1), false, 'reinstated round tool result must not be immediately re-distilled');

  // 3. Recall tools with original: true -> walks sourceEventSeqs to raw uncompressed output
  const recallOrig = historyRecall.execute({ round: 1, mode: 'tool', original: true, reinstate: false }, exec);
  assert.equal(recallOrig.found, true);
  assert.equal(recallOrig.isOriginal, true);
  assert.equal('step' in recallOrig, false, 'omitted step must not be returned as null');
  assert.ok(recallOrig.text.includes('RAW_TAIL_NEEDLE=98765'), 'original: true must return raw uncompressed output');
});

test('distill [12]: synthetic user/message events (ptc-mode, tool-jobs, runtime-context) inside Turn 1 never trigger turn distillation or split rounds', async () => {
  const { partitionMessagesIntoTurns } = await import('../lib/core/projection.js');

  const singleTurnPairs = [
    { seq: 0, type: 'system/message', message: { role: 'system', content: 'sys' } },
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'start task' }] } },
    { seq: 2, type: 'user/message', message: { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '<system-reminder>...' }] } },
    { seq: 3, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'r'.repeat(8000) }, { type: 'tool-call', callId: 'c1', name: 'run_code', arguments: '{"code":"x"}' }] } },
    { seq: 4, type: 'tool/result', message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'o'.repeat(8000) }] } },
    { seq: 5, type: 'user/message', message: { role: 'user', source: { kind: 'ptc-mode' }, content: [{ type: 'text', text: 'Rendered 1 image...' }] } },
    { seq: 6, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'r2'.repeat(8000) }, { type: 'text', text: 'working...' }] } },
    { seq: 7, type: 'user/message', message: { role: 'user', source: { kind: 'tool-jobs', form: 'notice' }, content: [{ type: 'text', text: 'background job finished' }] } },
    { seq: 8, type: 'user/message', message: { role: 'user', source: { kind: 'oswyn-nudge' }, content: [{ type: 'text', text: 'nudge' }] } }
  ];

  // Still inside Turn 1: MUST NOT distill anything!
  const repl = buildDistillReplacements(singleTurnPairs);
  assert.deepEqual(repl, [], 'synthetic user messages (ptc-mode, tool-jobs, runtime-context) must not trigger turn distillation within Turn 1');

  // partitionMessagesIntoTurns must also keep all of these in Round 1 (not shift Round 1 to Round 2)
  const { turns } = partitionMessagesIntoTurns(singleTurnPairs.map((p) => p.message));
  assert.equal(turns.length, 1, 'all synthetic user/message events must stay inside Turn 1');
});

test('distill [13]: native user/message checkpoint distillation removes thinking+tools with ZERO custom events and history_recall recovers post-intra-step results', async () => {
  const { MockSession } = await import('./fixtures/mock-session.js');
  const { registerHistoryRecallTool } = await import('../lib/tools/history-recall.js');
  const { collectSurfaceMessages, appendCheckpointReplace } = await import('../lib/session/surface.js');
  const { buildTurnDistillCheckpoints } = await import('../lib/core/distill-projection.js');

  const tools = {};
  registerHistoryRecallTool({ tools: { register: (t) => { tools[t.name] = t; } } });
  const historyRecall = tools['history_recall'];

  // ZERO custom projections registered — stock DSH kernel only!
  const session = new MockSession([]);
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' });
  // Turn 1
  session.seed('user/message', { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Check logs' }] }, { surfaceOp: 'append' });
  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Native Turn 1 deep reasoning trace: checking worker.log' },
        { type: 'tool-call', callId: 'c_native_1', name: 'bash', arguments: JSON.stringify({ command: 'cat /var/log/worker.log' }) }
      ]
    }
  }, { surfaceOp: 'append' });
  const rawToolEv = session.seed('tool/result', {
    message: {
      role: 'tool',
      source: { toolName: 'bash', callId: 'c_native_1' },
      content: [{ type: 'text', text: 'RAW_HEADER\n' + 'NOISE '.repeat(300) + '\nRAW_SECRET=424242' }]
    }
  }, { surfaceOp: 'append' });

  // Intra-step compression replaces rawToolEv on surface
  session.append('tool/result', {
    message: {
      role: 'tool',
      source: { toolName: 'bash', callId: 'c_native_1' },
      content: [{ type: 'text', text: '[oswyn-meta: before=1820 after=95 keep=0 mode=replace seq=' + rawToolEv.seq + ']\n- Intra-step summary: worker.log OK (code=E99)' }]
    }
  }, {
    surfaceOp: { op: 'replace', startSeq: rawToolEv.seq, endSeq: rawToolEv.seq },
    sourceEventSeqs: [rawToolEv.seq]
  });

  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Native Turn 1 final reasoning' },
        { type: 'text', text: 'Checked worker.log, code=E99.' }
      ]
    }
  }, { surfaceOp: 'append' });

  // Turn 2
  session.seed('user/message', { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Now recall turn 1' }] }, { surfaceOp: 'append' });

  const checkpoints = buildTurnDistillCheckpoints(collectSurfaceMessages(session));
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].round, 1);
  const res = appendCheckpointReplace(session, checkpoints[0].startSeq, checkpoints[0].endSeq, checkpoints[0].text, {
    shadowedSeqs: checkpoints[0].shadowedSeqs
  });
  assert.equal(res.ok, true, 'native user/message checkpoint replace must succeed on stock kernel');

  // Verify ZERO oswyn/distill events exist in the log
  assert.equal(session.snapshotEvents().some((e) => e.type === OSWYN_DISTILL_EVENT), false);

  // Verify deriveMessages() dropped all historical thinking, tool-calls, and tool results
  const derived = session.deriveMessages();
  assert.equal(derived.some((m) => m.role === 'tool'), false, 'historical tool result must be removed from surface');
  assert.equal(derived.some((m) => m.role === 'assistant'), false, 'historical assistant messages replaced by compact checkpoint');
  assert.ok(derived.some((m) => Array.isArray(m.content) && m.content[0]?.text?.includes('[oswyn 轮次蒸馏 · 第 1 轮]')));

  // Verify idempotence: a second pass produces no checkpoints
  assert.deepEqual(buildTurnDistillCheckpoints(collectSurfaceMessages(session)), []);

  const exec = { agent: { session } };

  // Recall thinking from native checkpoint
  const rThink = historyRecall.execute({ round: 1, mode: 'think' }, exec);
  assert.equal(rThink.found, true);
  assert.ok(rThink.text.includes('Native Turn 1 deep reasoning trace'));

  // Recall tools (default original: false) -> post-intra-step-compression result!
  const rTool = historyRecall.execute({ round: 1, mode: 'tool' }, exec);
  assert.equal(rTool.found, true);
  assert.ok(rTool.text.includes('Intra-step summary: worker.log OK (code=E99)'));
  assert.ok(!rTool.text.includes('RAW_SECRET=424242'), 'default must return intra-step compressed result, not raw');

  // Recall tools with original: true -> raw uncompressed output!
  const rOrig = historyRecall.execute({ round: 1, mode: 'tool', original: true }, exec);
  assert.equal(rOrig.found, true);
  assert.ok(rOrig.text.includes('RAW_SECRET=424242'));
});

test('distill [14]: measureSurfaceBreakdown counts system prompt + distilled turns as compressed and undistilled turns as uncompressed', async () => {
  const { measureSurfaceBreakdown } = await import('../lib/core/distill-projection.js');
  const samplePairs = [
    { seq: 0, type: 'system/message', message: { role: 'system', content: 'S'.repeat(2900) } }, // 1000 tok
    { seq: 1, type: 'developer/message', message: { role: 'developer', content: 'D'.repeat(290) } }, // 100 tok
    // Turn 1: already distilled via native oswyn-compaction checkpoint
    { seq: 2, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'U'.repeat(290) }] } }, // 100 tok
    { seq: 3, type: 'user/message', message: { role: 'user', source: { kind: 'oswyn-compaction' }, content: [{ type: 'text', text: 'C'.repeat(580) }] } }, // 200 tok
    // Turn 2: undistilled completed turn
    { seq: 4, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Q'.repeat(290) }] } }, // 100 tok
    { seq: 5, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: 'A'.repeat(2900) }] } } // 1000 tok
  ];

  const bd = measureSurfaceBreakdown(samplePairs);
  assert.equal(bd.systemTokens, 1100, 'system + developer prompts counted in systemTokens');
  assert.equal(bd.distilledTurnsTokens, 300, 'distilled turn counted in distilledTurnsTokens');
  assert.equal(bd.compressedTokens, 1400, 'system prompt + distilled turns counted in compressedTokens');
  assert.equal(bd.uncompressedTokens, 1100, 'undistilled turns counted in uncompressedTokens');
  assert.equal(bd.totalTokens, 2500, 'totalTokens equals compressedTokens + uncompressedTokens');
});

test('distill [15]: isTurnIncompleteOrAwaitingAnswer excludes stopped, errored, and awaiting-answer turns', async () => {
  const { isTurnIncompleteOrAwaitingAnswer, buildTurnDistillCheckpoints } = await import('../lib/core/distill-projection.js');

  // 1. Stopped mid-tool (ends on tool/result)
  const midTool = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'check' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'tool-call', callId: 'c1', name: 'bash', arguments: '{}' }] } },
    { seq: 3, type: 'tool/result', message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(2000) }] } }
  ];
  assert.deepEqual(isTurnIncompleteOrAwaitingAnswer(midTool), { excluded: true, reason: 'stopped_mid_tool' });

  // 2. Asked user via ask_user_question
  const askTool = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'deploy' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'tool-call', callId: 'c2', name: 'ask_user_question', arguments: '{}' }] } },
    { seq: 3, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: '请选择环境' }] } }
  ];
  assert.deepEqual(isTurnIncompleteOrAwaitingAnswer(askTool), { excluded: true, reason: 'ask_user_question' });

  // 3. Final assistant line ends with question mark (awaiting user answer)
  const questionTurn = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'refactor' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: '需要同时修改测试文件吗？' }] } }
  ];
  assert.deepEqual(isTurnIncompleteOrAwaitingAnswer(questionTurn), { excluded: true, reason: 'awaiting_answer' });

  // 4. Stopped mid-thinking (no visible final text)
  const midThink = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'analyze' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking...'.repeat(200) }] } }
  ];
  assert.deepEqual(isTurnIncompleteOrAwaitingAnswer(midThink), { excluded: true, reason: 'no_final_reply' });

  // 5. Normal completed turn is NOT excluded
  const normalTurn = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fix' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: '已完成修复并通过测试。' }] } }
  ];
  assert.deepEqual(isTurnIncompleteOrAwaitingAnswer(normalTurn), { excluded: false, reason: null });

  // 6. buildTurnDistillCheckpoints with excludeIncompletePreviousTurn skips interrupted previous turn
  const withNewTurn = [
    ...midTool,
    { seq: 4, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] } }
  ];
  assert.deepEqual(
    buildTurnDistillCheckpoints(withNewTurn, { excludeIncompletePreviousTurn: true }),
    [],
    'interrupted previous turn must be skipped when excludeIncompletePreviousTurn is enabled'
  );

  // 7. New-turn Step 1 (before new user message lands on surface): includeLastTurn=true
  // distills a cleanly completed Turn N immediately, while still skipping an interrupted Turn N.
  const cleanBigTurn = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'inspect' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'R'.repeat(3000) }, { type: 'text', text: '已完成检查。' }] } }
  ];
  const step1Clean = buildTurnDistillCheckpoints(cleanBigTurn, { includeLastTurn: true, excludeIncompletePreviousTurn: true });
  assert.equal(step1Clean.length, 1, 'clean previous turn must be distilled on Step 1 of the new turn');
  assert.equal(step1Clean[0].round, 1);

  const step1Interrupted = buildTurnDistillCheckpoints(midTool, { includeLastTurn: true, excludeIncompletePreviousTurn: true });
  assert.deepEqual(step1Interrupted, [], 'interrupted previous turn must still be skipped on Step 1 of the new turn');
});

test('distill [16]: background task status updates (tool-jobs) are detected and never trigger turn distillation', async () => {
  const { isBackgroundJobStatusMessage } = await import('../lib/core/projection.js');
  const { isTurnTriggeredByBackgroundJob } = await import('../lib/core/distill-projection.js');

  assert.equal(isBackgroundJobStatusMessage({ role: 'user', source: { kind: 'tool-jobs', form: 'notice' }, content: [{ type: 'text', text: 'job done' }] }), true);
  assert.equal(isBackgroundJobStatusMessage({ role: 'user', source: { kind: 'background-task' }, content: [{ type: 'text', text: 'running' }] }), true);
  assert.equal(isBackgroundJobStatusMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }), false);
  assert.equal(isBackgroundJobStatusMessage({ role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ctx' }] }), false);

  const bgTurn = [
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'start build' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: 'started' }] } },
    { seq: 3, type: 'user/message', message: { role: 'user', source: { kind: 'tool-jobs', form: 'notice' }, content: [{ type: 'text', text: 'build running' }] } },
    { seq: 4, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: 'noted' }] } }
  ];
  assert.equal(isTurnTriggeredByBackgroundJob(bgTurn), true, 'turn woken by tool-jobs notice must be detected');

  const normalTurn = [
    { seq: 5, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next step' }] } },
    { seq: 6, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'text', text: 'done.' }] } }
  ];
  assert.equal(isTurnTriggeredByBackgroundJob(normalTurn), false, 'normal organic user turn must not be flagged as background job');
});

test('distill [17]: turn distillation NEVER replaces preamble or mid-turn system/developer messages', async () => {
  const { buildTurnDistillCheckpoints } = await import('../lib/core/distill-projection.js');
  const pairsWithMidSystem = [
    { seq: 0, type: 'system/message', message: { role: 'system', content: 'preamble system prompt' } },
    { seq: 1, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn 1' }] } },
    { seq: 2, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'R'.repeat(2000) }, { type: 'text', text: 'part 1' }] } },
    { seq: 3, type: 'system/message', message: { role: 'system', content: 'mid-turn system prompt update' } },
    { seq: 4, type: 'developer/message', message: { role: 'developer', content: 'mid-turn developer prompt' } },
    { seq: 5, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'R'.repeat(2000) }, { type: 'text', text: 'part 2' }] } },
    { seq: 6, type: 'user/message', message: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn 2' }] } }
  ];

  const cps = buildTurnDistillCheckpoints(pairsWithMidSystem);
  assert.equal(cps.length, 2, 'should split into 2 segments around mid-turn system/developer nodes');
  for (const cp of cps) {
    assert.equal(cp.shadowedSeqs.includes(0), false, 'preamble system prompt must never be shadowed');
    assert.equal(cp.shadowedSeqs.includes(3), false, 'mid-turn system prompt must never be shadowed');
    assert.equal(cp.shadowedSeqs.includes(4), false, 'mid-turn developer prompt must never be shadowed');
    assert.ok(!(cp.startSeq <= 3 && cp.endSeq >= 3), 'replace range must not span across seq 3');
    assert.ok(!(cp.startSeq <= 4 && cp.endSeq >= 4), 'replace range must not span across seq 4');
  }
});
