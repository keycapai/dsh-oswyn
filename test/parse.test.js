import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findAllSummaryBlocks,
  findSummaryBlock,
  findReplySummaryBlock,
  parseSummaryBody,
  parseReplySummaryBody
} from '../lib/core/parse.js';

test('findSummaryBlock finds the LAST result-summary block', () => {
  const text = [
    'reply prose',
    '```dsh-result-summary',
    'replace',
    '- first fact',
    '```',
    'more prose',
    '```dsh-result-summary',
    'truncate keep 20 lines',
    '- second fact',
    '```'
  ].join('\n');
  const block = findSummaryBlock(text);
  assert.ok(block);
  assert.equal(block.rawHeader, '');
  assert.match(block.body, /second fact/);
});

test('findAllSummaryBlocks returns every block', () => {
  const text = [
    '```dsh-result-summary',
    'discard',
    '- a',
    '```',
    '```dsh-result-summary',
    'seq 5 truncate keep 3 lines',
    '- b',
    '```'
  ].join('\n');
  const blocks = findAllSummaryBlocks(text);
  assert.equal(blocks.length, 2);
});

test('findSummaryBlock null when absent / non-string', () => {
  assert.equal(findSummaryBlock('nothing here'), null);
  assert.equal(findSummaryBlock(null), null);
});

test('findReplySummaryBlock locates reply block', () => {
  const text = 'prose\n```dsh-reply-summary\n- memo\n```';
  const b = findReplySummaryBlock(text);
  assert.ok(b);
  assert.match(b.body, /memo/);
});

test('parseSummaryBody: truncate keep N lines', () => {
  const r = parseSummaryBody('', 'truncate keep 20 lines\n- 3 passed');
  assert.equal(r.mode, 'truncate');
  assert.equal(r.keepCount, 20);
  assert.equal(r.keepUnit, 'lines');
  assert.equal(r.summary, '- 3 passed');
});

test('parseSummaryBody: truncate keep N chars', () => {
  const r = parseSummaryBody('', 'truncate keep 500 chars\n- fact');
  assert.equal(r.mode, 'truncate');
  assert.equal(r.keepCount, 500);
  assert.equal(r.keepUnit, 'chars');
});

test('parseSummaryBody: replace with seq + tool target', () => {
  const r = parseSummaryBody('', 'replace seq web_search\n- no results');
  assert.equal(r.mode, 'replace');
  assert.equal(r.targetTool, 'web_search');
  assert.equal(r.summary, '- no results');
});

test('parseSummaryBody: numeric seq target', () => {
  const r = parseSummaryBody('seq 42', 'replace\n- fact');
  assert.equal(r.targetSeq, 42);
});

test('parseSummaryBody: discard keeps fact', () => {
  const r = parseSummaryBody('', 'discard\n- 该 API 不存在，改用 parse.js');
  assert.equal(r.mode, 'discard');
  assert.equal(r.fact, '- 该 API 不存在，改用 parse.js');
  assert.equal(r.summary, r.fact);
});

test('parseSummaryBody: cascade + prune-call flags', () => {
  const r = parseSummaryBody('cascade', 'replace\n- fact');
  assert.equal(r.cascadePrune, true);
  assert.equal(r.pruneCall, false);

  const r2 = parseSummaryBody('prune-call', 'replace\n- fact');
  assert.equal(r2.pruneCall, true);
});

test('parseSummaryBody: stub-call implies pruneCall', () => {
  const r = parseSummaryBody('', 'stub-call\n- fact');
  assert.equal(r.stubCall, true);
  assert.equal(r.pruneCall, true);
});

test('parseReplySummaryBody parses body + optional seq', () => {
  const r = parseReplySummaryBody('seq 9', '- memo line');
  assert.equal(r.targetSeq, 9);
  assert.equal(r.summary, '- memo line');
  const r2 = parseReplySummaryBody('', '- only memo');
  assert.equal(r2.targetSeq, null);
});
