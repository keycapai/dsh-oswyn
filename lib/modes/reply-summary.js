/**
 * dsh-oswyn/modes/reply-summary — Mode F: Dual-Track Assistant Reply Projection.
 *
 * Semantics:
 *   - Parses the trailing `dsh-reply-summary` fence from an assistant message.
 *   - Replaces the assistant node on the session surface with a compact
 *     `[oswyn 双轨备忘]` checkpoint so future LLM requests carry only the dense
 *     memo while the web UI still renders the full user-facing prose.
 *
 * @module dsh-oswyn/modes/reply-summary
 */

import { findReplySummaryBlock, parseReplySummaryBody } from '../core/parse.js';
import { appendCheckpointReplace, isOnSurface } from '../session/surface.js';

/**
 * Apply `dsh-reply-summary` fence from an assistant message text.
 */
export function applyReplySummary(session, text, assistantSeq, opts = {}) {
  if (opts.replySummaryEnabled === false) {
    return { replySummary: null, rejectedReason: null, reentrantBlocked: false };
  }
  const replyBlock = findReplySummaryBlock(text);
  if (!replyBlock) {
    return { replySummary: null, rejectedReason: null, reentrantBlocked: false };
  }
  const parsed = parseReplySummaryBody(replyBlock.rawHeader, replyBlock.body);
  const targetSeq = parsed.targetSeq ?? assistantSeq;
  const summary = (parsed.summary || '').trim();
  if (!Number.isInteger(targetSeq) || !summary || !isOnSurface(session, targetSeq)) {
    return { replySummary: null, rejectedReason: null, reentrantBlocked: false };
  }
  const write = appendCheckpointReplace(
    session,
    targetSeq,
    targetSeq,
    `[oswyn 双轨备忘] ${summary}`
  );
  if (write.ok) {
    return {
      replySummary: { targetSeq, summary, charsBefore: text.length },
      rejectedReason: null,
      reentrantBlocked: false
    };
  }
  const reentrantBlocked = /cannot reenter/i.test(write.reason || '');
  return {
    replySummary: null,
    rejectedReason: `reply checkpoint failed: ${write.reason}`,
    reentrantBlocked
  };
}
