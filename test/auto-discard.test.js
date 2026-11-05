import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { autoDiscardToolResult, isCallArgDiscarded } from '../lib/session/applier.js';

function makeSession(text, { toolName = 'bash', isError = false } = {}) {
  const session = new MockSession();
  session.id = 'test_auto_discard_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName, callId: 'c1' }, isError, content: [{ type: 'text', text }] }
  }, { surfaceOp: 'append' });
  return session;
}

test('autoDiscardToolResult discards failed calls (including exit code 1)', () => {
  const session = makeSession('Command failed: exit code 1\n' + 'stack\n'.repeat(50), { isError: true });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied);
  assert.equal(applied.mode, 'discard');
  assert.equal(applied.trigger, 'auto');
  assert.equal(isCallArgDiscarded(session, 'c1'), true, 'discarded call arguments are marked for projection');
  const last = session.log[session.log.length - 1];
  assert.equal(last.type, 'tool/result');
  assert.match(last.data.message.content[0].text, /\[oswyn-meta: .*mode=discard/);
  assert.match(last.data.message.content[0].text, /Execution failed/);
});

test('autoDiscardToolResult discards failed output even when it is below the normal compression threshold', () => {
  const session = makeSession('Error: boom\n' + 'stack line\n'.repeat(30), { isError: true });
  const applied = autoDiscardToolResult(session, session.eventAt(2), { minChars: 4000 });
  assert.ok(applied, 'failure branch ignores size threshold');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult honors forceTools regardless of length and success', () => {
  const session = makeSession('Validation passed with no findings', { toolName: 'validate_dsh_ui', isError: false });
  const applied = autoDiscardToolResult(session, session.eventAt(2), { forceTools: ['validate_dsh_ui'] });
  assert.ok(applied, 'force-listed tool must be discarded regardless of length');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult leaves ordinary successful output alone', () => {
  const session = makeSession('ok, 12 passed', { toolName: 'bash', isError: false });
  assert.equal(autoDiscardToolResult(session, session.eventAt(2), {}), null);
});

test('autoDiscardToolResult uses an English failure fact and skips JSON braces', () => {
  const session = makeSession('{"error":"bad request","message":"invalid spec","stack":"' + 'x'.repeat(800) + '"}', { isError: true });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied);
  assert.match(applied.fact, /^Execution failed; full output omitted: bad request/);
  assert.ok(!/：\{/.test(applied.fact), 'fact must not end at an opening JSON brace');
});

test('autoDiscardToolResult does not discard a successful long output that merely mentions Error:', () => {
  const session = makeSession('Error: simulated message inside a successful log\n' + 'normal line\n'.repeat(500), { isError: false });
  assert.equal(autoDiscardToolResult(session, session.eventAt(2), {}), null);
});

test('autoDiscardToolResult treats a real bash [exit code: 1] marker as failure', () => {
  const session = makeSession(Array.from({ length: 100 }, (_, i) => 'line ' + i).join('\n') + '\n[exit code: 1]', { isError: false });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'exit-code marker should be detected');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult discards short PTC Error: code run failed without long stack', () => {
  const session = makeSession('Error: code run failed (exception): Unterminated template\nFile sandbox: danger-full-access.', { toolName: 'run_code', isError: true });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'short run_code failure must be discarded');
  assert.equal(applied.mode, 'discard');
  assert.equal(applied.toolName, 'run_code');
  assert.match(applied.fact, /Error: code run failed/);
  const last = session.log[session.log.length - 1];
  assert.match(last.data.message.content[0].text, /\[oswyn-meta: .*mode=discard/);
  assert.match(last.data.message.content[0].text, /Execution failed; full output omitted: Error: code run failed/);
});

test('autoDiscardToolResult discards PTC deadline timeout error regardless of length', () => {
  const session = makeSession('Error: code run failed (timeout): execution deadline reached (120000ms)\nFile sandbox: danger-full-access.', { toolName: 'run_code', isError: true });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'timeout failure must be discarded');
  assert.equal(applied.mode, 'discard');
  assert.equal(applied.toolName, 'run_code');
  assert.match(applied.fact, /execution deadline reached/);
});

test('autoDiscardToolResult discards exit code when trailing sandbox lines follow', () => {
  const session = makeSession('Command failed\n[exit code: 1]\nFile sandbox: danger-full-access.', { toolName: 'bash' });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'exit code followed by sandbox line must be discarded');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult discards negative exit codes [exit code: -1]', () => {
  const session = makeSession('Process killed\n[exit code: -1]', { toolName: 'bash' });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'negative exit code must be discarded');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult discards output with JS object format exitCode', () => {
  const session = makeSession("{\n  kind: 'foreground',\n  exitCode: 1,\n  stderr: 'error'\n}", { toolName: 'bash' });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.ok(applied, 'JS object exitCode must be discarded');
  assert.equal(applied.mode, 'discard');
});

