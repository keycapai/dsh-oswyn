#!/usr/bin/env node
/**
 * v2.4 Experiment M: Faithful Rolling-Checkpoint Parameter Sweep (v2.4.2).
 *
 * WHY THIS EXPERIMENT EXISTS
 * Exp E–L modeled a one-shot sticky latch (mode flips raw -> distilled ONCE per
 * session, then never re-evaluates triggers). In the actual shipped implementation
 * (lib/index.js + buildTurnDistillCheckpoints + appendCheckpointReplace), each new
 * completed turn enters the surface raw and triggers are re-evaluated on every turn
 * against the INCREMENTAL removable surplus of undistilled historical turns.
 *
 * Under this rolling-checkpoint model, V=16,000 (chosen when V only fired once per
 * session) fires repeatedly — often on EVERY heavy turn — because a single real
 * agent turn frequently produces >16K removable tokens (thinking + tool traffic).
 *
 * This script measures:
 *   1. Single-turn removable surplus distribution across all 293 real sessions (6,793 turns).
 *   2. Trigger frequency, USD cost, attention burden (mean surface), TTFT p99, and
 *      composite objective J across V × R in the true rolling-checkpoint model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, PRICE, hitProb, sampleGap, mulberry32 } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

// ── Part 1: Single-turn removable surplus distribution ─────────────────────
const singleTurnSurplus = [];
for (const c of curves) {
  const pts = c.points;
  for (let i = 1; i < pts.length; i += 1) {
    const dRaw = Math.max(0, pts[i].rawHistTokens - pts[i - 1].rawHistTokens);
    const dDist = Math.max(0, pts[i].distHistTokens - pts[i - 1].distHistTokens);
    singleTurnSurplus.push(Math.max(0, dRaw - dDist));
  }
}
const sortedSingle = [...singleTurnSurplus].sort((a, b) => a - b);
const over = (thr) => +((singleTurnSurplus.filter((x) => x >= thr).length / singleTurnSurplus.length) * 100).toFixed(1);
const singleStats = {
  count: singleTurnSurplus.length,
  mean: Math.round(singleTurnSurplus.reduce((a, b) => a + b, 0) / singleTurnSurplus.length),
  p50: Math.round(pct(sortedSingle, 0.5)),
  p75: Math.round(pct(sortedSingle, 0.75)),
  p90: Math.round(pct(sortedSingle, 0.9)),
  p95: Math.round(pct(sortedSingle, 0.95)),
  p99: Math.round(pct(sortedSingle, 0.99)),
  max: Math.round(sortedSingle[sortedSingle.length - 1]),
  pctGe16K: over(16000),
  pctGe32K: over(32000),
  pctGe48K: over(48000),
  pctGe64K: over(64000),
  pctGe96K: over(96000),
  pctGe128K: over(128000)
};

// ── Part 2: Rolling-checkpoint simulator (faithful to lib/index.js) ────────
function simulateRolling(points, cfg, rng) {
  // distilledIdx = index k in points where turns 1..k have been checkpoint-replaced.
  // Their distilled token footprint is points[k].distHistTokens (for k > 0, else 0).
  let distilledIdx = 0;
  let roundsSinceDistill = 0;
  let prevHistTokens = 0;

  let uncachedBilled = 0;
  let cachedBilled = 0;
  let resets = 0;
  let volResets = 0;
  let rndResets = 0;
  let ttlResets = 0;
  let ceilResets = 0;
  let turns = 0;
  let firstFireTurn = null;
  const ttfts = [];
  const surfaces = [];

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const gap = sampleGap(rng);
    const cacheCold = rng() >= hitProb(gap);
    const ttlExpired = gap >= (cfg.tauTtl ?? 86400);

    // Current surface BEFORE deciding whether to distill at turn i:
    //   already-distilled prefix (turns 1..distilledIdx) + raw undistilled turns (distilledIdx+1..i)
    const baseDistHist = distilledIdx > 0 ? points[distilledIdx].distHistTokens : 0;
    const baseRawHist = distilledIdx > 0 ? points[distilledIdx].rawHistTokens : 0;
    const undistilledRaw = Math.max(0, p.rawHistTokens - baseRawHist);
    const undistilledDist = Math.max(0, p.distHistTokens - baseDistHist);
    const deltaSurplus = Math.max(0, undistilledRaw - undistilledDist);
    const currentHistRaw = baseDistHist + undistilledRaw;
    const currentRawSurface = currentHistRaw + p.turnTokens;

    let fire = false;
    let reason = null;

    if (cfg.policy !== 'none' && i > 0 && deltaSurplus > 0) {
      const sigTtl = cfg.ttlEnabled !== false && ttlExpired;
      const sigVol = cfg.volEnabled !== false && deltaSurplus >= cfg.V;
      const sigRnd = cfg.rndEnabled !== false && roundsSinceDistill >= cfg.R;
      const sigCeil = cfg.Vhard !== Infinity && currentRawSurface >= cfg.Vhard;

      const anyArmed = sigTtl || sigVol || sigRnd;
      const floorBlocked = anyArmed && !sigCeil && deltaSurplus < (cfg.minSurplus ?? 2000);

      if (sigCeil) {
        fire = true;
        reason = 'ceiling';
      } else if (anyArmed && !floorBlocked) {
        fire = true;
        reason = sigTtl ? 'ttl' : (sigVol ? 'volume' : 'rounds');
      }
    }

    let histTokens;
    let hitTokens = 0;

    if (fire) {
      // Checkpoint replacement rewrites turns (distilledIdx+1..i) into compact checkpoints.
      // Prefix up to `baseDistHist` (turns 1..distilledIdx) stays byte-identical on the surface!
      histTokens = p.distHistTokens;
      if (i > 0 && !cacheCold && baseDistHist > 0) {
        hitTokens = Math.min(baseDistHist, prevHistTokens);
      }
      distilledIdx = i;
      roundsSinceDistill = 0;
      resets += 1;
      if (firstFireTurn === null) firstFireTurn = i + 1;
      if (reason === 'volume') volResets += 1;
      else if (reason === 'rounds') rndResets += 1;
      else if (reason === 'ttl') ttlResets += 1;
      else if (reason === 'ceiling') ceilResets += 1;
    } else {
      histTokens = currentHistRaw;
      if (i > 0 && !cacheCold) {
        hitTokens = Math.min(histTokens, prevHistTokens);
      }
      if (i > 0) roundsSinceDistill += 1;
    }

    const surfaceTokens = histTokens + p.turnTokens;
    const uncached = Math.max(0, surfaceTokens - hitTokens);

    uncachedBilled += uncached;
    cachedBilled += hitTokens;
    ttfts.push(ttftMs(uncached));
    surfaces.push(surfaceTokens);
    prevHistTokens = histTokens;
    turns += 1;
  }

  return {
    uncachedBilled,
    cachedBilled,
    resets,
    volResets,
    rndResets,
    ttlResets,
    ceilResets,
    turns,
    firstFireTurn,
    ttfts,
    surfaces
  };
}

function evalRolling(cfg, seeds = 5) {
  let unc = 0, cac = 0, resets = 0, volR = 0, rndR = 0, ttlR = 0, ceilR = 0, turns = 0;
  let fireTurnSum = 0, sessionsFired = 0, sessionsTotal = 0;
  const ttfts = [], surfaces = [];

  for (let s = 0; s < seeds; s += 1) {
    const rng = mulberry32(1000 + s * 97);
    for (const c of curves) {
      const r = simulateRolling(c.points, cfg, rng);
      unc += r.uncachedBilled;
      cac += r.cachedBilled;
      resets += r.resets;
      volR += r.volResets;
      rndR += r.rndResets;
      ttlR += r.ttlResets;
      ceilR += r.ceilResets;
      turns += r.turns;
      sessionsTotal += 1;
      if (r.firstFireTurn !== null) {
        sessionsFired += 1;
        fireTurnSum += r.firstFireTurn;
      }
      for (const t of r.ttfts) ttfts.push(t);
      for (const x of r.surfaces) surfaces.push(x);
    }
  }

  ttfts.sort((a, b) => a - b);
  surfaces.sort((a, b) => a - b);
  const usd = (unc * PRICE.uncached + cac * PRICE.cacheRead) / seeds;
  const meanSurfMTok = surfaces.reduce((a, b) => a + b, 0) / surfaces.length / 1e6;
  const resetsPer100 = (resets / Math.max(1, turns)) * 100;

  return {
    cfg,
    usdPerReplay: +usd.toFixed(2),
    uncachedMTokPerReplay: +(unc / seeds / 1e6).toFixed(1),
    hitRate: +(cac / Math.max(1, unc + cac)).toFixed(4),
    meanSurfaceMTok: +meanSurfMTok.toFixed(3),
    surfaceP50MTok: +(pct(surfaces, 0.5) / 1e6).toFixed(3),
    surfaceP90MTok: +(pct(surfaces, 0.9) / 1e6).toFixed(3),
    ttftP99Ms: +pct(ttfts, 0.99).toFixed(0),
    resetsPer100Turns: +resetsPer100.toFixed(2),
    volSharePct: resets > 0 ? +((volR / resets) * 100).toFixed(1) : 0,
    rndSharePct: resets > 0 ? +((rndR / resets) * 100).toFixed(1) : 0,
    meanTurnsBetweenResets: resets > 0 ? +(turns / resets).toFixed(2) : null,
    meanFirstFireTurn: sessionsFired > 0 ? +(fireTurnSum / sessionsFired).toFixed(2) : null,
    sessionFirePct: +((sessionsFired / Math.max(1, sessionsTotal)) * 100).toFixed(1)
  };
}

const origin = evalRolling({ policy: 'none', Vhard: Infinity });

const withJ = (r) => {
  // Composite objective J: 0.5 cost + 0.4 attention burden + 0.1 disruption (normalized resets/100t)
  // Note: in rolling mode resets/100t can reach 20-40, so normalizing by 100 directly penalizes high churn.
  const J = 0.5 * (r.usdPerReplay / origin.usdPerReplay)
    + 0.4 * (r.meanSurfaceMTok / origin.meanSurfaceMTok)
    + 0.1 * (r.resetsPer100Turns / 100);
  // Also compute J_disrupt (stronger disruption penalty for UX/cache stability: 0.5 cost + 0.3 surface + 0.2*(resets/20))
  const Jux = 0.5 * (r.usdPerReplay / origin.usdPerReplay)
    + 0.3 * (r.meanSurfaceMTok / origin.meanSurfaceMTok)
    + 0.2 * (r.resetsPer100Turns / 20);
  return {
    ...r,
    savePct: +(((origin.usdPerReplay - r.usdPerReplay) / origin.usdPerReplay) * 100).toFixed(1),
    J: +J.toFixed(4),
    Jux: +Jux.toFixed(4)
  };
};

// Sweep 1: Volume-only (R = Infinity) to isolate V
const volSweep = [8000, 16000, 24000, 32000, 48000, 64000, 96000, 128000, 192000].map((V) =>
  withJ(evalRolling({ policy: 'hybrid', V, R: Infinity, minSurplus: 2000, Vhard: 256000 }))
);

// Sweep 2: Rounds-only (V = Infinity) to isolate R
const rndSweep = [2, 3, 5, 6, 8, 10, 12, 16].map((R) =>
  withJ(evalRolling({ policy: 'hybrid', V: Infinity, R, minSurplus: 2000, Vhard: 256000 }))
);

// Sweep 3: 2D Grid V × R (hybrid)
const grid = [];
for (const V of [16000, 32000, 48000, 64000, 96000, 128000]) {
  for (const R of [5, 6, 8, 10, 12]) {
    grid.push(withJ(evalRolling({ policy: 'hybrid', V, R, minSurplus: 2000, Vhard: 256000 })));
  }
}

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'expM-rolling-checkpoint-sweep.json'),
  JSON.stringify({ meta: { sessions: curves.length, ttft: TTFT }, singleStats, origin: withJ(origin), volSweep, rndSweep, grid }, null, 2)
);

console.log('=== Single-turn removable surplus across 293 real sessions (N=' + singleStats.count + ' turns) ===');
console.log(JSON.stringify(singleStats, null, 2));

console.log('\nOrigin (no distill): USD=' + origin.usdPerReplay + ' meanSurf=' + origin.meanSurfaceMTok + ' MTok hitRate=' + origin.hitRate + ' ttftP99=' + origin.ttftP99Ms + 'ms');

const printTable = (title, rows, labelFn) => {
  console.log('\n=== ' + title + ' ===');
  console.log('config'.padEnd(18), 'USD'.padStart(7), 'save%'.padStart(6), 'hit'.padStart(6), 'surfM'.padStart(6), 'ttft99'.padStart(7), 'res/100t'.padStart(9), 'vol%'.padStart(6), 'rnd%'.padStart(6), 't/res'.padStart(6), 'J'.padStart(7), 'Jux'.padStart(7));
  for (const r of rows) {
    console.log(
      labelFn(r.cfg).padEnd(18),
      String(r.usdPerReplay).padStart(7),
      (r.savePct + '%').padStart(6),
      String(r.hitRate).padStart(6),
      String(r.meanSurfaceMTok).padStart(6),
      String(r.ttftP99Ms).padStart(7),
      String(r.resetsPer100Turns).padStart(9),
      (r.volSharePct + '%').padStart(6),
      (r.rndSharePct + '%').padStart(6),
      String(r.meanTurnsBetweenResets ?? '—').padStart(6),
      String(r.J).padStart(7),
      String(r.Jux).padStart(7)
    );
  }
};

printTable('Volume-only sweep (R=Inf, rolling checkpoints)', volSweep, (c) => `V=${c.V / 1000}K`);
printTable('Rounds-only sweep (V=Inf, rolling checkpoints)', rndSweep, (c) => `R=${c.R}`);
printTable('2D Hybrid Grid V x R (sorted by J)', [...grid].sort((a, b) => a.J - b.J).slice(0, 15), (c) => `V=${c.V / 1000}K R=${c.R}`);
printTable('2D Hybrid Grid V x R (sorted by Jux - low churn)', [...grid].sort((a, b) => a.Jux - b.Jux).slice(0, 15), (c) => `V=${c.V / 1000}K R=${c.R}`);
printTable('Current shipped (V=16K R=5) vs candidates', [
  grid.find((r) => r.cfg.V === 16000 && r.cfg.R === 5),
  grid.find((r) => r.cfg.V === 32000 && r.cfg.R === 5),
  grid.find((r) => r.cfg.V === 48000 && r.cfg.R === 6),
  grid.find((r) => r.cfg.V === 64000 && r.cfg.R === 8),
  grid.find((r) => r.cfg.V === 96000 && r.cfg.R === 8),
  grid.find((r) => r.cfg.V === 128000 && r.cfg.R === 8)
], (c) => `V=${c.V / 1000}K R=${c.R}`);
