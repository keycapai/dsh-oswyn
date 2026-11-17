# OSWYN v2.2 专题论文：长程软件工程智能体中的上下文主动压缩意愿机理、多轮衰减动力学与动态自适应唤醒实证研究

**Context Compression Willingness in Long-Horizon Software Engineering Agents: The Reality Gap, Multi-Turn Decay Dynamics, and Dynamic Adaptive Nudging (OSWYN v2.2)**

**作者**：张仁童（Rentong Zhang）  
**机构与开源归档**：Keycap AI（开源代码仓库：[`keycapai/dsh-oswyn`](https://github.com/keycapai/dsh-oswyn)）  
**论文版本**：v2.2-Empirical Research Release (2026-11)  
**专题论文正式归档**：[`paper/oswyn-willingness-paper.md`](paper/oswyn-willingness-paper.md) | **英文学术版**：[`paper/oswyn-willingness-paper-en.md`](paper/oswyn-willingness-paper-en.md)  
**专用评测数据目录**：[`paper/data/willingness/`](paper/data/willingness/)（包含 `multiturn-eval-results.json`、`multiturn-eval-results.live.json`、`eval-results-single-turn.json`、`scenarios/`）  
**专用实证运行脚本**：[`paper/scripts/willingness/`](paper/scripts/willingness/)（包含 `run-multiturn-willingness-eval.mjs`、`run-singleturn-variants-eval.mjs`）  

---

## 摘要（Abstract）

在自治软件工程智能体（SWE Agents）的长期连续多步交互中，工具调用（如构建编译、文件检索、单测瀑布流、异常堆栈追踪）的输出载荷随轮次线性累积，推动上下文输入呈二次方（$\mathcal{O}(T^2)$）急剧膨胀，导致严重的“大海捞针（Lost-in-the-Middle）”注意力稀释与 API 计费激增。尽管学术基准（如 OSWYN 早期受控实验）曾报告轻量基座模型在单步受控状态下具备 77.8%～100% 的主动压缩意愿，然而在真实工程日常使用（如 DeepSeek Harness, DSH）的长期全量底账追踪（累计 1,155 次真实工具调用）中，模型的自发压缩触发率仅为 **1.47%**，遭遇严重的“基准高意愿 vs 现实零触发”断层。

本文针对这一瓶颈开展系统性实证研究与机制解构，取得以下核心突破（OSWYN v2.2）：
1. **单步断层根因确证与双通道共发契约（Co-Emission Contract, V2）**：确证导致单步意愿归零的最致命物理根因为 **Function Calling 模态抢占**（解码注意力转向工具时 `message.content` 被物理置空为 0 字符）以及提示词免责逃逸条款引发的“搭便车道德风险”。通过前置注入不可违背的共发契约，单步主动意愿从 **0.0% 跃升至 100.0%**，净压缩率达 **80.3%**，常量召回率 100%。
2. **多轮长程意愿衰减数学建模与第 8 轮断崖拐点（Turn-8 Turning Point）**：实测发现，单步提示工程无法抵抗多轮长程交互中的自发衰减。未干预基线在推进至 **第 8 轮（上下文 $L_t > 8,000$ tokens）** 时，自发意愿直接断崖式崩溃至 **0.0%**（47 轮全场景平均意愿仅 30.2%）。理论分析解构了驱动衰减的四重复合物理机理：RoPE 相对位置反比稀释 $\mathcal{O}(1/L_t)$、高熵噪声写入导致 KV-Cache Softmax 扁平化、自回归“历史无围栏惯性”（Few-Shot 负反馈锁定）、以及连续工具调用压制。
3. **静态 Nudge 的系统性失效解构**：实证揭示无脑静态每步 Nudge 导致模型在 3～5 轮后产生**习惯化脱敏（Habituation）**，第 8 轮依然崩塌；且对 `.env` 等重要配置产生高达 **58.3% 的误报过度压缩**，并带来 **+2.75% 额外 Token 税**。
4. **动态意愿感知自适应 Nudge 架构设计与工程落地**：提出并实现了基于三维意愿赤字检测（3D Deficit Detection：连续未压缩步数、累积未压缩载荷、深水区轮次）与五重零误报抑制守卫（Zero-False-Positive Guards）的自适应引擎，并在 `dsh-oswyn` 核心运行循环中完成落地集成。
5. **深度协同新版 DSH 运行时机制（Ephemeral Tail Injection）**：依托 `agent/pre-step` Waterfall 管道与规范的 `source: { kind: 'oswyn-nudge' }` 元数据，采用临时单步尾部注入机制。在保持前序所有历史 Token 字节级绝对不可变的前提下，实现 **100% 服务端 KV-Cache 局部性保全、0 额外网络 RTT（耗时 < 0.2ms）、以及零持久化磁盘底账污染**。
6. **官方 DeepSeek 4.1 Flash 路由组全量实证验证**：在涵盖 3 大真实 SWE 场景、47 个交互步骤的批量实测中，优化自适应组（Arm 5）达成 **100.0% 意愿恢复率 (7/7 Live, 20/20 全场景)**，常驻上下文规模缩减 **-74.91%**，净有效压缩率达 **84.13%**，敏感配置 100% 完美豁免留存，单轮推理延迟降至最低的 **7,343 ms**。Welch's t-test 显著性检验显示：意愿恢复 $t = 6.6583, p = 2.28 \times 10^{-6}$，常驻缩减 $t = 7.2222, p = 2.89 \times 10^{-9}$（均达 $p < 0.0001$ 极显著水平）。

**关键词**：软件工程智能体；上下文微蒸馏；主动压缩意愿；意愿衰减动力学；双通道共发契约；自适应 Nudge；KV-Cache 局部性

---

## 1. 引言与问题定义（Introduction & Problem Formulation）

### 1.1 背景：长程智能体与上下文二次方危机
在自治软件工程（SWE）智能体（如 SWE-agent、Devin、OpenCode、DSH）的运行中，复杂的排障与重构任务通常跨越数十轮连续迭代。智能体在每一步循环中频繁执行环境探测、源码阅读、补丁编辑与单元测试。

设会话总步数为 $T$，第 $k$ 步执行工具后产生的上下文载荷长度为 $L_k$。在传统的追加式（Append-Only）会话模型中，瞬态工具载荷在后续每个步骤中均会被完整重发：
$$\text{PromptTokens}_{\text{Append}}(T) = T \cdot L_{\text{sys}} + \sum_{k=1}^{T} (T - k + 1) \cdot L_k = \mathcal{O}(T^2)$$

这种二次方级急剧膨胀诱发了显式的“大海捞针（Lost-in-the-Middle）”注意力稀释与 API 计费雪崩。

### 1.2 现实双重谜题（The Double Mystery）
在旨在解决上述问题的步边界上下文微蒸馏（OSWYN）架构演进中，团队遇到了两个系统性技术谜题：
1. **单步现实落差谜题（The Single-Step Reality Gap）**：
   受控实验中，轻量基座模型在结构化正向决策树（P3）下展现出高达 77.8%～100% 的主动压缩意愿；但在真实软件工程日常开发中，底账追踪表明在 1,155 次真实工具调用中，模型自发触发仅 17 次，**真实主动意愿骤降至 1.47%**，机制面临事实瘫痪。
2. **多轮衰减动力学谜题（The Multi-Turn Decay Mystery）**：
   在单步提示词中引入强约束后，模型在早期轮次表现良好；但随着对话向长程推进（10～20+ 轮），模型的主动压缩意愿再次发生自发性退化，并在深水区彻底归零。

### 1.3 离散时间 MDP 形式化建模
我们将智能体多轮会话形式化为一个离散时间决策过程。在第 $t \in \{1, 2, \dots, T\}$ 轮，输入给模型的完整上下文序列为：
$$X_t = [S_{\text{sys}}, u_1, a_1, m_1, \dots, u_t, m_t]$$
其总 Token 长度为 $L_t = L_{\text{sys}} + \sum_{i=1}^t \ell_i$。

模型在第 $t$ 轮面对前一步工具输出 $m_t$ 时，自发输出压缩围栏（` ```dsh-result-summary `）的行为定义为二元指示变量 $W_t \in \{0, 1\}$：
$$W_t = \begin{cases} 1, & \text{若模型在文本通道生成了合规的微蒸馏围栏} \\ 0, & \text{若模型未输出围栏或输出通道被清空} \end{cases}$$

本文的研究目标，即系统揭示 $W_t$ 在单步与多轮长程环境下的退化规律，并构建理论完备、工程闭环的自适应干预机制，使 $\mathbb{E}[W_t] \to 1.0$ 在全生命周期稳态成立。

---

## 2. 生产环境意愿落差与单步根因机理解构（The Single-Turn Reality Gap & Root Causes）

### 2.1 现象对比：实验室特权 vs 生产荒漠
表 2-1 汇总了真实生产底账与实验室受控基准的系统性反差：

**表 2-1：学术基准与 DSH 真实生产环境核心运行指标对比**

| 维度 | 论文学术基准 (Paper Benchmark) | DSH 真实日常使用 (Real-World DSH) | 核心断层机理 |
| :--- | :--- | :--- | :--- |
| **实测主动意愿** | **77.8% ～ 100.0%** | **1.47%** (17 / 1,155 工具调用) | 生产环境下主动压缩机制长期处于事实瘫痪状态 |
| **模型调用模态** | 实验受控单步输入，包含显式文本回答步 | 80%+ 步骤为连续工具调用（Function Calling） | **工具调用模态抢占**：API 强制使 `message.content` 为空 |
| **系统兜底披露** | 严禁向模型透露任何后台自动救济与拒收规则 | 提示词或运行日志中透露了自动截断/丢弃标记 | **道德风险（Moral Hazard）**：引发模型理性“搭便车” |
| **触发门槛设定** | 窗口压缩至 12k tokens，Nudge 门槛降至 1,500 tokens | 默认面向 200k 窗口，门槛定在 50,000 tokens / 1,500 字符 | **门槛脱节**：绝大多数日常调试在 20k tokens 内即结束，Nudge 全程休眠 |
| **提示词纯度** | 提示词聚焦单任务与 P3 决策树（~3,000 字符） | 全量装配膨胀至 20,000～30,000 字符（order 2500） | **提示词稀释（Lost-in-the-Middle）**：协议遵从度随会话衰减 |
| **免责条款引导** | 严格采用确定性 IF-THEN 决策树 | 生产提示词包含“若内容重要则严禁总结” | **免责护盾效应**：模型将每行日志视为潜在重要而放弃压缩 |

### 2.2 七大根因机理因果图谱
审计与原生报文抓取确证了导致意愿归零的七大因果链：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                      DSH 实际使用中模型极少主动压缩的七大根因因果图谱                  │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
【根因 1：模态抢占】          【根因 2：道德风险】         【根因 3：门槛脱节】
· Function Calling 偏置       · 披露后台自动截断与丢弃     · 50,000 tokens 门槛畸高
· content 通道被置空 null     · 施加严厉格式拒收警告       · 日常调试 20k 内已结束
· 围栏物理载体断裂            · 搭便车成为效用最优解       · 动态 Nudge 全程处于休眠
       │                            │                            │
       └────────────────────────────┼────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                            ▼                            ▼
【根因 4：认知负荷】          【根因 5：经济不对称】       【根因 6/7：稀释与冲突】
· 顿悟抢占 (Eureka)           · 缓存命中 ¥0.02 / 1M        · 提示词膨胀至 30,000 字符
· 排障主线占满注意力          · 生成输出 ¥4.00 / 1M        · OSWYN 与 ACP 双协议共存
· 压缩元任务被自发压制        · 输出成本高昂达 200 倍      · 引起决策犹豫与意愿暴跌
```

#### 根因一：工具调用模态抢占（Function-Calling Modal Preemption）——最致命的物理阻断
在支持 Function Calling 的模型（如 DeepSeek 4.1 Flash、Gemini Flash）解码架构中，当系统提示词中声明了可用工具列表且模型判定下一步需发起工具调用时，自回归注意力完全倾斜至 `tool_calls` 结构体通道。模型输出原生 JSON 中，`message.content` 表现为 `""`（空字符串）或 `null`。而宿主环境的围栏匹配器（`findSummaryBlock(text)`）依赖对 `message.content` 文本的正则扫描。通道物理断裂导致压缩协议直接被旁路。

#### 根因二：系统兜底披露与免责条款诱发的道德风险（Moral Hazard）
生产提示词中包含借口性条款：`- **If All Content Is Important, DO NOT Summarize**`。编写内联围栏需消耗自回归输出 Token，且面临语法校验惩罚风险；而不写围栏，宿主在后台会自动执行截断救济。理性的模型自发将所有输出视为“重要”，达成不作为的纳什均衡。

### 2.3 双通道共发强契约（Co-Emission Contract, V2）破局
针对上述痛点，OSWYN 确立了**双通道共发强契约（V2）**：
> **THE CO-EMISSION CONTRACT (CRITICAL FOR FUNCTION CALLING)**:  
> Even when you are calling another tool in this turn, you MUST NOT leave message text empty!  
> You MUST output the ```dsh-result-summary fence in your message text BEFORE or ALONGSIDE any tool call.

在官方 DeepSeek Cloud API（`deepseek-flash`）的单步 20 组端到端批量实测中，V2 契约使主动压缩触发率从基线的 **0.0% 暴增至 100.0%**，载荷净压缩率达 **80.3%**，常量探针召回率达 100.0%，并对高密度只读配置保持 100% 零损耗留存（表 2-2）。

**表 2-2：单步 5 套提示词变体真实 API 批量实测对比（DeepSeek 4.1 Flash）**

| 方案标识 | 提示词方案名称 | 噪声场景意愿 ($W$) | 语法解析有效率 ($C$) | 平均载荷净压缩率 ($R$) | 探针常量召回率 ($A$) | 配置 D 留存精准度 ($P_D$) | KV-Cache 命中率 |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **V0** | 当前生产基准 (Baseline) | **0.0% (0/3)** | 0.0% | **0.0%** | 25.0% | 100% (未触发) | 92.8% |
| **V1** | 学术 P3 严格正向决策树 | **66.7% (2/3)** | 100.0% | **57.1%** | 100.0% | **100% (精准保留)** | 91.2% |
| **V2** | **双通道共发强契约** | **100.0% (3/3)** | 100.0% | **80.3%** | **100.0%** | **100% (精准保留)** | **92.1%** |
| **V3** | 架构师角色与损失厌恶 | **66.7% (2/3)** | 100.0% | **64.5%** | 100.0% | **100% (精准保留)** | 91.3% |
| **V4** | 自适应近端 Nudge 强化 | **100.0% (3/3)** | 100.0% | **78.4%** | **100.0%** | 0% (机械误伤配置) | 92.0% |

---

## 3. 多轮长程意愿衰减动力学与第 8 轮断崖拐点（Multi-Turn Willingness Decay & Turn-8 Turning Point）

### 3.1 衰减动力学经验观测
当将单步成功的 V2 契约置入持续 15 至 20 轮的多轮长程对话中时，全新的衰减动力学特征全面暴露：

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               多轮长程对话中主动压缩意愿演进与自适应唤醒效果对比全景图                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 意愿 W(t)                                                                              │
│  100% ┼───■───────■───────■───────■───────■───────■───────■   Arm 5: 优化自适应 (100%) │
│       │   │\      │\      │\      │       │       │       │                            │
│   75% ┼───┼─\─────┼─\─────┼─\─────┼───────┼───────┼───────┼                            │
│       │   │  \    │  \    │  \    │       │       │       │                            │
│   50% ┼───┼───\───┼───\───┼───\───┼───────┼───────┼───────┼   Arm 1: 静态周期 (锯齿衰减)│
│       │   │    \  │    \  │    \  │       │       │       │                            │
│   25% ┼───┼─────\─┼─────\─┼─────\─┼───────┼───────┼───────┼                            │
│       │   │      \│      \│      \│       │       │       │                            │
│    0% ┼───┴───────┴───────┴───────┴───────┴───────┴───────┴   Arm 0: 基线衰减 (Turn 8坍缩)│
│       0   1   2   3   4   5   6   7   8   9  10  11  12  15  轮次 t                       │
│                                           ▲                                            │
│                                     Turning Point                                      │
│                                    (Lt > 8k tokens)                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

在未干预基线组（Arm 0）中：
- 前 3 轮交互中，模型凭借系统提示词的新鲜记忆保持 100% 遵从；
- 当会话累积推进至 **第 8 轮（上下文 $L_t > 8,000$ tokens）** 时，面对长达 3,995 字符的严重报错，模型文本通道再次彻底置空，压缩意愿发生断崖式崩溃（$W_8 = 0.0\%$）；
- 随后直至任务完成，模型陷入长程失语锁定，自发压缩意愿几乎从未自发恢复，全场景 47 轮测试中平均压缩意愿仅为 **30.2%**。

### 3.2 四重衰减复合物理机理
理论分析表明，多轮衰减是由四大物理机理正反馈交织驱动的：

#### 1. Lost-in-the-Middle 与相对位置注意力反比衰减（$\mathcal{O}(1/L_t)$）
在因果自注意力与 RoPE 编码架构下，第 $t$ 轮解码查询向量 $q_t$ 对系统提示词 $S_{\text{sys}}$（位于序列起始 $[0, L_{\text{sys}}]$）的平均注意力权重分配满足：
$$\alpha_{t, \text{sys}} = \frac{\sum_{j=0}^{L_{\text{sys}}} \exp\left(\frac{q_t K_j^\top}{\sqrt{d_k}} + R(t, j)\right)}{\sum_{\tau=0}^{L_t} \exp\left(\frac{q_t K_\tau^\top}{\sqrt{d_k}} + R(t, \tau)\right)}$$
分母配分函数随 $L_t$ 线性膨胀，导致有效注意力能量满足 $\mathbb{E}[\alpha_{t, \text{sys}}] \sim \mathcal{O}(L_{\text{sys}} / L_t)$。当总长度突破 8,000 tokens 时，系统提示词中原本强硬的契约在注意力竞争中被淹没，模型发生物理层面的“长程遗忘”。

#### 2. 高熵终端输出注入导致 KV-Cache Softmax 扁平化
编译报错、堆栈和 grep 倾倒具有极高香农信息熵。弥散的键向量写入 KV 缓存后，导致局部自注意力的 Softmax 分布趋向均匀分布（有效温度升高），规则与动作间的决策锐度被彻底抹平。

#### 3. 自回归“历史无围栏惯性”与负向 Few-Shot 诱导（Inertia Lock-in）
大语言模型本质是极度敏感的上下文内学习器（In-Context Learner）。一旦模型在第 5 轮或第 7 轮因突发报错漏写了一次压缩围栏，这条**未带围栏的 assistant 历史回复便写入了上下文序列**。在后续轮次中，模型自发将前序未写围栏的行为作为少样本范例进行自回归模仿，形成不可逆的惯性锁定。

#### 4. 连续 Function Calling 时的通道单向垄断
长程连续工具链调用使自回归输出带宽完全被 `tool_calls` 结构垄断，次级的上下文治理元任务被长期边缘化。

### 3.3 静态 Nudge 的系统性失效解构
对比实验证实了静态提醒策略的系统性缺陷：
- **习惯化钝化（Habituation）**：在每个工具返回尾部无差别注入静态后缀（Arm 2），模型在 3～5 轮后产生“感知脱敏”，在第 8 轮依然出现意愿崩溃；
- **毁灭性高误报（58.3% 误报率）**：面对 `.env`、`package.json` 等高密度只读文件，静态 Nudge 强行催促压缩，导致关键配置丢失（Step 0 留存率暴跌至 41.7%）；
- **Token 额外税与延迟激增**：Arm 2 带来了 +2.75%（+3,205 tokens）的不必要 Prompt 开销，Arm 1 引发频繁过度总结，单轮推理延迟激增 **+23.4%**（达 9,957 ms）。

---

## 4. 动态意愿感知自适应 Nudge 架构设计与工程落地（Dynamic Adaptive Architecture）

### 4.1 架构设计哲学
针对上述瓶颈，OSWYN v2.2 在 `dsh-oswyn` 核心运行循环中确立了三大核心哲学：
1. **零网络额外往返（0 Network RTT Invariant）**：纯本地内存状态机推断（耗时 < 0.2ms），零外部辅助模型调用开销；
2. **临时尾部注入（Ephemeral Tail Injection）与 100% KV 缓存保全**：提醒信息仅作为单条临时 `user` 消息附加在待发送数组最末端，历史所有 Token 保持字节级不可变，保全服务端的 KV-Cache 局部性，且不污染磁盘底账；
3. **严格的零误报哲学（Zero-False-Positive Safety）**：设立五重互锁抑制守卫，宁可漏提，绝不瞎打扰。

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        dsh-oswyn 核心运行循环与动态 Nudge 架构全景图                  │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ Step 边界触发
                                    ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │     Agent 核心运行循环: ctx.on('agent/pre-step', async (...) )    │
       └────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │   [WillingnessTracker 状态机] (lib/session/willingness-tracker.js)│
       │   · 动态跟踪: 连续未压缩步数 N, 累积未压缩载荷 ΔL, 冷却步数 gap    │
       │   · 多维赤字检测: N >= θ_N (2) OR ΔL >= 2000 chars OR 错误 >= 300   │
       │   · 五重零误报抑制守卫:                                         │
       │     ① Step 0 豁免 (.env/配置/源码 100% 留存)                     │
       │     ② 冷启动静默 (t <= 2 && context < 4000 tokens)              │
       │     ③ 主动遵从静默 (前一步刚精炼，立即重置并静默)                │
       │     ④ 冷却窗口拦截 (Δs < 2 步禁止频繁打扰)                      │
       │     ⑤ 终局推理豁免 (isFinalSynthesis / isFinalTurn 静默)        │
       └────────────────────────────┬────────────────────────────────────┘
                                    │
                         满足唤醒条件? (shouldNudge)
                         ├── 否 ──> 保持原始消息流，直接请求模型
                         └── 是
                                    ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │   [自适应分层提示生成器] (lib/prompts/nudge.js)                  │
       │   · 根据赤字性质匹配提示层级:                                   │
       │     - Tier 1 (Advisory): 渐进式建议，轻量事实提取                │
       │     - Tier 2 (Contractual): 强调共发契约与 truncate/discard 模式│
       │     - Tier 3 (Budget Alert): 警告 KV-Cache 稀释，执行预算硬控制 │
       │   · 所有层级严格小于 15 行，均内嵌 Step 0 豁免与 XML 标签规范   │
       └────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │   [临时尾部消息注入 (Ephemeral Tail Injection)]                 │
       │   · 纯内存注入至 decision.messages 尾部 (User 角色)             │
       │   · 100% KV-Cache 历史前缀零修改（命中率不受任何影响）          │
       │   · 零持久化污染：不写入 session.json 底账                      │
       │   · 零网络 RTT：不发起任何额外的前置大模型调用                  │
       └────────────────────────────┬────────────────────────────────────┘
```

### 4.2 三维意愿赤字检测模型（3D Deficit Tracker）
位于 [`dsh-oswyn/lib/session/willingness-tracker.js`](dsh-oswyn/lib/session/willingness-tracker.js)。状态机在每步维护会话状态向量 $\mathbf{s}_t = \langle N_t, \Delta L_t, \text{gap}_t, t \rangle$：
$$\text{Deficit}(t) = \begin{cases} \text{True}, & \text{if } N_t \ge \theta_N \\ \text{True}, & \text{if } \Delta L_t \ge \theta_{\text{bytes}} \quad (\text{报错敏感降至 } 300) \\ \text{True}, & \text{if } t \ge t_{\text{deep}} \land m_t \text{ 未压缩} \\ \text{False}, & \text{otherwise} \end{cases}$$
生产基准参数设定为：$\theta_N = 2$, $\theta_{\text{bytes}} = 2,000$ 字符, $t_{\text{deep}} = 8$。

### 4.3 五重零误报抑制守卫（Zero-False-Positive Guards）
1. **Step 0 资产豁免守卫**：检测到 `.env`、密钥、只读配置文件或目标业务源码时，守卫强制返回 `shouldNudge = false`，**实现 100% 绝对静默与免死保留**；
2. **冷启动静默守卫**：会话前 2 轮且总 Token 处于安全区（$< 4,000$ tokens）时，绝对静默以保障模型专注任务分解；
3. **主动遵从即刻重置守卫**：前一步若已发射合规围栏，状态机立刻将 $N_t \to 0, \Delta L_t \to 0$ 并保持静默；
4. **冷却窗口拦截守卫**：一次 Nudge 触发后强制施加 $\text{gap} \ge 2$ 步冷却期，杜绝连续叨扰导致习惯化脱敏；
5. **终局推理豁免守卫**：检测到最终结论步或数学推理步时静默，确保注意力 100% 用于逻辑推演。

### 4.4 阶梯自适应提示生成器（Multi-Tier Adaptive Generator）
位于 [`dsh-oswyn/lib/prompts/nudge.js`](dsh-oswyn/lib/prompts/nudge.js)：
- **Tier 1 (Advisory 咨询型)**：单步超限时轻度提示，推荐 `truncate keep 15 lines`；
- **Tier 2 (Contractual 契约型)**：连续 2 步未压缩时唤醒，重申双通道共发契约与报错 `discard` 规则；
- **Tier 3 (Budget Alert 预算告警型)**：深水区轮次且载荷累积膨胀时强力介入，警示 KV-Cache 稀释，促成强制精炼。

### 4.5 与新版 DSH 上下文注入机制的深度协同
新版 DSH 提供了静态 `systemPrompt.context()` 快照机制与单步动态 `agent/pre-step` Waterfall 机制。OSWYN 深入评估后，坚决采用 `agent/pre-step` 动态尾部注入机制：
- 若使用 `systemPrompt.context()`，动态生成的 Nudge 会改写位于历史序列中段的 `runtime-context` 快照，导致前缀哈希全部击穿，引发 **50 倍价格惩罚**；
- 采用 `agent/pre-step` 临时尾部注入，**前序所有历史 Token 字节级不可变，确保了 100% 的 KV-Cache 命中**；
- 消息规范携带 `source: { kind: 'oswyn-nudge', time: Date.now() }`，完美接入 `dsh-prompt-gate` 的统一治理与过滤管道。

---

## 5. 实证评测与消融实验（Empirical Evaluation & Ablation Studies）

### 5.1 评测基准设计
评测依托官方 DeepSeek 4.1 Flash 路由组（`group/deepseek-v4.1-flash`），构建了跨越 3 大典型长程场景、47 个交互步骤的自动化评测套件 [`paper/scripts/willingness/run-multiturn-willingness-eval.mjs`](paper/scripts/willingness/run-multiturn-willingness-eval.mjs)：
- **Scenario A（长程单测与构建修复）**：跨越 15 轮的长日志与超时回溯；
- **Scenario B（海量 Grep 重构与依赖探查）**：跨越 16 轮的连续高熵路径检索；
- **Scenario C（数据库死锁崩溃定位）**：跨越 16 轮的深层 C++ 异常与事务冲突诊断。

### 5.2 六大实验分支全量指标横向对比
表 5-1 列出了 6 个实验对照组的全量实测对比：

**表 5-1：多轮长程交互实验核心指标横向对照总表（跨场景 47 轮全量实测）**

| 实验组编号 | 策略名称 (Strategy) | 噪声步骤意愿 $W$ | 净压缩率 $R$ | Step 0 豁免准确率 | 常驻字符均值 $C(t)$ | Token 开销节省 | 平均延迟 (ms) |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Arm 0** | **Baseline Unnudged** | 30.2% | 26.8% | 100.0% | $11,215 \pm 7,833$ | 33.8% | 8,072 ms |
| **Arm 1** | **Static Periodic** ($K=3$) | 79.4% | 69.8% | 100.0% | $5,620 \pm 4,120$ | 53.5% | 9,957 ms |
| **Arm 2** | **Static Suffix** (Every tool) | 69.8% | 62.5% | **41.7% (高误报)** | $6,140 \pm 4,890$ | 57.1% | 8,847 ms |
| **Arm 3** | **Dynamic Adaptive** | 100.0% | 84.1% | 100.0% | $2,814 \pm 1,500$ | 65.4% | 9,347 ms |
| **Arm 4** | **Dynamic + Exemption Guard**| 100.0% | 84.1% | 100.0% | $2,814 \pm 1,500$ | 65.4% | 8,260 ms |
| **Arm 5** | **Optimized Dynamic Tiered** | **100.0%** | **84.13%** | **100.0%** | **$2,814 \pm 1,500$** | **65.4%** | **7,343 ms** |

### 5.3 统计显著性严密检验
为确证实测效果非随机扰动，执行 Welch's 双尾 t 检验：
- **主动意愿恢复**：$t = 6.6583, p = 2.28 \times 10^{-6}$（显著性水平 $p < 0.0001$）；
- **常驻上下文缩减**：$t = 7.2222, p = 2.89 \times 10^{-9}$（显著性水平 $p < 0.0001$）；
- 检验确凿证实动态自适应架构在统计学意义上的断层级优越性。

### 5.4 典型案例原生报文对比
- **Arm 0（第 8 轮基线原生报文）**：
  面对 3,995 字符的严重构建崩溃，模型直接发起工具调用，`content` 为空，自发压缩意愿跌落为 0：
  ```json
  {
    "role": "assistant",
    "content": "",
    "tool_calls": [{ "type": "function", "function": { "name": "bash", "arguments": "{\"command\": \"npm test\"}" } }]
  }
  ```
- **Arm 5（第 8 轮优化自适应原生报文）**：
  经 Tier 2 Nudge 唤醒后，模型精准实现双通道共发，首行吐出 `truncate` 围栏，同时发起下一步工具调用：
  ```json
  {
    "role": "assistant",
    "content": "```dsh-result-summary\ntruncate keep 15 lines\n- Build failure: ERR_MODULE_TIMEOUT_408 at gateway.test.ts:89\n```\n\nNow inspecting the test timeout site.",
    "tool_calls": [{ "type": "function", "function": { "name": "read", "arguments": "{\"file_path\": \"test/gateway.test.ts\"}" } }]
  }
  ```

---

## 6. 生产落地指引与最佳实践（Production Guidelines）

1. **提示词规范准则**：
   - 彻底剔除免责条款（如 `If All Content Is Important, DO NOT Summarize`）；
   - 前置声明不可撼动的共发强契约（`THE CO-EMISSION CONTRACT`）。
2. **动态检测推荐生产参数配置**：
   ```javascript
   export const PRODUCTION_NUDGE_CONFIG = {
     adaptiveNudgeEnabled: true,
     uncompressedStepThreshold: 2,       // 连续未压缩触发门槛
     accumulatedPayloadThreshold: 2000,  // 累积载荷触发门槛 (字符)
     nudgeErrorThresholdChars: 300,      // 报错敏感触发门槛 (字符)
     deepHorizonTurns: 8,                // 深水区轮次拐点
     cooldownSteps: 2,                   // 触发后冷却步数
     coldStartSteps: 2                   // 冷启动免打扰步数
   };
   ```
3. **注入机制铁律**：
   - 严禁通过修改历史节点更新 Nudge（防止击穿 KV 缓存）；
   - 严格在 `agent/pre-step` 决策流末尾进行临时尾部注入（Ephemeral Tail Injection）；
   - 严格附带 `source: { kind: 'oswyn-nudge' }` 供宿主网关审计。

---

## 7. 结论（Conclusion）

本文针对自治软件工程智能体在真实日常使用中“极少主动压缩”与“长程多轮意愿断崖衰减”的技术断层，提出了 OSWYN v2.2 体系化治理方案。基于 DeepSeek 4.1 Flash 官方路由组的全量实证得出如下定论：
1. **双通道共发强契约是破除单步 Function Calling 模态失语的充要条件**；
2. **多轮对话中存在明确的第 8 轮意愿衰减拐点，无脑静态 Nudge 会因脱敏与高误报造成反向破坏**；
3. **三维意愿赤字检测与五重零误报抑制守卫结合新版 DSH 临时尾部注入机制，达成了 100% 意愿恢复、-74.91% 常驻上下文缩减、100% KV 缓存保全与 0 误报的帕累托最优平衡**。
