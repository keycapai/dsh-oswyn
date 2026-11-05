import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSummaryBody } from '../lib/core/parse.js';
import { applyFromAssistantMessage } from '../lib/session/applier.js';
import { deriveEntry } from '../lib/store/ledger.js';

function block(lines) {
  return '\u0060\u0060\u0060dsh-result-summary\n' + lines.join('\n') + '\n\u0060\u0060\u0060';
}

function makeSession(events) {
  const log = events.map((e, i) => ({ seq: i, ...e }));
  const session = {
    id: 'test_directives_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    log,
    surface: { nodes: log.map((e) => e.seq) },
    snapshotEvents() { return log; },
    eventAt(seq) { return log.find((e) => e.seq === seq); },
    append(type, data, opts = {}) {
      const ev = { type, seq: log.length, data, ...opts };
      log.push(ev);
      if (opts.surfaceOp?.op === 'replace') {
        const i = session.surface.nodes.indexOf(opts.surfaceOp.startSeq);
        const j = session.surface.nodes.indexOf(opts.surfaceOp.endSeq);
        if (i >= 0 && j >= i) session.surface.nodes.splice(i, j - i + 1, ev.seq);
      } else {
        session.surface.nodes.push(ev.seq);
      }
      return ev;
    }
  };
  return session;
}

function toolResult(text, toolName = 'bash', extra = {}) {
  return { type: 'tool/result', data: { message: { role: 'tool', source: { toolName, callId: 'c_' + Math.random().toString(36).slice(2, 7) }, content: [{ type: 'text', text }], ...extra } } };
}

test('parse: seq and truncate on separate lines keeps chars/line sizes', () => {
  const chars = parseSummaryBody('', 'seq 329\ntruncate keep 120 chars\n- fact');
  assert.equal(chars.targetSeq, 329);
  assert.equal(chars.mode, 'truncate');
  assert.equal(chars.explicitMode, 'truncate');
  assert.equal(chars.keepCount, 120);
  assert.equal(chars.keepUnit, 'chars');

  const lines = parseSummaryBody('', 'seq 42\ntruncate keep 7 lines\n- fact');
  assert.equal(lines.targetSeq, 42);
  assert.equal(lines.keepCount, 7);
  assert.equal(lines.keepUnit, 'lines');
});

test('parse: a fact body never overrides the leading directive', () => {
  const parsed = parseSummaryBody('', 'seq 9\ntruncate keep 30 chars\n- replace this later; keep 999 rows');
  assert.equal(parsed.mode, 'truncate');
  assert.equal(parsed.keepCount, 30);
});

test('applier: explicit char truncation uses exactly N chars', () => {
  const original = 'CHAR-PREFIX-' + 'x'.repeat(1000);
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    toolResult(original),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['seq 2', 'truncate keep 120 chars', '- kept prefix']) }] } } }
  ]);
  const result = applyFromAssistantMessage(session, session.eventAt(3).data.message, 3, { replySummaryEnabled: true });
  const applied = result.applied.find((row) => row.seq === 2);
  assert.ok(applied, result.rejected.join(' | '));
  assert.equal(applied.mode, 'truncate');
  assert.equal(applied.keepChars, 120);
  assert.ok(applied.after < applied.before);
  const appended = session.log.find((ev) => ev.surfaceOp && ev.surfaceOp.startSeq === 2);
  assert.ok(appended, 'tool/result replace event appended');
  const replacement = appended.data.message.content[0].text;
  assert.ok(replacement.startsWith(original.slice(0, 120)), 'prefix is byte-for-byte preserved');
});

test('applier: cascade folds earlier failed calls but keeps the successful result', () => {
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [] } } },
    toolResult('Command failed with exit code 9\n' + 'stack-noise '.repeat(120)),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [] } } },
    toolResult('SUCCESS-' + 'ok '.repeat(200)),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['seq 5', 'replace', 'cascade', '- success after retry']) }] } } }
  ]);
  const result = applyFromAssistantMessage(session, session.eventAt(6).data.message, 6, { replySummaryEnabled: true });
  assert.ok(result.applied.some((row) => row.seq === 5 && row.mode === 'replace'), result.rejected.join(' | '));
  const failed = result.applied.find((row) => row.seq === 3);
  assert.ok(failed, 'earlier failed result is folded');
  assert.equal(failed.mode, 'discard');
  assert.match(failed.fact, /失败|exit code/i);
});

