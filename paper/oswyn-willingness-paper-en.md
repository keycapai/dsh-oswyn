# OSWYN v2.2 Dedicated Paper: Context Compression Willingness in Long-Horizon Software Engineering Agents: The Reality Gap, Multi-Turn Decay Dynamics, and Dynamic Adaptive Nudging

**Context Compression Willingness in Long-Horizon Software Engineering Agents: The Reality Gap, Multi-Turn Decay Dynamics, and Dynamic Adaptive Nudging (OSWYN v2.2)**

**Author**: Rentong Zhang  
**Organization & Open Source Repository**: Keycap AI ([`keycapai/dsh-oswyn`](https://github.com/keycapai/dsh-oswyn))  
**Paper Version**: v2.2-Empirical Research Release (November 2026)  
**Dedicated Paper Formal Path**: [`paper/oswyn-willingness-paper-en.md`](paper/oswyn-willingness-paper-en.md) | **Chinese Version**: [`paper/oswyn-willingness-paper.md`](paper/oswyn-willingness-paper.md)  
**Dedicated Empirical Datasets**: [`paper/data/willingness/`](paper/data/willingness/) (contains `multiturn-eval-results.json`, `multiturn-eval-results.live.json`, `eval-results-single-turn.json`, `scenarios/`)  
**Dedicated Evaluation Scripts**: [`paper/scripts/willingness/`](paper/scripts/willingness/) (contains `run-multiturn-willingness-eval.mjs`, `run-singleturn-variants-eval.mjs`)  

---

## Abstract

In long-horizon interactions of autonomous software engineering (SWE) agents, the volume of tool execution payloads (compilation cascades, file scans, unit test waterfalls, stack traces) accumulates linearly across steps, causing total prompt tokens to grow quadratically ($\mathcal{O}(T^2)$). This explosion induces severe "Lost-in-the-Middle" attention dilution and exponential API billing costs. Although controlled laboratory benchmarks previously reported high voluntary distillation willingness (77.8%–100%) for lightweight models under positive decision trees, comprehensive telemetry across 1,155 real-world tool calls in daily engineering deployments (e.g., DeepSeek Harness, DSH) revealed an alarming **1.47%** actual trigger rate—exposing a vast "benchmark vs. reality" chasm.

This paper conducts a systematic empirical investigation and architectural resolution, delivering the following core breakthroughs (OSWYN v2.2):
1. **Single-Turn Reality Gap Deconstruction & The Co-Emission Contract (V2)**: We identify the primary physical root causes: **Function-Calling Modal Preemption** (autoregressive decoding bandwidth monopolized by `tool_calls`, suppressing `message.content` to 0 characters) and moral hazard from disclosed background fallbacks and opt-out clauses. Enforcing the mandatory Co-Emission Contract elevates single-turn proactive willingness from **0.0% to 100.0%**, with **80.3%** net compression and 100% constant recall.
2. **Mathematical Formulation of Multi-Turn Willingness Decay & The Turn-8 Collapse**: We discover that single-turn prompt engineering fails to withstand multi-turn context dilution. In unnudged dialogues, upon crossing **Turn 8 ($L_t > 8,000$ tokens)**, model compression willingness collapses to **0.0%** (averaging only 30.2% across 47 turns). We formalize the four compounding causal mechanisms: positional attention dilution $\mathcal{O}(1/L_t)$, noise entropy injection flattening KV-cache Softmax distributions, autoregressive no-fence inertia (negative few-shot demonstration lock-in), and continuous tool suppression.
3. **Systemic Pitfalls of Static Nudging**: We empirically demonstrate that unconditioned per-tool suffix nudges trigger **sensory habituation desensitization** by Turn 8, impose an unbudgeted **+2.75% prompt token tax**, and cause a catastrophic **58.3% false-positive over-compression rate** on exempt configuration assets.
4. **Dynamic Willingness-Aware Nudge Architecture**: We introduce a production engine combining 3D Deficit Detection (consecutive uncompressed steps, accumulated payload bloat, deep horizon threshold) with Five Zero-False-Positive Guards, fully integrated into the `dsh-oswyn` agent loop.
5. **Synergy with DSH Context Injection via Ephemeral Tail Injection**: Operating within the `agent/pre-step` waterfall pipeline with standard `source: { kind: 'oswyn-nudge' }` metadata, the engine appends transient user notices to the message tail. By keeping preceding history byte-for-byte immutable, it achieves **100% server-side KV-cache locality preservation, zero extra network RTT (< 0.2ms local compute), and zero persistent disk ledger pollution**.
6. **Live Multi-Turn Validation on DeepSeek 4.1 Flash Routing Group**: Across 3 realistic SWE scenarios and 47 interaction steps on official `group/deepseek-v4.1-flash` routes, our optimized dynamic tiered arm (Arm 5) achieved **100.0% willingness recovery (7/7 Live, 20/20 cross-scenario)**, **-74.91% resident context reduction**, an **84.13% net compression ratio**, 100.0% sensitive asset retention, and the lowest step latency (**7,343 ms**). Welch's t-test confirms statistical significance at $t = 6.6583, p = 2.28 \times 10^{-6}$ for willingness recovery, and $t = 7.2222, p = 2.89 \times 10^{-9}$ for resident context reduction ($p < 0.0001$).

**Keywords**: Software Engineering Agents; Context Micro-Distillation; Proactive Compression Willingness; Willingness Decay Dynamics; Co-Emission Contract; Adaptive Nudging; KV-Cache Locality

---

## 1. Introduction & Problem Formulation

### 1.1 Long-Horizon SWE Agents and Quadratic Context Growth
Autonomous software engineering agents require tens or hundreds of multi-step iterations to investigate bugs and implement features. The cumulative prompt load across $T$ steps satisfies:
$$\text{PromptTokens}_{\text{Append}}(T) = T \cdot L_{\text{sys}} + \sum_{k=1}^{T} (T - k + 1) \cdot L_k = \mathcal{O}(T^2)$$

This quadratic growth dilutes attention, causing state hallucinations and exponential API token expenditures.

### 1.2 The Double Mystery
In deploying the OSWYN step-boundary in-band micro-distillation architecture, two persistent anomalies arose:
1. **The Single-Turn Reality Gap**: Models exhibited near-perfect willingness in controlled benchmark single turns, yet telemetry from 1,155 real developer interactions showed a dismal **1.47%** trigger rate.
2. **The Multi-Turn Decay Mystery**: Even when prompted with strict single-step instructions, models exhibited progressive decay across multi-turn sessions, completely ceasing distillation after several turns.

### 1.3 Formal MDP Formulation
We model the session as a discrete-time process $X_t = [S_{\text{sys}}, u_1, a_1, m_1, \dots, u_t, m_t]$ with total length $L_t = L_{\text{sys}} + \sum_{i=1}^t \ell_i$. Proactive willingness is modeled as a binary indicator $W_t \in \{0, 1\}$:
$$W_t = \begin{cases} 1, & \text{if the assistant emits a valid distillation block in } m_t \\ 0, & \text{if no fence is emitted or content is empty} \end{cases}$$
Our objective is to understand the decay dynamics of $W_t$ and engineer an adaptive intervention ensuring $\mathbb{E}[W_t] \to 1.0$ across the full interaction horizon.

---

## 2. The Single-Turn Reality Gap & Root Causes

Telemetry across 1,155 production tool executions revealed that voluntary distillation occurred only 17 times (1.47%). Forensic parsing established seven core root causes:
1. **Function-Calling Modal Preemption**: When generating tool calls, autoregressive decoding shifts entirely to `tool_calls`, leaving `message.content` as an empty string (0 chars).
2. **Moral Hazard & Opt-Out Clauses**: Prompts instructing `"If All Content Is Important, DO NOT Summarize"` provided rational models with an escape hatch, allowing them to free-ride on runtime fallbacks.
3. **Threshold Disconnect**: Early 50,000-token nudge thresholds remained dormant in 10k–20k developer sessions.
4. **Cognitive Eureka Preemption**: Locating bug root causes absorbed all active working memory bandwidth.
5. **Asymmetric Token Pricing**: Generating output tokens costs 200x more than cached input hits.
6. **Prompt Bloat & Dilution**: 30,000-character system prompts diluted inline protocol instructions.
7. **Protocol Interference**: Conflicting dual-compression directives fractured decision boundaries.

### Solution: The Co-Emission Contract (V2)
We established the immutable multi-modal directive:
> **THE CO-EMISSION CONTRACT (CRITICAL FOR FUNCTION CALLING)**:  
> Even when calling another tool in this turn, you MUST NOT leave message text empty!  
> You MUST output the ```dsh-result-summary fence in your message text BEFORE or ALONGSIDE any tool call.

Benchmarked across 20 live runs on DeepSeek 4.1 Flash, V2 elevated proactive willingness from **0.0% to 100.0%**, with **80.3%** net compression and 100% constant recall (Table 2-1).

**Table 2-1: Single-Turn Prompt Engineering Benchmark (DeepSeek 4.1 Flash)**

| Variant | Strategy Name | Noisy Willingness ($W$) | Syntax Validity ($C$) | Net Comp. ($R$) | Probe Recall ($A$) | Config(D) Preserved ($P_D$) | KV-Cache Hit |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **V0** | Baseline (Opt-Out Clause) | **0.0% (0/3)** | 0.0% | **0.0%** | 25.0% | 100% (Dormant) | 92.8% |
| **V1** | Strict Decision Tree (P3) | **66.7% (2/3)** | 100.0% | **57.1%** | 100.0% | **100% (Preserved)** | 91.2% |
| **V2** | **Co-Emission Contract** | **100.0% (3/3)** | 100.0% | **80.3%** | **100.0%** | **100% (Preserved)** | **92.1%** |
| **V3** | Loss Aversion Role-Play | **66.7% (2/3)** | 100.0% | **64.5%** | 100.0% | **100% (Preserved)** | 91.3% |
| **V4** | Adaptive Active Nudge | **100.0% (3/3)** | 100.0% | **78.4%** | **100.0%** | 0% (Over-pruned config) | 92.0% |

---

## 3. Multi-Turn Willingness Decay & The Turn-8 Collapse

Live empirical evaluations on `group/deepseek-v4.1-flash` revealed that single-turn prompting fails over extended sessions.

### 3.1 The Turn-8 Collapse Turning Point
In the unnudged baseline (Arm 0):
- Turns 1–3 maintain 100% willingness.
- Upon reaching **Turn 8 ($L_t > 8,000$ tokens)**, faced with a 3,995-character build error cascade, the model ceases distillation entirely ($W_8 = 0.0\%$).
- The model remains locked in an unfenced state for the remainder of the session (averaging 30.2% across 47 turns).

### 3.2 Four Compounding Causal Mechanisms
1. **Positional Attention Dilution ($\mathcal{O}(1/L_t)$)**: The system prompt's attention weight decays as context length expands.
2. **Noise Entropy & KV-Cache Softmax Flattening**: High-entropy logs raise effective attention temperature, blunting directive-action associations.
3. **Autoregressive No-Fence Inertia (Few-Shot Negative Lock-in)**: Once a fence is omitted, the unfenced assistant message serves as an in-context demonstration of omission.
4. **Continuous Function-Calling Modal Preemption**: Extended chains of tool invocations keep decoding bandwidth monopolized by action arguments.

### 3.3 Pitfalls of Static Nudging
- **Habituation Desensitization**: Static per-tool suffix notices (Arm 2) become white noise by Turn 8, failing to prevent willingness collapse.
- **Severe False-Positive Over-Compression (58.3% Error Rate)**: Static nudges coerce models into destructive summarization on `.env` and configuration files (Step 0 retention falls to 41.7%).
- **Token Tax & Latency Bloat**: Arm 2 incurs +2.75% (+3,205 tokens) prompt tax, while Arm 1 increases latency by +23.4% (to 9,957 ms).

---

## 4. Dynamic Willingness-Aware Nudge Architecture

### 4.1 Design Philosophy
1. **0 Network RTT Invariant**: Pure local in-memory state machine inference (< 0.2ms latency).
2. **Ephemeral Tail Injection & 100% KV-Cache Locality**: Nudges are appended as transient user messages to the tail of `decision.messages`. Preceding tokens remain byte-for-byte unchanged, preserving 100% KV-cache locality.
3. **Zero-False-Positive Safety**: Five interlocked guards ensure complete silence on protected assets.

### 4.2 3D Deficit Detection State Machine
Located at [`dsh-oswyn/lib/session/willingness-tracker.js`](dsh-oswyn/lib/session/willingness-tracker.js):
$$\text{Deficit}(t) = \begin{cases} \text{True}, & \text{if } N_t \ge \theta_N \\ \text{True}, & \text{if } \Delta L_t \ge \theta_{\text{bytes}} \quad (\text{lowered to } 300 \text{ for crashes}) \\ \text{True}, & \text{if } t \ge t_{\text{deep}} \land m_t \text{ uncompressed} \\ \text{False}, & \text{otherwise} \end{cases}$$
Production defaults: $\theta_N = 2$, $\theta_{\text{bytes}} = 2,000$ chars, $t_{\text{deep}} = 8$.

### 4.3 Five Zero-False-Positive Guards
1. **Step 0 Asset Protection**: 100% silence on `.env`, configuration, and source files.
2. **Cold-Start Silence**: Silent during Turns 1–2 when tokens $< 4,000$.
3. **Active-Compliance Silence**: Immediate counter reset and silence when distillation occurs.
4. **Cooldown Enforcement**: Enforces a 2-step minimum gap between interventions.
5. **Final-Turn Reasoning Exemption**: Silent during terminal calculation and proof steps.

### 4.4 Multi-Tier Adaptive Generator
Located at [`dsh-oswyn/lib/prompts/nudge.js`](dsh-oswyn/lib/prompts/nudge.js):
- **Tier 1 (Advisory)**: Gentle guidance recommending `truncate keep 15 lines`.
- **Tier 2 (Contractual)**: Reasserts the Co-Emission Contract and error `discard` rule.
- **Tier 3 (Budget Alert)**: Emphasizes KV-cache preservation and enforces hard compaction.

---

## 5. Empirical Evaluation & Ablation Studies

### 5.1 Benchmark Results (DeepSeek 4.1 Flash Routing Group)
Evaluated across 47 turns in 3 SWE scenarios using [`paper/scripts/willingness/run-multiturn-willingness-eval.mjs`](paper/scripts/willingness/run-multiturn-willingness-eval.mjs) (Table 5-1):

**Table 5-1: Multi-Turn Empirical Evaluation Across 47 Interaction Steps**

| Arm | Strategy & Mechanism | Noisy Turn Willingness ($W$) | Net Comp. Ratio ($R$) | Config/Code Retention | Mean Resident Chars | Prompt Token Savings | Mean Latency |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Arm 0** | **Baseline Unnudged** | **30.2%** (Turn 8 collapse to 0%) | 26.8% | 100.0% | $11,215 \pm 7,833$ | 33.8% | 8,072 ms |
| **Arm 1** | **Static Periodic** ($K=3$) | 79.4% (Severe sawtooth oscillation) | 69.8% | 100.0% | $5,620 \pm 4,120$ | 53.5% | 9,957 ms (+23.4%) |
| **Arm 2** | **Static Suffix** (Every tool) | 69.8% (Mid-to-late habituation) | 62.5% | **41.7% (58.3% False Positives)** | $6,140 \pm 4,890$ | 57.1% | 8,847 ms |
| **Arm 3** | **Dynamic Adaptive** | 100.0% | 84.1% | 100.0% | $2,814 \pm 1,500$ | 65.4% | 9,347 ms |
| **Arm 4** | **Dynamic + Guards** | 100.0% | 84.1% | 100.0% | $2,814 \pm 1,500$ | 65.4% | 8,260 ms |
| **Arm 5** | **Optimized Dynamic Tiered** | **100.0% (7/7 Live)** | **84.13%** | **100.0% (Zero Loss)** | **$2,814 \pm 1,500$ (-74.9%)** | **65.4%** | **7,343 ms (Fastest)** |

### 5.2 Statistical Significance Validation
- **Willingness Recovery**: Welch's t-test $t = 6.6583, p = 2.28 \times 10^{-6}$ ($p < 0.0001$).
- **Resident Context Reduction**: Welch's t-test $t = 7.2222, p = 2.89 \times 10^{-9}$ ($p < 0.0001$).

---

## 6. Production Guidelines

1. **Prompt Authoring**: Remove all opt-out clauses; enforce the Co-Emission Contract as an upfront rule.
2. **Threshold Parameter Tuning**:
   ```javascript
   export const PRODUCTION_NUDGE_CONFIG = {
     adaptiveNudgeEnabled: true,
     uncompressedStepThreshold: 2,
     accumulatedPayloadThreshold: 2000,
     nudgeErrorThresholdChars: 300,
     deepHorizonTurns: 8,
     cooldownSteps: 2,
     coldStartSteps: 2
   };
   ```
3. **Injection Invariant**: Never update historical messages in-place; always append ephemeral notices to `agent/pre-step` decision messages with `source: { kind: 'oswyn-nudge' }`.

---

## 7. Conclusion

This dedicated investigation resolves the double mystery of context compression willingness:
1. **The Co-Emission Contract is necessary and sufficient to eliminate single-turn modal preemption**;
2. **Multi-turn dialogues undergo a sharp Turn-8 willingness collapse, which unconditioned static nudging exacerbates through habituation and false-positive over-compression**;
3. **3D Deficit Detection coupled with Five Zero-False-Positive Guards and Ephemeral Tail Injection achieves 100% willingness recovery, -74.91% resident context reduction, 100% KV-cache locality preservation, and zero false positives**.
