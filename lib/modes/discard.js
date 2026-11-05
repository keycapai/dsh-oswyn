/**
 * dsh-oswyn/modes/discard — Mode C: Full Discard (Replaces Input + Output) & Call-Arg Pruning.
 *
 * Semantics:
 *   - Unlike `truncate` and `replace` (which only replace output), `discard`
 *     replaces BOTH the tool-call input arguments (`tool-call.arguments` -> `"{}"`)
 *     AND the tool-result output (`tool/result`), except when targeting a single
 *     subcall inside a multi-tool PTC `run_code` without `entire-ptc`.
 *   - Savings baseline: `before = inputChars + outputChars`.
 *   - Also houses `cascade` (folding earlier failed attempts in the same turn),
 *     `prune-call` / `stub-call` (shrinking oversized code/spec arguments), and
 *     automatic failure/policy discard (`applyAutoDiscard`).
 *
 * @module dsh-oswyn/modes/discard
 */

import {
  discardInputAndOutput,
  inspectToolCall,
  isAutoCompressSkipped,
  markCallArgsDiscarded,
  resolveCallId,
  toolCallArgumentsSize
} from '../core/primitives.js';
import { pruneToolCallArgs } from '../core/projection.js';
import {
  appendCheckpointReplace,
  appendToolResultReplace,
  getCallInputChars,
  getEventText,
  getToolName,
  isOnSurface
} from '../session/surface.js';
import { analyze, groupDiscard } from '../session/retain.js';
import { planAutoDiscard } from '../session/auto-policy.js';

/** Earlier failed tool results in this user turn, still on the surface. */
export function priorFailedToolResults(session, beforeSeq) {
  const all = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  const out = [];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const ev = all[i];
    if (!ev || typeof ev.seq !== 'number' || ev.seq >= beforeSeq) continue;
    if (ev.type === 'user/message') break; // never cross the current user turn
    if (ev.type !== 'tool/result') continue;
    if (!isOnSurface(session, ev.seq)) continue;
    const text = getEventText(ev);
    const isErrorMeta = Boolean(ev.data?.message?.isError || ev.data?.message?.source?.isError);
    if (!analyze(text, { isError: isErrorMeta }).isError) continue;
    out.push({ seq: ev.seq, event: ev, text });
  }
  return out.reverse();
}

/**
 * Fold earlier failed tool calls in the current turn after a retry succeeded (`cascade`).
 * Discards both input arguments and output of each failed call.
 */
export function applyCascadeDiscard(session, beforeSeq) {
  const applied = [];
  const rejected = [];
  let reentrantBlocked = false;

  for (const failed of priorFailedToolResults(session, beforeSeq)) {
    const grouped = groupDiscard([failed], { session });
    if (!grouped.ok) continue;
    const { callId: cascadeCallId, toolName, inputChars } = inspectToolCall(session, failed.event);
    const before = failed.text.length + inputChars;
    const writeCascade = appendCheckpointReplace(session, failed.seq, failed.seq, grouped.fact);
    if (!writeCascade.ok) {
      if (/cannot reenter/i.test(writeCascade.reason || '')) reentrantBlocked = true;
      rejected.push(`cascade checkpoint failed for seq ${failed.seq}: ${writeCascade.reason}`);
      continue;
    }
    if (cascadeCallId) {
      try { markCallArgsDiscarded(session, cascadeCallId); } catch (_) {}
    }
    applied.push({
      seq: failed.seq,
      mode: 'discard',
      toolName,
      callId: cascadeCallId,
      keepLines: null,
      before,
      inputChars,
      after: grouped.fact.length,
      fact: grouped.fact,
      summary: grouped.fact
    });
  }
  return { applied, rejected, reentrantBlocked };
}

/**
 * Apply active `discard` targets (single-node replace or multi-target checkpoint span).
 * Counts and clears discarded call input arguments (`inputChars`).
 */
export function applyActiveDiscardTargets(session, discardTargets) {
  const applied = [];
  const rejected = [];
  let checkpoint = null;
  let reentrantBlocked = false;

  if (!Array.isArray(discardTargets) || discardTargets.length === 0) {
    return { applied, rejected, checkpoint, reentrantBlocked };
  }

  if (discardTargets.length === 1) {
    const t = discardTargets[0];
    if (!isOnSurface(session, t.seq)) {
      rejected.push('discard target not on current surface');
      return { applied, rejected, checkpoint, reentrantBlocked };
    }
    const res = discardInputAndOutput(session, { seq: t.seq, event: t.event }, {
      fact: t.fact,
      entirePtc: t.entirePtc,
      trigger: 'agent'
    });
    if (res.reentrantBlocked) reentrantBlocked = true;
    if (res.ok && res.appliedEntry) {
      applied.push(res.appliedEntry);
    } else if (res.rejectedReason) {
      rejected.push(res.rejectedReason);
    }
    return { applied, rejected, checkpoint, reentrantBlocked };
  }

  // Multi-target span discard
  const grouped = groupDiscard(discardTargets, { session });
  if (!grouped.ok) {
    rejected.push(grouped.reason || 'discard grouping failed');
    return { applied, rejected, checkpoint, reentrantBlocked };
  }
  const allOnSurface = discardTargets.every((t) => isOnSurface(session, t.seq));
  if (!allOnSurface) {
    rejected.push('discard span not fully on current surface');
    return { applied, rejected, checkpoint, reentrantBlocked };
  }
  const write = appendCheckpointReplace(session, grouped.startSeq, grouped.endSeq, grouped.fact);
  if (!write.ok) {
    if (/cannot reenter/i.test(write.reason || '')) reentrantBlocked = true;
    rejected.push(`discard checkpoint failed: ${write.reason}`);
    return { applied, rejected, checkpoint, reentrantBlocked };
  }
  checkpoint = {
    startSeq: grouped.startSeq,
    endSeq: grouped.endSeq,
    seq: write.seq,
    count: grouped.count
  };
  for (const t of discardTargets) {
    const { callId: discardCallId, toolName, inputChars: rawInput, outputChars, isRunCode } = inspectToolCall(session, t.event);
    const shouldDiscardArgs = Boolean(discardCallId && (!isRunCode || t.entirePtc));
    if (shouldDiscardArgs) {
      try { markCallArgsDiscarded(session, discardCallId); } catch (_) {}
    }
    const inputChars = shouldDiscardArgs ? rawInput : 0;
    const before = outputChars + inputChars;
    applied.push({
      seq: t.seq,
      mode: 'discard',
      toolName,
      callId: discardCallId,
      keepLines: null,
      before,
      inputChars,
      after: grouped.fact.length,
      fact: grouped.fact,
      summary: t.fact || grouped.fact,
      trigger: 'agent'
    });
  }
  return { applied, rejected, checkpoint, reentrantBlocked };
}

