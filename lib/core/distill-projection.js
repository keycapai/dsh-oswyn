/**
 * dsh-oswyn/core/distill-projection — the model-visible side of deep distillation.
 *
 * WHY THIS FILE EXISTS
 * The v2.4 implementation rewrote `agent/pre-step`'s `decision.messages`, but that
 * array only carries the messages newly claimed from the inbox for THIS step
 * (`dsh-agent-loop/src/inbox.ts claim()`). The real request is assembled by
 * `buildRequest()` from `session.deriveMessages()` (agent.ts:734), so the projection
 * never reached the model: the context grew monotonically and the recorded savings
 * were purely on paper.
 *
 * The kernel provides the correct seam: `SessionMessageProjection` — a pure
 * interpreter for a plugin-owned event type that changes EXISTING message content
 * while keeping surface node membership and message identity intact. That is
 * exactly what distillation is: the same conversation, with historical thinking /
 * tool traffic replaced by compact stand-ins.
 *
 * The event is durable and replayable, so a restored session derives the same
 * distilled surface without re-running any trigger.
 *
 * @module dsh-oswyn/core/distill-projection
 */

import { stripThinkingTags, stripResultSummaryFences, isOrganicUserMessage, isBackgroundJobStatusMessage } from './projection.js';

/** Event type carrying one distill decision. @type {string} */
export const OSWYN_DISTILL_EVENT = 'oswyn/distill';

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const DISTILLED_ARG_PLACEHOLDER = '[oswyn: 已蒸馏省略]';
const DISCARDED_ARG_PLACEHOLDER = '// [oswyn: discarded]';
const TOOL_PLACEHOLDER_RE = /^\[oswyn: 历史工具输出已蒸馏省略（原 \d+ 字符）\]$/;

function isToolCallBlock(block) {
  return Boolean(block && (block.type === 'tool-call' || block.type === 'tool_call' || block.type === 'tool_use'));
}

function isReasoningBlock(block) {
  return Boolean(block && (block.type === 'reasoning' || block.type === 'thinking' || block.type === 'thought'));
}

/** Character count of a message body (string or block array). */
function contentChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) {
    if (!block) continue;
    if (typeof block === 'string') n += block.length;
    else if (typeof block.text === 'string') n += block.text.length;
    else if (typeof block.content === 'string') n += block.content.length;
    else if (isToolCallBlock(block)) {
      const raw = block.arguments ?? block.input;
      if (typeof raw === 'string') n += raw.length;
      else if (raw !== undefined && raw !== null) {
        try { n += JSON.stringify(raw).length; } catch { n += 32; }
      }
    } else {
      try { n += JSON.stringify(block).length; } catch { n += 32; }
    }
  }
  return n;
}

/** Placeholder standing in for one distilled historical tool result. */
export function toolPlaceholder(originalChars) {
  return '[oswyn: 历史工具输出已蒸馏省略（原 ' + originalChars + ' 字符）]';
}

function distillArgValue(value) {
  if (typeof value === 'string') {
    if (value === DISTILLED_ARG_PLACEHOLDER || value === DISCARDED_ARG_PLACEHOLDER) return value;
    return value.length > DISTILLED_ARG_PLACEHOLDER.length ? DISTILLED_ARG_PLACEHOLDER : value;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? [] : value;
  }
  if (isRecord(value)) {
    return Object.keys(value).length > 0 ? {} : value;
  }
  return value;
}

/**
 * Schema-safe, idempotent, strictly non-growing compression of tool-call arguments.
 * Preserves top-level parameter keys and JSON value types so strict provider
 * gateways never reject distilled historical tool calls.
 *
 * @param {string|object|Array} rawArgs
 * @returns {string|object|Array}
 */
