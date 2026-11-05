/**
 * dsh-oswyn/core/primitives — shared atomic primitives for tool inspection,
 * session state tracking, and the two fundamental rewrite operations:
 *
 *   1. compressOutputOnly()     — ONLY replaces tool output (tool/result);
 *                                 preserves tool-call input arguments intact.
 *                                 Savings baseline: before = outputChars.
 *   2. discardInputAndOutput()  — Replaces BOTH tool-call input arguments
 *                                 (projected to "{}") AND tool output.
 *                                 Savings baseline: before = inputChars + outputChars.
 *
 * All modes (truncate, replace, discard, cascade, prune-call) and all presets
 * (standard, ptc) reuse these primitives so accounting and callId resolution
 * never diverge.
 *
 * @module dsh-oswyn/core/primitives
 */

import { plan as corePlan } from './plan.js';
import {
  appendToolResultReplace,
  getCallInputChars,
  getEventText,
  getToolName,
  isOnSurface
} from '../session/surface.js';

const processedAssistantEvents = new WeakMap();
const autoCompressSkips = new WeakMap();
const discardedCallIds = new WeakMap();

/** Mark one tool/result seq as explicitly protected by the agent. */
export function markAutoCompressSkip(session, seq) {
  if (!session || typeof session !== 'object' || !Number.isInteger(seq)) return;
  let skipped = autoCompressSkips.get(session);
  if (!skipped) {
    skipped = new Set();
    autoCompressSkips.set(session, skipped);
  }
  skipped.add(seq);
}

export function isAutoCompressSkipped(session, seq) {
  return Boolean(session && autoCompressSkips.get(session)?.has(seq));
}

/** Mark one tool-call id whose arguments should also be projected away to "{}". */
export function markCallArgsDiscarded(session, callId) {
  if (!session || typeof session !== 'object' || !callId) return;
  let ids = discardedCallIds.get(session);
  if (!ids) {
    ids = new Set();
    discardedCallIds.set(session, ids);
  }
  ids.add(String(callId));
}

export function isCallArgDiscarded(session, callId) {
  if (!session || !callId) return false;
  const cid = String(callId);
  if (discardedCallIds.get(session)?.has(cid)) return true;
  // Persistent fallback across session reloads: if the on-surface tool/result
  // for this callId carries a mode=discard oswyn-meta marker, its call args are discarded.
  try {
    if (typeof session.snapshotEvents === 'function') {
      const all = session.snapshotEvents();
      for (let i = all.length - 1; i >= 0; i -= 1) {
        const ev = all[i];
        if (!ev || ev.type !== 'tool/result') continue;
        const evCid = ev.data?.message?.source?.callId || ev.data?.message?.toolCallId || ev.data?.callId || '';
        if (evCid !== cid) continue;
        if (!isOnSurface(session, ev.seq)) continue;
        const txt = getEventText(ev);
        if (/\[oswyn-meta: [^\]]*mode=discard\b/.test(txt)) {
          markCallArgsDiscarded(session, cid);
          return true;
        }
        break;
      }
    }
  } catch (_) {}
  return false;
}

export function alreadyProcessed(session, assistantSeq) {
  if (!session || typeof session !== 'object' || !Number.isInteger(assistantSeq)) return false;
  return processedAssistantEvents.get(session)?.has(assistantSeq) === true;
}

export function markProcessed(session, assistantSeq) {
  if (!session || typeof session !== 'object' || !Number.isInteger(assistantSeq)) return;
  let seqs = processedAssistantEvents.get(session);
  if (!seqs) {
    seqs = new Set();
    processedAssistantEvents.set(session, seqs);
  }
  seqs.add(assistantSeq);
}