test('autoDiscardToolResult discards native validate_dsh_ui via callId or content recognition', () => {
  const session = new MockSession();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'validate ui' }] }, { surfaceOp: 'append' });
  session.seed('tool/call', {
    turn: 1,
    step: 1,
    callId: 'call_ui_test',
    name: 'validate_dsh_ui',
    arguments: '{"spec":"{}"}'
  }, {});
  session.seed('tool/result', {
    message: {
      role: 'tool',
      source: { kind: 'tool', callId: 'call_ui_test' },
      toolCallId: 'call_ui_test',
      content: [{ type: 'text', text: '[genui-validation]\nstatus=valid\nrendered=4' }],
      isError: false
    }
  }, { surfaceOp: 'append' });
  const applied = autoDiscardToolResult(session, session.eventAt(3), { forceTools: ['validate_dsh_ui'] });
  assert.ok(applied, 'native validate_dsh_ui must be auto-discarded');
  assert.equal(applied.mode, 'discard');
  assert.equal(applied.toolName, 'validate_dsh_ui');
});

test('autoDiscardToolResult discards exit code 128 in various formats', () => {
  // Format 1: bracketed exit code 128
  const session1 = makeSession('fatal: destination path already exists\n[exit code: 128]\nFile sandbox: danger-full-access.', { toolName: 'bash' });
  const applied1 = autoDiscardToolResult(session1, session1.eventAt(2), {});
  assert.ok(applied1, 'exit code 128 must be discarded');
  assert.equal(applied1.mode, 'discard');

  // Format 2: unbracketed exit code 128
  const session2 = makeSession('git error\ncommand failed with exit code 128', { toolName: 'bash' });
  const applied2 = autoDiscardToolResult(session2, session2.eventAt(2), {});
  assert.ok(applied2, 'unbracketed exit code 128 must be discarded');
  assert.equal(applied2.mode, 'discard');

  // Format 3: exit status 128
  const session3 = makeSession('process exited with status 128', { toolName: 'bash' });
  const applied3 = autoDiscardToolResult(session3, session3.eventAt(2), {});
  assert.ok(applied3, 'exit status 128 must be discarded');
  assert.equal(applied3.mode, 'discard');

  // Format 4: string quoted exitCode '128' in JSON/object
  const session4 = makeSession('{\n  "exitCode": "128",\n  "stderr": "error"\n}', { toolName: 'bash' });
  const applied4 = autoDiscardToolResult(session4, session4.eventAt(2), {});
  assert.ok(applied4, 'quoted string exitCode 128 must be discarded');
  assert.equal(applied4.mode, 'discard');
});

test('autoDiscardToolResult leaves exit code 0 alone', () => {
  const session = makeSession('Build succeeded\n[exit code: 0]', { toolName: 'bash' });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.equal(applied, null, 'exit code 0 must not be discarded');
});

test('autoDiscardToolResult does NOT false-positive on markdown tables or prose mentioning exit code 1', () => {
  const mdTable = '1: # Appendix\n41: | **04** | T04-VaultBug | 密钥库并发碰撞缺陷排错 | 捕获 `NonceCollisionException` | 捕获 exit code 1 失败堆栈 |\n';
  const session = makeSession(mdTable, { toolName: 'run_code', isError: false });
  const applied = autoDiscardToolResult(session, session.eventAt(2), {});
  assert.equal(applied, null, 'prose/table mentioning exit code 1 must not be treated as a failed tool call');
});

test('autoDiscardToolResult counts discarded tool-call input arguments (inputChars) in before and marker', () => {
  const session = new MockSession();
  session.id = 'test_discard_input_' + Date.now();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'run' }] }, { surfaceOp: 'append' });
  const callArgs = JSON.stringify({ description: 'Inspect session with python', code: 'x'.repeat(600) });
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call_py_err', name: 'run_code', arguments: callArgs }] }
  }, { surfaceOp: 'append' });
  session.seed('tool/call', { callId: 'call_py_err', name: 'run_code', arguments: callArgs }, {});
  const outText = "Error: code run failed (exception): Expected ',', got 'import'\nFile sandbox: danger-full-access.";
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'run_code', callId: 'call_py_err' }, isError: true, content: [{ type: 'text', text: outText }] }
  }, { surfaceOp: 'append' });

  const applied = autoDiscardToolResult(session, session.eventAt(4), {});
  assert.ok(applied, 'failed run_code should be discarded');
  assert.equal(applied.inputChars, callArgs.length, 'inputChars equals the discarded tool-call arguments length');
  assert.equal(applied.before, outText.length + callArgs.length, 'before includes both tool-call input and tool-result output');
  assert.ok(applied.after < applied.before, 'after is strictly smaller than total before');
  assert.equal(isCallArgDiscarded(session, 'call_py_err'), true);
});
