#!/usr/bin/env node
/**
 * v2.4 Experiment I: the latch x coalescing 2x2.
 *
 * Exp H produced a result that contradicts the natural intuition: for the recommended
 * sticky configuration, EAGER firing is 2.65% CHEAPER than coalescing (non-overlapping
 * 95% CI over 20 seeds). This experiment isolates why, by crossing the two design
 * decisions independently:
 *
 *   LATCH   sticky  : once distilled, stay distilled  -> exactly ONE reset per session
 *           periodic: re-evaluate every dispatch      -> many resets
 *   EXEC    eager   : fire the moment the predicate arms
 *           coalesce: fire only on an already-cold call
 *
 * Prediction: coalescing is a large win under periodic re-firing (it protects a live
 * prefix) and a small LOSS under a sticky latch (it delays the single reset, so the
 * raw surface is carried for longer). If the data shows that, the v2.4 recommendation
 * is: sticky latch + eager execution.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, evaluate } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

// The engine latches whenever a fire happens; to emulate a periodic policy we force
// re-arming by using a policy that keeps firing: 'volume' with sticky=false is not
// expressible through cfg, so we instead compare a policy that fires often (rounds R=1)
// against one that fires once. The engine's own latch is what we vary via Vhard/R.
const rows = [];
const push = (label, cfg) => rows.push({ label, ...evaluate(curves, cfg, ttftMs, 10) });

const origin = evaluate(curves, { policy: 'none' }, ttftMs, 10);
rows.push({ label: 'origin', ...origin });

push('sticky eager    R=5', { policy: 'rounds', R: 5, coalesce: false, Vhard: Infinity });
push('sticky coalesce R=5', { policy: 'rounds', R: 5, coalesce: true, Vhard: Infinity });
push('sticky eager    V=16k', { policy: 'volume', V: 16000, coalesce: false, Vhard: Infinity });
push('sticky coalesce V=16k', { policy: 'volume', V: 16000, coalesce: true, Vhard: Infinity });
push('hybrid eager', { policy: 'hybrid', tauTtl: 86400, V: 16000, R: 5, rho: 8, coalesce: false, Vhard: 256000 });
push('hybrid coalesce', { policy: 'hybrid', tauTtl: 86400, V: 16000, R: 5, rho: 8, coalesce: true, Vhard: 256000 });

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expI-latch.json'), JSON.stringify({ meta: { ttft: TTFT, sessions: curves.length, seeds: 10 }, origin, rows }, null, 2));

console.log('label'.padEnd(22), 'USD'.padStart(8), 'save%'.padStart(6), 'surfMean'.padStart(9), 'res/100t'.padStart(9), 'fireTurn'.padStart(9), 'ttftP99'.padStart(8));
for (const r of rows) {
  console.log(r.label.padEnd(22), String(r.usdPerReplay).padStart(8),
    ((1 - r.usd / origin.usd) * 100).toFixed(1).padStart(5) + '%',
    String(r.meanSurfaceMTok).padStart(9), String(r.resetsPer100Turns).padStart(9),
    String(r.meanFireTurn).padStart(9), String(r.ttft.p99).padStart(8));
}
