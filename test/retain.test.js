/**
 * Tests for lib/session/retain.js retention policy:
 *   failed / exploratory → discard
 *   valuable             → keep
 *   medium / long        → truncate
 * Plus agent-directive overrides and groupDiscard span/fact assembly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRetention, groupDiscard, analyze } from '../lib/session/retain.js';

function makeTarget(seq, text, isError = false) {
  return {
    seq,
    text,
    event: {
      type: 'tool/result',
      seq,
      data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'c' + seq }, isError, content: [{ type: 'text', text }] } }
    }
  };
}

test('analyze() flags errors, empties, valuable outputs', () => {
  assert.equal(analyze('Traceback (most recent call last):\nSyntaxError: bad').isError, true);
  assert.equal(analyze('exitCode: 1\nboom').isError, true);
  assert.equal(analyze('no matches found').isEmpty, true);
  assert.equal(analyze('').isEmpty, true);
  assert.equal(analyze('12 passed\n0 failed in 0.3s').valuable, true);
});

test('failed output → discard, fact captures first error line', () => {
  const t = makeTarget(3, 'Traceback (most recent call last):\n  File "x"\nSyntaxError: bad syntax\n' + 'stack '.repeat(200), true);
  const d = decideRetention(t, {}, {});
  assert.equal(d.action, 'discard');
  assert.equal(d.mode, 'discard');
  assert.match(d.fact, /SyntaxError|失败|bash/i);
});

test('exploratory empty output → discard', () => {
  const t = makeTarget(4, 'no matches found for pattern foo');
  const d = decideRetention(t, {}, {});
  assert.equal(d.action, 'discard');
  assert.match(d.fact, /无有效返回|no/i);
});

test('valuable compact output → keep', () => {
  const t = makeTarget(5, 'Ran 12 tests\n12 passed, 0 failed in 0.42s');
  const d = decideRetention(t, {}, {});
  assert.equal(d.action, 'keep');
});

test('small non-valuable output below threshold → keep', () => {
  const t = makeTarget(6, 'just a short status line');
  const d = decideRetention(t, {}, {});
  assert.equal(d.action, 'keep');
});

test('medium/long useful output without explicit truncate directive → keep verbatim (never auto-truncate)', () => {
  const t = makeTarget(7, 'line of useful content\n'.repeat(200));
  const d = decideRetention(t, {}, {});
  assert.equal(d.action, 'keep');
});

test('explicit agent directive wins: discard', () => {
  const t = makeTarget(8, 'some long output\n'.repeat(100));
  const d = decideRetention(t, { mode: 'discard', fact: 'the interesting bit' }, {});
  assert.equal(d.action, 'discard');
  assert.equal(d.fact, 'the interesting bit');
});

test('explicit agent directive wins: truncate keep lines', () => {
  const t = makeTarget(9, 'a\nb\nc\n'.repeat(50));
  const d = decideRetention(t, { mode: 'truncate', keepUnit: 'lines', keepCount: 5 }, {});
  assert.equal(d.action, 'truncate');
  assert.equal(d.keepLines, 5);
});

test('groupDiscard folds several failed targets into one span + fact', () => {
  const targets = [
    makeTarget(3, 'Command failed with error x\n' + 'err '.repeat(100), true),
    makeTarget(4, 'no results returned'),
    makeTarget(5, 'Traceback (most recent call last):\nboom\n' + 'stack '.repeat(100), true)
  ];
  const g = groupDiscard(targets, {});
  assert.equal(g.ok, true);
  assert.equal(g.startSeq, 3);
  assert.equal(g.endSeq, 5);
  assert.equal(g.count, 3);
  assert.match(g.fact, /3 条/);
  assert.match(g.fact, /bash|失败|无有效返回/i);
});

test('groupDiscard rejects an empty set', () => {
  const g = groupDiscard([], {});
  assert.equal(g.ok, false);
});
