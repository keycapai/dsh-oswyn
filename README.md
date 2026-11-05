# DSH-OSWYN: Only See What You Need
### DeepSeek Harness 原生跨预设智能上下文精炼与 KV 缓存保护系统

> **"Only See What You Need" (只看所需)** —— 让 Agent 拥有自主掌控上下文的最高决断权，在消除冗长日志噪音的同时，以字节级精度保护大模型底层 KV 缓存 (Prompt Cache) 命中率。

---

## 💡 设计哲学：为什么需要 OSWYN？

在长会话与复杂工程任务（如全栈开发、大型测试套件运行、跨模块重构）中，上下文管理面临两大经典矛盾：

### 1. 传统机械截断 vs 智能语义提取
- **机械硬截断（Dumb Truncation）**：传统系统常在达到字符阈值时简单切断尾部（`[tail truncated...]`），这极易丢失最重要的信息（例如测试失败根因、编译器报错往往恰恰出现在日志最末尾）。
- **全量暴力替换（Full Replacement / Summarize All）**：现有许多总结插件直接将工具输出从第 0 字节替换为一段短文本。虽然缩短了长度，但**彻底改变了大模型历史上下文的字节序列**，导致大模型 Attention 引擎的 KV Cache 从此处全线失效，造成灾难性的**缓存击穿**，大幅增加首字推理延迟与 API 成本。

### 2. 用户视觉体验 vs 模型注意力负荷
- **面对用户**：Agent 需要输出图文并茂、步骤详实、包含完整代码示例与对比表格的友好答复。
- **面对下轮 Agent 自身**：下轮模型并不需要再次阅读自己刚才生成的几千字长篇大论，它只需要知道：“刚才改了哪几个文件、测试过了没有、当前的下一步目标是什么”。

---

## 🧠 Agent 自主决断的核心角色 (Agent Autonomous Decision)

**OSWYN 坚决反对黑盒的“一刀切”规则，将上下文精炼的决断权交给具备语义理解能力的 Agent：**

1. **Agent 判断噪音与价值**：
   - Agent 最清楚某次工具调用的目的是什么。如果是一次冗长的 `npm test`（几百行输出），Agent 知道“前面的测试用例明细无需保留，只需保留头部环境信息与末尾最终通过/失败摘要”；如果是一次敏感配置读取，Agent 会决定“全文关键，绝不压缩”。
2. **Agent 决定保留边界**：
   - Agent 可以自主决定是采用**前缀截断保留（Option A, 保持 KV Cache）**还是**全量关键事实替换（Option B）**，并精确指定前缀保留的字节数或行数（如 `keep 2000` 或 `keep 50 lines`）。
3. **宿主执行字节级精准投影**：
   - Agent 发出意图，宿主系统（Host Runtime）在底层通过事件投影机制执行无损重构与可逆归档，确保历史底账随时可原样召回（`tool_result_recall`）。

---

## ⚙️ 极简配置设计：Agent-First 原则

在全新架构中，OSWYN 彻底废除了 `defaultKeepChars`、`minChars` 与 `defaultKeepLines` 等人为设定的硬性门槛，**是否总结、从哪一行截断 100% 由 Agent 在当前执行步骤中自主判定**：

