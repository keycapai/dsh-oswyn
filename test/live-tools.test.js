import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { collectLiveTools } from '../lib/server/routes.js';

test('collectLiveTools exposes every tool result size, including uncompressed rows', () => {
  const session = new MockSession();
  session.seed('system/message', { message: { role: 'system', content: [] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [] }, { surfaceOp: 'append' });
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'a' }, content: [{ type: 'text', text: 'uncompressed' }] } }, { surfaceOp: 'append' });
  session.seed('tool/result', { message: { role: 'tool', source: { toolName: 'bash', callId: 'b' }, content: [{ type: 'text', text: '[oswyn-meta: before=3906 after=129 keep=0 mode=discard seq=2]\n[oswyn 整段已丢弃]\n- failed' }] } }, { surfaceOp: 'append' });
  const tools = collectLiveTools(session);
  assert.deepEqual(tools.map((t) => t.callId), ['a', 'b']);
  assert.equal(tools[0].chars, 'uncompressed'.length);
  assert.equal(tools[0].before, 'uncompressed'.length);
  assert.equal(tools[1].before, 3906);
  assert.equal(tools[1].after, 129);
  assert.equal(tools[1].compressed, true);
});
