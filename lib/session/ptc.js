/**
 * dsh-oswyn/session/ptc — PTC (run_code) envelope compression.
 *
 * PTC programs can call many tools in one `run_code` call. Only the outer
 * `tool/result` event is a surface node; `tool/ptc-dispatch` events are
 * observational. This module reads those dispatch events, discards any
 * policy/failed subcalls, and for oversized outputs performs byte-for-byte
 * prefix truncation (keeping the first N lines to preserve KV-Cache hit rate)
 * with a concise per-subcall tail summary — never attempts a surfaceOp on a
 * dispatch event.
 *
 * @module dsh-oswyn/session/ptc
 */

import { encodeMeta, hasMeta } from '../core/markers.js';
import { plan as corePlan } from '../core/plan.js';
import { appendToolResultReplace, getCallInputChars, getEventText, getToolName, isOnSurface, measureArgsLen } from './surface.js';
import { markCallArgsDiscarded } from './applier.js';
import { matchesToolName, planAutoCompress, planAutoDiscard, isFailureResult } from './auto-policy.js';
import { CONFIG_DEFAULTS } from '../config.js';

function blocksText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function sourceCallId(event) {
  return String(event?.data?.message?.source?.callId || event?.data?.message?.toolCallId || event?.data?.message?.callId || '');
}

/** Collect the tool/ptc-dispatch events belonging to one outer run_code result. */
export function collectPtcSubcalls(session, resultEvent) {
  const rootCallId = sourceCallId(resultEvent);
  if (!rootCallId || typeof session?.snapshotEvents !== 'function') return [];
  const all = session.snapshotEvents();
  const out = [];
  for (const ev of all) {
    if (!ev || typeof ev.seq !== 'number' || ev.seq >= resultEvent.seq) continue;
    if (ev.type !== 'tool/ptc-dispatch') continue;
    const d = ev.data || {};
    if (String(d.rootCallId || '') !== rootCallId) continue;
    const text = blocksText(d.content);
    let isError = d.isError === true;
    if (!isError) {
      if (typeof d.exitCode === 'number' && d.exitCode !== 0) {
        isError = true;
      } else if (text.startsWith('{') && text.endsWith('}')) {
        try {
          const val = JSON.parse(text);
          if (typeof val?.exitCode === 'number' && val.exitCode !== 0) isError = true;
          if (typeof val?.exitCode === 'string' && /^-?[1-9]\d*$/.test(val.exitCode.trim())) isError = true;
          if (val?.isError === true) isError = true;
        } catch (_) {}
      } else if (/(?:[\[(]\s*exit\s*(?:code|status)[:\s]+-?[1-9]\d*\s*[\])]|\b(?:command\s+failed(?:\s+with)?|process\s+exited(?:\s+with)?|exited\s+with|failed\s+with)[:\s]+(?:exit\s+)?(?:code|status)[:\s]+-?[1-9]\d*\b|["']?exitCode["']?\s*:\s*["']?-?[1-9]\d*["']?)/i.test(text)) {
        isError = true;
      }
    }
    out.push({
      seq: ev.seq,
      name: String(d.name || 'tool'),
      isError,
      inputChars: measureArgsLen(d.arguments),
      chars: text.length,
      text
    });
  }
  return out;
}

function summarizeSubcall(s) {
  const text = String(s.text || '').trim();
  if (!text) return '(empty)';
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value.length + ' items';
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).slice(0, 8);
      return 'keys: ' + (keys.length ? keys.join(', ') : '(object)');
    }
  } catch (_) {}
  const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '(empty)';
  return first.length > 180 ? first.slice(0, 177) + '...' : first;
}

function buildSubcallTailLines(subcalls, headerLine = '[oswyn PTC 子调用已自动压缩]') {
  const lines = headerLine ? [headerLine] : [];
  for (const s of subcalls) {
    if (s.discarded) {
      lines.push('- ' + s.name + ': [discarded by policy]');
    } else {
      lines.push('- ' + s.name + (s.isError ? ' [error]' : '') + ': ' + summarizeSubcall(s) + ' (' + s.chars + ' chars)');
    }
  }
  return lines.join('\n');
}

function buildContent(meta, subcalls, allDiscarded, minimal = false) {
  if (minimal && allDiscarded) {
    const names = subcalls.filter((s) => s.discarded).map((s) => s.name).join(', ');
    return [{ type: 'text', text: meta + '\n[oswyn PTC 子调用已丢弃: ' + names + ']' }];
  }
  const header = allDiscarded ? '[oswyn PTC 子调用已丢弃]' : '[oswyn PTC 子调用已自动压缩]';
  return [{ type: 'text', text: meta + '\n' + buildSubcallTailLines(subcalls, header) }];
}

/**
 * Compress one outer run_code result:
 * - When all subcalls are discarded, discard the outer result.
 * - When the outer output exceeds minChars and has > keepLines lines, perform
 *   prefix truncation (keeping the first keepLines lines byte-for-byte for
 *   KV-cache stability) and append the per-subcall summary at the tail.
 * - Otherwise (e.g. a discarded subcall like validate_dsh_ui in a short multi-tool
 *   run_code, or a huge single-line output where line truncation cannot cut),
 *   replace with the compact per-subcall summary.
 */
