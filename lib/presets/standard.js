/**
 * dsh-oswyn/presets/standard — Standard (Native) tool-calling preset orchestrator.
 *
 * Orchestrates active fence directives (`truncate`, `replace`, `discard`,
 * `cascade`, `prune-call`, `protect`, `dsh-reply-summary`) and automatic
 * policies (`autoDiscardToolResult`, `autoCompressToolResult`) by delegating
 * each mode to `lib/modes/*` and `lib/core/primitives.js`.
 *
 * @module dsh-oswyn/presets/standard
 */

import {
  findAllSummaryBlocks,
  findSummaryBlock,
  parseSummaryBody
} from '../core/parse.js';
import {
  alreadyProcessed,
  assistantText,
  markProcessed,
  resolveTarget
} from '../core/primitives.js';
import { getEventText } from '../session/surface.js';
import { decideRetention } from '../session/retain.js';
import {
  applyActiveTruncate,
  applyAutoTruncate,
  applyActiveReplace,
  applyCascadeDiscard,
  applyActiveDiscardTargets,
  applyActivePruneCall,
  applyAutoDiscard,
  applyProtectToolDirective,
  applyProtectCallDirective,
  applyReplySummary
} from '../modes/index.js';

/**
 * Apply all oswyn fences found in an assistant message.
 * Shared across standard and PTC sessions (PTC outer `run_code` is also a
 * `tool/result` surface node, with `entirePtc` / `targetSubcall` flags).
 */
export function applyFromAssistantMessage(session, assistantMsg, assistantSeq, opts = {}) {
  const result = {
    applied: [],
    replySummary: null,
    rejected: [],
    checkpoint: null,
    callArgProjection: null,
    protectedCalls: [],
    protectedTools: []
  };
  try {
    if (alreadyProcessed(session, assistantSeq)) {
      result.duplicate = true;
      return result;
    }
    const text = assistantText(assistantMsg);

    // ---- 1. tool-result summary fences ----
    let blocks = findAllSummaryBlocks(text);
    if (blocks.length === 0) {
      const single = findSummaryBlock(text);
      if (single) blocks = [single];
    }

    const discardTargets = [];
    let pruneRequested = false;
    let stubRequested = false;
    let reentrantBlocked = false;

    for (const block of blocks) {
      const parsed = parseSummaryBody(block.rawHeader, block.body);

      // Compatibility for model-authored fences that omit a directive word but
      // carry summary/fact bullets: treat as `replace` (compress output only).
      if (!parsed.explicitMode && !parsed.pruneCall && (parsed.summary || parsed.fact)) {
        parsed.mode = 'replace';
        parsed.explicitMode = 'replace';
      }

      // `protect-tool <name>` extends the runtime protection list.
      if (parsed.protectTool) {
        const added = applyProtectToolDirective(parsed.protectTool);
        if (added) result.protectedTools.push(added);
        continue;
      }

      if (parsed.pruneCall || parsed.stubCall) {
        pruneRequested = true;
        if (parsed.stubCall) stubRequested = true;
      }

      const target = resolveTarget(session, parsed, assistantSeq);
      if (!target) {
        result.rejected.push('no target tool/result found');
        continue;
      }

      // Per-call opt-out (`protect` / `no-compress`)
      if (parsed.mode === 'keep') {
        result.protectedCalls.push(applyProtectCallDirective(session, target, parsed));
        continue;
      }

      const retention = decideRetention(target, parsed, { session });
      const explicit = parsed.explicitMode || null;
      if (explicit === null) {
        if (parsed.pruneCall || parsed.stubCall) continue;
        result.rejected.push(
          'no explicit directive (expected truncate keep <N> lines | replace | discard); retention would be: '
          + retention.action
        );
        continue;
      }
      if (explicit === 'prune-call') {
        continue;
      }

      // Mode C: Discard (replaces BOTH input and output)
      if (explicit === 'discard' || retention.action === 'discard') {
        discardTargets.push({
          seq: target.seq,
          event: target.event,
          text: getEventText(target.event),
          fact: parsed.fact || parsed.summary || '',
          entirePtc: Boolean(parsed.entirePtc),
          targetSubcall: parsed.targetSubcall || null
        });
        continue;
      }

      // Mode A (Truncate) or Mode B (Replace): Compress Output Only (preserves input arguments)
      const outcome = explicit === 'truncate'
        ? applyActiveTruncate(session, target, parsed, opts)
        : applyActiveReplace(session, target, parsed, opts);

      if (outcome.reentrantBlocked) reentrantBlocked = true;
      if (!outcome.ok) {
        if (outcome.rejectedReason) result.rejected.push(outcome.rejectedReason);
        continue;
      }
      if (outcome.appliedEntry) {
        result.applied.push(outcome.appliedEntry);
      }

      // Cascade: fold earlier failed calls in this user turn (discards both input and output)
      if (parsed.cascadePrune) {
        const cascadeOut = applyCascadeDiscard(session, target.seq);
        if (cascadeOut.reentrantBlocked) reentrantBlocked = true;
        if (cascadeOut.applied.length > 0) result.applied.push(...cascadeOut.applied);
        if (cascadeOut.rejected.length > 0) result.rejected.push(...cascadeOut.rejected);
      }
    }

    // ---- 1b. prune-call / stub-call → argument projection ----
    if (pruneRequested && opts.pruneCall !== false) {
      const pruneOut = applyActivePruneCall(session, assistantMsg, assistantSeq, { stubRequested, opts });
      if (pruneOut.ok) {
        result.callArgProjection = pruneOut.callArgProjection;
        result.applied.push(pruneOut.appliedEntry);
      } else if (pruneOut.rejectedReason) {
        result.rejected.push(pruneOut.rejectedReason);
      }
    }

    // ---- 2. discard handling (replaces input + output) ----
    if (discardTargets.length > 0) {
      const discOut = applyActiveDiscardTargets(session, discardTargets);
      if (discOut.reentrantBlocked) reentrantBlocked = true;
      if (discOut.checkpoint) result.checkpoint = discOut.checkpoint;
      if (discOut.applied.length > 0) result.applied.push(...discOut.applied);
      if (discOut.rejected.length > 0) result.rejected.push(...discOut.rejected);
    }

    // ---- 3. reply summary (dual-track memo checkpoint) ----
    const replyOut = applyReplySummary(session, text, assistantSeq, opts);
    if (replyOut.reentrantBlocked) reentrantBlocked = true;
    if (replyOut.replySummary) result.replySummary = replyOut.replySummary;
    if (replyOut.rejectedReason) result.rejected.push(replyOut.rejectedReason);

    if (!reentrantBlocked && (result.applied.length > 0 || result.replySummary !== null || result.checkpoint !== null)) {
      markProcessed(session, assistantSeq);
    }
    return result;
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
    return result;
  }
}