export function distillToolCallArgs(rawArgs) {
  if (rawArgs === undefined || rawArgs === null) return rawArgs;
  if (typeof rawArgs === 'string') {
    if (rawArgs.length <= DISTILLED_ARG_PLACEHOLDER.length + 4) return rawArgs;
    if (rawArgs === DISTILLED_ARG_PLACEHOLDER || rawArgs === DISCARDED_ARG_PLACEHOLDER) return rawArgs;
    try {
      const parsed = JSON.parse(rawArgs);
      if (isRecord(parsed)) {
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
          out[k] = distillArgValue(v);
        }
        const serialized = JSON.stringify(out);
        return serialized.length < rawArgs.length ? serialized : rawArgs;
      }
      if (Array.isArray(parsed)) {
        return rawArgs.length > 2 ? '[]' : rawArgs;
      }
    } catch {
      return rawArgs.length > DISTILLED_ARG_PLACEHOLDER.length ? DISTILLED_ARG_PLACEHOLDER : rawArgs;
    }
    return rawArgs;
  }
  if (isRecord(rawArgs)) {
    const out = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      out[k] = distillArgValue(v);
    }
    try {
      return JSON.stringify(out).length < JSON.stringify(rawArgs).length ? out : rawArgs;
    } catch {
      return rawArgs;
    }
  }
  if (Array.isArray(rawArgs)) {
    return rawArgs.length > 0 ? [] : rawArgs;
  }
  return rawArgs;
}

/**
 * Distil one historical assistant message:
 * - Strip reasoning blocks / `<think>` tags / `reasoning_content` when `stripThinking` is enabled.
 * - Keep tool-call pairing intact (the kernel projection cannot drop paired tool/result
 *   nodes), while compressing oversized tool-call arguments when `stripTools` is enabled.
 * - Strip machine result-summary fences.
 *
 * @param {object} message
 * @param {{stripThinking?:boolean, stripTools?:boolean}} [opts]
 * @returns {object|null} replacement message, or null when nothing changed
 */
export function distillAssistantMessage(message, opts = {}) {
  if (!isRecord(message)) return null;
  const stripThinking = opts.stripThinking !== false;
  const stripTools = opts.stripTools !== false;
  const original = JSON.stringify(message);
  const next = { ...message };

  if (stripThinking && 'reasoning_content' in next) {
    delete next.reasoning_content;
  }

  if (Array.isArray(next.content)) {
    let content = next.content.filter(Boolean);
    if (stripThinking) {
      content = content.filter((b) => !isReasoningBlock(b));
      content = stripThinkingTags(content);
    }
    if (stripThinking || stripTools) {
      content = stripResultSummaryFences(content);
    }
    if (stripTools) {
      content = content.map((block) => {
        if (!isToolCallBlock(block)) return block;
        const updated = { ...block };
        if ('arguments' in updated) updated.arguments = distillToolCallArgs(updated.arguments);
        if ('input' in updated) updated.input = distillToolCallArgs(updated.input);
        return updated;
      });
    }
    next.content = content;
  } else if (typeof next.content === 'string') {
    let text = next.content;
    if (stripThinking) text = stripThinkingTags(text);
    if (stripThinking || stripTools) text = stripResultSummaryFences(text);
    next.content = text;
  }

  if (stripTools && Array.isArray(next.tool_calls) && next.tool_calls.length > 0) {
    next.tool_calls = next.tool_calls.map((call) => {
      if (!isRecord(call)) return call;
      const updated = { ...call };
      if (isRecord(updated.function) && 'arguments' in updated.function) {
        updated.function = {
          ...updated.function,
          arguments: distillToolCallArgs(updated.function.arguments)
        };
      }
      if ('arguments' in updated) {
        updated.arguments = distillToolCallArgs(updated.arguments);
      }
      return updated;
    });
  }

  // An assistant message whose content was emptied becomes a shell the kernel/provider
  // dislikes; give it a minimal readable stand-in (only when no content blocks remain).
  if (Array.isArray(next.content)) {
    if (next.content.length === 0) {
      next.content = [{ type: 'text', text: '[已完成处理]' }];
    }
  } else if (typeof next.content === 'string') {
    const hasToolCalls = Array.isArray(next.tool_calls) && next.tool_calls.length > 0;
    if (next.content.trim().length === 0 && !hasToolCalls) {
      next.content = '[已完成处理]';
    }
  }

  return JSON.stringify(next) === original ? null : next;
}

