/**
 * dsh-oswyn/server/commands — slash commands (/oswyn /distill /oswyn-cache /distill-cache).
 *
 * Shows tokens SAVED, EXTRA SPENT (summary + recall) and NET, plus a per-row ledger
 * stream with real before->after. No scissors emoji anywhere. Uses lib/format.js.
 *
 * @module dsh-oswyn/server/commands
 */

import { formatBytes, formatNumber } from '../format.js';
import { loadAllSessions, loadSession } from '../store/ledger.js';
import { computeMetrics, computeSessionMetrics, entryMetrics } from '../store/metrics.js';

const MODE_LABEL = {
  truncate: '前缀截断',
  replace: '事实替换',
  discard: '整段丢弃',
  'prune-call': '调用瘦身',
  reply: '回复备忘'
};

function tokenLine(label, saved, extra, recall, net) {
  return [
    label + '：',
    '  节省输入 ' + formatNumber(saved) + ' tok',
    '  额外消耗 ' + formatNumber(extra) + ' tok（总结求值）',
    '  召回消耗 ' + formatNumber(recall) + ' tok（tool_result_recall 回注）',
    '  净收益 ' + formatNumber(net) + ' tok'
  ].join('\n');
}

function entryLine(e) {
  const m = entryMetrics(e);
  const tag = MODE_LABEL[m.mode] || m.mode;
  const tool = e.toolName ? e.toolName + (e.seq != null ? '#' + e.seq : '') : 'action';
  const shrink = m.compressed
    ? formatBytes(m.before) + ' → ' + formatBytes(m.after) + ' (-' + m.savingsRate + '%)'
    : '(未缩小，按 0 计)';
  const fact = e.fact ? ' — ' + String(e.fact).replace(/\n/g, ' ').slice(0, 60) : '';
  return '  - [' + tag + '] ' + tool + ': ' + shrink +
    ' | 省 ' + m.tokensSaved + 'tok / 多花 ' + (m.extraSummaryTokens + m.recallTokens) + 'tok / 净 ' + m.net + 'tok' + fact;
}

function buildOverview(session) {
  const global = computeMetrics(loadAllSessions());
  const lines = [
    '### DSH-OSWYN · 上下文精炼账本',
    '',
    '**全局累计**',
    tokenLine(' ', global.totalTokensSaved, global.totalExtraSummaryTokens, global.totalRecallTokens, global.totalNetTokensSaved),
    '',
    '- 触发率 (distillRate)：' + global.distillRate + '%（精炼 ' + global.distilledActions + ' / 工具调用 ' + global.totalToolCalls + '）',
    '- 前缀缓存保护率：' + global.cacheHitProtectionRate + '%（截断 ' + global.totalTruncations + ' / 操作 ' + global.totalActions + '）',
    '- 平均压缩率 (avgSavingsRate)：' + global.avgSavingsRate + '%（仅统计真实缩小的行）',
    '- 明细：截断 ' + global.totalTruncations + ' · 替换 ' + global.totalReplacements +
      ' · 丢弃 ' + global.totalDiscards + ' · 回复备忘 ' + global.totalReplySummaries,
    '- 会话数：' + global.totalSessions
  ];

  if (session?.id) {
    const s = computeSessionMetrics(loadSession(session.id));
    lines.push('', '**当前会话 (' + session.id + ')**');
    lines.push(tokenLine(' ', s.totalTokensSaved, s.totalExtraSummaryTokens, s.totalRecallTokens, s.totalNetTokensSaved));
    const ledger = loadSession(session.id);
    const recent = (ledger.entries || []).slice(-8).reverse();
    if (recent.length > 0) {
      lines.push('', '**近期流水（压缩前 → 压缩后）**');
      for (const e of recent) lines.push(entryLine(e));
    }
  }
  return { kind: 'success', text: lines.join('\n') };
}

function buildCacheReport() {
  const global = computeMetrics(loadAllSessions());
  const text = [
    '### DSH-OSWYN · 前缀缓存保护报告',
    '- 截断保留（从第 0 字节起头部字节保真）：' + global.totalTruncations + ' 次',
    '- 前缀缓存保护率：' + global.cacheHitProtectionRate + '%',
    '- 原理：截断算法严格保留原始内容前部（默认 2000 字符），仅替换尾部冗余；KV 缓存自 index 0 完全吻合，避免全量重写导致的缓存击穿。',
    '- 累计节省输入 token：' + formatNumber(global.totalTokensSaved) +
      '（其中召回补花 ' + formatNumber(global.totalRecallTokens) + '，净 ' + formatNumber(global.totalNetTokensSaved) + '）'
  ].join('\n');
  return { kind: 'success', text };
}

export function registerCommands(ctx, config = {}) {
  const showOverview = (invocation) => {
    const session = invocation?.agent?.session ?? invocation?.session;
    try { return buildOverview(session); }
    catch (err) { return { kind: 'error', text: 'oswyn: ' + err.message }; }
  };
  const showCache = () => {
    try { return buildCacheReport(); }
    catch (err) { return { kind: 'error', text: 'oswyn-cache: ' + err.message }; }
  };

  ctx.commands?.register?.({ name: 'oswyn', description: 'Show OSWYN context-distill ledger: tokens saved / extra spent / net', handler: showOverview });
  ctx.commands?.register?.({ name: 'distill', description: 'Show OSWYN context-distill ledger (alias)', handler: showOverview });
  ctx.commands?.register?.({ name: 'oswyn-cache', description: 'Show KV prefix-cache preservation report', handler: showCache });
  ctx.commands?.register?.({ name: 'distill-cache', description: 'Show KV prefix-cache preservation report (alias)', handler: showCache });
}