/**
 * Apply `prune-call` / `stub-call` directive to shrink oversized tool-call `code`/`spec` arguments.
 */
export function applyActivePruneCall(session, assistantMsg, assistantSeq, { stubRequested = false, opts = {} } = {}) {
  let candidateMsg = assistantMsg;
  let targetCallSeq = assistantSeq;
  if (toolCallArgumentsSize(candidateMsg).chars === 0) {
    const allEvs = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
    for (let i = allEvs.length - 1; i >= 0; i -= 1) {
      const ev = allEvs[i];
      if (ev && ev.type === 'assistant/message' && toolCallArgumentsSize(ev.data?.message).chars > 0) {
        candidateMsg = ev.data.message;
        targetCallSeq = ev.seq;
        break;
      }
    }
  }
  const beforeArgs = toolCallArgumentsSize(candidateMsg);
  const limits = stubRequested
    ? { maxCodeLen: 0, maxSpecLen: 0 }
    : { maxCodeLen: opts.maxCodeLen, maxSpecLen: opts.maxSpecLen };
  const pruned = beforeArgs.chars > 0 ? pruneToolCallArgs(candidateMsg, limits) : candidateMsg;
  const afterArgs = pruned && pruned !== candidateMsg ? toolCallArgumentsSize(pruned) : beforeArgs;
  if (pruned && pruned !== candidateMsg && afterArgs.chars < beforeArgs.chars) {
    return {
      ok: true,
      callArgProjection: { message: pruned, changed: true },
      appliedEntry: {
        seq: targetCallSeq ?? null,
        mode: 'prune-call',
        toolName: 'tool-call',
        callId: beforeArgs.callId || '',
        before: beforeArgs.chars,
        after: afterArgs.chars,
        summary: stubRequested ? '已将超长调用参数替换为伪代码占位 (stub-call)' : '已折叠超长调用参数 (prune-call)',
        trigger: 'agent'
      }
    };
  }
  return {
    ok: false,
    rejectedReason: 'prune-call requested but no oversized tool-call code/spec arguments'
  };
}

/**
 * Rewrite tool-call arguments of an assistant message and return the projected
 * Message plus whether anything changed.
 */
export function applyCallArgRewrite(session, assistantEvent, opts = {}) {
  try {
    const msg = assistantEvent?.data?.message;
    if (!msg) return { ok: false, changed: false, reason: 'no assistant message' };
    const pruned = pruneToolCallArgs(msg, {
      maxCodeLen: opts.maxCodeLen,
      maxSpecLen: opts.maxSpecLen
    });
    return { ok: true, message: pruned, changed: pruned !== msg };
  } catch (error) {
    return { ok: false, changed: false, reason: String(error && error.message ? error.message : error) };
  }
}

/**
 * Automatic discard for failed tool results or force-discarded tools (`validate_dsh_ui`).
 * Replaces both input arguments (`markCallArgsDiscarded`) and output (`before = outputChars + inputChars`).
 */
export function applyAutoDiscard(session, event, opts = {}) {
  try {
    if (!session || !event || event.type !== 'tool/result') return null;
    if (isAutoCompressSkipped(session, event.seq)) return null;
    if (!isOnSurface(session, event.seq)) return null;
    const callId = resolveCallId(session, event);
    const inputChars = getCallInputChars(session, event, callId);
    const plan = planAutoDiscard(event, {
      forceTools: opts.forceTools,
      forceFailure: opts.forceFailure,
      toolName: getToolName(session, event) || '',
      inputChars
    });
    if (!plan) return null;
    const write = appendToolResultReplace(session, event.seq, plan.content);
    if (!write.ok) return null;
    const resolvedCallId = plan.callId || callId;
    try { markCallArgsDiscarded(session, resolvedCallId); } catch (_) {}
    return { ...plan, callId: resolvedCallId, inputChars };
  } catch (_) {
    return null;
  }
}
