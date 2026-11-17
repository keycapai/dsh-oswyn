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
  nudgeErrorThresholdChars: 300,
  nudgeErrorThresholdLines: 10,
  adaptiveNudgeEnabled: true,
  uncompressedStepThreshold: 2,
  accumulatedPayloadThreshold: 2000,
  cooldownSteps: 2,
  minChars: 600,
  coldStartSteps: 2,
  deepHorizonTurns: 8,
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
  // ── 组 1：全局基础设置 ──
  enabled: liveField(z.boolean().default(CONFIG_DEFAULTS.enabled))
    .description('[全局基础] 全局启用 DSH-OSWYN 上下文精炼与压缩契约 (Enable DSH-OSWYN across all presets)'),
  autoApply: liveField(z.boolean().default(CONFIG_DEFAULTS.autoApply))
    .description('[全局基础] 在智能体步骤边界自动检测并应用精炼结果 (Automatically scan and compact tool/reply summaries at agent step boundaries)'),
  verbose: liveField(z.boolean().default(CONFIG_DEFAULTS.verbose))
    .description('[全局基础] 输出每步精炼与提示的详细调试诊断日志 (Verbose logging of every distillation action)'),

  // ── 组 2：多轮压缩意愿动态感知 (Adaptive Nudge) ──
  adaptiveNudgeEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.adaptiveNudgeEnabled))
    .description('[多轮意愿] 启用多轮对话动态压缩意愿感知引擎：根据 3D 亏损检测与 5 重守卫自适应注入分级提示 (Enable multi-turn dynamic willingness-aware adaptive nudge engine)'),
  uncompressedStepThreshold: liveField(z.number().default(CONFIG_DEFAULTS.uncompressedStepThreshold))
    .description('[多轮意愿] 连续未压缩工具调用步数门槛（维度 1）：超过此步数判定模型陷入非压缩惯性并触发契约强化提示 (Consecutive uncompressed step threshold)'),
  accumulatedPayloadThreshold: liveField(z.number().default(CONFIG_DEFAULTS.accumulatedPayloadThreshold))
    .description('[多轮意愿] 累积未压缩输出字符门槛（维度 2）：未压缩内容膨胀达到此字符数触发预算警报 (Accumulated uncompressed tool output characters threshold)'),
  deepHorizonTurns: liveField(z.number().default(CONFIG_DEFAULTS.deepHorizonTurns))
    .description('[多轮意愿] 深度对话注意力稀释轮数门槛（维度 3）：超过此轮数激活长程注意力稀释防护 (Deep horizon turn threshold for attention dilution)'),
  coldStartSteps: liveField(z.number().default(CONFIG_DEFAULTS.coldStartSteps))
    .description('[多轮意愿] 冷启动静默轮数（守卫 2）：前 N 轮探索阶段保持绝对静默，保护初期环境与结构探索 (Cold-start silence turns during initial exploration)'),
  cooldownSteps: liveField(z.number().default(CONFIG_DEFAULTS.cooldownSteps))
    .description('[多轮意愿] 提示冷却间隔步数（守卫 4）：每次发出提示后强制静默的步数，防止打扰模型思考 (Cooldown steps between consecutive nudges)'),
  minChars: liveField(z.number().default(CONFIG_DEFAULTS.minChars))
    .description('[多轮意愿] 候选噪声输出字符下限：低于此长度的输出视为安全紧凑内容，不计入亏损累加 (Minimum character length for noisy candidate)'),

  // ── 组 3：单步工具压力感知提示 ──
  nudgeEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.nudgeEnabled))
    .description('[单步压力] 启用单步工具输出体积过大压力提示 (Enable single-step tool pressure awareness nudges)'),
  nudgeThresholdChars: liveField(z.number().default(CONFIG_DEFAULTS.nudgeThresholdChars))
    .description('[单步压力] 单步正常工具输出字符触发门槛 (Character threshold for triggering tool output pressure nudge)'),
  nudgeThresholdLines: liveField(z.number().default(CONFIG_DEFAULTS.nudgeThresholdLines))
    .description('[单步压力] 单步正常工具输出行数触发门槛 (Line count threshold for triggering tool output pressure nudge)'),
  nudgeErrorThresholdChars: liveField(z.number().default(CONFIG_DEFAULTS.nudgeErrorThresholdChars))
    .description('[单步压力] 敏感阈值：工具调用报错/异常时的字符触发门槛 (Error-sensitive char threshold)'),
  nudgeErrorThresholdLines: liveField(z.number().default(CONFIG_DEFAULTS.nudgeErrorThresholdLines))
    .description('[单步压力] 敏感阈值：工具调用报错/异常时的行数触发门槛 (Error-sensitive line threshold)'),

  // ── 组 4：分级自动兜底与工具保护 ──
  autoCompressTiered: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompressTiered))
    .description('[兜底保护] 分级自动兜底：除保护名单外的工具，超过字符门槛且模型未写围栏时自动截断 (Tiered fallback auto-compression)'),
  autoCompress: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompress))
    .description('[兜底保护] 全量强制自动压缩（默认关闭：读取源码等建议由 Agent 自主决策）(Force auto-compression for all non-protected outputs)'),
  autoCompressMinChars: liveField(z.number().default(CONFIG_DEFAULTS.autoCompressMinChars))
    .description('[兜底保护] 自动压缩触发门槛（字符数，仅当分级或强制自动压缩开启时生效）(Auto-compress minimum characters threshold)'),
  autoCompressKeepLines: liveField(z.number().default(CONFIG_DEFAULTS.autoCompressKeepLines))
    .description('[兜底保护] 自动压缩截断保留头部行数（独立配置，不会覆盖模型自定围栏行数）(Auto-compress keep leading lines)'),
  autoCompressPtcSubcalls: liveField(z.boolean().default(CONFIG_DEFAULTS.autoCompressPtcSubcalls))
    .description('[兜底保护] PTC 专用：将 run_code 的外层聚合结果按子调用拆解折叠 (PTC aggregate run_code subcall compressor)'),
  autoDiscardFailed: liveField(z.boolean().default(CONFIG_DEFAULTS.autoDiscardFailed))
    .description('[兜底保护] 调用报错或退出码非 0 时在下一步自动整段丢弃，仅保留失败摘要 (Automatically discard failed tool executions)'),
  autoDiscardTools: liveField(z.array(z.string()).default([...CONFIG_DEFAULTS.autoDiscardTools]))
    .description('[兜底保护] 无论输出长度都自动丢弃的工具名单，支持通配符（默认含 validate_dsh_ui）(Always discarded tool names)'),
  autoCompressTieredProtectedTools: liveField(z.array(z.string()).default([...CONFIG_DEFAULTS.autoCompressTieredProtectedTools]))
    .description('[兜底保护] 重要不可压缩工具保护名单，永远不被自动截断（默认含 run_code/read/write/edit 等）(Protected tool names)'),

  // ── 组 5：界面展示与双轨交互 ──
  badgeEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.badgeEnabled))
    .description('[界面双轨] 在前端对话界面中显示行内精炼徽章与详情抽屉 (Show oswyn compacting badges and drawer in chat UI)'),
  replySummaryEnabled: liveField(z.boolean().default(CONFIG_DEFAULTS.replySummaryEnabled))
    .description('[界面双轨] 启用助手长回复双轨投影：用户看完整版，下轮模型看紧凑备忘 (Assistant reply dual-track projection)'),
  hideReplySummaryInUi: liveField(z.boolean().default(CONFIG_DEFAULTS.hideReplySummaryInUi))
    .description('[界面双轨] 在前端对话界面隐藏用于模型的回复总结块 (Hide reply summary block in chat UI)'),
  foldReplySummary: liveField(z.boolean().default(CONFIG_DEFAULTS.foldReplySummary))
    .description('[界面双轨] 把回复精炼备忘折叠为「已压缩」卡片小条，点击可查看 (Fold reply summary into a clickable chip)'),
  showCompressedReply: liveField(z.boolean().default(CONFIG_DEFAULTS.showCompressedReply))
    .description('[界面双轨] 「已压缩」卡片是否默认展开显示被压缩的原文字符 (Whether folded reply chip is expanded by default)')
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
