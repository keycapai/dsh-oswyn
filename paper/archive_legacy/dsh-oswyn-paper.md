# DSH-OSWYN：面向长程软件工程智能体的内联上下文蒸馏架构、上下文增长曲线、跨代际模型压缩意愿与智力边界实证研究

**摘要**  
在长程软件工程（SWE）智能体与程序化工具调用（Programmatic Tool Calling, PTC）会话中，历史工具调用载荷（目录扫描、大文件探索性读取、失败堆栈追踪、冗长回归测试日志）与助手中间推理回复随轮次线性累积，导致单次请求上行开销呈现二次方级（$\mathcal{O}(N^2)$）增长，并在多轮交互后引发严重的“大海捞针（Needle-in-a-Haystack）”注意力稀释。本文提出并实证评估了 **DSH-OSWYN（Only See What You Need）**——一种直接构建于 `@deepseek-ai/dsh-session` 有向无环表面图（Surface DAG）之上的零额外轮次内联上下文蒸馏插件。

本研究基于真实网关环境（`workbuddy/deepseek-v4.1-flash`，简称 `ds4.1f`，并横向对比 `Gemini 3.8 Flash`、`Kimi 3.1 Pro`、`Hunyuan 4` 与 `Gemini 4` 四款跨代际模型）以及原版 **`billion-context@0.1.211`**（`bili` 状态化 HTTP 代理），完成了四项严格受控的真实会话（Real-Session）实证实验：
1. **15 步连续 SWE 会话上下文增长曲线与五路架构对比（`ds4.1f`）**：在包含 14 个工具步与 1 个综合归纳步（原始工具载荷累计 `57,147` 字符）的连续调试轨迹中，未管理基线（`Baseline`）单步上行 Prompt 从第 1 步的 `1,419` tokens 膨胀至第 14 步的 `21,699` tokens（增长 `15.3` 倍），累计计费达 `207,708` tokens。相比之下，**`OSWYN-Standard`** 将第 15 步常驻工具载荷压缩至 `15,624` 字符（**载荷净压缩率 `72.66%`**），单步上行体积在第 15 步压降至 `9,868` tokens（较基线降低 **`53.98%`**），累计计费降至 **`127,054` tokens（净节省 `38.83%` / `80,654` tokens）**，且最终工程归纳对 4 个核心常量的召回率保持 **`4/4`（`100%`）**。**`OSWYN-PTC`** 进一步将常驻工具载荷压降至 **`12,794` 字符（压缩率 `78.09%`）**，总计费降至 `133,667` tokens（节省 `35.65%`）。而原版 **`billion-context@0.1.211`（`bc`）** 虽通过代理端宏折叠将总计费降至 `153,328` tokens（节省 `26.18%`），但因重构中段历史破坏了 KV-Cache 前缀连续性，导致未命中缓存的新鲜上行开销（Fresh Prompt Tokens）高达 **`51,439` tokens（比不压缩基线的 `42,507` tokens 反增 `+21.01%`）**，且粗粒度区间折叠抹除了早期配置常量（召回率 `0/7`）。更关键的是，在 `ds4.1f` 上将 `OSWYN` 与 `billion-context` 直接叠加（`Synergy`）会引发**双协议竞争干扰**，导致模型主动输出 OSWYN 围栏的意愿从 `78.6%` 暴跌至 **`28.6%`**，总计费反弹至 `154,762` tokens。
2. **不同任务难度（L1 简单 / L2 中等 / L3 复杂）与跨代际模型主动压缩意愿实证**：在真实传入原生 Function Calling（`tools` schema）的条件下，模型主动压缩意愿受**认知负荷（Cognitive Load）**与**模型能力代际（Model Tier）**双重支配。轻量级模型 `ds4.1f` 在无单步提醒（Spontaneous）时遭遇严重的**工具调用模态抢占（Modal Preemption）**——在全部 6 个需继续调用工具的中间步骤中均直接输出 `tool_calls` 而将文本内容留空（`replyChars = 0`），导致总体自发意愿仅为 **`22.2%`（`2/9`）**；引入 `<system-reminder>` 单步动态提醒（With Nudge）后，其总体意愿跃升至 **`77.8%`（`7/9`）**，并在高难度 `L3_Hard` 任务中实现 **`23.32%` 的净 Token 节省（`27,625 -> 21,182` tokens）** 与 `4/4` 满额召回。与之相对，旗舰与推理模型（**`Kimi 3.1 Pro`、`Hunyuan 4`、`Gemini 4`**）在无单步提醒的自发状态下即在 L1/L2/L3 全难度梯度上达成 **`100.0%`（`9/9`）的主动压缩率**与 **`87.81%–93.57%` 的中高难度载荷压缩比**。
3. **提示词工程范式演进与“道德风险（Moral Hazard）”消融实证**：对比 4 种系统提示词变体（`P1` 原始版、`P2` 冗长披露自动兜底与拒收警告版、`P3` 结构化三步决策树精简版、`P4` 极简微指令版）证明：在系统提示词中向模型透明披露后台自动截断/丢弃兜底策略并强调拒收惩罚（`P2`），会在轻量模型（`ds4.1f`）与旗舰模型（`Gemini 4` 无 Nudge 态）上同时诱发**搭便车效应（Free-Riding）与拒收规避瘫痪**，导致两者主动压缩意愿双双归零（**`0.0%`，`0/3`**），而移除兜底披露并采用三步显式决策树与图文并茂共发契约的 **`P3`** 则在两类模型无 Nudge 态下均恢复 **`100.0%`（`3/3`）主动压缩率**与 **`91.21%–93.63%` 净压缩率**。
4. **标准模式（Standard Baseline）vs. OSWYN 智力水平与能力边界实证测试（`B1`–`B11` 共 11 题 $\times 10$ 轮 $= 110$ 次真实会话测试）**：针对“启用 Only See What You Need 是否会导致模型智力下降”这一核心问题，我们从 LiveCodeBench、GSM-Hard、SWE-bench、BBH 与 AIME 中精选并构造了 11 道刚好处于 `ds4.1f` 能力边界的测试题（含“刚刚好答得出”、“延迟细节回查陷阱”、“无提示跨文件隐式参数噪声迷宫”与“刚刚好答不出的算力极限题”）。实测表明：
   - **象限 I（目标明确的常规能力边界题 `B1`–`B6`、`B8`，共 21 轮/组）**：OSWYN **不仅实现零智力下降（`OSWYN_Standard` 通过率达 `21/21 = 100.0%`，高于 `Standard_Baseline` 的 `20/21 = 95.2%`），还在 `B1`（16 位字节码虚拟机状态追踪）上将 `ds4.1f` 的准确率从基线的 `2/3`（`66.7%`）提升至 `3/3`（`100.0%`）**——因为每步编写 `dsh-result-summary` 充当了**结构化步间思维锚点（Step-Boundary Scratchpad）**，并在 `B5`（2.2 万字符影子配置迷宫）上节省 **`18.74%` 总计费 Token**。
   - **象限 II（跨步延迟绑定细节与循环体复用陷阱 `B7`、`B10`，共 6 轮/组）**：当后续步骤突然索取前序步骤未重点关注的非显著槽位（`B7` S-Box 第 27/31 槽位）或要求重新执行前序文件中的 4 行位运算循环体（`B10`）时，**不带回溯工具的纯有损压缩（`OSWYN_Standard`）确实会出现明显能力滑坡（从基线的 `6/6 = 100.0%` 跌至 `1/6 = 16.7%`）**；但启用 OSWYN 内置的 **`tool_result_recall` 按需无损回溯工具（`OSWYN_With_Recall`）后，`ds4.1f` 在全部 `6/6`（`100.0%`）轮次中均自主意识到早期细节已被折叠、主动调用 `tool_result_recall(call_id="c1")` 取回原始文本并 100% 算对（`6/6 = 100.0%`）**，同时保持 `82.51%–89.10%` 的常驻载荷压缩率！
   - **象限 III & IV（无提示盲扫隐式除数 `B9` 与超出单步心算极限的 AIME 三次同余题 `B11`）**：在无任何公式提示的 60 线程噪声盲扫题 `B9` 上，OSWYN 因 1/3 概率漏摘 `/ 250` 隐式除数（未知的未知，Unknown Unknowns）使通过率从 `3/3` 微降至 `2/3`（`66.7%`）；而在 `ds4.1f` 原生基线刚刚好游走在答不出边缘的 `B11`（`Standard_Baseline` 仅 `1/3 = 33.3%` 答对）上，分出生成带宽撰写压缩围栏产生了轻微的**双任务认知挤占（Dual-Task Cognitive Tax）**，使 `ds4.1f` 降至 `0/3`（`0.0%`），而旗舰模型 **`Gemini 4 + OSWYN` 则在全部 11 道题上达成 `11/11`（`100.0%`）满分通过与 `91.17%` 平均压缩率**。

---

## 1. 研究背景与核心问题

在现代自主软件工程（SWE）智能体中，单次任务往往跨越数十个工具调用步骤。智能体需要频繁执行代码库结构扫描（`bash: find/grep`）、多模块源码读取（`read`）、代码修改（`edit`）以及测试构建验证（`bash: npm test / build`）。在传统的追加式（Append-Only）会话架构中，每一步产生的数千字符工具输出与工具入参均原样驻留于历史上下文窗口中。设第 $t$ 步新增长度为 $L_t$，则在 $T$ 步会话内累计向大语言模型发送的提示词总量满足：

$$\text{TotalPromptTokens}(T) = \sum_{t=1}^{T} \left( S_{\text{sys}} + \sum_{k=1}^{t} L_k \right) = T \cdot S_{\text{sys}} + \sum_{k=1}^{T} (T - k + 1) L_k = \mathcal{O}(T^2 \cdot \bar{L})$$

这一二次方级累积特性带来三重系统瓶颈：
1. **单步上行体积与计费成本失控**：在早期的第 $k$ 步产生的单次失败报错堆栈或冗长测试日志，会在后续 $T - k$ 个步骤中被重复计费与编码。
2. **注意力稀释与关键常量遗忘**：海量历史无关构建日志与废弃文件块充斥上下文中间区域（Lost-in-the-Middle），掩盖早期步骤发现的关键配置常量（如加密随机数、集群端口、自旋锁阈值）。
3. **外部区间折叠与前缀缓存（KV-Cache）的冲突**：以 `billion-context`（`bili`）为代表的外部代理方案通过向模型注入专用工具（`acp_status`、`compress`），在上下文接近阈值时将历史区间 $[m_{\text{start}}, m_{\text{end}}]$ 整体替换为一段摘要。这种“事后宏折叠”不仅需要消耗额外的工具往返轮次（Extra Turn），还会因改写历史序列中段而导致后续请求的 KV-Cache 前缀大面积失效（Cache Miss），并且粗粒度区间概括极易丢失精准代码行号与常量字面量。

