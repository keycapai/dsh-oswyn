/**
 * dsh-oswyn/session/applier — orchestration of surface rewrites from an
 * assistant message's oswyn fences.
 *
 * Responsibilities:
 *   - Parse tool-result summary fences → plan (core/plan) → tool/result replace.
 *   - Handle discard / cascade → fold a span of failed calls to ONE user/message
 *     checkpoint (real negative delta via surface.appendCheckpointReplace).
 *   - Reply summary (dsh-reply-summary) → checkpoint-replace the assistant range
 *     with a memo (real negative delta). NEVER writes the old
 *     oswyn/assistant-summary append-only event.
 *   - prune-call / stub-call → prune tool-call arguments of the assistant message
 *     via core/projection and return a message-projection directive for the
 *     E-stage index to register (tool-call args cannot use surfaceOp).
 *
 * ALL kernel errors are caught and returned as {ok:false, reason}; nothing throws.
 *
 * @module dsh-oswyn/session/applier
 */

import {
  findAllSummaryBlocks,
  findSummaryBlock,
  findReplySummaryBlock,
  parseReplySummaryBody,
  parseSummaryBody
} from '../core/parse.js';
import { plan as corePlan, measureTarget } from '../core/plan.js';
import { pruneToolCallArgs } from '../core/projection.js';
import {
  appendToolResultReplace,
  appendCheckpointReplace,
  getCallInputChars,
  getEventText,
  getToolName,
  isOnSurface
} from './surface.js';
import { decideRetention, groupDiscard, analyze } from './retain.js';
import { addProtectedTool } from '../store/ledger.js';
import { planAutoCompress, planAutoDiscard } from './auto-policy.js';

/**
 * Assistant events are observed twice by the plugin: once on session/event and
 * again at agent/pre-step. Remember processed event seqs per session so the
 * second observer cannot rewrite the same tool result (or emit a duplicate
 * ledger entry). Weak keys avoid retaining closed sessions.
 */
const processedAssistantEvents = new WeakMap();
const autoCompressSkips = new WeakMap();
const discardedCallIds = new WeakMap();

/** Mark one tool/result seq as explicitly protected by the agent. */
export function markAutoCompressSkip(session, seq) {
  if (!session || typeof session !== 'object' || !Number.isInteger(seq)) return;
  let skipped = autoCompressSkips.get(session);
  if (!skipped) { skipped = new Set(); autoCompressSkips.set(session, skipped); }
  skipped.add(seq);
}

export function isAutoCompressSkipped(session, seq) {
  return Boolean(session && autoCompressSkips.get(session)?.has(seq));
}

