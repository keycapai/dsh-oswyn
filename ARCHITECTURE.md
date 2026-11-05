# DSH-OSWYN 架构（Only See What You Need）

## 产品本质
让"进入模型上下文的历史"在不丢信息前提下最小化，压平上下文增长速度。
四根支柱 + 扩展：工具输出压缩、助手回复双轨、无损召回、可观测；工具调用参数可替换、失败/探索调用可整段丢弃留事实。

## 模块化分层（高内聚、高复用、按职责与预设隔离）
| 层 | 文件 | 职责与复用关系 |
|---|---|---|
| 配置/格式化 | `config.js`, `format.js` | 配置 schema、bytes/number/time 格式化 |
| 纯核心与原子原语 | `core/{markers,parse,plan,projection,primitives}.js` | 机器标记单一真源、围栏解析、压缩计划、调用参数投影；`primitives.js` 封装两大正交改写原语：`compressOutputOnly()`（只替换输出）与 `discardInputAndOutput()`（同时替换输入+输出） |
| 方式策略层 | `modes/{truncate,replace,discard,protect,reply-summary,index}.js` | 每种压缩/丢弃方式独立成单文件，统一复用 `core/primitives.js`，排查问题直接定位对应方式文件 |
| 预设调度层 | `presets/{standard,ptc,index}.js` | 按预设隔离单工具（`standard.js`）与 PTC 子调用聚合（`ptc.js`），内部直接复用 `modes/*` |
| 提示词与 Nudge 层 | `prompts/{base,preset-standard,preset-ptc,nudge,index}.js` | 按预设生成无冗余提示词，内建「三步主动决策树」与双维（`inputChars` + `outputChars`）压力感知 Nudge |
| 会话内核与兼容门面 | `session/{surface,auto-policy,retain,applier,ptc}.js` | `surface.js` 为唯一调用 `session.append` 的地方；`applier.js` / `ptc.js` 保留为 100% 向下兼容门面 |
| 存储 | `store/{ledger,metrics}.js` | 审计账本（省/多花/召回/净，多轮累计）；纯指标派生 |
| 服务 | `server/{routes,commands}.js` | Web API；斜杠命令 |
| 工具 | `tools/{recall,stats,protect}.js` | `tool_result_recall` / `oswyn_stats` / `oswyn_protect_tool` |
| 装配 | `index.js`, `protocol.js` | 薄组合根与协议门面 |
| 前端子模块与构建 | `client/{shared,settings-panel,tool-badges,fence-fold,state,build}.js` → `client.js` | 将前端按职责拆分为 5 个小文件，通过 `client/build.js` 同步生成浏览器零依赖单文件包 `client.js` |

## 核心边界：丢弃（替换输入+输出）vs 压缩（只替换输出）
- **丢弃（Discard：`discard` / `discard entire-ptc` / `cascade` / `autoDiscard`）—— 同时替换输入 + 输出**：
  - 由 `core/primitives.js` 的 `discardInputAndOutput()` 统一驱动。
  - 同时将 `assistant/message` 中的 `tool-call.arguments` 投影清空为 `'{}'`（`markCallArgsDiscarded`），并将 `tool/result` 替换为 1 行事实结论。
  - 记账基准：`before = inputChars + outputChars`。即使工具输出很短（如 80 字符），只要调用入参很大（如 1500 字符脚本或校验 JSON），`discard` 仍能取得显著净节省。
- **压缩（Compress：`truncate` / `replace`）—— 只替换输出，保留输入**：
  - 由 `core/primitives.js` 的 `compressOutputOnly()` 统一驱动。
  - 100% 保留 `assistant/message` 中的 `tool-call.arguments` 原样不动，仅截断或提炼替换 `tool/result` 输出。
  - 记账基准：`before = outputChars`（`inputChars = 0`）。仅当工具返回输出本身较长且改写后严格更短时才执行。

## 关键实现原理（对齐真实 dsh-session / dsh-context）
- 上下文计量 dsh-context 只认负增量信号：surface 事件的 `surfaceOp:{op:'replace',startSeq,endSeq}`（splice）或 compaction/* 的 shadowedSeqs。
- 内核约束：SURFACE_EVENT_TYPES 不含 tool/call（参数不能 surfaceOp）；assistant/message 不能带 sourceEventSeqs（raw replace 必抛错）。
- 正确姿势：
  - 工具结果压缩 = 单节点 tool/result surfaceOp:replace（内容含 oswyn-meta 标记）。
  - 回复压缩 / 多节点跨度丢弃 = user/message 检查点 + surfaceOp replace + dense sourceEventSeqs（真实负增量）。
  - 工具调用参数瘦身/丢弃 = assistant/message message 投影（`core/projection` + `isCallArgDiscarded`），不改 surfaceOp。
- 机器标记（唯一真源 `core/markers.js`）：
  `[oswyn-meta: before=<N> after=<M> keep=<K> mode=<truncate|replace|discard> seq=<S>]`
  前端逐字节复用该正则；只从行内标记或账本 `callId` 读数值，读不到不渲染。

## 记账（省 + 多花，多轮累计）
- tokensSaved = round((before-after)/3.5)（before>after 才算）
- extraSummaryTokens = round(summaryLen/3.5)
- recallTokens = round(recallChars/3.5)（tool_result_recall 触发时累加）
- net = saved - extra - recall（可为负）
- 真话守卫：compress 类 after>=before → compressed=false, saved=0。

## 显示
- 装饰所有 `div[data-tool][data-state]` 工具行（含 PTC `run_code` 容器行；按最近的 `data-chat-call-id` 判定归属，绝不跳过容器，也不误把子调用标记算到父行）。
- 官方风格、极小可展开附件：默认显示"压缩/丢弃 前→后 -X%"，点开展开工具、前后大小（含丢弃调用入参说明）、节省量、减少%、保留方式与处理方式。
- 工具压缩指令围栏直接隐藏（若模型漏写闭合换行导致粘连正文/`dsh-ui`，由 `fence-fold.js` 的 `rescueMergedResultFence` 自动拆分恢复），仅助手回复备忘围栏折叠为「已压缩」胶囊。
