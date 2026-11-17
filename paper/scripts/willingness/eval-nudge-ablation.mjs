/**
 * eval-nudge-ablation.mjs
 *
 * Empirical ablation benchmark evaluating OSWYN Nudge variants:
 * 1. Length dimension: Verbose (Baseline v2.1) vs. Compact vs. Ultra-Compact
 * 2. Language dimension: Chinese (ZH) vs. English (EN) vs. Bilingual (MIX)
 *
 * Evaluates:
 * - Willingness Rate (W%): Triggering proactive summary fence
 * - Action Precision (P%): Selecting optimal directive (discard/truncate/replace)
 * - Syntax Compliance (C%): Valid syntax according to parser
 * - Needle Retention (R%): Retaining critical formulas/keys/needles
 * - Step 0 Safety (S0%): Abstaining from summarizing configs/secrets
 * - Token Overhead (tokens): Prompt token cost of the nudge itself
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSummaryBlock, parseSummaryBody } from '../../../lib/core/parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Configurations
const API_URL = process.env.API_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.MODEL || 'deepseek-chat';

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

// -------------------------------------------------------------
// Base System Prompt (Co-Emission Protocol)
// -------------------------------------------------------------
const BASE_SYSTEM_PROMPT = `## Context Optimization & Mandatory Co-Emission Contract

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
// Nudge Variants
// -------------------------------------------------------------
const VARIANTS = {
  baseline: {
    id: 'baseline',
    name: 'Control (No Nudge)',
    lang: 'none',
    lengthType: 'none',
    generateNudge: () => null
  },

  zh_verbose: {
    id: 'zh_verbose',
    name: 'ZH Verbose (v2.1 Baseline)',
    lang: 'zh',
    lengthType: 'verbose',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      if (isError) {
        return [
          '[DSH-OSWYN 失败调用精炼提示]',
          `检测到上一步工具执行失败/报错（输出约 ${lines} 行 / ${chars} 字符）。`,
          '【核心准则 · 丢弃 vs 压缩】：',
          '· 丢弃 (`discard`) = 同时替换输入 + 输出：不仅折叠报错堆栈输出，还会将本次失败调用的入参 (`arguments`) 清空为 `{}`，一次性回收输入与输出 Token。',
          '· 强烈建议采用 Mode C (`discard`) 整段丢弃报错调用，仅提炼 1~2 行核心事实结论（注意 Formula-Safe Verbatim：报错中暴露的活跃参数、常量与算式必须逐字原样保留，严禁省略具体数值）：',
          '```dsh-result-summary',
          'discard',
          '- 失败结论：<记录失败根因，并逐字保留报错中的关键参数/数值/公式>',
          '```',
          '完整报错已持久留底账，后续计算若需回查任何细节，必须调用 tool_result_recall 逐字节召回。'
        ].join('\n');
      }
      return [
        '[DSH-OSWYN 上下文精炼提示]',
        `上一步工具输出约 ${lines} 行 / ${chars} 字符。`,
        '【三步主动精炼决策（严格区分「丢弃」与「压缩」边界）】：',
        '1. 丢弃 (`discard` / `discard entire-ptc`) — 同时替换输入 + 输出：用于一次性探针、校验、无果搜索或执行后无需保留脚本源码与输出的步骤（同步清空调用入参 `arguments` 与返回结果）；',
        '2. 截断压缩 (`truncate keep <N> lines`) — 只替换输出，保留输入（首选）：用于长日志、测试输出、扫描列表，从第 0 字节保留前 N 行（100% 命中 KV 缓存），零总结开销；',
        '3. 提炼压缩 (`replace`) — 只替换输出，保留输入：用于排查/探索性阅读过的非目标代码或搜索结果，替换为 1~3 行高密度事实（Formula-Safe Verbatim 铁律：源码中的数学公式、除数、位运算/模运算表达式、分支条件与活跃常量必须逐字原样复制，严禁改写为模糊定性描述！）；',
        '示例：',
        '```dsh-result-summary',
        'replace',
        '- Read worker.ts: BUCKET_REFILL_RATE = 43; applyBurstWindow = ...',
        '```',
        '完整原文随时可用 tool_result_recall 逐字节召回。'
      ].join('\n');
    }
  },

  zh_compact: {
    id: 'zh_compact',
    name: 'ZH Compact (Structured)',
    lang: 'zh',
    lengthType: 'compact',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      return [
        `[⚡ DSH-OSWYN 上下文精炼提示]`,
        `检测到上步工具输出冗余 (${toolName || 'tool'}, 约 ${chars} 字符)。`,
        `请在当前操作首部附带 \`\`\`dsh-result-summary 执行精炼：`,
        `- 失败/报错：首行 \`discard\`（丢弃入参及报错，原样保留失败常量与根因）`,
        `- 长日志/测试：首行 \`truncate keep 15 lines\`（保留头部 100% 缓存命中）`,
        `- 搜索/探测：首行 \`replace\`（提炼 1~2 行事实，逐字复制数值与公式）`,
        `【Step 0 豁免】：若为正在排查的核心源码、配置或 .env，全量保留，严禁压缩。`
      ].join('\n');
    }
  },

  zh_ultra: {
    id: 'zh_ultra',
    name: 'ZH Ultra-Compact (Action Trigger)',
    lang: 'zh',
    lengthType: 'ultra',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      return `[⚡ DSH-OSWYN] 上步工具输出冗余(${chars}字符)，请在回复首部附带 \`\`\`dsh-result-summary 执行 truncate 或 discard。【Step 0 核心配置豁免】`;
    }
  },

  en_verbose: {
    id: 'en_verbose',
    name: 'EN Verbose (Full Tutorial)',
    lang: 'en',
    lengthType: 'verbose',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      if (isError) {
        return [
          '[DSH-OSWYN Failed Execution Compacting Notice]',
          `Previous tool execution encountered an error (~${lines} lines / ${chars} chars).`,
          '【Core Principle · Discard vs Compress】:',
          '- Discard (`discard`) = Replaces BOTH input arguments and output: Clears error stack and resets arguments to `{}`.',
          '- Strongly recommend Mode C (`discard`) to drop the failed call, summarizing 1-2 core factual root causes (Formula-Safe Verbatim: verbatim constants, error codes, and assertions must be copied exact):',
          '```dsh-result-summary',
          'discard',
          '- Failure: <record root cause with exact parameters/numbers/formulas>',
          '```',
          'Full output is permanently logged; call tool_result_recall to retrieve if needed.'
        ].join('\n');
      }
      return [
        '[DSH-OSWYN Context Optimization Notice]',
        `Previous tool output is approximately ${lines} lines / ${chars} chars.`,
        '【3-Step Active Distillation Protocol】:',
        '1. Discard (`discard`) - Replaces both input and output: For failed executions, dead-end traces, or one-off probes;',
        '2. Truncate (`truncate keep <N> lines`) - Replaces output only, keeps input: Preferred for long build logs, test dumps, scans. Preserves first N lines from byte 0 for 100% KV-cache hit;',
        '3. Replace (`replace`) - Replaces output only, keeps input: For exploratory search or reading non-target files. Extract 1-3 dense factual bullets (Formula-Safe Verbatim: formulas, constants, and active variables must be copied verbatim!);',
        'Example:',
        '```dsh-result-summary',
        'replace',
        '- Read worker.ts: BUCKET_REFILL_RATE = 43; dispatchSessionWorker(id, opts)',
        '```',
        'Full original output is always retrievable via tool_result_recall.'
      ].join('\n');
    }
  },

  en_compact: {
    id: 'en_compact',
    name: 'EN Compact (Structured)',
    lang: 'en',
    lengthType: 'compact',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      return [
        `[⚡ DSH-OSWYN Context Optimization]`,
        `Noisy tool output detected (${toolName || 'tool'}, ~${chars} chars).`,
        `Please prepend \`\`\`dsh-result-summary to your response:`,
        `- Failed/Error: 1st line \`discard\` (clear error & args; preserve failure constants verbatim)`,
        `- Long logs/tests: 1st line \`truncate keep 15 lines\` (100% KV-cache hit)`,
        `- Search/Explore: 1st line \`replace\` (1-2 factual bullets, verbatim formulas)`,
        `【Step 0 Exemption】: Active target files, .env, and core configs must remain intact.`
      ].join('\n');
    }
  },

  en_ultra: {
    id: 'en_ultra',
    name: 'EN Ultra-Compact (Action Trigger)',
    lang: 'en',
    lengthType: 'ultra',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      return `[⚡ DSH-OSWYN] Noisy tool output (${chars} chars). Prepend \`\`\`dsh-result-summary with discard/truncate before proceeding. (Step 0 configs exempt).`;
    }
  },

  bilingual_compact: {
    id: 'bilingual_compact',
    name: 'Bilingual Compact (Hybrid)',
    lang: 'bilingual',
    lengthType: 'compact',
    generateNudge: ({ lines, chars, isError, toolName }) => {
      return [
        `[⚡ DSH-OSWYN] 检测到冗余工具输出 (${toolName || 'tool'}, ~${chars} chars)。`,
        `请在当前操作首部附带 \`\`\`dsh-result-summary 执行精炼：`,
        `- Error -> \`discard\` | Logs -> \`truncate keep 15 lines\` | Search -> \`replace\``,
        `【Step 0 豁免】：核心代码、.env 与关键配置严禁压缩。`
      ].join('\n');
    }
  }
};

// -------------------------------------------------------------
// Test Scenarios (A - D)
// -------------------------------------------------------------
function getScenarios() {
  // Scenario A: Build / Test cascade
  const passLines = [];
  for (let i = 1; i <= 60; i++) {
    passLines.push(`  PASS test/unit/auth/token_spec_${i}.test.ts (took ${12 + (i % 7)}ms)`);
  }
  const toolContentA = [
    '=== RUNNING TEST SUITE: @core/gateway ===',
    'NODE_ENV=test ts-node --project tsconfig.test.json',
    ...passLines,
    '  FAIL test/unit/gateway/connection.test.ts (5022ms)',
    '    ✕ test_gateway_reconnect_backoff_timeout (5000ms)',
    '      ERR_MODULE_TIMEOUT_408: Gateway connection timed out after 5000ms in test/unit/gateway/connection.test.ts:89',
    '      BUILD_TARGET_HASH = "8f1a2c9b"',
    '      at Timeout._onTimeout (/workspace/src/gateway/connection.ts:114:21)',
    'Test Suites: 1 failed, 60 passed, 61 total'
  ].join('\n');

  // Scenario B: Exploratory grep
  const noiseLines = [];
  for (let i = 1; i <= 50; i++) {
    if (i === 28) {
      noiseLines.push('src/runtime/worker.ts:142:export async function dispatchSessionWorker(sessionId: string, opts: WorkerOptions): Promise<WorkerHandle>');
    } else {
      noiseLines.push(`src/legacy/v${i % 5}/dispatcher_internal_${i}.ts:${10 + i}: // internal reference to dispatchEvent(ev_${i})`);
    }
  }
  const toolContentB = noiseLines.join('\n');

  // Scenario C: Crash / Stack trace
  const stackLines = [
    'FATAL: 2026-11-13T01:30:14.291Z [db-pool-worker] Uncaught database driver exception',
    'DatabaseDeadlockException: Lock wait timeout exceeded; try restarting transaction',
    'Transaction Context: TXN_994021_DEADLOCK (isolation=SERIALIZABLE, attempts=3)',
    '  Resource conflict on table: orders_v2 [row_id=8841029, locked_by_pid=4402]'
  ];
  for (let i = 1; i <= 35; i++) {
    stackLines.push(`    at DriverConnection.executeInternal (/node_modules/pg-core/lib/client_${i}.js:${40 + (i % 30)}:19)`);
  }
  const toolContentC = stackLines.join('\n');

  // Scenario D: Step 0 Exemption Guard (Control - Should NOT summarize)
  const toolContentD = [
    '# .env.production',
    'DATABASE_URL=postgresql://app_rw:x99aF_882@db-cluster.internal:5432/orders_prod?sslmode=verify-full',
    'REDIS_PRIMARY_URL=rediss://:k919a_redis_secret@redis-cluster.internal:6379/0',
    'JWT_SIGNING_KEY=rsa_priv_d8921af78921bca98102938102',
    'SESSION_SECRET=sec_9918239018230912',
    'AWS_S3_BUCKET=prod-assets-vault',
    'PORT=8080'
  ].join('\n');

  return [
    {
      id: 'A_test_waterfall',
      name: 'Scenario A: Test Waterfall',
      userRequest: 'Run the test suite for @core/gateway and investigate any failures.',
      toolName: 'bash',
      toolArgs: '{"command":"npm test -- --scope=@core/gateway"}',
      toolContent: toolContentA,
      isError: false,
      optimalAction: 'truncate',
      needles: ['ERR_MODULE_TIMEOUT_408', '8f1a2c9b'],
      isExempt: false
    },
    {
      id: 'B_grep_search',
      name: 'Scenario B: Exploratory Search',
      userRequest: 'Find where session worker dispatching is implemented in the codebase.',
      toolName: 'bash',
      toolArgs: '{"command":"grep -rn \\"dispatchSessionWorker\\" src/"}',
      toolContent: toolContentB,
      isError: false,
      optimalAction: 'replace',
      needles: ['dispatchSessionWorker', 'src/runtime/worker.ts:142'],
      isExempt: false
    },
    {
      id: 'C_crash_stack',
      name: 'Scenario C: Error Crash Stack',
      userRequest: 'Check the database migration logs to see why the worker crashed.',
      toolName: 'bash',
      toolArgs: '{"command":"cat /var/log/db_migrate.log | tail -n 40"}',
      toolContent: toolContentC,
      isError: true,
      optimalAction: 'discard',
      needles: ['DatabaseDeadlockException', 'TXN_994021_DEADLOCK'],
      isExempt: false
    },
    {
      id: 'D_step0_config',
      name: 'Scenario D: Config Secret (Step 0)',
      userRequest: 'Inspect .env.production to check database connection parameters before deploying.',
      toolName: 'read',
      toolArgs: '{"file_path":".env.production"}',
      toolContent: toolContentD,
      isError: false,
      optimalAction: 'none', // Must keep resident!
      needles: ['DATABASE_URL', 'JWT_SIGNING_KEY'],
      isExempt: true
    }
  ];
}

// -------------------------------------------------------------
// SWE Tools Definition
// -------------------------------------------------------------
const SWE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a bash shell command in the workspace terminal',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to execute' } },
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
        properties: { file_path: { type: 'string', description: 'Path to the file' } },
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
          file_path: { type: 'string', description: 'Path to file' },
          content: { type: 'string', description: 'New file content' }
        },
        required: ['file_path', 'content']
      }
    }
  }
];

// -------------------------------------------------------------
// Model Inference & Throttling
// -------------------------------------------------------------
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callDeepSeek(messages) {
  const payload = {
    model: MODEL,
    messages,
    tools: SWE_TOOLS,
    temperature: 0.1,
    max_tokens: 600
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const promptTokens = json.usage?.prompt_tokens || 0;
  const completionTokens = json.usage?.completion_tokens || 0;
  return { content, promptTokens, completionTokens };
}

// -------------------------------------------------------------
// Evaluation Driver
// -------------------------------------------------------------
async function runAblation() {
  console.log(`=================================================================`);
  console.log(`OSWYN Nudge Ablation Evaluation: Length & Language Optimization`);
  console.log(`Model: ${MODEL} | API: ${API_URL}`);
  console.log(`=================================================================\n`);

  const scenarios = getScenarios();
  const variantKeys = Object.keys(VARIANTS);
  const results = [];

  for (const vKey of variantKeys) {
    const variant = VARIANTS[vKey];
    console.log(`--> Testing Variant: [${variant.id}] ${variant.name}`);

    for (const sc of scenarios) {
      const lines = sc.toolContent.split('\n').length;
      const chars = sc.toolContent.length;

      const nudgeText = variant.generateNudge({
        lines,
        chars,
        isError: sc.isError,
        toolName: sc.toolName
      });

      // Assemble Messages conforming to standard OpenAI/DeepSeek Tool Call contract
      const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const messages = [
        { role: 'system', content: BASE_SYSTEM_PROMPT },
        { role: 'user', content: sc.userRequest },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: callId,
              type: 'function',
              function: {
                name: sc.toolName,
                arguments: sc.toolArgs || '{}'
              }
            }
          ]
        },
        { role: 'tool', tool_call_id: callId, name: sc.toolName, content: sc.toolContent }
      ];

      // Ephemeral Tail Injection (if nudge exists)
      if (nudgeText) {
        messages.push({
          role: 'user',
          content: nudgeText
        });
      }

      // Approximate Nudge Token Overhead (char / 3.5 or prompt tokens diff)
      const nudgeTokens = nudgeText ? Math.round(nudgeText.length / (variant.lang === 'en' ? 4 : 2.5)) : 0;

      const startTime = Date.now();
      let response = { content: '', promptTokens: 0, completionTokens: 0 };
      let error = null;

      try {
        response = await callDeepSeek(messages);
      } catch (err) {
        error = err.message;
        console.error(`    [FAIL] ${sc.id}: ${err.message}`);
      }

      const durationMs = Date.now() - startTime;
      await sleep(600); // polite rate limit

      // Parse output
      const rawText = response.content;
      const summaryBlock = findSummaryBlock(rawText);
      const hasSummaryFence = summaryBlock !== null;
      let parsed = null;
      let actionChosen = 'none';

      if (hasSummaryFence) {
        parsed = parseSummaryBody(summaryBlock.body);
        actionChosen = parsed.explicitMode || (parsed.truncateLines ? 'truncate' : 'replace');
      }

      // Check Step 0 safety: for Scenario D, having NO summary fence is SUCCESS!
      const step0Safe = sc.isExempt ? !hasSummaryFence : true;

      // Check Needle Retention
      let needlesRetained = 0;
      if (sc.needles.length > 0) {
        for (const needle of sc.needles) {
          if (rawText.includes(needle)) needlesRetained++;
        }
      }
      const needleRetentionRate = needlesRetained / sc.needles.length;

      // Check Action Match
      let actionMatchesOptimal = false;
      if (sc.isExempt) {
        actionMatchesOptimal = !hasSummaryFence;
      } else {
        if (sc.optimalAction === 'truncate') {
          actionMatchesOptimal = actionChosen === 'truncate' || actionChosen === 'replace';
        } else if (sc.optimalAction === 'discard') {
          actionMatchesOptimal = actionChosen === 'discard';
        } else if (sc.optimalAction === 'replace') {
          actionMatchesOptimal = actionChosen === 'replace' || actionChosen === 'truncate';
        }
      }

      const row = {
        variantId: variant.id,
        variantName: variant.name,
        lang: variant.lang,
        lengthType: variant.lengthType,
        scenarioId: sc.id,
        isExempt: sc.isExempt,
        nudgeText,
        nudgeTokens,
        hasSummaryFence,
        actionChosen,
        optimalAction: sc.optimalAction,
        actionMatchesOptimal,
        step0Safe,
        needleRetentionRate,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        durationMs,
        rawSnippet: rawText.slice(0, 160).replace(/\n/g, ' ')
      };

      results.push(row);
      const wFlag = hasSummaryFence ? '✅ FENCE' : '❌ NO_FENCE';
      const aFlag = actionMatchesOptimal ? '🎯 OPT' : '⚠️ MISMATCH';
      console.log(`    [${sc.id}] ${wFlag} | Act: ${actionChosen} (${aFlag}) | Step0Safe: ${step0Safe} | Tokens: ${response.promptTokens}`);
    }
  }

  // -------------------------------------------------------------
  // Aggregate Metrics per Variant
  // -------------------------------------------------------------
  const summary = {};
  for (const vKey of variantKeys) {
    const vRows = results.filter((r) => r.variantId === vKey);
    const noisyRows = vRows.filter((r) => !r.isExempt);
    const exemptRows = vRows.filter((r) => r.isExempt);

    const willingnessCount = noisyRows.filter((r) => r.hasSummaryFence).length;
    const willingnessRate = (willingnessCount / noisyRows.length) * 100;

    const actionMatchCount = noisyRows.filter((r) => r.actionMatchesOptimal).length;
    const actionAccuracy = (actionMatchCount / noisyRows.length) * 100;

    const step0SafeCount = exemptRows.filter((r) => r.step0Safe).length;
    const step0SafetyRate = (step0SafeCount / exemptRows.length) * 100;

    const avgRetention = (noisyRows.reduce((a, b) => a + b.needleRetentionRate, 0) / noisyRows.length) * 100;
    const avgNudgeTokens = Math.round(vRows.reduce((a, b) => a + b.nudgeTokens, 0) / vRows.length);
    const avgPromptTokens = Math.round(vRows.reduce((a, b) => a + b.promptTokens, 0) / vRows.length);

    summary[vKey] = {
      variantId: vKey,
      name: VARIANTS[vKey].name,
      lang: VARIANTS[vKey].lang,
      lengthType: VARIANTS[vKey].lengthType,
      willingnessRate,
      actionAccuracy,
      step0SafetyRate,
      needleRetentionRate: avgRetention,
      avgNudgeTokens,
      avgPromptTokens
    };
  }

  // Save JSON Results
  const outDir = resolve(__dirname, '../../paper/data/willingness');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'nudge_ablation_results.json'), JSON.stringify({ results, summary }, null, 2));

  console.log(`\n=================================================================`);
  console.log(`SUMMARY MATRIX: NUDGE LENGTH & LANGUAGE BENCHMARK`);
  console.log(`=================================================================`);
  console.table(summary);

  return { results, summary };
}

runAblation().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
