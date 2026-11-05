import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSummaryBody } from '../lib/core/parse.js';
import { applyFromAssistantMessage, autoCompressToolResult } from '../lib/session/applier.js';
import { MockSession } from './fixtures/mock-session.js';
import { loadProtectedTools } from '../lib/store/ledger.js';

function block(lines) {
  return '\u0060\u0060\u0060dsh-result-summary\n' + lines.join('\n') + '\n\u0060\u0060\u0060';
}

test('parse: protect and protect-tool directives are recognized', () => {
  const p1 = parseSummaryBody('', 'seq 12\nprotect\n- 源码关键内容');
  assert.equal(p1.mode, 'keep');
  assert.equal(p1.explicitMode, 'keep');
  assert.equal(p1.targetSeq, 12);
  assert.match(p1.summary, /源码/);

  const p2 = parseSummaryBody('', 'protect-tool bash\n- keep bash?');
  assert.equal(p2.protectTool, 'bash');
  assert.equal(p2.mode, 'keep');
});

test('applier: protect fence marks one result so autoCompress never rewrites it', () => {
  const session = new MockSession();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
  const original = Array.from({ length: 40 }, (_, i) => 'line-' + i + '-' + 'x'.repeat(80)).join('\n');
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: original }] } }, { surfaceOp: 'append' });
  const assistant = { role: 'assistant', content: [{ type: 'text', text: block(['seq 2', 'protect', '- keep this result']) }] };
  const result = applyFromAssistantMessage(session, assistant, 3, {});
  assert.deepEqual(result.protectedCalls.map((x) => x.seq), [2]);
  const event = session.eventAt(2);
  assert.equal(autoCompressToolResult(session, event, { minChars: 200, keepLines: 5 }), null, 'autoCompress must respect protect marker');
});

test('applier: protect-tool directive updates the runtime protected list', () => {
  const old = process.env.DSH_OSWYN_STORAGE_DIR;
  process.env.DSH_OSWYN_STORAGE_DIR = '/tmp/oswyn-protect-directive-test-' + Date.now();
  try {
    const session = new MockSession();
    session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
    session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'go' }] }, { surfaceOp: 'append' });
    session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } }, { surfaceOp: 'append' });
    const assistant = { role: 'assistant', content: [{ type: 'text', text: block(['protect-tool my_custom_tool', '- 需要保留原始输出']) }] };
    const result = applyFromAssistantMessage(session, assistant, 3, {});
    assert.deepEqual(result.protectedTools, ['my_custom_tool']);
    assert.ok(loadProtectedTools().includes('my_custom_tool'));
  } finally {
    if (old === undefined) delete process.env.DSH_OSWYN_STORAGE_DIR; else process.env.DSH_OSWYN_STORAGE_DIR = old;
  }
});
