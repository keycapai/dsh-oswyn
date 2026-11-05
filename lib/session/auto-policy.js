/**
 * dsh-oswyn/session/auto-policy — shared, pure policy for automatic
 * compression and discard. Both the normal tool/result adapter and the PTC
 * subcall adapter call these functions; only the surface write differs.
 */

import { encodeMeta, hasMeta } from '../core/markers.js';
import { plan as corePlan } from '../core/plan.js';
import { getEventText } from './surface.js';

export function matchesToolName(pattern, name) {
  const p = String(pattern || '').trim().toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  if (!p || !n) return false;
  return p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : p === n;
}

function buildDiscardContent(before, fact, seq, opts = {}) {
  let guess = 160;
  let content = null;
  for (let i = 0; i < 8; i += 1) {
    const meta = encodeMeta({ before, after: guess, keep: 0, mode: 'discard', seq });
    const text = opts.minimal ? meta : (meta + '\n[oswyn 整段已丢弃]' + (fact ? '\n' + fact : ''));
    content = [{ type: 'text', text }];
    const exact = text.length;
    if (exact === guess) break;
    guess = exact;
  }
  return { content, after: content ? content[0].text.length : 0 };
}

/** Pick a human-meaningful first error line, skipping JSON braces/punctuation. */
export function meaningfulFailureLine(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'no output';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === 'object') {
        if (typeof value.exitCode === 'number' && value.exitCode !== 0) {
          const errText = value.stderr?.text || value.stderr || value.stdout?.text || value.stdout || '';
          const firstErr = String(errText).split('\n').map((l) => l.trim()).find(Boolean);
          if (firstErr) return `exit ${value.exitCode}: ${firstErr}`.slice(0, 180);
          return `command failed (exit code ${value.exitCode})`;
        }
        const candidate = value?.error?.message || value?.error || value?.message || value?.detail || value?.reason;
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 180);
        const key = Object.keys(value).find((k) => /error|message|detail|reason/i.test(k));
        if (key && typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 180);
      }
    } catch (_) {}
  }
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const candidates = lines.filter((l) => l && !/^[{}\[\]",:]+$/.test(l) && !/^file sandbox:/i.test(l) && !/^\[sandbox:/i.test(l));
  const errLine = candidates.find((l) => /(?:^error\b|error:|exception|traceback|fatal:|failed|exit\s*(?:code|status))/i.test(l));
  return errLine || candidates[0] || lines[0] || 'no output';
}

/**
 * Strict failure detection for automatic discard. Do not scan arbitrary output
 * for "Error:" — successful logs/source often mention errors. Trust metadata,
 * an actual bash exit marker at the end, or a run_code exception header.
 */
export function isFailureResult(event) {
  if (!event || event.type !== 'tool/result') return false;
  const msg = event.data?.message;
  if (msg?.isError || msg?.source?.isError) return true;
  if (event.data?.error) return true;
  if (typeof event.data?.exitCode === 'number' && event.data.exitCode !== 0) return true;
  if (typeof msg?.exitCode === 'number' && msg.exitCode !== 0) return true;
  const text = getEventText(event).trim();
  if (!text) return false;

  // JSON exitCode check (PTC tools.bash or structured tool failure)
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const val = JSON.parse(text);
      if (val && typeof val === 'object') {
        if (typeof val.exitCode === 'number' && val.exitCode !== 0) return true;
        if (typeof val.exitCode === 'string' && /^-?[1-9]\d*$/.test(val.exitCode.trim())) return true;
        if (val.isError === true) return true;
        if (typeof val.error === 'string' && val.error.trim()) return true;
      }
    } catch (_) {}
  }

  // Non-zero exit code check: matches bracketed markers ([exit code: 128]),
  // explicit failure phrases (Command failed: exit code 1, command failed with exit code 128,
  // process exited with status 128), or JSON/JS exitCode properties, without false-positiving
  // on prose/markdown tables that mention "exit code 1".
  if (/(?:[\[(]\s*exit\s*(?:code|status)[:\s]+-?[1-9]\d*\s*[\])]|\b(?:command\s+failed(?:\s+with)?|process\s+exited(?:\s+with)?|exited\s+with|failed\s+with)[:\s]+(?:exit\s+)?(?:code|status)[:\s]+-?[1-9]\d*\b|["']?exitCode["']?\s*:\s*["']?-?[1-9]\d*["']?)/i.test(text)) {
    return true;
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.some((l) => /^(?:Error:\s*code run failed|ToolCallError|Traceback \(most recent|UnhandledPromiseRejection|exit\s*(?:code|status)[:\s]+-?[1-9]\d*$)/i.test(l));
}
/**
 * Pure discard plan. Returns content + ledger fields, or null when the target
 * is neither failed nor force-listed.
 */
export function planAutoDiscard(event, opts = {}) {
  if (!event || event.type !== 'tool/result') return null;
  const orig = getEventText(event);
  if (orig && hasMeta(orig)) return null;
  const inputChars = Math.max(0, Math.trunc(Number(opts.inputChars) || 0));
  if (!orig && inputChars === 0) return null;
  const msg = event.data?.message;
  let toolName = String(opts.toolName || msg?.source?.toolName || '').trim();
  if (!toolName && /^(?:Error:\s*code run failed)/i.test(orig.trim())) {
    toolName = 'run_code';
  }
  if (!toolName && /(?:\[genui-validation\]|^UI validation result:)/i.test(orig.trim())) {
    toolName = 'validate_dsh_ui';
  }
  const forced = Array.isArray(opts.forceTools) && opts.forceTools.some((p) => matchesToolName(p, toolName));
  const errorFlag = isFailureResult(event);
  const flagged = (opts.allowErrors !== false && errorFlag) || (opts.forceFailure === true && errorFlag);
  if (!forced && !flagged) return null;
  const firstLine = meaningfulFailureLine(orig);
  const fact = (forced && !flagged ? 'Discarded by policy; full output omitted: ' : 'Execution failed; full output omitted: ') + firstLine.slice(0, 180);
  const before = orig.length + inputChars;
  let built = buildDiscardContent(before, fact, event.seq);
  if (forced && built.after >= before) {
    const minimal = buildDiscardContent(before, fact, event.seq, { minimal: true });
    if (minimal.after < built.after) built = minimal;
  }
  if (!built.content) return null;
  return {
    seq: event.seq,
    mode: 'discard',
    toolName,
    callId: msg?.source?.callId || msg?.toolCallId || msg?.callId || '',
    before,
    inputChars,
    after: built.after,
    keepChars: 0,
    keepLines: null,
    fact,
    summary: fact,
    content: built.content,
    trigger: 'auto'
  };
}

/** Pure truncate plan for one tool result. */
export function planAutoCompress(event, opts = {}) {
  if (!event || event.type !== 'tool/result') return null;
  const orig = getEventText(event);
  const minChars = Math.max(200, Number(opts.minChars) || 4000);
  if (!orig || orig.length < minChars) return null;
  if (hasMeta(orig)) return null;
  const configured = Number(opts.keepLines);
  if (!Number.isFinite(configured) || configured <= 0) return null;
  const lines = orig.split('\n');
  const keepLines = Math.max(1, Math.min(lines.length, Math.trunc(configured)));
  if (keepLines >= lines.length) return null;
  const toolName = String(opts.toolName || event.data?.message?.source?.toolName || event.data?.toolName || '').trim();
  const parsed = { mode: 'truncate', keepCount: keepLines, keepUnit: 'lines', targetSeq: event.seq, summary: '', fact: '' };
  const planResult = corePlan({ seq: event.seq, event }, parsed, toolName);
  if (planResult.rejected) return null;
  return {
    seq: event.seq,
    mode: planResult.mode,
    toolName,
    callId: event.data?.message?.source?.callId || event.data?.message?.callId || '',
    before: planResult.before,
    after: planResult.after,
    keepChars: planResult.keepChars,
    keepLines: planResult.keepLines ?? keepLines,
    content: planResult.content,
    summary: '保留前 ' + (planResult.keepLines ?? keepLines) + ' 行，尾部已截断',
    trigger: 'auto'
  };
}
