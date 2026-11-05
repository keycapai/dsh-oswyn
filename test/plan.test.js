import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, textLength } from '../lib/core/plan.js';
import { parseMeta } from '../lib/core/markers.js';
import { parseSummaryBody } from '../lib/core/parse.js';

function makeTarget(text) {
  return { seq: 3, event: { seq: 3, data: { message: { content: [{ type: 'text', text }] } } } };
}

const LONG = Array.from({ length: 200 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(20)).join('\n');

test('rejects tiny content (<20 chars)', () => {
  const p = plan(makeTarget('tiny'), parseSummaryBody('', 'replace\n- f'), 't');
  assert.ok(p.rejected);
  assert.equal(p.before, 'tiny'.length);
});

test('truncate: before == original length, prefix preserved byte-for-byte', () => {
  const parsed = parseSummaryBody('', 'truncate keep 10 lines\n- kept facts');
  const p = plan(makeTarget(LONG), parsed, 'bash');
  assert.equal(p.mode, 'truncate');
  assert.equal(p.before, LONG.length);
  const text = p.content[0].text;
  assert.ok(text.startsWith(LONG.slice(0, p.keepChars)), 'prefix must be byte-identical');
  assert.equal(p.keepLines, 10);
  assert.ok(!text.includes('tool_result_recall'), 'user-facing banner must not mention recall');
});

test('truncate: after == actual content text length (fixed point)', () => {
  const parsed = parseSummaryBody('', 'truncate keep 500 chars\n- facts');
  const p = plan(makeTarget(LONG), parsed, 'bash');
  assert.equal(p.after, textLength(p.content));
});

test('truncate: embedded marker parses back to same numbers', () => {
  const parsed = parseSummaryBody('', 'truncate keep 8 lines\n- facts');
  const p = plan(makeTarget(LONG), parsed, 'bash');
  const meta = parseMeta(p.content[0].text);
  assert.ok(meta);
  assert.equal(meta.mode, 'truncate');
  assert.equal(meta.before, p.before);
  assert.equal(meta.after, p.after);
  assert.equal(meta.keep, p.keepChars);
  assert.equal(meta.seq, '3');
});

test('replace: after == textLength and shrinks the content', () => {
  const parsed = parseSummaryBody('', 'replace\n- 搜索结果：0 匹配，文件不存在');
  const p = plan(makeTarget(LONG), parsed, 'grep');
  assert.equal(p.mode, 'replace');
  assert.equal(p.after, textLength(p.content));
  assert.ok(p.after < p.before);
  const meta = parseMeta(p.content[0].text);
  assert.equal(meta.mode, 'replace');
  assert.equal(meta.before, p.before);
  assert.ok(!p.content[0].text.includes('tool_result_recall'), 'user-facing banner must not mention recall');
});

test('discard: produces fact-only content with discard marker', () => {
  const parsed = parseSummaryBody('', 'discard\n- API 404，已弃用');
  const p = plan(makeTarget(LONG), parsed, 'http');
  assert.equal(p.mode, 'discard');
  assert.equal(p.after, textLength(p.content));
  const text = p.content[0].text;
  assert.match(text, /API 404/);
  const meta = parseMeta(text);
  assert.equal(meta.mode, 'discard');
  assert.ok(p.after < p.before);
});

test('content is content-blocks array of text', () => {
  const p = plan(makeTarget(LONG), parseSummaryBody('', 'replace\n- f'), 'x');
  assert.ok(Array.isArray(p.content));
  assert.equal(p.content[0].type, 'text');
  assert.equal(typeof p.content[0].text, 'string');
});

// ---- regression guards for the three reported OSWYN bugs ----

test('truncate: honours the requested N instead of a magic fallback', () => {
  const small = Array.from({ length: 40 }, (_, i) => 'row ' + i + ' ' + 'y'.repeat(10)).join('\n');
  for (const n of [3, 7, 25]) {
    const p = plan(makeTarget(small), parseSummaryBody('', 'truncate keep ' + n + ' lines\n- f'), 'bash');
    assert.equal(p.keepLines, n, 'keepLines must equal the requested ' + n);
    assert.notEqual(p.keepLines, 25 === n ? -1 : 25, 'must not collapse to 25');
  }
});

test('truncate: no implicit 50/2000 fallback when keep size is missing', () => {
  const p = plan(makeTarget(LONG), parseSummaryBody('', 'truncate\n- f'), 'bash');
  assert.ok(p.rejected, 'a bare truncate directive must be rejected, not defaulted');
  assert.equal(p.content, null);
});

test('truncate: keep N covering the whole output is rejected (no shrink)', () => {
  const p = plan(makeTarget(LONG), parseSummaryBody('', 'truncate keep 200 lines\n- f'), 'bash');
  assert.ok(p.rejected);
  assert.equal(p.content, null);
  assert.equal(p.after, p.before);
});

test('replace: never rewrites when the result would not shrink', () => {
  const tiny = 'abc def ghi jkl mno pqr stu vwx yz';
  const p = plan(makeTarget(tiny), parseSummaryBody('', 'replace\n- ' + tiny), 'x');
  assert.ok(p.rejected, 'a non-shrinking replace must be rejected');
  assert.equal(p.content, null);
});

test('parseSummaryBody: explicitMode reflects what the agent actually wrote', () => {
  assert.equal(parseSummaryBody('', 'truncate keep 5 lines\n- f').explicitMode, 'truncate');
  assert.equal(parseSummaryBody('', 'replace\n- f').explicitMode, 'replace');
  assert.equal(parseSummaryBody('', 'discard\n- f').explicitMode, 'discard');
  assert.equal(parseSummaryBody('', '- only facts, no directive').explicitMode, null);
});
