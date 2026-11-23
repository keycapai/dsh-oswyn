#!/usr/bin/env node
/**
 * verify-deep-distill.mjs — prove the deep (post-cache) distillation actually saves.
 *
 * Runs the shipped v2.4 policy engine over the real transcript curves with the
 * configuration that lib/core/triggers.js + lib/config.js now ship, and compares it
 * against Origin Replay (no distillation at all).
 *
 * Usage: node paper/scripts/v24/verify-deep-distill.mjs [--seeds N]
 */
import { loadCurves, loadTtft, evaluate } from './policy-engine.mjs';
import { TRIGGER_DEFAULTS } from '../../../lib/core/triggers.js';
import { CONFIG_DEFAULTS } from '../../../lib/config.js';

const argSeeds = (() => {
  const i = process.argv.indexOf('--seeds');
  if (i === -1) return 10;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 10;
})();

const curves = loadCurves();
const TTFT = loadTtft();
const ttftMs = (u) => Math.max(120, TTFT.a + TTFT.b * u);

// The shipped config: R / V / V_hard / floor all come from the real modules, so this
// script fails loudly if the shipped defaults drift away from what is simulated.
const shipped = {
  policy: 'hybrid',
  tauTtl: CONFIG_DEFAULTS.cacheTtlSeconds,
  V: CONFIG_DEFAULTS.triggerVolumeTokens,
  R: CONFIG_DEFAULTS.triggerRounds,
  rho: 8,
  Vhard: CONFIG_DEFAULTS.triggerCeilingTokens,
  minSurplus: CONFIG_DEFAULTS.triggerMinSurplusTokens,
  coalesce: false
};

console.log('shipped trigger defaults');
console.log('  R (rounds)      =', CONFIG_DEFAULTS.triggerRounds, '(module:', TRIGGER_DEFAULTS.triggerRounds + ')');
console.log('  V (volume)      =', CONFIG_DEFAULTS.triggerVolumeTokens, '(module:', TRIGGER_DEFAULTS.triggerVolumeTokens + ')');
console.log('  V_hard (ceiling)=', CONFIG_DEFAULTS.triggerCeilingTokens);
console.log('  floor (minSurpl)=', CONFIG_DEFAULTS.triggerMinSurplusTokens);
console.log('  TTL             =', CONFIG_DEFAULTS.cacheTtlSeconds, 's');
console.log('  coalesce        =', 'triggerCoalesce' in TRIGGER_DEFAULTS ? TRIGGER_DEFAULTS.triggerCoalesce : 'removed (eager only)');
console.log('  curves          =', curves.length, 'sessions');
console.log('  seeds           =', argSeeds);
console.log('');

const origin = evaluate(curves, { policy: 'none', Vhard: Infinity }, ttftMs, argSeeds);
const deep = evaluate(curves, shipped, ttftMs, argSeeds);

const pct = (a, b) => (b > 0 ? (((a - b) / b) * 100).toFixed(1) + '%' : '—');

console.log('metric                    origin      deep     change');
console.log('----------------------------------------------------------');
console.log('cost (USD/replay)      ' + String(origin.usdPerReplay).padStart(10) + '  ' + String(deep.usdPerReplay).padStart(8) + '  ' + pct(deep.usdPerReplay, origin.usdPerReplay).padStart(8));
console.log('uncached MTok/replay   ' + String(origin.uncachedMTokPerReplay).padStart(10) + '  ' + String(deep.uncachedMTokPerReplay).padStart(8) + '  ' + pct(deep.uncachedMTokPerReplay, origin.uncachedMTokPerReplay).padStart(8));
console.log('mean surface MTok      ' + String(origin.meanSurfaceMTok).padStart(10) + '  ' + String(deep.meanSurfaceMTok).padStart(8) + '  ' + pct(deep.meanSurfaceMTok, origin.meanSurfaceMTok).padStart(8));
console.log('mean history MTok      ' + String(origin.meanHistMTok).padStart(10) + '  ' + String(deep.meanHistMTok).padStart(8) + '  ' + pct(deep.meanHistMTok, origin.meanHistMTok).padStart(8));
console.log('TTFT p50 (ms)          ' + String(origin.ttft.p50).padStart(10) + '  ' + String(deep.ttft.p50).padStart(8) + '  ' + pct(deep.ttft.p50, origin.ttft.p50).padStart(8));
console.log('TTFT p99 (ms)          ' + String(origin.ttft.p99).padStart(10) + '  ' + String(deep.ttft.p99).padStart(8) + '  ' + pct(deep.ttft.p99, origin.ttft.p99).padStart(8));
console.log('resets / 100 turns     ' + String(origin.resetsPer100Turns).padStart(10) + '  ' + String(deep.resetsPer100Turns).padStart(8));
console.log('mean fire turn         ' + String(origin.meanFireTurn ?? '—').padStart(10) + '  ' + String(deep.meanFireTurn ?? '—').padStart(8));
console.log('sessions that fired    ' + (origin.sessionFirePct + '%').padStart(10) + '  ' + (deep.sessionFirePct + '%').padStart(8));
console.log('');

if (deep.sessionFirePct === 0) {
  console.error('FAIL: the shipped configuration never fires on this corpus.');
  process.exit(1);
}
if (!(deep.usdPerReplay < origin.usdPerReplay)) {
  console.error('FAIL: deep distillation did not reduce cost.');
  process.exit(1);
}
console.log('PASS: deep distillation fires on ' + deep.sessionFirePct + '% of sessions and cuts cost by ' + pct(deep.usdPerReplay, origin.usdPerReplay) + '.');
