# DSH-OSWYN 架构（Only See What You Need）

## 产品本质
让"进入模型上下文的历史"在不丢信息前提下最小化，压平上下文增长速度。
四根支柱 + 扩展：工具输出压缩、助手回复双轨、无损召回、可观测；工具调用参数可替换、失败/探索调用可整段丢弃留事实。

## 分层
| 层 | 文件 | 职责 |
|---|---|---|
| 配置/协议/格式化 | config.js, protocol.js, format.js | 配置 schema、模型协议文案、bytes/number/time |
| 纯核心 | core/{markers,parse,plan,projection}.js | 机器标记单一真源、围栏解析、压缩计划、调用参数投影（零副作用） |
| 会话层 | session/{surface,applier,retain,ptc}.js | 唯一调用 session.append 的地方；编排压缩；保留/丢弃策略；PTC envelope 摘要 |
| 存储 | store/{ledger,metrics}.js | 审计账本（省/多花/召回/净，多轮累计）；纯指标派生 |
| 服务 | server/{routes,commands}.js | Web API；斜杠命令 |
| 工具 | tools/{recall,stats,protect}.js | tool_result_recall / oswyn_stats / oswyn_protect_tool |
| 装配 | index.js | 薄组合根（注册 hooks/slots/routes/commands/tools） |
| 前端 | client.js | 设置卡 + 官方风格可展开附件装饰器 |

## 关键实现原理（对齐真实 dsh-session / dsh-context）
- 上下文计量 dsh-context 只认负增量信号：surface 事件的 `surfaceOp:{op:'replace',startSeq,endSeq}`（splice）或 compaction/* 的 shadowedSeqs。
- 内核约束：SURFACE_EVENT_TYPES 不含 tool/call（参数不能 surfaceOp）；assistant/message 不能带 sourceEventSeqs（raw replace 必抛错）。
- 正确姿势：
  - 工具结果压缩 = 单节点 tool/result surfaceOp:replace（内容含 oswyn-meta 标记）。
  - 回复压缩 / 整段丢弃 = user/message 检查点 + surfaceOp replace + dense sourceEventSeqs（真实负增量）。
  - 工具调用参数瘦身 = assistant/message message 投影（core/projection），不改 surfaceOp。
- 机器标记（唯一真源 core/markers.js）：
  `[oswyn-meta: before=<N> after=<M> keep=<K> mode=<truncate|replace|discard> seq=<S>]`
  前端逐字节复用该正则；只从行内标记读数值，读不到不渲染。

## 记账（省 + 多花，多轮累计）
- tokensSaved = round((before-after)/3.5)（before>after 才算）
- extraSummaryTokens = round(summaryLen/3.5)
- recallTokens = round(recallChars/3.5)（tool_result_recall 触发时累加）
- net = saved - extra - recall（可为负）
- 真话守卫：compress 类 after>=before → compressed=false, saved=0。

## 显示
- 装饰所有 div[data-tool][data-state] 工具行（含 PTC run_code 容器行；按最近的 data-chat-call-id 判定归属，绝不跳过容器，也不误把子调用标记算到父行）。
- 官方风格、极小可展开附件：默认显示"压缩 前→后 -X%"，点开展开工具、前后大小、节省量、减少%、保留方式与处理方式。
- 无剪刀、无 "OSWYN 精炼"；工具压缩指令围栏直接隐藏（不再显示「已压缩 · 点击展开」），仅助手回复备忘围栏折叠为「已压缩」胶囊。

## 自动兜底（保护名单模式）
- `autoCompressTiered` 默认开启：除 `autoCompressTieredProtectedTools` 保护名单外的工具，超过 `autoCompressMinChars` 且 Agent 未写 result fence 时，自动保留前 `autoCompressKeepLines` 行，尾部归档。
- `run_code` 永远硬排除；Agent 可为单次调用写 `dsh-result-summary` + `protect` / `no-compress` 豁免，或调用 `oswyn_protect_tool` 将工具加入/移出保护名单。

## PTC 子调用压缩
- `run_code` 外层 `tool/result` 是唯一 surface 节点；`tool/ptc-dispatch` 事件只用于读取子调用结果。
- `autoCompressPtcSubcalls` 按 `rootCallId` 收集 dispatch，生成 per-subcall 摘要，一次 `appendToolResultReplace` 替换外层结果；绝不逐子调用做 surfaceOp。
- 提示词按 `dsh-tools` 的 `modeFor(scope)` 区分 native / ptc：PTC 模式明确要求一个外层 fence、按子调用列事实。
- 自动压缩/丢弃延迟一步：只有当前 user turn 中、最后一个 assistant message 之前的 tool/result 才算模型已看；下一次 pre-step 才自动处理。
- 失败调用由 `autoDiscardFailed`（默认开）在模型看过之后自动 discard，且不受自动压缩保护名单限制；`autoDiscardTools` 中的工具无论长度都 discard（默认包含 `validate_dsh_ui`，可在设置页移除或添加其他工具）。
- Agent 的 `protect` / `no-compress` 优先于自动压缩、PTC 自动摘要和自动 discard。
- 徽章 `data-tone` 区分主动压缩（agent，蓝色）与自动压缩（auto，琥珀色）；模式单独写在 `data-mode`。