| 参数名 | 类型 | 默认值 | 作用描述 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 全局总开关，控制 OSWYN 机制在所有预设中是否激活。 |
| `autoApply` | `boolean` | `true` | 步进边界自动执行，自动扫描并应用模型声明的总结围栏。 |
| `replySummaryEnabled` | `boolean` | `true` | 控制助手回复双轨投影机制。启用后，Web 前端显示完整回复，下轮模型上下文仅接收轻量备忘。 |
| `hideReplySummaryInUi` | `boolean` | `true` | 界面显示隐藏开关。开启后，在 Web 界面对话流中自动隐藏末尾的 ```dsh-reply-summary 备忘代码块，保持人类阅读视图纯粹干净；下轮模型仍能正常提取备忘。 |
| `nudgeEnabled` | `boolean` | `true` | 单步工具压力感知开关。当上一步工具返回体积过大时，在下一步决策前注入轻量截断指引。 |
| `nudgeThresholdChars` | `number` | `600` | 常规工具输出单步压力感知字符阈值（默认 600 字符）。 |
| `nudgeThresholdLines` | `number` | `18` | 常规工具输出单步压力感知行数阈值（默认 18 行）。 |
| `nudgeErrorThresholdChars` | `number` | `400` | 失败/异常调用专属敏感字符门槛（默认 400 字符）。 |
| `nudgeErrorThresholdLines` | `number` | `12` | 失败/异常调用专属敏感行数门槛（默认 12 行）。 |
| `autoCompress` | `boolean` | `false` | 总自动压缩开关（默认关闭；开启后所有工具输出超过门槛都会自动截断）。 |
| `autoCompressTiered` | `boolean` | `true` | 分级自动兜底：保护名单之外的工具，Agent 未写围栏且输出超过 `autoCompressMinChars` 时自动截断。 |
| `autoCompressPtcSubcalls` | `boolean` | `true` | PTC 专用：`run_code` 多子调用聚合结果按子调用生成结构化摘要并替换外层 `tool/result`（只做一次 surface replace）。 |
| `autoDiscardFailed` | `boolean` | `true` | 失败/异常调用（exit code 非 0、异常堆栈等）下步自动整段丢弃，仅保留失败结论；失败调用不受自动压缩保护名单限制。 |
| `autoDiscardTools` | `string[]` | `validate_dsh_ui` | 无论输出长度都自动丢弃的工具名单（支持末尾 `*` 通配符；可在设置页移除 `validate_dsh_ui` 或添加其他工具）。 |
| `autoCompressTieredProtectedTools` | `string[]` | `run_code,read,write,edit,apply_patch,notebook,read_image,todo_write,ask_user_question,skill,tool_search,tool_result_recall,oswyn_stats,oswyn_protect_tool,...` | 重要且绝不可被自动压缩的保护名单（支持末尾 `*` 通配符）；`run_code` 永远排除。 |
| `autoCompressMinChars` | `number` | `4000` | 分级自动兜底字符阈值（`autoCompress` / `autoCompressTiered` 共用）。 |
| `autoCompressKeepLines` | `number` | `30` | 分级自动兜底保留的前缀行数（同时作为裸 `truncate` 的默认保留行数）。 |

### 核心执行准则
1. **严格单步局部性（Strict Locality）**：仅允许优化紧邻当前步骤的前一次工具调用结果，禁止跨轮次干扰历史事件。
2. **零额外轮次开销（Zero Extra Turns）**：Agent 绝不耗费独立轮次或专门工具调用只为了总结，而是在处理当前步骤与生成当前回复的同时就地决策。
3. **全量重要绝不压缩（All Signal, Zero Loss）**：若工具输出整体具备上下文价值，Agent 自动全量保留原文，100% 保障 KV Cache 与推理精度。
4. **自主断点（Autonomous Cutpoint）**：Agent 自主决定保留到哪一行（如 `truncate keep 15 lines`），系统严格从字节 0 保留至该行，保障底层 KV 缓存命中率。

---

## 📡 系统提示词 (System Prompt) 协议

OSWYN 无缝集成至 DSH 核心 `ctx.systemPrompt`，向所有预设注入统一的精炼协议说明：

```markdown
## DSH-OSWYN: Only See What You Need (Context & Cache Optimization)

You are in full control of your context window. As sessions grow, re-sending massive historical tool outputs and redundant verbose replies drains token budget and degrades focus.
**Principle**: "Only See What You Need (OSWYN)" — you autonomously decide whether to summarize, where to cut, and what to keep.

### 1. Tool Output Optimization (Zero-Overhead Interleaved Decision)
- **Strict Scope**: Optimization applies ONLY to the single tool result directly preceding this turn.
- **Zero Extra Turns**: NEVER dedicate a separate turn or tool call just to summarize. Judge the last tool result concurrently while taking your next action or answering.
- **If All Content Is Important, DO NOT Summarize**: Keep the entire output intact if every line is relevant.

If the last tool result contains trailing noise (long build logs, test cascades, repetitive directory dumps), you decide whether and where to cut:

- **Option A: Truncate rear, preserve head byte-for-byte (100% KV-Cache Hit — Recommended)**:
  Decide which line the useful output ends (e.g. line 15), and cut off the rest:
  ```dsh-result-summary
  truncate keep <N> lines
  - key facts, error messages, lines, or status from the cut-off rear portion
  ```
  (Syntax: `truncate keep <N> lines` or `truncate keep <N> chars`. Preserves lines 1..N strictly from index 0 byte-for-byte for 100% KV prompt cache hit, discarding the tail).

- **Option B: Full replacement summary**:
  If the entire output is low-value noise and only a few facts matter:
  ```dsh-result-summary
  - exact key facts, error codes, identifiers, or counts
  ```

- **Zero-Loss Recall**: Summarized outputs are NEVER lost. Call `tool_result_recall` at any time to inspect full original bytes.

### 2. Dual-Track Assistant Reply Projection (User vs. Next-Turn Self)
Every substantive assistant response MUST end with a ```dsh-reply-summary block. This keeps future context lean while the user sees the complete detailed reply in the chat UI:
- **Free-Form Key-Detail Memo (No Rigid Template)**: Write natural, information-dense bullets tailored to what this reply actually did or answered. Do NOT force fixed boilerplate headings like `DENSE DECISION-COMPLETE MEMO`, `STATUS & VERIFICATION`, or `OPEN ITEMS` — open items rarely exist; omit them entirely unless real unfinished work remains.
- **Preserve Critical Answer Details**: Retain the concrete substance your next-turn self will need without re-reading the full prose — core conclusions, root causes, design rationale, key data/metrics, exact file paths with line numbers (`lib/core/plan.js:1-40`), symbol/function names, active config/command values, and verification results.
- **Example**:
  ```dsh-reply-summary
  - Root cause & fix: `rescueMergedResultFence` in `lib/client.js:1032-1081` splits glued closing fences before `dsh-ui` blocks; `test/realistic-fold.test.js` (8/8 passed).
  - Key details: Preserves inline markdown formatting in rescued prose; leaves normal code blocks (`json`, `bash`, `dsh-ui`) untouched.
  ```
The user in the Web UI sees the full prose response. On next turns, only this memo enters LLM context, keeping context window usage minimal and the prompt cache stable.
```

