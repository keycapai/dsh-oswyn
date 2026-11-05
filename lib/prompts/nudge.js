/**
 * dsh-oswyn/prompts/nudge — Dual-dimension (inputChars + outputChars) pressure
 * detector and smart nudge generator.
 *
 * Why this improves active compression rate:
 *   1. Inspects both `outputChars` (tool result length) AND `inputChars`
 *      (tool-call arguments length).
 *   2. Explicitly reminds the model of the difference between:
 *      - 丢弃 (`discard` / `discard entire-ptc`): replaces BOTH input and output
 *        (`before = inputChars + outputChars`)
 *      - 压缩 (`truncate keep <N> lines` / `replace`): replaces ONLY output,
 *        keeping input intact (`before = outputChars`)
 *   3. Prevents the classic mistake where the model uses `replace` on a tool
 *      with large input (`inputChars`) but short output (`outputChars`), which
 *      would otherwise be rejected as `replace not worth it`.
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
    const isToolMsg = m && (m.role === 'tool' || m.source?.toolName !== undefined);
    if (!isToolMsg) break;
    trailingToolMsgs.unshift(m);
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
 * Explicitly contrasts Discard (replaces input + output) vs. Compress (replaces output only).
 */
export function buildNudgePromptText(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const primary = candidates.find((c) => c.isError) || candidates[candidates.length - 1];
  const { isError, lines, chars, inputChars } = primary;
  const inputNote = inputChars > 0 ? `（调用入参约 ${inputChars} 字符）` : '';

  if (isError) {
    return [
      '[DSH-OSWYN 失败调用精炼提示]',
      '检测到上一步工具执行失败/报错（输出约 ' + lines + ' 行 / ' + chars + ' 字符' + inputNote + '）。',
      '【核心准则 · 丢弃 vs 压缩】：',
      '· **丢弃 (`discard`) = 同时替换输入 + 输出**：不仅折叠报错堆栈输出，还会将本次失败调用的入参 (`arguments`) 清空为 `{}`，一次性回收输入与输出 Token。',
      '· 强烈建议采用 Mode C (`discard`) 整段丢弃报错调用，仅提炼 1 行核心事实结论：',
      '```' + SUMMARY_OPEN_TAG,
      'discard',
      '- 失败结论：<用 1 句话记录失败原因，如命令退出码/找不到模块/语法错误>',
      '```',
      '完整报错已持久留底账，随时可用 tool_result_recall 逐字节召回。'
    ].join('\n');
  }

  return [
    '[DSH-OSWYN 上下文精炼提示]',
    '上一步工具输出约 ' + lines + ' 行 / ' + chars + ' 字符' + inputNote + (candidates.length > 1 ? '（本步共 ' + candidates.length + ' 项超阈值工具输出）' : '') + '。',
    '【三步主动精炼决策（严格区分「丢弃」与「压缩」边界）】：',
    '1. **丢弃 (`discard` / `discard entire-ptc`) — 同时替换输入 + 输出**：用于一次性探针、校验、无果搜索或执行后无需保留脚本源码与输出的步骤（同步清空调用入参 `arguments` 与返回结果）；',
    '2. **截断压缩 (`truncate keep <N> lines`) — 只替换输出，保留输入（首选）**：用于长日志、测试输出、扫描列表，从第 0 字节保留前 N 行（100% 命中 KV 缓存），零总结开销；',
    '3. **提炼压缩 (`replace`) — 只替换输出，保留输入**：用于排查/探索性阅读过的非目标代码或搜索结果，**替换为 1~3 行理解后的工作逻辑事实（总结字数必须远小于原输出）**；',
    '· **当前要用/即将修改的核心代码**：保持完整常驻，无需写围栏。',
    '注意：第一行必须明确写出指令（`replace`、`discard` 或 `truncate keep <N> lines`）。上面的行数是触发提示的门槛，不是建议的保留行数。',
    '探索性代码阅读替换示例：',
    '```' + SUMMARY_OPEN_TAG,
    'replace',
    '- 已阅读并理解模块逻辑：确认其机制为 X，与当前目标无关，无需后续修改',
    '```',
    '完整原文随时可用 tool_result_recall 逐字节召回。'
  ].join('\n');
}
