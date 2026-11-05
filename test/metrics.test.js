/**
 * Unit tests for dsh-oswyn store ledger + metrics.
 * Constructs ledger event sequences; asserts rates/totals/cumulative/truth-guard/recall.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate storage so tests never touch the user's real ledger.
const dir = mkdtempSync(join(tmpdir(), 'dsh-oswyn-ledger-'));
process.env.DSH_OSWYN_STORAGE_DIR = dir;

test.after(() => rmSync(dir, { recursive: true, force: true }));

import { appendEvent, loadSession, recordRecall, deriveEntry, loadAllSessions } from '../lib/store/ledger.js';
import { computeMetrics, computeSessionMetrics, entryAccounting, entryMetrics } from '../lib/store/metrics.js';

const CP = 3.5;
const tok = (chars) => Math.round(chars / CP);

test('deriveEntry: compression saves input tokens and charges the whole output block as extra', () => {
  const e = deriveEntry({ mode: 'truncate', before: 2400, after: 350, summary: 'x'.repeat(70), keepChars: 120 });
  assert.equal(e.compressed, true);
  assert.equal(e.tokensSaved, tok(2400 - 350)); // 586
  // extra = whole appended tail block (after - keepChars) = 350-120 = 230 -> 66
  assert.equal(e.extraSummaryTokens, tok(350 - 120));
  assert.equal(e.recallTokens, 0);
  assert.equal(e.net, tok(2050) - tok(230));
});

test('deriveEntry truth guard: after >= before books compressed:false, tokensSaved:0', () => {
  const e = deriveEntry({ mode: 'replace', before: 112, after: 185, summary: 'abc' });
  assert.equal(e.compressed, false);
  assert.equal(e.tokensSaved, 0);
  // after is clamped to before so we never claim a fake shrink
  assert.equal(e.after, 112);
  // net is still negative because the summary cost is real
  assert.equal(e.net, 0 - e.extraSummaryTokens);
});

test('deriveEntry: discard is a compress mode and honors truth guard', () => {
  const good = deriveEntry({ mode: 'discard', before: 900, after: 40, summary: 'fact' });
  assert.equal(good.compressed, true);
  assert.equal(good.tokensSaved, tok(860));
  const bad = deriveEntry({ mode: 'discard', before: 40, after: 60 });
  assert.equal(bad.compressed, false);
  assert.equal(bad.tokensSaved, 0);
});

test('appendEvent + loadSession round-trips and enforces max 300 entries', () => {
  const sid = 'sess_append';
  for (let i = 0; i < 305; i++) {
    appendEvent(sid, { seq: i, mode: 'truncate', before: 1000, after: 100 });
  }
  const s = loadSession(sid);
  assert.equal(s.entries.length, 300);
  // most recent kept (last appended seq = 304)
  assert.equal(s.entries[s.entries.length - 1].seq, 304);
});

test('recordRecall accumulates across turns (multi-turn cumulative)', () => {
  const sid = 'sess_recall';
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 2000, after: 200 });
  assert.equal(recordRecall(sid, 700), 700);
  assert.equal(recordRecall(sid, 350), 1050); // accumulated, not overwritten
  const s = loadSession(sid);
  assert.equal(s.recallChars, 1050);
});

test('computeMetrics: totals include saved + extra summary + recall, net subtracts both', () => {
  const sid = 'sess_totals';
  // action 1: big truncation, keep 100 chars, whole tail block is extra
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 3500, after: 500, keepChars: 100, summary: 's'.repeat(700) });
  // action 2: replacement, whole block (after=400) is extra
  appendEvent(sid, { seq: 2, mode: 'replace', before: 1400, after: 400, summary: '' });
  // recall: 700 chars re-injected across the session
  recordRecall(sid, 700);

  const ledger = loadSession(sid);
  const m = computeSessionMetrics(ledger);

  const saved1 = tok(3500 - 500); // 857
  const saved2 = tok(1400 - 400); // 286
  const extra = tok(500 - 100) + tok(400); // 114 + 114 (whole blocks)
  const recall = tok(700); // 200
  assert.equal(m.totalTokensSaved, saved1 + saved2);
  assert.equal(m.totalExtraSummaryTokens, extra);
  assert.equal(m.totalRecallTokens, recall);
  assert.equal(m.totalNetTokensSaved, (saved1 + saved2) - extra - recall);
  assert.equal(m.totalActions, 2);
  assert.equal(m.totalTruncations, 1);
  assert.equal(m.totalReplacements, 1);
});

test('computeMetrics: each metric is independent — avgSavingsRate does not stand in for a total', () => {
  const sid = 'sess_indep';
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 1000, after: 200, summary: '' });
  appendEvent(sid, { seq: 2, mode: 'truncate', before: 1000, after: 900, summary: '' }); // weak compression
  const m = computeSessionMetrics(loadSession(sid));
  // avgSavingsRate is aggregate of real reductions
  assert.equal(m.avgSavingsRate, Math.round(((1000 - 200) + (1000 - 900)) / 2000 * 1000) / 10);
  // totals still exact and not equal to the rate
  assert.equal(m.totalTokensSaved, tok(800) + tok(100));
  assert.ok(m.totalTokensSaved !== m.avgSavingsRate);
});

test('computeMetrics: cacheHitProtectionRate counts truncations/actions', () => {
  const sid = 'sess_cache';
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 1000, after: 100 });
  appendEvent(sid, { seq: 2, mode: 'truncate', before: 1000, after: 100 });
  appendEvent(sid, { seq: 3, mode: 'replace', before: 1000, after: 100 });
  const m = computeSessionMetrics(loadSession(sid));
  assert.equal(m.cacheHitProtectionRate, Math.round((2 / 3) * 1000) / 10); // 66.7
  assert.equal(m.totalTruncations, 2);
});

test('computeMetrics: distillRate uses explicit toolCalls denominator when supplied', () => {
  const sid = 'sess_rate';
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 1000, after: 100 });
  appendEvent(sid, { seq: 2, mode: 'replace', before: 1000, after: 100 });
  const m = computeMetrics([loadSession(sid)], { toolCalls: 8 });
  assert.equal(m.distilledActions, 2);
  assert.equal(m.totalToolCalls, 8);
  assert.equal(m.distillRate, Math.round((2 / 8) * 1000) / 10); // 25
});

test('computeMetrics: truth-guard rows contribute 0 saved in aggregates', () => {
  const sid = 'sess_guard_agg';
  appendEvent(sid, { seq: 1, mode: 'replace', before: 112, after: 185, summary: 'aa' }); // grows
  appendEvent(sid, { seq: 2, mode: 'truncate', before: 1000, after: 100, summary: '' });
  const m = computeSessionMetrics(loadSession(sid));
  // only the real truncation saves
  assert.equal(m.totalTokensSaved, tok(900));
  // growing row: extra = its summary block (2 chars); truncate row: extra = whole tail (100-0)
  assert.equal(m.totalExtraSummaryTokens, tok(2) + tok(100));
  assert.equal(m.compressedRows, 1);
});

test('computeMetrics: multi-turn absolute totals accumulate across many sessions', () => {
  for (let i = 0; i < 5; i++) {
    const sid = 'sess_multi_' + i;
    appendEvent(sid, { seq: 1, mode: 'truncate', before: 700, after: 140, summary: '' });
    appendEvent(sid, { seq: 2, mode: 'truncate', before: 700, after: 140, summary: '' });
    recordRecall(sid, 350);
  }
  // Filter to only the sessions this test created (other tests share the tmp dir).
  const mine = loadAllSessions().filter((s) => s.sessionId.startsWith('sess_multi_'));
  const m = computeMetrics(mine);
  assert.equal(m.totalSessions, 5);
  assert.equal(m.totalActions, 10);
  assert.equal(m.totalTokensSaved, 10 * tok(560));
  assert.equal(m.totalRecallTokens, 5 * tok(350));
  assert.equal(m.totalNetTokensSaved, m.totalTokensSaved - m.totalExtraSummaryTokens - m.totalRecallTokens);
});

test('entryMetrics: per-row savingsRate reflects real before-after', () => {
  const e = entryMetrics({ mode: 'truncate', before: 2400, after: 350 });
  assert.equal(e.savingsRate, Math.round(((2400 - 350) / 2400) * 1000) / 10);
  const bad = entryMetrics({ mode: 'replace', before: 100, after: 150 });
  assert.equal(bad.savingsRate, 0); // clamped: after->before
  assert.equal(bad.compressed, false);
});
