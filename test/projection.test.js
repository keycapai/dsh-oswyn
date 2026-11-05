import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneToolCallArgs } from '../lib/core/projection.js';

function bigMsg(argsMode) {
  const big = 'x'.repeat(5000);
  const args = argsMode === 'string'
    ? JSON.stringify({ code: big, note: 'keep me', n: 1 })
    : { code: big, note: 'keep me', n: 1 };
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: 'thinking' },
      { type: 'tool-call', id: 'c1', name: 'run_code', arguments: args },
      { type: 'text', text: 'after' }
    ]
  };
}

test('prunes oversized code in string arguments', () => {
  const msg = bigMsg('string');
  const out = pruneToolCallArgs(msg);
  const call = out.content.find((b) => b.type === 'tool-call');
  const args = JSON.parse(call.arguments);
  assert.ok(args.code.length < 200);
  assert.match(args.code, /已折叠/);
  assert.equal(args.note, 'keep me');
  assert.equal(args.n, 1);
  // other blocks untouched
  assert.equal(out.content[0].text, 'thinking');
  assert.equal(out.content[2].text, 'after');
});

test('prunes oversized code in object arguments', () => {
  const msg = bigMsg('object');
  const out = pruneToolCallArgs(msg);
  const call = out.content.find((b) => b.type === 'tool-call');
  assert.ok(call.arguments.code.length < 200);
  assert.equal(call.arguments.note, 'keep me');
});

test('does not mutate the original message', () => {
  const msg = bigMsg('string');
  const originalCode = JSON.parse(msg.content[1].arguments).code;
  pruneToolCallArgs(msg);
  assert.equal(JSON.parse(msg.content[1].arguments).code, originalCode);
});

test('idempotent: second pass is a no-op (same reference)', () => {
  const msg = bigMsg('object');
  const once = pruneToolCallArgs(msg);
  const twice = pruneToolCallArgs(once);
  assert.equal(twice, once, 'idempotent pass should return the same object');
});

test('strictly shorter after pruning', () => {
  const msg = bigMsg('string');
  const out = pruneToolCallArgs(msg);
  const beforeLen = JSON.stringify(msg).length;
  const afterLen = JSON.stringify(out).length;
  assert.ok(afterLen < beforeLen);
});

test('respects custom thresholds', () => {
  const msg = {
    role: 'assistant',
    content: [{ type: 'tool-call', arguments: { code: 'y'.repeat(300) } }]
  };
  const untouched = pruneToolCallArgs(msg, { maxCodeLen: 1000 });
  assert.equal(untouched, msg, 'below threshold: unchanged reference');
  const touched = pruneToolCallArgs(msg, { maxCodeLen: 50 });
  assert.notEqual(touched, msg);
});

test('spec field is pruned too', () => {
  const msg = {
    role: 'assistant',
    content: [{ type: 'tool-call', arguments: { spec: 'z'.repeat(4000) } }]
  };
  const out = pruneToolCallArgs(msg, { maxSpecLen: 100 });
  assert.match(out.content[0].arguments.spec, /spec 已折叠/);
});

test('non tool-call message returned unchanged', () => {
  const msg = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] };
  assert.equal(pruneToolCallArgs(msg), msg);
});
