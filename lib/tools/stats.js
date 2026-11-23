/**
 * dsh-oswyn/tools/stats — register oswyn_stats.
 *
 * Outputs SAVED / EXTRA / NET tokens, rates, and a real per-row ledger for the
 * current session or all sessions. Never uses an average in place of a row, and
 * never prints a scissors emoji.
 *
 * @module dsh-oswyn/tools/stats
 */

import { formatBytes, formatNumber } from '../format.js';
import { loadAllSessions, loadSession } from '../store/ledger.js';
import { computeMetrics, computeSessionMetrics, entryMetrics } from '../store/metrics.js';
import { readRequestSeqs } from '../store/requests.js';

const MODE_LABEL = {
  truncate: '截断',
  replace: '替换',
  discard: '丢弃',
  'prune-call': '瘦身',
  reply: '备忘'
};

function buildSummary(scope, m, ledger) {
  const lines = [
    '### DSH-OSWYN · ' + (scope === 'global' ? '全局' : '会话 ' + (ledger?.sessionId || 'current')),
    '- 节省输入 token：' + formatNumber(m.totalTokensSaved),
    '- 额外消耗 token：' + formatNumber(m.totalExtraSummaryTokens + m.totalRecallTokens) +
      '（总结 ' + formatNumber(m.totalExtraSummaryTokens) + ' + 召回 ' + formatNumber(m.totalRecallTokens) + '）',
    '- 净收益 token（一次性）：' + formatNumber(m.totalNetTokensSaved),
    '- 累计净收益 token（多轮累加）：' + formatNumber(m.cumulativeNetTokensSaved ?? m.totalNetTokensSaved) +
      '（平均每行存活 ' + (m.avgRoundsPerRow ?? 0) + ' 轮，每轮持续省 ' + formatNumber(m.standingTokensSaved) + '）',
    '- 触发率：' + m.distillRate + '%（精炼 ' + m.distilledActions + ' / 工具调用 ' + m.totalToolCalls + '）',
    '- 前缀缓存保护率：' + m.cacheHitProtectionRate + '%（截断 ' + m.totalTruncations + ' / 操作 ' + m.totalActions + '）',
    '- 平均压缩率：' + m.avgSavingsRate + '%（仅统计真实缩小的行）'
  ];
  // Deep (post-cache) distillation is a surface reset, not a row: report it on its
  // own line so it is never folded into the row-level rate above.
  if (m.totalDistillEvents > 0) {
    const dr = m.distillReasons || {};
    const parts = [];
    if (dr.ttl > 0) parts.push('缓存过期 ' + dr.ttl);
    if (dr.volume > 0) parts.push('体积 ' + dr.volume);
    if (dr.rounds > 0) parts.push('轮次 ' + dr.rounds);
    if (dr.ceiling > 0) parts.push('上限 ' + dr.ceiling);
    lines.push('- 深度蒸馏（边界推进）：' + m.totalDistillEvents + ' 次'
      + '，每次推进省 ' + formatNumber(m.distillAvgSurplusTokens) + ' tok'
      + '，累计已省 ' + formatNumber(m.distillCumulativeSaved) + ' tok'
      + '（整面降 ' + m.distillSavingsRate + '%）'
      + (parts.length ? '；触发：' + parts.join(' · ') : ''));
  } else {
    lines.push('- 深度蒸馏（缓存失效后整面重置）：未触发（缓存未失效或可移除体积低于门槛）');
  }
  if (ledger && Array.isArray(ledger.entries) && ledger.entries.length > 0) {
    lines.push('', '**明细（压缩前 → 压缩后）**');
    for (const e of ledger.entries.slice(-15).reverse()) {
      const em = entryMetrics(e);
      const tag = MODE_LABEL[em.mode] || em.mode;
      const trigger = e.mode === 'reply' ? '主动' : (e.trigger === 'auto' || e.trigger === 'autonomous' ? '自动' : '主动');
      const tool = e.toolName ? e.toolName + (e.seq != null ? '#' + e.seq : '') : 'action';
      const shrink = em.compressed
        ? formatBytes(em.before) + ' → ' + formatBytes(em.after) + ' (-' + em.savingsRate + '%)'
        : '(未缩小，按 0 计)';
      lines.push('  - [' + tag + '][' + trigger + '] ' + tool + '：' + shrink +
        ' | 省 ' + em.tokensSaved + ' / 多花 ' + (em.extraSummaryTokens + em.recallTokens) + ' / 净 ' + em.net + ' tok');
    }
  }
  return lines.join('\n');
}

