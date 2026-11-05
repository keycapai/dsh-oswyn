/**
 * Contract tests for lib/session/surface.js + applier.js against the REAL
 * dsh-session surface kernel (test/fixtures/kernel-surface.js, verbatim copy of
 * @deepseek-ai/dsh-session/lib/types/surface.js).
 *
 * Proves:
 *  (i)   reply compression shortens the derived message history AND emits a
 *        user/message surfaceOp:replace checkpoint the dsh-context meter folds;
 *  (ii)  that checkpoint is a real replace (foldSurface reports it in
 *        .replacements, shadowed nodes are spliced out);
 *  (iii) tool-call argument projection shortens arguments without throwing;
 *  (iv)  tool/result single-node replace works and is content-only;
 *  (v)   assistant/message + sourceEventSeqs throws (kernel invariant) and our
 *        surface layer degrades to {ok:false} instead of throwing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MockSession } from './fixtures/mock-session.js';
import {
  appendToolResultReplace,
  appendCheckpointReplace,
  getEventText
} from '../lib/session/surface.js';
import { applyFromAssistantMessage, applyCallArgRewrite, autoCompressToolResult } from '../lib/session/applier.js';
import { pruneToolCallArgs } from '../lib/core/projection.js';
import { parseMeta } from '../lib/core/markers.js';

const LONG = 'x'.repeat(1500);

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function seedConversation(session) {
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'you are helpful' }] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'summarize the file' }] }, { surfaceOp: 'append' });
  // assistant seq 2
  session.seed('assistant/message', {
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read the file.\n' + LONG },
        { type: 'tool-call', callId: 'c1', name: 'run_code', arguments: JSON.stringify({ code: 'y'.repeat(2000), extra: 'keep' }) }
      ]
    }
  }, { surfaceOp: 'append' });
  // tool/result seq 3
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'read', callId: 'c1' }, content: [{ type: 'text', text: 'FILE CONTENT '.repeat(200) }] }
  }, { surfaceOp: 'append', sourceEventSeqs: [2] });
}

test('(i)+(ii) reply compression: shorter derived history + real user/message replace checkpoint', () => {
  const session = new MockSession();
  seedConversation(session);
  const before = session.deriveMessages();
  const beforeAssistantLen = textOf(before.find((m) => m.role === 'assistant')).length;
  assert.ok(beforeAssistantLen > 1000, 'assistant message starts long');

  // Assistant reply carries a dsh-reply-summary fence targeting its own seq (2).
  const replyMsg = {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'summary of everything\n\u0060\u0060\u0060dsh-reply-summary\nThe file defines a helper and two exports.\n\u0060\u0060\u0060'
      },
      { type: 'tool-call', callId: 'c1', name: 'run_code', arguments: '{}' }
    ]
  };
  const res = applyFromAssistantMessage(session, replyMsg, 2, {});
  assert.equal(res.error, undefined);
  assert.ok(res.replySummary, 'reply summary applied');
  assert.equal(res.replySummary.targetSeq, 2);

  // The checkpoint MUST be a real user/message replace over seq 2.
  const lastEvent = session.log[session.log.length - 1];
  assert.equal(lastEvent.type, 'user/message');
  assert.equal(lastEvent.surfaceOp.op, 'replace');
  assert.equal(lastEvent.surfaceOp.startSeq, 2);
  assert.equal(lastEvent.surfaceOp.endSeq, 2);
  assert.deepEqual(lastEvent.sourceEventSeqs, [2]);

  // foldSurface recognized it as a replacement (the dsh-context meter reads .replacements).
  const fold = session.surface;
  assert.ok(fold.replacements.length >= 1, 'foldSurface recorded a replace');
  const rep = fold.replacements[fold.replacements.length - 1];
  assert.deepEqual(rep.shadowedSeqs, [2]);

  // Derived history: the assistant node is GONE (replaced), memo user node present.
  const after = session.deriveMessages();
  const afterRoles = after.map((m) => m.role);
  assert.equal(afterRoles.filter((r) => r === 'assistant').length, 0, 'assistant node spliced out');
  const memo = after.find((m) => m.role === 'user' && /oswyn (memo|双轨备忘)/.test(textOf(m)));
  assert.ok(memo, 'memo checkpoint present in derived history');
  assert.ok(textOf(memo).length < beforeAssistantLen, 'memo strictly shorter than original assistant message');
});

test('(iii) tool-call argument projection shortens arguments and never throws', () => {
  const session = new MockSession();
  seedConversation(session);
  const assistantEvent = session.log[2];
  const beforeArgs = assistantEvent.data.message.content.find((b) => b.type === 'tool-call').arguments;
  const out = applyCallArgRewrite(session, assistantEvent, { maxCodeLen: 150, maxSpecLen: 150 });
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  const afterArgs = out.message.content.find((b) => b.type === 'tool-call').arguments;
  assert.ok(afterArgs.length < beforeArgs.length, 'arguments strictly shrink');
  // Other fields untouched.
  const parsed = JSON.parse(afterArgs);
  assert.equal(parsed.extra, 'keep');
  // Idempotent: pruning again yields same arguments.
  const again = pruneToolCallArgs(out.message, { maxCodeLen: 150, maxSpecLen: 150 });
  assert.equal(again.content.find((b) => b.type === 'tool-call').arguments, afterArgs);
});

test('(iv) tool/result single-node replace rewrites content and updates derived message', () => {
  const session = new MockSession();
  seedConversation(session);
  const origText = getEventText(session.eventAt(3));
  const write = appendToolResultReplace(session, 3, [{ type: 'text', text: 'short fact: file has 2 exports' }]);
  assert.equal(write.ok, true);
  const msgs = session.deriveMessages();
  const toolMsg = msgs.find((m) => m.role === 'tool');
  assert.ok(toolMsg, 'tool message still present (single node replaced in place)');
  assert.ok(textOf(toolMsg).length < origText.length, 'tool result derived message shorter');
  // marker embed style: content carries oswyn meta
});

test('(ii2) tool result plan embeds a parseable [oswyn-meta:] marker', () => {
  const session = new MockSession();
  seedConversation(session);
  const res = applyFromAssistantMessage(session, {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok\n\u0060\u0060\u0060dsh-result-summary\nreplace\n- file has 2 exports\n\u0060\u0060\u0060' }]
  }, 4, {});
  assert.equal(res.error, undefined);
  const applied = res.applied.find((a) => a.mode === 'replace' || a.mode === 'truncate');
  assert.ok(applied, 'a tool result was rewritten');
  // The replacement is a NEW event at the log tail (content-only, same role/tool).
  const newText = getEventText(session.log[session.log.length - 1]);
  const meta = parseMeta(newText);
  assert.ok(meta, 'rewritten content carries oswyn-meta');
  assert.equal(meta.mode, applied.mode);
  assert.ok(meta.before >= meta.after, 'truthful: after <= before');
});

test('(v) assistant/message + sourceEventSeqs throws in kernel; surface layer degrades to {ok:false}', () => {
  const session = new MockSession();
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' });
  session.seed('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }, { surfaceOp: 'append' });

  // Direct kernel violation: our mock append validates via foldSurface and throws.
  assert.throws(() => {
    session.append('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'y' }] } }, {
      surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 },
      sourceEventSeqs: [1]
    });
  }, /assistant\/message embeds its source stream/);

  // Our surface layer NEVER uses that path; a bad range degrades to {ok:false}.
  const bad = appendCheckpointReplace(session, 99, 99, 'memo');
  assert.equal(bad.ok, false);
  assert.ok(/not|range|invalid|seq/.test(bad.reason), 'reason explains failure');
});

test('checkpoint over a multi-node range splices out every shadowed node', () => {
  const session = new MockSession();
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'step1 ' + LONG }] } }, { surfaceOp: 'append' });
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: 'ERR '.repeat(300) }] } }, { surfaceOp: 'append', sourceEventSeqs: [1] });
  const beforeCount = session.deriveMessages().length; // 3
  const write = appendCheckpointReplace(session, 1, 2, '[folded 2 failed calls]');
  assert.equal(write.ok, true);
  const after = session.deriveMessages();
  assert.equal(after.length, beforeCount - 1, 'two nodes -> one node, net -1 message');
  const rep = session.surface.replacements.at(-1);
  assert.deepEqual(rep.shadowedSeqs, [1, 2]);
});

test('discard directive folds a failed tool result into a fact checkpoint', () => {
  const session = new MockSession();
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'run tests' }] }, { surfaceOp: 'append' });
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, isError: true, content: [{ type: 'text', text: 'Traceback (most recent call last):\n  File x\nSyntaxError: bad\n' + 'stack '.repeat(300) }] }
  }, { surfaceOp: 'append', sourceEventSeqs: [0] });

  const res = applyFromAssistantMessage(session, {
    role: 'assistant',
    content: [{ type: 'text', text: 'trying again\n\u0060\u0060\u0060dsh-result-summary\ndiscard\n- 失败根因: SyntaxError in module x\n\u0060\u0060\u0060' }]
  }, 2, {});
  assert.equal(res.error, undefined);
  assert.equal(res.applied.length, 1, 'discard applied on the tool result');
  const last = session.log[session.log.length - 1];
  assert.equal(last.type, 'tool/result');
  assert.equal(last.surfaceOp.op, 'replace');
  // The fact survives in the derived memo.
  const msgs = session.deriveMessages();
  const memo = msgs.find((m) => /SyntaxError|失败|oswyn|召回|折叠/.test(textOf(m)));
  assert.ok(memo, 'fact persisted in derived memo');
});
test('auto-compress: a plain oversized tool/result (no model fence) is compressed with a parseable marker + callId', () => {
  const log = [];
  const push = (ev) => { const e = { seq: log.length, ...ev }; log.push(e); return e; };
  push({ type: 'system/message', surfaceOp: 'append', data: { message: { role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'sys' }] } } });
  const c1 = push({ type: 'tool/call', data: { callId: 'cAUTO', name: 'bash', arguments: '{}' } });
  const big = Array.from({ length: 500 }, (_, i) => 'line ' + i + ' ' + 'y'.repeat(60)).join(String.fromCharCode(10));
  const ev = push({ type: 'tool/result', sourceEventSeqs: [c1.seq], data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'cAUTO' }, content: [{ type: 'text', text: big }] } } });
  const session = {
    id: 'auto_t', title: 'A', log,
    snapshotEvents() { return log; },
    eventAt(s) { return log.find((e) => e.seq === s); },
    surface: { nodes: log.map((e) => e.seq) },
    append(type, data, opts) {
      const seq = log.length; const e = { seq, type, data, ...(opts || {}) }; log.push(e);
      if (opts && opts.surfaceOp && opts.surfaceOp.op === 'replace') {
        const i = session.surface.nodes.indexOf(opts.surfaceOp.startSeq);
        const j = session.surface.nodes.indexOf(opts.surfaceOp.endSeq);
        if (i >= 0 && j >= i) session.surface.nodes.splice(i, j - i + 1, seq);
      } else session.surface.nodes.push(seq);
      return e;
    }
  };
  const rec = autoCompressToolResult(session, ev, { minChars: 4000, keepLines: 30 });
  assert.ok(rec, 'auto-compress returns a record');
  assert.equal(rec.toolName, 'bash');
  assert.equal(rec.callId, 'cAUTO');
  assert.ok(rec.after < rec.before, 'strictly shorter');
  const newText = log[log.length - 1].data.message.content.map((b) => b.text).join('');
  assert.match(newText, /\[oswyn-meta: before=\d+ after=\d+/, 'marker embedded');
});

test('auto-compress: small outputs and already-compressed results are left untouched', () => {
  const log = [];
  const push = (ev) => { const e = { seq: log.length, ...ev }; log.push(e); return e; };
  push({ type: 'system/message', surfaceOp: 'append', data: { message: { role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'sys' }] } } });
  const small = push({ type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'bash', callId: 's' }, content: [{ type: 'text', text: 'tiny' }] } } });
  const session = { id: 'a2', log, snapshotEvents() { return log; }, eventAt(s) { return log.find((e) => e.seq === s); }, surface: { nodes: log.map((e) => e.seq) }, append() { throw new Error('should not append'); } };
  assert.equal(autoCompressToolResult(session, small, { minChars: 4000 }), null);

  const done = push({ type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'd' }, content: [{ type: 'text', text: '[oswyn-meta: before=9000 after=100 keep=10 mode=truncate seq=9]\n' + 'x'.repeat(9000) }] } } });
  assert.equal(autoCompressToolResult(session, done, { minChars: 4000 }), null, 'already-compressed untouched');
});

test('assistant fences run once across session/event and pre-step observers', () => {
  const session = new MockSession();
  seedConversation(session);
  const assistantMsg = {
    role: 'assistant',
    content: [{ type: 'text', text: 'done\n\u0060\u0060\u0060dsh-result-summary\nreplace\n- file has 2 exports\n\u0060\u0060\u0060' }]
  };
  const first = applyFromAssistantMessage(session, assistantMsg, 4, {});
  assert.equal(first.duplicate, undefined);
  assert.equal(first.applied.length, 1, 'first observer performs the rewrite');
  const logLength = session.log.length;

  const second = applyFromAssistantMessage(session, assistantMsg, 4, {});
  assert.equal(second.duplicate, true, 'second observer is explicitly a no-op');
  assert.equal(second.applied.length, 0);
  assert.equal(second.rejected.length, 0, 'no spurious already-replaced rejection');
  assert.equal(session.log.length, logLength, 'no duplicate surface event or ledger source');
});

test('auto-compress never rewrites a result already handled by an agent fence', () => {
  const session = new MockSession();
  seedConversation(session);
  const assistantMsg = {
    role: 'assistant',
    content: [{ type: 'text', text: 'done\n\u0060\u0060\u0060dsh-result-summary\nreplace\n- file has 2 exports\n\u0060\u0060\u0060' }]
  };
  const first = applyFromAssistantMessage(session, assistantMsg, 4, {});
  assert.equal(first.applied.length, 1);
  const logLength = session.log.length;
  const latest = session.log[session.log.length - 1];
  const opts = { minChars: 200, keepLines: 30 };

  assert.equal(autoCompressToolResult(session, session.eventAt(3), opts), null, 'shadowed origin is skipped');
  assert.equal(autoCompressToolResult(session, latest, opts), null, 'compressed replacement is skipped');
  assert.equal(session.log.length, logLength, 'automatic layer adds no second rewrite');
});

