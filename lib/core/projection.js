/**
 * dsh-oswyn/core/projection — pure tool-call argument projection.
 *
 * Pure module: no node:fs, no node:path, no ctx, no side effects.
 * Shrinks oversized `code` / `spec` arguments inside an assistant message's
 * tool-call blocks to a short pseudocode placeholder, leaving every other
 * block and field byte-for-byte intact. Idempotent and strictly non-growing.
 *
 * @module dsh-oswyn/core/projection
 */

const DEFAULT_MAX_CODE_LEN = 150;
const DEFAULT_MAX_SPEC_LEN = 150;

function placeholder(field, originalLen) {
  if (field === 'spec') {
    return `// [oswyn: spec 已折叠，原 ${originalLen} 字符 · 伪代码占位；完整内容见历史]`;
  }
  return `// [oswyn: code 已折叠，原 ${originalLen} 字符 · 伪代码占位；完整内容见历史]`;
}

function shrinkField(value, maxLen) {
  if (typeof value !== 'string' || value.length <= maxLen) return { value, changed: false };
  return { value: placeholder(value.length > 0 ? 'code' : 'code', value.length), changed: true };
}

/**
 * Project one parsed-arguments object: replace oversized code/spec leaves.
 * Returns a NEW object; never mutates input.
 */
function projectArgsObject(args, { maxCodeLen, maxSpecLen }) {
  if (!args || typeof args !== 'object') return { args, changed: false };
  const out = Array.isArray(args) ? args.slice() : { ...args };
  let changed = false;

  if (typeof out.code === 'string' && out.code.length > maxCodeLen) {
    out.code = placeholder('code', out.code.length);
    changed = true;
  }
  if (typeof out.spec === 'string' && out.spec.length > maxSpecLen) {
    out.spec = placeholder('spec', out.spec.length);
    changed = true;
  }
  return { args: out, changed };
}

function projectBlock(block, limits) {
  if (!block || block.type !== 'tool-call') return { block, changed: false };
  const raw = block.arguments;
  if (raw === undefined || raw === null) return { block, changed: false };

  // arguments may be a JSON string or an object
  if (typeof raw === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { block, changed: false };
    }
    const { args, changed } = projectArgsObject(parsed, limits);
    if (!changed) return { block, changed: false };
    return { block: { ...block, arguments: JSON.stringify(args) }, changed: true };
  }

  const { args, changed } = projectArgsObject(raw, limits);
  if (!changed) return { block, changed: false };
  return { block: { ...block, arguments: args }, changed: true };
}

/**
 * Prune oversized tool-call arguments in a single assistant message.
 * Accepts either a Message ({content:[...]}) or a raw content-blocks array.
 * Returns a NEW value of the same shape; whatever does not change is reused.
 *
 * @param {object|Array} message
 * @param {{maxCodeLen?:number, maxSpecLen?:number}} [opts]
 * @returns {object|Array}
 */
export function pruneToolCallArgs(message, opts = {}) {
  const limits = {
    maxCodeLen: Number.isFinite(opts.maxCodeLen) ? opts.maxCodeLen : DEFAULT_MAX_CODE_LEN,
    maxSpecLen: Number.isFinite(opts.maxSpecLen) ? opts.maxSpecLen : DEFAULT_MAX_SPEC_LEN
  };

  const asBlocks = Array.isArray(message) ? message : message?.content;
  if (!Array.isArray(asBlocks)) return message;

  let touched = false;
  const nextBlocks = asBlocks.map((b) => {
    const { block, changed } = projectBlock(b, limits);
    if (changed) touched = true;
    return block;
  });

  if (!touched) return message;
  if (Array.isArray(message)) return nextBlocks;
  return { ...message, content: nextBlocks };
}

/**
 * Safely discard a tool-call's arguments without violating required parameter schemas.
 * Replaces large string/payload fields with a lightweight placeholder while preserving
 * existing keys, so JSON Schema `required` constraints (e.g. `code`, `description`)
 * are still satisfied when replaying to strict OpenAI-compatible gateways.
 *
 * @param {string|object} rawArgs
 * @returns {string|object}
 */
export function discardToolCallArgs(rawArgs) {
  if (!rawArgs) return '{}';
  if (typeof rawArgs === 'string') {
    try {
      const obj = JSON.parse(rawArgs);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const discarded = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            discarded[k] = '// [oswyn: discarded]';
          } else if (typeof v === 'number') {
            discarded[k] = 0;
          } else if (typeof v === 'boolean') {
            discarded[k] = false;
          } else {
            discarded[k] = null;
          }
        }
        return JSON.stringify(discarded);
      }
    } catch {
      return '{}';
    }
    return '{}';
  }
  if (typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const discarded = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      if (typeof v === 'string') {
        discarded[k] = '// [oswyn: discarded]';
      } else if (typeof v === 'number') {
        discarded[k] = 0;
      } else if (typeof v === 'boolean') {
        discarded[k] = false;
      } else {
        discarded[k] = null;
      }
    }
    return discarded;
  }
  return '{}';
}

/**
 * Strip reasoning tags (<think>...</think> or <thinking>...</thinking>)
 * from message content (string or block array).
 *
 * @param {string|Array} content
 * @returns {string|Array}
 */