export function registerStatsTool(ctx) {
  ctx.tools.register({
    name: 'oswyn_stats',
    description: 'Inspect live DSH-OSWYN ledger: tokens saved / extra spent / net, rates, and per-row before→after for the current session or globally.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: { type: 'string', enum: ['session', 'global'], description: 'Current session or global totals (default session).' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string' },
          totalTokensSaved: { type: 'number' },
          totalExtraSummaryTokens: { type: 'number' },
          totalRecallTokens: { type: 'number' },
          totalNetTokensSaved: { type: 'number' },
          standingTokensSaved: { type: 'number' },
          cumulativeTokensSaved: { type: 'number' },
          cumulativeNetTokensSaved: { type: 'number' },
          avgRoundsPerRow: { type: 'number' },
          distillRate: { type: 'number' },
          cacheHitProtectionRate: { type: 'number' },
          avgSavingsRate: { type: 'number' },
          totalDistillEvents: { type: 'number' },
          distillTokensSaved: { type: 'number' },
          distillCumulativeSaved: { type: 'number' },
          distillSavingsRate: { type: 'number' },
          distillAvgSurplusTokens: { type: 'number' },
          distillReasons: { type: 'object', properties: {} },
          history: { type: 'array', items: { type: 'object', properties: {} } },
          summary: { type: 'string' }
        },
        required: ['scope', 'summary']
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }]
    },
    execute(args, exec) {
      const scope = args.scope || 'session';
      // session scope needs the live session id from the agent; resolve at call time.
      const session = exec?.agent?.session;
      try {
        if (scope === 'global' || !session?.id) {
          const m = computeMetrics(loadAllSessions(), { resolveRequestSeqs: readRequestSeqs });
          return { scope: 'global', ...pick(m), summary: buildSummary('global', m, null) };
        }
        const ledger = loadSession(session.id);
        const m = computeSessionMetrics(ledger, { resolveRequestSeqs: readRequestSeqs });
        const history = (ledger.entries || []).map((e) => ({ ...e, ...entryMetrics(e) }));
        return { scope: 'session', ...pick(m), history, summary: buildSummary('session', m, ledger) };
      } catch (err) {
        return { scope, summary: 'oswyn_stats error: ' + err.message };
      }
    }
  });
}

function pick(m) {
  return {
    totalTokensSaved: m.totalTokensSaved,
    totalExtraSummaryTokens: m.totalExtraSummaryTokens,
    totalRecallTokens: m.totalRecallTokens,
    totalNetTokensSaved: m.totalNetTokensSaved,
    standingTokensSaved: m.standingTokensSaved,
    cumulativeTokensSaved: m.cumulativeTokensSaved,
    cumulativeNetTokensSaved: m.cumulativeNetTokensSaved,
    avgRoundsPerRow: m.avgRoundsPerRow,
    distillRate: m.distillRate,
    cacheHitProtectionRate: m.cacheHitProtectionRate,
    avgSavingsRate: m.avgSavingsRate,
    totalDistillEvents: m.totalDistillEvents,
    distillTokensSaved: m.distillTokensSaved,
    distillCumulativeSaved: m.distillCumulativeSaved,
    distillSavingsRate: m.distillSavingsRate,
    distillAvgSurplusTokens: m.distillAvgSurplusTokens,
    distillReasons: m.distillReasons
  };
}