针对上述问题，**DSH-OSWYN（Only See What You Need）** 提出了**内联步间微蒸馏（In-Band Step-Boundary Micro-Distillation）**范式：无需额外部署代理进程，也无需中断任务调用专用压缩工具，模型在生成当前步回复与下一步工具调用的同一轮次内，通过内联 Markdown 围栏（`dsh-result-summary` 与 `dsh-reply-summary`）原位裁剪前序工具载荷与冗长回复，并辅以对模型透明的**后台分层自动兜底策略（Automated Fallback Policies）**与**按需无损回溯工具（`tool_result_recall`）**。

本研究旨在通过真实网关会话实验回答五个核心实证问题：
- **问题一（上下文增长曲线与架构对比）**：在 15 步连续 SWE 调试会话中，`OSWYN-Standard`、`OSWYN-PTC`、原版 `billion-context@0.1.211` 以及两者的叠加态（`Synergy`）分别呈现怎样的上下文增长轨迹？微蒸馏与宏折叠在计费 Token、KV-Cache 命中率与信息保持度上的定量边界何在？
- **问题二（任务难度与认知负荷效应）**：当任务从简单目录扫描（L1）升级至单模块异常排查（L2）再升级至跨模块分布式共识死锁联合诊断（L3）时，模型的内联主动压缩意愿如何随认知负荷变化？
- **问题三（模型能力代际差异）**：轻量级高性价比模型（`DeepSeek 4.1 Flash`、`Gemini 3.8 Flash`）与前沿旗舰/推理模型（`Kimi 3.1 Pro`、`Hunyuan 4`、`Gemini 4`）在原生 Function Calling 并发场景下的自发压缩意愿与单步提醒（Nudge）依赖度有何本质差异？
- **问题四（提示词工程与道德风险机制）**：系统提示词的结构复杂度、拒绝规则警告以及后台自动兜底策略的透明披露，如何影响模型的主动压缩决策？
- **问题五（标准模式 vs. OSWYN 智力水平与能力边界对比）**：在处于模型能力临界点（“刚刚好答得出”与“刚刚好答不出”）的高难度多步推理与代码审计题集上，OSWYN 是否会导致智力下降？有损摘要的失效边界在哪里？`tool_result_recall` 能否闭环修复延迟细节丢失？

---

## 2. 系统架构与核心数学不变量

### 2.1 基于 `@deepseek-ai/dsh-session` 的有向无环表面图（Surface DAG）原位改写与无损回溯

`dsh-oswyn` 直接运行于 `@deepseek-ai/dsh-session` 内核之上（见 [`index.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/index.js) 与 [`lib/core/primitives.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/core/primitives.js)）。内核采用追加式事件日志（Event Log）与可变活跃视图投影（Active Surface Projection）分离的双层设计：
- **不可变事件日志（Append-Only Event Log）与 `tool_result_recall` 闭环**：所有原始 `user/message`、`assistant/message`、`tool/call`、`tool/ptc-dispatch` 与 `tool/result` 事件均以单调递增序号 `seq` 永久保留在底层事件流中。当后续步骤意外需要前序被 `truncate` 或 `replace` 折叠掉的具体代码行或配置槽位时，智能体可随时调用 `tool_result_recall(call_id)` 从事件日志中按需无损检出原始未压缩文本（见 [`lib/tools/recall-tool.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/tools/recall-tool.js)）。
- **可变表面节点图（Active Surface Nodes）**：每次构建上行 LLM 消息列表时，`session.deriveMessages()` 仅遍历当前驻留在活跃表面（`session.surface.nodes`）上的事件序列。当 `dsh-oswyn` 对序号为 $s_{\text{target}}$ 的工具结果或助手回复执行原位蒸馏时，调用内核原语：

$$\text{append}(\text{type}, \text{payload}, \{ \text{surfaceOp}: \{ \text{op}: \texttt{"replace"}, \text{startSeq}: s_{\text{target}}, \text{endSeq}: s_{\text{target}} \} \})$$

该操作在 $O(1)$ 时间内将活跃表面上的节点 $s_{\text{target}}$ 替换为蒸馏后的轻量事件，既不丢失底层审计历史，又使下一步 `deriveMessages()` 的上行体积立即缩减。

### 2.2 压缩（Compress）与丢弃（Discard）的严格正交解耦与数学不变量

在早期上下文管理设计中，工具入参（`tool-call.arguments`）与工具输出（`tool/result`）往往被混同处理。`dsh-oswyn` 在 [`lib/core/primitives.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/core/primitives.js) 中确立了**压缩（Compress）**与**丢弃（Discard）**的严格正交边界及净收益门控不变量：

1. **压缩原语（Compress：仅替换输出，保留入参）**：
   - 包含 **`truncate keep <N> lines|chars`**（前缀保留截断：保留原始工具输出的前 $N$ 行或前 $N$ 字符，追加 1 行摘要尾注）与 **`replace`**（全量语义替换：用高密度摘要替换工具输出正文）。
   - **作用范围与核算基准**：仅替换 `tool/result` 事件，完整保留 `assistant/message` 中对应的 `tool-call.arguments`（便于模型回溯曾读取过哪个文件路径或执行过哪条命令）。因此，其压缩前体积严格定义为纯输出长度：

   $$\text{before}_{\text{compress}} = L_{\text{output}}, \quad \text{after}_{\text{compress}} = L_{\text{distilled\_output}}, \quad \Delta_{\text{compress}} = L_{\text{output}} - L_{\text{distilled\_output}}$$

   - **严格净收益门控（Strict Net-Benefit Gate）**：为防止模型对极短输出写出比原文更长的摘要，内核强制执行 $\text{after}_{\text{compress}} < \text{before}_{\text{compress}}$ 校验；对于主动 `replace` 模式，进一步要求摘要正文长度满足 $L_{\text{summary}} < 0.30 \times L_{\text{output}}$（否则拒绝并返回 `replace not worth it`）。

2. **丢弃原语（Discard：同时清除入参与输出）**：
   - 包含 **`discard`**（单步废弃）、**`discard entire-ptc`**（整包 PTC 废弃）与 **`cascade`**（区间级联废弃）。
   - **作用范围与核算基准**：专用于失败的工具调用（`isError = true`，如编译报错、测试崩溃、命令参数错误）或一次性超长探测脚本。除了将 `tool/result` 替换为 1 行错误根因标记外，`markCallArgDiscarded(session, callId)` 会同步将 `deriveMessages()` 投影中的 `tool-call.arguments` 覆写为空对象 `'{}'`。因此，其压缩前体积严格包含入参与输出之和：

   $$\text{before}_{\text{discard}} = L_{\text{input}} + L_{\text{output}}, \quad \text{after}_{\text{discard}} = L_{\text{marker}}, \quad \Delta_{\text{discard}} = (L_{\text{input}} + L_{\text{output}}) - L_{\text{marker}}$$

3. **双轨助手回复投影（Dual-Track Reply Projection，`dsh-reply-summary`）**：
   - 针对长程会话中模型自身生成的数百行分析报告，模型可在回复末尾附加 ` ```dsh-reply-summary ` 围栏（见 [`lib/session/reply-summary.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/session/reply-summary.js)）。用户终端 UI 渲染完整正文，而当满足净收益条件（$L_{\text{summary}} < L_{\text{visible}}$）时，下一轮注入模型上下文的 `assistant/message` 自动投影为紧凑的 `dsh-reply-summary` 摘要。