/** Mark one tool-call id whose arguments should also be projected away. */
export function markCallArgsDiscarded(session, callId) {
  if (!session || typeof session !== 'object' || !callId) return;
  let ids = discardedCallIds.get(session);
  if (!ids) { ids = new Set(); discardedCallIds.set(session, ids); }
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

function markProcessed(session, assistantSeq) {
  if (!session || typeof session !== 'object' || !Number.isInteger(assistantSeq)) return;
  let seqs = processedAssistantEvents.get(session);
  if (!seqs) {
    seqs = new Set();
    processedAssistantEvents.set(session, seqs);
  }
  seqs.add(assistantSeq);
}

/** Pull the plain text out of an assistant Message. */
function assistantText(assistantMsg) {
  const content = assistantMsg?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Total character size + first callId of tool-call arguments in one assistant message. */
function toolCallArgumentsSize(assistantMsg) {
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

/** Earlier failed tool results in this user turn, still on the surface. */
function priorFailedToolResults(session, beforeSeq) {
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

/** Resolve the callId of a tool/result event: direct source, else via sourceEventSeqs→tool/call across hops. */
function resolveCallId(session, event) {
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

/** Last seq at or before `assistantSeq` whose event is a tool/result (preferring uncompressed on-surface results). */
function findLatestToolResult(session, assistantSeq) {
  const all = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
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
  const all = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
  const limit = typeof assistantSeq === 'number' ? assistantSeq : Infinity;

  // Explicit numeric seq.
  if (parsed.targetSeq !== null && parsed.targetSeq !== undefined) {
    const ev = typeof session.eventAt === 'function' ? session.eventAt(parsed.targetSeq) : null;
    if (ev && ev.type === 'tool/result') return { seq: ev.seq, event: ev };
  }

  // By tool name (latest before the assistant message).
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

  // Default: latest tool/result preceding the assistant message.
  const latest = findLatestToolResult(session, assistantSeq);
  return latest ? { seq: latest.seq, event: latest } : null;
}

/**
 * Apply all oswyn fences found in an assistant message.
 *
 * @param {object} session
 * @param {object} assistantMsg  the assistant Message ({content:[...]})
 * @param {number} [assistantSeq]  seq of the assistant/message event
 * @param {{pruneCall?:boolean, maxCodeLen?:number, maxSpecLen?:number}} [opts]
 * @returns {{
 *   applied:Array<{seq:number,mode:string,before:number,after:number,keepChars?:number,fact?:string,summary?:string}>,
 *   replySummary:({targetSeq:(number|undefined),summary:string}|null),
 *   rejected:string[],
 *   checkpoint:({startSeq:number,endSeq:number,seq:number,count:number}|null),
 *   callArgProjection:({message:object,changed:boolean}|null),
 *   error?:string
 * }}
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
      // carry only summary/fact bullets: treat it as `replace` rather than
      // rejecting it. This removes the protocol/parser contradiction.
      if (!parsed.explicitMode && !parsed.pruneCall && (parsed.summary || parsed.fact)) {
        parsed.mode = 'replace';
        parsed.explicitMode = 'replace';
      }
      // A bare `truncate` without a count falls back to the configured default
      // keep line count (autoCompressKeepLines, 30 by default) instead of being
      // rejected outright.
      if (parsed.explicitMode === 'truncate' && !(Number.isFinite(parsed.keepCount) && parsed.keepCount > 0)) {
        parsed.keepCount = Number(opts.autoCompressKeepLines) > 0 ? Math.trunc(Number(opts.autoCompressKeepLines)) : 30;
        parsed.keepUnit = 'lines';
      }
      // `protect-tool <name>` extends the runtime protection list.
      if (parsed.protectTool) {
        try { addProtectedTool(parsed.protectTool, true); } catch (_) {}
        result.protectedTools.push(parsed.protectTool);
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
      // Per-call opt-out: keep the original result untouched and make sure the
      // automatic fallback never rewrites this seq later.
      if (parsed.mode === 'keep') {
        markAutoCompressSkip(session, target.seq);
        result.protectedCalls.push({ seq: target.seq, toolName: getToolName(session, target.event) || '', reason: parsed.summary || '' });
        continue;
      }
      // Give plan() an explicit seq for the marker.
      const parsedWithSeq = { ...parsed, mode: parsed.mode, seq: target.seq };

      // Only an EXPLICIT agent directive overrides retention. A fence that just
      // carries facts must not silently be treated as `replace`.
      const retention = decideRetention(target, parsed, { session });
      const explicit = parsed.explicitMode || null;
      if (explicit === null) {
        if (parsed.pruneCall || parsed.stubCall) {
          continue;
        }
        result.rejected.push(
          'no explicit directive (expected truncate keep <N> lines | replace | discard); retention would be: '
          + retention.action
        );
        continue;
      }
      if (explicit === 'prune-call') {
        continue;
      }
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

      const before = measureTarget(target);
      const planResult = corePlan(target, parsedWithSeq, getToolName(session, target.event) || '');
      if (planResult.rejected) {
        result.rejected.push(planResult.rejected);
        continue;
      }
      const write = appendToolResultReplace(session, target.seq, planResult.content);
      if (!write.ok) {
        if (/cannot reenter/i.test(write.reason || '')) reentrantBlocked = true;
        result.rejected.push(`tool/result replace failed: ${write.reason}`);
        continue;
      }
      result.applied.push({
        seq: target.seq,
        mode: planResult.mode,
        toolName: getToolName(session, target.event) || '',
        callId: resolveCallId(session, target.event),
        keepChars: planResult.keepChars,
        keepLines: planResult.keepLines ?? null,
        before: planResult.before,
        after: planResult.after,
        summary: parsed.summary || '',
        fact: parsed.fact || '',
        trigger: 'agent'
      });

      // ---- cascade: fold EARLIER failed calls in this user turn, never the
      // successful result that just landed. Runs only after a real rewrite.
      if (parsed.cascadePrune) {
        for (const failed of priorFailedToolResults(session, target.seq)) {
          const grouped = groupDiscard([failed], { session });
          if (!grouped.ok) continue;
          const cascadeCallId = resolveCallId(session, failed.event);
          const inputChars = cascadeCallId ? getCallInputChars(session, failed.event, cascadeCallId) : 0;
          const before = failed.text.length + inputChars;
          const writeCascade = appendCheckpointReplace(session, failed.seq, failed.seq, grouped.fact);
          if (!writeCascade.ok) {
            if (/cannot reenter/i.test(writeCascade.reason || '')) reentrantBlocked = true;
            result.rejected.push(`cascade checkpoint failed for seq ${failed.seq}: ${writeCascade.reason}`);
            continue;
          }
          if (cascadeCallId) {
            try { markCallArgsDiscarded(session, cascadeCallId); } catch (_) {}
          }
          result.applied.push({
            seq: failed.seq,
            mode: 'discard',
            toolName: getToolName(session, failed.event) || '',
            callId: cascadeCallId,
            keepLines: null,
            before,
            inputChars,
            after: grouped.fact.length,
            fact: grouped.fact,
            summary: grouped.fact
          });
        }
      }
    }

    // ---- 1b. prune-call / stub-call → argument projection (independent of
    // tool-result compression; always applied to the assistant message itself)
    if (pruneRequested && opts.pruneCall !== false) {
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
        result.callArgProjection = { message: pruned, changed: true };
        result.applied.push({
          seq: targetCallSeq ?? null,
          mode: 'prune-call',
          toolName: 'tool-call',
          callId: beforeArgs.callId || '',
          before: beforeArgs.chars,
          after: afterArgs.chars,
          summary: stubRequested ? '已将超长调用参数替换为伪代码占位 (stub-call)' : '已折叠超长调用参数 (prune-call)',
          trigger: 'agent'
        });
      } else {
        result.rejected.push('prune-call requested but no oversized tool-call code/spec arguments');
      }
    }

    // ---- 2. discard handling ----
    // Single-target discard uses a single-node tool/result replace (embedding
    // [oswyn-meta:] directly into the tool result) so it never injects a fake
    // user/message bubble into the chat UI and works whether the tool row is
    // collapsed or expanded. Multi-target span discard keeps the checkpoint path.
    if (discardTargets.length === 1) {
      const t = discardTargets[0];
      if (isOnSurface(session, t.seq)) {
        const toolName = getToolName(session, t.event) || '';
        const discardCallId = resolveCallId(session, t.event);
        const isRunCode = toolName.toLowerCase() === 'run_code';
        const shouldDiscardArgs = Boolean(discardCallId && (!isRunCode || t.entirePtc));
        const inputChars = shouldDiscardArgs ? getCallInputChars(session, t.event, discardCallId) : 0;
        const origLen = getEventText(t.event).length;
        const fact = (t.fact || '').trim() || 'Discarded by agent';
        const planResult = corePlan(
          { seq: t.seq, event: t.event },
          { mode: 'discard', seq: t.seq, summary: fact, fact },
          toolName
        );
        const totalBefore = origLen + inputChars;
        let content = planResult.content;
        let after = planResult.after;
        if (!content || inputChars > 0) {
          // Re-encode with totalBefore (including discarded call inputChars) or when origLen was small
          const built = corePlan(
            { seq: t.seq, event: { data: { message: { content: [{ type: 'text', text: 'x'.repeat(Math.max(25, totalBefore)) }] } } } },
            { mode: 'discard', seq: t.seq, summary: fact, fact },
            toolName
          );
          if (built && built.content) {
            content = built.content;
            after = built.after;
          }
        }
        if (content && after < totalBefore) {
          const write = appendToolResultReplace(session, t.seq, content);
          if (write.ok) {
            if (shouldDiscardArgs) {
              try { markCallArgsDiscarded(session, discardCallId); } catch (_) {}
            }
            result.applied.push({
              seq: t.seq,
              mode: 'discard',
              toolName,
              callId: discardCallId,
              keepLines: null,
              before: totalBefore,
              inputChars,
              after,
              fact,
              summary: fact,
              trigger: 'agent'
            });
          } else {
            if (/cannot reenter/i.test(write.reason || '')) reentrantBlocked = true;
            result.rejected.push(`discard replace failed: ${write.reason}`);
          }
        } else {
          result.rejected.push(planResult.rejected || `discard not worth it: ${after} >= ${totalBefore}`);
        }
      } else {
        result.rejected.push('discard target not on current surface');
      }
    } else if (discardTargets.length > 1) {
      const grouped = groupDiscard(discardTargets, { session });
      if (grouped.ok) {
        // Only collapse a contiguous run that is actually on the current surface.
        const allOnSurface = discardTargets.every((t) => isOnSurface(session, t.seq));
        if (allOnSurface) {
          const write = appendCheckpointReplace(session, grouped.startSeq, grouped.endSeq, grouped.fact);
          if (write.ok) {
            result.checkpoint = {
              startSeq: grouped.startSeq,
              endSeq: grouped.endSeq,
              seq: write.seq,
              count: grouped.count
            };
            for (const t of discardTargets) {
              const toolName = getToolName(session, t.event) || '';
              const discardCallId = resolveCallId(session, t.event);
              const isRunCode = toolName.toLowerCase() === 'run_code';
              const shouldDiscardArgs = Boolean(discardCallId && (!isRunCode || t.entirePtc));
              if (shouldDiscardArgs) {
                try { markCallArgsDiscarded(session, discardCallId); } catch (_) {}
              }
              const inputChars = shouldDiscardArgs ? getCallInputChars(session, t.event, discardCallId) : 0;
              const before = getEventText(t.event).length + inputChars;
              result.applied.push({
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
          } else {
            if (/cannot reenter/i.test(write.reason || '')) reentrantBlocked = true;
            result.rejected.push(`discard checkpoint failed: ${write.reason}`);
          }
        } else {
          result.rejected.push('discard span not fully on current surface');
        }
      } else {
        result.rejected.push(grouped.reason || 'discard grouping failed');
      }
    }

    // ---- 3. reply summary → checkpoint-replace the assistant range ----
    const replyBlock = findReplySummaryBlock(text);
    if (replyBlock && opts.replySummaryEnabled !== false) {
      const parsed = parseReplySummaryBody(replyBlock.rawHeader, replyBlock.body);
      const targetSeq = parsed.targetSeq ?? assistantSeq;
      const summary = (parsed.summary || '').trim();
      if (Number.isInteger(targetSeq) && summary && isOnSurface(session, targetSeq)) {
        // Cover from the target assistant seq through the latest surface node
        // BEFORE this assistant message's own tail, i.e. replace exactly the
        // assistant node itself (single-node) — the safe negative-delta form.
        const write = appendCheckpointReplace(
          session,
          targetSeq,
          targetSeq,
          `[oswyn 双轨备忘] ${summary}`
        );
        if (write.ok) {
          result.replySummary = { targetSeq, summary, charsBefore: text.length };
        } else {
          if (/cannot reenter/i.test(write.reason || '')) reentrantBlocked = true;
          result.rejected.push(`reply checkpoint failed: ${write.reason}`);
        }
      }
    }

    // Suppress the duplicate pre-step pass ONLY when a rewrite actually landed
    // without hitting a transient kernel reentrancy lock.
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
 * Rewrite tool-call arguments of an assistant message and return the projected
 * Message plus whether anything changed. Used by the E-stage index to register a
 * message projection (tool-call args cannot use surfaceOp).
 *
 * @param {object} session
 * @param {object} assistantEvent  the assistant/message event
 * @param {{maxCodeLen?:number, maxSpecLen?:number}} [opts]
 * @returns {{ok:boolean, message?:object, changed:boolean, reason?:string}}
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
 * AUTOMATIC tool-output compression (no model fence required).
 *
 * The agent does not reliably emit dsh-result-summary fences for tool output, so
 * OSWYN compresses oversized tool results itself: keep the leading N lines
 * byte-for-byte (prompt-cache safe) and append a short structured tail, or fully
 * replace exploratory/failed output with a fact. Returns the applied record or null.
 *
 * @param {object} session
 * @param {object} event  the tool/result event
 * @param {{minChars?:number, keepLines?:number, replySummaryEnabled?:boolean}} [opts]
 */
export function autoCompressToolResult(session, event, opts = {}) {
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

export { analyze };


/**
 * Auto-discard a failed tool result, or a tool explicitly listed in the
 * "always discard regardless of size" list. One surface replace only.
 */
export function autoDiscardToolResult(session, event, opts = {}) {
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
