#!/usr/bin/env node
/**
 * v2.4 Experiment K: why the anti-thrash floor is not optional.
 *
 * The round sweep in Exp E/G appears to say "fire as early as possible": R=1 and R=2
 * tie for the cheapest configuration. That conclusion is an artifact of measuring only
 * cost. A round trigger with no floor fires on turn 1 of EVERY session, including the
 * many sessions whose history is already pure user/assistant text and therefore has
 * nothing removable (Exp B: 10% of turn boundaries have distill ratio 1.0).
 *
 * Such a reset destroys a live prefix and saves zero tokens: pure loss. The floor
 * (triggerMinSurplusTokens) is what makes an aggressive round threshold safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, evaluate } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

const rows = [];
const push = (label, cfg) => rows.push({ label, ...evaluate(curves, cfg, ttftMs, 5) });

const origin = evaluate(curves, { policy: 'none' }, ttftMs, 5);
rows.push({ label: 'origin', ...origin });

// no floor: the trigger fires even when nothing is removable
for (const R of [1, 2, 3, 5]) {
  push(`R=${R} no-floor`, { policy: 'rounds', R, coalesce: false, Vhard: Infinity, minSurplus: 0 });
}
// with the recommended floor
for (const R of [1, 2, 3, 5]) {
  push(`R=${R} floor=2k`, { policy: 'rounds', R, coalesce: false, Vhard: Infinity, minSurplus: 2000 });
}
// floor sensitivity at the recommended round threshold
for (const F of [0, 500, 1000, 2000, 4000, 8000, 16000]) {
  push(`R=3 floor=${F}`, { policy: 'rounds', R: 3, coalesce: false, Vhard: Infinity, minSurplus: F });
}

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expK-floor.json'), JSON.stringify({ meta: { ttft: TTFT, sessions: curves.length }, origin, rows }, null, 2));

console.log('label'.padEnd(20), 'USD'.padStart(7), 'save%'.padStart(6), 'surfMean'.padStart(9), 'res/100t'.padStart(9), 'fireTurn'.padStart(9), 'sess%'.padStart(6));
for (const r of rows) {
  console.log(r.label.padEnd(20), String(r.usdPerReplay).padStart(7),
    ((1 - r.usd / origin.usd) * 100).toFixed(1).padStart(5) + '%',
    String(r.meanSurfaceMTok).padStart(9), String(r.resetsPer100Turns).padStart(9),
    String(r.meanFireTurn).padStart(9), String(r.sessionFirePct).padStart(6));
}
