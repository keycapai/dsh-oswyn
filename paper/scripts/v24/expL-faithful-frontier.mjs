#!/usr/bin/env node
/**
 * expL: frontier-faithful re-sweep (v2.4 correction).
 *
 * WHAT THE v2.4 ENGINE ASSUMED
 *   hit = min(histTokens, prevHistTokens)   -- prefix length only
 *   plus a SURVIVAL/GAP_MIX cache model.
 *
 * WHAT IS ACTUALLY TRUE
 *   The projection in lib/core/projection.js is STATELESS: it distills every
 *   historical turn on every call. So after the first flip the distilled surface
 *   keeps growing, and each new turn rewrites the tail of the prefix. R therefore
 *   paces only the FIRST flip; the frontier advances on every later turn for free.
 *
 * This script keeps the real cache model (SURVIVAL + GAP_MIX, measured on 6,576
 * production calls) and adds the thing the v2.4 engine could not express: a prefix
 * that grows. Cost is billed on (surface - stable prefix), where the stable prefix
 * is the byte-identical head shared with the previous request -- and that head is
 * cut short whenever the surface was rewritten (a flip or a frontier advance).
 */
import { loadCurves, PRICE, hitProb, sampleGap, mulberry32 } from './policy-engine.mjs';

const curves = loadCurves();

/**
 * @param points curve points
 * @param cfg { policy, R, V, minSurplus, Vhard, refreeze }
 *   refreeze: 'never'  frontier advances silently (stateless projection, real behaviour)
 *             'rounds' frontier only advances every R turns (hypothetical knob)
 */
function simulate(points, cfg, rng) {
  let mode = 'raw';
  let prevHist = 0;              // history tokens carried by the previous request
  let lastDistillTurn = 0;
  let lastAdvanceTurn = 0;
  let armed = false;
  let uncached = 0, cached = 0, resets = 0, advances = 0, turns = 0, fireTurnSum = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const gap = sampleGap(rng);
    const cold = rng() >= hitProb(gap);

    const surplus = Math.max(0, p.surplusTokens);
    const turnsSince = (i + 1) - lastDistillTurn;

    let predicate = false;
    if (mode === 'raw') {
      if (cfg.policy === 'rounds') predicate = turnsSince >= cfg.R;
      else if (cfg.policy === 'volume') predicate = surplus >= cfg.V;
      else if (cfg.policy === 'hybrid') predicate = surplus >= cfg.V || turnsSince >= cfg.R;
      if (predicate && cfg.minSurplus && surplus < cfg.minSurplus) predicate = false;
    }
    if (predicate) armed = true;

    const ceiling = cfg.Vhard && p.rawTokens >= cfg.Vhard;
    let flipped = false;
    if (mode === 'raw' && (armed || ceiling)) {
      mode = 'distilled'; armed = false; flipped = true;
      resets++; fireTurnSum += i + 1; lastDistillTurn = i + 1; lastAdvanceTurn = i + 1;
    }

    const hist = mode === 'distilled' ? p.distHistTokens : p.rawHistTokens;

    // Does the prefix stay stable this turn, or does the surface get rewritten?
    let rewritten = flipped;
    if (mode === 'distilled' && !flipped) {
      const grew = p.distHistTokens > (points[i - 1] ? points[i - 1].distHistTokens : 0);
      if (grew) {
        if (cfg.refreeze === 'rounds') {
          const since = (i + 1) - lastAdvanceTurn;
          if (since >= cfg.R) { rewritten = true; advances++; lastAdvanceTurn = i + 1; }
          else rewritten = false;  // hold the old prefix (stale distillation)
        } else { rewritten = true; advances++; lastAdvanceTurn = i + 1; }
      }
    }

    const surface = hist + p.turnTokens;
    // Stable prefix survives only if the surface was not rewritten AND the cache survived.
    let hit = 0;
    if (i > 0 && !rewritten && !cold) hit = Math.min(surface, prevHist);
    const unc = Math.max(0, surface - hit);

    uncached += unc; cached += hit;
    prevHist = hist;
    turns++;
  }
  return { uncached, cached, resets, advances, turns, fireTurnSum };
}

