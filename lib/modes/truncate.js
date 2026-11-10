/**
 * dsh-oswyn/modes/truncate — Mode A: Prefix Truncation (Compress Output Only).
 *
 * Semantics:
 *   - Keeps the first N lines or N chars from byte 0 (100% KV-cache prefix hit).
 *   - Replaces ONLY the tool output (`tool/result`); preserves tool-call input arguments intact.
 *   - Supports both agent-guided active truncation and tiered automatic truncation.
 *
 * @module dsh-oswyn/modes/truncate
 */

import { compressOutputOnly, isAutoCompressSkipped, resolveCallId } from '../core/primitives.js';
import { applyActiveReplace } from './replace.js';
import { appendToolResultReplace, getToolName, isOnSurface } from '../session/surface.js';
import { planAutoCompress } from '../session/auto-policy.js';

/** Normalize a parsed truncate directive (falling back to autoCompressKeepLines on bare `truncate`). */
export function normalizeTruncateDirective(parsed, opts = {}) {
  if (parsed.explicitMode === 'truncate' && !(Number.isFinite(parsed.keepCount) && parsed.keepCount > 0)) {
    return {
      ...parsed,
      mode: 'truncate',
      keepCount: Number(opts.autoCompressKeepLines) > 0 ? Math.trunc(Number(opts.autoCompressKeepLines)) : 30,
      keepUnit: 'lines'
    };
  }
  return { ...parsed, mode: 'truncate' };
}

/**
 * Active agent-guided prefix truncation (`truncate keep <N> lines|chars`).
 * Strictly replaces output only (leaves call input arguments untouched).
 */
export function applyActiveTruncate(session, target, parsed, opts = {}) {
  const normalized = normalizeTruncateDirective(parsed, opts);
  const parsedWithSeq = { ...normalized, seq: target.seq };
  const res = compressOutputOnly(session, target, parsedWithSeq, { trigger: 'agent' });
  if (!res.ok && parsed.summary && target && /covers all|nothing pruned|without a keep size/i.test(res.rejectedReason || '')) {
    // When truncate keep N covers all lines or has no size, but agent supplied a summary and content is large,
    // gracefully fall back to replace rather than rejecting and leaving massive payload in context!
    return applyActiveReplace(session, target, { ...parsed, mode: 'replace', explicitMode: 'replace' }, opts);
  }
  return res;
}

/**
 * Automatic prefix truncation for oversized non-protected tool results.
 * Strictly replaces output only (leaves call input arguments untouched).
 */
export function applyAutoTruncate(session, event, opts = {}) {
  try {
    if (!session || !event || event.type !== 'tool/result') return null;
    if (isAutoCompressSkipped(session, event.seq)) return null;
    if (!isOnSurface(session, event.seq)) return null;
    const toolName = getToolName(session, event) || '';
    const plan = planAutoCompress(event, {
      minChars: opts.minChars,
      keepLines: opts.keepLines,
      toolName
    });
    if (!plan) return null;
    const write = appendToolResultReplace(session, event.seq, plan.content);
    if (!write.ok) return null;
    return { ...plan, callId: resolveCallId(session, event) };
  } catch {
    return null;
  }
}
