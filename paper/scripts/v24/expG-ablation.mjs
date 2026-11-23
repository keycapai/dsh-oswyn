#!/usr/bin/env node
/**
 * v2.4 Experiment G: Signal ablation and the recommended configuration.
 *
 * Exp E established that every STICKY trigger lands near the same cost (-55%), so cost
 * alone cannot pick a parameter. This experiment therefore scores each configuration on
 * a joint objective that also prices the two things cost ignores:
 *
 *   ATTENTION BURDEN   mean raw surface carried per turn (what dilutes attention)
 *   DISRUPTION         resets per 100 turns (each reset is a cold prefill cliff)
 *
 * Composite utility (lower is better), all terms normalised against Origin Replay:
 *   J = w_cost * cost/origin + w_attn * surface/origin + w_disrupt * resets/100turns
 * with w_cost = 0.5, w_attn = 0.4, w_disrupt = 0.1.
 *
 * Also reports the marginal contribution of each signal by removing it from the
 * recommended configuration one at a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, evaluate } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

const W = { cost: 0.5, attn: 0.4, disrupt: 0.1 };

function score(r, origin) {
  const cost = r.usd / origin.usd;
  const attn = r.meanSurfaceMTok / origin.meanSurfaceMTok;
  const disrupt = r.resetsPer100Turns / 100;
  return +(W.cost * cost + W.attn * attn + W.disrupt * disrupt).toFixed(4);
}

const rows = [];
const push = (label, cfg) => {
  const r = evaluate(curves, cfg, ttftMs);
  rows.push({ label, ...r });
};

const originCfg = { policy: 'none' };
const origin = evaluate(curves, originCfg, ttftMs);

push('origin', originCfg);
push('v2.3 ttl24h', { policy: 'ttl', tauTtl: 86400, coalesce: false, Vhard: Infinity });
push('v2.3 ttl5m', { policy: 'ttl', tauTtl: 300, coalesce: false, Vhard: Infinity });

// ---- single-signal sweep (eager, matching the recommended configuration)
for (const V of [8000, 16000, 32000, 64000]) push(`volume V=${V}`, { policy: 'volume', V, coalesce: false, Vhard: Infinity });
for (const R of [3, 4, 5, 6, 8]) push(`rounds R=${R}`, { policy: 'rounds', R, coalesce: false, Vhard: Infinity });

// ---- recommended hybrid + ablation
// Exp H/I established that under a STICKY latch, eager execution beats coalescing
// (the single reset is cheaper than carrying the raw surface while waiting for a
// naturally cold call). The recommended configuration therefore uses eager firing.
const REC = { policy: 'hybrid', tauTtl: 86400, V: 16000, R: 5, rho: 8, coalesce: false, Vhard: 256000 };
push('hybrid REC', REC);
push('hybrid no-volume', { ...REC, V: Number.MAX_SAFE_INTEGER });
push('hybrid no-rounds', { ...REC, R: Number.MAX_SAFE_INTEGER });
push('hybrid no-ceiling', { ...REC, Vhard: Infinity });
push('hybrid +coalesce', { ...REC, coalesce: true });
push('hybrid no-ttl', { ...REC, tauTtl: Number.MAX_SAFE_INTEGER });
push('hybrid no-rho', { ...REC, rho: Number.MAX_SAFE_INTEGER });

// ---- hybrid grid to locate the optimum
const grid = [];
for (const V of [8000, 16000, 32000]) {
  for (const R of [3, 4, 5, 6, 8]) {
    for (const Vhard of [128000, 256000, 512000]) {
      const cfg = { policy: 'hybrid', tauTtl: 86400, V, R, rho: 8, coalesce: false, Vhard };
      const r = evaluate(curves, cfg, ttftMs);
      grid.push({ label: `V=${V} R=${R} ceil=${Vhard}`, ...r, score: score(r, origin) });
    }
  }
}

for (const r of rows) r.score = score(r, origin);

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expG-ablation.json'), JSON.stringify({ meta: { ttft: TTFT, weights: W, sessions: curves.length }, origin, rows, grid }, null, 2));

console.log('TTFT', JSON.stringify(TTFT), '| sessions', curves.length);
console.log('label'.padEnd(20), 'USD'.padStart(8), 'save%'.padStart(6), 'surfP50'.padStart(8), 'surfMean'.padStart(9), 'res/100t'.padStart(9), 'fireTurn'.padStart(9), 'J'.padStart(7));
for (const r of rows) {
  console.log(r.label.padEnd(20), String(r.usdPerReplay).padStart(8), ((1 - r.usd / origin.usd) * 100).toFixed(1).padStart(5) + '%',
    String(r.surfaceMTok.p50).padStart(8), String(r.meanSurfaceMTok).padStart(9),
    String(r.resetsPer100Turns).padStart(9), String(r.meanFireTurn).padStart(9), String(r.score).padStart(7));
}
console.log('\n--- hybrid grid, best 10 by J ---');
grid.sort((a, b) => a.score - b.score);
for (const g of grid.slice(0, 10)) {
  console.log(g.label.padEnd(26), String(g.usd).padStart(8), ((1 - g.usd / origin.usd) * 100).toFixed(1).padStart(5) + '%',
    String(g.meanSurfaceMTok).padStart(9), String(g.resetsPer100Turns).padStart(9), String(g.meanFireTurn).padStart(9), String(g.score).padStart(7));
}
console.log('\n--- hybrid grid, worst 3 ---');
for (const g of grid.slice(-3)) {
  console.log(g.label.padEnd(26), String(g.usd).padStart(8), String(g.meanSurfaceMTok).padStart(9), String(g.score).padStart(7));
}
