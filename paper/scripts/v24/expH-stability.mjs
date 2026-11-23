#!/usr/bin/env node
/**
 * v2.4 Experiment H: seed stability of the eager-vs-coalesced comparison, and the
 * per-call uncached distribution (the user-visible latency spike, which cost averages
 * hide).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCurves, loadTtft, evaluate, simulate, mulberry32, PRICE } from './policy-engine.mjs';

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

const REC = { policy: 'hybrid', tauTtl: 86400, V: 16000, R: 5, rho: 8, coalesce: true, Vhard: 256000 };
const EAGER = { ...REC, coalesce: false };

const SEEDS = 20;
const out = { meta: { seeds: SEEDS, sessions: curves.length, ttft: TTFT }, configs: {} };

for (const [name, cfg] of [['coalesced', REC], ['eager', EAGER]]) {
  const perSeed = [];
  const allUncached = [];
  for (let s = 0; s < SEEDS; s += 1) {
    const rng = mulberry32(7000 + s * 131);
    let unc = 0, cac = 0, resets = 0, turns = 0;
    for (const c of curves) {
      const r = simulate(c.points, cfg, rng, ttftMs);
      unc += r.uncachedBilled; cac += r.cachedBilled; resets += r.resets; turns += r.turns;
      for (const t of r.ttfts) allUncached.push(t);
    }
    perSeed.push({
      usd: +((unc * PRICE.uncached + cac * PRICE.cacheRead)).toFixed(2),
      resetsPer100: +((resets / turns) * 100).toFixed(2),
      uncachedMTok: +(unc / 1e6).toFixed(1),
    });
  }
  const usds = perSeed.map((p) => p.usd).sort((a, b) => a - b);
  const mean = usds.reduce((a, b) => a + b, 0) / usds.length;
  const sd = Math.sqrt(usds.reduce((a, b) => a + (b - mean) ** 2, 0) / usds.length);
  allUncached.sort((a, b) => a - b);
  out.configs[name] = {
    perSeed,
    meanUsd: +mean.toFixed(2),
    sdUsd: +sd.toFixed(2),
    ci95: [+(mean - 1.96 * sd / Math.sqrt(SEEDS)).toFixed(2), +(mean + 1.96 * sd / Math.sqrt(SEEDS)).toFixed(2)],
    ttftP50: +allUncached[Math.floor(0.50 * allUncached.length)].toFixed(0),
    ttftP99: +allUncached[Math.floor(0.99 * allUncached.length)].toFixed(0),
    ttftMax: +allUncached[allUncached.length - 1].toFixed(0),
  };
}

const a = out.configs.coalesced, b = out.configs.eager;
out.verdict = {
  deltaUsd: +(b.meanUsd - a.meanUsd).toFixed(2),
  deltaPct: +(((b.meanUsd - a.meanUsd) / a.meanUsd) * 100).toFixed(2),
  overlappingCI: !(a.ci95[1] < b.ci95[0] || b.ci95[1] < a.ci95[0]),
  p99DeltaMs: b.ttftP99 - a.ttftP99,
};

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expH-stability.json'), JSON.stringify(out, null, 2));

console.log('config      meanUSD   sd   95% CI            ttftP50 ttftP99 ttftMax');
for (const [k, v] of Object.entries(out.configs)) {
  console.log(k.padEnd(11), String(v.meanUsd).padStart(8), String(v.sdUsd).padStart(6),
    '[' + v.ci95[0] + ', ' + v.ci95[1] + ']'.padEnd(6), String(v.ttftP50).padStart(7),
    String(v.ttftP99).padStart(7), String(v.ttftMax).padStart(7));
}
console.log('verdict:', JSON.stringify(out.verdict));
