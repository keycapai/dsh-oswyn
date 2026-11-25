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

import { appendEvent, loadSession, recordRecall, deriveEntry, loadAllSessions, recordSessionTurn } from '../lib/store/ledger.js';
import { computeMetrics, computeSessionMetrics, entryAccounting, entryMetrics } from '../lib/store/metrics.js';
import { requestsAliveFrom } from '../lib/store/requests.js';

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

test('recordSessionTurn records the highest round only (never regresses)', () => {
  const sid = 'sess_rounds';
  assert.equal(recordSessionTurn(sid, 3), 3);
  assert.equal(recordSessionTurn(sid, 2), 3); // a stale round must not roll it back
  assert.equal(recordSessionTurn(sid, 7), 7);
  assert.equal(loadSession(sid).turns, 7);
  // loadAllSessions() has its own reader — it must not drop the round counter,
  // otherwise global stats silently lose every round after the last compression.
  const all = loadAllSessions().find((s) => s.sessionId === sid);
  assert.equal(all.turns, 7);
});

test('computeMetrics cumulative: a compressed row keeps saving on every later round', () => {
  const sid = 'sess_cumulative';
  // round 2: 7000 -> 700 chars
  appendEvent(sid, { seq: 10, turn: 2, mode: 'truncate', before: 7000, after: 700, keepChars: 100 });
  recordSessionTurn(sid, 5);
  // round 5: 700 -> 70 chars
  appendEvent(sid, { seq: 40, turn: 5, mode: 'discard', before: 700, after: 70 });
  recordSessionTurn(sid, 5);

  const m = computeSessionMetrics(loadSession(sid));
  const row1 = tok(7000 - 700);
  const row2 = tok(700 - 70);
  assert.equal(m.totalTokensSaved, row1 + row2);       // one-shot sum: unchanged meaning
  assert.equal(m.standingTokensSaved, row1 + row2);    // per-round rate equals the compressed bytes
  assert.equal(m.multiTurnRows, 1);                    // only row1 has survived extra rounds
  assert.equal(m.cumulativeTokensSaved, row1 * 4 + row2 * 1); // rounds 2..5 for row1, round 5 for row2
  assert.equal(m.avgRoundsPerRow, 2.5);                // (4 + 1) / 2
});

test('computeMetrics cumulative: rows from before round-stamping count as one round', () => {
  const sid = 'sess_legacy_rows';
  appendEvent(sid, { seq: 1, mode: 'truncate', before: 3500, after: 500 }); // no turn stamp
  recordSessionTurn(sid, 40); // session is far ahead, must NOT inflate old rows
  const m = computeSessionMetrics(loadSession(sid));
  assert.equal(m.cumulativeTokensSaved, m.totalTokensSaved);
  assert.equal(m.multiTurnRows, 0);
});

test('computeMetrics cumulative net charges summary + recall exactly once', () => {
  const sid = 'sess_cumulative_net';
  appendEvent(sid, { seq: 1, turn: 1, mode: 'truncate', before: 3500, after: 500, keepChars: 100, summary: 's'.repeat(700) });
  recordSessionTurn(sid, 3);
  recordRecall(sid, 700);
  const m = computeSessionMetrics(loadSession(sid));
  assert.equal(m.cumulativeNetTokensSaved, m.cumulativeTokensSaved - m.totalExtraSummaryTokens - m.totalRecallTokens);
  assert.ok(m.cumulativeNetTokensSaved > m.totalNetTokensSaved, 'multi-round net must exceed the one-shot net');
});

test('requestsAliveFrom counts model round-trips at or after a row', () => {
  assert.equal(requestsAliveFrom([1, 5, 9], 2), 2);   // 5, 9 already carried the reduction
  assert.equal(requestsAliveFrom([1, 5, 9], 5), 2);   // the compressing request itself counts
  assert.equal(requestsAliveFrom([1, 5, 9], 9), 1);
  assert.equal(requestsAliveFrom([1, 5, 9], 10), 0);  // compressed after the session ended
  assert.equal(requestsAliveFrom([], 3), 0);
});

