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
    '- 净收益 token：' + formatNumber(m.totalNetTokensSaved),
    '- 触发率：' + m.distillRate + '%（精炼 ' + m.distilledActions + ' / 工具调用 ' + m.totalToolCalls + '）',
    '- 前缀缓存保护率：' + m.cacheHitProtectionRate + '%（截断 ' + m.totalTruncations + ' / 操作 ' + m.totalActions + '）',
    '- 平均压缩率：' + m.avgSavingsRate + '%（仅统计真实缩小的行）'
  ];
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
          distillRate: { type: 'number' },
          cacheHitProtectionRate: { type: 'number' },
          avgSavingsRate: { type: 'number' },
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
          const m = computeMetrics(loadAllSessions());
          return { scope: 'global', ...pick(m), summary: buildSummary('global', m, null) };
        }
        const ledger = loadSession(session.id);
        const m = computeSessionMetrics(ledger);
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
    distillRate: m.distillRate,
    cacheHitProtectionRate: m.cacheHitProtectionRate,
    avgSavingsRate: m.avgSavingsRate
  };
}
