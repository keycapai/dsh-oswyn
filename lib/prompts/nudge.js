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
      `[DSH-OSWYN 终局精确推理提示 (Reasoning-First Exemption)]`,
      `当前已进入最终答案推导/合成轮次（若无需继续调用工具，可免写 \`\`\`${SUMMARY_OPEN_TAG} 围栏，专注逐步推导）。`,
      `· 回溯门控：若需调取前序已被压缩的任何细节或数值，请调用 tool_result_recall 原样召回！`
    ].join('\n');
  }

  const primary = candidates.find((c) => c.isError) || candidates[candidates.length - 1];
  const { isError, lines, chars, inputChars, toolName } = primary;
  const inputNote = inputChars > 0 ? `（调用入参约 ${inputChars} 字符）` : '';
  const target = toolName || 'tool';

  if (isError) {
    return [
      `[DSH-OSWYN 失败调用精炼提示]`,
      `检测到上一步工具执行失败/报错 (${target}, 输出约 ${lines} 行 / ${chars} 字符${inputNote})。`,
      `【核心准则 · 丢弃 vs 压缩】：`,
      `· 强烈建议采用 \`discard\`（同时替换输入 + 输出，清空入参与报错），仅逐字保留 1~2 行失败根因与关键参数：`,
      `\`\`\`${SUMMARY_OPEN_TAG}`,
      `discard`,
      `- 失败结论：<记录失败根因，并逐字保留报错中的关键参数/数值/公式>`,
      `\`\`\``,
      `完整报错已持久留底账，后续若需细节可调用 tool_result_recall 逐字节召回。`
    ].join('\n');
  }

  return [
    `[DSH-OSWYN 上下文精炼提示]`,
    `上步工具输出约 ${lines} 行 / ${chars} 字符${inputNote} (${target})。`,
    `【精炼决策（严格区分「丢弃」与「压缩」边界）】：`,
    `1. 截断压缩 (\`truncate keep <N> lines\`) — 只替换输出，保留输入（长日志/测试首选，100% KV 缓存命中）；`,
    `2. 提炼压缩 (\`replace\`) — 只替换输出，保留输入（搜索/探测提取 1~2 行事实，逐字复制数值与公式）；`,
    `3. 丢弃 (\`discard\`) — 同时替换输入 + 输出（清空入参及结果，用于无果探针）。`,
    `【Step 0 豁免】：若为正在排查的核心源码、配置或 .env，全量保留，严禁压缩。`
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
      `[⚡ DSH-OSWYN 双通道共发契约唤醒]`,
      `检测到未精炼工具输出 (${targetNames}, 约 ${totalChars} 字符)。连续多步未精炼将导致上下文迅速膨胀。`,
      `【双通道共发要求】：调用后续工具前严禁留空正文！首部必须内联 \`\`\`${SUMMARY_OPEN_TAG} 围栏执行 truncate 或 discard（仅认围栏写法，勿用 XML 标签）。`,
      `【Step 0 豁免准则】：若为正在排查的核心代码或 .env/配置/密钥，全量保留，严禁压缩。`
    ].join('\n');
  }

  if (tier === 'budget') {
    return [
      `[⚡ DSH-OSWYN 载荷膨胀预算预警]`,
      `连续未精炼载荷已达 ${totalChars} 字符，KV-Cache 注意力正在严重稀释。`,
      `【预算控制指令】：请立即在下一步输出首部使用 \`\`\`${SUMMARY_OPEN_TAG} 围栏压缩历史冗余日志。`,
      `【Step 0 豁免准则】：若为活跃业务配置、.env 或核心代码，全量保留，保持原样常驻。`
    ].join('\n');
  }

  // Tier 1 Advisory
  return [
    `[⚡ DSH-OSWYN 上下文精炼建议]`,
    `上步工具输出达 ${totalChars} 字符，建议在输出首部使用 \`\`\`${SUMMARY_OPEN_TAG} 围栏提取 1~2 行紧凑事实。`,
    `【Step 0 豁免准则】：若为 .env/配置/密钥或正在排查的核心源码，100% 全量保留，严禁压缩。`
  ].join('\n');
}