export function stripThinkingTags(content) {
  if (typeof content === 'string') {
    return content.replace(/<(?:think|thinking)>[\s\S]*?(?:<\/(?:think|thinking)>|$)/gi, '').trim();
  }
  if (Array.isArray(content)) {
    const out = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'thinking' || block.type === 'thought') {
        continue;
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        const cleaned = block.text.replace(/<(?:think|thinking)>[\s\S]*?(?:<\/(?:think|thinking)>|$)/gi, '').trim();
        if (cleaned.length > 0) {
          out.push({ ...block, text: cleaned });
        }
      } else {
        out.push(block);
      }
    }
    return out;
  }
  return content;
}

/**
 * Strip tool-result summary directive fences (```result-summary ... ``` and legacy ```dsh-result-summary ... ```)
 * from assistant message content, leaving only the substantive reply prose.
 *
 * @param {string|Array} content
 * @returns {string|Array}
 */
const XML_SUMMARY_BLOCK_RE = /<(?:dsh-)?(?:result|reply)-summary(?:\s[^>]*)?>[\s\S]*?<\/(?:dsh-)?(?:result|reply)-summary>/gi;

export function stripResultSummaryFences(content) {
  if (typeof content === 'string') {
    // XML form first: the fenced fallback below strips everything to end-of-text,
    // which would swallow the reply prose that follows an XML fence.
    const withoutXml = content.replace(XML_SUMMARY_BLOCK_RE, '');
    return withoutXml.replace(/```(?:(?:dsh-)?result-summary\b[^\n]*\n[\s\S]*?```|(?:dsh-)?result-summary\b[\s\S]*?$)/gi, '').trim();
  }
  if (Array.isArray(content)) {
    const out = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        const cleaned = stripResultSummaryFences(block.text);
        if (cleaned.length > 0) {
          out.push({ ...block, text: cleaned });
        }
      } else {
        out.push(block);
      }
    }
    return out;
  }
  return content;
}

/**
 * Check if a turn contains an explicit assistant reply summary
 * (e.g. `[oswyn 双轨备忘]` checkpoint or `reply-summary` fence).
 *
 * @param {Array<object>} turnMsgs
 * @returns {boolean}
 */
