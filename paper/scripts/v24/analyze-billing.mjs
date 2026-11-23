#!/usr/bin/env node
/**
 * v2.4 Experiment A: Real server-side KV-cache behavior from production billing telemetry.
 *
 * Source: ~/.dsh/dsh-bill/records.jsonl (real API calls, per-call token accounting).
 * Goal: fit the empirical cache-hit ratio as a function of the inter-call idle gap,
 *       which is the physical basis for the TTL trigger tau, and measure the real
 *       steady-state cached-read vs uncached cost split.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(os.homedir(), '.dsh', 'dsh-bill', 'records.jsonl');
const raw = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);

const recs = [];
for (const line of raw) {
  let r;
  try { r = JSON.parse(line); } catch { continue; }
  const t = r.time ?? r.ts ?? r.timestamp;
  const input = r.inputTokens ?? 0;
  const cacheRead = r.cacheReadTokens ?? 0;
  const cacheWrite = r.cacheWriteTokens ?? 0;
  if (!t || input <= 0) continue;
  recs.push({
    t: typeof t === 'number' ? t : Date.parse(t),
    sessionId: r.sessionId ?? r.session ?? 'unknown',
    input, output: r.outputTokens ?? 0,
    cacheRead, cacheWrite,
    usd: r.usd ?? 0,
    base: r.base ?? null,
    model: r.model ?? 'unknown',
  });
}
recs.sort((a, b) => a.t - b.t);

// ---- per-session ordered calls, with idle gap to previous call in the same session
const bySession = new Map();
for (const r of recs) {
  if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
  bySession.get(r.sessionId).push(r);
}

const gaps = [];
for (const [, list] of bySession) {
  list.sort((a, b) => a.t - b.t);
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    const gapSec = (cur.t - prev.t) / 1000;
    if (gapSec < 0) continue;
    // Convention in this ledger: inputTokens = UNCACHED prompt tokens,
    // cacheReadTokens = cached prefix tokens. Total prompt = input + cacheRead.
    const prevTotal = prev.input + prev.cacheRead;
    const curTotal = cur.input + cur.cacheRead;
    const hitRatio = curTotal > 0 ? Math.min(1, cur.cacheRead / curTotal) : 0;
    gaps.push({ gapSec, prefixAvailable: prevTotal, hitRatio, cacheRead: cur.cacheRead, input: cur.input, total: curTotal });
  }
}

// ---- bucket the survival curve
const BUCKETS = [
  [0, 10], [10, 30], [30, 60], [60, 120], [120, 300], [300, 600],
  [600, 1800], [1800, 3600], [3600, 21600], [21600, 86400], [86400, Infinity],
];
function bucketize(rows) {
  return BUCKETS.map(([lo, hi]) => {
    const sel = rows.filter((g) => g.gapSec >= lo && g.gapSec < hi);
    if (!sel.length) return { lo, hi, n: 0, meanHit: null, medianHit: null, fullMissRate: null };
    const hits = sel.map((g) => g.hitRatio).sort((a, b) => a - b);
    const mean = hits.reduce((a, b) => a + b, 0) / hits.length;
    const med = hits[Math.floor(hits.length / 2)];
    const fullMiss = sel.filter((g) => g.hitRatio < 0.05).length / sel.length;
    return { lo, hi, n: sel.length, meanHit: +mean.toFixed(4), medianHit: +med.toFixed(4), fullMissRate: +fullMiss.toFixed(4) };
  });
}

// ---- global cost decomposition
const totInput = recs.reduce((a, r) => a + r.input, 0);
const totCacheRead = recs.reduce((a, r) => a + r.cacheRead, 0);
const totCacheWrite = recs.reduce((a, r) => a + r.cacheWrite, 0);
const totOutput = recs.reduce((a, r) => a + r.output, 0);
const totUsd = recs.reduce((a, r) => a + r.usd, 0);

// inputTokens already counts only the uncached portion in this ledger
const totUncached = totInput;
const totPrompt = totInput + totCacheRead;

// ---- per-call distribution of prompt size
const sizes = recs.map((r) => r.input + r.cacheRead).sort((a, b) => a - b);
function q(p) { return sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))]; }

const out = {
  source: FILE,
  calls: recs.length,
  sessions: bySession.size,
  timeRange: { from: new Date(recs[0].t).toISOString(), to: new Date(recs[recs.length - 1].t).toISOString() },
  tokens: {
    promptTotal: totPrompt, uncached: totUncached, cacheRead: totCacheRead,
    cacheWrite: totCacheWrite, output: totOutput,
    cacheHitRatioByTokens: +(totCacheRead / Math.max(1, totPrompt)).toFixed(4),
  },
  usd: { total: +totUsd.toFixed(4) },
  promptSizeQuantiles: { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99), max: q(0.9999) },
  idleGapSurvival: bucketize(gaps),
  pairs: gaps.length,
};

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expA-billing-cache-survival.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
