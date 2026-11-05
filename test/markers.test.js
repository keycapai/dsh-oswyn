import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMeta, parseMeta, hasMeta, MARKER_RE, MODES } from '../lib/core/markers.js';

test('encodeMeta produces canonical marker', () => {
  const s = encodeMeta({ before: 5000, after: 120, keep: 2000, mode: 'truncate', seq: 7 });
  assert.equal(s, '[oswyn-meta: before=5000 after=120 keep=2000 mode=truncate seq=7]');
});

test('round-trip: parseMeta(encodeMeta(x)) === x', () => {
  for (const meta of [
    { before: 100, after: 40, keep: 0, mode: 'replace', seq: 3 },
    { before: 9000, after: 800, keep: 7777, mode: 'truncate', seq: 'a1b2' },
    { before: 50, after: 10, keep: 0, mode: 'discard', seq: 'x' }
  ]) {
    const round = parseMeta('preamble\n' + encodeMeta(meta) + '\nbody');
    assert.deepEqual(round, {
      before: meta.before,
      after: meta.after,
      keep: meta.keep,
      mode: meta.mode,
      seq: String(meta.seq)
    });
  }
});

test('parseMeta returns null when absent', () => {
  assert.equal(parseMeta('just some text'), null);
  assert.equal(parseMeta(undefined), null);
  assert.equal(parseMeta(123), null);
});

test('questional values round-trip to null', () => {
  const s = encodeMeta({ mode: 'replace', seq: '?' });
  assert.equal(s, '[oswyn-meta: before=? after=? keep=? mode=replace seq=?]');
  const p = parseMeta(s);
  assert.equal(p.before, null);
  assert.equal(p.after, null);
  assert.equal(p.keep, null);
  assert.equal(p.seq, null);
});

test('invalid mode falls back to replace', () => {
  const s = encodeMeta({ before: 1, after: 1, keep: 1, mode: 'bogus', seq: 1 });
  assert.match(s, /mode=replace/);
});

test('MARKER_RE accepts every valid mode', () => {
  for (const mode of MODES) {
    const s = encodeMeta({ before: 10, after: 5, keep: 3, mode, seq: 2 });
    const m = s.match(MARKER_RE);
    assert.ok(m, 'should match for ' + mode);
    assert.equal(m[4], mode);
  }
});

test('hasMeta detects markers', () => {
  assert.equal(hasMeta('[oswyn-meta: before=1 after=1 keep=0 mode=replace seq=1]'), true);
  assert.equal(hasMeta('nope'), false);
});

test('hasMeta and parseMeta ignore markers inside quoted JSON/JS strings and prefer standalone marker lines', () => {
  const jsonReadOutput = '{\n  "line": "const s = \"[oswyn-meta: before=2400 after=350 keep=5 mode=truncate seq=1]\";",\n  "other": "hello"\n}';
  assert.equal(hasMeta(jsonReadOutput), false, 'hasMeta must ignore marker inside JSON string');
  const truncatedReadOutput = jsonReadOutput + '\n[oswyn-meta: before=48932 after=1200 keep=900 mode=truncate seq=88]\n[oswyn 尾部已截断]';
  assert.equal(hasMeta(truncatedReadOutput), true, 'hasMeta detects real standalone marker at tail');
  const parsed = parseMeta(truncatedReadOutput);
  assert.equal(parsed.before, 48932, 'parseMeta picks the standalone tail marker, not the quoted example');
  assert.equal(parsed.after, 1200);
  assert.equal(parsed.seq, '88');
});