4. **双模式适配（Standard 原生工具模式 vs. PTC 程序化工具调用模式）与自动兜底策略**：
   - 在 **Standard 模式**（[`lib/presets/standard.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/presets/standard.js)）下，模型按 `callId` 或隐式单工具目标对 `bash`、`read`、`edit` 等工具结果进行步间蒸馏。
   - 在 **PTC 模式**（[`lib/presets/ptc.js`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/lib/presets/ptc.js)）下，模型通过 `run_code` 一次性编排多个子工具调用（`tool/ptc-dispatch`），`dsh-oswyn` 支持对整个 `run_code` 信封进行 `replace` / `truncate` / `discard entire-ptc`，或按子调用序号（`#1`, `#2`）独立蒸馏。
   - **后台自动兜底策略（`runAllAutoPolicies`）**：当模型在某一步未主动输出 `dsh-result-summary` 围栏时，宿主在步边界自动执行三层兜底：（a）`autoDiscardFailed = true` 自动丢弃失败的工具调用及其入参；（b）`autoCompressTiered = true` 自动对超过阈值且不属于受保护列表（`autoCompressTieredProtectedTools` 默认保护 `read`、`write`、`edit`、`run_code` 等核心状态工具）的冗长工具输出执行前缀截断；（c）`autoCompressPtcSubcalls = true` 自动聚合折叠冗余的 PTC 子调用输出。

---

## 3. 实验设计与评测环境

为确保所有结论均建立在可复现的真实模型交互数据之上，本研究编写并执行了统一实证基准测试套件（评测脚本：`/Users/reno/.gemini/tasks/c_85f7b71380bd610b/workspace/run-unified-oswyn-benchmarks.mjs`，完整原始实验结果存档于 [`benchmarks/unified-oswyn-realsession-results.json`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/benchmarks/unified-oswyn-realsession-results.json) 与 [`benchmarks/exp4-intelligence-boundary-results.json`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/benchmarks/exp4-intelligence-boundary-results.json)）。

### 3.1 真实网关模型矩阵与代理配置

所有 LLM 请求均通过本地推理网关（`http://127.0.0.1:3425/v1/chat/completions`）发起真实调用（温度 `temperature = 0.1`，单次请求 `max_tokens = 4096` 以确保推理模型思维链不被截断，并发度严格限制为 $\le 4$）。表 1 列出了参评的 5 款模型及其代际分层。

| 模型名称 (Label) | 网关实际路由 Endpoint ID | 能力代际分层 (Model Tier) | 参评实验范围 |
| :--- | :--- | :--- | :--- |
| **DeepSeek 4.1 Flash (`ds4.1f`)** | `workbuddy/deepseek-v4.1-flash` | 轻量高性价比级 (Budget Flash) | 实验一 (五路 15 步曲线)、实验二 (难度×意愿)、实验三 (提示词消融)、**实验四 (B1–B11 智力边界)** |
| **Gemini 3.8 Flash** | `ai-studio/gemini-3.8-flash` | 轻量高性价比级 (Budget Flash) | 实验二 (难度×意愿跨模型对比) |
| **Kimi 3.1 Pro** | `workbuddy/kimi-k3.1-pro` | 旗舰推理级 (Reasoning Flagship) | 实验二 (难度×意愿跨模型对比) |
| **Hunyuan 4** | `workbuddy/hy4std` | 前沿旗舰级 (Frontier Flagship) | 实验二 (难度×意愿跨模型对比) |
| **Gemini 4** | `ai-studio/gemini-4-argon` | 前沿旗舰级 (Frontier Flagship) | 实验二 (难度×意愿跨模型对比)、实验三 (提示词消融对比)、**实验四 (B1–B11 智力边界上界参照)** |

在对比原版 **`billion-context@0.1.211`** 时，评测脚本直接拉起原版 `bili` 独立代理进程（监听 `127.0.0.1:18799`，上游指向 `127.0.0.1:3425`，启用 `x-acp-session` 会话持久化、`injectTool: true` 与 `injectNudge: true`，配置 `modelContextLimit: 12000`、`maxContextLimit: "35%"`、`nudgeGrowthTokens: 1500` 以在 15 步会话中段真实触发 `bili` 的上下文压力折叠机制）。

### 3.2 四大实证实验设计

1. **实验一（15 步连续 SWE 会话上下文增长曲线与五路架构对比，基于 `ds4.1f`）**：
   - 构建包含 15 个连续步骤的企业级后端调试与重构轨迹（`S01_RepoScan` 至 `S15_FinalSynthesisProbe`），涵盖 4 个核心源码读取步（埋入 `0x89ACF992`、`39918`、`1024`、`50` 四个核心常量）、5 个失败测试与探测崩溃步、5 个构建与回归测试日志步及 1 个终局全量归纳步（共 7 项精确召回指标）。在 `ds4.1f` 上并行评测五路配置：`Baseline`、`OSWYN-Standard`、`OSWYN-PTC`、`BillionContext`（`bc` 原版代理）、`Synergy`（`OSWYN + BC`）。
2. **实验二（任务难度梯度 L1/L2/L3 × 单步提醒 Nudge × 跨代际模型压缩意愿）**：
   - 在每一步均向 API 真实传入 `TOOLS_STANDARD`（`bash`、`read`、`edit` 函数 schema，`tool_choice: "auto"`），对 5 款模型在 `L1_Easy`（2 步）、`L2_Medium`（3 步）、`L3_Hard`（4 步分布式 Raft WAL 与条带锁死锁联合诊断）及有无单步提醒（Spontaneous vs. With Nudge）下执行 $5 \times 3 \times 2 = 30$ 组完整多步会话评测。
3. **实验三（提示词变体 P1–P4 × Nudge 消融实验，对比 `ds4.1f` 与 `Gemini 4`）**：
   - 在 `L2_Medium` 标准任务上对比 4 种系统提示词设计：`P1_Original`（`900` chars）、`P2_Verbose_FallbackDisclosed`（`3,941` chars，披露后台自动兜底与 `<30%` 拒收警告）、`P3_Streamlined_DecisionTree`（`3,282` chars，结构化三步决策树与共发契约）、`P4_Ultra_Minimal`（`227` chars）。
4. **实验四（标准模式 vs. OSWYN 智力水平与能力边界实证测试：`B1`–`B11` 共 11 题 $\times 10$ 轮 $= 110$ 次真实会话）**：
   - 构造覆盖四大能力边界象限的 11 道多步推理与代码审计基准题（详见第 7 节），在 `ds4.1f` 上对每道题分别运行 3 轮 **`Standard_Baseline`**（原生无压缩）、3 轮 **`OSWYN_Standard`**（仅单向微蒸馏，不挂载 `tool_result_recall`）、3 轮 **`OSWYN_With_Recall`**（完整 OSWYN 架构，挂载 `tool_result_recall` 按需无损回溯工具），并以 **`Gemini4_OSWYN_Ref`**（`Gemini 4` 运行 OSWYN）作为前沿模型能力上界参照，检验精确数值求解准确率（Pass Rate）、载荷压缩率与 Token 开销。

---

## 4. 实验一：15 步连续会话上下文增长曲线与五路架构对比（`ds4.1f`）

### 4.1 五路架构总体性能指标对比

表 2 汇总了 `DeepSeek 4.1 Flash`（`workbuddy/deepseek-v4.1-flash`）在 15 步连续 SWE 会话中五路架构的完整实测指标（数据直接取自 [`unified-oswyn-realsession-results.json`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/benchmarks/unified-oswyn-realsession-results.json)）。

| 评测维度 / 指标 | `Baseline` (无管理基线) | `OSWYN-Standard` (标准微蒸馏) | `OSWYN-PTC` (PTC 信封微蒸馏) | `BillionContext` (`bc` 原版 v0.1.211) | `Synergy` (`OSWYN + BC` 叠加) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **累计上行 Prompt Tokens** | 199,563 | **113,769 (-42.99%)** | 122,343 (-38.69%) | 144,495 (-27.60%) | 142,108 (-28.79%) |
| **累计命中缓存 Cached Tokens** | 157,056 | 73,472 | 81,664 | 93,056 | 84,608 |
| **累计未缓存 Fresh Prompt Tokens** | 42,507 | **40,297 (-5.20%)** | 40,679 (-4.30%) | 51,439 (+21.01%) | 57,500 (+35.27%) |
| **KV-Cache 命中率 (`cacheHitRate`)** | 78.70% | 64.58% | 66.75% | 64.40% | 59.54% |
| **累计下行 Completion Tokens** | 8,145 | 13,285 | 11,324 | 8,833 | 12,654 |
| **总计费 Tokens (`totalBilledTokens`)** | 207,708 | **127,054 (-38.83%)** | 133,667 (-35.65%) | 153,328 (-26.18%) | 154,762 (-25.49%) |
| **第 15 步单步上行 Prompt Tokens** | 21,445 | **9,868 (-53.98%)** | 10,621 (-50.47%) | 8,014 (-62.63%) | 10,568 (-50.72%) |
| **累计原始工具载荷字符数** | 57,147 | 57,147 | 58,392 | 57,147 | 57,147 |
| **终局常驻工具载荷字符数** | 57,147 | **15,624** | **12,794** | 57,147 (本地未减) | 31,628 |
| **终局总常驻表面字符数** | 66,112 | 31,842 (-51.84%) | **26,582 (-59.79%)** | 64,445 | 46,612 (-29.50%) |
| **客户端工具载荷净压缩率** | 0.00% | **72.66%** | **78.09%** | 0.00% (代理侧折叠) | 44.66% |
| **模型主动围栏触发率 (Active Rate)** | 0/14 (0%) | **11/14 (78.6%)** | **11/14 (78.6%)** | 0/14 (0%) | 4/14 (28.6%) |
| **后台自动兜底触发步数 (Auto Fallback)** | 0 | 2 (`S10`, `S13`) | 2 (`S08`, `S09`) | 0 | 6 |
| **中段探针召回 (`midwayProbeScore`)** | 3/3 | 2/3 | **3/3** | 0/3 | 0/3 |
| **终局常量精确召回 (`finalNeedleScore`)** | **4/4** | **4/4** | 0/4 | 0/4 | 1/4 |
| **总信息召回得分 (`totalRecallScore`)** | **7/7 (100.0%)** | **6/7 (85.7%)** | 3/7 (42.9%) | 0/7 (0.0%) | 1/7 (14.3%) |

### 4.2 15 步上下文增长曲线可视化与逐步轨迹数据

下图展示了五路架构在 15 步连续会话中的单步上行 Prompt Tokens 曲线（左图）与客户端常驻工具载荷字符数增长曲线（右图）：

![15 步连续 SWE 会话上下文增长曲线对比](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/paper/context-growth-curves.svg)

为直观呈现每一步的动态剪枝与折叠行为，图 1a 的 ASCII/Unicode 字符包络图与表 3 的 15 步完整实测数据如下：

```text
单步上行 Prompt Tokens 增长曲线 (Step 1 -> Step 15, 模型: ds4.1f)
Tokens
22,000 |                                                       * Baseline (21,699 -> 21,445)
20,000 |                                     B (20,052)    *   :
18,000 |                                         *     *       :
16,000 |                                 *   B                 :
14,000 |                         *   *           B             :
12,000 |                     *   B       S                     :
10,000 |             B   *   B       S   *   S---P---P---P---P---P OSWYN-PTC (10,621)
 8,000 |         *       B       S   P   O---O---O---O---O---O---O OSWYN-Standard (9,868)
 6,000 |     B       *   O   O   O                         B---B---B BillionContext (8,014, Recall 0/7)
 4,000 | *   O---O---O
 2,000 | *
     0 +------------------------------------------------------------
        S1  S2  S3  S4  S5  S6  S7  S8  S9 S10 S11 S12 S13 S14 S15
图例: [*] Baseline  [O] OSWYN-Standard  [P] OSWYN-PTC  [B] BillionContext  [S] Synergy
```

| 步骤 (`Step_ID`) | 事件类型 | `Baseline` 单步 Prompt / 常驻载荷 | `OSWYN-Standard` 单步 Prompt / 常驻载荷 (动作) | `OSWYN-PTC` 单步 Prompt / 常驻载荷 (动作) | `BillionContext` (`bc`) 单步 Prompt / 累计计费 | `Synergy` 单步 Prompt / 常驻载荷 (动作) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **S01** `RepoScan` | `scan_log` | 1,419 tok / 3,031 ch | 2,640 tok / **528 ch** (`Active`) | 2,969 tok / **954 ch** (`Active`) | 5,062 tok / 5,411 tok | 6,283 tok / 784 ch (`Auto`) |
| **S02** `ReadVault` | `code_read` | 3,961 tok / 9,346 ch | 4,593 tok / **1,341 ch** (`Active`) | 5,019 tok / **1,413 ch** (`Active`) | 9,791 tok / 15,837 tok | 10,593 tok / 7,099 ch (`None`) |
| **S03** `VaultTestFail` | `failed_call` | 6,082 tok / 15,362 ch | 4,662 tok / **1,637 ch** (`Active`) | 4,930 tok / **1,741 ch** (`Active`) | 9,296 tok / 25,765 tok | 9,829 tok / 7,291 ch (`Auto`) |
| **S04** `VaultFixPass` | `scan_log` | 6,921 tok / 17,894 ch | 3,928 tok / **3,059 ch** (`Active`) | 4,255 tok / **2,354 ch** (`Active`) | 6,602 tok / 32,655 tok | 7,228 tok / 8,229 ch (`Active`) |
| **S05** `ReadRedis` | `code_read` | 9,746 tok / 24,817 ch | 6,707 tok / **3,712 ch** (`Active`) | 6,801 tok / 9,374 ch (`None`) | 10,006 tok / 43,985 tok | 5,520 tok / 15,152 ch (`None`) |
| **S06** `RedisBugProbe1` | `failed_call` | 10,788 tok / 27,408 ch | 5,253 tok / **4,002 ch** (`Active+Reply`) | 7,589 tok / **9,673 ch** (`Active`) | 7,273 tok / 51,854 tok | 12,905 tok / 15,456 ch (`Active`) |
| **S07** `ReadSpinlock` | `code_read` | 13,126 tok / 34,412 ch | 7,275 tok / 11,006 ch (`Protected`) | 9,605 tok / **10,100 ch** (`Active`) | 11,710 tok / 63,989 tok | 10,202 tok / 22,460 ch (`None`) |
| **S08** `SpinlockFail` | `failed_call` | 14,144 tok / 36,922 ch | 8,053 tok / **11,306 ch** (`Active`) | 8,693 tok / **10,300 ch** (`Auto`) | 9,301 tok / 74,827 tok | 7,331 tok / 22,795 ch (`Active`) |
| **S09** `LargeProbeFail` | `failed_large` | 15,422 tok / 40,004 ch | 8,956 tok / **11,683 ch** (`Active`) | 9,154 tok / **10,480 ch** (`Auto`) | 0 (超时回退) / 74,827 tok | 8,238 tok / 23,015 ch (`Active`) |
| **S10** `SpinlockProbe2` | `scan_log` | 16,193 tok / 42,193 ch | 9,100 tok / **12,466 ch** (`Auto`) | 8,944 tok / **10,884 ch** (`Active`) | 20,052 tok / 95,987 tok | 10,264 tok / 23,798 ch (`Auto`) |
| **S11** `ReadChronos` | `code_read` | 18,368 tok / 47,915 ch | 10,767 tok / **13,116 ch** (`Active`) | 10,904 tok / **11,351 ch** (`Active`) | 15,412 tok / 111,762 tok | 10,813 tok / 29,520 ch (`None`) |
| **S12** `ChronosFail` | `failed_call` | 19,412 tok / 50,332 ch | 10,064 tok / **13,560 ch** (`Active`) | 10,270 tok / **11,608 ch** (`Active`) | 13,684 tok / 125,832 tok | 10,632 tok / 29,719 ch (`Auto`) |
| **S13** `FullBuildScan` | `scan_log` | 20,837 tok / 54,477 ch | 11,002 tok / **14,712 ch** (`Auto`) | 11,269 tok / **12,274 ch** (`Active`) | 10,296 tok / 136,689 tok | 10,831 tok / 30,871 ch (`Auto`) |
| **S14** `RegressProbe3` | `scan_log` | 21,699 tok / 57,147 ch | 10,901 tok / **15,624 ch** (`Active`) | 11,320 tok / **12,794 ch** (`Active`) | 7,996 tok / 144,891 tok | 10,871 tok / 31,628 ch (`Auto`) |
| **S15** `FinalSynthesis` | `final_probe` | 21,445 tok / 57,147 ch | **9,868 tok** / **15,624 ch** (`Reply`) | **10,621 tok** / **12,794 ch** | 8,014 tok / 153,328 tok | 10,568 tok / 31,628 ch |

### 4.3 实验一深度实证分析

基于表 2 与表 3 的逐步轨迹数据，可以得出以下四项严格的数据结论：

1. **微蒸馏（OSWYN）对 $\mathcal{O}(N^2)$ 上下文膨胀的压制效应**：
   - 在 `Baseline` 中，由于每一步工具载荷（平均约 `4,082` 字符/步）原样堆积，单步上行 Prompt 从 `S01` 的 `1,419` tokens 线性爬升至 `S14` 的 `21,699` tokens，导致 15 步累计上行达 `199,563` tokens。
   - 在 **`OSWYN-Standard`** 中，`ds4.1f` 在 14 个工具步中有 **11 步（`78.6%`）主动发出 `dsh-result-summary` 围栏**并全部通过净收益校验，剩余 3 步中，`S10` 与 `S13`（测试与构建日志）被 `autoCompressTiered` 自动截断保留前 15 行，仅 `S07_ReadSpinlock`（受 `autoCompressTieredProtectedTools` 保护的 `read` 工具调用）在模型未发围栏时保留原貌。这使常驻工具载荷从 `57,147` 字符压降至 **`15,624` 字符（减少 `72.66%`）**，单步上行 Prompt 在 `S08`–`S15` 稳定在 `8,053`–`11,002` tokens 的平台期，累计总计费降低 **`38.83%`（节省 `80,654` tokens）**，且第 15 步终局合成对 4 个核心常量的召回率达到 **`100%`（`4/4`）**。

2. **原版 `billion-context@0.1.211`（`bc`）的代理开销、KV-Cache 失效与信息遗忘**：
   - **起步固定开销高昂**：在 `S01`–`S03`，由于 `bili` 代理向请求注入了 `compress`、`acp_status` 两个工具 Schema 以及上下文管理指令，`bc` 在 `S01` 的单步 Prompt 达到 **`5,062` tokens**（是 `Baseline` `1,419` tokens 的 **`3.57` 倍**，也是 `OSWYN-Standard` `2,640` tokens 的 **`1.92` 倍**）。
   - **区间宏折叠破坏 KV-Cache 前缀连续性**：虽然 `bili` 在 `S06`、`S08` 以及 `S11`–`S15` 触发了代理侧历史折叠，使累计 Prompt 降至 `144,495` tokens（较 `Baseline` 减少 `27.60%`），但每次代理改写历史消息区间都会改变消息序列的前缀哈希，导致上游网关 KV-Cache 失效。实测显示，`bc` 的**未缓存新鲜上行 Token（`totalFreshTokens`）高达 `51,439` tokens**，不仅高于 `OSWYN-Standard`（`40,297` tokens），甚至**比完全不压缩的 `Baseline`（`42,507` tokens）还要多消耗 `8,932` 个全价新鲜 Token（`+21.01%`）**。
   - **粗粒度折叠导致精确常量丢失**：`bili` 在代理侧将早期包含 `VAULT_ROOT_NONCE`、`REDIS_CLUSTER_PORT` 与 `SPINLOCK_MAX_RETRIES` 的消息块整体折叠后，未能在代理侧摘要中保留精确的十六进制与端口字面量，导致 `bc` 在 3 个中段探针与 4 个终局常量上的召回得分为 **`0/7`（`0.0%`）**。

3. **Standard 模式与 PTC 模式的信息保持度权衡**：
   - **`OSWYN-PTC`** 借助 `run_code` 信封级压缩与 `autoDiscardFailed`（在 `S08`、`S09` 自动丢弃失败的 `run_code` 调用及长脚本入参），实现了五路架构中最高的**工具载荷净压缩率（`78.09%`，终局载荷仅 `12,794` 字符）**与最小的**终局总表面积（`26,582` 字符，较 `Baseline` 缩减 `59.79%`）**。
   - 在信息保持度上，`OSWYN-PTC` 的**中段探针召回率达到 `3/3`（`100%`）**，证明在会话推进过程中所有常量均被准确提取；但在 `S15` 终局归纳步，`ds4.1f` 仅输出了 `238` tokens 的简短结项说明而未重新默写前序已汇报过的常量（`finalNeedleScore = 0/4`）。这表明在 PTC 模式下，高强度信封替换会使轻量模型倾向于输出增量式短回复，工程上需配合终局状态固定（State Pinning）以确保长程字面量在最终报告中完整复现。

4. **`Synergy`（`OSWYN + BillionContext` 叠加态）的双协议干扰效应**：
   - 实验数据直接证伪了“将客户端微蒸馏与代理端宏折叠简单叠加即可获得双重收益”的假设。在 `Synergy` 组中，`ds4.1f` 面对 `OSWYN` 的 `<system-reminder>` 围栏提醒与 `bili` 代理注入的 `<system-reminder>` `acp_status/compress` 提醒时发生了严重的**注意力分流与协议竞争**：模型主动输出 `dsh-result-summary` 围栏的比率从 `OSWYN-Standard` 的 **`78.6%`（`11/14`）骤降至 `28.6%`（`4/14`）**，迫使后台自动兜底策略触发了 `6` 次，最终常驻工具载荷为 `31,628` 字符（压缩率仅 `44.66%`），新鲜上行 Token 膨胀至 **`57,500` tokens（较 `Baseline` 反增 `+35.27%`）**，总计费 Token（`154,762`）亦比单独使用 `OSWYN-Standard`（`127,054`）高出 **`21.81%`**。因此，**对于 `ds4.1f` 等轻量模型，单独启用 `OSWYN-Standard` 或 `OSWYN-PTC` 显著优于叠加外部代理压缩**。

---

## 5. 实验二：不同任务难度与跨代际模型主动压缩意愿实证

### 5.1 跨模型×跨难度主动压缩意愿完整实测矩阵

在真实传入 `TOOLS_STANDARD`（`bash`、`read`、`edit`）原生工具 Schema 的条件下，表 4 展示了 5 款跨代际模型在三种任务难度（`L1_Easy` 2 步、`L2_Medium` 3 步、`L3_Hard` 4 步，合计 9 个工具步）及两种触发模式（无单步提醒 `Spontaneous` vs. 有单步提醒 `With Nudge`）下的 30 组完整实测数据。

![不同任务难度与跨代际模型主动压缩意愿对比](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/paper/willingness-difficulty-models.svg)

| 模型名称 (代际分层) | 触发模式 | `L1_Easy` 意愿 (有效/步数) | `L1_Easy` 压缩率 / 召回 | `L2_Medium` 意愿 (有效/步数) | `L2_Medium` 压缩率 / 召回 | `L3_Hard` 意愿 (有效/步数) | `L3_Hard` 压缩率 / 召回 | 跨难度总主动意愿 (9 步汇总) | 空文本工具抢占步数 (`replyChars=0`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **DeepSeek 4.1 Flash** (`Budget Flash`) | 无 Nudge | 50.0% (1/2) | 23.72% / `2/2` | **0.0% (0/3)** | 0.00% / `1/3` | 25.0% (1/4) | 5.96% / `4/4` | **22.2% (2/9)** | **6/6 (中间步 100% 抢占)** |
| **DeepSeek 4.1 Flash** (`Budget Flash`) | **有 Nudge** | **100.0% (2/2)** | **72.27%** / `1/2` | **66.7% (2/3)** | **58.29%** / `3/3` | **75.0% (3/4)** | **62.31%** / `4/4` | **77.8% (7/9)** | 2/6 (仅 `M1`, `H3`) |
| **Gemini 3.8 Flash** (`Budget Flash`) | 无 Nudge | 100.0% (2/2) | 56.34% / `2/2` | 66.7% (2/3) | 52.02% / `3/3` | 75.0% (3/4) | 64.67% / `4/4` | **77.8% (7/9)** | 1/6 (仅 `H3`) |
| **Gemini 3.8 Flash** (`Budget Flash`) | **有 Nudge** | **100.0% (2/2)** | **72.76%** / `1/2` | **100.0% (3/3)** | **93.80%** / `3/3` | **75.0% (3/4)** | **64.32%** / `4/4` | **88.9% (8/9)** | 1/6 (仅 `H3`) |
| **Kimi 3.1 Pro** (`Reasoning Flagship`) | 无 Nudge | **100.0% (2/2)** | 54.97% / `2/2` | **100.0% (3/3)** | **93.47%** / `3/3` | **100.0% (4/4)** | **88.92%** / `4/4` | **100.0% (9/9)** | **0/6 (零抢占)** |
| **Kimi 3.1 Pro** (`Reasoning Flagship`) | **有 Nudge** | **100.0% (2/2)** | 70.15% / `0/2` | **100.0% (3/3)** | **94.54%** / `3/3` | 75.0% (3/4) | 64.59% / `4/4` | **88.9% (8/9)** | **0/6 (零抢占)** |
| **Hunyuan 4** (`Frontier Flagship`) | 无 Nudge | **100.0% (2/2)** | 52.06% / `2/2` | **100.0% (3/3)** | 79.95% / `3/3` | **100.0% (4/4)** | **93.04%** / `4/4` | **100.0% (9/9)** | **0/6 (零抢占)** |
| **Hunyuan 4** (`Frontier Flagship`) | **有 Nudge** | **100.0% (2/2)** | **65.35%** / `2/2` | **100.0% (3/3)** | **92.56%** / `3/3` | **100.0% (4/4)** | **94.05%** / `4/4` | **100.0% (9/9)** | **0/6 (零抢占)** |
| **Gemini 4** (`Frontier Flagship`) | 无 Nudge | **100.0% (2/2)** | 59.13% / `1/2` | **100.0% (3/3)** | **93.57%** / `3/3` | **100.0% (4/4)** | **87.81%** / `4/4` | **100.0% (9/9)** | **0/6 (零抢占)** |
| **Gemini 4** (`Frontier Flagship`) | **有 Nudge** | **100.0% (2/2)** | **76.05%** / `1/2` | **100.0% (3/3)** | **92.39%** / `3/3` | 75.0% (3/4) | 63.26% / `4/4` | **88.9% (8/9)** | 1/6 (仅 `H3`) |

### 5.2 任务难度与模型代际的核心实证规律

通过剖析表 4 及每一步的 `stepLogs`（见 `unified-oswyn-realsession-results.json`），我们揭示了内联上下文压缩的三条底层规律：

1. **规律一：轻量模型的“工具调用模态抢占（Function-Calling Modal Preemption）”是自发压缩率低下的真正根因**：
   - 在 `L1_Easy`（Step 1）、`L2_Medium`（Step 1、Step 2）和 `L3_Hard`（Step 1、Step 2、Step 3）这 **6 个需要模型发起下一步工具调用的中间步骤**中，当不注入单步提醒（`withNudge = false`）时，**`ds4.1f` 在全部 6/6 个中间步骤中均直接输出 `tool_calls` 数组，而将文本通道 `message.content` 完全置空（`replyChars = 0`）**！仅在 `L1_Easy` 的最后一步 `E2_TestLog` 和 `L3_Hard` 的最后一步 `H4_FailedDiagnosticProbe`（此时 `isLastToolStep = true`，无需再调用工具，模型被迫切换到纯文本回复模式）才发出了 `dsh-result-summary` 围栏。
   - 这一数据严格证明：**轻量级 Flash 模型并非“读不懂压缩语法”，而是在 Function Calling 激活时存在强烈的模态互斥偏置——一旦决定调用工具，便默认跳过文本生成通道**。
   - 当引入 `<system-reminder>` 单步动态提醒（`withNudge = true`）后，`ds4.1f` 的空文本工具抢占步数从 `6/6` 骤降至 `2/6`，跨难度总体主动压缩意愿从 **`22.2%`（`2/9`）跃升至 `77.8%`（`7/9`）**。尤其在 `L3_Hard` 复杂任务上，单步 Nudge 驱动 `ds4.1f` 将工具载荷压缩了 **`62.31%`（从 `18,708` 字符降至 `7,498` 字符）**，使会话总计费 Token 从 **`27,625` 降至 `21,182`（净节省 `23.32%` / `6,443` tokens）**，同时保持 `4/4`（`100%`）常量与根因召回。

2. **规律二：认知负荷峰值下的“顿悟抢占效应（Eureka Preemption）”——为什么 `L3_Hard` 的第 3 步（`H3_ReadStripeLock`）成为跨模型共同瓶颈？**
   - 观察表 4 中 `L3_Hard`（4 步分布式死锁诊断）的逐步日志可以发现一个高度一致的现象：在 `withNudge = true` 下，`ds4.1f`（`75%`）、`Gemini 3.8 Flash`（`75%`）、`Kimi 3.1 Pro`（`75%`）与 `Gemini 4`（`75%`）全部在 `H1_ReadRaftWal`（Step 1）、`H2_CascadeCrashLog`（Step 2）和 `H4_FailedDiagnosticProbe`（Step 4）上成功执行了 `replace` 或 `discard`（100% 命中），但**唯独在 Step 3（`H3_ReadStripeLock`）一致跳过了围栏（其中 `ds4.1f`、`Gemini 3.8 Flash` 与 `Gemini 4` 在该步均出现 `replyChars = 0`）**！
   - 为什么偏偏是 `H3_ReadStripeLock`？因为在 `H1`（读取常量）与 `H2`（观察崩溃栈）之后，模型在 `H3` 读取 `src/consensus/stripe-lock.ts` 时**首次发现了导致分布式脑裂的确切代码 Bug（第 63 行 `try { return fn(); }` 缺失 `await`）**，且任务指令要求其在修复前立即通过 `bash` 运行状态探测命令。在“定位核心 Bug（顿悟时刻）+ 立即构造复杂诊断脚本调用”的双重认知负荷峰值下，模型的注意力被下一步 `bash` 工具调用完全捕获，从而省略了前导文本围栏。
   - 这也从实证角度验证了 `dsh-oswyn` 将 `read` 列入 `autoCompressTieredProtectedTools` 的架构合理性：当模型在核心代码定位步因高认知负荷跳过围栏时，保留该核心源码文件（`stripe-lock.ts`）常驻是安全且合理的，而紧随其后的 `H4` 失败探测脚本则被模型（及 `autoDiscardFailed`）100% 彻底丢弃。

3. **规律三：跨代际模型能力分水岭——旗舰模型具备 100% 自发双通道共发能力，且单步 Nudge 能引导更激进的压缩模式选择**：
   - 在无单步提醒（`withNudge = false`）的自发状态下，三款旗舰/推理模型——**`Kimi 3.1 Pro`、`Hunyuan 4` 与 `Gemini 4`**——在 `L1_Easy`、`L2_Medium`、`L3_Hard` 全部 9 个工具步上均实现了 **`100.0%`（`9/9`）的主动压缩率**与 **`0` 次空文本模态抢占**！这表明旗舰模型具备充裕的指令遵循带宽，能够在生成 `tool_calls` JSON 的同时稳定在 `content` 通道前置输出 Markdown 蒸馏围栏。
   - 此外，对比 **`Hunyuan 4`** 在 `L2_Medium` 上无 Nudge 与有 Nudge 的模式选择（见表 4 与 `stepLogs`）：在无 Nudge 时，`Hunyuan 4` 对第 2 步失败测试（`M2_FailingTest`）选择了相对保守的 `truncate`（载荷压缩率 `79.95%`，总计费 `14,373` tokens）；而在有 Nudge 时，单步提醒中的错误标识引导 `Hunyuan 4` 精确切换为 **`discard`**（同时清空入参与输出），使载荷压缩率提升至 **`92.56%`（常驻载荷仅剩 `833` 字符）**，且收敛了冗余推理长度，使总计费 Token 从 `14,373` 降至 **`10,447`（净省 `27.31%`）**。

---

## 6. 实验三：提示词工程范式演进与“道德风险”消融实证

表 5 展示了在 `L2_Medium` 任务（3 步，原始工具载荷 `11,196` 字符）上，4 种系统提示词变体（`P1_Original`、`P2_Verbose_FallbackDisclosed`、`P3_Streamlined_DecisionTree`、`P4_Ultra_Minimal`）分别在 `DeepSeek 4.1 Flash`（`ds4.1f`）与 `Gemini 4` 上的消融实验结果。

| 模型名称 | 提示词变体 (`variantId`) | 系统提示词长度 | 单步 Nudge | 主动压缩意愿 (有效/步数) | 客户端载荷净压缩率 | 终局常驻载荷字符数 | 累计上行 Prompt Tokens | 总计费 Tokens (`totalBilled`) | 关键信息召回 (`recallScore`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **DeepSeek 4.1 Flash** | `P1_Original` (原始无兜底披露) | 900 chars | `false` | 33.3% (1/3) | 31.06% | 7,718 | 9,604 | 11,390 | `3/3` |
| **DeepSeek 4.1 Flash** | `P1_Original` (原始无兜底披露) | 900 chars | `true` | 33.3% (1/3) | 26.38% | 8,243 | 9,626 | 10,314 | `1/3` |
| **DeepSeek 4.1 Flash** | **`P2_Verbose_FallbackDisclosed`** | 3,941 chars | `false` | **0.0% (0/3)** | **0.00%** | 11,196 | 11,806 | 13,644 | `2/3` |
| **DeepSeek 4.1 Flash** | **`P2_Verbose_FallbackDisclosed`** | 3,941 chars | `true` | **0.0% (0/3)** | **0.00%** | 11,196 | 12,723 | **15,264 (最高)** | `1/3` |
| **DeepSeek 4.1 Flash** | **`P3_Streamlined_DecisionTree`** | 3,282 chars | `false` | **100.0% (3/3)** | **91.21%** | **984** | **8,235** | **9,938** | **`3/3`** |
| **DeepSeek 4.1 Flash** | `P3_Streamlined_DecisionTree` | 3,282 chars | `true` | 33.3% (1/3) | 26.67% | 8,210 | 11,503 | 12,850 | `1/3` |
| **DeepSeek 4.1 Flash** | `P4_Ultra_Minimal` (极简三行版) | 227 chars | `false` | **0.0% (0/3)** | **0.00%** | 11,196 | 9,085 | 9,432 | `1/3` |
| **DeepSeek 4.1 Flash** | `P4_Ultra_Minimal` (极简三行版) | 227 chars | `true` | **66.7% (2/3)** | **64.97%** | 3,922 | **7,674** | **8,798 (最低)** | `2/3` |
| **Gemini 4** | `P1_Original` (原始无兜底披露) | 900 chars | `false` | **100.0% (3/3)** | **94.05%** | **666** | 6,269 | 6,716 | **`3/3`** |
| **Gemini 4** | `P1_Original` (原始无兜底披露) | 900 chars | `true` | **100.0% (3/3)** | **93.44%** | 735 | 7,220 | 7,799 | **`3/3`** |
| **Gemini 4** | **`P2_Verbose_FallbackDisclosed`** | 3,941 chars | `false` | **0.0% (0/3)** | **0.00%** | 11,196 | 12,050 | **12,576 (最高)** | `3/3` |
| **Gemini 4** | `P2_Verbose_FallbackDisclosed` | 3,941 chars | `true` | **100.0% (3/3)** | **93.39%** | 740 | 9,475 | 10,300 | **`3/3`** |
| **Gemini 4** | **`P3_Streamlined_DecisionTree`** | 3,282 chars | `false` | **100.0% (3/3)** | **93.63%** | **713** | 8,223 | 9,086 | **`3/3`** |
| **Gemini 4** | `P3_Streamlined_DecisionTree` | 3,282 chars | `true` | **100.0% (3/3)** | **93.60%** | 717 | 9,140 | 9,851 | **`3/3`** |
| **Gemini 4** | **`P4_Ultra_Minimal` (极简三行版)** | 227 chars | `false` | **100.0% (3/3)** | **86.05%** | 1,562 | **5,995** | **6,442 (最低)** | **`3/3`** |
| **Gemini 4** | `P4_Ultra_Minimal` (极简三行版) | 227 chars | `true` | **100.0% (3/3)** | **93.85%** | 688 | 6,664 | 7,205 | **`3/3`** |

### 6.1 提示词消融的三大实证发现

1. **严密证实 `P2` 的“自动兜底搭便车（Moral Hazard / Free-Riding）”与“拒收恐惧瘫痪”效应**：
   - 对比 `P2_Verbose_FallbackDisclosed` 与 `P1`/`P3`/`P4` 可以看到本实验最关键的消融结果：**向模型透明披露后台自动兜底机制（`autoCompressTiered = true`、`autoDiscardFailed = true`）并强调 `< 30%` 拒收惩罚警告（`P2`），导致 `ds4.1f`（有无 Nudge 均如此）与 `Gemini 4`（无 Nudge 自发态）的主动压缩意愿双双崩溃至 `0.0%`（`0/3`）！**
   - 尤其值得关注的是 **`Gemini 4`**：在无 Nudge 的自发状态下，`Gemini 4` 在 `P1`（`900` chars）、`P3`（`3,282` chars）乃至仅有 3 行指令的 `P4`（`227` chars）上均达到了 **`100.0%`（`3/3`）的主动压缩率**；然而一旦切换到 `P2_Verbose_FallbackDisclosed`（无 Nudge），`Gemini 4` 的主动压缩率瞬间跌至 **`0.0%`（`0/3`）**，总计费 Token 飙升至 `12,576` tokens（比 `P1` 的 `6,716` tokens 高出 **`+87.25%`**）。
   - 其机理在于：当系统提示词明确告知模型“如果你不输出 `dsh-result-summary` 围栏，宿主会在步边界自动截断超长输出并自动丢弃失败调用”，同时警告“若 `replace` 摘要超过 `outputChars` 的 30% 将被严厉拒收”时，具备强推理能力的模型会作出理性的**风险规避与搭便车决策（Moral Hazard）**——既然写围栏有被拒收的风险且后台会自动兜底，最优策略就是不写围栏。

2. **`P3_Streamlined_DecisionTree` 对轻量模型的结构化赋能**：
   - 在移除所有后台自动兜底披露与拒收恐吓、改为正向“三步决策树（Step 1 Failed $\to$ `discard`；Step 2 Log $\to$ `truncate`；Step 3 Read $\to$ `replace`）”及 Function-Calling 共发指令后，**`P3` 在无 Nudge 状态下使 `ds4.1f` 与 `Gemini 4` 双双实现 `100.0%`（`3/3`）主动压缩率**，将 `11,196` 字符的原始载荷分别压缩至 `984` 字符（**`91.21%` 压缩率**）与 `713` 字符（**`93.63%` 压缩率**），且关键信息召回率均达 **`3/3`（`100%`）**。

3. **模型代际自适应提示词策略（`P4_Ultra_Minimal` 的启示）**：
   - 极简版 `P4`（仅 `227` 字符）在轻量模型 `ds4.1f` 无 Nudge 时完全失效（`0.0%`），但在配合单步 Nudge（`P4 + Nudge=true`）时取得 `ds4.1f` 全场最低的总计费开销（**`8,798` tokens**，压缩率 `64.97%`）。而对于前沿旗舰模型 **`Gemini 4`**，极简版 `P4` 在无 Nudge 时即达成 **`100.0%`（`3/3`）压缩率**、**`86.05%` 载荷压缩**与 **`3/3` 满额召回**，总计费 Token 低至 **`6,442` tokens**（较 `P3` 的 `9,086` tokens 进一步节省 **`29.10%`**）。

---

## 7. 实验四：标准模式 vs. OSWYN 智力水平与能力边界实证测试（“刚刚好答得出”与“刚刚好答不出”题集对比）

### 7.1 实验动机与能力边界基准测试集（`B1`–`B11`）构造

一个上下文压缩系统无论节省多少 Token，如果以牺牲模型的推理精度与解题智商（Intelligence Degradation）为代价，在工程上都是不可接受的。为了严格检验 **Standard（无压缩基线）** 与 **OSWYN（Only See What You Need）** 在模型能力极限处的表现差异，我们从 LiveCodeBench、BBH（BIG-Bench Hard）、GSM-Hard、SWE-bench 与 AIME 中精选并改编了 **11 道多步工具交互与精确数值求解题（`B1`–`B11`）**，每道题均要求模型通过 2–4 步 `read`/`bash` 工具调用读取含大量噪声的代码与测试崩溃日志，并在最后一步计算出唯一确定的整数解（`FINAL_ANSWER: <number>`，容差为 0）：

- **象限 I：目标明确的常规能力边界题（“刚刚好答得出”，`B1`–`B6`, `B8` 共 7 题）**：
  - **`B1_VM_Bytecode_Trace`**（LiveCodeBench / BBH-Execution）：16 位字节码虚拟机 4 步状态追踪（含 `OP_ADD_SCALE`、位异或 `OP_XOR_MASK = 73`、条件陷阱回滚 `TRAP_THRESHOLD = 150` 与模 16 提交，精确解 `197`）。该题恰好处于 `ds4.1f` 原生基线 `2/3`（`66.7%`）概率算对的临界点。
  - **`B2_Tiered_Tax_Ledger`**（GSM-Hard 财务核算）：阶梯返利（`-15%`）、跨境附加费（`+260`）与超阈值双倍回拨惩罚核算（精确解 `4079`）。
  - **`B3_ABA_Epoch_Bug`**（SWE-bench 并发调试）：无锁 Treiber 栈 5-bit 代际计数器溢出 `(28 + 9) & 0x1F` 与内存回收崩溃评分（精确解 `77`）。
  - **`B4_DAG_Critical_Path`**（BBH 图调度）：互斥锁争用惩罚（`+16 ms`）下的有向无环图（DAG）关键路径耗时计算（精确解 `107`）。
  - **`B5_Shadowed_Config_Maze`**（LongBench-Code 长上下文噪声迷宫）：在 **21,924 字符**、包含上百个同名 `LEGACY`/`CANARY`/`STAGING` 影子常量的 4 步日志迷宫中提取唯一活跃生产参数计算配额（精确解 `1129`）。
  - **`B6_Silent_Checksum_Drift`**（SWE-bench 隐式类型转换）：诊断 JavaScript 字符串 `"19"` 拼接导致校验和变为 `"18419"` 的隐式类型强制转换 Bug 并重算位异或结果 `(148 + 36 + 19) ^ 317`（精确解 `502`）。
  - **`B8_Coupled_Modular_CRT`**（ProjectEuler 同余耦合）：求解区间 $[100, 900]$ 内满足 $x \equiv 17 \pmod{23}$ 且 $x \equiv 29 \pmod{37}$ 的唯一根 $x = 361$ 并计算 `(361 * 13) ^ 219`（精确解 `4793`）。
- **象限 II：跨步延迟绑定细节与循环体复用陷阱（检验有损压缩边界与 `tool_result_recall` 恢复，`B7`, `B10` 共 2 题）**：
  - **`B7_Late_Bound_Key_Slot`**（延迟绑定细节陷阱）：Step 1 读取包含 40 个槽位（`SBOX_SLOT_00` 至 `SBOX_SLOT_39`）的密码学 S-Box 表，但 Step 1 指令仅要求核对 `SBOX_SLOT_00`（`84`）；直到 Step 2 运行单元测试报错后，才突然揭晓差分碰撞发生在 **`SBOX_SLOT_27`（`419`）与 `SBOX_SLOT_31`（`265`）** 之间，要求计算两者之和（精确解 `684`）。若模型在 Step 1 使用 `replace` 或 `truncate` 丢弃了后续槽位且无回溯手段，Step 2 将彻底丢失数据源！
  - **`B10_MultiReg_Bitwise_Pipeline`**（无提示四寄存器非线性位运算流水线）：Step 1 定义四寄存器 `(A=45, B=29, C=78, D=19)` 与 4 行非线性位异或反馈函数 `stepRound(state, r)` 并执行 `r=1, 2`；Step 2 触发 DMA 中断修改 `A` 和 `C`；Step 3 要求对中断后状态**再执行一轮 `stepRound(state, r=3)`** 并输出 `A*100 + B*10 + C + D`（精确解 `369`）。若模型在 Step 1 仅把 `r=1, 2` 的计算结果写入摘要而丢弃了 `stepRound` 的原始代码定义，在 Step 3 就会因缺乏函数体而无法执行 `r=3`！
- **象限 III：无公式提示的 60 线程噪声盲扫题（“未知的未知 Unknown Unknowns”，`B9`）**：
  - **`B9_Implicit_Bug_Noise_Maze`**：在 **14,280 字符**的 3 个模块与 60 个工作线程（`worker_00`–`worker_59`）状态转储中，不给任何公式或变量名提示，要求自主识别唯一活跃主线程 `worker_17` 并联立 `rate-limiter.ts` 中的 `/ 250` 时钟偏置向下取整公式与 `clock-sync.ts` 的超限双倍折返公式（精确解 `676`）。
- **象限 IV：超出 `ds4.1f` 单步心算极限的高难数论题（“刚刚好答不出 / 算力天花板边缘”，`B11`）**：
  - **`B11_AIME_Cubic_CRT_Coprime`**（AIME-Hard 数论筛法）：求区间 $1 \le n \le 200$ 内同时满足 $105 \mid (n^3 + 7n^2 + 14n + 8)$ 且 $\gcd(n+3, 42) = 1$ 的正整数集合 $S$ 的元素个数 $|S|$ 与最大值 $\max(S)$，输出 `|S| * 1000 + max(S)`。该题需先因式分解为 $(n+1)(n+2)(n+4)$，在模 $210$ 环上用中国剩余定理算出每个周期有 $1 \times 2 \times 3 \times 3 = 18$ 个解，**还必须精细排查发现在收尾区间 $[201, 210]$ 内恰好落入 `206` 和 `208` 两个解**，从而得出 $[1, 200]$ 内 $|S| = 18 - 2 = 16$ 且最大解为 $\max(S) = 194$（精确解 `16194`）。在 `ds4.1f` 原生无压缩基线下，该题通过率仅为 **`1/3`（`33.3%`）**，属于典型的“刚刚好游走在答不出边界”的算力极限题。

### 7.2 实验四完整实测数据矩阵（`N = 110` 次真实会话）

下图与表 6 展示了 `B1`–`B11` 共 11 道能力边界题在四路配置下的完整实测结果（原始数据见 [`benchmarks/exp4-intelligence-boundary-results.json`](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/benchmarks/exp4-intelligence-boundary-results.json)）：

![标准模式 vs. OSWYN 智力水平与能力边界实测对比](file:///Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/paper/intelligence-boundary-comparison.svg)

| 题目编号与名称 | 能力边界象限分类 | 标准答案 | `Standard_Baseline` (`ds4.1f` 无压缩) 通过率 / 均耗 Token | `OSWYN_Standard` (`ds4.1f` 无 Recall) 通过率 / 压缩率 / 均耗 Token | `OSWYN_With_Recall` (`ds4.1f` 含 Recall) 通过率 / 压缩率 / Recall 次数 | `Gemini4_OSWYN_Ref` (`Gemini 4` 含 OSWYN) 通过率 / 压缩率 / 均耗 Token |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`B1_VM_Bytecode_Trace`** | 象限 I: 刚刚好答得出 (VM追踪) | `197` | **2/3 (66.7%)** / 10,702 tok | **3/3 (100.0%)** / 79.80% / 10,997 tok | **3/3 (100.0%)** / 90.58% / 0 次 | **1/1 (100.0%)** / 93.68% / 11,680 tok |
| **`B2_Tiered_Tax_Ledger`** | 象限 I: 刚刚好答得出 (GSM-Hard) | `4079` | **3/3 (100.0%)** / 9,048 tok | **3/3 (100.0%)** / 77.06% / 10,959 tok | **3/3 (100.0%)** / 90.39% / 0 次 | **1/1 (100.0%)** / 91.64% / 10,603 tok |
| **`B3_ABA_Epoch_Bug`** | 象限 I: 刚刚好答得出 (并发位掩码) | `77` | **3/3 (100.0%)** / 7,298 tok | **3/3 (100.0%)** / 65.69% / 9,907 tok | **3/3 (100.0%)** / 65.10% / 0 次 | **1/1 (100.0%)** / 91.55% / 9,910 tok |
| **`B4_DAG_Critical_Path`** | 象限 I: 刚刚好答得出 (BBH调度) | `107` | **3/3 (100.0%)** / 8,180 tok | **3/3 (100.0%)** / 79.10% / 10,173 tok | **3/3 (100.0%)** / 77.03% / 0 次 | **1/1 (100.0%)** / 91.62% / 9,925 tok |
| **`B5_Shadowed_Config_Maze`** | 象限 I: 长上下文同名影子噪声迷宫 | `1129` | **3/3 (100.0%)** / 23,237 tok | **3/3 (100.0%)** / **84.53%** / **18,882 tok (-18.7%)** | **3/3 (100.0%)** / 75.61% / 0 次 | **1/1 (100.0%)** / 92.19% / 17,265 tok |
| **`B6_Silent_Checksum_Drift`** | 象限 I: 隐式类型转换+位异或 | `502` | **3/3 (100.0%)** / 10,113 tok | **3/3 (100.0%)** / 77.88% / 11,366 tok | 2/3 (66.7%) / 88.86% / 0 次 | **1/1 (100.0%)** / 92.45% / 11,071 tok |
| **`B8_Coupled_Modular_CRT`** | 象限 I: 中国剩余定理+位异或 | `4793` | **3/3 (100.0%)** / 4,223 tok | **3/3 (100.0%)** / 78.26% / 7,167 tok | **3/3 (100.0%)** / 63.46% / 0 次 | **1/1 (100.0%)** / 90.37% / 6,877 tok |
| **`B7_Late_Bound_Key_Slot`** | **象限 II: 延迟绑定槽位回查陷阱** | `684` | **3/3 (100.0%)** / 3,329 tok | **0/3 (0.0%)** / 76.46% / 5,628 tok | **3/3 (100.0%)** / **82.51%** / **3/3 次 Recall** | **1/1 (100.0%)** / 89.79% / **1/1 次 Recall** |
| **`B10_MultiReg_Bitwise_Pipeline`** | **象限 II: 跨步复用四寄存器循环体** | `369` | **3/3 (100.0%)** / 9,119 tok | **1/3 (33.3%)** / 65.68% / 10,125 tok | **3/3 (100.0%)** / **89.10%** / **3/3 次 Recall** | **1/1 (100.0%)** / 86.60% / 0 次 (摘要保留) |
| **`B9_Implicit_Bug_Noise_Maze`** | **象限 III: 60线程无提示隐式除数** | `676` | **3/3 (100.0%)** / 11,851 tok | **2/3 (66.7%)** / 54.96% / 13,094 tok | **2/3 (66.7%)** / 64.28% / **1/3 次 Recall** | **1/1 (100.0%)** / 93.21% / 13,131 tok |
| **`B11_AIME_Cubic_CRT_Coprime`** | **象限 IV: 算力极限三次同余互质筛** | `16194` | **1/3 (33.3%)** / 5,466 tok | **0/3 (0.0%)** / 61.21% / 10,169 tok | **0/3 (0.0%)** / 63.89% / 0 次 | **1/1 (100.0%)** / 89.72% / 9,124 tok |
| **象限 I 小计 (`B1`–`B6`, `B8`)** | **常规能力边界题 (21 轮/组)** | — | **20/21 (95.2%)** | **21/21 (100.0%, +4.8%)** | **20/21 (95.2%)** | **7/7 (100.0%)** |
| **象限 II 小计 (`B7`, `B10`)** | **延迟细节回查陷阱 (6 轮/组)** | — | **6/6 (100.0%)** | **1/6 (16.7%, -83.3%)** | **6/6 (100.0%, 满血恢复)** | **2/2 (100.0%)** |
| **全部 11 题总计 (`B1`–`B11`)** | **全谱系能力边界汇总 (33 轮/组)** | — | **30/33 (90.9%)** / 0% 压缩 | **24/33 (72.7%)** / 72.79% 压缩 | **28/33 (84.8%)** / 77.35% 压缩 | **11/11 (100.0%)** / 91.17% 压缩 |

### 7.3 关于“OSWYN 是否导致智力下降”的四项严谨实证结论

依据表 6 的 110 次真实会话实验数据，我们可以对“Only See What You Need 与标准模式的能力区别及智力变化”给出毫无水分、层次分明的科学结论：

1. **在目标明确的常规能力边界题（象限 I：`B1`–`B6`, `B8`）上，OSWYN 不仅实现“零智力下降”，反而通过“步间结构化思维外化（Step-Boundary Scratchpad）”提升了多步状态追踪精度**：
   - 在 `B1`–`B6` 与 `B8` 共 7 道题（每组 21 次试验）上，`OSWYN_Standard` 取得了 **`21/21`（`100.0%`）的满分通过率**，甚至略高于 `Standard_Baseline` 的 **`20/21`（`95.2%`）**，同时将常驻工具载荷平均压缩了 **`77.47%`**。
   - 典型案例是 **`B1_VM_Bytecode_Trace`**：在未压缩的 `Standard_Baseline` 下，`ds4.1f` 面对混杂在 130 余行废弃操作码表与报错堆栈中的 4 步寄存器更新规则，3 次试验中有 1 次（Trial 2）在最后一步心算中间状态时发生寄存器混淆，通过率仅为 **`2/3`（`66.7%`）**；而在启用 `OSWYN_Standard` 与 `OSWYN_With_Recall` 后，模型在每一步撰写 `dsh-result-summary` 时被迫将当前步提取的初始值（`INIT_R0=120, INIT_R1=35`）、掩码（`MASK_CONST=73, TRAP_THRESHOLD=150`）与回滚公式显式提炼成 2 行高密度笔记，在全部 **6/6 次试验中均 100% 算出了精确解 `197`（`3/3` 与 `3/3`）**。
   - 在 **`B5_Shadowed_Config_Maze`**（累计 `21,924` 字符的同名影子常量迷宫）中，`OSWYN_Standard` 在保持 **`3/3`（`100.0%`）准确率**的同时，将载荷净压缩 **`84.53%`**（从 `21,924` 字符压至平均 `3,390` 字符），使单题平均总计费 Token 从 `Standard_Baseline` 的 **`23,237` tokens 直接降至 `18,882` tokens（净节省 `18.74%`）**。

2. **揭示单向有损压缩的真实短板（象限 II：`B7`, `B10`）——“跨步延迟绑定细节丢失”，并证明 `tool_result_recall` 能实现 100% 闭环修复**：
   - 实验四精准定位了纯单向压缩（`OSWYN_Standard`，不挂载回溯工具）导致解题能力下降的核心场景：**当第 $k$ 步读取的某份文件/表包含大量当时看似无关的细节，而第 $k+m$ 步因新暴露的报错突然需要回查第 $k$ 步被截断/替换掉的具体行或原始函数体时，单向压缩会发生不可逆的信息断链**。
   - 在 **`B7_Late_Bound_Key_Slot`** 中，Step 1 仅要求验证 `SBOX_SLOT_00`，`OSWYN_Standard` 将 40 行 S-Box 表压缩为仅含 `SBOX_SLOT_00 = 84` 的 1 行摘要（压缩率 `76.46%`）；当 Step 2 突然要求计算 `SBOX_SLOT_27 + SBOX_SLOT_31` 时，`OSWYN_Standard` 因无法看到已被替换的槽位，准确率从基线的 **`3/3`（`100.0%`）暴跌至 `0/3`（`0.0%`）**。同理，在 **`B10_MultiReg_Bitwise_Pipeline`** 中，`OSWYN_Standard` 有 2/3 的轮次在 Step 1 仅记录了 `r=1, 2` 的运算结果而未保留 `stepRound` 的 4 行原始公式，导致 Step 3 要求执行 `r=3` 时准确率跌至 **`1/3`（`33.3%`）**。
   - 然而，一旦启用 OSWYN 架构内置的 **`tool_result_recall` 工具（`OSWYN_With_Recall`）**，情况发生根本逆转：在 `B7` 的全部 **3/3 轮**以及 `B10` 的全部 **3/3 轮**中，`ds4.1f` 在最后一步均精准识别出所需槽位或循环体已被前序步骤折叠，**100% 自主调用了 `tool_result_recall(call_id="c1")`** 从 `@deepseek-ai/dsh-session` 底层事件日志中无损取回 Step 1 的原始文本，使 `B7` 与 `B10` 的解题准确率从 **`1/6`（`16.7%`）满血恢复至 `6/6`（`100.0%`）**，同时依然保有 **`82.51%`（`B7`）与 `89.10%`（`B10`）** 的终局常驻载荷压缩率！这一对比严密证明：**`tool_result_recall` 并非可选附件，而是保障 OSWYN 在探索性代码审计中“智力不降级”的必备安全阀**。

3. **诊断轻量模型在极限盲扫与算力天花板处的两类轻微退化机理（象限 III `B9` 与象限 IV `B11`）**：
   - 即使启用了 `tool_result_recall`，`OSWYN_With_Recall` 在全部 11 题上的总通过率（`28/33 = 84.8%`）仍比完全不压缩的 `Standard_Baseline`（`30/33 = 90.9%`）低 `6.1` 个百分点（相差 2 个轮次：1 轮在 `B9`，1 轮在 `B11`）。剖析原始轨迹揭示了两类深层机理：
     1. **“未知的未知（Unknown Unknowns）”漏摘风险（`B9_Implicit_Bug_Noise_Maze`）**：在 `B9` 中，由于 Step 1 没有任何提示词告知模型将来需要哪个函数，`ds4.1f` 在 1/3 的轮次中将 `applyBurstWindow` 概括成了定性描述（遗漏了 `Math.floor(effectiveSkewMs / 250)` 中的 `/ 250` 除数），且在 Step 3 误以为自己的摘要已包含完整公式而未触发 `tool_result_recall`（而在触发了 `tool_result_recall` 的 Trial 3 中则成功算对 `676`，且 `Standard_Baseline` 对 `read` 保护不截断故 `3/3` 全对）。这直接印证了 `dsh-oswyn` 默认将 `read` 列入 `autoCompressTieredProtectedTools` 并建议模型对未读懂的源码文件优先使用 `truncate` 而非盲目 `replace` 的必要性。
     2. **算力极限处的“双任务认知挤占（Dual-Task Cognitive Tax）”（`B11_AIME_Cubic_CRT_Coprime`）**：在 `B11` 这道高难数论题上，`ds4.1f` 本身已处于能力天花板极限——`Standard_Baseline` 3 次试验中仅有 1 次（Trial 1，耗费 `3,875` completion tokens）成功注意到了 $[201, 210]$ 区间内需要剔除 `206` 和 `208` 两个解从而算出 `16194`（通过率 **`1/3 = 33.3%`**）。当启用 OSWYN 时，模型在 Step 2 需要一边生成 `dsh-result-summary` 压缩围栏、一边进行 4 素数模同余枚举与边界剔除，这种**双任务注意力分流**使原本就只有 `33.3%` 成功率的脆弱推导链条在 3 次试验中均在最后一步边界计数（误算为 `18` 个解或 `15` 个解）上出现偏差（`0/3 = 0.0%`）。
   - 与之形成鲜明对比的是，当基座模型升级为前沿旗舰 **`Gemini 4`（`Gemini4_OSWYN_Ref`）** 时，其充足的推理带宽完全消除了上述两类边界损耗，在 `B1`–`B11` 全部 11 道题上实现了 **`11/11`（`100.0%`）满分通过率**与 **`91.17%` 的平均工具载荷压缩率**。

---

## 8. 核心实证结论与工程部署准则

综合上述四项真实会话实验（累计超过 150 组多步真实网关会话）的严格定量结果，本文得出以下核心结论与工程部署准则：

1. **内联步间微蒸馏（`dsh-oswyn`）全面优于外部代理区间宏折叠（`billion-context`）**：
   - 在 15 步连续 SWE 会话中，`OSWYN-Standard` 相比未管理基线削减了 **`42.99%` 的累计上行 Prompt Tokens** 与 **`38.83%` 的总计费 Tokens（`207,708 -> 127,054`）**，将第 15 步单步上行体积降低 **`53.98%`（`21,445 -> 9,868` tokens）**，常驻工具载荷净压缩 **`72.66%`**（`OSWYN-PTC` 达 **`78.09%`**），同时保持终局 4 项核心常量 **`100%`（`4/4`）** 精确召回。
   - 原版 `billion-context@0.1.211`（`bc`）虽能降低总上行 Token（`-27.60%`），但其代理侧区间替换频繁破坏 KV-Cache 前缀连续性，导致未缓存的新鲜上行 Token（`51,439`）比不压缩基线（`42,507`）反增 **`+21.01%`**，且粗粒度区间折叠抹除了早期配置常量（召回率 `0/7`）。在 `ds4.1f` 上禁止将 `dsh-oswyn` 与 `billion-context` 简单叠加（`Synergy`），以免引发双协议竞争干扰（主动意愿从 `78.6%` 暴跌至 `28.6%`）。

2. **任务难度与模型代际决定主动压缩意愿，必须实施“代际分治”触发策略**：
   - **前沿旗舰与推理模型（`Kimi 3.1 Pro`、`Hunyuan 4`、`Gemini 4`）**：在原生 Function Calling 激活时具备 **100%（`9/9`）的自发双通道共发能力**，跨越 L1/L2/L3 全难度梯度均无空文本模态抢占，在中高难度任务上自发实现 **`87.81%–93.57%`** 的工具载荷净压缩与 **100% 信息召回**。
   - **轻量级 Flash 模型（`DeepSeek 4.1 Flash`）**：受限于工具调用模态抢占（无提醒时中间工具步 100% 输出 `replyChars = 0`），其自发压缩意愿仅为 **`22.2%`（`2/9`）**；通过注入 `<system-reminder>` 单步动态提醒（Nudge），其主动意愿跃升至 **`77.8%`（`7/9`）**，并在高认知负荷峰值步（如定位并发 Bug 的 `H3_ReadStripeLock`）由后台自动兜底策略（`runAllAutoPolicies`）无缝接管。

3. **系统提示词的信息隐藏原则（Information Hiding Against Moral Hazard）**：
   - **严禁在系统提示词中向模型披露后台自动截断/丢弃兜底机制或渲染严厉拒收惩罚（如 `P2`）**：实验三严格证明，披露后台兜底会诱发模型（无论 `ds4.1f` 还是 `Gemini 4`）产生搭便车心理与拒收规避瘫痪，使主动压缩意愿直接归零（`0.0%`）。前景提示词应采用正向三步决策树与双通道共发契约（`P3`），后台自动兜底则作为静默安全网运行于宿主内核。

4. **智力保持度与能力边界准则：以 `tool_result_recall` 闭环消除有损压缩盲区，对核心源码慎用激进 `replace`**：
   - **常规与噪声推理零智损**：在目标明确的工程调试与多步推理任务（`B1`–`B6`, `B8`）中，OSWYN 不仅完全不降低模型智力（`21/21 = 100.0%` vs. 基线 `20/21 = 95.2%`），反而借助步间摘要的结构化笔记效应提升了多步状态追踪稳定性（如 `B1` 从 `66.7%` 提升至 `100.0%`）。
   - **必须常驻开启 `tool_result_recall`**：面对跨步延迟绑定细节（`B7`）或后续步骤需重新调用前序函数实现（`B10`）的场景，纯单向有损压缩会使准确率跌至 `16.7%`（`1/6`），而挂载 `tool_result_recall` 后模型可 100% 自主按需回溯原始工具输出，使准确率恢复至 **`100.0%`（`6/6`）**。
   - **代码读取（`read`）与算力极限任务的保护策略**：针对尚未明确后续调用关系的源码读取（如 `B9`），应保持 `read` 工具在 `autoCompressTieredProtectedTools` 中的默认受保护地位，并在提示词中引导模型保留精确数学公式/常量字面量；而当轻量模型处于自身算力极限（如 `B11` AIME 高难数论题）时，应允许模型在终局高难推理步免写围栏，将全部生成带宽集中于核心逻辑求解。
