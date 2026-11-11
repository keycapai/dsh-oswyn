/**
 * dsh-oswyn/prompts/nudge — Dual-dimension (inputChars + outputChars) pressure
 * detector and smart nudge generator (with OSWYN v2.1 Formula-Safe Verbatim
 * & Final-Turn Reasoning-First Exemption support).
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
      '[DSH-OSWYN 终局精确推理提示 (Reasoning-First Exemption)]',
      '当前已进入最终答案推导/合成轮次（若无需继续调用工具，可免写 `' + SUMMARY_OPEN_TAG + '` 围栏，将 100% 注意力用于逐步算术/位运算/数论推导与区间边界核验）。',
      '· **回溯门控 (Proactive Recall Gate)**：若前序步骤（如 c1/c2）已被 `[oswyn:...]` 压缩，且摘要中缺少任何关键算术公式、除数、槽位数值或循环体定义，**严禁猜测**，请先调用 `tool_result_recall` 恢复原文再计算！'
    ].join('\n');
  }

  const primary = candidates.find((c) => c.isError) || candidates[candidates.length - 1];
  const { isError, lines, chars, inputChars } = primary;
  const inputNote = inputChars > 0 ? `（调用入参约 ${inputChars} 字符）` : '';

  if (isError) {
    return [
      '[DSH-OSWYN 失败调用精炼提示]',
      '检测到上一步工具执行失败/报错（输出约 ' + lines + ' 行 / ' + chars + ' 字符' + inputNote + '）。',
      '【核心准则 · 丢弃 vs 压缩】：',
      '· **丢弃 (`discard`) = 同时替换输入 + 输出**：不仅折叠报错堆栈输出，还会将本次失败调用的入参 (`arguments`) 清空为 `{}`，一次性回收输入与输出 Token。',
      '· 强烈建议采用 Mode C (`discard`) 整段丢弃报错调用，仅提炼 1~2 行核心事实结论（**注意 Formula-Safe Verbatim：报错中暴露的活跃线程参数、断言阈值、常量与算式必须逐字原样保留，严禁省略具体数值！若当前已是无需再调工具的终局复杂计算步，可免写围栏专注逐步推导**）：',
      '```' + SUMMARY_OPEN_TAG,
      'discard',
      '- 失败结论：<记录失败根因，并逐字保留报错中的关键参数/数值/公式，如 worker_17: initialTokens=190, burstSec=14, rawSkewMs=1750>',
      '```',
      '完整报错已持久留底账，后续计算若需回查任何细节，必须调用 tool_result_recall 逐字节召回。'
    ].join('\n');
  }

  return [
    '[DSH-OSWYN 上下文精炼提示]',
    '上一步工具输出约 ' + lines + ' 行 / ' + chars + ' 字符' + inputNote + (candidates.length > 1 ? '（本步共 ' + candidates.length + ' 项超阈值工具输出）' : '') + '。',
    '【三步主动精炼决策（严格区分「丢弃」与「压缩」边界）】：',
    '1. **丢弃 (`discard` / `discard entire-ptc`) — 同时替换输入 + 输出**：用于一次性探针、校验、无果搜索或执行后无需保留脚本源码与输出的步骤（同步清空调用入参 `arguments` 与返回结果）；',
    '2. **截断压缩 (`truncate keep <N> lines`) — 只替换输出，保留输入（首选）**：用于长日志、测试输出、扫描列表，从第 0 字节保留前 N 行（100% 命中 KV 缓存），零总结开销；',
    '3. **提炼压缩 (`replace`) — 只替换输出，保留输入**：用于排查/探索性阅读过的非目标代码或搜索结果，**替换为 1~3 行高密度事实（Formula-Safe Verbatim 铁律：源码中的数学公式、除数、位运算/模运算表达式 `+ - * / % ^ &`、分支条件与活跃常量必须逐字原样复制，严禁改写为模糊定性描述！）**；',
    '· **当前要用/即将修改的核心代码或跨步复用的多行函数循环体**：保持完整常驻，或使用 `truncate`，并在后续计算需要时主动调用 `tool_result_recall`。',
    '注意：第一行必须明确写出指令（`replace`、`discard` 或 `truncate keep <N> lines`）。上面的行数是触发提示的门槛，不是建议的保留行数。',
    '探索性代码阅读替换示例（原样保留公式与常量）：',
    '```' + SUMMARY_OPEN_TAG,
    'replace',
    '- Read rate-limiter.ts: BUCKET_REFILL_RATE = 43; applyBurstWindow(tokens, burstSec, effectiveSkewMs) = tokens + (burstSec * 43) - Math.floor(effectiveSkewMs / 250)',
    '```',
    '完整原文随时可用 tool_result_recall 逐字节召回。'
  ].join('\n');
}