/**
 * Distil one historical tool result: keep role/pairing fields, replace the body.
 *
 * @param {object} message
 * @returns {object|null}
 */
export function distillToolMessage(message) {
  if (!isRecord(message)) return null;
  // Already a placeholder? Leave it alone: the text embeds the ORIGINAL char count,
  // so re-measuring an existing placeholder would rewrite it on every pass and break
  // the idempotence the projection contract relies on.
  if (typeof message.content === 'string' && TOOL_PLACEHOLDER_RE.test(message.content)) {
    return null;
  }
  if (Array.isArray(message.content) && message.content.length === 1
    && typeof message.content[0]?.text === 'string'
    && TOOL_PLACEHOLDER_RE.test(message.content[0].text)) {
    return null;
  }
  const chars = contentChars(message.content);
  const placeholder = toolPlaceholder(chars);
  // Never inflate a tiny tool result with a longer placeholder.
  if (chars <= placeholder.length) return null;
  const next = {
    ...message,
    content: typeof message.content === 'string' ? placeholder : [{ type: 'text', text: placeholder }]
  };
  return JSON.stringify(next) === JSON.stringify(message) ? null : next;
}

function isOrganicUserPair(item) {
  if (!item || item.type !== 'user/message') return false;
  return isOrganicUserMessage(item.message);
}

/** Partition surface pairs into 1-based organic conversation turns. */
export function partitionSurfacePairsIntoTurns(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return { preamble: [], turns: [] };
  const preamble = [];
  const turns = [];
  let currentTurn = null;
  for (const item of pairs) {
    if (!item) continue;
    if (isOrganicUserPair(item)) {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = [item];
    } else if (currentTurn) {
      currentTurn.push(item);
    } else {
      preamble.push(item);
    }
  }
  if (currentTurn) turns.push(currentTurn);
  return { preamble, turns };
}

function getRecallMode(activeRecalls, roundNumber) {
  if (!activeRecalls) return null;
  if (typeof activeRecalls.get === 'function') return activeRecalls.get(roundNumber) ?? null;
  if (typeof activeRecalls === 'object') return activeRecalls[roundNumber] ?? null;
  return null;
}

/**
 * Build the replacement map for one distill decision.
 *
 * Everything BEFORE the current (last) organic user turn is historical and gets
 * distilled (respecting `activeRecalls` modal masks); the current turn is left
 * byte-for-byte untouched so the live prompt keeps full fidelity.
 *
 * @param {Array<{seq:number, type:string, message:object}>} pairs surface nodes in order
 * @param {{distillStripThinking?:boolean, distillStripToolCalls?:boolean, activeRecalls?:Map|object}} [options]
 * @returns {Array<{seq:number, message:object}>}
 */
export function buildDistillReplacements(pairs, options = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  const { turns } = partitionSurfacePairsIntoTurns(pairs);
  if (turns.length <= 1) return [];

  const out = [];
  for (let turnIdx = 0; turnIdx < turns.length - 1; turnIdx += 1) {
    const roundNumber = turnIdx + 1;
    const recallMode = getRecallMode(options.activeRecalls, roundNumber);
    const stripThinking = options.distillStripThinking !== false
      && recallMode !== 'think'
      && recallMode !== 'both';
    const stripTools = options.distillStripToolCalls !== false
      && recallMode !== 'tool'
      && recallMode !== 'both';

    if (!stripThinking && !stripTools) continue;

    for (const item of turns[turnIdx]) {
      if (!item || !Number.isInteger(item.seq) || !item.message) continue;
      let replacement = null;
      if (item.type === 'assistant/message') {
        replacement = distillAssistantMessage(item.message, { stripThinking, stripTools });
      } else if (item.type === 'tool/result' && stripTools) {
        replacement = distillToolMessage(item.message);
      }
      if (replacement) out.push({ seq: item.seq, message: replacement });
    }
  }
  return out;
}

