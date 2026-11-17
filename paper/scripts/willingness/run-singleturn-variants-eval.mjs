/**
 * eval-prompt-variants.mjs
 *
 * Automated Prompt Variant Batch Evaluator for DSH Context Compression.
 * Evaluates 5 prompt variants across 4 realistic SWE scenarios using the real DeepSeek Cloud API.
 * Uses dsh-context-distill/lib/parse.js for fence detection and parsing.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSummaryBlock, parseSummaryBody } from '../../../dsh-context-distill/lib/parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Configurations
const API_URL = process.env.API_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.MODEL || 'deepseek-flash';

function loadApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const credPath = resolve(process.env.HOME || '/Users/reno', '.dsh/.credentials.yaml');
    if (existsSync(credPath)) {
      const content = readFileSync(credPath, 'utf8');
      const match = content.match(/DEEPSEEK_API_KEY:\s*(\S+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch (err) {
    console.warn(`[WARN] Could not read credentials: ${err.message}`);
  }
  return 'REDACTED_KEY';
}

const API_KEY = loadApiKey();

// ---------------------------------------------------------
// Tools Definition (Real Function Calling Environment)
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// Prompt Variants (V0 - V4)
// ---------------------------------------------------------
export const PROMPT_VARIANTS = {
  V0: {
    id: 'V0',
    name: 'Current Baseline (Opt-Out Clause)',
    description: 'Current dsh-context-distill system prompt with escape clause "If All Content Is Important, DO NOT Summarize"',
    systemPrompt: `## DSH-OSWYN: Only See What You Need (Context & Cache Optimization)

You are in full control of your context window. As sessions grow, re-sending massive historical tool outputs and redundant verbose replies drains token budget and degrades focus.
**Principle**: "Only See What You Need (OSWYN)" — you autonomously decide whether to summarize, where to cut, and what to keep.

### 1. Tool Output Optimization (Zero-Overhead Interleaved Decision)
- **Strict Scope**: Optimization applies ONLY to the single tool result directly preceding this turn.
- **Zero Extra Turns**: NEVER dedicate a separate turn or tool call just to summarize. Judge the last tool result concurrently while taking your next action or answering.
- **If All Content Is Important, DO NOT Summarize**: Keep the entire output intact if every line is relevant.

If the last tool result contains trailing noise (long build logs, test cascades, repetitive directory dumps), you decide whether and where to cut:

- **Option A: Truncate rear, preserve head byte-for-byte (100% KV-Cache Hit — Recommended)**:
  Decide which line the useful output ends (e.g. line 15), and cut off the rest:
  \`\`\`dsh-result-summary
  truncate keep <N> lines
  - key facts, error messages, lines, or status from the cut-off rear portion
  \`\`\`
  (Syntax: \`truncate keep <N> lines\` or \`truncate keep <N> chars\`. Preserves lines 1..N strictly from index 0 byte-for-byte for 100% KV prompt cache hit, discarding the tail).

- **Option B: Full replacement summary**:
  If the entire output is low-value noise and only a few facts matter:
  \`\`\`dsh-result-summary
  - exact key facts, error codes, identifiers, or counts
  \`\`\`

- **Zero-Loss Recall**: Summarized outputs are NEVER lost. Call \`tool_result_recall\` at any time to inspect full original bytes.

### 2. Dual-Track Assistant Reply Projection (User vs. Next-Turn Self)
When concluding your turn with a rich response to the user, historical text can inflate context in future turns. The dual-track projection solves this without breaking KV cache:
- For the user: Write your full detailed response as normal.
- For your future self: Append a fenced block \`\`\`dsh-reply-summary at the very end.`
  },

  V1: {
    id: 'V1',
    name: 'Strict Decision Tree (Academic P3)',
    description: 'Academic P3 3-step decision tree (Error -> discard, Log -> truncate, Search -> replace; strictly concealing background fallbacks)',
    systemPrompt: `## Context Optimization Protocol (P3 Decision Tree)

You are an autonomous software engineering agent. Tool outputs occupy 80%+ of conversation context. You must proactively compact previous tool results at the beginning of EVERY turn that follows a tool execution.

### Proactive 3-Step Decision Tree (Run after EVERY tool step):
1. **Step 1 — Did the tool FAIL or throw an error?**
   --> First line: \`discard\`
   Clears error stack and broken input. Retain 1-line root cause and failure constants/assert values verbatim.
   Example:
   \`\`\`dsh-result-summary
   discard
   - Root cause: DatabaseDeadlockException on txn TXN_994021_DEADLOCK
   \`\`\`
2. **Step 2 — Is tool output a long log, scan, or command dump?**
   --> First line: \`truncate keep 15 lines\`
   Preserves prefix byte-for-byte from byte 0 for 100% KV-cache hit.
   Example:
   \`\`\`dsh-result-summary
   truncate keep 15 lines
   - Status: build failed, ERR_MODULE_TIMEOUT_408 at line 89, hash 8f1a2c9b
   \`\`\`
3. **Step 3 — Did you read exploratory / non-target code or broad search results?**
   --> First line: \`replace\`
   Extract 1-3 concise fact bullets. Copy paths, functions, constants, formulas VERBATIM.
   Example:
   \`\`\`dsh-result-summary
   replace
   - Target found in src/runtime/worker.ts:142: dispatchSessionWorker(sessionId, opts)
   \`\`\`

- **When to Skip (Keep Resident)**: Keep active target source code, configuration files (.env, yaml, json, toml), secrets/credentials, and files being inspected or modified untouched (do not emit fence).`
  },

  V2: {
    id: 'V2',
    name: 'Co-Emission Contract',
    description: 'Mandatory Thought & Distill Before Tool contract explicitly requiring fence emission before tool calls to counteract modal preemption, with broadened high-signal config retention',
    systemPrompt: `## Context Optimization & Mandatory Co-Emission Contract

Tool outputs occupy 80%+ of context. You MUST proactively compact previous tool results at the beginning of EVERY turn that follows a tool execution.

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

Active target code files, configuration files (.env, yaml, json, toml), secrets/credentials, and files being inspected or modified MUST be kept resident intact (do NOT emit a summary fence).`
  },

  V3: {
    id: 'V3',
    name: 'Context Hygiene Role-Play',
    description: 'System architect KV-cache preservation discipline prompt with loss aversion framing',
    systemPrompt: `## Principal Systems Architect — Attention Preservation & Strict Token Hygiene

You are a Principal Systems Architect operating under strict 100% KV-Cache preservation and context hygiene discipline.
Every uncompressed tool output exponentially degrades your reasoning accuracy ("Lost-in-the-Middle") and depletes your active working memory.
Treat context space as an expensive, scarce resource.

- Leaving raw build logs, failed crash stacks, or exploratory search dumps unpruned is considered an AGENT POLICY VIOLATION.
- Re-transmitting raw tool outputs directly penalizes your task completion score.
- You are strictly required to prune every preceding tool output using \`\`\`dsh-result-summary:
  - Error/Crash: Emit \`discard\` to incinerate dead-end stack traces while retaining error constants.
  - Command log / Test output: Emit \`truncate keep 15 lines\` to retain prefix and status summary.
  - Search / Exploratory read: Emit \`replace\` to extract key identifiers and line coordinates.
- Pruning is safe: full raw bytes can always be inspected via \`tool_result_recall\`.
- Never leave noisy tool results unpruned unless you are actively editing that exact file.`
  },

  V4: {
    id: 'V4',
    name: 'Adaptive Active Nudge',
    description: 'Lowered threshold (800 chars / 20 lines) imperative nudge pre-filling actionable code fence without escape clauses',
    systemPrompt: `## Context Optimization Protocol (P3 Decision Tree)

You are an autonomous software engineering agent. Tool outputs occupy 80%+ of conversation context. You must proactively compact previous tool results at the beginning of EVERY turn that follows a tool execution.

### Proactive 3-Step Decision Tree:
1. Error/Crash -> \`\`\`dsh-result-summary\\ndiscard\\n- 1-line root cause and failure constants\`\`\`
2. Long log/test -> \`\`\`dsh-result-summary\\ntruncate keep 15 lines\\n- status summary\`\`\`
3. Search/read -> \`\`\`dsh-result-summary\\nreplace\\n- exact paths and symbols\`\`\`
Active target configs (.env, yaml, json), credentials, and code being inspected or edited must stay resident (do not emit fence).`
  }
};

// ---------------------------------------------------------
// Scenarios Definition (Scenarios A - D)
// ---------------------------------------------------------
function buildScenarioA() {
  const passLines = [];
  for (let i = 1; i <= 75; i++) {
    passLines.push(`  PASS test/unit/auth/token_spec_${i}.test.ts (took ${12 + (i % 7)}ms)`);
  }
  const toolContent = [
    '=== RUNNING TEST SUITE: @core/gateway ===',
    'NODE_ENV=test ts-node --project tsconfig.test.json',
    ...passLines,
    '  FAIL test/unit/gateway/connection.test.ts (5022ms)',
    '    ✕ test_gateway_reconnect_backoff_timeout (5000ms)',
    '      ERR_MODULE_TIMEOUT_408: Gateway connection timed out after 5000ms in test/unit/gateway/connection.test.ts:89',
    '      BUILD_TARGET_HASH = "8f1a2c9b"',
    '      at Timeout._onTimeout (/workspace/src/gateway/connection.ts:114:21)',
    '      at listOnTimeout (node:internal/timers:573:17)',
    '      at process.processTimers (node:internal/timers:514:7)',
    'Test Suites: 1 failed, 75 passed, 76 total',
    'Tests:       1 failed, 150 passed, 151 total',
    'Snapshots:   0 total',
    'Time:        14.821 s',
    'Ran all test suites matching /test\\/unit/i.'
  ].join('\n');

  return {
    id: 'Scenario_A',
    name: 'Verbose Build & Test Waterfall',
    userRequest: 'Run the test suite for @core/gateway and investigate any failures.',
    toolName: 'bash',
    toolArgs: '{"command":"npm test -- --scope=@core/gateway"}',
    toolContent,
    needles: ['ERR_MODULE_TIMEOUT_408', '8f1a2c9b'],
    optimalAction: 'truncate',
    suggestedKeepLines: 15,
    isNoisy: true
  };
}

function buildScenarioB() {
  const noiseLines = [];
  for (let i = 1; i <= 74; i++) {
    if (i === 42) {
      noiseLines.push('src/runtime/worker.ts:142:export async function dispatchSessionWorker(sessionId: string, opts: WorkerOptions): Promise<WorkerHandle>');
    } else {
      noiseLines.push(`src/legacy/v${i % 5}/dispatcher_internal_${i}.ts:${10 + i}: // internal reference to dispatchEvent(ev_${i})`);
    }
  }
  const toolContent = noiseLines.join('\n');

  return {
    id: 'Scenario_B',
    name: 'Exploratory Grep/Find Dump',
    userRequest: 'Find where session worker dispatching is implemented in the codebase.',
    toolName: 'bash',
    toolArgs: '{"command":"grep -rn \\"dispatchSessionWorker\\" src/"}',
    toolContent,
    needles: ['dispatchSessionWorker', 'src/runtime/worker.ts:142'],
    optimalAction: 'replace',
    suggestedKeepLines: null,
    isNoisy: true
  };
}

function buildScenarioC() {
  const stackLines = [
    'FATAL: 2026-11-13T01:30:14.291Z [db-pool-worker] Uncaught database driver exception',
    'DatabaseDeadlockException: Lock wait timeout exceeded; try restarting transaction',
    'Transaction Context: TXN_994021_DEADLOCK (isolation=SERIALIZABLE, attempts=3)',
    '  Resource conflict on table: orders_v2 [row_id=8841029, locked_by_pid=4402]',
    '  Current connection PID: 4519, State: ACTIVE, Duration: 12004ms'
  ];
  for (let i = 1; i <= 55; i++) {
    stackLines.push(`    at DriverConnection.executeInternal (/node_modules/pg-core/lib/client_${i}.js:${40 + (i % 30)}:19)`);
  }
  const toolContent = stackLines.join('\n');

  return {
    id: 'Scenario_C',
    name: 'Fatal Exception Crash & Stack Trace',
    userRequest: 'Check the database migration logs to see why the worker crashed.',
    toolName: 'bash',
    toolArgs: '{"command":"cat /var/log/db_migrate.log | tail -n 60"}',
    toolContent,
    needles: ['DatabaseDeadlockException', 'TXN_994021_DEADLOCK'],
    optimalAction: 'discard',
    suggestedKeepLines: null,
    isNoisy: true
  };
}

function buildScenarioD() {
  const toolContent = [
    '# Production Environment Configuration — Read Only',
    'DATABASE_HOST=prod-pg-primary.internal.net',
    'DATABASE_PORT=5432',
    'DATABASE_USER=app_service_prod',
    'DATABASE_NAME=production_core',
    'REDIS_CLUSTER_URL=rediss://cache-prod-cluster.internal:6379',
    'KAFKA_BROKER_LIST=10.0.8.51:9092,10.0.8.52:9092',
    'AUTH_JWT_SECRET=k9_ProdSecret_987xza_SecureKey',
    'PORT=8080',
    'LOG_LEVEL=info',
    'RATE_LIMIT_PER_MINUTE=1200',
    'ENABLE_CIRCUIT_BREAKER=true',
    'TIMEOUT_MS=5000',
    'MAX_IDLE_CONNECTIONS=50',
    'REPLICA_READ_ENABLED=true'
  ].join('\n');

  return {
    id: 'Scenario_D',
    name: 'High-Signal Critical Config Read',
    userRequest: 'Inspect production database and authentication configuration in .env.production before restarting service.',
    toolName: 'read',
    toolArgs: '{"file_path":".env.production"}',
    toolContent,
    needles: ['DATABASE_PORT=5432', 'AUTH_JWT_SECRET=k9_ProdSecret_987xza_SecureKey'],
    optimalAction: 'keep', // High signal: keeping intact is optimal!
    suggestedKeepLines: null,
    isNoisy: false
  };
}

export const SCENARIOS = [
  buildScenarioA(),
  buildScenarioB(),
  buildScenarioC(),
  buildScenarioD()
];

// ---------------------------------------------------------
// API Call Runner with Exponential Backoff
// ---------------------------------------------------------
async function callDeepSeekAPI(messages, tools, retries = 3) {
  const payload = {
    model: MODEL,
    messages,
    tools,
    temperature: 0.1,
    max_tokens: 2048
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
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
      console.warn(`[WARN] API call failed (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

// ---------------------------------------------------------
// Single Evaluation Turn
// ---------------------------------------------------------
export async function evaluateTurn(variant, scenario) {
  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const lineCount = scenario.toolContent.split('\n').length;
  const charLen = scenario.toolContent.length;

  // Build message sequence
  const messages = [
    { role: 'system', content: variant.systemPrompt },
    { role: 'user', content: scenario.userRequest },
    {
      role: 'assistant',
      content: '',
      reasoning_content: `I will execute ${scenario.toolName} to address the user request.`,
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: {
            name: scenario.toolName,
            arguments: scenario.toolArgs
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: callId,
      content: scenario.toolContent
    }
  ];

  // For V4: inject active proximal nudge right after tool output
  if (variant.id === 'V4') {
    const suggestedKeep = scenario.suggestedKeepLines || 15;
    messages.push({
      role: 'user',
      content: [
        `[⚡ DSH-OSWYN 单步压力感知提示]:`,
        `上一步工具调用产出了较大体积结果（约 ${lineCount} 行 / ${charLen} 字符）。`,
        `请在当前回复或下一步操作首部附带如下精炼围栏进行上下文保护（100% 保持 KV-Cache 前缀命中）：`,
        '```dsh-result-summary',
        `truncate keep ${suggestedKeep} lines`,
        '- [提取关键状态、报错码或定位结果]',
        '```',
        `（严禁直接输出空正文，请立即执行上述前缀保护或丢弃截断）`
      ].join('\n')
    });
  }

  const startTime = Date.now();
  const apiResp = await callDeepSeekAPI(messages, SWE_TOOLS);
  const latencyMs = Date.now() - startTime;

  const choice = apiResp.choices?.[0];
  const message = choice?.message || {};
  const content = message.content || '';
  const reasoning = message.reasoning_content || '';
  const toolCalls = message.tool_calls || [];
  const usage = apiResp.usage || {};

  // Parse fences in content
  const block = findSummaryBlock(content);
  const emitted = Boolean(block);
  let parsedMode = null;
  let parsedValid = false;
  let keepCount = null;
  let keepUnit = null;
  let summaryText = '';

  if (block) {
    try {
      const parsed = parseSummaryBody(block.rawHeader, block.body);
      // check if body had explicit discard or truncate
      if (block.body.startsWith('discard') || (block.rawHeader && block.rawHeader.includes('discard'))) {
        parsedMode = 'discard';
      } else {
        parsedMode = parsed.mode || 'replace';
      }
      keepCount = parsed.keepCount;
      keepUnit = parsed.keepUnit;
      summaryText = parsed.summary || '';
      parsedValid = Boolean(summaryText || parsedMode === 'discard');
    } catch {
      parsedValid = false;
    }
  }

  // Check needles in content + summary + reasoning + (retained context if uncompressed/truncated)
  let retainedText = `${content}\n${reasoning}`;
  if (!emitted) {
    retainedText += '\n' + scenario.toolContent;
  } else if (parsedMode === 'truncate' && keepCount) {
    const keptLines = scenario.toolContent.split('\n').slice(0, keepCount).join('\n');
    retainedText += '\n' + keptLines;
  }
  const needlesFound = scenario.needles.filter((n) => retainedText.includes(n));
  const needleRecallRate = scenario.needles.length > 0 ? needlesFound.length / scenario.needles.length : 1.0;

  // Compression ratio computation
  let compressedChars = charLen;
  if (emitted) {
    if (parsedMode === 'discard') {
      compressedChars = 0;
    } else if (parsedMode === 'truncate' && keepCount) {
      const originalLines = scenario.toolContent.split('\n');
      const keptLines = originalLines.slice(0, keepCount).join('\n');
      compressedChars = keptLines.length + (summaryText.length || 0);
    } else if (parsedMode === 'replace') {
      compressedChars = summaryText.length || 100;
    }
  }
  const netCompressionRatio = Math.max(0, Math.min(100, ((charLen - compressedChars) / charLen) * 100));

  return {
    variantId: variant.id,
    variantName: variant.name,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    optimalAction: scenario.optimalAction,
    isNoisy: scenario.isNoisy,
    latencyMs,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    cacheHitTokens: usage.prompt_cache_hit_tokens || 0,
    cacheMissTokens: usage.prompt_cache_miss_tokens || 0,
    hasToolCall: toolCalls.length > 0,
    toolCallsCount: toolCalls.length,
    contentChars: content.length,
    reasoningChars: reasoning.length,
    emitted,
    parsedValid,
    parsedMode,
    keepCount,
    keepUnit,
    rawHeader: block ? block.rawHeader : null,
    bodySnippet: block ? block.body.slice(0, 150) : null,
    needlesRecalled: needlesFound.length,
    needlesTotal: scenario.needles.length,
    needleRecallRate,
    netCompressionRatio: Number(netCompressionRatio.toFixed(2)),
    voluntaryTrigger: emitted ? 1 : 0,
    rawContentSnippet: content.slice(0, 200)
  };
}

// ---------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------
export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: false,
    mock: false,
    scenario: null,
    variant: null,
    save: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--mock') {
      args.mock = true;
    } else if (arg === '--save') {
      args.save = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--scenario' || arg === '-s') {
      args.scenario = argv[++i];
    } else if (arg.startsWith('--scenario=')) {
      args.scenario = arg.slice('--scenario='.length);
    } else if (arg === '--variant' || arg === '-v') {
      args.variant = argv[++i];
    } else if (arg.startsWith('--variant=')) {
      args.variant = arg.slice('--variant='.length);
    }
  }
  return args;
}

// ---------------------------------------------------------
// Deterministic Mock Turn Generator (Offline Simulation)
// ---------------------------------------------------------
export function generateMockTurn(variant, scenario) {
  const charLen = scenario.toolContent.length;
  let emitted = false;
  let parsedMode = null;
  let keepCount = null;
  let keepUnit = 'chars';
  let summaryText = '';
  let hasToolCall = false;
  let mockContent = '';
  const mockReasoning = `Simulated reasoning for ${variant.id} on ${scenario.id}`;

  if (variant.id === 'V0') {
    // V0: Opt-out baseline. Models opt out on all scenarios because of escape clause
    hasToolCall = scenario.isNoisy;
    mockContent = scenario.isNoisy ? '' : 'Retaining high-signal configuration intact without summarization.';
    emitted = false;
  } else if (variant.id === 'V1') {
    // V1: P3 Decision Tree. Modal preemption suppresses content when tool is called
    if (scenario.isNoisy) {
      hasToolCall = true;
      mockContent = ''; // Modal preemption collapses content to empty string
      emitted = false;
    } else {
      hasToolCall = false;
      mockContent = 'I have inspected .env.production.';
      emitted = false;
    }
  } else if (variant.id === 'V2') {
    // V2: Co-Emission Contract with Step 0 Exemption
    if (scenario.id === 'Scenario_A') {
      hasToolCall = true;
      emitted = true;
      parsedMode = 'truncate';
      keepCount = 15;
      keepUnit = 'lines';
      summaryText = '- Build failed with ERR_MODULE_TIMEOUT_408 at target 8f1a2c9b\n- Gateway timeout needs increase';
      mockContent = `\`\`\`dsh-result-summary\ntruncate keep 15 lines\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_B') {
      hasToolCall = true;
      emitted = true;
      parsedMode = 'replace';
      summaryText = '- Target function found in src/runtime/worker.ts:142: dispatchSessionWorker(sessionId, opts)';
      mockContent = `\`\`\`dsh-result-summary\nreplace\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_C') {
      hasToolCall = true;
      emitted = true;
      parsedMode = 'discard';
      summaryText = '- Root cause: DatabaseDeadlockException on txn TXN_994021_DEADLOCK';
      mockContent = `\`\`\`dsh-result-summary\ndiscard\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_D') {
      // Step 0 Exemption: High-signal read-only config kept 100% intact!
      hasToolCall = false;
      emitted = false;
      mockContent = 'Inspected production configuration in .env.production. Database is on port 5432 and AUTH_JWT_SECRET is verified.';
    }
  } else if (variant.id === 'V3') {
    if (scenario.id === 'Scenario_A') {
      hasToolCall = true;
      emitted = true;
      parsedMode = 'truncate';
      keepCount = 15;
      keepUnit = 'lines';
      summaryText = '- Build failed with ERR_MODULE_TIMEOUT_408 at target 8f1a2c9b';
      mockContent = `\`\`\`dsh-result-summary\ntruncate keep 15 lines\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_B') {
      hasToolCall = true;
      emitted = true;
      parsedMode = 'replace';
      summaryText = '- Symbol located in src/runtime/worker.ts:142';
      mockContent = `\`\`\`dsh-result-summary\nreplace\n${summaryText}\n\`\`\``;
    } else {
      hasToolCall = true;
      emitted = false;
      mockContent = '';
    }
  } else if (variant.id === 'V4') {
    hasToolCall = true;
    emitted = true;
    if (scenario.id === 'Scenario_A') {
      parsedMode = 'truncate';
      keepCount = 15;
      keepUnit = 'lines';
      summaryText = '- Test timeout ERR_MODULE_TIMEOUT_408 hash 8f1a2c9b';
      mockContent = `\`\`\`dsh-result-summary\ntruncate keep 15 lines\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_B') {
      parsedMode = 'replace';
      summaryText = '- Target dispatchSessionWorker at src/runtime/worker.ts:142';
      mockContent = `\`\`\`dsh-result-summary\nreplace\n${summaryText}\n\`\`\``;
    } else if (scenario.id === 'Scenario_C') {
      parsedMode = 'discard';
      summaryText = '- Deadlock DatabaseDeadlockException TXN_994021_DEADLOCK';
      mockContent = `\`\`\`dsh-result-summary\ndiscard\n${summaryText}\n\`\`\``;
    } else {
      parsedMode = 'replace';
      summaryText = '- Config database port 5432';
      mockContent = `\`\`\`dsh-result-summary\nreplace\n${summaryText}\n\`\`\``;
    }
  }

  // Needles checking
  const needlesFound = scenario.needles.filter((n) => {
    if (!emitted) return true; // Kept intact -> 100% recall
    if (mockContent.includes(n)) return true;
    if (parsedMode === 'truncate' && keepCount) {
      const kept = scenario.toolContent.split('\n').slice(0, keepCount).join('\n');
      return kept.includes(n);
    }
    return false;
  });
  const needleRecallRate = scenario.needles.length > 0 ? needlesFound.length / scenario.needles.length : 1.0;

  // Compression ratio
  let compressedChars = charLen;
  if (emitted) {
    if (parsedMode === 'discard') {
      compressedChars = 0;
    } else if (parsedMode === 'truncate' && keepCount) {
      const kept = scenario.toolContent.split('\n').slice(0, keepCount).join('\n');
      compressedChars = kept.length + summaryText.length;
    } else if (parsedMode === 'replace') {
      compressedChars = summaryText.length || 100;
    }
  }
  const netCompressionRatio = Math.max(0, Math.min(100, ((charLen - compressedChars) / charLen) * 100));

  return {
    variantId: variant.id,
    variantName: variant.name,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    optimalAction: scenario.optimalAction,
    isNoisy: scenario.isNoisy,
    latencyMs: 120,
    promptTokens: 2450,
    completionTokens: 320,
    cacheHitTokens: 2200,
    cacheMissTokens: 250,
    hasToolCall,
    toolCallsCount: hasToolCall ? 1 : 0,
    contentChars: mockContent.length,
    reasoningChars: mockReasoning.length,
    emitted,
    parsedValid: emitted,
    parsedMode,
    keepCount,
    keepUnit,
    rawHeader: emitted && parsedMode === 'truncate' ? `keep ${keepCount} lines` : (parsedMode || ''),
    bodySnippet: emitted ? mockContent.slice(0, 150) : null,
    needlesRecalled: needlesFound.length,
    needlesTotal: scenario.needles.length,
    needleRecallRate,
    netCompressionRatio: Number(netCompressionRatio.toFixed(2)),
    voluntaryTrigger: emitted ? 1 : 0,
    rawContentSnippet: mockContent.slice(0, 200)
  };
}

// ---------------------------------------------------------
// Main Batch Runner
// ---------------------------------------------------------
export async function runBatchEvaluation(options = {}) {
  const isDryRun = Boolean(options.dryRun || options['dry-run']);
  const isMock = Boolean(options.mock);
  const filterScenario = options.scenario || null;
  const filterVariant = options.variant || null;
  const saveOutput = Boolean(options.save || (!isDryRun && options.save !== false));

  const dataDir = resolve(__dirname, '../../data/willingness');
  const outFilePath = resolve(dataDir, 'eval-results.json');

  console.log('===============================================================');
  console.log('       DSH Context Compression Prompt Variants Evaluator       ');
  console.log('===============================================================');
  console.log(`Endpoint:       ${isDryRun ? '[OFFLINE SIMULATION]' : API_URL}`);
  console.log(`Model:          ${isDryRun ? (isMock ? '[SYNTHETIC MOCK]' : '[CACHED DATA / MOCK]') : MODEL}`);
  console.log(`Execution Mode: ${isDryRun ? 'DRY-RUN (Offline Simulation — 0 Live API Calls)' : 'LIVE API BATCH'}`);
  if (filterVariant) console.log(`Filter Variant:  ${filterVariant}`);
  if (filterScenario) console.log(`Filter Scenario: ${filterScenario}`);
  console.log('---------------------------------------------------------------\n');

  let results = [];
  const variantKeys = (filterVariant ? [filterVariant] : Object.keys(PROMPT_VARIANTS))
    .filter((k) => PROMPT_VARIANTS[k]);
  const scenariosToRun = filterScenario ? SCENARIOS.filter((s) => s.id === filterScenario) : SCENARIOS;

  if (variantKeys.length === 0) {
    throw new Error(`Unknown variant: ${filterVariant}. Available: ${Object.keys(PROMPT_VARIANTS).join(', ')}`);
  }
  if (scenariosToRun.length === 0) {
    throw new Error(`Unknown scenario: ${filterScenario}. Available: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  }

  // In dry-run mode, attempt loading cached runs unless --mock is forced
  if (isDryRun && !isMock && existsSync(outFilePath)) {
    try {
      const cached = JSON.parse(readFileSync(outFilePath, 'utf8'));
      if (Array.isArray(cached.runs) && cached.runs.length > 0) {
        console.log(`[DRY-RUN] Loading cached evaluation data from: ${outFilePath}`);
        let loadedRuns = cached.runs;
        if (filterVariant) {
          loadedRuns = loadedRuns.filter((r) => r.variantId === filterVariant);
        }
        if (filterScenario) {
          loadedRuns = loadedRuns.filter((r) => r.scenarioId === filterScenario);
        }
        results = loadedRuns;
        for (const r of results) {
          const emitTag = r.emitted ? `EMITTED (${r.parsedMode})` : 'NO_FENCE';
          const toolTag = r.hasToolCall ? 'TOOL_CALLED' : 'TEXT_ONLY';
          const recallTag = `${r.needlesRecalled}/${r.needlesTotal}`;
          console.log(`[CACHED] [${r.variantId}] [${r.scenarioId}] | Fence: ${emitTag} | Tool: ${toolTag} | Needles: ${recallTag} | NetComp: ${r.netCompressionRatio}%`);
        }
      }
    } catch (err) {
      console.warn(`[WARN] Could not parse cached results (${err.message}). Falling back to mock runs.`);
    }
  }

  // If no results loaded (live mode, mock forced, or cache file missing)
  if (results.length === 0) {
    for (const vKey of variantKeys) {
      const variant = PROMPT_VARIANTS[vKey];
      console.log(`\n>>> Evaluating Variant [${variant.id}]: ${variant.name}`);

      for (const scenario of scenariosToRun) {
        process.stdout.write(`  - Scenario [${scenario.id}] (${scenario.name})... `);
        try {
          let turnResult;
          if (isDryRun) {
            turnResult = generateMockTurn(variant, scenario);
          } else {
            turnResult = await evaluateTurn(variant, scenario);
          }
          results.push(turnResult);
          const emitTag = turnResult.emitted ? `EMITTED (${turnResult.parsedMode})` : 'NO_FENCE';
          const toolTag = turnResult.hasToolCall ? 'TOOL_CALLED' : 'TEXT_ONLY';
          const recallTag = `${turnResult.needlesRecalled}/${turnResult.needlesTotal}`;
          console.log(`Done (${turnResult.latencyMs}ms) | Fence: ${emitTag} | Tool: ${toolTag} | Needles: ${recallTag} | NetComp: ${turnResult.netCompressionRatio}%`);
        } catch (err) {
          console.log(`FAILED: ${err.message}`);
          results.push({
            variantId: variant.id,
            scenarioId: scenario.id,
            error: err.message
          });
        }
        if (!isDryRun) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  // ---------------------------------------------------------
  // Aggregate Metrics Computation
  // ---------------------------------------------------------
  const summaryByVariant = {};
  for (const vKey of variantKeys) {
    const vResults = results.filter((r) => r.variantId === vKey && !r.error);
    const noisyResults = vResults.filter((r) => r.isNoisy);
    const scenarioD = vResults.find((r) => r.scenarioId === 'Scenario_D');

    const triggerCountNoisy = noisyResults.filter((r) => r.emitted).length;
    const triggerRateNoisy = noisyResults.length > 0 ? (triggerCountNoisy / noisyResults.length) * 100 : 0;
    const validCount = vResults.filter((r) => r.parsedValid).length;
    const complianceRate = triggerCountNoisy > 0 ? (validCount / triggerCountNoisy) * 100 : 0;
    const avgCompression = noisyResults.reduce((acc, r) => acc + r.netCompressionRatio, 0) / (noisyResults.length || 1);
    const avgRecall = (vResults.reduce((acc, r) => acc + r.needleRecallRate, 0) / (vResults.length || 1)) * 100;
    const totalPromptTokens = vResults.reduce((acc, r) => acc + (r.promptTokens || 0), 0);
    const totalCompletionTokens = vResults.reduce((acc, r) => acc + (r.completionTokens || 0), 0);
    const totalCacheHitTokens = vResults.reduce((acc, r) => acc + (r.cacheHitTokens || 0), 0);
    const cacheHitRate = totalPromptTokens > 0 ? (totalCacheHitTokens / totalPromptTokens) * 100 : 0;

    summaryByVariant[vKey] = {
      variantId: vKey,
      variantName: PROMPT_VARIANTS[vKey].name,
      triggerRateNoisy: Number(triggerRateNoisy.toFixed(1)),
      triggerCountNoisy,
      totalNoisy: noisyResults.length,
      scenarioD_Intact: scenarioD ? (!scenarioD.emitted ? 'YES (Intact)' : 'Compressed') : 'N/A',
      complianceRate: Number(complianceRate.toFixed(1)),
      avgCompression: Number(avgCompression.toFixed(1)),
      avgRecall: Number(avgRecall.toFixed(1)),
      cacheHitRate: Number(cacheHitRate.toFixed(1)),
      totalPromptTokens,
      totalCompletionTokens
    };
  }

  // Print Summary Table
  console.log('\n========================================================================================');
  console.log('                          EVALUATION SUMMARY BY PROMPT VARIANT                          ');
  console.log('========================================================================================');
  console.log('| Variant | Name                          | Willingness (A-C) | Validity | Net Comp | Recall | Config(D) Preserved |');
  console.log('|---------|-------------------------------|-------------------|----------|----------|--------|---------------------|');
  for (const s of Object.values(summaryByVariant)) {
    const pad = (str, len) => String(str).padEnd(len);
    console.log(`| ${pad(s.variantId, 7)} | ${pad(s.variantName, 29)} | ${pad(`${s.triggerRateNoisy}% (${s.triggerCountNoisy}/${s.totalNoisy})`, 17)} | ${pad(`${s.complianceRate}%`, 8)} | ${pad(`${s.avgCompression}%`, 8)} | ${pad(`${s.avgRecall}%`, 6)} | ${pad(s.scenarioD_Intact, 19)} |`);
  }
  console.log('========================================================================================\n');

  const outputData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      apiUrl: isDryRun ? '[OFFLINE SIMULATION]' : API_URL,
      model: isDryRun ? '[OFFLINE SIMULATION]' : MODEL,
      isDryRun,
      totalRuns: results.length
    },
    summaryByVariant,
    runs: results
  };

  if (saveOutput) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(outFilePath, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`[SUCCESS] Raw evaluation data successfully saved to: ${outFilePath}`);
  } else if (isDryRun) {
    console.log(`[DRY-RUN] Evaluation complete. eval-results.json was NOT overwritten (pass --save to persist).`);
  }

  return outputData;
}

// ---------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.help) {
    console.log(`
DSH Context Compression Prompt Variant Evaluator

Usage:
  node tools/eval-prompt-variants.mjs [options]

Options:
  --dry-run             Run offline without live API calls (loads cached/mock data)
  --mock                Force synthetic mock run generation in dry-run mode
  --scenario, -s <id>   Run evaluation only for specific scenario (Scenario_A..D)
  --variant, -v <id>    Run evaluation only for specific variant (V0..V4)
  --save                Persist evaluation output to tools/data/eval-results.json
  --help, -h            Show this help message
`);
    process.exit(0);
  }

  runBatchEvaluation(cliArgs).catch((err) => {
    console.error(`[FATAL] Evaluation script failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}
