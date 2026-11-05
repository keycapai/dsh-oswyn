/**
 * dsh-oswyn/core/plan — pure rewrite planner.
 *
 * Pure module: no node:fs, no node:path, no ctx, no side effects.
 * Computes the rewritten tool-result content blocks for a given target + parsed
 * directive without ever touching a session.
 *
 * @module dsh-oswyn/core/plan
 */

import { encodeMeta } from './markers.js';

const MIN_CHARS = 20;

/** Combined plain-text length of a content-blocks array. */
export function textLength(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let len = 0;
  for (const b of blocks) {
    if (b && b.type === 'text' && typeof b.text === 'string') len += b.text.length;
  }
  return len;
}

function blockText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
}

/** Extract the char count that the target tool result occupies today. */
export function measureTarget(target) {
  const blocks = target?.event?.data?.message?.content || target?.event?.data?.content || [];
  return blockText(blocks).length;
}

/**
 * Banner prose is CONTEXT COST, not decoration: every compression pays it in
 * the next request. The [oswyn-meta:] marker already carries
 * before/after/keep/mode/seq, so the human hint only has to say "the tail is
 * gone, the original is recallable". Measured: the previous verbose copy cost
 * ~139 chars per truncate (marker 63 + 60-char sentence + 10-char header + 6
 * newlines); this form costs ~104, and omits the summary header entirely when
 * the model supplied no summary. The prefix (kept lines) is unchanged, so the
 * KV-cache prefix hit is identical.
 */
function truncateBanner({ meta, summary }) {
  const tail = summary ? '\n' + summary : '';
  return `\n${meta}\n[oswyn 尾部已截断]${tail}`;
}

function replaceBanner({ meta, summary, mode }) {
  const kind = mode === 'discard' ? '整段已丢弃' : '输出已压缩';
  const tail = summary ? '\n' + summary : '';
  return `${meta}\n[oswyn ${kind}]${tail}`;
}

/**
 * Compute the fixed-point content for truncate / replace / discard.
 *
 * For truncate the prefix is copied verbatim from index 0 so prompt cache is
 * preserved; the banner embeds the digits of `after`, therefore the total
 * length depends on the digits of `after` — iterate until self-consistent.
 *
 * @param {{seq?:number|string, event?:object}} target
 * @param {ReturnType<import('./parse.js').parseSummaryBody>} parsed
 * @param {string} [toolName]
 * @returns {{mode:string,before:number,after:number,keepChars:number,keepLines:(number|null),content:Array<{type:'text',text:string}>,rejected?:string}}
 */
export function plan(target, parsed = {}, toolName = '') {
  const origText = blockText(target?.event?.data?.message?.content || target?.event?.data?.content || []);
  const before = origText.length;

  if (before <= MIN_CHARS) {
    return {
      mode: parsed.mode || 'replace',
      before,
      after: before,
      keepChars: 0,
      keepLines: null,
      content: null,
      rejected: `content size (${before}) too small to warrant distillation`
    };
  }

  const seq = parsed.seq ?? target?.seq ?? target?.event?.seq ?? '?';
  const mode = parsed.mode === 'truncate' || parsed.mode === 'discard' ? parsed.mode : 'replace';
  const summary = (parsed.summary || '').trim();

  if (mode === 'truncate') {
    // Determine cut index
    let cutIndex;
    let keepLines = null;
    if (parsed.keepUnit === 'lines') {
      // No magic fallback: an unspecified line count is a caller error, and
      // silently defaulting to 50/2000 is what made keep sizes look ignored.
      const lineCount = Number.isFinite(parsed.keepCount) && parsed.keepCount > 0
        ? Math.trunc(parsed.keepCount)
        : null;
      if (lineCount === null) {
        return {
          mode: 'truncate', before, after: before, keepChars: 0, keepLines: null, content: null,
          rejected: 'truncate requested without a line count (expected: truncate keep <N> lines)'
        };
      }
      const lines = origText.split('\n');
      const kept = lines.slice(0, lineCount);
      cutIndex = kept.join('\n').length;
      if (lines.length > lineCount) cutIndex += 1; // include trailing newline separator
      keepLines = Math.min(lineCount, lines.length);
      if (keepLines >= lines.length) {
        return {
          mode: 'truncate', before, after: before, keepChars: 0, keepLines, content: null,
          rejected: 'truncate keep ' + lineCount + ' lines covers all ' + lines.length + ' lines (nothing pruned)'
        };
      }
    } else if (parsed.keepCount) {
      cutIndex = parsed.keepCount;
    } else {
      return {
        mode: 'truncate', before, after: before, keepChars: 0, keepLines: null, content: null,
        rejected: 'truncate requested without a keep size (expected: truncate keep <N> lines|chars)'
      };
    }
    cutIndex = Math.min(before, Math.max(0, cutIndex));
    const keepChars = cutIndex;
    const prefix = origText.slice(0, cutIndex);
    const discardedChars = Math.max(0, before - cutIndex);

    // Fixed-point iterate so the banner's own digits are consistent.
    let guess = prefix.length + 200;
    let content = null;
    for (let i = 0; i < 8; i += 1) {
      const meta = encodeMeta({ before, after: guess, keep: keepChars, mode: 'truncate', seq });
      content = [{ type: 'text', text: prefix + truncateBanner({ meta, summary }) }];
      const exact = textLength(content);
      if (exact === guess) break;
      guess = exact;
    }
    const after = textLength(content);
    if (after >= before) {
      // The banner would cost as much as the tail it removes — not worth a rewrite.
      return {
        mode: 'truncate',
        before,
        after: before,
        keepChars: 0,
        keepLines: null,
        content: null,
        rejected: `truncate not worth it: rewrite ${after} >= original ${before} chars (nothing to gain)`
      };
    }
    return { mode: 'truncate', before, after, keepChars, keepLines, content };
  }

  // replace | discard
  let guess = 200;
  let content = null;
  for (let i = 0; i < 8; i += 1) {
    const meta = encodeMeta({ before, after: guess, keep: 0, mode, seq });
    content = [{ type: 'text', text: replaceBanner({ meta, summary, mode }) }];
    const exact = textLength(content);
    if (exact === guess) break;
    guess = exact;
  }
  const after = textLength(content);
  if (after >= before) {
    return {
      mode,
      before,
      after: before,
      keepChars: 0,
      keepLines: null,
      content: null,
      rejected: `${mode} not worth it: rewrite ${after} >= original ${before} chars (nothing to gain)`
    };
  }
  return { mode, before, after, keepChars: 0, keepLines: null, content };
}
