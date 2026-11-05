/**
 * dsh-oswyn/config — Config schema (schemastery) + live resolved view.
 *
 * Pure module: imports only @deepseek-ai/schemastery. No node:fs, no ctx.
 *
 * @module dsh-oswyn/config
 */

import z from '@deepseek-ai/schemastery';

/** Symbol the config runtime stamps on every volatile reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** Frozen default set — the single source of defaults for every consumer. */
export const CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  autoApply: true,
  replySummaryEnabled: true,
  hideReplySummaryInUi: true,
  nudgeEnabled: true,
  nudgeThresholdChars: 600,
  nudgeThresholdLines: 18,
  nudgeErrorThresholdChars: 400,
  nudgeErrorThresholdLines: 12,
  verbose: false,
  badgeEnabled: true,
  // Automatic (non-prompted) tool-output compression is OFF by design: reading
  // code files must stay resident in context. The agent decides via fences; OSWYN
  // only nudges. Kept as an opt-in knob.
  autoCompress: false,
  // Tiered fallback: protection-list mode. Every tool is auto-compressed
  // unless it is listed in autoCompressTieredProtectedTools (run_code is protected
  // by default and can never be auto-compressed by this fallback).
  autoCompressTiered: true,
  // PTC-specific envelope compressor: compresses the aggregate run_code result
  // per subcall while keeping run_code out of the generic auto-compress list.
  autoCompressPtcSubcalls: true,
  // Failed calls are automatically discarded at the next step (switchable).
  autoDiscardFailed: true,
  // Tools in this list are always discarded regardless of output length.
  // validate_dsh_ui is intentionally included by default; remove it in Settings if desired.
  autoDiscardTools: Object.freeze(['validate_dsh_ui']),
  autoCompressTieredProtectedTools: Object.freeze([
    'run_code', 'read', 'write', 'edit', 'apply_patch', 'notebook',
    'read_image', 'todo_write', 'ask_user_question', 'skill', 'tool_search',
    'tool_result_recall', 'oswyn_stats', 'oswyn_protect_tool',
    'create_goal', 'update_goal', 'get_goal', 'create_worktree',
    'exit_plan_mode', 'list_agents', 'spawn_teammate', 'send_message',
    'interrupt_agent', 'wait_agent', 'team_task_create', 'team_task_update',
    'team_task_get', 'team_task_list', 'workflow', 'subagent', 'subagent_fork'
  ]),
  autoCompressMinChars: 4000,
  // Explicit, configurable prefix size for opt-in automatic mode. This is not
  // a fallback for agent fences: those must always provide their own keep size.
  autoCompressKeepLines: 30,
  // Fold the reply-summary fence into a "已压缩" chip instead of dropping it.
  foldReplySummary: true,
  showCompressedReply: false
});

function liveField(field) {
  return field.volatile();
}

