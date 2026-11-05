/**
 * dsh-oswyn/session/retain — retention policy (keep / truncate / discard / replace).
 *
 * Decides what to do with a tool result before the applier rewrites it. Pure
 * apart from an optional read-only probe of the session event text.
 *
 * Policy intent:
 *   - Failed / exploratory / empty outputs → discard → fold to a short fact.
 *   - Valuable outputs (tests passed, diffs, structured data that matters) → keep.
 *   - Medium / long useful output → truncate (prefix-preserving).
 *
 * @module dsh-oswyn/session/retain
 */

import { getEventText, getToolName } from './surface.js';

/** Signals that a tool result is a failure / error dump.
 * Broadened to capture JSON exitCodes (run_code output), bracketed codes, and standard error forms. */
const ERROR_RE = /(?:[\[(]\s*exit\s*(?:code|status)[:\s]+-?[1-9]\d*\s*[\])]|\b(?:exit\s*(?:code|status)|exited\s+with\s+(?:exit\s+)?(?:code|status)|command\s+failed\s+with\s+(?:exit\s+)?(?:code|status))[:\s]+-?[1-9]\d*\b|["']?exitCode["']?\s*:\s*["']?-?[1-9]\d*["']?)|"isError":\s*true|ToolCallError|Command failed|Traceback \(most recent|SyntaxError:|TypeError:|ReferenceError:|AssertionError:|UnhandledPromiseRejection|\bFATAL\b|\bERR!\b|\bError:\s+/i;
/** Signals of an exploratory "found nothing" style result. */
const EMPTY_RE = /^(?:\s*(?:no matches?|no results?|not found|0 matches|无匹配|未找到|未命中)\b.*)$/im;

/**
 * Heuristic value detection for a raw text blob.
 * @param {string} text
 * @param {{isError?:boolean}} [meta]
 * @returns {{isError:boolean, isEmpty:boolean, valuable:boolean, lines:number, chars:number}}
 */
export function analyze(text, meta = {}) {
  const str = typeof text === 'string' ? text : '';
  const chars = str.length;
  const lines = str.length === 0 ? 0 : str.split('\n').length;
  const isError = Boolean(meta.isError) || ERROR_RE.test(str);
  // "Valuable" = compact, information-dense output worth keeping verbatim:
  // a passing test summary, a small diff, or a short structured result.
  const valuable = !isError && chars > 0 && chars <= 800
    && /(?:passed|PASS|✔|\bok\b|diff --git|\+{1,3} |=>|\{[\s\S]*\})/i.test(str);
  // "Empty" only for genuinely empty / explicit no-match outputs — NOT merely
  // short text (a short status line is small but not "empty").
  const isEmpty = chars === 0 || (EMPTY_RE.test(str) && chars <= 200);
  return { isError, isEmpty, valuable, lines, chars };
}

/**
 * Decide the retention action for one target.
 *
 * @param {{seq:number|string, event?:object, text?:string}} target
 * @param {object} [parsed]  parseSummaryBody result (may carry explicit mode/fact)
 * @param {{session?:object, charsBefore?:number}} [ctx]
 * @returns {{action:'keep'|'truncate'|'discard'|'replace', mode?:string,
 *            reason:string, fact?:string, keepLines?:number, keepChars?:number}}
 */
export function decideRetention(target, parsed = {}, ctx = {}) {
  const session = ctx.session;
  const event = target?.event;
  const text = typeof target?.text === 'string' ? target.text : getEventText(event);
  const toolName = session && event ? getToolName(session, event) : (parsed.targetTool || '');
  const isErrorMeta = Boolean(event?.data?.message?.isError || event?.data?.message?.source?.isError);
  const info = analyze(text, { isError: isErrorMeta });

  // Explicit agent directive always wins (but discard still folds to fact).
  if (parsed.mode === 'discard') {
    const fact = (parsed.fact || parsed.summary || '').trim()
      || `${toolName || 'tool'} 调用无有效返回（${info.chars} 字符），已丢弃`;
    return { action: 'discard', mode: 'discard', reason: 'agent requested discard', fact };
  }
  if (parsed.mode === 'truncate') {
    return {
      action: 'truncate',
      mode: 'truncate',
      reason: 'agent requested truncate',
      keepLines: parsed.keepUnit === 'lines' ? parsed.keepCount : undefined,
      keepChars: parsed.keepUnit === 'chars' ? parsed.keepCount : undefined
    };
  }
  if (parsed.mode === 'replace') {
    return {
      action: 'replace',
      mode: 'replace',
      reason: 'agent requested replace',
      fact: (parsed.summary || parsed.fact || '').trim()
    };
  }

  // Failure dumps of non-trivial size → discard (fact captures the first error line).
  if (info.isError && info.chars > 150) {
    const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    const fact = `${toolName || 'tool'} 调用失败（${firstLine.slice(0, 120)}），完整堆栈已省略`;
    return { action: 'discard', mode: 'discard', reason: 'error output', fact };
  }

  // Empty / "no match" exploratory output → discard.
  if (info.isEmpty) {
    const fact = `${toolName || 'tool'} 无有效返回（${info.chars} 字符）`;
    return { action: 'discard', mode: 'discard', reason: 'empty/exploratory output', fact };
  }

  // Compact, information-dense output → keep verbatim.
  if (info.valuable) {
    return { action: 'keep', reason: 'valuable compact output' };
  }

  // Agent-guided principle: Never auto-truncate useful output.
  // Code, configs, logs, and tool outputs stay 100% resident unless the agent explicitly specifies truncate.
  return { action: 'keep', reason: 'agent-guided: keep verbatim unless explicit truncate requested' };
}

/**
 * Group a set of failed/exploratory results into a single discard checkpoint.
 * Returns the seq span to collapse and the assembled fact text.
 *
 * @param {Array<{seq:number, event?:object, text?:string}>} targets
 * @param {{session?:object}} [ctx]
 * @returns {{ok:boolean, startSeq?:number, endSeq?:number, fact?:string, count?:number, reason?:string}}
 */
export function groupDiscard(targets, ctx = {}) {
  const list = Array.isArray(targets) ? targets.filter((t) => Number.isInteger(t?.seq)) : [];
  if (list.length === 0) return { ok: false, reason: 'no discardable targets' };
  const seqs = list.map((t) => t.seq).sort((a, b) => a - b);
  const facts = [];
  for (const t of list) {
    const text = typeof t.text === 'string' ? t.text : getEventText(t.event);
    const info = analyze(text, { isError: Boolean(t.event?.data?.message?.isError) });
    const toolName = (ctx.session && t.event ? getToolName(ctx.session, t.event) : '') || 'tool';
    if (t.fact && typeof t.fact === 'string') {
      const cleanFact = t.fact.replace(/^[-*•\s]+/, '').trim();
      if (cleanFact) {
        facts.push(`· ${toolName}(seq ${t.seq}): ${cleanFact.slice(0, 120)}`);
        continue;
      }
    }
    if (info.isError) {
      let errorSummary = '';
      try {
        const parsedJson = JSON.parse(text);
        if (parsedJson && typeof parsedJson === 'object') {
          errorSummary = parsedJson.error || parsedJson.message || parsedJson.reason || parsedJson.detail || '';
        }
      } catch (_) {}
      if (!errorSummary) {
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && l !== '{' && l !== '}' && l !== '[' && l !== ']');
        errorSummary = lines.find((l) => ERROR_RE.test(l)) || lines[0] || '执行异常';
      }
      facts.push(`· ${toolName}(seq ${t.seq}) 失败: ${String(errorSummary).slice(0, 100)}`);
    } else {
      facts.push(`· ${toolName}(seq ${t.seq}) 无有效返回（${info.chars} 字符）`);
    }
  }
  const fact = list.length === 1 ? facts[0] : `[已折叠 ${list.length} 条探索/失败]\n${facts.join('\n')}`;
  return { ok: true, startSeq: seqs[0], endSeq: seqs[seqs.length - 1], fact, count: seqs.length };
}
