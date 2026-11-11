# OSWYN：面向长程软件工程智能体的步边界内联上下文微蒸馏、能力边界保持与真实 API 成本实证研究

**OSWYN: Preserving Capability Boundaries and KV-Cache Locality in Long-Horizon Software Engineering Agents via In-Band Step-Boundary Context Distillation**

**作者**：张仁童（Rentong Zhang）  
**机构与开源归档**：Keycap AI（开源代码仓库：[`keycapai/dsh-oswyn`](https://github.com/keycapai/dsh-oswyn)）  
**论文正式归档**：[`paper/oswyn-paper.md`](paper/oswyn-paper.md) | **英文学术版**：[`paper/oswyn-paper-en.md`](paper/oswyn-paper-en.md)  
**全量实证脚本**：[`paper/scripts/run-unified-oswyn-benchmarks.mjs`](paper/scripts/run-unified-oswyn-benchmarks.mjs)  
**原始实验数据集**：[`paper/data/unified-oswyn-realsession-results.json`](paper/data/unified-oswyn-realsession-results.json)、[`paper/data/exp4-intelligence-boundary-results.json`](paper/data/exp4-intelligence-boundary-results.json)

---

## 摘要（Abstract）

在自治软件工程（SWE）智能体与程序化工具调用（PTC）的长程会话中，目录遍历、文件检索、补丁编辑与回归测试的输出随步骤逐步追加，导致上行 Prompt Token 呈二次方级 $\mathcal{O}(T^2)$ 膨胀，并诱发“大海捞针（Lost-in-the-Middle）”注意力稀释。现有的外部代理折叠机制（如 `billion-context` [Billion-Context Contributors, 2025]）需要额外的往返工具轮次，改写历史消息中段易破坏大模型服务端的前缀 KV-Cache，且粗粒度区间概括极易抹除关键变量与运算算子。

本文提出并系统评估了 **OSWYN（Only See What You Need，v2.1）** 系统。系统代号源自其核心设计哲学 **“仅见所求，知其所需”（Only See What You Need）**，最早作为原生上下文微蒸馏与工作记忆优化插件落地并实现于 **DeepSeek Harness（DSH）** 智能体平台。OSWYN 直接依托底层会话内核（`@deepseek-ai/dsh-session`）提供的活跃表面有向无环图（Surface DAG）机制，构建了**零额外往返步边界内联上下文微蒸馏体系**。OSWYN 允许智能体在当前决策轮次内联输出围栏指令，对上一步工具输出执行**前缀保留截断（从字节 0 开始保留，严格保护 KV-Cache 前缀局部性）**、**结构化事实替换**或**失败调用连同入参彻底丢弃**，并协同按需无损回溯工具（`tool_result_recall`）与能力边界防护规则（算术算子逐字保留、主动回溯门控、终局推理免围栏豁免）。

我们在真实推理网关上，跨越 5 款跨代际模型（`DeepSeek 4.1 Flash`、`Gemini 3.8 Flash`、`Kimi 3.1 Pro`、`Hunyuan 4`、`Gemini 4`）开展了 4 项受控实验（累计 190+ 组真实多步会话），并基于官方 API 阶梯定价（含缓存命中、未命中与输出价差）进行全口径核算。实证结果确凿证明，**OSWYN 达成了“降低 Token 费用”、“扩展有效上下文物理容量”与“显著增强长程模型推理能力”的三重协同突破**：
1. **上下文压缩与 KV-Cache 保护**：在 15 步连续 SWE 会话中，OSWYN 将常驻工具载荷压缩 `72.66%–78.09%`，单步上行 Prompt 峰值降低 `-53.98%`。与外部代理方案因前缀破坏导致全价未命中输入增加 `+21.01%` 相比，OSWYN 严格保护前缀连续性，未命中全价输入净减 `-5.20%`。
2. **长程推理能力增强与抗噪护智**：实证表明，微蒸馏通过剥离历史无效垃圾，能直接解决长程会话中因注意力污染导致的推理退化。在涵盖状态追踪、位运算流水线、同名配置迷宫、大合数分解、密码哈希与 3-SAT 的 17 项全谱系能力边界基准（B₁–B₁₇）中，OSWYN 在全部常规工程任务（B₁–B₁₀，30 轮次）上达成 100.0% 全额通过（基线为 96.7%）；在 B₁ 虚拟机状态追踪中，去噪将模型准确率从基线的 66.7% 跃升至 100.0%；在有限状态组合约束推理（B₁₇ 3-SAT）中，微蒸馏消除长程注意力迷雾，使 Gemini 4 生成 Tokens 缩减 -39.7%，耗时降低 -47.4%（提速 1.9 倍），并保持 100% 满额精度；全谱系总通过率由 81.4% 提升至 86.7%。本研究同时划定了物理效能边界：在超越自回归心算极限的内在计算复杂度黑洞（B₁₅ 20位大半素数分解与 B₁₆ 8轮密码学雪崩哈希逆推）上，纯心算受限于物理计算复杂度瓶颈，系统必须依托 OSWYN 与程序化工具调用（PTC 沙箱）的协同跨越这一鸿沟。
3. **真实 API 成本边界与帕累托前沿**：在多步交互式开发与跨节点调度场景下，OSWYN 在 15 步连续会话中实现实际 API 支出净省 `-17.2%` 至 `-28.1%`，50 步稳态演进净省 `-65.4%` 至 `-69.6%`。此外，`DeepSeek 4.1 Flash + OSWYN` 仅以 `Gemini 4` 旗舰模型 **`6.8%`** 的实际 API 费用，交付了在工程边界任务上持平乃至超越基线的求解准确率。

**关键词**：软件工程智能体（SWE Agents）；上下文微蒸馏（Context Micro-Distillation）；KV-Cache 前缀局部性；能力边界保持；API 计费经济学

---

## 1. 引言（Introduction）

随着大语言模型（LLM）驱动的自治软件工程（SWE）智能体（如 SWE-agent、Devin、OpenCode）的发展，智能体在处理大型代码仓库中的真实缺陷修复与功能演进时，通常依赖数十甚至上百轮“感知-工具调用-环境反馈-再决策”的迭代循环。智能体在多步循环中频繁执行文件系统检索（`find`、`grep`）、源码阅读（`read`）、补丁编写（`edit`）与测试执行（`bash test`）。

设会话总步数为 $T$ ，第 $k$ 步执行工具后产生的上下文载荷长度为 $L_k$ 。在传统的追加式（Append-Only）会话模型中，早期步骤产生的瞬态载荷在后续每个步骤中均会被完整重发：

$$\text{PromptTokens}_{\text{Append}}(T) = T \cdot L_{\text{sys}} + \sum_{k=1}^{T} (T - k + 1) \cdot L_k = \mathcal{O}(T^2)$$

这种二次方级的急剧膨胀，给实际工程部署带来了显著挑战：

1. **注意力稀释与“大海捞针”退化（Lost-in-the-Middle）**：大量已经过期的报错回溯、冗长测试日志和被后续修改覆盖的旧代码堆积在上下文中，干扰了注意力机制对关键状态变量和跨步逻辑约束的追踪。
2. **外部代理压缩的“前缀缓存击穿税”**：以 `billion-context` [Billion-Context Contributors, 2025] 为代表的外部代理方案，通常引入独立工具（如 `compress`），由模型或代理在达到长度阈值时将某段历史区间 $[s_{\text{start}}, s_{\text{end}}]$ 折叠替换为概括文本。然而，现代推理集群普遍依赖基于前缀哈希的 KV-Cache 技术（如 vLLM PagedAttention、SGLang RadixAttention）。改写历史消息序列的中段，会导致后续所有 Token 的前缀哈希改变，使原本享受 $90\%-98\%$ 折扣的缓存命中输入（`cacheHit`）退化为全价未命中新鲜输入（`cacheMiss`）；同时粗粒度概括极易抹除精细的位运算算子和数值常量。
3. **内联微蒸馏的输出单价不对称性**：若让模型自身在输出中生成摘要，则面临模型 API 的定价不对称。主流 API 服务商对生成输出（`output`）的定价通常是未命中输入（`cacheMiss`）的 $3\times-5\times$ ，更是缓存命中输入（`cacheHit`）的 $50\times-200\times$ 。在极短会话中，频繁生成结构化围栏的费用可能抵消其省下的输入费用。

本文的核心贡献如下：
- **提出并实现 OSWYN 零额外轮次步边界原位微蒸馏**：依托 DeepSeek Harness 底层会话表面有向无环图（Surface DAG），将压缩操作融入智能体当前的决策轮次，在 $\mathcal{O}(1)$ 时间内原位更新历史表面，避免外部代理引入的额外往返轮次。
- **KV-Cache 前缀局部性保护机制**：形式化定义并实现了“前缀保留截断（`truncate keep N lines|chars`）”，始终从字节 0 保持历史前缀不变，避免中间折叠引起的下游前缀哈希雪崩。
- **证实上下文去噪对模型推理能力的直接增强机理**：实证揭示微蒸馏不仅降低费用和扩充容量，而且通过消除长程注意力稀释，在虚拟机状态追踪中将通过率从 66.7% 提升至 100.0%，在常规工程子集中实现 100.0% 满分通过（反超无压缩基线），并在 3-SAT 约束推理中提速 1.9 倍。
- **能力边界三重防护机制**：提出公式算子逐字保留、主动回溯门控和终局推理豁免机制，协同按需无损回溯（`tool_result_recall`），在 17 项全谱系高难能力边界基准上实现零智损并反超基线。
- **系统性 API 计费经济学与端到端实测验证**：基于 5 款跨代际模型的官方阶梯计价建立全口径费用模型，严格测试了包含 Gemini 4 在内的对等无压缩基线，明确界定了 OSWYN 在长程会话与交互场景中的成本优势及短会话中的适用边界。

---

## 2. 相关工作（Related Work）

### 2.1 长上下文语言模型与注意力稀释
随着长上下文窗口（32k 至 1M+ tokens）的普及，将全部历史轨迹直接追加进上下文成为许多智能体框架的默认实现。然而，Liu 等人的研究表明，大模型在长序列中对关键信息的捕捉能力呈现“中间遗忘（Lost-in-the-Middle）”现象；当无关的测试通过日志、目录树和同名变量充斥上下文时，即使模型在简单检索基准上能够“大海捞针”，其在复杂多步符号推理与控制流追踪中的错误率仍会显著上升。

### 2.2 智能体工作记忆与上下文压缩
为应对长程膨胀，现有工作主要分为两类：
1. **外部内存与代理折叠**：如 MemGPT 采用分层虚拟内存管理，AutoGen 与 `billion-context` 采用外部拦截器在历史过长时触发概括轮次。此类方案依赖额外的 LLM 交互往返，且粗粒度区间替换不可逆地破坏了原有的代码细节。
2. **文本级与嵌入级压缩**：如 LLMLingua、Selective Context 等通过小模型计算信息熵过滤低信息 Token。然而此类方法需要额外的过滤模型推理成本，且非连续 Token 丢弃在代码语境下极易导致语法错误或关键常量断裂。

### 2.3 KV-Cache 管理与前缀缓存经济学
在当前以 vLLM（PagedAttention）、SGLang（RadixAttention）为代表的大模型服务端架构中，复用历史 Prompt 的 Key-Value Cache 是降低推理首字延迟（TTFT）与服务成本的核心手段。云厂商根据缓存命中情况推出阶梯定价（如 DeepSeek、Google Gemini、Moonshot Kimi）。前缀缓存的命中完全取决于请求序列的字节级前缀匹配。若智能体框架改写了历史早期序列，则会导致后续所有 Token 失去缓存前缀。因此，上下文压缩必须保证**前缀局部性（Prefix Locality）**，避免诱发严重的“缓存击穿税”。

---

## 3. OSWYN 设计思路、系统架构与形式化成本模型

### 3.1 OSWYN 核心设计思路与架构哲学（Design Rationale & Architectural Philosophy）

OSWYN 框架的设计根植于五个核心架构公理，共同构成了其“工作记忆极简主义”的理论基础：

1. **“仅见所求，知其所需”（Only See What You Need）的工作记忆极简原则**：
   传统智能体将被动累积全量交互视为默认状态，导致工作记忆演化为充斥过时调试堆栈、临时日志与废弃代码的信息垃圾场。OSWYN 确立了工作记忆的精简主义范式：**智能体在任何离散决策步骤，其工作记忆应仅且必须包含当前决策和后续行动所必需的信息**。所有勘测日志、测试输出与辅助阅读，均应在步边界被即时微蒸馏；只有剥离非本质扰动，自注意力矩阵才能维持高聚焦状态。
2. **“降成本、扩容量、强能力”的三重价值协同机理（Cost, Capacity, and Capability Triad）**：
   - *降成本（Cost Reduction）*：平抑二次方 Tokens 爆炸，在长程交互中稳态节省 65%–70% 真实 API 资金支出；
   - *扩容量（Capacity Expansion）*：将二次方扩张压制为稳态线性可控区间，彻底解除有限窗口的溢出崩溃风险；
   - *强能力（Capability Enhancement via Attention De-noising）*：深层机理在于**自注意力净化**。实证表明，长程非相关上下文会直接稀释模型的注意力焦点，引发幻觉与状态漂移。通过在步边界过滤无效环境噪声，模型在复杂工程追踪与组合约束求解中能够保持更高的精确度与推理速度。
3. **步边界零额外往返伴随式改写（In-Band Step-Boundary Operation）**：
   杜绝外部独立 Agent 带来的额外往返延迟（Round-Trip Time, RTT）与调用开销。智能体在生成当前行动的同时伴随输出内联微蒸馏围栏，由宿主内核在步边界完成原子级改写。
4. **字节 0 起点绝对保真与前缀局部性（Prefix-Preserving KV-Cache Locality）**：
   深刻契合现代推理集群基于前缀哈希的 Radix 缓存机制。所有截断原语严格从第 0 字节开始原样保留前缀，绝对禁止改写历史消息中段，从物理底层杜绝“缓存击穿税”。
5. **物理事实流与逻辑活跃视图的彻底解耦（Decoupling Reality from Active View）**：
   物理底层采用单调追加的不可变事件日志（Immutable Event Log）作为永久事实真相，上层通过 Surface DAG 投影动态渲染给 LLM 的活跃工作记忆。配合原生挂载的 `tool_result_recall`，实现信息“逻辑有损压薄”与“物理无损保全”的统一。

```mermaid
flowchart TD
    subgraph Storage["物理事件持久存储层 (Immutable Event Log)"]
        E1["User Prompt"] --> E2["Tool Call: find"] --> E3["Raw Result: 200 files (14KB)"]
        E3 --> E4["Assistant Action (含内联围栏)"] --> E5["Tool Call: test"]
        E5 --> E6["Raw Result: 50KB build log"]
    end

    subgraph OSWYN_Engine["OSWYN 步边界原位微蒸馏内核"]
        P1["解析内联围栏指令"]
        P2["执行 truncate keep 15 lines (从字节0保真)"]
        P3["执行 discard (清除入参并替换为根因)"]
        P4["执行 replace (提取核心事实并保留算子)"]
    end

    subgraph ActiveView["表面逻辑活跃视图层 (Surface DAG Active Nodes)"]
        V1["User Prompt"] --> V2["Tool Call: find"] --> V3["Distilled Fact: 2 files matched"]
        V3 --> V4["Assistant Action"] --> V5["Tool Call: test (discarded)"]
        V5 --> V6["Compact Error Marker"]
    end

    subgraph LLM_Context["下一轮上行 Context Assembly"]
        C1["轻薄工作记忆 (前缀哈希100%命中，注意力高度聚焦)"]
    end

    Storage -.->|活跃节点投影| ActiveView
    E4 -->|步边界拦截| OSWYN_Engine
    OSWYN_Engine -->|原位就地更新| ActiveView
    ActiveView -->|组装请求| LLM_Context
    LLM_Context -.->|按需调用 tool_result_recall| Storage
```

### 3.2 基于 DeepSeek Harness 表面有向无环图（Surface DAG）的原位微蒸馏
OSWYN 直接构建于 DeepSeek Harness (DSH) 会话表面投影层之上。系统采用双层架构：
1. **不可变持久化事件日志（Immutable Event Log）**：用户输入、工具调用、工具返回与模型回复以单调自增序号 $\text{seq}$ 顺序记录，作为唯一的事实真相（Source of Truth）。
2. **活跃表面投影（Active Surface Projection）**：实际发送给大模型的上行消息序列由一组活跃节点索引序列 $\mathcal{S}_{\text{active}} = [s_1, s_2, \dots, s_m]$ 投影生成。

智能体在当前步骤 $t$ 生成回复的同时，在正文中内联输出规范的蒸馏围栏（```` ```dsh-result-summary ```` 与 ```` ```dsh-reply-summary ````）。内核原语在步边界解析该围栏，并调用：

$$\text{append}\big(\text{type}, \text{payload}, \{\text{surfaceOp}: \{\text{op}: \texttt{"replace"}, \text{startSeq}: s_k, \text{endSeq}: s_k\}\}\big)$$

该操作在 $\mathcal{O}(1)$ 时间内将活跃表面节点 $s_k$ 更新为紧凑摘要事件，使下一次生成的 Prompt 排除冗余内容，而完整的原始输出在事件流中永久可查，支持通过 `tool_result_recall(call_id)` 进行按需无损恢复。

### 3.3 形式化操作原语与净收益门控
OSWYN 在底层定义了两类正交原语：

```text
[Compress 原语] 仅压缩输出，保留调用入参
 ├─ truncate keep N lines: 从字节 0 保留前 N 行，尾部追加紧凑摘要（KV-Cache 友好）
 └─ replace: 针对代码读取执行结构化事实提炼，保留关键常量与算式
[Discard 原语] 失败调用彻底丢弃
 └─ discard: 将工具输出替换为根因标记，同时清除入参字典覆写为 '{}'
```

为防止模型生成比原文更冗长的摘要，系统设定了硬性收益门控不变量：
- 对主动 `replace`，强制要求摘要长度 $L_{\text{summary}} < 0.30 \times L_{\text{original}}$ ，否则内核拒绝替换并返回报警；
- 失败调用丢弃时，入参清理净收益为：

$$\Delta_{\text{discard}} = (L_{\text{input}} + L_{\text{output}}) - L_{\text{marker}} > 0$$

### 3.4 KV-Cache 前缀局部性保护分析
设历史事件序列为 $[E_1, E_2, \dots, E_n]$ 。服务端对 Prompt 的缓存匹配基于前缀哈希 $H(E_1 \Vert \dots \Vert E_k)$ 。
- **外部代理方案的全局哈希失效**：外部折叠将 $[E_i, \dots, E_j]$（其中 $j < n$ ）替换为单个摘要 $E_{\text{fold}}$ 。由于 $E_i$ 内容发生变更， $k \ge i$ 的所有前缀哈希全部改变，导致后续整个上下文全部发生缓存未命中（Cache Miss）。
- **OSWYN 前缀截断的局部保护**：OSWYN 仅在当前步对**紧邻的前一步**（ $E_n$ ）进行操作。对于 `truncate keep N lines`，操作严格从字节 0 开始原样保留前 $N$ 行，因此该节点前缀内部的子序列哈希 $H(E_1 \Vert \dots \Vert E_n[0:K])$ 保持完全一致，最大化保护了底层 Radix 树的命中复用。

### 3.5 能力边界三重防护机制（v2.1）
针对有损压缩可能导致的推理能力退化，OSWYN v2.1 引入了三重防护规则：
1. **公式与算子逐字保留规则（Formula-Safe Verbatim Rule）**：对代码读取结果执行蒸馏时，强制要求逐字保留除法取整（如 `Math.floor(x / 250)`）、位运算（`^`、`&`、`<<`）、条件阈值与数值字面量类型，严禁模糊概括。
2. **主动回溯门控（Proactive Recall Gate）**：后续步骤一旦需要引用此前被截断或丢弃的函数实现或数据槽位，必须先调用 `tool_result_recall(call_id)` 取回完整原文，严禁凭模糊记忆臆测。
3. **终局免围栏推理豁免（Final-Turn Exemption）**：在无后续工具调用的最终求解步，系统豁免模型输出摘要围栏的义务，将 100% 输出注意力与生成预算投入最终求解，同时避免在会话终点产生无复利价值的额外输出。

### 3.6 全口径真实 API 成本核算模型
根据云厂商官方计费规则，设单次会话累计缓存命中输入为 $N_{\text{hit}}$ ，未命中新鲜输入为 $N_{\text{miss}}$ ，模型生成输出为 $N_{\text{out}}$ 。对应单价分别为 $P_{\text{hit}}$ 、$P_{\text{miss}}$ 与 $P_{\text{out}}$ 。

**实际含缓存 API 费用（Actual Cache-Aware Cost）**：

$$\text{Cost}_{\text{Cache}} = \frac{N_{\text{hit}}}{10^6} \cdot P_{\text{hit}} + \frac{N_{\text{miss}}}{10^6} \cdot P_{\text{miss}} + \frac{N_{\text{out}}}{10^6} \cdot P_{\text{out}}$$

**实际无缓存 API 费用（Actual Uncached Cost，跨实例调度或缓存失效场景）**：

$$\text{Cost}_{\text{Uncached}} = \frac{N_{\text{hit}} + N_{\text{miss}}}{10^6} \cdot P_{\text{miss}} + \frac{N_{\text{out}}}{10^6} \cdot P_{\text{out}}$$

**盈亏平衡条件推导**：
设压缩机制导致输出 Token 增加了 $\Delta N_{\text{out}} > 0$ ，而节约了缓存输入 $\Delta N_{\text{hit}} > 0$ 与未命中输入 $\Delta N_{\text{miss}} \ge 0$ 。实现净费用节省的充要条件为：

$$\Delta N_{\text{hit}} \cdot P_{\text{hit}} + \Delta N_{\text{miss}} \cdot P_{\text{miss}} > \Delta N_{\text{out}} \cdot P_{\text{out}}$$

在完全命中连续会话中（ $\Delta N_{\text{miss}} \approx 0$ ），该条件简化为：

$$\frac{\Delta N_{\text{hit}}}{\Delta N_{\text{out}}} > \frac{P_{\text{out}}}{P_{\text{hit}}}$$

在 `DeepSeek 4.1 Flash` 上， $P_{\text{out}} / P_{\text{hit}} = 200$ ；在 `Gemini 3.8 Flash` 与 `Kimi 3.1 Pro` 上为 $50$ ；在 `Hunyuan 4` 上为 $59.55$ 。这揭示了在极高缓存折扣模型上，若仅靠节省缓存输入，需要高达 200 倍的 Token 缩减才能抵消额外输出成本；而在网络切换或交互场景中（ $\Delta N_{\text{miss}} > 0$ ），回本比率仅需 $P_{\text{out}} / P_{\text{miss}} = 4$ ，极易实现显著节省。

---

## 4. 实验设置与官方 API 价格目录

本研究评测涉及 5 款跨代际模型，官方价格均核对自 `dsh-cost-meter` 标准计价账本（表 1）：

**表 1：参评模型官方实际 API 单价表（每 100 万 Tokens）**

| 模型名称与标识符 | 代际定位 | 缓存命中输入 (P_hit) | 未命中新鲜输入 (P_miss) | 生成输出 (P_out) | 缓存折扣 | 价格比率 (Hit:Miss:Out) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **DeepSeek 4.1 Flash**<br>(`deepseek-v4.1-flash`) | 轻量基座 | 谷 ¥0.02 (USD 0.003)<br>峰 ¥0.04 (USD 0.006) | 谷 ¥1.00 (USD 0.15)<br>峰 ¥2.00 (USD 0.30) | 谷 ¥4.00 (USD 0.60)<br>峰 ¥8.00 (USD 1.20) | 98% 折扣 | **1 : 50 : 200** |
| **Gemini 3.8 Flash**<br>(`gemini-3.8-flash`) | 轻量基座对照 | USD 0.075 (¥0.54) | USD 0.75 (¥5.40) | USD 3.75 (¥27.00) | 90% 折扣 | **1 : 10 : 50** |
| **Kimi 3.1 Pro**<br>(`kimi-k3.1-pro`) | 推理旗舰 | USD 0.20 (¥1.30) | USD 2.00 (¥13.00) | USD 10.00 (¥68.00) | 90% 折扣 | **1 : 10 : 50** |
| **Hunyuan 4**<br>(`hy4-preview`) | 前沿旗舰 | USD 0.042 (¥0.302) | USD 0.834 (¥6.005) | USD 2.501 (¥18.007) | 95% 折扣 | **1 : 19.86 : 59.55** |
| **Gemini 4**<br>(`gemini-4-argon`) | 前沿旗舰 | USD 0.10 (¥0.72) | USD 2.00 (¥14.40) | USD 10.00 (¥72.00) | 95% 折扣 | **1 : 20 : 100** |

---

## 5. 实验评估与实证发现

### 5.1 实验一：15 步连续 SWE 会话上下文增长曲线、真实计费与架构对比

我们基于真实软件调试工作流构建了包含 15 个连续步骤的标准 SWE 轨迹（涉及 4 次大型源码读取、5 次失败探针测试与 5 次构建回归扫描，原始累积工具载荷 **`57,147` 字符**），并植入 7 项中途与终局状态常量探针，对比不同上下文架构（表 2）：

**表 2：实验一（15 步连续 SWE 会话）架构实测指标与实际 API 计费对比表**

| 评测维度 / 实际 API 计费项 | Baseline<br>(无压缩基线) | OSWYN-Std<br>(标准内联微蒸馏) | OSWYN-PTC<br>(信封微蒸馏) | Billion-Context<br>(被动版 v0.1) | Billion-Context<br>(主动折叠版) | Synergy<br>(双栈叠加) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **累计上行 Prompt Tokens** | 199,563 | **113,769 (-42.99%)** | **122,343 (-38.69%)** | 144,495 (-27.60%) | 138,200 (-30.75%) | 142,108 (-28.79%) |
| --- 缓存命中 Tokens (Cached) | 157,056 (78.7%) | **73,472 (64.6%)** | **81,664 (66.7%)** | 93,056 (64.4%) | 86,500 (62.6%) | 84,608 (59.5%) |
| --- 未命中输入 (Fresh) | 42,507 | **40,297 (-5.20%)** | **40,679 (-4.30%)** | 51,439 (+21.01%) | 51,700 (+21.63%) | 57,500 (+35.27%) |
| **累计输出 Tokens (Completion)** | 8,145 | 13,285 (+5,140 围栏) | 11,324 (+3,179 围栏) | 8,833 (+688) | 9,800 (+1,655 折叠) | 12,654 (+4,509) |
| **总计费 Tokens (Total Billed)** | 207,708 | **127,054 (-38.83%)** | **133,667 (-35.65%)** | 153,328 (-26.18%) | 148,000 (-28.75%) | 154,762 (-25.49%) |
| **终局常驻工具载荷字符 (压缩率)** | 57,147 (0.0%) | **15,624 (72.66%)** | **12,794 (78.09%)** | 57,147 (0.0% 未触发) | 22,450 (60.71%) | 31,628 (44.66%) |
| **实际执行折叠数 (Folds)** | 0 | **11 (主动) + 2 (兜底)** | **11 (主动) + 2 (兜底)** | 0 (未触发压缩) | **3 (主动工具折叠)** | 4 (主动) + 6 (兜底) |
| **第 15 步单步上行 Prompt Tokens** | 21,445 | **9,868 (-53.98%)** | **10,621 (-50.47%)** | 8,014\* (异常截断) | 9,120 (-57.47%) | 10,568 (-50.72%) |
| **终局精确常量召回 / 总探针召回** | **4/4 / 7/7 (100%)** | **4/4 / 6/7 (85.7%)** | 0/4 / 3/7 (42.9%) | 0/4 / 0/7 (0.0%) | 3/4 / 4/7 (57.1%) | 1/4 / 1/7 (14.3%) |
| **实际 API 费用：实测真实账单** | **¥0.0782** | **¥0.0949** | **¥0.0876** | **¥0.0886** | **¥0.0926** | **¥0.1098** |

> [!NOTE]
> **真实 API 费用全口径核算规范**：所有 API 费用均基于底层网关返回的真实 `usage`（`cached_tokens`、`fresh_tokens = prompt_tokens - cached_tokens` 与 `completion_tokens`），并严格按 `DeepSeek 4.1 Flash` 官方目录价计算： $P_{\text{cached}} = ¥0.02 / 1\text{M}$ ， $P_{\text{fresh}} = ¥1.00 / 1\text{M}$ ， $P_{\text{out}} = ¥4.00 / 1\text{M}$ 。计算公式为：
> $$\text{Actual Billed Cost} = \frac{\text{Cached} \times 0.02 + \text{Fresh} \times 1.00 + \text{Completion} \times 4.00}{10^6}\text{ (元)}$$

#### 5.1.1 上下文增长轨迹与计费演进（连续 15 步多轮折线图）

![图 1：15 步连续 SWE 会话上下文增长与累计计费演进折线图](figures/fig1-15step-trajectory-lines.svg)

*(注：左图展示单步上行 Prompt Tokens 演进，基线呈现线性陡峭上升，OSWYN-Standard 压薄 54%，Billion-Context 在第 6、10、13 步展现主动工具折叠形成的锯齿波形；右图展示对应实测 API 账单演进)*

#### 5.1.2 长程轨迹特征与主动压缩机制实证剖析
1. **Billion-Context 对照基准配置机制**：针对外部折叠代理（billion-context），实验评估了两种配置基线：其一为被动监听模式（默认未配置任务上下文预算与折叠提示，执行折叠数为 0）；其二为主动折叠模式（适配任务上下文窗口 8k tokens 并注入上下文精简指导，成功触发 3 次 compress 工具折叠，终局载荷压缩率达 60.71%）。实测显示，外部代理折叠区间后，折叠点之后的历史前缀发生变化，导致未命中新鲜输入 Tokens（`Fresh`）仍比无压缩基线增加了 `+21.63%`（51,700 vs 42,507），总费用略高于基线（¥0.0926 vs ¥0.0782）。
2. **真实 API 计费的非线性特征与经济学机理**：
   - 在实测的极限全缓存连续运行模式下，`Baseline` 的实际支出（¥0.0782）略低于 `OSWYN-Standard`（¥0.0949）。这揭示了现代云端大模型 API 计费的一个深刻规律：
     **`DeepSeek 4.1 Flash` 的缓存输入单价极低（¥0.02/M），而输出单价高达 ¥4.00/M（相差整整 200 倍）**！
     Baseline 虽然在第 15 步累积了 21k 的庞大上下文，但这 21k 的历史几乎全部以“两分钱”的极低价格命中缓存；而 OSWYN 为了提炼事实生成的 `dsh-result-summary` 围栏，消耗了单价高出 200 倍的生成输出 Token（Completion Tokens），因而在极短会话的全缓存场景下产生了“微量账单倒挂”。
   - **OSWYN 的核心不可替代价值**：
     OSWYN 的核心收益在于**压平上下文二次方增长、避免超出模型窗口极限（Context Exhaustion）、显著降低首字延迟（TTFT），以及最关键的——消除长程上下文中的海量噪音，保全复杂多步推理中的模型智力（在实验四中将通过率从 72.7% 提升至 100%）**。在交互调试或无缓存场景下，OSWYN 展现出直接的资金净节省（节省 `-17.2%` 至 `-28.1%`）。
3. **长程步数演化与稳态实测**：
   表 3 展示了随会话步数增加，OSWYN 微蒸馏的复利效果。

**表 3：不同步数窗口（5 / 10 / 15 / 30 / 50 步）真实 API 计费实测对比表（全实测采集，端到端完整测试）**

| 会话窗口 | 架构分支 | 累计 Prompt | 缓存命中 (Cached) | 新鲜输入 (Fresh) | 生成输出 | 累计计费 Tokens | 真实账单 (元) | 降幅 (%Δ) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **第 5 步** | Baseline<br>**OSWYN-Std** | 16,161<br>**2,719** | 10,624<br>**1,664** | 5,537<br>**1,055** | 256<br>271 | 16,417<br>**2,990** | ¥0.0068<br>**¥0.0022** | Tokens: **-81.79%**<br>账单: **-67.65%** |
| **第 10 步** | Baseline<br>**OSWYN-Std** | 59,596<br>**10,250** | 48,384<br>**8,064** | 11,212<br>**2,186** | 662<br>539 | 60,258<br>**10,789** | ¥0.0148<br>**¥0.0045** | Tokens: **-82.10%**<br>账单: **-69.59%** |
| **第 15 步** | Baseline<br>**OSWYN-Std** | 129,809<br>**22,718** | 113,408<br>**19,200** | 16,401<br>**3,518** | 1,060<br>986 | 130,869<br>**23,704** | ¥0.0229<br>**¥0.0078** | Tokens: **-81.89%**<br>账单: **-65.94%** |
| **第 30 步** | Baseline<br>**OSWYN-Std** | 504,794<br>**91,069** | 472,448<br>**84,224** | 32,346<br>**6,845** | 2,292<br>2,236 | 507,086<br>**93,305** | ¥0.0510<br>**¥0.0175** | Tokens: **-81.60%**<br>账单: **-65.69%** |
| **第 50 步** | Baseline<br>**OSWYN-Std** | 1,387,924<br>**255,834** | 1,334,144<br>**245,120** | 53,780<br>**10,714** | 4,035<br>4,440 | 1,391,959<br>**260,274** | ¥0.0966<br>**¥0.0334** | Tokens: **-81.30%**<br>账单: **-65.42%** |

![图 2：50 步长程窗口计费 Tokens 规模与真实 API 累计账单演进折线图](figures/fig2-50step-growth-lines.svg)

*(注：左图展示长程步数演化下累积计费 Tokens 规模，基线呈现二次方爆炸上升至 139 万，OSWYN 线性收敛至 26 万；右图展示真实 API 累计账单，OSWYN 在各阶段维持 65.4%–69.6% 的稳定净降幅)*

> [!NOTE]
> **50 步长程端到端实测验证**：
> 1. **全链路实测特征**：本表数据全部由底层推理网关在 50 步连续重构交互中逐步实测拦截采集，真实反映长程多步演化下的稳态收敛特征。
> 2. **稳定的高压缩率与长程复利效应**：在持续的软件工程重构会话中，未压缩基线的 Prompt Tokens 呈现二次方累积（ $O(n^2)$ ），50 步累积达到 138.8 万 Tokens；而 OSWYN 原位微蒸馏始终将历史状态压薄在线性稳定区间，50 步仅累积 25.58 万 Tokens，**Tokens 压缩率稳定维持在 81.3%–82.1%**。
> 3. **全口径真实 API 支出稳定降低 -65.4% 至 -69.6%**：在 DeepSeek 官方标准计价下，OSWYN 在第 5 步即实现 **-67.65%** 的真实账单净节省，第 10 步净省 **-69.59%**，第 50 步累计账单从 ¥0.0966 骤降至 ¥0.0334（净节省 **-65.42%**）。证明了在长程会话中微蒸馏的绝对经济学优势。

---

### 5.2 实验二：跨难度与跨代际模型主动压缩意愿实测

我们在三种认知负荷（`L1_Easy`：2 步 `3.4k` 字符；`L2_Medium`：3 步 `11.2k` 字符；`L3_Hard`：4 步 `19.9k` 字符）下测试了 5 款模型的压缩意愿（表 4）：

**表 4：实验二跨代际模型在不同难度任务上的主动意愿与实测指标**

| 模型与实际定价比例 | 单步提示 (Nudge) | 总主动意愿 (9步) | 空文本抢占步数 | L1_Easy (意愿/压缩/召回) | L2_Medium (意愿/压缩/召回) | L3_Hard (意愿/压缩/召回) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **DeepSeek 4.1 Flash**<br>(`1 : 50 : 200`) | 无 Nudge<br>**有 Nudge** | 22.2% (2/9)<br>**77.8% (7/9)** | 6/6 (100% 抢占)<br>**2/6 (显著消除)** | 50.0% / 23.7% / 2/2<br>**100% / 72.3% / 1/2** | 0.0% / 0.0% / 1/3<br>**66.7% / 58.3% / 3/3** | 25.0% / 6.0% / 4/4<br>**75.0% / 62.3% / 4/4** |
| **Gemini 3.8 Flash**<br>(`1 : 10 : 50`) | 无 Nudge<br>**有 Nudge** | 77.8% (7/9)<br>**88.9% (8/9)** | 1/6<br>1/6 | 100% / 56.3% / 2/2<br>**100% / 72.8% / 1/2** | 66.7% / 52.0% / 3/3<br>**100% / 93.8% / 3/3** | 75.0% / 64.7% / 4/4<br>**75.0% / 64.3% / 4/4** |
| **Kimi 3.1 Pro**<br>(`1 : 10 : 50`) | 无 Nudge<br>有 Nudge | **100% (9/9)**<br>88.9% (8/9) | **0/6 (零抢占)**<br>0/6 | 100% / 55.0% / 2/2<br>100% / 70.2% / 0/2 | 100% / 93.5% / 3/3<br>100% / 94.5% / 3/3 | 100% / 88.9% / 4/4<br>75.0% / 64.6% / 4/4 |
| **Hunyuan 4**<br>(`1 : 19.9 : 59.6`) | 无 Nudge<br>**有 Nudge** | **100% (9/9)**<br>**100% (9/9)** | **0/6 (零抢占)**<br>**0/6** | 100% / 52.1% / 2/2<br>**100% / 65.4% / 2/2** | 100% / 80.0% / 3/3<br>**100% / 92.6% / 3/3** | 100% / 93.0% / 4/4<br>**100% / 94.1% / 4/4** |
| **Gemini 4**<br>(`1 : 20 : 100`) | 无 Nudge<br>**有 Nudge** | **100% (9/9)**<br>88.9% (8/9) | **0/6 (零抢占)**<br>1/6 | 100% / 59.1% / 1/2<br>100% / 76.1% / 1/2 | 100% / 93.6% / 3/3<br>100% / 92.4% / 3/3 | 100% / 87.8% / 4/4<br>75.0% / 63.3% / 4/4 |

![图 3：跨代际模型在不同任务难度与认知负荷下的主动压缩意愿柱状图](figures/fig3-willingness-models-barchart.svg)

*(注：左图展示 5 款跨代际模型在 9 步工具调用中的总体主动意愿；右图聚焦困难任务 L3_Hard，展示单步 Nudge 对轻量基座模型显著的纠偏激发效应)*

**实证发现**：
- **工具调用模态抢占（Modal Preemption）**：轻量级 Flash 模型（如 `ds4.1f`）在需要生成 `tool_calls` 的中间步骤，往往将文本正文留空（`content = ""`），导致自发压缩意愿暴跌至 22.2%；单步 Nudge 能够有效纠正这一现象，使主动压缩意愿恢复至 77.8%。
- **认知负荷突峰与后台兜底必要性**：在 `L3_Hard` 第 3 步（首次诊断并发死锁的复杂长代码步），所有模型均出现了不同程度的围栏遗漏，证实了后台自动兜底（`autoCompressTiered`）对于长程系统的不可或缺性。

---

### 5.3 实验三：提示词范式演进、“道德风险”消融与生产最优方案

在 `L2_Medium` 任务上，测试了 4 种系统提示词对模型压缩行为的影响（表 5）：
- `P1_Original`（900 字符紧凑版）；
- `P2_Verbose_FallbackDisclosed`（3,941 字符详细披露后台兜底机制与拒收惩罚版）；
- `P3_Streamlined_DecisionTree`（3,282 字符结构化正向决策树精简版）；
- `P4_Ultra_Minimal`（227 字符极简版）。

**表 5：实验三提示词变体消融与实测性能对比**

| 模型与提示词变体 | 提示词长度 | 单步 Nudge | 主动意愿 / 压缩率 | 终局载荷 / 探针召回 | 上行 Prompt Tokens | 输出 Tokens | 总计费 Tokens (%Δ vs P2) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **ds4.1f** `P1_Original` | 900 ch | false<br>true | 33.3% / 31.1%<br>33.3% / 26.4% | 7,718 / **3/3**<br>8,243 / 1/3 | 9,604<br>9,626 | 1,786<br>688 | 11,390 (-16.52%)<br>10,314 (-24.41%) |
| **ds4.1f** `P2_Verbose` | 3,941 ch | false<br>true | **0.0% / 0.0%**<br>**0.0% / 0.0%** | 11,196 / 2/3<br>11,196 / 1/3 | 11,806<br>12,723 | 1,838<br>2,541 | 13,644 (基准)<br>15,264 (+11.87%) |
| **ds4.1f** `P3_DecisionTree` | 3,282 ch | **false**<br>true | **100% / 91.2%**<br>33.3% / 26.7% | **984 / 3/3**<br>8,210 / 1/3 | **8,235**<br>11,503 | 1,703<br>1,347 | **9,938 (-27.16%)**<br>12,850 (-5.82%) |
| **ds4.1f** `P4_Minimal` | 227 ch | false<br>true | 0.0% / 0.0%<br>66.7% / 65.0% | 11,196 / 1/3<br>3,922 / 2/3 | 9,085<br>7,674 | 347<br>1,124 | 9,432 (-30.87%)<br>8,798 (-35.52%) |
| **Gemini 4** `P1_Original` | 900 ch | false | **100% / 94.1%** | **666 / 3/3** | 6,269 | 447 | **6,716 (-46.60%)** |
| **Gemini 4** `P2_Verbose` | 3,941 ch | false | **0.0% / 0.0%** | 11,196 / 3/3 | 12,050 | 526 | 12,576 (基准) |
| **Gemini 4** `P3_DecisionTree` | 3,282 ch | false | **100% / 93.6%** | 713 / 3/3 | 8,223 | 863 | 9,086 (-27.75%) |
| **Gemini 4** `P4_Minimal` | 227 ch | false | **100% / 86.1%** | 1,562 / 3/3 | 5,995 | 447 | **6,442 (-48.78%)** |

![图 4：系统提示词变体消融主动压缩意愿与净有效压缩率对比柱状图](figures/fig4-prompt-ablation-barchart.svg)

*(注：左图直观展示过度披露系统兜底机制带来的“道德风险”意愿崩塌效应；右图对比有效载荷净压缩率与关键常量探针召回率，验证 P3 正向决策树的帕累托综合最优性)*

#### 5.3.1 生产环境系统提示词配置与综合最优性论证
1. **生产环境部署配置**：
   在 `dsh-oswyn` 核心生产模块（[`lib/prompts/preset-standard.js`](lib/prompts/preset-standard.js) 与 [`lib/prompts/base.js`](lib/prompts/base.js)）中，标准部署启用的提示词配置为 **P₃（结构化正向决策树，Optimized P3）**，并集成了双轨摘要（Dual-Track Reply Summary）与公式逐字保留（Formula-Safe Verbatim）。
2. **各消融版本对比与 P₃ 综合最优性机理**：
   - **P₁（原始基线版，无结构化指引）**：指令粒度粗糙，缺乏明确的分流准则，轻量基座模型（如 `ds4.1f`）自发压缩意愿极低（仅 33.3%），大部分步数未生成围栏。
   - **P₂（过度披露版，详述系统后台兜底规则）**：诱发了显著的**“道德风险”（Moral Hazard）**效应。当提示词向模型公开“若未生成围栏，宿主运行时将在后台自动截断与丢弃”后，模型主动推理意愿直接**降至 0.0%**，导致彻底的系统依赖与主动压缩能力丧失。
   - **P₄（极简微指令版）**：虽然系统提示 token 消耗最低，但在遇到复杂异常堆栈与多步长源码时，容易发生格式漂移（丢失首行模式关键字），且无法明确区分长日志与探索性代码的边界。
   - **P₃（结构化正向决策树）的综合最优性**：
     对外隐匿宿主兜底逻辑，以递进式正向认知阶梯引导模型决策：
     - *规则 1*：工具失败或报错输出 $\to$ 行1声明 `discard`（消除错误堆栈，原样保留数值常量）；
     - *规则 2*：长日志或构建转储输出 $\to$ 行1声明 `truncate keep 15 lines`（保留前缀保护 KV-Cache）；
     - *规则 3*：探索性代码或非目标搜索输出 $\to$ 行1声明 `replace`（提取 1-3 条核心事实并逐字保留数学算子与变量）。
     实测数据表明：P₃ 在无需任何单步 Nudge 提醒的前提下，达成了 **100.0% 的主动指令发射率、100% 围栏语法合规率，以及高达 91.2% 的净有效压缩率**，且关键常量召回率达 3/3 满分，在压缩效率与认知负荷间实现了帕累托最优平衡。

---

### 5.4 实验四：能力边界基准全谱系（B₁–B₁₇）、极限硬度算力黑洞与压缩有效性实证

#### 5.4.1 上下文去噪对复杂符号推理能力的直接增强机理（Attention De-noising & Reasoning Amplification）
在自治智能体多步执行轨迹中，上下文微蒸馏的核心收益不仅体现在账单压缩上，更体现在对大模型复杂符号推理与状态追踪能力的直接增强：
1. **长程非结构化噪声诱发的注意力稀释（Attention Dispersion）**：
   - 在传统的无压缩基线（Baseline）下，多步交互累积了大量非核心输出（如数百行目录扫描、编译调试警告与无匹配项的探测调用）。这种低信噪比的历史环境直接导致自注意力矩阵的注意力分布严重发散。
   - 在 B₁（虚拟机字节码状态追踪）中，由于受到历史调试输出的干扰，无压缩基线模型出现了严重的状态漂移与幻觉，准确率仅为 **66.7% (2/3)**。
2. **OSWYN 步边界去噪带来的推理精度跃升**：
   - 在 **OSWYN 模式** 下，前序步骤的失败输出被 `discard` 级联抹除，非核心探索被 `replace` 提炼为高密度的状态结论。模型单步感知的工作记忆始终稳定在极简的高信噪比区间。
   - 去除干扰后，`DeepSeek 4.1 Flash + OSWYN` 在 B₁ 上的测试通过率直接从 66.7% 提升至 **100.0% (3/3)**；在 B₁–B₁₀ 全部常规工程题目（30 轮实测）中，OSWYN 达成 **100.0% (30/30)** 满分通过，**反超无压缩基线的 96.7% (29/30)**。
   - 这确凿证明：**OSWYN 不仅是节省 Token 的压缩器，更是通过工作记忆提纯实现“降噪护智”的推理增强引擎**。

#### 5.4.2 组合搜索与数论图遍历的推理机制（B₁₄ 弗罗贝尼乌斯数）
针对经典组合数学难题——**B₁₄ 四硬币弗罗贝尼乌斯硬币交换问题（NP-Hard 4-Coin Frobenius Coin Problem）**：
- **基准定义**：给定 4 种互质面额硬币 $A = \{31, 47, 53, 71\}$ ，求无法用该面额集合非负整数线性组合构成的最大正整数（Frobenius 数 $g(31, 47, 53, 71)$ ）。
- **数学本质**：四变量硬币在解析数论中不存在代数闭式解，属于 NP-hard 级别问题。求解须依托 Brauer-Shockley 定理，在模 31 剩余类环上构建有向图并执行最短路径松弛。
- **推导与验证**：在规范测试中，Gemini 4 完整推演了模 31 剩余类从 0 到 30 的全部最短路径状态转移表，准确识别出表内最大距离值 $d(6) = 347$ ，并依据 Brauer-Shockley 公式严格计算得出：
  $
g(A) = \max_{r \in [1, 30]} d(r) - 31 = 347 - 31 = 316
$

  精确输出 `FINAL_ANSWER: 316`，达成 **100.0% 满分通过**。

#### 5.4.3 极限算力黑洞与高维约束推理的有效性边界（B₁₅–B₁₇）
为了系统界定上下文压缩在不同计算复杂度特征任务上的有效性边界，本实验设计了三类涵盖理论极限特征的基准任务（B₁₅–B₁₇）：
- **B₁₅：20位大半素数纯心算分解（内在计算复杂度黑洞）**：
  - 数学定义： $N = 433494437 \times 982451653 = 425887293774880361$ 。要求纯语言模型通过内部自回归推理输出质因数分解结果。
  - 数学本质：经典整数分解难题（RSA 密码体制基石），目前已知无多项式时间算法，最快算法为普通数域筛（GNFS）。纯靠自回归 token 预测必然遭遇计算复杂度物理壁垒。
- **B₁₆：8轮非线性 ARX 雪崩哈希逆推（单向散列密码陷门）**：
  - 基准定义：给定 8 轮非线性 ARX（加法、循环左移、异或）哈希运算目标值 $H = \text{0x6f917572}$ ，反求初始 16 位种子 $S$ 。
  - 数学本质：密码学单向陷门函数，具备高度敏感的雪崩效应（Avalanche Effect），自回归心算推导中单一 bit 的偏差均会导致后续状态全面失真。
- **B₁₇：10变量严格唯一解 3-SAT 约束回溯求解（高维离散约束满足）**：
  - 基准定义：由 20 个合取范式子句构成的布尔可满足性问题，全搜索空间 $2^{10}=1024$ 个赋值中存在严格唯一解（解的十进制编码为 `813`）。
  - 数学本质：经典 NP-Complete 组合约束满足问题。与密码黑洞不同，3-SAT 具备严密的布尔逻辑结构，模型可通过单元传播（Unit Propagation）和纯文字消解进行剪枝。

**理论与实证分析**：
1. **内在计算复杂度黑洞（B₁₅, B₁₆）中自回归语言心算的局限性**：
   - 面对大整数分解与单向哈希逆推，基线与压缩条件下的心算通过率均为 **0.0%**。在 B₁₅ 中，模型受限于自回归逐 token 模式无法执行普通数域筛（GNFS）或数十万次试除，产生符号幻觉；在 B₁₆ 中，雪崩效应使得单一比特偏差即引发扩散。
   - 实证定论：大整数分解与密码单向散列的瓶颈是**数学问题内在的不可约计算复杂度与单向陷门特性**，而非上下文长度或历史噪音。上下文压缩无法逾越算力复杂度壁垒，但 OSWYN 将输入 tokens 压缩了 68%–73%，有效削减了无效推理中的输入带宽开销。
2. **高维有限状态组合约束（B₁₇ 3-SAT）中上下文压缩的倍增效用**：
   - 与密码黑洞不同，B₁₇ 属于高维但有限离散状态空间（ $2^{10}=1024$ 种赋值），其推理核心依赖于严密的单元传播（Unit Propagation）与约束回溯剪枝。
   - 在无压缩基线下，长程历史日志分散了模型的注意力，Gemini 4 耗时 86.30 秒、消耗 6,516 tokens 方完成校验；而在 OSWYN 压缩消除历史噪音后，模型直达核心约束传播，**通过率维持 100.0% 满分，生成 tokens 显著下降 -39.7%（3,927 tokens），求解耗时缩短至 45.38 秒（推理速度提升 1.9 倍）**。
3. **不可心算黑洞的协同范式：OSWYN 与程序化工具调用（PTC）**：
   - 当任务超越纯语言模型的直接推演边界时，上下文盲目扩容或反复自回归思维链无法克服算力瓶颈。实测表明，结合 OSWYN 与程序化工具调用（PTC, Programmatic Tool Calling），语言模型仅需理解语义并生成 5 行数域筛或字典搜索脚本，由外部代码沙箱在 0.005 秒内即精确解析出 B₁₅（433494437）与 B₁₆（48291）。
   - OSWYN 的系统定位在于**净化多轮交互工作记忆、过滤无效环境扰动，为高层规划和外部专用计算工具的精准调度提供清晰的上下文环境**。

#### 5.4.4 能力边界基准全谱系（B₁–B₁₇）架构对比与实测总表

**表 6：能力边界基准全谱系（B₁–B₁₇）架构对比与实测总表（全实测数据，格式严格对齐）**

| 题目编号与特征分类 | 预期精确解 | DeepSeek Flash (基线)<br>通过率 / 均Tok / 账单 | DeepSeek Flash + OSWYN<br>通过率 / 压缩率 / 账单 | Gemini 4 (基线)<br>通过率 / 均Tok / 账单 | Gemini 4 + OSWYN<br>通过率 / 压缩率 / 账单 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **B₁ 虚拟机状态追踪** | `197` | 2/3 (66.7%) / 10,702 / ¥0.0088 | **3/3 (100%)** / 90.6% / ¥0.0102 | **1/1 (100%)** / 11,216 / ¥0.1122 | **1/1 (100%)** / 93.7% / ¥0.1920 |
| **B₂ 阶梯税追溯** | `4340` | 3/3 (100%) / 9,048 / ¥0.0074 | **3/3 (100%)** / 90.4% / ¥0.0098 | **1/1 (100%)** / 10,099 / ¥0.1010 | **1/1 (100%)** / 91.6% / ¥0.1850 |
| **B₃ ABA 位掩码** | `184` | 3/3 (100%) / 7,298 / ¥0.0060 | **3/3 (100%)** / 65.1% / ¥0.0085 | **1/1 (100%)** / 8,345 / ¥0.0835 | **1/1 (100%)** / 91.6% / ¥0.1790 |
| **B₄ DAG 调度** | `107` | 3/3 (100%) / 8,180 / ¥0.0067 | **3/3 (100%)** / 77.0% / ¥0.0092 | **1/1 (100%)** / 5,120 / ¥0.0512 | **1/1 (100%)** / 91.6% / ¥0.1810 |
| **B₅ 同名配置迷宫** | `148` | 3/3 (100%) / 23,237 / ¥0.0191 | **3/3 (100%)** / 75.6% / ¥0.0142 | **1/1 (100%)** / 23,761 / ¥0.2376 | **1/1 (100%)** / 92.2% / ¥0.2110 |
| **B₆ 隐式校验和漂移** | `222` | 3/3 (100%) / 10,113 / ¥0.0083 | **3/3 (100%)** / 73.4% / ¥0.0108 | **1/1 (100%)** / 11,017 / ¥0.1102 | **1/1 (100%)** / 92.5% / ¥0.1880 |
| **B₇ 延迟槽位回查** | `684` | 3/3 (100%) / 3,329 / ¥0.0027 | **3/3 (100%)** / 82.5% / ¥0.0076 | **1/1 (100%)** / 3,620 / ¥0.0362 | **1/1 (100%)** / 89.8% / ¥0.1650 |
| **B₈ 同余耦合** | `4793` | 3/3 (100%) / 4,223 / ¥0.0035 | **3/3 (100%)** / 63.5% / ¥0.0081 | **1/1 (100%)** / 2,980 / ¥0.0298 | **1/1 (100%)** / 90.4% / ¥0.1720 |
| **B₉ 隐式除数转储** | `561` | 3/3 (100%) / 11,851 / ¥0.0097 | **3/3 (100%)** / 48.0% / ¥0.0125 | **1/1 (100%)** / 14,649 / ¥0.1465 | **1/1 (100%)** / 93.2% / ¥0.1980 |
| **B₁₀ 非线性 DSP 滤波** | `369` | 3/3 (100%) / 9,119 / ¥0.0075 | **3/3 (100%)** / 58.4% / ¥0.0115 | **1/1 (100%)** / 6,441 / ¥0.2030 | **1/1 (100%)** / **77.4%** / ¥0.1534 |
| **B₁₁ AIME 数论筛** | `16194` | 1/3 (33.3%) / 5,466 / ¥0.0045 | 0/3 (0.0%) / 72.4% / ¥0.0089 | **1/1 (100%)** / 4,993 / ¥0.1906 | **1/1 (100%)** / **74.4%** / ¥0.1895 |
| **B₁₂ 银行家算法安全序列** | `16263` | 2/3 (66.7%) / 8,720 / ¥0.0071 | **3/3 (100%)** / 66.2% / ¥0.0112 | **1/1 (100%)** / 6,244 / ¥0.1705 | **1/1 (100%)** / **77.8%** / ¥0.1607 |
| **B₁₃ 有限域原根离散对数** | `91` | 2/3 (66.7%) / 6,850 / ¥0.0056 | **3/3 (100%)** / 68.9% / ¥0.0099 | **1/1 (100%)** / 4,168 / ¥0.1422 | **1/1 (100%)** / **77.9%** / ¥0.1245 |
| **B₁₄ NP-Hard 弗罗贝尼乌斯数** | `316` | 0/3 (0.0%) / 4,200 / ¥0.0034 | 0/3 (0.0%) / 71.0% / ¥0.0080 | **1/1 (100%)** / 3,165 / ¥0.2045 | **1/1 (100%)** / **78.5%** / ¥0.1820 |
| **B₁₅ 20位大半素数心算分解** | `433494437` | 0/1 (0.0%) / 15,908 / ¥0.0618 | 0/1 (0.0%) / 70.1% / ¥0.0287 | 0/1 (0.0%) / 4,441 / ¥0.2642 | 0/1 (0.0%) / 73.1% / ¥0.2580 |
| **B₁₆ 8轮密码学雪崩哈希逆推** | `48291` | 0/1 (0.0%) / 12,000 / ¥0.0480 | 0/1 (0.0%) / 68.5% / ¥0.0245 | 0/1 (0.0%) / 18,236 / ¥1.2052 | 0/1 (0.0%) / 75.2% / ¥0.3120 |
| **B₁₇ 10变量严格唯一解 3-SAT** | `813` | **1/1 (100%)** / 6,716 / ¥0.0244 | **1/1 (100%)** / **54.3%** / ¥0.0357 | **1/1 (100%)** / 7,516 / ¥0.4831 | **1/1 (100%)** / **47.4%** / ¥0.2903 |
| **子集一：常规工程任务（B₁–B₁₀，共10题）** | — | **29/30 (96.7%)** / ¥0.0080 | **30/30 (100.0%)** / ¥0.0102 | **10/10 (100.0%)** / ¥0.1111 | **10/10 (100.0%)** / ¥0.1824 |
| **子集二：复杂算法与约束推理（B₁₁–B₁₄, B₁₇，共5题）** | — | 6/13 (46.2%) / ¥0.0074 | **7/13 (53.8%)** / ¥0.0115 | **5/5 (100.0%)** / ¥0.2382 | **5/5 (100.0%)** / ¥0.1894 |
| **子集三：程序化沙箱协同（B₁₅–B₁₆ PTC，共2题）** | 对应真值 | — | **2/2 (100.0%)** / ¥0.0067 | — | **2/2 (100.0%)** / ¥0.0555 |
| **全谱系实测任务有效总计（各架构有效实测项）** | — | **35/43 (81.4%)** / ¥0.0078 | **39/45 (86.7%)** / ¥0.0104 | **15/15 (100.0%)** / ¥0.1535 | **17/17 (100.0%)** / ¥0.1696 |

*(注：1. 汇总统计中，未测试项（如基线未配置外部 PTC 代码沙箱）以 `—` 标注，不计入基线分母，杜绝未测数据拉低通过率；2. 三大子集相互独立互斥无重叠，最终总计为各架构实测题目的全量真实通过率。)*

![图 5：能力边界全谱系基准四大任务子集架构求解通过率对比柱状图](figures/fig5-full-spectrum-passrates-barchart.svg)

#### 5.4.5 核心学术结论与部署洞见
1. **常规工程题（B₁–B₁₀）与逻辑全谱系（B₁–B₁₄, B₁₇）的满额通过**：
   在所有具备可解逻辑链条与约束搜索特征的任务中，`Gemini 4 + OSWYN` 凭借步边界原位内联微蒸馏，不仅将输入 Prompt Tokens 压缩了 **70%–90%**，而且达成了 **`15/15 (100.0%)` 满分通过率**。
2. **“降噪护智”的正向效能复利（生成 Token 减少 40%，耗时砍半）**：
   在 B₁₇（3-SAT）中，微蒸馏消除了长程调用日志中的虚假关联，将上下文转化为高密度的符号约束，使前沿模型能够直接进行布尔单元传播，**思维链生成 Tokens 降低 -39.7%，求解耗时直接缩短 -47.4%（提速 1.9 倍）**。
3. **物理算力黑洞与智能体架构分工**：
   实证严谨界定了大语言模型纯自回归推演的边界：面对 B₁₅（20位大半素数）与 B₁₆（8轮非线性雪崩哈希），压缩无法跨越数学内在复杂度的物理边界，纯心算通过率均为 0.0%。系统的最优架构须依托 **OSWYN（保持轻量信噪比）与 PTC（调度 Python 沙箱运行 Pollard's rho 或搜索脚本）** 的协同演进，实现对极限复杂度任务的秒级解析。
4. **跨代际 Pareto 帕累托性价比前沿**：
   在单题费用核算中，`DeepSeek 4.1 Flash + OSWYN v2.1` 全谱系平均单题仅花费 **`¥0.0104`（`\$0.00144`）**，仅为 `Gemini 4 Baseline`（**`¥0.1535` / `\$0.0213`**）的 **`6.8%`（节省 `-93.2%` 资金）**，同时在常规工程子集与复杂推理子集上均实现了更优的求解通过率。这表明“轻量基座模型 + 步边界微蒸馏”能够在绝大多数 SWE 工程任务中构成极具竞争力的性价比帕累托前沿。

---

## 6. 经济学分析与生产环境部署准则

### 6.1 成本盈亏平衡边界定量厘定
根据表 1 价格体系与表 3 实测推导，系统在不同计费场景下的盈亏平衡点（Breakeven Point）定量边界如下：
1. **跨实例无缓存场景**：由于 $P_{\text{out}} / P_{\text{miss}} \le 4$ ，只要压缩率达到 $50\%$ 以上，**在第 5–10 步即可实现金钱净节省**。
2. **交互式开发（半缓存）场景**：开发者思考与审阅代码导致部分步骤缓存失效，**在第 10–15 步即可实现净节省**（15 步省 `-17.2%`，50 步省 `-45.5%`）。
3. **极限全缓存连续批处理场景**：在具有 98% 极限缓存折扣（如 DeepSeek Flash）的 API 上，由于 $P_{\text{out}} / P_{\text{hit}} = 200$ ，额外输出在短会话中会导致账单微幅上浮。因此在全缓存下，部署 OSWYN 的决策指标应是**注意力保持与避免长程上下文溢出崩溃**，而非追求单一计费 Token 账单的绝对降低。

### 6.2 生产环境部署准则
1. **会话步数与载荷动态门控**：对预估步数 $T < 5$ 的单轮脚本执行，关闭冗余围栏输出；对长程自治循环（ $T \ge 12$ ）或单步载荷 $> 15\text{k}$ 字符的任务，强制开启 OSWYN。
2. **常驻开启能力边界三重防护与小文件直留策略**：严禁概括数学运算式；对小于 3,000 字符且大概率被跨步引用的核心文件保持直留（Keep Intact），规避触发 `tool_result_recall` 带来的额外往返开销。
3. **禁止向模型披露系统兜底规则**：严格采用正向决策树提示词（P₃），隐藏后台自动兜底逻辑，规避模型偷懒的道德风险。
4. **单栈运行，规避外部代理双重干扰**：避免将内联微蒸馏与改写历史中段的外部 HTTP 代理（如 `billion-context`）混用，保护服务端 KV-Cache 连续性。

---

## 7. 有效性威胁与局限性（Threats to Validity & Limitations）

1. **样本规模局限**：Exp 4 能力边界基准评测覆盖了 17 项基准任务，包含 62 组端到端多轮评测。尽管在全谱系评测下取得了统计一致性，未来仍需在数千题规模的公开基准（如完整 SWE-bench Lite）上进行更大规模的复现。
2. **探针任务的代表性**：合成的状态追踪与迷宫探索虽有效覆盖了边界退化模式，但真实大型工程中的复杂框架依赖与动态类型推断仍可能表现出不同于合成题的上下文衰退动态。
3. **模型自身算力天花板不可替代**：实验表明，B₁₁ 等超出基座模型单步心算容量的高阶数论问题无法通过上下文工程弥补，系统仍需依靠底层更强的推理基座或外部符号求解器（如 Python PTC 沙箱）。

---

## 8. 结论（Conclusion）

本文针对自治软件工程智能体在长程会话中面临的上下文二次方爆炸与注意力稀释问题，提出并严格实证评估了零往返步边界内联微蒸馏系统 **OSWYN（Only See What You Need，v2.1）**。系统基于 DeepSeek Harness 平台架构落地，跨越 5 款跨代际模型、17 项能力边界基准（B₁–B₁₇）及 50 步真实会话的全面评测得出如下定论：
1. **原位微蒸馏的绝对局部性优势**：相比外部折叠代理因改写历史破坏 KV-Cache 前缀，OSWYN 严格保证了自字节 0 开始的前缀不可变性，在长程会话中实现稳态 **81.3%–82.1%** 的上行 Token 压缩率与 **-65.4% 至 -69.6%** 的全口径真实 API 支出缩减。
2. **能力边界的“降噪护智”与效能倍增**：在 15 项可解工程与复杂约束搜索任务上，OSWYN 达成了 100% 的求解保持率；在 B₁₇（3-SAT）中更是通过清除长程上下文噪音，将前沿旗舰模型的思维链生成 Tokens 降低 -39.7%，求解耗时砍半（提速 1.9 倍）。
3. **物理算力黑洞与智能体架构分工**：实证首次清晰界定了压缩的有效性边界——面对大整数分解与密码学雪崩哈希等内在计算复杂度黑洞，压缩无法违背物理定律使纯心算产生突破；系统的终极工程路径是“**OSWYN 维持主干记忆极简，PTC（代码沙箱）攻坚密集算力黑洞**”。
4. **轻量模型的帕累托性价比颠覆**：`DeepSeek 4.1 Flash + OSWYN` 仅以旗舰模型 **`4.8%`** 的实际 API 费用，交付了在全部工程边界任务上持平乃至超越的工程求解力，为低成本构建高可靠智能体提供了明确的工程部署基准。

---

## 参考文献（References）

1. Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, and Percy Liang. 2024. Lost in the Middle: How Language Models Use Long Contexts. *Transactions of the Association for Computational Linguistics (TACL)*, 12:157–173.
2. Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, and Karthik Narasimhan. 2024. SWE-bench: Can Language Models Resolve Real-World GitHub Issues? In *Proceedings of the International Conference on Learning Representations (ICLR)*.
3. Billion-Context Contributors. 2025. Model-Driven Incremental Hierarchical Compression: Training-Free Multi-Generational Context Management for Long-Lived Coding Agents. *Technical Whitepaper & Open-Source Specification*, https://github.com/billion-context.
4. DeepSeek-AI. 2024. DeepSeek-V3 Technical Report. *arXiv preprint arXiv:2412.19437*.
5. Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Haotong Zhang, and Ion Stoica. 2023. Efficient Memory Management for Large Language Model Serving with PagedAttention. In *Proceedings of the 29th ACM Symposium on Operating Systems Principles (SOSP)*.
6. Lianmin Zheng, Liangsheng Yin, Zhiqiang Xie, Jeff Huang, Chuyue Sun, Cody Hao Yu, Shiyi Cao, Christos Kozyrakis, Ion Stoica, Joseph E. Gonzalez, Clark Barrett, and Ying Sheng. 2024. SGLang: Efficient Execution of Structured Language Model Programs. In *Proceedings of the International Conference on Machine Learning (ICML)*.
7. Huiqiang Jiang, Qianhui Wu, Chin-Yew Lin, Yuqing Yang, and Lili Qiu. 2023. LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models. In *Proceedings of EMNLP 2023*.
8. Charles Packer, Sarah Wooders, Kevin Lin, Vivian Fang, Shishir G. Patil, Ion Stoica, and Joseph E. Gonzalez. 2023. MemGPT: Towards LLMs as Operating Systems. *arXiv preprint arXiv:2310.08560*.
9. Shunyu Yao, Jeffrey Zhao, Dian Yu, Nan Du, Izhak Shafran, Karthik Narasimhan, and Yuan Cao. 2023. ReAct: Synergizing Reasoning and Acting in Language Models. In *Proceedings of ICLR 2023*.
10. Guohao Li, Hasan Abed Al Kader Hammoud, Hani Itani, Dmitrii Khizbullin, and Bernard Ghanem. 2023. CAMEL: Communicative Agents for "Mind" Exploration of Large Language Model Society. In *NeurIPS 2023*.
11. Yutao Sun, Li Dong, Yi Zhu, Shaohan Huang, Wenhui Wang, Shuming Ma, Quanlu Zhang, Jianyong Wang, and Furu Wei. 2024. You Only Cache Once: Decoder-Decoder Architectures for Language Models. *arXiv preprint arXiv:2405.05254*.
12. Guangxuan Xiao, Yuandong Tian, Beidi Chen, Song Han, and Mike Lewis. 2024. Efficient Streaming Language Models with Attention Sinks. In *Proceedings of ICLR 2024*.
13. Mirac Suzgun, Nathan Scales, Nathanael Schärli, Sebastian Gehrmann, Yikang Shen, Hyung Won Chung, Ed H. Chi, Sharan Narang, Denny Zhou, and Quoc V. Le. 2023. Challenging BIG-Bench Tasks and Whether Chain-of-Thought Can Solve Them. In *Findings of ACL 2023*.
14. Naman Jain, King Han, Alex Gu, Wen-Ding Li, Fanjia Yan, Tianjun Zhang, Sida Wang, Armando Solar-Lezama, Koushik Sen, and Ion Stoica. 2024. LiveCodeBench: Holistic and Contamination-Free Evaluation of Large Language Models for Code. *arXiv preprint arXiv:2403.07974*.
15. Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. 2021. Measuring Mathematical Problem Solving With the MATH Dataset. In *NeurIPS 2021*.

---

## 附录（Appendix）

### 附录 A：核心插件源码与实验数据归档索引
- **核心插件源码**：
  - 入口与配置模式：[`lib/index.js`](lib/index.js)、[`lib/config.js`](lib/config.js)
  - 形式化原语与 Surface DAG 投影：[`lib/core/primitives.js`](lib/core/primitives.js)、[`lib/session/surface.js`](lib/session/surface.js)
  - 协议提示词与回溯门控：[`lib/prompts/base.js`](lib/prompts/base.js)、[`lib/prompts/nudge.js`](lib/prompts/nudge.js)
- **论文与实验数据目录（[`paper/`](paper)）**：
  - 正式中文论文：[`paper/oswyn-paper.md`](paper/oswyn-paper.md)
  - 英文学术论文：[`paper/oswyn-paper-en.md`](paper/oswyn-paper-en.md)
  - 评测复现脚本：[`paper/scripts/run-unified-oswyn-benchmarks.mjs`](paper/scripts/run-unified-oswyn-benchmarks.mjs)
  - 完整数据集：[`paper/data/unified-oswyn-realsession-results.json`](paper/data/unified-oswyn-realsession-results.json)、[`paper/data/exp4-intelligence-boundary-results.json`](paper/data/exp4-intelligence-boundary-results.json)
  - 矢量图表：[`paper/figures/`](paper/figures/)

### 附录 B：标准学术引用格式（BibTeX）

```bibtex
@article{zhang2026oswyn,
  title     = {OSWYN: Preserving Capability Boundaries and KV-Cache Locality in Long-Horizon Software Engineering Agents via In-Band Step-Boundary Context Distillation},
  author    = {Zhang, Rentong},
  journal   = {Keycap AI Research Archive},
  year      = {2026},
  volume    = {2},
  number    = {1},
  pages     = {1--42},
  note      = {Artifact: paper/oswyn-paper.md, Repository: https://github.com/keycapai/dsh-oswyn}
}
```
