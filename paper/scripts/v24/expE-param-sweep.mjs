#!/usr/bin/env node
/**
 * v2.4 Experiment E: Parameter sweep for the three candidate triggers.
 *
 * For each candidate threshold we report the four quantities that jointly decide the
 * parameter choice, none of which alone is sufficient:
 *   USD            financial cost of uncached prefill
 *   rawSurf (MTok) mean raw history carried per turn  -> the ATTENTION BURDEN
 *   resets/100t    how often the prefix is destroyed  -> the latency/disruption cost
 *   fireTurn       at which turn the policy engages   -> early engagement protects
 *                                                       shallow sessions, late
 *                                                       engagement protects deep ones
 */
import { loadCurves, loadTtft, evaluate } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

const rows = [];
const push = (cfg) => rows.push(evaluate(curves, cfg, ttftMs));

// Execution mode is EAGER throughout: Exp H/I/J established that under a sticky latch
// eager firing beats coalescing, because the single reset is cheaper than carrying the
// raw surface while waiting for a naturally cold call.
push({ policy: 'none' });
push({ policy: 'ttl', tauTtl: 86400, coalesce: false, Vhard: Infinity });
push({ policy: 'ttl', tauTtl: 3600, coalesce: false, Vhard: Infinity });
push({ policy: 'ttl', tauTtl: 300, coalesce: false, Vhard: Infinity });

const V_GRID = [4000, 8000, 12000, 16000, 24000, 32000, 48000, 64000, 96000, 128000];
for (const V of V_GRID) push({ policy: 'volume', V, coalesce: false, Vhard: Infinity });

const R_GRID = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
for (const R of R_GRID) push({ policy: 'rounds', R, coalesce: false, Vhard: Infinity });

const RHO_GRID = [2, 3, 4, 6, 8, 12, 16, 24, 32];
for (const rho of RHO_GRID) push({ policy: 'ratio', rho, coalesce: false, Vhard: Infinity });

import fs from 'node:fs';
import path from 'node:path';
const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expE-param-sweep.json'), JSON.stringify({ meta: { ttft: TTFT, sessions: curves.length }, rows }, null, 2));

const base = rows[0];
console.log('TTFT', JSON.stringify(TTFT), '| sessions', curves.length, '| origin USD/replay', base.usdPerReplay);
console.log('cfg'.padEnd(22), 'USD'.padStart(8), 'save%'.padStart(6), 'MTok'.padStart(7), 'hit'.padStart(6),
  'ttftP50'.padStart(8), 'ttftP90'.padStart(8), 'surfP50'.padStart(8), 'surfP90'.padStart(8),
  'res/100t'.padStart(8), 'fireTurn'.padStart(8), 'sessFire%'.padStart(9));
for (const r of rows) {
  const c = r.cfg;
  const label = c.policy === 'none' ? 'origin(none)'
    : c.policy === 'ttl' ? `ttl tau=${c.tauTtl}`
    : c.policy === 'volume' ? `volume V=${c.V}`
    : c.policy === 'rounds' ? `rounds R=${c.R}`
    : `ratio rho=${c.rho}`;
  console.log(label.padEnd(22), String(r.usdPerReplay).padStart(8), ((1 - r.usd / base.usd) * 100).toFixed(1).padStart(5) + '%',
    String(r.uncachedMTokPerReplay).padStart(7), String(r.hitRate).padStart(6),
    String(r.ttft.p50).padStart(8), String(r.ttft.p90).padStart(8),
    String(r.surfaceMTok.p50).padStart(8), String(r.surfaceMTok.p90).padStart(8),
    String(r.resetsPer100Turns).padStart(8), String(r.meanFireTurn).padStart(8), String(r.sessionFirePct).padStart(9));
}
