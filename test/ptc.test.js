import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { autoCompressPtcSubcalls, collectPtcSubcalls } from '../lib/session/ptc.js';

function textOf(message) {
  const c = message?.content;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}

function makePtcSession({ withDispatch = true, total = 5000 } = {}) {
  const session = new MockSession();
  session.id = 'test_ptc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  if (withDispatch) {
    session.seed('tool/ptc-dispatch', { rootCallId: 'run_code_1_abc', parentCallId: 'run_code_1_abc', subCallId: 'run_code_1_abc:ptc:1', name: 'grep', isError: false, content: [{ type: 'text', text: 'Found 120 matches in lib/client.js\n' + 'x'.repeat(1000) }] }, {});
    session.seed('tool/ptc-dispatch', { rootCallId: 'run_code_1_abc', parentCallId: 'run_code_1_abc', subCallId: 'run_code_1_abc:ptc:2', name: 'read', isError: true, content: [{ type: 'text', text: 'Error: file missing\n' + 'y'.repeat(1000) }] }, {});
  }
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'run_code', callId: 'run_code_1_abc' }, content: [{ type: 'text', text: '{"grep":"' + 'x'.repeat(total / 2) + '","read":"' + 'y'.repeat(total / 2) + '"}' }] }
  }, { surfaceOp: 'append' });
  return session;
}

test('collectPtcSubcalls matches dispatch events by rootCallId', () => {
  const session = makePtcSession();
  const result = session.eventAt(4);
  const subcalls = collectPtcSubcalls(session, result);
  assert.deepEqual(subcalls.map((s) => s.name), ['grep', 'read']);
  assert.equal(subcalls[1].isError, true);
});

test('autoCompressPtcSubcalls replaces the outer run_code result once with a per-subcall summary', () => {
  const session = makePtcSession();
  const result = session.eventAt(4);
  const applied = autoCompressPtcSubcalls(session, result, { minChars: 200 });
  assert.ok(applied, 'PTC aggregate should be compressed');
  assert.equal(applied.toolName, 'run_code');
  assert.ok(applied.after < applied.before);
  const last = session.log[session.log.length - 1];
  assert.equal(last.type, 'tool/result');
  assert.equal(last.surfaceOp.op, 'replace');
  assert.equal(last.surfaceOp.startSeq, 4);
  const text = textOf(last.data.message);
  assert.match(text, /\[oswyn-meta: before=\d+ after=\d+/);
  assert.match(text, /PTC 子调用已自动压缩/);
  assert.match(text, /- grep: Found 120 matches/);
  assert.match(text, /- read \[error\]: Error: file missing/);
});

test('autoCompressPtcSubcalls leaves single/non-PTC or tiny results untouched', () => {
  const session = makePtcSession({ withDispatch: false });
  assert.equal(autoCompressPtcSubcalls(session, session.eventAt(2), { minChars: 200 }), null);
});

test('autoCompressPtcSubcalls skips aggregates containing protected read subcalls', () => {
  const session = makePtcSession();
  // make the read subcall successful (real code)
  session.log[3].data.isError = false;
  session.log[3].data.content = [{ type: 'text', text: 'const a = 1;\nexport default a;' }];
  const result = session.eventAt(4);
  assert.equal(autoCompressPtcSubcalls(session, result, { minChars: 200 }), null);
});

test('autoCompressPtcSubcalls honors discardTools for a PTC subcall such as validate_dsh_ui', () => {
  const session = new MockSession();
  session.id = 'test_ptc_discard_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('tool/ptc-dispatch', { rootCallId: 'run_code_2_x', subCallId: 'run_code_2_x:ptc:1', name: 'validate_dsh_ui', isError: false, content: [{ type: 'text', text: 'status=valid' }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'run_code_2_x' }, content: [{ type: 'text', text: '{"ok":true}' }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 4000, discardTools: ['validate_dsh_ui'] });
  assert.ok(applied);
  assert.equal(applied.mode, 'discard');
  assert.match(session.log[session.log.length - 1].data.message.content[0].text, /PTC 子调用已丢弃/);
});

test('autoCompressPtcSubcalls detects and discards bash subcall with exitCode: 1', () => {
  const session = new MockSession();
  session.id = 'test_ptc_exit1_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'run fail' }] }, { surfaceOp: 'append' });
  const bashJson = JSON.stringify({ kind: 'foreground', exitCode: 1, stderr: { text: 'Error: crash\n' + 'stack\n'.repeat(30) } });
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_exit1', subCallId: 'rc_exit1:1', name: 'bash', isError: false, content: [{ type: 'text', text: bashJson }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'rc_exit1' }, content: [{ type: 'text', text: '{"bash":"failed"}' }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 200, discardFailed: true });
  assert.ok(applied);
  assert.equal(applied.mode, 'discard');
  assert.match(session.log[session.log.length - 1].data.message.content[0].text, /PTC 子调用已丢弃/);
});

test('autoCompressPtcSubcalls returns null when outer run_code failed with Error: code run failed', () => {
  const session = new MockSession();
  session.id = 'test_ptc_outer_fail_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'run fail' }] }, { surfaceOp: 'append' });
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_fail', subCallId: 'rc_fail:1', name: 'bash', isError: false, content: [{ type: 'text', text: 'echo 1' }] }, {});
  session.seed('tool/result', {
    message: {
      role: 'tool',
      source: { toolName: 'run_code', callId: 'rc_fail' },
      content: [{ type: 'text', text: 'Error: code run failed (exception): Unterminated template\nFile sandbox: danger-full-access.' }],
      isError: true
    }
  }, { surfaceOp: 'append' });
  // autoCompressPtcSubcalls must leave outer failures alone so autoDiscardToolResult can discard it
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 200, discardFailed: true });
  assert.equal(applied, null, 'outer failure must not be compressed as subcall summary');
});