export const Config = z.object({
  enabled: liveField(z.boolean().default(CONFIG_DEFAULTS.enabled))
    .description('Enable DSH-OSWYN (Only See What You Need) context optimization across all presets'),
  autoApply: liveField(z.boolean().default(CONFIG_DEFAULTS.autoApply))
    .description('Automatically scan and compact tool/reply summaries at agent step boundaries'),
  replySummaryEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.replySummaryEnabled))
    .description('Enable assistant reply dual-track projection (full reply to user now, compact memo to next turn)'),
  hideReplySummaryInUi: liveField(z.boolean().default(CONFIG_DEFAULTS.hideReplySummaryInUi))
    .description('在前端对话界面中隐藏回复总结块 (Hide dsh-reply-summary fenced block in chat display interface)'),
  nudgeEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.nudgeEnabled))
    .description('Enable single-step tool pressure awareness nudges for large outputs'),
  nudgeThresholdChars: liveField(z.number().default(CONFIG_DEFAULTS.nudgeThresholdChars))
    .description('Character threshold for triggering tool output pressure nudge'),
  nudgeThresholdLines: liveField(z.number().default(CONFIG_DEFAULTS.nudgeThresholdLines))
    .description('Line count threshold for triggering tool output pressure nudge'),
  nudgeErrorThresholdChars: liveField(z.number().default(CONFIG_DEFAULTS.nudgeErrorThresholdChars))
    .description('敏感阈值：工具调用失败/报错时的字符触发门槛 (Error-sensitive char threshold)'),
  nudgeErrorThresholdLines: liveField(z.number().default(CONFIG_DEFAULTS.nudgeErrorThresholdLines))
    .description('敏感阈值：工具调用失败/报错时的行数触发门槛 (Error-sensitive line threshold)'),
  verbose: liveField(z.boolean().default(CONFIG_DEFAULTS.verbose))
    .description('Verbose logging of every distillation action'),
  badgeEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.badgeEnabled))
    .description('在前端对话界面显示 oswyn 精炼徽章 (Show oswyn compacting badges in the chat UI)'),
  autoCompress: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompress))
    .description('自动强制压缩工具输出（默认关闭：读取源码等需要常驻上下文，建议交给 Agent 决策）'),
  autoCompressTiered: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompressTiered))
    .description('分级自动兜底：除保护名单外的工具，超过 autoCompressMinChars 且 Agent 未写围栏时自动截断'),
  autoCompressPtcSubcalls: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompressPtcSubcalls))
    .description('PTC 专用：将 run_code 的外层聚合结果按子调用生成结构化摘要（run_code 本身仍受普通保护名单排除）'),
  autoDiscardFailed: liveField(z.boolean().default(CONFIG_DEFAULTS.autoDiscardFailed))
    .description('失败/异常调用在下一步自动整段丢弃（仅保留失败结论）'),
  autoDiscardTools: liveField(z.array(z.string()).default([...CONFIG_DEFAULTS.autoDiscardTools]))
    .description('无论输出长度都自动丢弃的工具名单（支持末尾 * 通配符，例如 validate_dsh_ui）'),
  autoCompressTieredProtectedTools: liveField(z.array(z.string()).default([...CONFIG_DEFAULTS.autoCompressTieredProtectedTools]))
    .description('重要且绝不可被分级自动兜底压缩的工具保护名单（默认包含 run_code/read/write/edit 等）'),
  autoCompressMinChars: liveField(z.number().default(CONFIG_DEFAULTS.autoCompressMinChars))
    .description('自动压缩触发门槛（字符数，仅当 autoCompress 开启时生效）'),
  autoCompressKeepLines: liveField(z.number().default(CONFIG_DEFAULTS.autoCompressKeepLines))
    .description('自动压缩保留的头部行数（独立配置；不会覆盖模型围栏指定的行数）'),
  foldReplySummary: liveField(z.boolean().default(CONFIG_DEFAULTS.foldReplySummary))
    .description('把回复精炼围栏折叠为「已压缩」小条（而非彻底隐藏）'),
  showCompressedReply: liveField(z.boolean().default(CONFIG_DEFAULTS.showCompressedReply))
    .description('是否展开显示被压缩的回复原文块（默认折叠）')
});

function currentValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function' && VOLATILE_WRITE in value) {
    return value.get();
  }
  return value;
}

/**
 * Build a live "resolved" face over a (possibly volatile) config object.
 * Every property is a getter that reads the latest value, falling back to
 * CONFIG_DEFAULTS when unset. Never throws on a null/undefined config.
 * @param {object} [config]
 * @returns {Record<string, any>}
 */
export function liveConfig(config) {
  const face = {};
  for (const [key, fallback] of Object.entries(CONFIG_DEFAULTS)) {
    Object.defineProperty(face, key, {
      enumerable: true,
      get() {
        const value = currentValue(config?.[key]);
        return value === undefined || value === null ? fallback : value;
      }
    });
  }
  return face;
}