export function autoCompressPtcSubcalls(session, event, opts = {}) {
  try {
    if (!session || !event || event.type !== 'tool/result') return null;
    if (!isOnSurface(session, event.seq)) return null;
    const orig = getEventText(event);
    if (!orig || hasMeta(orig)) return null;
    if (String(getToolName(session, event) || '').toLowerCase() !== 'run_code') return null;
    if (isFailureResult(event)) return null;
    const subcalls = collectPtcSubcalls(session, event);
    if (subcalls.length === 0) return null;
    // Mark subcalls explicitly listed for unconditional discard. This check
    // happens before minChars so even a small validate_dsh_ui result is removed.
    const discardPatterns = Array.isArray(opts.discardTools) ? opts.discardTools : [];
    const configuredKeepLines = Number(opts.keepLines) > 0 ? Math.trunc(Number(opts.keepLines)) : 30;
    for (const s of subcalls) {
      const synthetic = {
        type: 'tool/result',
        seq: s.seq,
        data: { message: { role: 'tool', source: { toolName: s.name, callId: s.name }, isError: s.isError, content: [{ type: 'text', text: s.text }] } }
      };
      const discardPlan = planAutoDiscard(synthetic, {
        forceTools: discardPatterns,
        forceFailure: opts.discardFailed === true,
        allowErrors: opts.discardFailed === true,
        toolName: s.name,
        inputChars: s.inputChars || 0
      });
      s.discarded = Boolean(discardPlan);
      s.discardPlan = discardPlan;
      if (!s.discarded) {
        s.autoCompressPlan = planAutoCompress(synthetic, {
          minChars: opts.minChars,
          keepLines: configuredKeepLines,
          toolName: s.name
        });
      }
    }
    const discardedCount = subcalls.filter((s) => s.discarded).length;
    const minChars = Math.max(200, Number(opts.minChars) || 4000);
    if (discardedCount === 0 && orig.length < minChars) return null;
    // Never auto-compress an aggregate that contains a protected tool's output
    // (e.g. read/write/edit inside a PTC program). Defaults to built-in protected tools.
    const protectedPatterns = Array.isArray(opts.protectedTools)
      ? opts.protectedTools
      : (CONFIG_DEFAULTS.autoCompressTieredProtectedTools || []);
    if (subcalls.some((s) => !s.discarded && !s.isError && protectedPatterns.some((p) => matchesToolName(p, s.name)))) return null;
    const allDiscarded = discardedCount === subcalls.length;
    const callId = sourceCallId(event);

    // Prefer prefix truncation (mode='truncate', keeping first keepLines lines)
    // whenever not all subcalls are discarded and the outer output is oversized.
    if (!allDiscarded && orig.length >= minChars) {
      const tailSummary = buildSubcallTailLines(subcalls, '[oswyn PTC 子调用已自动压缩]');
      const truncPlan = corePlan(
        { seq: event.seq, event },
        { mode: 'truncate', keepCount: configuredKeepLines, keepUnit: 'lines', seq: event.seq, summary: tailSummary },
        'run_code'
      );
      if (truncPlan && !truncPlan.rejected && truncPlan.content && truncPlan.after < truncPlan.before) {
        const write = appendToolResultReplace(session, event.seq, truncPlan.content);
        if (write.ok) {
          return {
            seq: event.seq,
            mode: 'truncate',
            toolName: 'run_code',
            callId,
            before: truncPlan.before,
            inputChars: 0,
            after: truncPlan.after,
            keepChars: truncPlan.keepChars,
            keepLines: truncPlan.keepLines ?? configuredKeepLines,
            fact: '',
            summary: '保留前 ' + (truncPlan.keepLines ?? configuredKeepLines) + ' 行 · PTC ' + subcalls.length + ' 个子调用尾部已截断',
            trigger: 'auto'
          };
        }
      }
    }

    const outerInputChars = allDiscarded ? getCallInputChars(session, event, callId) : 0;
    const subcallInputChars = allDiscarded && outerInputChars === 0
      ? subcalls.reduce((sum, s) => sum + (s.inputChars || 0), 0)
      : 0;
    const inputChars = outerInputChars > 0 ? outerInputChars : subcallInputChars;
    const before = orig.length + inputChars;
    let guess = 200;
    let content = null;
    const mode = allDiscarded ? 'discard' : 'replace';
    for (let i = 0; i < 8; i += 1) {
      const meta = encodeMeta({ before, after: guess, keep: 0, mode, seq: event.seq });
      content = buildContent(meta, subcalls, allDiscarded, allDiscarded);
      const exact = content.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);
      if (exact === guess) break;
      guess = exact;
    }
    const after = content.reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0);
    if (after >= before && !allDiscarded && discardedCount === 0) return null;
    const write = appendToolResultReplace(session, event.seq, content);
    if (!write.ok) return null;
    if (allDiscarded && callId) {
      try { markCallArgsDiscarded(session, callId); } catch (_) {}
    }
    return {
      seq: event.seq,
      mode,
      toolName: 'run_code',
      callId,
      before,
      inputChars,
      after,
      keepChars: 0,
      keepLines: null,
      fact: allDiscarded ? 'PTC subcalls discarded by policy (' + discardedCount + ')' : '',
      summary: allDiscarded ? 'PTC ' + discardedCount + ' 个子调用已丢弃' : 'PTC ' + subcalls.length + ' 个子调用已压缩为结构化摘要',
      trigger: 'auto'
    };
  } catch (_) {
    return null;
  }
}