test('autoCompressPtcSubcalls detects and discards short bash subcall with exitCode: 1 without stack padding', () => {
  const session = new MockSession();
  session.id = 'test_ptc_short_fail_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'short fail' }] }, { surfaceOp: 'append' });
  const bashJson = JSON.stringify({ kind: 'foreground', exitCode: 1, stderr: { text: 'bash: command not found' } });
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_short', subCallId: 'rc_short:1', name: 'bash', isError: false, content: [{ type: 'text', text: bashJson }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'rc_short' }, content: [{ type: 'text', text: '{"bash":"failed"}' }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 200, discardFailed: true });
  assert.ok(applied, 'short subcall failure must be discarded');
  assert.equal(applied.mode, 'discard');
  assert.match(session.log[session.log.length - 1].data.message.content[0].text, /PTC 子调用已丢弃/);
});

test('autoCompressPtcSubcalls discards validate_dsh_ui subcall in multi-tool PTC even when outer text is short', () => {
  const session = new MockSession();
  session.id = 'test_ptc_multi_ui_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'multi' }] }, { surfaceOp: 'append' });
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_m', subCallId: 'rc_m:1', name: 'bash', isError: false, content: [{ type: 'text', text: 'total 10\nfile1\nfile2' }] }, {});
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_m', subCallId: 'rc_m:2', name: 'validate_dsh_ui', isError: false, content: [{ type: 'text', text: '[genui-validation]\nstatus=valid' }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'rc_m' }, content: [{ type: 'text', text: 'Short.' }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(4), { minChars: 4000, discardTools: ['validate_dsh_ui'] });
  assert.ok(applied, 'validate_dsh_ui subcall must be discarded despite short outer text');
  assert.equal(applied.mode, 'replace');
  const text = session.log[session.log.length - 1].data.message.content[0].text;
  assert.match(text, /- validate_dsh_ui: \[discarded by policy\]/);
  assert.match(text, /- bash: total 10/);
});

test('autoCompressPtcSubcalls uses prefix truncation (mode=truncate, keeping first N lines) for multi-line oversized output', () => {
  const session = new MockSession();
  session.id = 'test_ptc_trunc_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'multi-line ptc' }] }, { surfaceOp: 'append' });
  const multiLineOut = Array.from({ length: 80 }, (_, i) => 'line_' + (i + 1) + ': ' + 'a'.repeat(60)).join('\n');
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_ml', subCallId: 'rc_ml:1', name: 'grep', isError: false, content: [{ type: 'text', text: multiLineOut }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'rc_ml' }, content: [{ type: 'text', text: multiLineOut }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 1000, keepLines: 10 });
  assert.ok(applied, 'multi-line PTC output should be compressed');
  assert.equal(applied.mode, 'truncate', 'must use prefix truncation instead of full replace');
  assert.equal(applied.keepLines, 10, 'must preserve first 10 lines');
  const newText = session.log[session.log.length - 1].data.message.content[0].text;
  assert.ok(newText.startsWith('line_1: '), 'prefix is preserved byte-for-byte from index 0');
  assert.match(newText, /line_10: /, '10th line is preserved');
  assert.ok(!/line_11: /.test(newText), '11th line is truncated');
  assert.match(newText, /mode=truncate/, 'marker records mode=truncate');
});

test('autoCompressPtcSubcalls detects plain text exit code in subcall dispatch', () => {
  const session = new MockSession();
  session.id = 'test_ptc_text_exit_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'text exit' }] }, { surfaceOp: 'append' });
  session.seed('tool/ptc-dispatch', { rootCallId: 'rc_te', subCallId: 'rc_te:1', name: 'bash', isError: false, content: [{ type: 'text', text: 'command failed\n[exit code: 1]' }] }, {});
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'run_code', callId: 'rc_te' }, content: [{ type: 'text', text: 'done' }] } }, { surfaceOp: 'append' });
  const applied = autoCompressPtcSubcalls(session, session.eventAt(3), { minChars: 200, discardFailed: true });
  assert.ok(applied, 'plain text exit code in subcall must be detected and discarded');
  assert.equal(applied.mode, 'discard');
});
