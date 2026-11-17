import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findAllSummaryBlocks,
  findSummaryBlock,
  findReplySummaryBlock,
  parseSummaryBody,
  parseReplySummaryBody,
  normalizeFenceForms
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

test('findSummaryBlock locates prefix-free result-summary and supports mixed legacy fences', () => {
  const text = [
    '```dsh-result-summary',
    'truncate keep 5 lines',
    '- legacy block',
    '```',
    '```result-summary',
    'replace',
    '- new block without dsh prefix',
    '```'
  ].join('\n');

  const all = findAllSummaryBlocks(text);
  assert.equal(all.length, 2, 'Should find both legacy and prefix-free blocks');

  const last = findSummaryBlock(text);
  assert.ok(last);
  assert.match(last.body, /new block without dsh prefix/);

  const replyText = 'prose\n```reply-summary\n- prefix-free reply memo\n```';
  const replyBlock = findReplySummaryBlock(replyText);
  assert.ok(replyBlock);
  assert.match(replyBlock.body, /prefix-free reply memo/);
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

// The nudge used to advertise the XML form, and models do emit it. It must compress,
// otherwise the fence silently does nothing and the user sees no compression at all.
test('XML-style fences parse exactly like fenced blocks', () => {
  const discard = findAllSummaryBlocks('<result-summary mode="discard">事实摘要</result-summary>');
  assert.equal(discard.length, 1);
  const d = parseSummaryBody(discard[0].rawHeader, discard[0].body);
  assert.equal(d.mode, 'discard');
  assert.equal(d.explicitMode, 'discard');
  assert.equal(d.fact, '事实摘要');

  const keep = findAllSummaryBlocks('<result-summary mode="truncate keep 20 lines">\n- 要点\n</result-summary>');
  const k = parseSummaryBody(keep[0].rawHeader, keep[0].body);
  assert.equal(k.mode, 'truncate');
  assert.equal(k.keepCount, 20);
  assert.equal(k.keepUnit, 'lines');

  const legacy = findAllSummaryBlocks('<dsh-result-summary mode="replace">- 要点</dsh-result-summary>');
  assert.equal(legacy.length, 1);
  assert.equal(parseSummaryBody(legacy[0].rawHeader, legacy[0].body).mode, 'replace');

  // reply XML still routes through the reply scanner
  const reply = findReplySummaryBlock('<reply-summary>- 备忘</reply-summary>');
  assert.ok(reply);
  assert.equal(parseReplySummaryBody(reply.rawHeader, reply.body).summary, '- 备忘');

  // normalization is idempotent and leaves plain prose untouched
  assert.equal(normalizeFenceForms('没有围栏的正文'), '没有围栏的正文');
  assert.ok(normalizeFenceForms('<result-summary mode="discard">x</result-summary>').includes('\u0060\u0060\u0060result-summary'));
});

test('seq= form targets the given node', () => {
  const blocks = findAllSummaryBlocks('\u0060\u0060\u0060result-summary\nreplace seq=443\n- 要点\n\u0060\u0060\u0060');
  assert.equal(parseSummaryBody(blocks[0].rawHeader, blocks[0].body).targetSeq, 443);
});