test('applier: prune-call and stub-call project real tool-call arguments', () => {
  const hugeCode = 'z'.repeat(600);
  const assistant = { role: 'assistant', content: [
    { type: 'tool-call', name: 'bash', callId: 'call_prune', arguments: { code: hugeCode } },
    { type: 'text', text: block(['prune-call', '- compacted']) }
  ] };
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    toolResult('small output'),
    { type: 'assistant/message', data: { message: assistant } }
  ]);
  const pruned = applyFromAssistantMessage(session, assistant, 3, { replySummaryEnabled: true });
  const pruneRow = pruned.applied.find((row) => row.mode === 'prune-call');
  assert.ok(pruneRow, pruned.rejected.join(' | '));
  assert.ok(pruneRow.after < pruneRow.before);
  assert.ok(pruned.callArgProjection && pruned.callArgProjection.changed);
  const projected = pruned.callArgProjection.message.content[0].arguments.code;
  assert.ok(projected.length < hugeCode.length, 'code argument really shrunk');

  const smallAssistant = { role: 'assistant', content: [
    { type: 'tool-call', name: 'bash', callId: 'call_stub', arguments: { code: 'y'.repeat(120) } },
    { type: 'text', text: block(['stub-call', '- stubbed']) }
  ] };
  const session2 = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    toolResult('small output'),
    { type: 'assistant/message', data: { message: smallAssistant } }
  ]);
  const stubbed = applyFromAssistantMessage(session2, smallAssistant, 3, { replySummaryEnabled: true });
  assert.ok(stubbed.applied.some((row) => row.mode === 'prune-call'), 'stub-call prunes below the normal 150-char threshold');
});

test('ledger: prune-call saves input but does not charge a summary block', () => {
  const entry = deriveEntry({ seq: 1, mode: 'prune-call', before: 1000, after: 100 });
  assert.ok(entry.tokensSaved > 0);
  assert.equal(entry.extraSummaryTokens, 0);
});

test('parse: prune-call alone sets explicitMode prune-call', () => {
  const parsed = parseSummaryBody('', 'seq 294\nprune-call\n- compacted large arguments');
  assert.equal(parsed.mode, 'prune-call');
  assert.equal(parsed.explicitMode, 'prune-call');
  assert.equal(parsed.pruneCall, true);
  assert.equal(parsed.targetSeq, 294);
});

test('applier: prune-call in follow-up assistant turn searches backward to prune target call', () => {
  const hugeCode = 'x'.repeat(1200);
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'run' }] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'tool-call', name: 'bash', callId: 'call_big', arguments: { code: hugeCode } }] } } },
    toolResult('output 12345'),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['seq 3', 'prune-call', '- compacted']) }] } } }
  ]);
  const followUp = session.eventAt(4).data.message;
  const result = applyFromAssistantMessage(session, followUp, 4, { replySummaryEnabled: true });
  const pruneRow = result.applied.find((r) => r.mode === 'prune-call');
  assert.ok(pruneRow, 'prune-call applied on previous assistant tool-call: ' + result.rejected.join(' | '));
  assert.equal(pruneRow.seq, 2);
  assert.equal(pruneRow.before, 1211);
  assert.ok(pruneRow.after < hugeCode.length);
});

test('applier: truncate/replace preserves summary & discard preserves callId for complete ledger history', () => {
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'run_code', callId: 'call_trunc_1' }, content: [{ type: 'text', text: 'line\n'.repeat(100) }] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['truncate keep 5 lines', '- kept header 5 lines']) }] } } },
    { type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'run_code', callId: 'call_disc_2' }, isError: true, content: [{ type: 'text', text: 'Error: failed\n' + 'stack\n'.repeat(80) }] } } },
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['discard', '- 失败结论：权限不足']) }] } } }
  ]);
  const r1 = applyFromAssistantMessage(session, session.eventAt(3).data.message, 3, {});
  assert.equal(r1.applied.length, 1);
  assert.equal(r1.applied[0].callId, 'call_trunc_1');
  assert.equal(r1.applied[0].summary, '- kept header 5 lines');

  const r2 = applyFromAssistantMessage(session, session.eventAt(5).data.message, 5, {});
  assert.equal(r2.applied.length, 1);
  assert.equal(r2.applied[0].mode, 'discard');
  assert.equal(r2.applied[0].callId, 'call_disc_2', 'discard must preserve callId so UI can badge the row');
  assert.match(r2.applied[0].fact, /权限不足/);
});


test('applier: no-directive summary fence is treated as replace (protocol compatibility)', () => {
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    toolResult('x'.repeat(1200)),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['- 已确认模块逻辑：无需修改']) }] } } }
  ]);
  const result = applyFromAssistantMessage(session, session.eventAt(3).data.message, 3, {});
  const applied = result.applied.find((row) => row.seq === 2);
  assert.ok(applied, result.rejected.join(' | '));
  assert.equal(applied.mode, 'replace');
  assert.match(applied.summary, /无需修改/);
});

test('applier: bare truncate falls back to autoCompressKeepLines (30 lines)', () => {
  const original = Array.from({ length: 60 }, (_, i) => 'row ' + i).join('\n');
  const session = makeSession([
    { type: 'system/message', data: { message: { role: 'system', content: [] } } },
    { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    toolResult(original),
    { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: block(['truncate', '- kept prefix']) }] } } }
  ]);
  const result = applyFromAssistantMessage(session, session.eventAt(3).data.message, 3, { autoCompressKeepLines: 30 });
  const applied = result.applied.find((row) => row.seq === 2);
  assert.ok(applied, result.rejected.join(' | '));
  assert.equal(applied.mode, 'truncate');
  assert.equal(applied.keepLines, 30);
});
