/**
 * dsh-oswyn/prompts/nudge — Dual-dimension (inputChars + outputChars) pressure
 * detector and smart nudge generator (with OSWYN v2.1 Formula-Safe Verbatim
 * & Final-Turn Reasoning-First Exemption support, plus multi-tier adaptive
 * willingness nudge notices).
 *
 * Why this improves active compression rate & preserves intelligence:
 *   1. Inspects both `outputChars` (tool result length) AND `inputChars`
 *      (tool-call arguments length).
 *   2. Explicitly reminds the model of the difference between:
 *      - 丢弃 (`discard` / `discard entire-ptc`): replaces BOTH input and output
 *        (`before = inputChars + outputChars`)
 *      - 压缩 (`truncate keep <N> lines` / `replace`): replaces ONLY output,
 *        keeping input intact (`before = outputChars`)
 *   3. Enforces Formula-Safe Verbatim preservation (never paraphrasing exact
 *      arithmetic/bitwise formulas or active failure parameters into vague prose)
 *      and Proactive Recall (`tool_result_recall`) when earlier details are needed.
 *   4. Supports multi-tier adaptive notices:
 *      - Tier 1 Advisory: single-step compacting advice
 *      - Tier 2 Contractual: inertia wakeup with explicit co-emission requirements
 *      - Tier 3 Token-Budget Alert: cumulative bloat / deep horizon KV-cache protection
 *
 * @module dsh-oswyn/prompts/nudge
 */

import { SUMMARY_OPEN_TAG } from './base.js';
import { getCallInputChars, measureArgsLen } from '../session/surface.js';
import { analyze } from '../session/retain.js';

function extractMsgText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  return msg.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text || '')
    .join('\n');
}

function findInputCharsInMessages(outgoing, callId) {
  if (!callId || !Array.isArray(outgoing)) return 0;
  for (let i = outgoing.length - 1; i >= 0; i -= 1) {
    const m = outgoing[i];
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b && b.type === 'tool-call' && (b.callId === callId || b.id === callId)) {
        const len = measureArgsLen(b.arguments ?? b.input);
        if (len > 0) return len;
      }
    }
  }
  return 0;
}

/**
 * Scan trailing tool messages from the latest step and collect candidates
 * that exceed output or error thresholds.
 */
export function collectNudgeCandidates(outgoing, resolved = {}, session = null) {
  if (!Array.isArray(outgoing) || outgoing.length === 0) return [];
  const trailingToolMsgs = [];
  for (let i = outgoing.length - 1; i >= 0; i -= 1) {
    const m = outgoing[i];
    if (m && m.role === 'assistant') break; // boundary of the prior assistant turn
    const isToolMsg = m && (m.role === 'tool' || m.source?.toolName !== undefined);
    if (isToolMsg) {
      trailingToolMsgs.unshift(m);
    }
  }
  if (trailingToolMsgs.length === 0) return [];

  const candidates = [];
  for (const msg of trailingToolMsgs) {
    const txt = extractMsgText(msg);
    const already = txt.includes('[oswyn:') || txt.includes('[oswyn-meta:');
    if (already) continue;

    const isError = analyze(txt, { isError: msg.isError || msg.source?.isError }).isError;
    const minChars = isError ? (resolved.nudgeErrorThresholdChars ?? 400) : (resolved.nudgeThresholdChars ?? 600);
    const minLines = isError ? (resolved.nudgeErrorThresholdLines ?? 12) : (resolved.nudgeThresholdLines ?? 18);
    const lines = txt ? txt.split('\n').length : 0;
    const callId = msg.toolCallId || msg.source?.callId || msg.callId || '';
    const toolName = msg.source?.toolName || msg.toolName || '';
    const inputChars = findInputCharsInMessages(outgoing, callId)
      || (session && callId ? getCallInputChars(session, null, callId) : 0);

    if (txt.length >= minChars || lines >= minLines) {
      candidates.push({
        msg,
        txt,
        isError,
        lines,
        chars: txt.length,
        inputChars,
        callId,
        toolName
      });
    }
  }
  return candidates;
}