/**
 * Build `oswyn/distill` replacements to reinstate (un-distill) a specific historical
 * round from its unprojected surface messages (which already carry any intra-step
 * compression) according to the requested recall modality.
 *
 * @param {Array<{seq:number, type:string, message:object}>} unprojectedPairs
 * @param {number} roundNumber 1-based organic round number
 * @param {'think'|'tool'|'both'} mode
 * @param {{distillStripThinking?:boolean, distillStripToolCalls?:boolean}} [options]
 * @returns {Array<{seq:number, message:object}>}
 */
export function buildRecallReinstateReplacements(unprojectedPairs, roundNumber, mode = 'think', options = {}) {
  if (!Array.isArray(unprojectedPairs) || unprojectedPairs.length === 0) return [];
  const { turns } = partitionSurfacePairsIntoTurns(unprojectedPairs);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > turns.length) return [];

  const stripThinking = options.distillStripThinking !== false && mode !== 'think' && mode !== 'both';
  const stripTools = options.distillStripToolCalls !== false && mode !== 'tool' && mode !== 'both';
  const out = [];

  for (const item of turns[roundNumber - 1]) {
    if (!item || !Number.isInteger(item.seq) || !item.message) continue;
    if (item.type === 'assistant/message') {
      const targetMsg = (!stripThinking && !stripTools)
        ? item.message
        : (distillAssistantMessage(item.message, { stripThinking, stripTools }) ?? item.message);
      out.push({ seq: item.seq, message: targetMsg });
    } else if (item.type === 'tool/result' && !stripTools) {
      out.push({ seq: item.seq, message: item.message });
    }
  }
  return out;
}

/**
 * Build native `user/message` (`oswyn-compaction`) checkpoint replacements for
 * completed historical turns.
 *
 * WHY CHECKPOINT REPLACEMENTS INSTEAD OF `oswyn/distill`:
 * `@deepseek-ai/dsh-session`'s `Session.prototype.append(type, data, opts)` only
 * copies `surfaceOp` and `sourceEventSeqs` from `opts` — it drops `opts.ignorable`.
 * Writing a custom event type like `oswyn/distill` therefore persists an unknown
 * non-ignorable event into `session.v4.jsonl.zstd`, which causes `gateway/internal`
 * and session reloaders to reject the log. Using native `user/message` with
 * `surfaceOp: { op: 'replace', startSeq, endSeq }` + `sourceEventSeqs: shadowedSeqs`
 * is 100% within `KNOWN_SESSION_EVENT_TYPES`, completely removes historical thinking,
 * tool calls, and tool results from `deriveMessages()`, leaves the human UI transcript
 * untouched, and preserves exact shadowed surface seqs (post-intra-step-compression)
 * for `history_recall`.
 *
 * @param {Array<{seq:number, type:string, message:object}>} pairs surface nodes in order
 * @param {{distillStripThinking?:boolean, distillStripToolCalls?:boolean, activeRecalls?:Map|object}} [options]
 * @returns {Array<{round:number, startSeq:number, endSeq:number, shadowedSeqs:number[], text:string, beforeChars:number, afterChars:number}>}
 */
/**
 * Detect whether a historical turn ended abnormally or is awaiting the user's
 * answer, so the next turn is a continuation and should NOT trigger distillation:
 *   - stopped/crashed mid-tool-loop (last work node is `tool/result`, or assistant
 *     still has pending `tool-call` / `tool_calls` with no final reply)
 *   - stopped mid-thinking / empty assistant reply (no visible text)
 *   - asked the user a question (`ask_user_question` tool or final line ends with `?`/`？`)
 *
 * @param {Array<{seq:number, type:string, message:object}>} turnPairs
 * @returns {{excluded:boolean, reason:string|null}}
 */
/**
 * True when the most recent non-meta user event in this turn is a background task
 * status update (e.g. `tool-jobs`), meaning the turn was woken up by a background
 * job notification rather than a human user prompt.
 *
 * @param {Array<{seq:number, type:string, message:object}>} turnPairs
 * @returns {boolean}
 */