test('cumulative uses the request log so each round-trip re-counts the saving', () => {
  const row = { seq: 2, mode: 'truncate', before: 7000, after: 700 };
  const live = { sessionId: 'req', updatedAt: Date.now(), turns: 1, requestSeqs: [1, 5, 9], entries: [row] };
  const m = computeMetrics([live], { now: Date.now() });
  const one = tok(6300);
  assert.equal(m.totalTokensSaved, one);              // 累计节省: every tool+reply reduction, once
  assert.equal(m.cumulativeTokensSaved, one * 2);     // requests 5 and 9 re-save it
  assert.equal(m.requestBasedRows, 1);
  assert.equal(m.totalRequests, 3);
  // Without a request log the multiplier degrades to the turn-based floor (never inflated).
  const noLog = computeMetrics([{ ...live, requestSeqs: null }], { now: Date.now() });
  assert.equal(noLog.cumulativeTokensSaved, one);
  assert.equal(noLog.requestBasedRows, 0);
});

test('standing splits into active (live) vs archived (finished) sessions', () => {
  const now = Date.now();
  const live = { sessionId: 'live', updatedAt: now, turns: 2, entries: [{ seq: 1, turn: 2, mode: 'truncate', before: 7000, after: 700 }] };
  const dead = { sessionId: 'dead', updatedAt: now - 40 * 24 * 3600 * 1000, turns: 9, entries: [{ seq: 1, turn: 2, mode: 'truncate', before: 7000, after: 700 }] };
  const m = computeMetrics([live, dead], { now, activeWindowMs: 6 * 3600 * 1000 });
  const one = tok(6300);
  assert.equal(m.standingTokensSaved, one * 2);      // stock: every session ever
  assert.equal(m.activeStandingTokensSaved, one);    // per-round: only sessions still alive
  assert.equal(m.archivedStandingTokensSaved, one);  // closed sessions never count as "per round"
  assert.equal(m.activeSessions, 1);
  // elapsed rounds stay per-session: live row 2..2 = 1, dead row 2..9 = 8
  assert.equal(m.cumulativeTokensSaved, one * 1 + one * 8);
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

test('computeMetrics: avgSavingsRate includes turn-level deep distillation', () => {
  const deepOnly = {
    sessionId: 'deep_only',
    updatedAt: Date.now(),
    turns: 4,
    entries: [],
    distill: {
      events: 1,
      rawTokens: 20000,
      distTokens: 4000,
      surplusTokens: 16000,
      cumulativeSaved: 16000,
      turns: {
        1: { reason: 'volume', rawTokens: 10000, distTokens: 1000, surplusTokens: 9000, seq: 10 },
        2: { reason: 'volume', rawTokens: 10000, distTokens: 3000, surplusTokens: 7000, seq: 11 }
      }
    }
  };
  const m1 = computeMetrics([deepOnly], { now: Date.now() });
  assert.equal(m1.avgSavingsRate, 80, 'deep-only session must reflect 80% compression rate');
  assert.equal(m1.rowAvgSavingsRate, 0);

  const combined = {
    ...deepOnly,
    sessionId: 'deep_and_step',
    entries: [{ seq: 2, turn: 1, mode: 'truncate', before: 10000, after: 5000 }] // 50% step-level
  };
  const m2 = computeMetrics([combined], { now: Date.now() });
  assert.equal(m2.rowAvgSavingsRate, 50);
  assert.ok(m2.avgSavingsRate > 70 && m2.avgSavingsRate < 80, 'combined rate blends step-level and turn-level distillation');
});

test('computeMetrics: distillCumulativeSaved accumulates across every subsequent model request round-trip', () => {
  const sess = {
    sessionId: 'deep_req_cum',
    updatedAt: Date.now(),
    turns: 5,
    // Requests at seq 5, 10, 15, 20, 25, 30
    requestSeqs: [5, 10, 15, 20, 25, 30],
    entries: [],
    distill: {
      events: 1,
      rawTokens: 20000,
      distTokens: 5000,
      surplusTokens: 15000,
      cumulativeSaved: 15000,
      lastSeq: 12,
      turns: {
        // Distilled at seq=12 -> stays out of context for requests 15, 20, 25, 30 (4 round-trips!)
        1: { reason: 'volume', rawTokens: 10000, distTokens: 2000, surplusTokens: 8000, seq: 12 },
        // Distilled at seq=22 -> stays out of context for requests 25, 30 (2 round-trips!)
        2: { reason: 'rounds', rawTokens: 10000, distTokens: 3000, surplusTokens: 7000, seq: 22 }
      }
    }
  };
  const m = computeMetrics([sess], { now: Date.now() });
  assert.equal(m.distillCumulativeSaved, 8000 * 4 + 7000 * 2, 'must multiply each distilled turn surplus by subsequent model requests');
});
