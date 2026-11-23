/**
 * v2.4 shared simulation engine (validated).
 *
 * Prefix-cache semantics
 * ----------------------
 * A server-side prefix cache credits a request only for the longest common prefix it
 * shares with the previously cached sequence. Re-projecting history (distillation)
 * rewrites that sequence, so the next call is a full miss. Hence a STICKY latch pays
 * exactly one reset, while an oscillating policy pays a reset on every switch.
 *
 * Trace model per real session (from Exp B):
 *   rawHist[i]   raw history tokens of turns 1..i-1   (excludes current turn i)
 *   distHist[i]  distilled history tokens of turns 1..i-1
 *   turnTokens[i] raw tokens of turn i
 * Surface sent at call i is  history + turnTokens[i], where history is
 *   distHist[i] when the latch is engaged, else rawHist[i].
 */
import fs from 'node:fs';
import path from 'node:path';

export const PRICE = { uncached: 0.150 / 1e6, cacheRead: 0.003 / 1e6 };

// [upperGapSeconds, hitProbability] measured on 6,576 production calls (Exp A)
export const SURVIVAL = [
  [10, 0.930], [30, 0.769], [60, 0.842], [120, 0.861], [300, 0.808],
  [600, 0.736], [1800, 0.632], [3600, 0.500], [21600, 0.181], [86400, 0.023], [Infinity, 0.0],
];
export function hitProb(gapSec) { for (const [hi, p] of SURVIVAL) if (gapSec < hi) return p; return 0; }

// [gapSeconds, probabilityMass] measured on the same production ledger
export const GAP_MIX = [
  [3, 0.62], [15, 0.16], [45, 0.09], [90, 0.05], [240, 0.04],
  [900, 0.02], [3600, 0.012], [21600, 0.006], [86400, 0.002],
];
export function sampleGap(rng) { const u = rng(); let a = 0; for (const [g, p] of GAP_MIX) { a += p; if (u <= a) return g; } return 86400; }

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadCurves() {
  const DATA = path.join(process.cwd(), 'paper', 'data', 'v24', 'expB-transcript-curves.json');
  return JSON.parse(fs.readFileSync(DATA, 'utf8')).curves;
}

export function loadTtft() {
  let TTFT = { a: 1525.9, b: 0.0088718 };
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'paper', 'data', 'v24', 'expC-ttft-live.json'), 'utf8'));
    const rows = c.rows.filter((r) => r.promptTokens > 0);
    const bySize = new Map();
    for (const r of rows) {
      if (!bySize.has(r.promptTokens)) bySize.set(r.promptTokens, []);
      bySize.get(r.promptTokens).push(r.wallMs);
    }
    const pts = [...bySize.entries()].map(([x, ys]) => { ys.sort((p, q) => p - q); return [x, ys[Math.floor(ys.length / 2)]]; });
    if (pts.length >= 4) {
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p[0], 0);
      const sy = pts.reduce((a, p) => a + p[1], 0);
      const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
      const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
      const den = n * sxx - sx * sx;
      if (den) {
        const b = (n * sxy - sx * sy) / den;
        const a = (sy - b * sx) / n;
        if (b > 0) TTFT = { a: +a.toFixed(1), b: +b.toFixed(7) };
      }
    }
  } catch { /* defaults */ }
  return TTFT;
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * cfg:
 *   policy   'none' | 'ttl' | 'volume' | 'rounds' | 'ratio' | 'hybrid'
 *   tauTtl   seconds
 *   V        absolute removable (surplus) tokens
 *   rho      history inflation factor rawHist/distHist
 *   R        max undistilled rounds
 *   coalesce execute an armed reset only on a naturally cold call
 *   Vhard    forced ceiling on the raw surface (tokens)
 *   minSurplus floor: never reset for less than this many removable tokens
 */