/**
 * Build the nudge message text from candidate tool results.
 * Explicitly contrasts Discard (replaces input + output) vs. Compress (replaces output only),
 * and enforces Formula-Safe Verbatim preservation and Final-Turn Reasoning-First Exemption.
 */
export function buildNudgePromptText(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (options && options.isFinalSynthesis) {
    return [
      `[DSH-OSWYN 终局豁免] 若无需继续调用工具，本步可免写 \`\`\`${SUMMARY_OPEN_TAG} 围栏；需前序细节请调用 tool_result_recall 召回。`
    ].join('\n');
  }

  const primary = candidates.find((c) => c.isError) || candidates[candidates.length - 1];
  const { isError, lines, chars, inputChars, toolName } = primary;
  const inputNote = inputChars > 0 ? `，入参约 ${inputChars} 字符` : '';
  const target = toolName || 'tool';

  if (isError) {
    return [
      `[DSH-OSWYN 失败调用精炼提示] ${target} 执行失败（${lines} 行 / ${chars} 字符${inputNote}）。`,
      `建议首部使用 \`\`\`${SUMMARY_OPEN_TAG} + \`discard\` 清空报错与入参，仅逐字保留 1~2 行根因与关键参数（原文可用 tool_result_recall 召回）。`
    ].join('\n');
  }

  return [
    `[DSH-OSWYN 上下文精炼提示] ${target} 输出约 ${lines} 行 / ${chars} 字符${inputNote}。`,
    `可选 \`truncate keep <N> lines\` / \`replace\`（仅压输出）或 \`discard\`（清空入参与输出）；活跃源码与配置保持原样。`
  ].join('\n');
}

/**
 * Build adaptive multi-tier nudge notice adhering to Step 0 Exemption rules
 * and co-emission contracts.
 *
 * @param {'advisory'|'contractual'|'budget'|string} tier
 * @param {Array} [candidates]
 * @param {object} [contextInfo]
 * @returns {string|null}
 */
export function buildAdaptiveNudgeNotice(tier, candidates = [], contextInfo = {}) {
  if (!tier || tier === 'none') return null;

  const targetNames = (candidates || []).map((c) => c.toolName || 'tool').join(', ') || 'tool';
  const candidateChars = (candidates || []).reduce((acc, c) => acc + (c.chars || 0), 0);
  // Budget/contractual tiers trigger on accumulated + current payload, so report the same
  // number that fired the guard instead of only the current candidates' chars.
  const totalChars = Number.isFinite(contextInfo.reportedChars) && contextInfo.reportedChars > 0
    ? contextInfo.reportedChars
    : candidateChars;

  if (tier === 'contractual') {
    return [
      `[⚡ DSH-OSWYN 精炼提醒] 未精炼输出：${targetNames}（约 ${totalChars} 字符）。`,
      `调用后续工具前请在正文首部附带 \`\`\`${SUMMARY_OPEN_TAG} 围栏执行 truncate / replace / discard（活跃源码、配置与密钥豁免）。`
    ].join('\n');
  }

  if (tier === 'budget') {
    return [
      `[⚡ DSH-OSWYN 载荷预算预警] 累计未精炼载荷已达 ${totalChars} 字符。`,
      `请在下一步首部使用 \`\`\`${SUMMARY_OPEN_TAG} 围栏压缩历史冗余输出（活跃源码、配置与密钥豁免）。`
    ].join('\n');
  }

  // Tier 1 Advisory
  return [
    `[⚡ DSH-OSWYN 精炼建议] 上步输出约 ${totalChars} 字符，建议在首部使用 \`\`\`${SUMMARY_OPEN_TAG} 围栏压缩（活跃源码、配置与密钥豁免）。`
  ].join('\n');
}