/** Pull plain text out of an assistant Message. */
export function assistantText(assistantMsg) {
  const content = assistantMsg?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Total character size + first callId of tool-call arguments in one assistant message. */
export function toolCallArgumentsSize(assistantMsg) {
  const blocks = Array.isArray(assistantMsg?.content) ? assistantMsg.content : [];
  let chars = 0;
  let callId = '';
  for (const block of blocks) {
    if (!block || block.type !== 'tool-call') continue;
    const cid = block.callId || block.id;
    if (!callId && typeof cid === 'string') callId = cid;
    const raw = block.arguments;
    if (typeof raw === 'string') chars += raw.length;
    else if (raw !== undefined && raw !== null) {
      try { chars += JSON.stringify(raw).length; } catch { /* ignore */ }
    }
  }
  return { chars, callId };
}

/** Resolve the callId of a tool/result event: direct source, else via sourceEventSeqs→tool/call across hops. */
export function resolveCallId(session, event) {
  if (!event) return '';
  let cur = event;
  const seen = new Set();
  for (let hop = 0; hop < 8 && cur; hop += 1) {
    const direct = cur.data?.message?.source?.callId ?? cur.data?.message?.toolCallId ?? cur.data?.callId;
    if (typeof direct === 'string' && direct) return direct;
    const srcs = cur.sourceEventSeqs;
    if (!Array.isArray(srcs)) break;
    let next = null;
    for (const s of srcs) {
      if (seen.has(s)) continue;
      seen.add(s);
      const srcEv = typeof session?.eventAt === 'function'
        ? session.eventAt(s)
        : (typeof session?.snapshotEvents === 'function' ? session.snapshotEvents().find((e) => e?.seq === s) : null);
      if (srcEv?.type === 'tool/call' && typeof (srcEv.data?.callId || srcEv.data?.id) === 'string') {
        return String(srcEv.data.callId || srcEv.data.id);
      }
      if (srcEv?.type === 'tool/result' && !next) {
        next = srcEv;
      }
    }
    cur = next;
  }
  // Fallback: scan preceding events in the same step for the matching tool/call
  if (typeof session?.snapshotEvents === 'function' && Number.isInteger(event.seq)) {
    const all = session.snapshotEvents();
    const targetName = getToolName(session, event);
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const ev = all[i];
      if (!ev || typeof ev.seq !== 'number' || ev.seq >= event.seq) continue;
      if (ev.type === 'user/message' || ev.type === 'assistant/message') break;
      if (ev.type === 'tool/call') {
        const cid = ev.data?.callId || ev.data?.id;
        if (cid && (!targetName || !ev.data?.name || String(ev.data.name).toLowerCase() === String(targetName).toLowerCase())) {
          return String(cid);
        }
      }
    }
  }
  return '';
}

/**
 * Inspect both input (tool-call.arguments) and output (tool/result) dimensions
 * of a tool execution.
 */
export function inspectToolCall(session, event, explicitCallId = '') {
  const callId = explicitCallId || resolveCallId(session, event);
  const toolName = (session && event ? getToolName(session, event) : '') || '';
  const outputText = event ? getEventText(event) : '';
  const outputChars = outputText.length;
  const inputChars = (session && (event || callId)) ? getCallInputChars(session, event, callId) : 0;
  const isRunCode = toolName.toLowerCase() === 'run_code';
  return {
    callId,
    toolName,
    inputChars,
    outputChars,
    totalChars: inputChars + outputChars,
    outputText,
    isRunCode
  };
}

/** Last seq at or before `assistantSeq` whose event is a tool/result (preferring uncompressed on-surface results). */
export function findLatestToolResult(session, assistantSeq) {
  const all = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  const limit = typeof assistantSeq === 'number' ? assistantSeq : Infinity;
  let fallback = null;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const ev = all[i];
    if (!ev || ev.seq >= limit) continue;
    if (ev.type === 'user/message') break;
    if (ev.type === 'tool/result') {
      if (!fallback) fallback = ev;
      const txt = getEventText(ev);
      if (isOnSurface(session, ev.seq) && !txt.includes('[oswyn-meta:')) {
        return ev;
      }
    }
  }
  if (fallback) return fallback;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const ev = all[i];
    if (ev.seq >= limit) continue;
    if (ev.type === 'tool/result') return ev;
  }
  return null;
}

/**
 * Resolve a parsed target directive to a concrete tool/result event.
 * @returns {{seq:number, event:object}|null}
 */
export function resolveTarget(session, parsed, assistantSeq) {
  const all = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  const limit = typeof assistantSeq === 'number' ? assistantSeq : Infinity;

  if (parsed.targetSeq !== null && parsed.targetSeq !== undefined) {
    const ev = typeof session.eventAt === 'function' ? session.eventAt(parsed.targetSeq) : null;
    if (ev && ev.type === 'tool/result') return { seq: ev.seq, event: ev };
  }

  if (parsed.targetTool) {
    const wanted = String(parsed.targetTool).toLowerCase();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const ev = all[i];
      if (ev.seq >= limit) continue;
      if (ev.type === 'tool/result' && (getToolName(session, ev) || '').toLowerCase() === wanted) {
        return { seq: ev.seq, event: ev };
      }
    }
  }

  const latest = findLatestToolResult(session, assistantSeq);
  return latest ? { seq: latest.seq, event: latest } : null;
}