export function isTurnTriggeredByBackgroundJob(turnPairs) {
  if (!Array.isArray(turnPairs) || turnPairs.length === 0) return false;
  for (let i = turnPairs.length - 1; i >= 0; i -= 1) {
    const node = turnPairs[i];
    if (!node || node.type !== 'user/message' || !node.message) continue;
    const kind = node.message.source && typeof node.message.source === 'object'
      ? node.message.source.kind
      : undefined;
    if (kind === 'oswyn-compaction' || kind === 'oswyn-nudge' || kind === 'runtime-context' || kind === 'ptc-mode') {
      continue;
    }
    return isBackgroundJobStatusMessage(node.message);
  }
  return false;
}

export function isTurnIncompleteOrAwaitingAnswer(turnPairs) {
  if (!Array.isArray(turnPairs) || turnPairs.length <= 1) {
    return { excluded: false, reason: null };
  }
  const workNodes = turnPairs.slice(1).filter((n) => n && n.message);
  if (workNodes.length === 0) return { excluded: false, reason: null };
  if (workNodes.length === 1
    && workNodes[0].type === 'user/message'
    && workNodes[0].message?.source?.kind === 'oswyn-compaction') {
    return { excluded: false, reason: null };
  }

  // 1. Explicit ask_user_question tool call or result in this turn
  for (const node of workNodes) {
    const msg = node.message;
    if (node.type === 'tool/result') {
      const tName = String(msg?.source?.toolName || msg?.toolName || msg?.name || '').toLowerCase();
      if (tName === 'ask_user_question') return { excluded: true, reason: 'ask_user_question' };
    }
    if (node.type === 'assistant/message') {
      if (Array.isArray(msg?.content)) {
        for (const b of msg.content) {
          if (isToolCallBlock(b) && String(b.name || '').toLowerCase() === 'ask_user_question') {
            return { excluded: true, reason: 'ask_user_question' };
          }
        }
      }
      if (Array.isArray(msg?.tool_calls)) {
        for (const c of msg.tool_calls) {
          if (String(c?.function?.name || c?.name || '').toLowerCase() === 'ask_user_question') {
            return { excluded: true, reason: 'ask_user_question' };
          }
        }
      }
    }
  }

  // 2. Turn ended on a tool/result (manual stop / error before assistant replied)
  const lastWork = workNodes[workNodes.length - 1];
  if (lastWork.type === 'tool/result') {
    return { excluded: true, reason: 'stopped_mid_tool' };
  }

  // 3. Last assistant message still has tool calls or has no visible final text
  if (lastWork.type === 'assistant/message') {
    const msg = lastWork.message;
    const hasPendingToolCalls = (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0)
      || (Array.isArray(msg?.content) && msg.content.some((b) => isToolCallBlock(b)));
    if (hasPendingToolCalls) {
      return { excluded: true, reason: 'stopped_mid_tool' };
    }
    const distilled = distillAssistantMessage(msg, { stripThinking: true, stripTools: true }) ?? msg;
    const visibleText = Array.isArray(distilled.content)
      ? distilled.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
      : (typeof distilled.content === 'string' ? distilled.content.trim() : '');
    if (!visibleText || visibleText === '[已完成处理]') {
      return { excluded: true, reason: 'no_final_reply' };
    }
    const lines = visibleText.split('\n').map((l) => l.trim()).filter(Boolean);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
    if (/[?？]["'”’）)》】]*$/.test(lastLine)) {
      return { excluded: true, reason: 'awaiting_answer' };
    }
  }

  return { excluded: false, reason: null };
}

function isSystemOrDeveloperPair(item) {
  if (!item) return false;
  if (item.type === 'system/message' || item.type === 'developer/message') return true;
  const role = item.message?.role;
  return role === 'system' || role === 'developer';
}

export function buildTurnDistillCheckpoints(pairs, options = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  if (options.distillStripThinking === false && options.distillStripToolCalls === false) return [];
  const { turns } = partitionSurfacePairsIntoTurns(pairs);
  const includeLastTurn = options.includeLastTurn === true;
  if (!includeLastTurn && turns.length <= 1) return [];
  if (turns.length === 0) return [];

  const limit = includeLastTurn ? turns.length : turns.length - 1;
  const out = [];
  for (let turnIdx = 0; turnIdx < limit; turnIdx += 1) {
    const roundNumber = turnIdx + 1;
    const recallMode = getRecallMode(options.activeRecalls, roundNumber);
    // Never re-distill a round that the model explicitly recalled.
    if (recallMode === 'think' || recallMode === 'tool' || recallMode === 'both') continue;

    const turnPairs = turns[turnIdx];
    const prevTurnIdx = includeLastTurn ? (turns.length - 1) : (turns.length - 2);
    if (options.excludeIncompletePreviousTurn === true && turnIdx === prevTurnIdx) {
      if (options.previousTurnInterrupted === true || isTurnIncompleteOrAwaitingAnswer(turnPairs).excluded) {
        continue;
      }
    }

    // Partition turn work nodes around any mid-turn system/developer messages so a
    // contiguous surface replace range NEVER swallows system or developer prompts.
    const segments = [];
    let curSeg = [];
    for (const n of turnPairs.slice(1)) {
      if (!n || !Number.isInteger(n.seq) || !n.message) continue;
      if (isSystemOrDeveloperPair(n)) {
        if (curSeg.length > 0) {
          segments.push(curSeg);
          curSeg = [];
        }
        continue;
      }
      curSeg.push(n);
    }
    if (curSeg.length > 0) segments.push(curSeg);

    for (const workNodes of segments) {
      // Already distilled to a single compaction checkpoint? Skip (idempotent).
      if (workNodes.length === 1
        && workNodes[0].type === 'user/message'
        && workNodes[0].message?.source?.kind === 'oswyn-compaction') {
        continue;
      }

      // Only distill segments that still contain assistant or tool traffic.
      const hasAssistantOrTool = workNodes.some((n) => n.type === 'assistant/message' || n.type === 'tool/result');
      if (!hasAssistantOrTool) continue;

      // Extract the best compact summary/final reply for this segment.
      let cleanReply = '';
      for (let i = workNodes.length - 1; i >= 0; i -= 1) {
        const node = workNodes[i];
        if (node.type === 'user/message' && node.message?.source?.kind === 'oswyn-compaction') {
          const rawText = Array.isArray(node.message.content)
            ? node.message.content.filter((b) => b && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
            : (typeof node.message.content === 'string' ? node.message.content.trim() : '');
          if (rawText) {
            cleanReply = rawText;
            break;
          }
        }
        if (node.type === 'assistant/message') {
          const distilled = distillAssistantMessage(node.message, { stripThinking: true, stripTools: true }) ?? node.message;
          const txt = Array.isArray(distilled.content)
            ? distilled.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
            : (typeof distilled.content === 'string' ? distilled.content.trim() : '');
          if (txt && txt !== '[已完成处理]') {
            cleanReply = txt;
            break;
          }
        }
      }
      if (!cleanReply) cleanReply = '[已完成处理]';

      const text = /^\[oswyn (?:双轨备忘|轮次蒸馏)/.test(cleanReply)
        ? cleanReply
        : `[oswyn 轮次蒸馏 · 第 ${roundNumber} 轮]\n${cleanReply}`;

      let beforeChars = 0;
      for (const node of workNodes) {
        beforeChars += contentChars(node.message.content);
        if (typeof node.message.reasoning_content === 'string') beforeChars += node.message.reasoning_content.length;
        if (Array.isArray(node.message.tool_calls) && node.message.tool_calls.length > 0) {
          try { beforeChars += JSON.stringify(node.message.tool_calls).length; } catch { beforeChars += 64; }
        }
      }
      const afterChars = text.length;
      if (afterChars >= beforeChars) continue;

      out.push({
        round: roundNumber,
        startSeq: workNodes[0].seq,
        endSeq: workNodes[workNodes.length - 1].seq,
        shadowedSeqs: workNodes.map((n) => n.seq),
        text,
        beforeChars,
        afterChars
      });
    }
  }
  return out;
}

const SURFACE_CHARS_PER_TOKEN = 2.9;

function pairChars(item) {
  if (!item || !item.message) return 0;
  let n = contentChars(item.message.content);
  if (typeof item.message.reasoning_content === 'string') {
    n += item.message.reasoning_content.length;
  }
  if (Array.isArray(item.message.tool_calls) && item.message.tool_calls.length > 0) {
    try { n += JSON.stringify(item.message.tool_calls).length; } catch { n += 64; }
  }
  return n;
}



/**
 * Break the active context surface down into compressed vs. uncompressed tokens.
 *
 * - System / developer prompts (preamble) and already-distilled historical turns
 *   (`oswyn-compaction`) count toward `compressedTokens`.
 * - Undistilled historical turns and the active turn count toward `uncompressedTokens`.
 *
 * @param {Array<{seq:number, type:string, message:object}>} pairs
 * @returns {{totalTokens:number, compressedTokens:number, uncompressedTokens:number, systemTokens:number, distilledTurnsTokens:number}}
 */
export function measureSurfaceBreakdown(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return {
      totalTokens: 0,
      compressedTokens: 0,
      uncompressedTokens: 0,
      systemTokens: 0,
      distilledTurnsTokens: 0
    };
  }
  const { preamble, turns } = partitionSurfacePairsIntoTurns(pairs);
  let systemChars = 0;
  let preambleChars = 0;
  let distilledTurnsChars = 0;
  let uncompressedChars = 0;

  for (const item of preamble) {
    const c = pairChars(item);
    preambleChars += c;
    if (isSystemOrDeveloperPair(item)) systemChars += c;
  }

  for (const turnPairs of turns) {
    const workNodes = turnPairs.slice(1).filter((n) => n && n.message);
    const isDistilledTurn = workNodes.length === 1
      && workNodes[0].type === 'user/message'
      && workNodes[0].message?.source?.kind === 'oswyn-compaction';

    for (const item of turnPairs) {
      const c = pairChars(item);
      if (isSystemOrDeveloperPair(item)) {
        systemChars += c;
        preambleChars += c;
      } else if (isDistilledTurn) {
        distilledTurnsChars += c;
      } else {
        uncompressedChars += c;
      }
    }
  }

  const systemTokens = Math.round(systemChars / SURFACE_CHARS_PER_TOKEN);
  const distilledTurnsTokens = Math.round(distilledTurnsChars / SURFACE_CHARS_PER_TOKEN);
  const compressedTokens = Math.round((preambleChars + distilledTurnsChars) / SURFACE_CHARS_PER_TOKEN);
  const uncompressedTokens = Math.round(uncompressedChars / SURFACE_CHARS_PER_TOKEN);
  return {
    totalTokens: compressedTokens + uncompressedTokens,
    compressedTokens,
    uncompressedTokens,
    systemTokens,
    distilledTurnsTokens
  };
}

/**
 * The kernel projection. Pure: same event + same history always yields the same map.
 * Must throw on malformed durable data so a corrupted log is loud, never silently
 * mis-projected.
 */
export const oswynDistillProjection = {
  type: OSWYN_DISTILL_EVENT,
  project(event, context) {
    const data = event && event.data;
    if (!isRecord(data) || !Array.isArray(data.replacements)) {
      throw new Error('oswyn/distill: data.replacements must be an array');
    }
    const nodes = new Set(context.nodes);
    const baseSeq = Number.isSafeInteger(context.baseSeq) ? context.baseSeq : 0;
    const messages = new Map();
    for (const item of data.replacements) {
      if (!isRecord(item) || !Number.isSafeInteger(item.seq) || item.seq < 0 || !isRecord(item.message)) {
        throw new Error('oswyn/distill: each replacement needs an integer seq and a message object');
      }
      if (messages.has(item.seq)) throw new Error('oswyn/distill: duplicate replacement seq ' + item.seq);
      if (!nodes.has(item.seq)) {
        // In a windowed log (baseSeq > 0), historical seqs before the window are expected
        // to be absent from context.nodes; skip them rather than crashing session load.
        if (baseSeq > 0 && item.seq < baseSeq) continue;
        throw new Error('oswyn/distill: seq ' + item.seq + ' is not a current surface node');
      }
      messages.set(item.seq, item.message);
    }
    return messages;
  }
};