/**
 * Run standard automatic policies (auto-discard failed/forced tools, then tiered auto-truncate)
 * on the recently seen tool results.
 */
export function runStandardAutoPolicies(session, seenResults, resolved, helpers = {}) {
  const applied = [];
  const { isProtectedTool, tieredFallbackEligible, lastMessage, hasFence, logger } = helpers;

  // Active-first contract: when the model emitted a result summary fence in its reply,
  // active distillation takes precedence and automatic fallback policies do not trigger.
  if (hasFence) return applied;

  // 1. Auto-Discard (replaces input + output for failed calls or force-discarded tools)
  if (resolved.autoDiscardFailed !== false || (Array.isArray(resolved.autoDiscardTools) && resolved.autoDiscardTools.length > 0)) {
    try {
      for (const latest of seenResults) {
        const entry = applyAutoDiscard(session, latest, {
          forceTools: resolved.autoDiscardTools
        });
        if (entry) applied.push(entry);
      }
    } catch (err) {
      logger?.debug?.('[dsh-oswyn] auto-discard skipped: ' + String(err).slice(0, 120));
    }
  }

  // 2. Tiered Auto-Compress (truncates output only, preserving prefix and call arguments)
  if (resolved.autoCompress || resolved.autoCompressTiered !== false) {
    try {
      for (const latest of seenResults) {
        const protectedCall = typeof isProtectedTool === 'function' ? isProtectedTool(session, latest, resolved) : false;
        const eligible = !protectedCall
          && (resolved.autoCompress === true
            || (resolved.autoCompressTiered !== false
              && (typeof tieredFallbackEligible === 'function'
                ? tieredFallbackEligible(session, latest, lastMessage, resolved)
                : true)));
        const entry = eligible ? applyAutoTruncate(session, latest, {
          minChars: resolved.autoCompressMinChars,
          keepLines: resolved.autoCompressKeepLines
        }) : null;
        if (entry) applied.push(entry);
      }
    } catch (err) {
      logger?.debug?.('[dsh-oswyn] auto-compression skipped: ' + String(err).slice(0, 120));
    }
  }

  return applied;
}