---

## 🛠️ 工具箱与全景大盘

### 原生工具
- `tool_result_summarize`：执行前缀截断（`truncate`）或全量替换（`replace`）。
- `assistant_reply_summarize`：为回复生成下一轮专属备忘。
- `tool_result_recall`：原样召回任意被截断或替换的完整原始输出（永不物理丢失）。
- `oswyn_protect_tool`：将工具加入/移出自动压缩保护名单（默认保护 `run_code/read/write/edit` 等）。
- `context_distill_stats`：自检全局或会话级 Token 节省量与 KV 缓存保护命中率。

### 斜杠命令 (Slash Commands)
- `/distill`：调出当前会话与全局的精炼节省报告。
- `/distill-cache`：查看 KV Prompt Cache 前缀保护率与稳定性审计。

### Web GUI 大盘
在 DSH 插件设置页（`设置 -> 插件管理 -> dsh-oswyn`）提供可视化大盘：
- **实时收益指标**：累计节省 Token、累计瘦身字符、KV 缓存保护率、助手双轨精炼次数。
- **全历史流水折叠展开**：查看历次操作时间、目标、模式、瘦身比例与提炼事实。
- **动态参数配置卡片**：直接在网页滑块与输入框调整门槛，热生效。

---

## 🔍 与 dsh-context 及系统内核的协同原理 (FAQ)

### 1. 为什么在 `dsh-context` 插件中看不到离散的“压缩事件”？
- **机制差异**：`dsh-context` 的“压缩事件”卡片硬编码要求日志中必须出现官方的 `compaction/summary` 或 `compaction/prune` 事件（属于多轮对话的宏观归档操作）。
- **微观单步原地替换**：OSWYN 采用的是 DSH 内核规范的 `tool/result` 单节点 `surfaceOp: { op: 'replace', startSeq, endSeq }` 原地精炼。这种设计**坚决不发射虚假的 compaction 事件**，以维护 DSH 事件溯源的权威性与生命周期纯洁性。
- **真实负增量体现**：OSWYN 产生的负增量真实作用于 `session.deriveMessages()`。在 `dsh-context` 的总体 Token 趋势曲线上，体现为**上下文增长曲线被显著压平、斜率大幅减缓**，而非出现回合级断崖。

### 2. `[oswyn-meta: ...]` 标记是否会破坏 KV-Cache？只留 ${summary} 行不行？
- **截断模式 (Truncate)**：OSWYN 严格按照 `content = prefix + banner` 结构组装，前缀从第 0 字节到截断点完全原样保留，机器标记只追加在截断点**之后（尾部）**，因此底层 KV-Cache 的前缀匹配是 100% 命中的。
- **机器标记的纯粹性**：大模型自身只需要 `${summary}`；`[oswyn-meta: ...]` 仅作为前端插件识别 before/after 的轻量元数据。在最新版本中已大幅压缩该标记体积（节约 25% 固有字符），并禁止将机器标记置于保留前缀之前。

## 压缩类型总表

| 类型 | 来源 | 触发方式 | 行为 |
|---|---|---|---|
| `truncate` / `truncate keep lines` | 主动 | Agent 写 `dsh-result-summary` | 从 0 字节保留前缀，尾部追加摘要 |
| `truncate keep chars` | 主动 | Agent 写 `dsh-result-summary` | 保留前 N 字符，尾部追加摘要 |
| `replace` | 主动 | Agent 写 `dsh-result-summary` | 整段替换为结构化事实 |
| `discard` | 主动 | Agent 写 `dsh-result-summary` + `discard` | 整段丢弃，仅留失败/关键结论 |
| `cascade` | 主动 | Agent 写 `cascade` | 折叠本轮先前失败调用 |
| `prune-call` / `stub-call` | 主动 | Agent 写对应指令 | 折叠工具调用参数（code/spec 等） |
| `reply` | 主动 | Agent 写 `dsh-reply-summary` | 回复双轨备忘，历史显示回复摘要 |
| `autoCompressTiered` | 自动 | 保护名单外工具 + 超过 `autoCompressMinChars` + 无 result fence | 自动前缀截断 |
| `autoCompressPtcSubcalls` | 自动 | `run_code` 多子调用聚合 + 超过阈值 + 无 fence | 按子调用生成结构化摘要，替换外层结果一次 |
| `autoDiscardFailed` | 自动 | 失败/exit code 非 0/异常堆栈 | 自动整段 discard |
| `autoDiscardTools` | 自动 | 命中配置工具名单 | 无论长度自动 discard |
| `autoCompress` | 自动（显式总开关） | 所有工具超过阈值 | 自动前缀截断（默认关闭） |