/**
 * PRIMITIVE 1: COMPRESS OUTPUT ONLY (只替换输出，保留工具调用输入参数)
 *
 * Used by `truncate` and `replace`.
 * - Preserves `assistant/message` tool-call arguments untouched.
 * - Replaces only the `tool/result` surface node.
 * - Worth-it check strictly compares `after < outputChars` (`before = outputChars`, `inputChars = 0`).
 */
export function compressOutputOnly(session, target, parsedWithSeq, opts = {}) {
  const { callId, toolName } = inspectToolCall(session, target.event);
  const planResult = corePlan(target, parsedWithSeq, toolName);
  if (planResult.rejected) {
    return {
      ok: false,
      rejectedReason: planResult.rejected,
      reentrantBlocked: false
    };
  }
  const write = appendToolResultReplace(session, target.seq, planResult.content);
  if (!write.ok) {
    const reentrantBlocked = /cannot reenter/i.test(write.reason || '');
    return {
      ok: false,
      rejectedReason: `tool/result replace failed: ${write.reason}`,
      reentrantBlocked
    };
  }
  return {
    ok: true,
    reentrantBlocked: false,
    appliedEntry: {
      seq: target.seq,
      mode: planResult.mode,
      toolName,
      callId,
      keepChars: planResult.keepChars,
      keepLines: planResult.keepLines ?? null,
      before: planResult.before,
      inputChars: 0,
      after: planResult.after,
      summary: parsedWithSeq.summary || '',
      fact: parsedWithSeq.fact || '',
      trigger: opts.trigger || 'agent'
    }
  };
}

/**
 * PRIMITIVE 2: DISCARD INPUT AND OUTPUT (同时替换调用输入参数与输出结果)
 *
 * Used by `discard`, `cascade`, and `discard entire-ptc`.
 * - Clears `assistant/message` tool-call arguments to `"{}"` (when `shouldDiscardArgs` is true).
 * - Replaces the `tool/result` surface node with a compact 1-line fact + `[oswyn-meta:]`.
 * - Savings baseline includes BOTH discarded input and output: `before = outputChars + inputChars`.
 */
export function discardInputAndOutput(session, target, opts = {}) {
  const { callId, toolName, inputChars: rawInputChars, outputChars, isRunCode } = inspectToolCall(session, target.event);
  const entirePtc = Boolean(opts.entirePtc);
  const shouldDiscardArgs = opts.shouldDiscardArgs !== undefined
    ? Boolean(opts.shouldDiscardArgs && callId)
    : Boolean(callId && (!isRunCode || entirePtc));
  const inputChars = shouldDiscardArgs ? rawInputChars : 0;
  const totalBefore = outputChars + inputChars;
  const fact = (opts.fact || opts.summary || '').trim() || 'Discarded by agent';

  const planResult = corePlan(
    { seq: target.seq, event: target.event },
    { mode: 'discard', seq: target.seq, summary: fact, fact },
    toolName
  );
  let content = planResult.content;
  let after = planResult.after;
  if (!content || inputChars > 0) {
    // Re-encode with totalBefore (including discarded call inputChars) or when outputChars was small
    const built = corePlan(
      { seq: target.seq, event: { data: { message: { content: [{ type: 'text', text: 'x'.repeat(Math.max(25, totalBefore)) }] } } } },
      { mode: 'discard', seq: target.seq, summary: fact, fact },
      toolName
    );
    if (built && built.content) {
      content = built.content;
      after = built.after;
    }
  }
  if (!content || after >= totalBefore) {
    return {
      ok: false,
      rejectedReason: planResult.rejected || `discard not worth it: ${after} >= ${totalBefore}`,
      reentrantBlocked: false
    };
  }
  const write = appendToolResultReplace(session, target.seq, content);
  if (!write.ok) {
    const reentrantBlocked = /cannot reenter/i.test(write.reason || '');
    return {
      ok: false,
      rejectedReason: `discard replace failed: ${write.reason}`,
      reentrantBlocked
    };
  }
  if (shouldDiscardArgs && callId) {
    try { markCallArgsDiscarded(session, callId); } catch (_) {}
  }
  return {
    ok: true,
    reentrantBlocked: false,
    appliedEntry: {
      seq: target.seq,
      mode: 'discard',
      toolName,
      callId,
      keepLines: null,
      before: totalBefore,
      inputChars,
      after,
      fact,
      summary: fact,
      trigger: opts.trigger || 'agent'
    }
  };
}
