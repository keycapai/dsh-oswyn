/**
 * dsh-oswyn/modes/replace — Mode B: Fact Replacement (Compress Output Only).
 *
 * Semantics:
 *   - Replaces exploratory or noisy tool output (`tool/result`) with concise
 *     distilled facts.
 *   - Preserves the tool-call input arguments (`tool-call.arguments`) intact so
 *     the model retains the exact file path / query / command in context.
 *   - Savings baseline: `before = outputChars` (worth-it requires `rewrite < outputChars`).
 *
 * @module dsh-oswyn/modes/replace
 */

import { compressOutputOnly } from '../core/primitives.js';

/**
 * Active agent-guided output replacement (`replace` or bare summary fallback).
 * Strictly replaces output only (leaves call input arguments untouched).
 */
export function applyActiveReplace(session, target, parsed, opts = {}) {
  const parsedWithSeq = {
    ...parsed,
    mode: 'replace',
    seq: target.seq
  };
  return compressOutputOnly(session, target, parsedWithSeq, { trigger: opts.trigger || 'agent' });
}
