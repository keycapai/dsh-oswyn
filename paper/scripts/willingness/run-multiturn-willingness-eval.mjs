/**
 * eval-multiturn-harness.mjs
 *
 * Multi-Turn SWE Benchmark Evaluation Harness for DSH Context Compression.
 * Evaluates LLM proactive context compression willingness decay and nudge strategies
 * across multi-turn long-horizon SWE trajectories (12-20 turns).
 *
 * Features:
 * - 6 Experimental Arms (Baseline, Static Periodic, Static Suffix, Dynamic Adaptive, Dynamic + Exemption Guard, Optimized)
 * - Trajectory progression & context surface projection
 * - Real API integration (ds4.1f routing group / DeepSeek Cloud API) with 1000ms throttling
 * - Deterministic offline dry-run simulation mode
 * - Parsing verification via dsh-context-distill/lib/parse.js
 * - Trajectory logging and aggregate metrics (W, W(t), C(t), R, Step 0 abstention accuracy, token economy)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSummaryBlock, parseSummaryBody } from '../../../dsh-context-distill/lib/parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -------------------------------------------------------------
// Experimental Arms Definitions (0 - 5)
// -------------------------------------------------------------
export const ARMS = {
  0: {
    id: 0,
    key: 'arm_0_baseline',
    name: 'Baseline Unnudged',
    description: 'No runtime nudge intervention; natural multi-turn decay under V2 Co-Emission contract',
    nudgeStrategy: 'none'
  },
  1: {
    id: 1,
    key: 'arm_1_static_periodic',
    name: 'Static Periodic Nudge',
    description: 'Fixed periodic injection every K=3 turns regardless of payload or target exemption',
    nudgeStrategy: 'static-periodic',
    period: 3
  },
  2: {
    id: 2,
    key: 'arm_2_static_suffix',
    name: 'Static Suffix Nudge',
    description: 'Unconditional static notice appended to every preceding tool result',
    nudgeStrategy: 'static-suffix'
  },
  3: {
    id: 3,
    key: 'arm_3_dynamic_adaptive',
    name: 'Dynamic Adaptive Nudge',
    description: 'Multi-dimensional deficit detection (N >= 2 uncompressed steps or payload >= 2000 chars)',
    nudgeStrategy: 'dynamic',
    consecutiveThreshold: 2,
    payloadThreshold: 2000,
    turnDepthThreshold: 8
  },
  4: {
    id: 4,
    key: 'arm_4_dynamic_exemption_guard',
    name: 'Dynamic + Exemption Guard',
    description: 'Dynamic adaptive detection + strict Step 0 exemption guard and 2-step cooldown',
    nudgeStrategy: 'dynamic',
    consecutiveThreshold: 2,
    payloadThreshold: 2000,
    turnDepthThreshold: 8,
    cooldownTurns: 2,
    hasExemptionGuard: true
  },
  5: {
    id: 5,
    key: 'arm_5_optimized',
    name: 'Optimized Dynamic Tiered',
    description: 'Calibrated multi-tier phrasing (Advisory/Contractual/Budget Alert) with full suppression guards',
    nudgeStrategy: 'dynamic',
    consecutiveThreshold: 2,
    payloadThreshold: 2000,
    turnDepthThreshold: 8,
    cooldownTurns: 2,
    hasExemptionGuard: true,
    tieredPhrasing: true
  }
};

// -------------------------------------------------------------
// System Prompt Contract (V2 Co-Emission Baseline)
// -------------------------------------------------------------
const SYSTEM_PROMPT_V2 = `## Context Optimization & Mandatory Co-Emission Contract

Tool outputs occupy 80%+ of conversation context. You MUST proactively compact previous tool results at the beginning of EVERY turn that follows a tool execution.

### THE CO-EMISSION CONTRACT (CRITICAL FOR FUNCTION CALLING):
Even when you are calling another tool in this turn, you MUST NOT leave message text empty!
When previous tool results contain noisy output (logs, traces, exploratory searches), you MUST output the \`\`\`dsh-result-summary fence in your message text BEFORE or ALONGSIDE the tool call.
(Exception: If the previous output is an exempt target or configuration file under Step 0, DO NOT emit a summary fence).

### DECISION PROTOCOL (EVALUATED BEFORE CALLING TOOLS):
0. **STEP 0 — EXEMPTION (KEEP RESIDENT INTACT)**:
   Is the previous output an active target file, configuration file (.env, yaml, json, toml, ini), credential/secret, or file being inspected, read, or modified?
   --> **DO NOT emit any \`\`\`dsh-result-summary fence**. Keep full content 100% resident and intact. Proceed directly to response or tool call without distillation.
1. **STEP 1 — ERROR/CRASH**:
   Did the previous tool FAIL, CRASH, or throw an ERROR?
   --> First line: \`discard\` (clears broken args and error trace; retain failure constants, error codes, and assert values verbatim).
2. **STEP 2 — LOG/SCAN/TEST WATERFALL**:
   Is the output a long LOG, SCAN, or TEST DUMP?
   --> First line: \`truncate keep 15 lines\` (preserves head byte-for-byte from byte 0 for 100% KV cache hit).
3. **STEP 3 — EXPLORATORY SEARCH**:
   Did you read broad search results or non-target directory/code dumps?
   --> First line: \`replace\` (1-3 bullets of factual findings; copy formulas, paths, and identifiers VERBATIM).

Active target code files, configuration files (.env, yaml, json, toml), secrets/credentials, and files being inspected or modified MUST be kept resident intact (do NOT emit a summary fence).`;

// -------------------------------------------------------------
// Tools Definition (Real Function Calling Environment)
// -------------------------------------------------------------
const SWE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a bash shell command in the workspace terminal',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command line to run' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to file' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['file_path', 'content']
      }
    }
  }
];

// -------------------------------------------------------------
// API Credential & Calling Helpers
// -------------------------------------------------------------
function resolveApiKey(apiUrl) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  if (apiUrl && apiUrl.includes('127.0.0.1:3425')) {
    return process.env.MAGPIE_GATEWAY_KEY || 'magpie';
  }
  try {
    const credPath = resolve(process.env.HOME || '/Users/reno', '.dsh/.credentials.yaml');
    if (existsSync(credPath)) {
      const content = readFileSync(credPath, 'utf8');
      const match = content.match(/DEEPSEEK_API_KEY:\s*(\S+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch {
    // ignore
  }
  return 'REDACTED_KEY';
}

async function callDeepSeekAPI({ apiUrl, apiKey, model, messages, tools, retries = 3 }) {
  const payload = {
    model,
    messages,
    tools,
    temperature: 0.1,
    max_tokens: 2048
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`[WARN] API attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

// -------------------------------------------------------------
// Nudge Generator & Suppression Logic
// -------------------------------------------------------------
export function evaluateArmNudge({ arm, turnIndex, currentTurn, state }) {
  const strategy = arm.nudgeStrategy;

  if (strategy === 'none') {
    return { shouldNudge: false, notice: null, reason: 'BASELINE_UNNUDGED' };
  }

  // Arm 1: Static Periodic (every K turns)
  if (strategy === 'static-periodic') {
    const period = arm.period || 3;
    const isPeriodTurn = turnIndex > 1 && (turnIndex % period === 0);
    if (isPeriodTurn) {
      return {
        shouldNudge: true,
        notice: `[Periodic Context Optimization Reminder]: As dialogue progresses, unpruned tool results inflate context. Please emit \`\`\`dsh-result-summary alongside your tool calls or response to compact noisy outputs.`,
        reason: 'STATIC_PERIODIC_SCHEDULE'
      };
    }
    return { shouldNudge: false, notice: null, reason: 'OUTSIDE_PERIODIC_SCHEDULE' };
  }

  // Arm 2: Static Suffix (injected into tool result directly)
  if (strategy === 'static-suffix') {
    return {
      shouldNudge: false, // Handled via toolResult suffix
      notice: null,
      reason: 'STATIC_SUFFIX_ACTIVE'
    };
  }

  // Dynamic Adaptive strategies (Arms 3, 4, 5)
  if (strategy === 'dynamic') {
    // Arm 4 & 5: Check Step 0 Exemption Guard
    if (arm.hasExemptionGuard && currentTurn.isExemptTarget) {
      return { shouldNudge: false, notice: null, reason: 'STEP_0_EXEMPTION_GUARD' };
    }

    // Arm 4 & 5: Check Cooldown
    if (arm.cooldownTurns && (turnIndex - state.lastNudgeTurn <= arm.cooldownTurns)) {
      return { shouldNudge: false, notice: null, reason: 'COOLDOWN_ACTIVE' };
    }

    // Check if previous turn already emitted summary
    if (state.lastSummaryTurn === turnIndex - 1) {
      return { shouldNudge: false, notice: null, reason: 'PREVIOUS_TURN_COMPACTED' };
    }

    // Multi-dimensional deficit check:
    const consecutiveViolation = state.consecutiveUncompressed >= (arm.consecutiveThreshold || 2);
    const payloadViolation = state.accumulatedPayload >= (arm.payloadThreshold || 2000);
    const horizonViolation = turnIndex >= (arm.turnDepthThreshold || 8) && currentTurn.isNoisy;

    if (consecutiveViolation || payloadViolation || horizonViolation) {
      let notice;
      if (arm.tieredPhrasing) {
        if (horizonViolation && turnIndex >= 12) {
          notice = `[🚨 DSH-OSWYN 预算预警]: 上下文水位急剧上升，注意力正在稀释。必须在下一步操作首部附带 \`\`\`dsh-result-summary 或 <dsh-result-summary mode="..."> 压缩历史冗余载荷；【Step 0 豁免】：若为活跃配置或 .env，全量保留，严禁压缩！`;
        } else if (consecutiveViolation) {
          notice = `[⚡ DSH-OSWYN 意愿感知唤醒]: 检测到连续 ${state.consecutiveUncompressed} 步未执行上下文精炼，累积未精炼载荷膨胀达 ${state.accumulatedPayload} 字符。根据双通道共发契约，请在当前操作首部附带 \`\`\`dsh-result-summary 或 <dsh-result-summary mode="..."> 执行必要截断或丢弃。【Step 0 豁免】：核心配置及活跃源码全量保留。`;
        } else {
          notice = `[💡 DSH-OSWYN 提示]: 上一步工具输出较大 (${currentTurn.toolContent.length} 字符)。建议使用 \`\`\`dsh-result-summary 或 <dsh-result-summary mode="..."> 进行精炼保护。【Step 0 豁免】：核心配置及源码全量保留。`;
        }
      } else {
        notice = `[⚡ DSH-OSWYN 意愿感知唤醒]: 检测到连续 ${state.consecutiveUncompressed} 步未执行上下文精炼，累积未精炼载荷达 ${state.accumulatedPayload} 字符。请在当前回复首部附带 \`\`\`dsh-result-summary 进行精炼。`;
      }

      return {
        shouldNudge: true,
        notice,
        reason: consecutiveViolation ? 'CONSECUTIVE_UNCOMPRESSED' : (payloadViolation ? 'PAYLOAD_BLOAT' : 'HORIZON_DECAY')
      };
    }

    return { shouldNudge: false, notice: null, reason: 'WITHIN_HEALTHY_BOUNDS' };
  }

  return { shouldNudge: false, notice: null, reason: 'UNKNOWN_STRATEGY' };
}

// -------------------------------------------------------------
// Offline Dry-Run Simulation Logic (Mathematical Decay Modeling)
// -------------------------------------------------------------
export function simulateModelResponse(arm, turn, state, nudgeDecision, currentPromptTokens) {
  const isNoisy = turn.isNoisy;
  const isExempt = turn.isExemptTarget;
  const turnIndex = turn.turn;

  // Step 0 Exempt targets: model should keep resident (abstain from emitting summary fence)
  if (isExempt) {
    // If Arm 2 (static suffix) unconditionally pressures model with suffix on config files:
    if (arm.id === 2) {
      // In static suffix arm, over-compresses exempt targets ~50% of the time (odd/even)
      const falsePositive = (turnIndex % 2 === 0);
      if (falsePositive) {
        return {
          content: '```dsh-result-summary\ntruncate keep 15 lines\n- Configuration summarized\n```\nConfig reviewed.',
          hasSummaryFence: true,
          summaryMode: 'truncate',
          keepCount: 15,
          keepUnit: 'lines',
          summaryText: '- Configuration summarized',
          hasToolCall: true,
          latencyMs: 380,
          tokens: { promptTokens: currentPromptTokens, completionTokens: 140 }
        };
      }
    } else if (arm.id === 3 && nudgeDecision.shouldNudge) {
      // In Arm 3 (dynamic without guard), if a deficit nudge fires right on an exempt step:
      return {
        content: '```dsh-result-summary\nreplace\n- Config contents extracted\n```\nConfig reviewed.',
        hasSummaryFence: true,
        summaryMode: 'replace',
        keepCount: null,
        keepUnit: null,
        summaryText: '- Config contents extracted',
        hasToolCall: true,
        latencyMs: 390,
        tokens: { promptTokens: currentPromptTokens, completionTokens: 120 }
      };
    }

    // Normal compliant model behavior: keeps exempt target resident intact (no fence)
    return {
      content: `I have inspected the configuration file ${turn.toolArgs}. Keeping content resident intact.`,
      hasSummaryFence: false,
      summaryMode: null,
      keepCount: null,
      keepUnit: null,
      summaryText: '',
      hasToolCall: true,
      latencyMs: 340,
      tokens: { promptTokens: currentPromptTokens, completionTokens: 85 }
    };
  }

  // For non-exempt turns:
  if (!isNoisy) {
    // Compact output doesn't strictly need summary
    return {
      content: 'Tool executed successfully. Proceeding with next step.',
      hasSummaryFence: false,
      summaryMode: null,
      keepCount: null,
      keepUnit: null,
      summaryText: '',
      hasToolCall: true,
      latencyMs: 310,
      tokens: { promptTokens: currentPromptTokens, completionTokens: 60 }
    };
  }

  // For noisy outputs needing compression:
  // Determine if model emits summary fence based on Arm dynamics:
  let willEmit = false;

  if (arm.id === 0) {
    // Baseline unnudged: Turn 1 high (100%), Turn 3 decaying (50%), Turn 4+ collapses to 0% due to inertia & preemption
    if (turnIndex === 1) {
      willEmit = true;
    } else if (turnIndex <= 3) {
      willEmit = state.consecutiveUncompressed === 0;
    } else {
      willEmit = false; // No-fence inertia locked in
    }
  } else if (arm.id === 1) {
    // Static periodic: Spikes when nudged, drops in-between
    if (nudgeDecision.shouldNudge) {
      willEmit = true;
    } else if (turnIndex === 1) {
      willEmit = true;
    } else {
      willEmit = (turnIndex % 4 === 1); // low background willingness
    }
  } else if (arm.id === 2) {
    // Static suffix: High initially, habituation decay sets in after turn 6
    if (turnIndex <= 6) {
      willEmit = true;
    } else {
      willEmit = (turnIndex % 2 === 0); // habituated decay (~50%)
    }
  } else if (arm.id === 3) {
    // Dynamic adaptive: Nudge restores willingness whenever triggered
    if (turnIndex === 1 || nudgeDecision.shouldNudge || state.consecutiveUncompressed === 0) {
      willEmit = true;
    } else {
      willEmit = false;
    }
  } else if (arm.id === 4 || arm.id === 5) {
    // Dynamic + guard / Optimized: High sustained willingness on noisy outputs (>=90%)
    willEmit = true;
  }

  if (willEmit && turn.simulatedFence) {
    return {
      content: `${turn.simulatedFence}\nExecuting next action to proceed with SWE resolution.`,
      hasSummaryFence: true,
      summaryMode: turn.optimalAction === 'keep' ? 'replace' : turn.optimalAction,
      keepCount: turn.suggestedKeepLines || null,
      keepUnit: turn.suggestedKeepLines ? 'lines' : null,
      summaryText: turn.simulatedFence,
      hasToolCall: true,
      latencyMs: 420 + (turnIndex % 5) * 40,
      tokens: { promptTokens: currentPromptTokens, completionTokens: 160 }
    };
  }

  // Modal preemption: empty content or minimal text, no fence
  return {
    content: '',
    hasSummaryFence: false,
    summaryMode: null,
    keepCount: null,
    keepUnit: null,
    summaryText: '',
    hasToolCall: true,
    latencyMs: 360,
    tokens: { promptTokens: currentPromptTokens, completionTokens: 45 }
  };
}

// -------------------------------------------------------------
// Core Trajectory Evaluation Engine
// -------------------------------------------------------------
export async function evaluateScenarioTrajectory({
  scenario,
  arm,
  nudgeOverride,
  maxTurns,
  apiUrl,
  apiKey,
  model,
  isDryRun,
  interTurnDelayMs = 1000
}) {
  const effectiveArm = {
    ...arm,
    nudgeStrategy: nudgeOverride || arm.nudgeStrategy
  };

  const turnsToRun = maxTurns ? scenario.turns.slice(0, maxTurns) : scenario.turns;
  const trajectory = [];

  // State tracker across turns
  const state = {
    consecutiveUncompressed: 0,
    accumulatedPayload: 0,
    lastSummaryTurn: -1,
    lastNudgeTurn: -999,
    surfaceResidentChars: 0,
    rawCumulativeChars: 0
  };

  // Maintained message history for live mode
  const messageHistory = [
    { role: 'system', content: SYSTEM_PROMPT_V2 }
  ];

  for (let idx = 0; idx < turnsToRun.length; idx++) {
    const turn = turnsToRun[idx];
    const turnNum = turn.turn;
    const rawLen = turn.toolContent.length;

    // Current effective prompt tokens resident in context
    const currentPromptTokens = 1500 + Math.round(state.surfaceResidentChars / 3.5);

    // 1. Evaluate whether a nudge should be injected
    const nudgeDecision = evaluateArmNudge({
      arm: effectiveArm,
      turnIndex: turnNum,
      currentTurn: turn,
      state
    });

    if (nudgeDecision.shouldNudge) {
      state.lastNudgeTurn = turnNum;
    }

    let llmResponse;
    const startTime = Date.now();

    if (isDryRun) {
      llmResponse = simulateModelResponse(effectiveArm, turn, state, nudgeDecision, currentPromptTokens);
    } else {
      // Build message payload
      messageHistory.push({ role: 'user', content: turn.userRequest });

      // If preceding tool result exists, append it
      let toolContentToInject = turn.toolContent;
      if (effectiveArm.nudgeStrategy === 'static-suffix') {
        toolContentToInject += '\n[Notice: If this tool result contains trailing logs or exploratory noise, emit ```dsh-result-summary before your next action]';
      }

      const callId = `call_${turnNum}_${Math.random().toString(36).slice(2, 7)}`;
      messageHistory.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name: turn.toolName,
              arguments: turn.toolArgs
            }
          }
        ]
      });
      messageHistory.push({
        role: 'tool',
        tool_call_id: callId,
        content: toolContentToInject
      });

      // Ephemeral nudge injection at tail
      const outgoingMessages = [...messageHistory];
      if (nudgeDecision.shouldNudge && nudgeDecision.notice) {
        outgoingMessages.push({
          role: 'user',
          content: nudgeDecision.notice
        });
      }

      const apiResp = await callDeepSeekAPI({
        apiUrl,
        apiKey,
        model,
        messages: outgoingMessages,
        tools: SWE_TOOLS
      });

      const latencyMs = Date.now() - startTime;
      const choice = apiResp.choices?.[0];
      const message = choice?.message || {};
      const content = message.content || '';
      const toolCalls = message.tool_calls || [];
      const usage = apiResp.usage || {};

      llmResponse = {
        content,
        hasToolCall: toolCalls.length > 0,
        latencyMs,
        tokens: {
          promptTokens: usage.prompt_tokens || currentPromptTokens,
          completionTokens: usage.completion_tokens || 100
        }
      };

      if (interTurnDelayMs > 0) {
        await new Promise((r) => setTimeout(r, interTurnDelayMs));
      }
    }

    // 2. Parse summary fences in model output using dsh-context-distill/lib/parse.js
    const block = findSummaryBlock(llmResponse.content);
    const hasSummaryFence = Boolean(block);
    let parsedMode = null;
    let keepCount = null;
    let keepUnit = null;
    let summaryText = '';

    if (block) {
      try {
        const parsed = parseSummaryBody(block.rawHeader, block.body);
        if (block.body.startsWith('discard') || (block.rawHeader && block.rawHeader.includes('discard'))) {
          parsedMode = 'discard';
        } else {
          parsedMode = parsed.mode || 'replace';
        }
        keepCount = parsed.keepCount;
        keepUnit = parsed.keepUnit;
        summaryText = parsed.summary || '';
      } catch {
        parsedMode = null;
      }
    }

    // 3. Compute compressed chars on the session surface
    let compressedChars = rawLen;
    if (hasSummaryFence && parsedMode) {
      if (parsedMode === 'discard') {
        compressedChars = 0;
      } else if (parsedMode === 'truncate' && keepCount) {
        const lines = turn.toolContent.split('\n');
        const kept = lines.slice(0, keepCount).join('\n');
        compressedChars = kept.length + (summaryText.length || 80);
      } else if (parsedMode === 'replace') {
        compressedChars = summaryText.length || 120;
      }
    }
    state.surfaceResidentChars += compressedChars;
    state.rawCumulativeChars += rawLen;

    // 4. Abstention accuracy check
    // If turn is Step 0 exempt: correct abstention means NO fence was emitted.
    // If turn is noisy non-exempt: correct behavior means fence WAS emitted (did not abstain).
    let isAbstentionCorrect = false;
    if (turn.isExemptTarget) {
      isAbstentionCorrect = !hasSummaryFence;
    } else {
      isAbstentionCorrect = hasSummaryFence;
    }

    // 5. Update state tracker
    if (hasSummaryFence) {
      state.consecutiveUncompressed = 0;
      state.accumulatedPayload = 0;
      state.lastSummaryTurn = turnNum;
    } else if (turn.isNoisy) {
      state.consecutiveUncompressed++;
      state.accumulatedPayload += rawLen;
    }

    // 6. Record trajectory step
    const stepRecord = {
      turn: turnNum,
      step: turn.step || turnNum,
      promptTokens: llmResponse.tokens?.promptTokens || currentPromptTokens,
      completionTokens: llmResponse.tokens?.completionTokens || 120,
      hasToolCall: llmResponse.hasToolCall,
      hasSummaryFence,
      summaryMode: parsedMode,
      compressedChars,
      latencyMs: llmResponse.latencyMs,
      isExemptTarget: turn.isExemptTarget,
      isAbstentionCorrect
    };

    trajectory.push(stepRecord);
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    armId: effectiveArm.id,
    armName: effectiveArm.name,
    nudgeStrategy: effectiveArm.nudgeStrategy,
    trajectory,
    state
  };
}

// -------------------------------------------------------------
// Aggregate Metrics Computation
// -------------------------------------------------------------
export function computeTrajectoryMetrics(scenario, runResult) {
  const traj = runResult.trajectory;
  const turns = scenario.turns.slice(0, traj.length);

  // Filter noisy and exempt turns
  const noisyTurns = [];
  const exemptTurns = [];

  for (let i = 0; i < traj.length; i++) {
    const t = turns[i];
    const rec = traj[i];
    if (t.isNoisy && !t.isExemptTarget) {
      noisyTurns.push(rec);
    }
    if (t.isExemptTarget) {
      exemptTurns.push(rec);
    }
  }

  // 1. Overall Willingness Rate W (%)
  const noisyEmittedCount = noisyTurns.filter((r) => r.hasSummaryFence).length;
  const willingnessRate = noisyTurns.length > 0 ? (noisyEmittedCount / noisyTurns.length) * 100 : 0;

  // 2. Per-turn decay progression W(t) and C(t)
  const progression = [];
  let runningSurfaceChars = 0;
  let runningRawChars = 0;
  let totalRawPromptTokens = 0;
  let totalActualPromptTokens = 0;

  for (let i = 0; i < traj.length; i++) {
    const t = turns[i];
    const rec = traj[i];

    const turnRawPromptTok = 1500 + Math.round(runningRawChars / 3.5);
    const turnActualPromptTok = 1500 + Math.round(runningSurfaceChars / 3.5);
    totalRawPromptTokens += turnRawPromptTok;
    totalActualPromptTokens += rec.promptTokens || turnActualPromptTok;

    runningSurfaceChars += rec.compressedChars;
    runningRawChars += t.toolContent.length;

    progression.push({
      turn: rec.turn,
      isNoisy: t.isNoisy,
      isExemptTarget: t.isExemptTarget,
      hasSummaryFence: rec.hasSummaryFence,
      summaryMode: rec.summaryMode,
      cumulativeSurfaceChars: runningSurfaceChars,
      cumulativeRawChars: runningRawChars,
      promptTokens: rec.promptTokens || turnActualPromptTok,
      rawPromptTokens: turnRawPromptTok
    });
  }

  // 3. Net compression ratio R (%)
  const totalRawChars = turns.reduce((acc, t) => acc + t.toolContent.length, 0);
  const totalCompressedChars = traj.reduce((acc, r) => acc + r.compressedChars, 0);
  const netCompressionRatio = totalRawChars > 0 ? Math.max(0, ((totalRawChars - totalCompressedChars) / totalRawChars) * 100) : 0;

  // 4. Step 0 Abstention Accuracy (%)
  const correctAbstentions = exemptTurns.filter((r) => !r.hasSummaryFence).length;
  const abstentionAccuracy = exemptTurns.length > 0 ? (correctAbstentions / exemptTurns.length) * 100 : 100;

  // 5. Token Economy Savings
  const estimatedTokenSavings = Math.max(0, totalRawPromptTokens - totalActualPromptTokens);
  const tokenSavingsPct = totalRawPromptTokens > 0 ? (estimatedTokenSavings / totalRawPromptTokens) * 100 : 0;

  return {
    scenarioId: scenario.id,
    armId: runResult.armId,
    armName: runResult.armName,
    totalTurns: traj.length,
    noisyTurnsCount: noisyTurns.length,
    noisyEmittedCount,
    exemptTurnsCount: exemptTurns.length,
    correctAbstentions,
    willingnessRate: Number(willingnessRate.toFixed(1)),
    netCompressionRatio: Number(netCompressionRatio.toFixed(1)),
    abstentionAccuracy: Number(abstentionAccuracy.toFixed(1)),
    totalRawChars,
    totalCompressedChars,
    finalSurfaceChars: runningSurfaceChars,
    rawEstimatedPromptTokens: totalRawPromptTokens,
    actualPromptTokens: totalActualPromptTokens,
    estimatedTokenSavings,
    tokenSavingsPct: Number(tokenSavingsPct.toFixed(1)),
    progression
  };
}

// -------------------------------------------------------------
// Console Output & Tables Formatter
// -------------------------------------------------------------
export function printConsoleSummary({ scenarioResults, allMetrics }) {
  console.log('\n===========================================================================================================');
  console.log('                            MULTI-TURN SWE BENCHMARK HARNESS EVALUATION SUMMARY                            ');
  console.log('===========================================================================================================');
  console.log('| Arm | Strategy Name                 | Scenario               | Willingness W | Net Comp R | Step 0 Abstain | Token Savings |');
  console.log('|-----|-------------------------------|------------------------|---------------|------------|----------------|---------------|');

  const pad = (str, len) => String(str).padEnd(len);

  for (const m of allMetrics) {
    const wStr = `${m.willingnessRate}% (${m.noisyEmittedCount}/${m.noisyTurnsCount})`;
    const rStr = `${m.netCompressionRatio}%`;
    const aStr = `${m.abstentionAccuracy}% (${m.correctAbstentions}/${m.exemptTurnsCount})`;
    const sStr = `${m.tokenSavingsPct}% (~${m.estimatedTokenSavings} tok)`;
    console.log(
      `| ${pad(m.armId, 3)} | ${pad(m.armName, 29)} | ${pad(m.scenarioId, 22)} | ${pad(wStr, 13)} | ${pad(rStr, 10)} | ${pad(aStr, 14)} | ${pad(sStr, 13)} |`
    );
  }
  console.log('===========================================================================================================\n');

  // Print Decay Curve Progression Table W(t)
  console.log('-----------------------------------------------------------------------------------------------------------');
  console.log('                                 PER-TURN WILLINGNESS PROGRESSION W(t)                                    ');
  console.log('-----------------------------------------------------------------------------------------------------------');

  const sampleScenarioId = allMetrics[0]?.scenarioId;
  const metricsForScenario = allMetrics.filter((m) => m.scenarioId === sampleScenarioId);
  const maxTurns = Math.max(...metricsForScenario.map((m) => m.progression.length), 0);

  const headerCols = ['Turn', 'IsNoisy', 'Exempt'];
  for (const m of metricsForScenario) {
    headerCols.push(`Arm ${m.armId} (${m.armName.slice(0, 10)})`);
  }
  console.log(headerCols.map((c) => pad(c, 15)).join(' | '));
  console.log('-'.repeat(headerCols.length * 18));

  for (let t = 1; t <= maxTurns; t++) {
    const row = [pad(`Turn ${String(t).padStart(2, '0')}`, 15)];
    const firstProg = metricsForScenario[0]?.progression.find((p) => p.turn === t);
    row.push(pad(firstProg?.isNoisy ? 'YES' : 'no', 15));
    row.push(pad(firstProg?.isExemptTarget ? 'STEP 0' : '-', 15));

    for (const m of metricsForScenario) {
      const p = m.progression.find((x) => x.turn === t);
      if (!p) {
        row.push(pad('N/A', 15));
      } else if (p.isExemptTarget) {
        row.push(pad(p.hasSummaryFence ? 'OVER-COMPRESS' : 'ABSTAIN_OK', 15));
      } else if (p.hasSummaryFence) {
        row.push(pad(`FENCE (${p.summaryMode || 'yes'})`, 15));
      } else {
        row.push(pad('NO_FENCE (0%)', 15));
      }
    }
    console.log(row.join(' | '));
  }
  console.log('-----------------------------------------------------------------------------------------------------------\n');
}

// -------------------------------------------------------------
// CLI Argument Parser
// -------------------------------------------------------------
export function parseCliArgs(args) {
  const result = {
    scenario: null,
    turns: null,
    arm: null,
    nudge: null,
    model: 'group/deepseek-v4.1-flash',
    apiUrl: 'http://127.0.0.1:3425/v1/chat/completions',
    dryRun: false,
    output: 'tools/data/multiturn-eval-results.json',
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if ((arg === '--scenario' || arg === '-s') && args[i + 1]) {
      result.scenario = args[++i];
    } else if ((arg === '--turns' || arg === '-t') && args[i + 1]) {
      result.turns = parseInt(args[++i], 10);
    } else if ((arg === '--arm' || arg === '-a') && args[i + 1]) {
      result.arm = args[++i];
    } else if ((arg === '--nudge' || arg === '-n') && args[i + 1]) {
      result.nudge = args[++i];
    } else if ((arg === '--model' || arg === '-m') && args[i + 1]) {
      result.model = args[++i];
    } else if ((arg === '--api-url' || arg === '--endpoint') && args[i + 1]) {
      result.apiUrl = args[++i];
    } else if ((arg === '--output' || arg === '-o') && args[i + 1]) {
      result.output = args[++i];
    }
  }

  return result;
}

// -------------------------------------------------------------
// Main Batch Runner
// -------------------------------------------------------------
export async function runMultiturnEvaluation(cliArgs) {
  const scenariosPath = resolve(__dirname, '../../data/willingness/scenarios/multiturn-swe-scenarios.json');
  if (!existsSync(scenariosPath)) {
    throw new Error(`Scenarios file not found: ${scenariosPath}. Please run scenario generator.`);
  }

  const allScenarios = JSON.parse(readFileSync(scenariosPath, 'utf8'));
  const scenariosToRun = cliArgs.scenario && cliArgs.scenario !== 'all'
    ? allScenarios.filter((s) => s.id === cliArgs.scenario)
    : allScenarios;

  if (scenariosToRun.length === 0) {
    throw new Error(`No scenario matched --scenario ${cliArgs.scenario}`);
  }

  // Determine which arms to run
  let armIndices = [0, 1, 2, 3, 4, 5];
  if (cliArgs.arm !== null && cliArgs.arm !== undefined && cliArgs.arm !== 'all') {
    const idx = parseInt(cliArgs.arm, 10);
    if (!ARMS[idx]) {
      throw new Error(`Invalid arm index ${cliArgs.arm}. Must be 0-5 or 'all'.`);
    }
    armIndices = [idx];
  }

  const apiKey = cliArgs.dryRun ? '[OFFLINE_SIMULATION]' : resolveApiKey(cliArgs.apiUrl);

  console.log('>>> Starting Multi-Turn SWE Benchmark Evaluation Harness');
  console.log(`    Mode:      ${cliArgs.dryRun ? 'OFFLINE DRY-RUN (Zero Network Calls)' : 'LIVE EXECUTION'}`);
  console.log(`    Endpoint:  ${cliArgs.apiUrl}`);
  console.log(`    Model:     ${cliArgs.model}`);
  console.log(`    Scenarios: ${scenariosToRun.map((s) => s.id).join(', ')}`);
  console.log(`    Arms:      ${armIndices.map((i) => `Arm ${i} (${ARMS[i].name})`).join(', ')}`);
  if (cliArgs.turns) console.log(`    Max Turns: ${cliArgs.turns}`);
  if (cliArgs.nudge) console.log(`    Nudge:     ${cliArgs.nudge} (Override)`);

  const scenarioResults = [];
  const allMetrics = [];

  for (const armId of armIndices) {
    const arm = ARMS[armId];
    console.log(`\n========================================================================`);
    console.log(`>>> Running Arm [${arm.id}]: ${arm.name} (strategy: ${cliArgs.nudge || arm.nudgeStrategy})`);
    console.log(`========================================================================`);

    for (const scenario of scenariosToRun) {
      process.stdout.write(`  [${scenario.id}] (${scenario.turns.length} turns)... `);
      const startTime = Date.now();

      const runResult = await evaluateScenarioTrajectory({
        scenario,
        arm,
        nudgeOverride: cliArgs.nudge,
        maxTurns: cliArgs.turns,
        apiUrl: cliArgs.apiUrl,
        apiKey,
        model: cliArgs.model,
        isDryRun: cliArgs.dryRun,
        interTurnDelayMs: cliArgs.dryRun ? 0 : 1000
      });

      const metrics = computeTrajectoryMetrics(scenario, runResult);
      scenarioResults.push(runResult);
      allMetrics.push(metrics);

      const elapsed = Date.now() - startTime;
      console.log(
        `Done (${elapsed}ms) | W: ${metrics.willingnessRate}% | NetComp: ${metrics.netCompressionRatio}% | Abstain: ${metrics.abstentionAccuracy}% | Savings: ${metrics.tokenSavingsPct}%`
      );
    }
  }

  // Print full console summary table and decay progression
  printConsoleSummary({ scenarioResults, allMetrics });

  // Serialize results
  const outFilePath = resolve(__dirname, '../../data/willingness', cliArgs.output.replace(/^data\//, ''));
  mkdirSync(dirname(outFilePath), { recursive: true });

  let finalOutputData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      isDryRun: cliArgs.dryRun,
      apiUrl: cliArgs.dryRun ? '[OFFLINE SIMULATION]' : cliArgs.apiUrl,
      model: cliArgs.dryRun ? '[OFFLINE SIMULATION]' : cliArgs.model,
      scenariosEvaluated: scenariosToRun.map((s) => s.id),
      armsEvaluated: armIndices.map((i) => ARMS[i].name)
    },
    metricsSummary: allMetrics,
    trajectories: scenarioResults
  };

  // If running a partial arm or scenario set and output file already exists, merge cleanly
  if (armIndices.length < Object.keys(ARMS).length && existsSync(outFilePath)) {
    try {
      const existing = JSON.parse(readFileSync(outFilePath, 'utf8'));
      if (Array.isArray(existing.metricsSummary) && Array.isArray(existing.trajectories)) {
        const retainedMetrics = existing.metricsSummary.filter(
          (m) => !armIndices.includes(m.armId) || !scenariosToRun.some((s) => s.id === m.scenarioId)
        );
        const retainedTraj = existing.trajectories.filter(
          (t) => !armIndices.includes(t.armId) || !scenariosToRun.some((s) => s.id === t.scenarioId)
        );
        finalOutputData.metricsSummary = [...retainedMetrics, ...allMetrics].sort((a, b) => a.armId - b.armId);
        finalOutputData.trajectories = [...retainedTraj, ...scenarioResults].sort((a, b) => a.armId - b.armId);
        finalOutputData.metadata.armsEvaluated = [
          ...new Set([...(existing.metadata?.armsEvaluated || []), ...finalOutputData.metadata.armsEvaluated])
        ];
        finalOutputData.metadata.scenariosEvaluated = [
          ...new Set([...(existing.metadata?.scenariosEvaluated || []), ...finalOutputData.metadata.scenariosEvaluated])
        ];
      }
    } catch {
      // ignore
    }
  }

  writeFileSync(outFilePath, JSON.stringify(finalOutputData, null, 2), 'utf8');
  console.log(`[SUCCESS] Multi-turn evaluation results saved to: ${outFilePath}`);

  return finalOutputData;
}

// -------------------------------------------------------------
// CLI Entry Point
// -------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.help) {
    console.log(`
DSH Multi-Turn SWE Benchmark Evaluation Harness

Usage:
  node tools/eval-multiturn-harness.mjs [options]

Options:
  --scenario, -s <id>     Scenario ID to evaluate (e.g. swe_bug_investigation) or 'all' (default: all)
  --turns, -t <N>         Limit number of turns to evaluate per scenario
  --arm, -a <0-5|all>     Experimental arm index (0: baseline, 1: static periodic, 2: static suffix,
                          3: dynamic adaptive, 4: dynamic + guard, 5: optimized, or 'all')
  --nudge, -n <strategy>  Override nudge strategy (none | static-periodic | static-suffix | dynamic)
  --model, -m <id>        Model identifier (default: group/deepseek-v4.1-flash)
  --api-url <url>         API endpoint URL (default: http://127.0.0.1:3425/v1/chat/completions)
  --dry-run               Offline simulation mode with zero network calls
  --output, -o <path>     Output JSON path (default: tools/data/multiturn-eval-results.json)
  --help, -h              Show this help message
`);
    process.exit(0);
  }

  runMultiturnEvaluation(cliArgs).catch((err) => {
    console.error(`[FATAL] Multi-turn evaluation harness failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
