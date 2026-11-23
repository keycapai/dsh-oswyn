/**
 * dsh-oswyn/server/commands — slash commands (/oswyn, /oswyn-distill).
 *
 * Shows tokens SAVED, EXTRA SPENT (summary + recall) and NET, plus turn-level
 * deep distillation status and a per-row ledger stream with real before->after.
 * No scissors emoji anywhere. Uses lib/format.js.
 *
 * @module dsh-oswyn/server/commands
 */

import { formatBytes, formatNumber } from '../format.js';
import { loadAllSessions, loadSession } from '../store/ledger.js';
import { computeMetrics, computeSessionMetrics, entryMetrics } from '../store/metrics.js';
import { TRIGGER_DEFAULTS } from '../core/triggers.js';
import { collectSurfaceMessages } from '../session/surface.js';
import { measureSurfaceBreakdown } from '../core/distill-projection.js';

const MODE_LABEL = {
  truncate: '前缀截断',
  replace: '事实替换',
  discard: '整段丢弃',
  'prune-call': '调用瘦身',
  reply: '回复备忘'
};

const REASON_LABEL = {
  manual: '手动触发',
  ttl: '缓存过期',
  volume: '体积阈值',
  rounds: '轮次阈值',
  ceiling: '上限安全阀'
};

function formatReasons(reasons = {}) {
  const parts = [];
  if (Number(reasons.manual) > 0) parts.push('手动 ' + reasons.manual);
  if (Number(reasons.volume) > 0) parts.push('体积 ' + reasons.volume);
  if (Number(reasons.rounds) > 0) parts.push('轮次 ' + reasons.rounds);
  if (Number(reasons.ttl) > 0) parts.push('缓存过期 ' + reasons.ttl);
  if (Number(reasons.ceiling) > 0) parts.push('上限 ' + reasons.ceiling);
  return parts.length ? parts.join(' · ') : '无';
}

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

function formatLastEvalLines(lastEval) {
  if (!lastEval || typeof lastEval !== 'object') {
    return ['- 最近检查：尚无记录（本会话尚未到达轮次蒸馏检查点）'];
  }
  const reasonText = REASON_LABEL[lastEval.reason] || lastEval.reason || '—';
  const decision = lastEval.distill
    ? ('已触发执行（' + reasonText + '）')
    : (lastEval.floorBlocked ? '可省量低于最小收益门槛，跳过' : '未达到触发门槛');
  return [
    '- 最近检查：' + decision,
    '- 当前待蒸馏冗余：~' + formatNumber(lastEval.surplusTokens) + ' tok（当前上下文总计 ~' + formatNumber(lastEval.rawTokens) + ' tok）',
    '- 距上次蒸馏：' + formatNumber(lastEval.roundsSinceDistill) + ' 轮'
  ];
}

function buildOverview(session, config = {}) {
  const global = computeMetrics(loadAllSessions());
  const volV = config.triggerVolumeTokens ?? TRIGGER_DEFAULTS.triggerVolumeTokens;
  const rndR = config.triggerRounds ?? TRIGGER_DEFAULTS.triggerRounds;
  const ceilV = config.triggerCeilingTokens ?? TRIGGER_DEFAULTS.triggerCeilingTokens;
  const floorU = config.triggerMinSurplusTokens ?? TRIGGER_DEFAULTS.triggerMinSurplusTokens;

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
    '- 会话数：' + global.totalSessions,
    '',
    '**全局轮次蒸馏状态 (v2.4)**',
    '- 累计触发：' + global.totalDistillEvents + ' 次（覆盖 ' + global.distillSessions + ' 个会话 · 来源：' + formatReasons(global.distillReasons) + '）',
    '- 整面节省：单次 ~' + formatNumber(global.distillTokensSaved) + ' tok（降 ' + global.distillSavingsRate + '%）· 累计 ~' + formatNumber(global.distillCumulativeSaved) + ' tok',
    '- 当前触发阈值：体积 V=' + formatNumber(volV) + ' tok · 轮次 R=' + rndR + ' 轮 · 防抖下限=' + formatNumber(floorU) + ' tok · 硬上限=' + formatNumber(ceilV) + ' tok'
  ];

  if (session?.id) {
    const ledger = loadSession(session.id);
    const s = computeSessionMetrics(ledger);
    lines.push('', '**当前会话 (' + session.id + ')**');
    lines.push(tokenLine(' ', s.totalTokensSaved, s.totalExtraSummaryTokens, s.totalRecallTokens, s.totalNetTokensSaved));

    // Per-session turn-level distillation status
    const d = ledger.distill || null;
    const livePairs = collectSurfaceMessages(session);
    const breakdown = livePairs.length > 0
      ? measureSurfaceBreakdown(livePairs)
      : (d?.lastEval && (Number(d.lastEval.compressedTokens) > 0 || Number(d.lastEval.uncompressedTokens) > 0) ? d.lastEval : null);
    lines.push('', '**当前会话轮次蒸馏状态**');
    if (breakdown) {
      const sysHint = breakdown.systemTokens > 0 ? ('（含系统提示词 ~' + formatNumber(breakdown.systemTokens) + ' tok）') : '';
      lines.push(
        '- 已压缩量：~' + formatNumber(breakdown.compressedTokens) + ' tok' + sysHint,
        '- 未压缩量：~' + formatNumber(breakdown.uncompressedTokens) + ' tok'
      );
    }
    if (d && d.events > 0) {
      const rate = d.rawTokens > 0 ? Math.round(((d.rawTokens - d.distTokens) / d.rawTokens) * 1000) / 10 : 0;
      lines.push(
        '- 蒸馏次数：' + d.events + ' 次（来源：' + formatReasons(d.reasons) + '）',
        '- 最近一次节省：~' + formatNumber(d.surplusTokens) + ' tok（' + formatNumber(d.rawTokens) + ' → ' + formatNumber(d.distTokens) + ' tok，-' + rate + '%）· 累计 ~' + formatNumber(d.cumulativeSaved) + ' tok'
      );
      const turnEntries = Object.entries(d.turns || {})
        .map(([k, v]) => [Number(k), v])
        .filter(([k]) => Number.isFinite(k) && k > 0)
        .sort((a, b) => a[0] - b[0]);
      if (turnEntries.length > 0) {
        const turnText = turnEntries
          .map(([r, td]) => '第 ' + r + ' 轮（' + (REASON_LABEL[td.reason] || td.reason || '已蒸馏') + '，省 ~' + formatNumber(td.surplusTokens) + ' tok）')
          .join('、');
        lines.push('- 已蒸馏轮次（共 ' + turnEntries.length + ' 轮）：' + turnText);
      }
    } else {
      lines.push('- 蒸馏次数：0 次（尚未触发轮次蒸馏）');
    }
    lines.push(...formatLastEvalLines(d?.lastEval));

    const recent = (ledger.entries || []).slice(-8).reverse();
    if (recent.length > 0) {
      lines.push('', '**近期流水（压缩前 → 压缩后）**');
      for (const e of recent) lines.push(entryLine(e));
    }
  }
  return { kind: 'success', text: lines.join('\n') };
}