function evaluate(cfg, seeds = 5) {
  let unc = 0, cac = 0, resets = 0, adv = 0, turns = 0, fireTurn = 0, fired = 0, total = 0;
  for (let s = 0; s < seeds; s++) {
    const rng = mulberry32(1000 + s * 97);
    for (const c of curves) {
      const r = simulate(c.points, cfg, rng);
      unc += r.uncached; cac += r.cached; resets += r.resets; adv += r.advances;
      turns += r.turns; fireTurn += r.fireTurnSum; total++;
      if (r.resets > 0) fired++;
    }
  }
  const usd = unc * PRICE.uncached + cac * PRICE.cacheRead;
  return {
    usd: +(usd / seeds).toFixed(2),
    uncachedMTok: +(unc / seeds / 1e6).toFixed(1),
    hitRate: +(cac / Math.max(1, unc + cac)).toFixed(4),
    resetsPer100Turns: +((resets / Math.max(1, turns)) * 100).toFixed(2),
    meanFireTurn: resets > 0 ? +(fireTurn / resets).toFixed(2) : null,
    sessionFirePct: +((fired / total) * 100).toFixed(1),
    advancesPer100Turns: +((adv / Math.max(1, turns)) * 100).toFixed(2)
  };
}

const origin = evaluate({ policy: 'none', Vhard: null });
console.log('Origin: usd/replay=' + origin.usd + ' hitRate=' + origin.hitRate + ' uncachedMTok=' + origin.uncachedMTok);
console.log('');
console.log('=== A. shipped behaviour (stateless projection: frontier advances every turn) ===');
console.log('  R |    usd | vs origin | resets/100t | adv/100t | fired%');
for (const R of [1, 3, 5, 6, 8, 10, 16]) {
  const r = evaluate({ policy: 'rounds', R, minSurplus: 2000, Vhard: 256000, refreeze: 'never' });
  const d = ((r.usd - origin.usd) / origin.usd * 100).toFixed(1);
  console.log('  ' + String(R).padStart(2) + ' |' + String(r.usd).padStart(7) + ' |' + (d + '%').padStart(10)
    + ' |' + String(r.resetsPer100Turns).padStart(12) + ' |' + String(r.advancesPer100Turns).padStart(9)
    + ' |' + String(r.sessionFirePct).padStart(6));
}
console.log('');
console.log('=== B. hypothetical knob: frontier re-frozen every R turns ===');
console.log('  R |    usd | vs origin | resets/100t | adv/100t | fired%');
for (const R of [1, 3, 5, 6, 8, 10, 16]) {
  const r = evaluate({ policy: 'rounds', R, minSurplus: 2000, Vhard: 256000, refreeze: 'rounds' });
  const d = ((r.usd - origin.usd) / origin.usd * 100).toFixed(1);
  console.log('  ' + String(R).padStart(2) + ' |' + String(r.usd).padStart(7) + ' |' + (d + '%').padStart(10)
    + ' |' + String(r.resetsPer100Turns).padStart(12) + ' |' + String(r.advancesPer100Turns).padStart(9)
    + ' |' + String(r.sessionFirePct).padStart(6));
}
console.log('');
console.log('=== C. volume sweep, shipped behaviour ===');
console.log('     V |    usd | vs origin | resets/100t | fired%');
for (const V of [2000, 4000, 8000, 16000, 32000, 64000]) {
  const r = evaluate({ policy: 'volume', V, minSurplus: 2000, Vhard: 256000, refreeze: 'never' });
  const d = ((r.usd - origin.usd) / origin.usd * 100).toFixed(1);
  console.log(String(V).padStart(6) + ' |' + String(r.usd).padStart(7) + ' |' + (d + '%').padStart(10)
    + ' |' + String(r.resetsPer100Turns).padStart(12) + ' |' + String(r.sessionFirePct).padStart(6));
}
