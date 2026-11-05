/**
 * dsh-oswyn/presets — Preset router & unified entry for `standard` (native) and `ptc`.
 *
 * Isolates preset-specific behavior while sharing the underlying mode modules
 * (`lib/modes/*`) and atomic primitives (`lib/core/primitives.js`).
 *
 * @module dsh-oswyn/presets
 */

import { applyFromAssistantMessage, runStandardAutoPolicies } from './standard.js';
import { collectPtcSubcalls, autoCompressPtcSubcalls, runPtcAutoPolicies } from './ptc.js';

export {
  applyFromAssistantMessage,
  runStandardAutoPolicies,
  collectPtcSubcalls,
  autoCompressPtcSubcalls,
  runPtcAutoPolicies
};

/**
 * Resolve the active preset mode ('ptc' | 'native') from a DSH plugin context or session header.
 */
export function resolveSessionPreset(ctx, context, session = null) {
  try {
    const tools = ctx?.tools || (typeof ctx?.get === 'function' ? ctx.get('tools') : undefined);
    if (tools && typeof tools.modeFor === 'function') {
      const mode = tools.modeFor(context?.scope);
      if (mode === 'ptc') return 'ptc';
    }
    const headerPreset = session?.header?.agentPreset || session?.agentPreset;
    if (headerPreset === 'ptc') return 'ptc';
  } catch (_) {}
  return 'native';
}

/**
 * Run all automatic policies (standard + PTC envelope) for a step boundary.
 */
export function runAllAutoPolicies(session, seenResults, resolved, helpers = {}) {
  const stdApplied = runStandardAutoPolicies(session, seenResults, resolved, helpers);
  const ptcApplied = runPtcAutoPolicies(session, seenResults, resolved, helpers);
  return [...stdApplied, ...ptcApplied];
}