export function registerCommands(ctx, config = {}, hooks = {}) {
  const showOverview = (invocation) => {
    const session = invocation?.agent?.session ?? invocation?.session;
    try { return buildOverview(session, config); }
    catch (err) { return { kind: 'error', text: 'oswyn: ' + err.message }; }
  };

  // ── /oswyn-distill — immediately run turn-level deep distillation with reason='manual' ──
  const forceDistill = (invocation) => {
    const session = invocation?.agent?.session ?? invocation?.session;
    try {
      if (!session) return { kind: 'error', text: 'oswyn-distill: 没有可用会话。' };
      const id = session.id;
      if (typeof hooks.runManualDistill === 'function') {
        const res = hooks.runManualDistill(session);
        const d = id ? loadSession(id).distill : null;
        if (res && res.applied) {
          const roundList = Array.isArray(res.rounds) && res.rounds.length
            ? res.rounds.map((r) => '第 ' + r + ' 轮').join('、')
            : (res.checkpoints + ' 轮');
          const lines = [
            '### DSH-OSWYN · 手动轮次蒸馏已立即执行',
            '- 触发原因：手动触发（manual）',
            '- 本次蒸馏轮次：' + roundList + '（共 ' + res.checkpoints + ' 轮）',
            '- 本次节省：~' + formatNumber(res.surplusTokens) + ' tok（表层 ' + formatNumber(res.rawTokens) + ' → ' + formatNumber(res.distTokens) + ' tok）',
            '- 界面将在状态轮询后立刻显示「已轮次蒸馏」压缩标记，无需再发下一句话。',
            ''
          ];
          if (d && d.events > 0) {
            lines.push('- 当前会话累计：' + d.events + ' 次（' + formatReasons(d.reasons) + '），累计省 ~' + formatNumber(d.cumulativeSaved) + ' tok');
          }
          return { kind: 'success', text: lines.join('\n') };
        }
        const lines = [
          '### DSH-OSWYN · 手动轮次蒸馏检查',
          '- 当前没有可继续蒸馏的已完成轮次（所有已完成轮次均已蒸馏，或无工具/思考内容可剥离）。',
          '- 原始表层：~' + formatNumber(res?.rawTokens || 0) + ' tok',
          ''
        ];
        if (d && d.events > 0) {
          lines.push('- 当前会话累计：' + d.events + ' 次（' + formatReasons(d.reasons) + '），累计省 ~' + formatNumber(d.cumulativeSaved) + ' tok');
        }
        return { kind: 'success', text: lines.join('\n') };
      }

      // Fallback when hook is unavailable (e.g. standalone unit test): arm manual flag, NEVER forceCacheExpired.
      session.forceManualDistill = true;
      const d = id ? loadSession(id).distill : null;
      const lines = [
        '### DSH-OSWYN · 手动轮次蒸馏已预约',
        '- 已设置 session.forceManualDistill = true（触发原因将记为 manual，不再记为缓存超时）。',
        '- 发送下一条消息时将立即执行整面轮次蒸馏。',
        ''
      ];
      if (d && d.events > 0) {
        lines.push('- 当前会话累计：' + d.events + ' 次（' + formatReasons(d.reasons) + '），省 ~' + formatNumber(d.surplusTokens) + ' tok');
      }
      lines.push(...formatLastEvalLines(d?.lastEval));
      return { kind: 'success', text: lines.join('\n') };
    } catch (err) {
      return { kind: 'error', text: 'oswyn-distill: ' + err.message };
    }
  };

  ctx.commands?.register?.({ name: 'oswyn', description: 'Show OSWYN context-distill ledger & turn-level distillation status', handler: showOverview });
  ctx.commands?.register?.({ name: 'oswyn-distill', description: 'Immediately execute turn-level deep distillation (logged as manual) and refresh compression markers', handler: forceDistill });
}