export function hasReplySummary(turnMsgs) {
  if (!Array.isArray(turnMsgs)) return false;
  for (const m of turnMsgs) {
    if (!m) continue;
    const txt = extractMessageText(m);
    if (txt.includes('[oswyn 双轨备忘]') || txt.includes('[oswyn 双轨') || /```(?:dsh-)?reply-summary\b/i.test(txt)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract plain text from a message (string or content blocks).
 *
 * @param {object} message
 * @returns {string}
 */
function extractMessageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text || '')
      .join('\n');
  }
  return '';
}

/**
 * True only for real human user messages (not synthetic DSH-injected user messages
 * such as `runtime-context`, `ptc-mode`, `tool-jobs`, `oswyn-nudge`, or `oswyn-compaction`).
 *
 * In DSH, organic user prompts carry `source.kind === 'user'`; lightweight unit-test
 * messages omit `source` (`kind === undefined`). Any other `source.kind` is synthetic
 * and must NOT open a new conversation turn.
 *
 * @param {object} msg
 * @returns {boolean}
 */
export function isOrganicUserMessage(msg) {
  if (!msg || msg.role !== 'user') return false;
  const kind = msg.source && typeof msg.source === 'object' ? msg.source.kind : undefined;
  return kind === undefined || kind === 'user';
}

/**
 * Partition an array of messages into preamble (system/developer) and turns
 * indexed by organic user prompts.
 *
 * @param {Array<object>} messages
 * @returns {{ preamble: Array<object>, turns: Array<Array<object>> }}
 */
export function partitionMessagesIntoTurns(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { preamble: [], turns: [] };
  }

  const preamble = [];
  const turns = [];
  let currentTurn = null;

  for (const msg of messages) {
    if (!msg) continue;
    const isOrganicUser = isOrganicUserMessage(msg);

    if (isOrganicUser) {
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else if (currentTurn) {
      currentTurn.push(msg);
    } else {
      preamble.push(msg);
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return { preamble, turns };
}

// Re-export isCacheExpired from surface.js
export { isCacheExpired } from '../session/surface.js';
import { isCacheExpired } from '../session/surface.js';

/**
 * Project conversation history for outgoing LLM dispatch with post-cache
 * deep distillation.
 *
 * When KV-cache is active (idleMs < TTL and not forced):
 *   Returns messages untouched to preserve server prefix-caching.
 *
 * When KV-cache is expired (or options.forceCacheExpired === true):
 *   Partitions messages into turns based on user prompts.
 *   For all historical turns (1 <= t < N):
 *     - Strips <think>...</think> reasoning tags from assistant messages
 *     - Strips tool_calls from assistant messages
 *     - Filters out all tool/result messages (role: 'tool' or 'tool/result')
 *     - Retains clean user prompts and compact text assistant responses
 *     - Respects options.activeRecalls modal mask if provided (think/tool/both)
 *   Current turn (t = N) messages remain completely untouched.
 *
 * @param {Array<object>} messages
 * @param {object} [options]
 * @param {boolean} [options.forceCacheExpired]
 * @param {boolean} [options.isExpired]
 * @param {number} [options.cacheTtlSeconds]
 * @param {number} [options.lastActiveTime]
 * @param {number} [options.now]
 * @param {object} [options.session]
 * @param {boolean} [options.distillStripThinking]
 * @param {boolean} [options.distillStripToolCalls]
 * @param {Map<number, string>|object} [options.activeRecalls]
 * @returns {Array<object>}
 */
export function projectDistilledHistory(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  let expired = false;
  if (typeof options.isExpired === 'boolean') {
    expired = options.isExpired;
  } else if (options.forceCacheExpired === true) {
    expired = true;
  } else if (options.forceCacheExpired === false) {
    expired = false;
  } else {
    expired = isCacheExpired(options.session, options);
  }

  if (!expired) {
    return messages;
  }

  const { preamble, turns } = partitionMessagesIntoTurns(messages);
  if (turns.length <= 1) {
    // Only current turn exists; nothing in historical turns to distill
    return messages;
  }

  const currentTurnIndex = turns.length - 1;
  const distilledOut = [...preamble];

  for (let turnIdx = 0; turnIdx < turns.length; turnIdx += 1) {
    const turnMsgs = turns[turnIdx];
    if (turnIdx === currentTurnIndex) {
      // Current turn: keep completely untouched
      distilledOut.push(...turnMsgs);
      continue;
    }

    // Historical turn (1-based index)
    const roundNumber = turnIdx + 1;
    let recallMode = null;
    if (options.activeRecalls) {
      if (typeof options.activeRecalls.get === 'function') {
        recallMode = options.activeRecalls.get(roundNumber);
      } else if (typeof options.activeRecalls === 'object') {
        recallMode = options.activeRecalls[roundNumber];
      }
    }

    const stripThinking = options.distillStripThinking !== false
      && recallMode !== 'think'
      && recallMode !== 'both';
    const stripTools = options.distillStripToolCalls !== false
      && recallMode !== 'tool'
      && recallMode !== 'both';

    const turnHasReplySummary = hasReplySummary(turnMsgs);

    const validAssistantMsgs = [];
    const emptyAssistantMsgs = [];
    const turnProjected = [];

    for (const msg of turnMsgs) {
      if (!msg) continue;

      if (msg.role === 'user') {
        turnProjected.push(msg);
        continue;
      }

      if (msg.role === 'tool' || msg.role === 'tool/result') {
        if (!stripTools) {
          turnProjected.push(msg);
        }
        continue;
      }

      if (msg.role === 'assistant') {
        let distilled = { ...msg };

        if (stripTools && 'tool_calls' in distilled) {
          const { tool_calls, ...rest } = distilled;
          distilled = rest;
        }

        if (stripTools && Array.isArray(distilled.content)) {
          distilled.content = distilled.content.filter(
            (b) => b && b.type !== 'tool-call' && b.type !== 'tool_use' && b.type !== 'tool_call'
          );
        }

        if (stripThinking) {
          distilled.content = stripThinkingTags(distilled.content);
        }

        // Clean tool result summary directive fences from assistant content
        distilled.content = stripResultSummaryFences(distilled.content);

        const hasToolCalls = Array.isArray(distilled.tool_calls) && distilled.tool_calls.length > 0;
        const text = extractMessageText(distilled).trim();
        const hasText = text.length > 0;

        if (!hasToolCalls && !hasText) {
          emptyAssistantMsgs.push(distilled);
        } else {
          validAssistantMsgs.push(distilled);
        }
        continue;
      }

      // Other roles (e.g. system inside turn if any)
      turnProjected.push(msg);
    }

    // In historical turns:
    // If there is no reply summary and tools are stripped, retain ONLY the substantive
    // final assistant reply (dropping intermediate tool preambles and machine fences).
    if (!turnHasReplySummary && stripTools) {
      if (validAssistantMsgs.length > 0) {
        turnProjected.push(validAssistantMsgs[validAssistantMsgs.length - 1]);
      } else if (emptyAssistantMsgs.length > 0) {
        const lastEmpty = emptyAssistantMsgs[emptyAssistantMsgs.length - 1];
        const placeholder = typeof lastEmpty.content === 'string'
          ? '[已完成处理]'
          : [{ type: 'text', text: '[已完成处理]' }];
        turnProjected.push({ ...lastEmpty, content: placeholder });
      }
    } else {
      if (validAssistantMsgs.length > 0) {
        turnProjected.push(...validAssistantMsgs);
      } else if (emptyAssistantMsgs.length > 0) {
        const lastEmpty = emptyAssistantMsgs[emptyAssistantMsgs.length - 1];
        const placeholder = typeof lastEmpty.content === 'string'
          ? '[已完成处理]'
          : [{ type: 'text', text: '[已完成处理]' }];
        turnProjected.push({ ...lastEmpty, content: placeholder });
      }
    }

    distilledOut.push(...turnProjected);
  }

  return distilledOut;
}

