/**
 * End-to-end coverage for the agent/pre-step hook:
 *   - single-step tool pressure nudge for large / failed tool results
 *   - outgoing assistant tool-call argument projection
 * These exercise the actual hook path, not only pure helpers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';
import { collectNudgeCandidates } from '../lib/prompts/nudge.js';
import { MockSession } from './fixtures/mock-session.js';

function makeCtx() {
  const hooks = {};
  const ctx = {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    effect(fn) { try { fn(); } catch {} },
    on(evt, handler) { hooks[evt] = handler; },
    inject(_deps, cb) { try { cb(ctx); } catch {} },
    commands: { register() {} },
    tools: { register() {} },
    systemPrompt: { section() {} }
  };
  ctx._hooks = hooks;
  return ctx;
}

function makeSession(text, isError = false) {
  const log = [
    { seq: 0, type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
    { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, isError, content: [{ type: 'text', text }] } } }
  ];
  return {
    id: 'test_nudge_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: 'N',
    log,
    snapshotEvents() { return log; },
    eventAt(seq) { return log.find((e) => e.seq === seq); },
    append() { throw new Error('not used'); }
  };
}

test('pre-step: large tool result gets a truncate/discard nudge appended to the outgoing request', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, nudgeEnabled: true, nudgeThresholdChars: 100, nudgeThresholdLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  assert.equal(typeof hook, 'function');

  const session = makeSession('line\n'.repeat(40));
  const baseMessages = [
    { role: 'user', content: [{ type: 'text', text: 'go' }] },
    { role: 'tool', content: [{ type: 'text', text: 'line\n'.repeat(40) }] }
  ];
  const decision = await hook(
    { agent: { session }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: baseMessages })
  );
  assert.equal(decision.messages.length, baseMessages.length + 1, 'one nudge message appended');
  const nudge = decision.messages[decision.messages.length - 1];
  assert.equal(nudge.source.kind, 'oswyn-nudge');
  assert.match(nudge.content[0].text, /DSH-OSWYN 上下文精炼提示/);
  assert.match(nudge.content[0].text, /truncate keep <N> lines/);
});

test('pre-step: failed tool result gets the failure-sensitive discard nudge', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, nudgeEnabled: true, nudgeErrorThresholdChars: 50, nudgeErrorThresholdLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeSession('Traceback ...\nstack line\n'.repeat(20), true);
  const decision = await hook(
    { agent: { session }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [{ role: 'tool', isError: true, content: [{ type: 'text', text: 'Traceback ...\nstack line\n'.repeat(20) }] }] })
  );
  const nudge = decision.messages[decision.messages.length - 1];
  assert.match(nudge.content[0].text, /DSH-OSWYN 失败调用精炼提示/);
  assert.match(nudge.content[0].text, /discard/);
});

test('pre-step: already-OSWYN-marked output is not nudged again', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, nudgeEnabled: true, nudgeThresholdChars: 10, nudgeThresholdLines: 2 });
  const hook = ctx._hooks['agent/pre-step'];
  const marked = '[oswyn-meta: before=100 after=10 keep=0 mode=replace seq=2]\n[oswyn 输出已压缩 · 原文 tool_result_recall 可召回]\n- fact';
  const session = makeSession(marked);
  const decision = await hook(
    { agent: { session }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [{ role: 'tool', content: [{ type: 'text', text: marked }] }] })
  );
  assert.equal(decision.messages.length, 1, 'no duplicate nudge for already-compressed output');
});

test('pre-step: outgoing assistant tool-call arguments are projected (code/spec pruned)', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeSession('small');
  const huge = 'z'.repeat(2000);
  const assistant = {
    role: 'assistant',
    content: [{ type: 'tool-call', callId: 'c9', name: 'run_code', arguments: JSON.stringify({ code: huge, spec: huge, keep: 'yes' }) }]
  };
  const decision = await hook(
    { agent: { session }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [assistant] })
  );
  const block = decision.messages[0].content[0];
  const parsed = JSON.parse(block.arguments);
  assert.ok(parsed.code.length < huge.length, 'code argument pruned');
  assert.ok(parsed.spec.length < huge.length, 'spec argument pruned');
  assert.equal(parsed.keep, 'yes', 'other arguments untouched');
});


function makeTieredSession(toolName, isError = false) {
  const session = new MockSession();
  session.id = 'test_tiered_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName, callId: 'c1' }, isError, content: [{ type: 'text', text: Array.from({ length: 30 }, (_, i) => 'line-' + i + '-' + 'x'.repeat(100)).join('\n') }] }
  }, { surfaceOp: 'append' });
  // A real model request must have seen this result before auto compression runs.
  session.seed('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'I saw the tool result.' }] } }, { surfaceOp: 'append' });
  return session;
}

test('pre-step: tiered auto-compress runs for bash when no agent fence exists', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoCompress: false, autoCompressTiered: true, autoCompressMinChars: 200, autoCompressKeepLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('bash');
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.ok(session.log.length > beforeLen, 'tiered auto-compressed a bash result');
  const replaced = session.log[session.log.length - 1];
  assert.equal(replaced.surfaceOp.op, 'replace');
  assert.match(replaced.data.message.content[0].text, /\[oswyn-meta: before=\d+ after=\d+ .*mode=truncate/);
});

test('pre-step: tiered auto-compress NEVER touches run_code results', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoCompress: false, autoCompressTiered: true, autoCompressMinChars: 200, autoCompressKeepLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('run_code');
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(session.log.length, beforeLen, 'run_code is excluded from tiered auto-compress');
});

test('pre-step: protected tool list always blocks tiered auto-compress', async () => {
  const ctx = makeCtx();
  apply(ctx, {
    enabled: true,
    autoCompress: false,
    autoCompressTiered: true,
    autoCompressTieredProtectedTools: ['bash'],
    autoCompressMinChars: 200,
    autoCompressKeepLines: 5
  });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('bash');
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(session.log.length, beforeLen, 'protected bash must remain untouched');
});

test('pre-step: configured autoDiscardTools forces validate_dsh_ui discard', async () => {
  const ctx = makeCtx();
  apply(ctx, {
    enabled: true,
    autoDiscardFailed: false,
    autoDiscardTools: ['validate_dsh_ui'],
    autoCompressTiered: false,
    autoCompressPtcSubcalls: false
  });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('validate_dsh_ui');
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.ok(session.log.length > beforeLen, 'configured validate_dsh_ui must be auto-discarded');
  const last = session.log[session.log.length - 1];
  assert.equal(last.surfaceOp.op, 'replace');
  assert.match(last.data.message.content[0].text, /mode=discard/);
});

test('pre-step: auto discard waits until the model has seen the failed result', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoDiscardFailed: true, autoDiscardTools: [], autoCompressTiered: false, autoCompressPtcSubcalls: false });
  const hook = ctx._hooks['agent/pre-step'];
  const session = new MockSession();
  session.id = 'test_deferred_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, isError: true, content: [{ type: 'text', text: 'Error: boom\n' + 'stack\n'.repeat(40) }] } }, { surfaceOp: 'append' });
  const before = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(session.log.length, before, 'first pre-step must leave the failed result visible to the model');
  session.seed('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'I saw the error.' }] } }, { surfaceOp: 'append' });
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.ok(session.log.length > before, 'after the model has seen it, auto discard runs');
  assert.match(session.log[session.log.length - 1].data.message.content[0].text, /mode=discard/);
});

test('pre-step: tiered auto-compress never touches read results', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoCompress: false, autoCompressTiered: true, autoCompressMinChars: 200, autoCompressKeepLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('read');
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(session.log.length, beforeLen, 'read must be protected from tiered auto-compress');
});


test('pre-step: failed read is auto-discarded even though read is protected', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoDiscardFailed: true, autoDiscardTools: [], autoCompressTiered: false, autoCompressPtcSubcalls: false });
  const hook = ctx._hooks['agent/pre-step'];
  const session = makeTieredSession('read', true);
  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));
  assert.ok(session.log.length > beforeLen, 'failed read must be discarded regardless of protection list');
  assert.match(session.log[session.log.length - 1].data.message.content[0].text, /mode=discard/);
});

test('pre-step: active fence blocks fallback auto-discard and auto-truncate on seen tool results', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, autoDiscardFailed: true, autoCompressTiered: true, autoCompressMinChars: 200, autoCompressKeepLines: 5 });
  const hook = ctx._hooks['agent/pre-step'];
  const session = new MockSession();
  session.id = 'test_active_first_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, isError: true, content: [{ type: 'text', text: 'Error: failed\n' + 'stack\n'.repeat(30) }] }
  }, { surfaceOp: 'append' });
  // Assistant explicitly writes an active replace fence (preserving parameters)
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'text', text: '```dsh-result-summary\nreplace\n- 失败结论: worker_17 failed with timeout\n```' }] }
  }, { surfaceOp: 'append' });

  const beforeLen = session.log.length;
  await hook({ agent: { session }, signal: { aborted: false } }, async () => ({ kind: 'enter', messages: [] }));

  // The active replace should have been processed, and auto-discard should NOT overwrite it with mode=discard
  const last = session.log[session.log.length - 1];
  assert.equal(last.surfaceOp.op, 'replace');
  assert.match(last.data.message.content[0].text, /mode=replace/, 'active replace mode preserved, auto-discard did not overwrite');
});

test('collectNudgeCandidates collects trailing tool messages even when trailing context message exists', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'run test' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'calling bash' }] },
    { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: 'line\n'.repeat(50) }] },
    { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'current time: 12:00' }] }
  ];
  const candidates = collectNudgeCandidates(messages, { nudgeThresholdChars: 100, nudgeThresholdLines: 5 });
  assert.equal(candidates.length, 1, 'tool candidate collected despite trailing runtime-context message');
  assert.equal(candidates[0].toolName, 'bash');
});

