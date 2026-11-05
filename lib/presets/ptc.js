/**
 * dsh-oswyn/presets/ptc — Programmatic Tool Calling (PTC / `run_code`) preset.
 *
 * Isolates all PTC-specific logic (`tool/ptc-dispatch` subcall collection,
 * per-subcall policy discard, outer `run_code` prefix truncation vs full
 * `allDiscarded` input+output discard) while reusing core primitives and modes.
 *
 * Distinction between Compress and Discard in PTC:
 *   - Subcall Compress (when `!allDiscarded`): ONLY replaces the outer `run_code`
 *     output (`inputChars = 0`, `before = outputChars`), preserving the `run_code`
 *     JavaScript code arguments in `assistant/message` intact.
 *   - Whole-PTC Discard (when `allDiscarded === true` or `discard entire-ptc`):
 *     Replaces BOTH the outer `run_code` input code arguments (`markCallArgsDiscarded`)
 *     AND the output (`before = outputChars + inputChars`).
 *
 * @module dsh-oswyn/presets/ptc
 */

import { encodeMeta, hasMeta } from '../core/markers.js';
import {
  compressOutputOnly,
  isAutoCompressSkipped,
  markCallArgsDiscarded
} from '../core/primitives.js';
import {
  appendToolResultReplace,
  getCallInputChars,
  getEventText,
  getToolName,
  isOnSurface,
  measureArgsLen
} from '../session/surface.js';
import {
  matchesToolName,
  planAutoCompress,
  planAutoDiscard,
  isFailureResult
} from '../session/auto-policy.js';
import { CONFIG_DEFAULTS } from '../config.js';

function blocksText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function sourceCallId(event) {
  return String(
    event?.data?.message?.source?.callId
    || event?.data?.message?.toolCallId
    || event?.data?.message?.callId
    || ''
  );
}

/** Collect the `tool/ptc-dispatch` events belonging to one outer `run_code` result. */
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
 * Compress or discard one outer `run_code` result based on its PTC subcalls.
 * Reuses `compressOutputOnly` for prefix truncation and `markCallArgsDiscarded`
 * when `allDiscarded === true`.
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

    const discardPatterns = Array.isArray(opts.discardTools) ? opts.discardTools : [];
    const configuredKeepLines = Number(opts.keepLines) > 0 ? Math.trunc(Number(opts.keepLines)) : 30;

    for (const s of subcalls) {
      const synthetic = {
        type: 'tool/result',
        seq: s.seq,
        data: {
          message: {
            role: 'tool',
            source: { toolName: s.name, callId: s.name },
            isError: s.isError,
            content: [{ type: 'text', text: s.text }]
          }
        }
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

    const protectedPatterns = Array.isArray(opts.protectedTools)
      ? opts.protectedTools
      : (CONFIG_DEFAULTS.autoCompressTieredProtectedTools || []);
    if (subcalls.some((s) => !s.discarded && !s.isError && protectedPatterns.some((p) => matchesToolName(p, s.name)))) {
      return null;
    }

    const allDiscarded = discardedCount === subcalls.length;
    const callId = sourceCallId(event);

    // Case 1: Compress Output Only via prefix truncation (preserves outer run_code script input)
    if (!allDiscarded && orig.length >= minChars) {
      const tailSummary = buildSubcallTailLines(subcalls, '[oswyn PTC 子调用已自动压缩]');
      const truncOut = compressOutputOnly(
        session,
        { seq: event.seq, event },
        {
          mode: 'truncate',
          keepCount: configuredKeepLines,
          keepUnit: 'lines',
          seq: event.seq,
          summary: tailSummary
        },
        { trigger: 'auto' }
      );
      if (truncOut.ok && truncOut.appliedEntry) {
        return {
          ...truncOut.appliedEntry,
          toolName: 'run_code',
          callId,
          fact: '',
          summary: '保留前 ' + (truncOut.appliedEntry.keepLines ?? configuredKeepLines) + ' 行 · PTC ' + subcalls.length + ' 个子调用尾部已截断',
          trigger: 'auto'
        };
      }
    }

    // Case 2: All subcalls discarded (Discard Input + Output) OR partial subcall replace (Compress Output Only)
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

/**
 * Run PTC envelope auto-compression on seen tool results when no active summary fence was emitted.
 */
export function runPtcAutoPolicies(session, seenResults, resolved, helpers = {}) {
  const applied = [];
  if (resolved.autoCompressPtcSubcalls === false) return applied;
  const { hasFence, protectedTools, logger } = helpers;
  if (hasFence) return applied;

  try {
    for (const latest of seenResults) {
      if (isAutoCompressSkipped(session, latest.seq)) continue;
      const entry = autoCompressPtcSubcalls(session, latest, {
        minChars: resolved.autoCompressMinChars,
        protectedTools,
        discardTools: resolved.autoDiscardTools,
        discardFailed: resolved.autoDiscardFailed !== false,
        keepLines: resolved.autoCompressKeepLines
      });
      if (entry) applied.push(entry);
    }
  } catch (err) {
    logger?.debug?.('[dsh-oswyn] PTC auto-compression skipped: ' + String(err).slice(0, 120));
  }
  return applied;
}
