/**
 * End-to-end "what does the next request actually contain?" test.
 *
 * Request N is reconstructed from the surface before the assistant message;
 * OSWYN applies a tool-result fence; request N+1 is reconstructed again.
 * Proves: (a) every pre-existing message is byte-identical (KV-cache prefix),
 * (b) only the targeted tool result changes, (c) the compressed marker is what
 * the provider receives — not merely a ledger number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { applyFromAssistantMessage } from '../lib/session/applier.js';

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

test('request N -> request N+1: prefix byte-identical, only target tool result replaced', () => {
  const session = new MockSession();
  session.seed('system/message', { message: { role: 'system', content: [{ type: 'text', text: 'you are helpful' }] } }, { surfaceOp: 'append' });
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'read the big file' }] }, { surfaceOp: 'append' });
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [
      { type: 'text', text: 'Reading now.' },
      { type: 'tool-call', callId: 'c1', name: 'read', arguments: '{"path":"big.txt"}' }
    ] }
  }, { surfaceOp: 'append' });
  const raw = Array.from({ length: 80 }, (_, i) => 'LINE-' + String(i) + '-' + 'x'.repeat(240) + '-END').join('\n');
  session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'read', callId: 'c1' }, content: [{ type: 'text', text: raw }] }
  }, { surfaceOp: 'append', sourceEventSeqs: [2] });

  const requestN = session.deriveMessages();
  assert.equal(requestN.length, 4);
  assert.equal(textOf(requestN[3]), raw);

  // The assistant response that carries the agent's own fence.
  const fenceText = '```dsh-result-summary\nseq 3\ntruncate keep 5 lines\n- file has one header and one footer\n```';
  const assistant = { role: 'assistant', content: [{ type: 'text', text: fenceText }] };
  const res = applyFromAssistantMessage(session, assistant, 4, { replySummaryEnabled: true });
  assert.ok(res.applied.some((r) => r.seq === 3 && r.mode === 'truncate'), res.rejected.join(' | '));

  // Append the assistant message itself, as the agent loop does after the model returns it.
  session.append('assistant/message', { message: assistant }, { surfaceOp: 'append' });

  const requestN1 = session.deriveMessages();
  assert.equal(requestN1.length, 5, 'one new assistant message, tool result replaced in place');
  // (a) Every pre-existing message before the tool result is byte-identical.
  for (let i = 0; i < 3; i++) assert.equal(textOf(requestN1[i]), textOf(requestN[i]), 'message ' + i + ' prefix unchanged');
  // (b) Only the target tool result changed, and its replacement is the real projected content.
  const toolMsg = requestN1[3];
  assert.ok(textOf(toolMsg).startsWith('LINE-'), 'truncate keeps the original prefix from byte 0');
  assert.match(textOf(toolMsg), /\[oswyn-meta: before=\d+ after=\d+ keep=\d+ mode=truncate seq=3\]/);
  assert.ok(textOf(toolMsg).length < raw.length, 'request N+1 is strictly smaller');
  // (c) The new assistant message (the fence response) is present.
  assert.equal(textOf(requestN1[4]), fenceText);
});