export function simulate(points, cfg, rng, ttftMs) {
  let mode = 'raw';
  let armed = false;
  let lastDistillTurn = 0;
  let prevHistTokens = 0;          // history size of the previous surface
  let uncachedBilled = 0, cachedBilled = 0, resets = 0, turns = 0;
  let fireTurnSum = 0, eagerFires = 0, coalescedFires = 0;
  const ttfts = [];
  const surfaces = [];
  const hists = [];
  let overCeilingTurns = 0;

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const gap = sampleGap(rng);
    const cacheCold = rng() >= hitProb(gap);

    const rawHist = p.rawHistTokens;
    const distHist = p.distHistTokens;
    const surplus = Math.max(0, rawHist - distHist);
    const inflation = distHist > 0 ? rawHist / distHist : Infinity;
    const turnsSince = (i + 1) - lastDistillTurn;

    let predicate = false;
    if (mode === 'raw') {
      if (cfg.policy === 'ttl') predicate = gap >= (cfg.tauTtl ?? 86400);
      else if (cfg.policy === 'volume') predicate = surplus >= cfg.V;
      else if (cfg.policy === 'rounds') predicate = turnsSince >= cfg.R;
      else if (cfg.policy === 'ratio') predicate = i >= 1 && distHist > 0 && inflation >= cfg.rho;
      else if (cfg.policy === 'hybrid') {
        predicate = surplus >= cfg.V
          || turnsSince >= cfg.R
          || gap >= (cfg.tauTtl ?? 86400)
          || (i >= 1 && distHist > 0 && inflation >= cfg.rho);
      }
      if (predicate && cfg.minSurplus && surplus < cfg.minSurplus && gap < (cfg.tauTtl ?? Infinity)) predicate = false;
    }
    if (predicate) armed = true;

    const ceilingBreached = cfg.Vhard !== Infinity && p.rawTokens >= cfg.Vhard;
    let fire = false;
    if (mode === 'raw' && armed) {
      if (ceilingBreached) { fire = true; eagerFires += 1; }
      else if (!cfg.coalesce) { fire = true; eagerFires += 1; }
      else if (cacheCold) { fire = true; coalescedFires += 1; }
    }
    if (fire) { mode = 'distilled'; armed = false; lastDistillTurn = i + 1; resets += 1; fireTurnSum += i + 1; }

    const histTokens = mode === 'distilled' ? distHist : rawHist;
    const surfaceTokens = histTokens + p.turnTokens;

    const switched = fire && i > 0;
    let hitTokens = 0;
    if (i > 0 && !switched && !cacheCold) hitTokens = Math.min(histTokens, prevHistTokens);
    const uncached = Math.max(0, surfaceTokens - hitTokens);

    uncachedBilled += uncached;
    cachedBilled += hitTokens;
    ttfts.push(ttftMs(uncached));
    surfaces.push(surfaceTokens);
    hists.push(histTokens);
    if (cfg.Vhard !== Infinity && p.rawTokens >= cfg.Vhard) overCeilingTurns += 1;

    prevHistTokens = histTokens;
    turns += 1;
  }

  return { uncachedBilled, cachedBilled, resets, turns, fireTurnSum, eagerFires, coalescedFires, ttfts, surfaces, hists, overCeilingTurns };
}

export function evaluate(curves, cfg, ttftMs, seeds = 5) {
  let unc = 0, cac = 0, resets = 0, turns = 0, fireTurn = 0, over = 0;
  let sessionsFired = 0, sessionsTotal = 0;
  const ttfts = [], surfaces = [], hists = [];

  for (let s = 0; s < seeds; s += 1) {
    const rng = mulberry32(1000 + s * 97);
    for (const c of curves) {
      const r = simulate(c.points, cfg, rng, ttftMs);
      unc += r.uncachedBilled; cac += r.cachedBilled; resets += r.resets; turns += r.turns;
      fireTurn += r.fireTurnSum; over += r.overCeilingTurns;
      sessionsTotal += 1; if (r.resets > 0) sessionsFired += 1;
      for (const t of r.ttfts) ttfts.push(t);
      for (const x of r.surfaces) surfaces.push(x);
      for (const x of r.hists) hists.push(x);
    }
  }
  ttfts.sort((a, b) => a - b);
  surfaces.sort((a, b) => a - b);
  hists.sort((a, b) => a - b);
  const usd = unc * PRICE.uncached + cac * PRICE.cacheRead;

  return {
    cfg,
    seeds,
    // usd aggregates over `seeds` independent replays of the whole corpus.
    // usdPerReplay is the quantity that is comparable across experiments.
    usd: +usd.toFixed(2),
    usdPerReplay: +(usd / seeds).toFixed(2),
    uncachedMTokPerReplay: +(unc / seeds / 1e6).toFixed(1),
    uncachedMTok: +(unc / 1e6).toFixed(1),
    hitRate: +(cac / Math.max(1, unc + cac)).toFixed(4),
    ttft: { p50: +pct(ttfts, 0.5).toFixed(0), p90: +pct(ttfts, 0.9).toFixed(0), p95: +pct(ttfts, 0.95).toFixed(0), p99: +pct(ttfts, 0.99).toFixed(0) },
    surfaceMTok: { p50: +(pct(surfaces, 0.5) / 1e6).toFixed(3), p90: +(pct(surfaces, 0.9) / 1e6).toFixed(3), p99: +(pct(surfaces, 0.99) / 1e6).toFixed(3) },
    meanSurfaceMTok: +(surfaces.reduce((a, b) => a + b, 0) / surfaces.length / 1e6).toFixed(3),
    meanHistMTok: +(hists.reduce((a, b) => a + b, 0) / hists.length / 1e6).toFixed(3),
    resetsPer100Turns: +((resets / Math.max(1, turns)) * 100).toFixed(2),
    overCeilingTurnPct: +((over / Math.max(1, turns)) * 100).toFixed(1),
    meanFireTurn: resets > 0 ? +(fireTurn / resets).toFixed(2) : null,
    sessionFirePct: +((sessionsFired / Math.max(1, sessionsTotal)) * 100).toFixed(1),
  };
}
