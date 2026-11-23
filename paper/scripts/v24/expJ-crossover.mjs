#!/usr/bin/env node
/**
 * v2.4 Experiment J: when does coalescing pay?
 *
 * Exp H/I found that under a sticky latch, EAGER execution is cheaper than coalescing
 * on the real production miss profile. That is counter-intuitive, so this experiment
 * establishes the CONDITION rather than a fixed verdict, by scaling the cache-miss
 * probability and finding the crossover.
 *
 * Reasoning: coalescing defers the single reset to a call that would have missed
 * anyway, which is free. But every deferred turn carries the larger raw surface, and
 * any miss during the wait is billed on that larger surface. So:
 *     coalescing wins  iff  misses are RARE (the wait is nearly free)
 *     eager wins       iff  misses are COMMON (the wait is expensive)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, SURVIVAL, GAP_MIX, mulberry32, PRICE } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

function sampleGap(rng) { const u = rng(); let a = 0; for (const [g, p] of GAP_MIX) { a += p; if (u <= a) return g; } return 86400; }
function baseHit(gap) { for (const [hi, p] of SURVIVAL) if (gap < hi) return p; return 0; }

/** Run the recommended sticky policy with the miss probability scaled by missScale. */
function run(cfg, missScale, rng) {
  let unc = 0, cac = 0, resets = 0, turns = 0;
  for (const c of curves) {
    let mode = 'raw', armed = false, lastTurn = 0, prevHist = 0;
    const pts = c.points;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const gap = sampleGap(rng);
      const hitP = Math.min(1, Math.max(0, baseHit(gap) * missScale));
      const cold = rng() >= hitP;
      const surplus = Math.max(0, p.rawHistTokens - p.distHistTokens);
      const since = (i + 1) - lastTurn;
      let pred = false;
      if (mode === 'raw') pred = surplus >= cfg.V || since >= cfg.R || gap >= cfg.tauTtl || p.rawTokens >= cfg.Vhard;
      if (pred) armed = true;
      let fire = false;
      if (mode === 'raw' && armed) {
        if (p.rawTokens >= cfg.Vhard) fire = true;
        else if (!cfg.coalesce) fire = true;
        else if (cold) fire = true;
      }
      if (fire) { mode = 'distilled'; armed = false; lastTurn = i + 1; resets += 1; }
      const hist = mode === 'distilled' ? p.distHistTokens : p.rawHistTokens;
      const surface = hist + p.turnTokens;
      const switched = fire && i > 0;
      const hit = (i > 0 && !switched && !cold) ? Math.min(hist, prevHist) : 0;
      unc += surface - hit; cac += hit;
      prevHist = hist; turns += 1;
    }
  }
  return { usd: unc * PRICE.uncached + cac * PRICE.cacheRead, resets, turns };
}

const REC = { tauTtl: 86400, V: 16000, R: 5, Vhard: 256000 };
const SCALES = [0.4, 0.7, 1.0, 1.3, 1.6, 2.0];
const SEEDS = 10;
const rows = [];

for (const scale of SCALES) {
  const cell = { missScale: scale };
  for (const coalesce of [false, true]) {
    let usd = 0, resets = 0, turns = 0;
    for (let s = 0; s < SEEDS; s += 1) {
      const r = run({ ...REC, coalesce }, scale, mulberry32(3100 + s * 53));
      usd += r.usd; resets += r.resets; turns += r.turns;
    }
    cell[coalesce ? 'coalesce' : 'eager'] = +(usd / SEEDS).toFixed(2);
    cell[coalesce ? 'coalesceResets' : 'eagerResets'] = +((resets / turns) * 100).toFixed(2);
  }
  cell.eagerBetterPct = +(((cell.coalesce - cell.eager) / cell.eager) * 100).toFixed(2);
  rows.push(cell);
}

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expJ-crossover.json'), JSON.stringify({ meta: { seeds: SEEDS, sessions: curves.length, cfg: REC }, rows }, null, 2));

console.log('missScale  eagerUSD  coalesceUSD  eagerBetter%  eagerRes/100t  coalesceRes/100t');
for (const r of rows) {
  console.log(String(r.missScale).padStart(9), String(r.eager).padStart(9), String(r.coalesce).padStart(12),
    String(r.eagerBetterPct).padStart(13), String(r.eagerResets).padStart(14), String(r.coalesceResets).padStart(17));
}
