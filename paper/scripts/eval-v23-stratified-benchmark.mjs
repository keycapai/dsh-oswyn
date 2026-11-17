/**
 * eval-v23-stratified-benchmark.mjs
 *
 * Empirical benchmark evaluating OSWYN v2.3 Post-Cache Deep Distillation:
 * Compares v2.2 (standard compressed with full intermediate traces preserved on cache miss)
 * vs v2.3 (post-cache distill: strips historical <think> and tool calls/results upon KV-cache expiration)
 * across High-Correlation (HC) and Low-Correlation (LC) task cohorts.
 *
 * Also tests granular multimodal recall primitives:
 * - mode: 'think' (recalls only thinking reasoning traces of specified round)
 * - mode: 'tool' (recalls only tool calls and results of specified round)
 * - mode: 'both' (recalls both thinking and tools of specified round)
 *
 * Model: group/deepseek-v4.1-flash via http://127.0.0.1:3425/v1/chat/completions
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectDistilledHistory } from '../../lib/core/projection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = process.env.API_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const MODEL = process.env.MODEL || 'group/deepseek-v4.1-flash';

// Pricing for DeepSeek V4.1 Flash ($ per token)
const PRICE_PROMPT_UNCACHED = 0.00000015; // $0.15 / M
const PRICE_PROMPT_CACHED = 0.000000003;  // $0.003 / M
const PRICE_COMPLETION = 0.0000006;       // $0.60 / M

/**
 * Perform a streaming chat completion call to measure exact TTFT and token usage.
 */
async function callDeepSeekStreaming(messages, maxTokens = 1200) {
  const t0 = performance.now();
  const payload = {
    model: MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true }
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error ${res.status}: ${errorText}`);
  }

  let ttft = null;
  let fullContent = '';
  let fullReasoning = '';
  let usage = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === ': keepalive') continue;
      if (trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (ttft === null && (delta?.content || delta?.reasoning_content)) {
            ttft = performance.now() - t0;
          }
          if (delta?.content) {
            fullContent += delta.content;
          }
          if (delta?.reasoning_content) {
            fullReasoning += delta.reasoning_content;
          }
          if (json.usage) {
            usage = json.usage;
          }
        } catch {
          // ignore chunk parse failure
        }
      }
    }
  }

  const totalTime = performance.now() - t0;
  if (ttft === null) ttft = totalTime;

  const promptTokens = usage?.prompt_tokens || 0;
  const completionTokens = usage?.completion_tokens || 0;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens || usage?.prompt_tokens_details?.cache_read_tokens || 0;
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);

  const cost = (uncachedPromptTokens * PRICE_PROMPT_UNCACHED)
    + (cachedTokens * PRICE_PROMPT_CACHED)
    + (completionTokens * PRICE_COMPLETION);

  return {
    content: fullContent.trim(),
    reasoning: fullReasoning.trim(),
    ttftMs: Math.round(ttft),
    totalTimeMs: Math.round(totalTime),
    usage: {
      promptTokens,
      cachedTokens,
      uncachedPromptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: promptTokens + completionTokens
    },
    costUsd: Number(cost.toFixed(8))
  };
}

// =========================================================================
// Benchmark Scenarios: Real multi-turn contexts with realistic tool bloat
// =========================================================================

// Synthetic realistic tool outputs (stack traces, memory metrics, db query plans)
const RAW_LOG_TRACE_R1 = `
[2026-11-17 02:11:04.102] CRITICAL thread_worker_pool.cpp:844 Thread deadlock detected in subpool-alpha
Thread ID: worker-419 (TID 88219), state: BLOCKED on Mutex M-4901 (0x7f8849c0)
Locked Memory Address: 0x00007f9a882, Holding Thread: worker-308 (TID 88102)
Stack trace:
 #0  0x00007f8832a10e82 in __futex_abstimed_wait_common64 () from /lib64/libc.so.6
 #1  0x00007f8832a13890 in pthread_mutex_lock () from /lib64/libc.so.6
 #2  0x000055c192084b12 in StorageEngine::AcquirePartitionLock(unsigned long partition_id=4021)
 #3  0x000055c192095cc0 in TransactionCoordinator::CommitPhaseOne(TxContext* tx=0x7ffee12a)
 #4  0x000055c1920ac341 in ServiceHandler::ProcessMutationBatch(RequestBatch const&)
 ... [truncated 142 lines of stack frames, memory registers, CPU cache line dumps]
 Register dump:
 RAX: 0x00000000000000ca RBX: 0x00007f8832c02940 RCX: 0x00007f8832a10e82
 RDX: 0x0000000000000000 RSI: 0x0000000000000080 RDI: 0x00007f8849c0
 Correlated transaction uuid: tx-9982-f810-bb41
`.repeat(3); // ~2.5k tokens

const RAW_NET_TRACE_R2 = `
[2026-11-17 02:11:32.881] Netstat inspection & TCP buffer telemetry:
Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program
tcp        0 148200 10.244.0.12:9443        10.244.3.188:51280      ESTABLISHED 419/engine-srv
  TCP Info: state=ESTABLISHED, ca_state=CA_Loss, retrans=14, unacked=4188201
  snd_wscale=7, rcv_wscale=7, snd_ssthresh=28, rtt=184.2ms, rttvar=42.1ms
  Kernel TCP socket buffer backlog: 409600 bytes
  Peer IP: 10.244.3.188 (ingress gateway node 3)
  Target service endpoint: /v2/telemetry/push
  Raw frame bytes: 0x45 0x00 0x05 0xb4 0x1a 0x82 0x40 0x00 0x40 0x06
  Socket file descriptor: fd=84, inode=10928374
 ... [truncated 110 lines of interface statistics, routing table entries, and socket state dumps]
`.repeat(3); // ~2.8k tokens

const RAW_DB_MIGRATION_R1 = `
-- Migration Execution Log: 20261115_0821_add_tenant_sharding.sql
-- Started at: 2026-11-15 08:21:00 UTC
BEGIN;
ALTER TABLE orders DROP CONSTRAINT fk_orders_billing_account_id;
ALTER TABLE orders ADD COLUMN tenant_id BIGINT NOT NULL DEFAULT 0;
CREATE INDEX CONCURRENTLY idx_tenant_created_at ON orders (tenant_id, created_at DESC);
-- Checksum sha256:d8a94bf820ea1902cf711a8b3014e5f7200401b228f410e395781a980bb291a1
-- Execution summary: 148 tables scanned, 42918 rows locked
-- Status: MIGRATION_COMPLETE_WITH_WARNINGS (constraint dropped without cascade)
`.repeat(4);

const RAW_QUERY_PLAN_R2 = `
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM orders WHERE tenant_id = 90214 AND status = 'COMPLETED' ORDER BY created_at DESC LIMIT 100;
                                                        QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.43..482.15 rows=100 width=312) (actual time=0.082..4.120 rows=100 loops=1)
   ->  Index Scan using idx_tenant_created_at on public.orders  (cost=482.15..1980.40 rows=42918 width=312)
         Output: order_id, tenant_id, status, total_cents, created_at, metadata_json
         Index Cond: (orders.tenant_id = 90214)
         Filter: (orders.status = 'COMPLETED'::text)
         Rows Removed by Filter: 312
         Buffers: shared hit=419 read=12
 Planning Time: 0.281 ms
 Execution Time: 4.891 ms
`.repeat(4);

// Construct HC task scenarios
const HC_SCENARIOS = [
  {
    id: 'HC-1',
    name: 'Microservice Deadlock & Socket Diagnosis',
    round1: {
      user: 'Inspect the crash dump from subpool-alpha and find out why the worker froze.',
      assistantThink: '<think>Let me run GDB stack trace on the core dump of worker-419 to identify which lock is held and by whom. The thread is waiting on futex abstimed wait.</think>',
      toolName: 'system_diag',
      toolArgs: { target: 'core.88219', depth: 20 },
      toolResult: RAW_LOG_TRACE_R1,
      assistantReply: 'I have analyzed the crash dump. Thread worker-419 deadlocked while acquiring partition lock on Mutex M-4901 (0x7f8849c0), held by worker-308.'
    },
    round2: {
      user: 'Now inspect the network socket telemetry for engine-srv on port 9443.',
      assistantThink: '<think>Running netstat and tcp buffer telemetry to check for socket saturation or unacknowledged packets to the ingress gateway.</think>',
      toolName: 'netstat_inspect',
      toolArgs: { port: 9443, proto: 'tcp' },
      toolResult: RAW_NET_TRACE_R2,
      assistantReply: 'Inspected network telemetry. Discovered Send-Q buildup to peer 10.244.3.188 with 14 retransmissions due to socket buffer saturation.'
    },
    targetRound3: {
      user: 'Extract the following exact parameters from our previous steps:\n1. From round 2 socket inspection: What was the exact unacknowledged sequence number (unacked) and the Peer IP?\n2. From round 1 deadlock analysis: What was the exact thread ID that was blocked and the locked memory address?',
      goldNeedles: ['4188201', '10.244.3.188', 'worker-419', '0x00007f9a882']
    }
  },
  {
    id: 'HC-2',
    name: 'Database Migration & Execution Plan Audit',
    round1: {
      user: 'Check the database migration log for tenant sharding from earlier today.',
      assistantThink: '<think>Reading migration file 20261115_0821_add_tenant_sharding.sql and checking constraints and tables scanned.</think>',
      toolName: 'db_migration_audit',
      toolArgs: { migration: '20261115_0821' },
      toolResult: RAW_DB_MIGRATION_R1,
      assistantReply: 'Migration 20261115_0821 applied successfully. It added tenant_id and dropped the foreign key constraint fk_orders_billing_account_id.'
    },
    round2: {
      user: 'Run EXPLAIN ANALYZE on the filtered order query to see the index performance.',
      assistantThink: '<think>Running query optimizer explain plan to get buffer hits and cost estimates for idx_tenant_created_at.</think>',
      toolName: 'query_explain',
      toolArgs: { sql: 'SELECT * FROM orders WHERE tenant_id = 90214...' },
      toolResult: RAW_QUERY_PLAN_R2,
      assistantReply: 'Execution plan shows the query uses idx_tenant_created_at with fast index scan execution time of 4.891 ms.'
    },
    targetRound3: {
      user: 'From our previous investigation:\n1. In round 2, what was the exact cost range of the Index Scan on public.orders?\n2. In round 1, what was the exact foreign key constraint name that was dropped?',
      goldNeedles: ['482.15..1980.40', 'fk_orders_billing_account_id']
    }
  }
];

// Construct LC task scenarios
const LC_SCENARIOS = [
  {
    id: 'LC-1',
    name: 'Sliding Window Rate Limiter (TypeScript/Python)',
    // Preceding heavy turns to simulate a multi-turn session before topic shift
    round1: {
      user: 'Inspect the crash dump from subpool-alpha and find out why the worker froze.',
      assistantThink: '<think>Examining GDB crash logs and register state across threads.</think>',
      toolName: 'system_diag',
      toolArgs: { target: 'core.88219' },
      toolResult: RAW_LOG_TRACE_R1,
      assistantReply: 'Deadlock confirmed between worker-419 and worker-308 on mutex 0x7f8849c0.'
    },
    round2: {
      user: 'Check the socket state for port 9443.',
      assistantThink: '<think>Examining TCP send queues and loss state.</think>',
      toolName: 'netstat_inspect',
      toolArgs: { port: 9443 },
      toolResult: RAW_NET_TRACE_R2,
      assistantReply: 'Found Send-Q congestion to peer 10.244.3.188.'
    },
    targetRound3: {
      user: 'We are done with the diagnostics. Now, implement a standalone Python class `SlidingWindowRateLimiter` that enforces a rate limit of `max_requests` within a sliding window of `window_seconds`. It must be thread-safe using `threading.Lock`, provide an `allow_request(client_id: str) -> bool` method, and periodically clean up expired timestamps. Provide clean code with type annotations.',
      evaluationCriteria: [
        'class SlidingWindowRateLimiter',
        'allow_request',
        'threading.Lock',
        'time.time'
      ]
    }
  },
  {
    id: 'LC-2',
    name: 'Raft vs Paxos Consensus Architectural Comparison',
    round1: {
      user: 'Check the migration log for tenant sharding.',
      assistantThink: '<think>Reading migration file and checking constraints.</think>',
      toolName: 'db_migration_audit',
      toolArgs: { migration: '20261115_0821' },
      toolResult: RAW_DB_MIGRATION_R1,
      assistantReply: 'Migration 20261115_0821 completed with warnings.'
    },
    round2: {
      user: 'Explain the index performance on orders table.',
      assistantThink: '<think>Analyzing buffer cache and cost plan.</think>',
      toolName: 'query_explain',
      toolArgs: { sql: 'SELECT * FROM orders...' },
      toolResult: RAW_QUERY_PLAN_R2,
      assistantReply: 'Index scan cost range is 482.15..1980.40.'
    },
    targetRound3: {
      user: 'Switching subjects: Provide a structured comparison between Raft and Paxos consensus algorithms for distributed metadata storage. Detail: 1) Leader election mechanism, 2) Log compaction / snapshotting approach, and 3) Understandability and implementation pitfalls. Present a clear Markdown comparison table.',
      evaluationCriteria: [
        'Raft',
        'Paxos',
        'Leader election',
        'Log compaction',
        '|' // markdown table syntax
      ]
    }
  }
];

/**
 * Build standard multi-turn messages array from scenario definition.
 */
function buildRawMessages(scenario) {
  const messages = [
    { role: 'system', content: 'You are an expert AI software engineer and systems architect.' },
    // Turn 1
    { role: 'user', content: scenario.round1.user },
    {
      role: 'assistant',
      content: `${scenario.round1.assistantThink}\nI will inspect the system diagnostic logs.`,
      tool_calls: [
        {
          id: 'call_r1_001',
          type: 'function',
          function: {
            name: scenario.round1.toolName,
            arguments: JSON.stringify(scenario.round1.toolArgs)
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call_r1_001',
      content: scenario.round1.toolResult
    },
    {
      role: 'assistant',
      content: scenario.round1.assistantReply
    },
    // Turn 2
    { role: 'user', content: scenario.round2.user },
    {
      role: 'assistant',
      content: `${scenario.round2.assistantThink}\nI will inspect the secondary telemetry.`,
      tool_calls: [
        {
          id: 'call_r2_001',
          type: 'function',
          function: {
            name: scenario.round2.toolName,
            arguments: JSON.stringify(scenario.round2.toolArgs)
          }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: 'call_r2_001',
      content: scenario.round2.toolResult
    },
    {
      role: 'assistant',
      content: scenario.round2.assistantReply
    },
    // Turn 3 (Target user query)
    { role: 'user', content: scenario.targetRound3.user }
  ];

  return messages;
}

/**
 * Score accuracy for High-Correlation tasks (needle retrieval).
 */
function scoreHighCorrelation(replyContent, goldNeedles) {
  let hits = 0;
  const missing = [];
  const lowerContent = replyContent.toLowerCase();

  for (const needle of goldNeedles) {
    if (lowerContent.includes(needle.toLowerCase())) {
      hits += 1;
    } else {
      missing.push(needle);
    }
  }

  const accuracy = hits / goldNeedles.length;
  return {
    accuracy: Number(accuracy.toFixed(4)),
    hits,
    totalNeedles: goldNeedles.length,
    missing
  };
}

/**
 * Score accuracy for Low-Correlation tasks (code & architectural criteria).
 */
function scoreLowCorrelation(replyContent, criteria) {
  let hits = 0;
  const missing = [];

  for (const criterion of criteria) {
    if (replyContent.includes(criterion)) {
      hits += 1;
    } else {
      missing.push(criterion);
    }
  }

  const accuracy = hits / criteria.length;
  return {
    accuracy: Number(accuracy.toFixed(4)),
    hits,
    totalCriteria: criteria.length,
    missing
  };
}

// =========================================================================
// Main Benchmark Runner
// =========================================================================

async function runBenchmark() {
  console.log('='.repeat(70));
  console.log(`OSWYN v2.3 Post-Cache Distill Empirical Evaluation`);
  console.log(`Endpoint: ${API_URL}`);
  console.log(`Model:    ${MODEL}`);
  console.log(`Date:     ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  const allResults = {
    metadata: {
      benchmarkVersion: '2.3.0',
      model: MODEL,
      timestamp: new Date().toISOString(),
      pricing: {
        uncachedPromptUsdPerM: PRICE_PROMPT_UNCACHED * 1e6,
        cachedPromptUsdPerM: PRICE_PROMPT_CACHED * 1e6,
        completionUsdPerM: PRICE_COMPLETION * 1e6
      }
    },
    lowCorrelationResults: [],
    highCorrelationResults: []
  };

  // -----------------------------------------------------------------------
  // Part 1: Low-Correlation (LC) Tasks: Testing Noise Elimination & Efficiency
  // -----------------------------------------------------------------------
  console.log('\n>>> Part 1: Evaluating Low-Correlation (LC) Tasks (v2.2 vs v2.3)...');

  for (const scenario of LC_SCENARIOS) {
    console.log(`\n--- Scenario ${scenario.id}: ${scenario.name} ---`);
    const rawMessages = buildRawMessages(scenario);

    // Arm 1: v2.2 Standard (All historical tool outputs and thinking preserved)
    console.log(`  [v2.2 Standard] Running...`);
    const v22Messages = rawMessages;
    const v22Res = await callDeepSeekStreaming(v22Messages);
    const v22Score = scoreLowCorrelation(v22Res.content, scenario.targetRound3.evaluationCriteria);
    console.log(`    v2.2 -> Prompt Tokens: ${v22Res.usage.promptTokens}, TTFT: ${v22Res.ttftMs}ms, Total: ${v22Res.totalTimeMs}ms, Acc: ${(v22Score.accuracy * 100).toFixed(1)}%, Cost: $${v22Res.costUsd}`);

    // Arm 2: v2.3 Post-Cache Distill (Expired cache -> stripped past thinking & tools)
    console.log(`  [v2.3 Post-Cache Distill] Running...`);
    const v23Messages = projectDistilledHistory(rawMessages, { forceCacheExpired: true });
    const v23Res = await callDeepSeekStreaming(v23Messages);
    const v23Score = scoreLowCorrelation(v23Res.content, scenario.targetRound3.evaluationCriteria);
    console.log(`    v2.3 -> Prompt Tokens: ${v23Res.usage.promptTokens}, TTFT: ${v23Res.ttftMs}ms, Total: ${v23Res.totalTimeMs}ms, Acc: ${(v23Score.accuracy * 100).toFixed(1)}%, Cost: $${v23Res.costUsd}`);

    const tokenReductionPct = Number((((v22Res.usage.promptTokens - v23Res.usage.promptTokens) / v22Res.usage.promptTokens) * 100).toFixed(2));
    const ttftSpeedupPct = Number((((v22Res.ttftMs - v23Res.ttftMs) / v22Res.ttftMs) * 100).toFixed(2));
    const costSavingsPct = Number((((v22Res.costUsd - v23Res.costUsd) / v22Res.costUsd) * 100).toFixed(2));

    console.log(`    => Token Reduction: ${tokenReductionPct}%, TTFT Speedup: ${ttftSpeedupPct}%, Cost Savings: ${costSavingsPct}%`);

    allResults.lowCorrelationResults.push({
      scenarioId: scenario.id,
      name: scenario.name,
      v22: {
        promptTokens: v22Res.usage.promptTokens,
        completionTokens: v22Res.usage.completionTokens,
        reasoningTokens: v22Res.usage.reasoningTokens,
        ttftMs: v22Res.ttftMs,
        totalTimeMs: v22Res.totalTimeMs,
        costUsd: v22Res.costUsd,
        accuracy: v22Score.accuracy
      },
      v23: {
        promptTokens: v23Res.usage.promptTokens,
        completionTokens: v23Res.usage.completionTokens,
        reasoningTokens: v23Res.usage.reasoningTokens,
        ttftMs: v23Res.ttftMs,
        totalTimeMs: v23Res.totalTimeMs,
        costUsd: v23Res.costUsd,
        accuracy: v23Score.accuracy
      },
      improvements: {
        tokenReductionPct,
        ttftSpeedupPct,
        costSavingsPct
      }
    });
  }

  // -----------------------------------------------------------------------
  // Part 2: High-Correlation (HC) Tasks: Testing Recall Granularity & Tradeoffs
  // -----------------------------------------------------------------------
  console.log('\n>>> Part 2: Evaluating High-Correlation (HC) Tasks & Granular Recall Primitives...');

  for (const scenario of HC_SCENARIOS) {
    console.log(`\n--- Scenario ${scenario.id}: ${scenario.name} ---`);
    const rawMessages = buildRawMessages(scenario);

    // Arm 1: v2.2 Standard (All raw history present)
    console.log(`  [v2.2 Standard] Running...`);
    const v22Res = await callDeepSeekStreaming(rawMessages);
    const v22Score = scoreHighCorrelation(v22Res.content, scenario.targetRound3.goldNeedles);
    console.log(`    v2.2 -> Prompt Tokens: ${v22Res.usage.promptTokens}, TTFT: ${v22Res.ttftMs}ms, Acc: ${(v22Score.accuracy * 100).toFixed(1)}% (${v22Score.hits}/${v22Score.totalNeedles})`);

    // Arm 2: v2.3 Distilled Without Recall (No recall active, tests distillation penalty)
    console.log(`  [v2.3 Distilled - No Recall] Running...`);
    const v23NoRecallMsgs = projectDistilledHistory(rawMessages, { forceCacheExpired: true });
    const v23NoRecallRes = await callDeepSeekStreaming(v23NoRecallMsgs);
    const v23NoRecallScore = scoreHighCorrelation(v23NoRecallRes.content, scenario.targetRound3.goldNeedles);
    console.log(`    v2.3 No-Recall -> Prompt Tokens: ${v23NoRecallRes.usage.promptTokens}, TTFT: ${v23NoRecallRes.ttftMs}ms, Acc: ${(v23NoRecallScore.accuracy * 100).toFixed(1)}% (${v23NoRecallScore.hits}/${v23NoRecallScore.totalNeedles})`);

    // Arm 3: v2.3 Recall 'tool' (Modal mask: tool only for relevant round 1 & 2)
    console.log(`  [v2.3 Recall: Tool Only (Round 1 & 2)] Running...`);
    const recallsToolMap = new Map([
      [1, 'tool'],
      [2, 'tool']
    ]);
    const v23RecallToolMsgs = projectDistilledHistory(rawMessages, {
      forceCacheExpired: true,
      activeRecalls: recallsToolMap
    });
    const v23RecallToolRes = await callDeepSeekStreaming(v23RecallToolMsgs);
    const v23RecallToolScore = scoreHighCorrelation(v23RecallToolRes.content, scenario.targetRound3.goldNeedles);
    console.log(`    v2.3 Recall Tool -> Prompt Tokens: ${v23RecallToolRes.usage.promptTokens}, TTFT: ${v23RecallToolRes.ttftMs}ms, Acc: ${(v23RecallToolScore.accuracy * 100).toFixed(1)}% (${v23RecallToolScore.hits}/${v23RecallToolScore.totalNeedles})`);

    // Arm 4: v2.3 Recall 'think' (Modal mask: thinking only for round 1 & 2)
    console.log(`  [v2.3 Recall: Think Only (Round 1 & 2)] Running...`);
    const recallsThinkMap = new Map([
      [1, 'think'],
      [2, 'think']
    ]);
    const v23RecallThinkMsgs = projectDistilledHistory(rawMessages, {
      forceCacheExpired: true,
      activeRecalls: recallsThinkMap
    });
    const v23RecallThinkRes = await callDeepSeekStreaming(v23RecallThinkMsgs);
    const v23RecallThinkScore = scoreHighCorrelation(v23RecallThinkRes.content, scenario.targetRound3.goldNeedles);
    console.log(`    v2.3 Recall Think -> Prompt Tokens: ${v23RecallThinkRes.usage.promptTokens}, TTFT: ${v23RecallThinkRes.ttftMs}ms, Acc: ${(v23RecallThinkScore.accuracy * 100).toFixed(1)}% (${v23RecallThinkScore.hits}/${v23RecallThinkScore.totalNeedles})`);

    // Arm 5: v2.3 Recall 'both' (Modal mask: both think & tool)
    console.log(`  [v2.3 Recall: Both (Round 1 & 2)] Running...`);
    const recallsBothMap = new Map([
      [1, 'both'],
      [2, 'both']
    ]);
    const v23RecallBothMsgs = projectDistilledHistory(rawMessages, {
      forceCacheExpired: true,
      activeRecalls: recallsBothMap
    });
    const v23RecallBothRes = await callDeepSeekStreaming(v23RecallBothMsgs);
    const v23RecallBothScore = scoreHighCorrelation(v23RecallBothRes.content, scenario.targetRound3.goldNeedles);
    console.log(`    v2.3 Recall Both -> Prompt Tokens: ${v23RecallBothRes.usage.promptTokens}, TTFT: ${v23RecallBothRes.ttftMs}ms, Acc: ${(v23RecallBothScore.accuracy * 100).toFixed(1)}% (${v23RecallBothScore.hits}/${v23RecallBothScore.totalNeedles})`);

    allResults.highCorrelationResults.push({
      scenarioId: scenario.id,
      name: scenario.name,
      v22: {
        promptTokens: v22Res.usage.promptTokens,
        ttftMs: v22Res.ttftMs,
        costUsd: v22Res.costUsd,
        accuracy: v22Score.accuracy,
        hits: v22Score.hits,
        totalNeedles: v22Score.totalNeedles
      },
      v23NoRecall: {
        promptTokens: v23NoRecallRes.usage.promptTokens,
        ttftMs: v23NoRecallRes.ttftMs,
        costUsd: v23NoRecallRes.costUsd,
        accuracy: v23NoRecallScore.accuracy,
        hits: v23NoRecallScore.hits,
        totalNeedles: v23NoRecallScore.totalNeedles
      },
      v23RecallTool: {
        promptTokens: v23RecallToolRes.usage.promptTokens,
        ttftMs: v23RecallToolRes.ttftMs,
        costUsd: v23RecallToolRes.costUsd,
        accuracy: v23RecallToolScore.accuracy,
        hits: v23RecallToolScore.hits,
        totalNeedles: v23RecallToolScore.totalNeedles
      },
      v23RecallThink: {
        promptTokens: v23RecallThinkRes.usage.promptTokens,
        ttftMs: v23RecallThinkRes.ttftMs,
        costUsd: v23RecallThinkRes.costUsd,
        accuracy: v23RecallThinkScore.accuracy,
        hits: v23RecallThinkScore.hits,
        totalNeedles: v23RecallThinkScore.totalNeedles
      },
      v23RecallBoth: {
        promptTokens: v23RecallBothRes.usage.promptTokens,
        ttftMs: v23RecallBothRes.ttftMs,
        costUsd: v23RecallBothRes.costUsd,
        accuracy: v23RecallBothScore.accuracy,
        hits: v23RecallBothScore.hits,
        totalNeedles: v23RecallBothScore.totalNeedles
      }
    });
  }

  // -----------------------------------------------------------------------
  // Summary Statistics
  // -----------------------------------------------------------------------
  const avgLcTokenReduct = allResults.lowCorrelationResults.reduce((acc, r) => acc + r.improvements.tokenReductionPct, 0) / allResults.lowCorrelationResults.length;
  const avgLcTtftSpeedup = allResults.lowCorrelationResults.reduce((acc, r) => acc + r.improvements.ttftSpeedupPct, 0) / allResults.lowCorrelationResults.length;
  const avgLcCostSavings = allResults.lowCorrelationResults.reduce((acc, r) => acc + r.improvements.costSavingsPct, 0) / allResults.lowCorrelationResults.length;

  allResults.summary = {
    lowCorrelation: {
      avgTokenReductionPct: Number(avgLcTokenReduct.toFixed(2)),
      avgTtftSpeedupPct: Number(avgLcTtftSpeedup.toFixed(2)),
      avgCostSavingsPct: Number(avgLcCostSavings.toFixed(2)),
      v22AvgAccuracy: allResults.lowCorrelationResults.reduce((acc, r) => acc + r.v22.accuracy, 0) / allResults.lowCorrelationResults.length,
      v23AvgAccuracy: allResults.lowCorrelationResults.reduce((acc, r) => acc + r.v23.accuracy, 0) / allResults.lowCorrelationResults.length
    },
    highCorrelation: {
      v22AvgAccuracy: allResults.highCorrelationResults.reduce((acc, r) => acc + r.v22.accuracy, 0) / allResults.highCorrelationResults.length,
      v23NoRecallAvgAccuracy: allResults.highCorrelationResults.reduce((acc, r) => acc + r.v23NoRecall.accuracy, 0) / allResults.highCorrelationResults.length,
      v23RecallToolAvgAccuracy: allResults.highCorrelationResults.reduce((acc, r) => acc + r.v23RecallTool.accuracy, 0) / allResults.highCorrelationResults.length,
      v23RecallThinkAvgAccuracy: allResults.highCorrelationResults.reduce((acc, r) => acc + r.v23RecallThink.accuracy, 0) / allResults.highCorrelationResults.length,
      v23RecallBothAvgAccuracy: allResults.highCorrelationResults.reduce((acc, r) => acc + r.v23RecallBoth.accuracy, 0) / allResults.highCorrelationResults.length
    }
  };

  console.log('\n' + '='.repeat(70));
  console.log('BENCHMARK SUMMARY RESULTS');
  console.log('='.repeat(70));
  console.log(`[Low-Correlation Tasks]`);
  console.log(`  - Average Prompt Token Reduction: ${allResults.summary.lowCorrelation.avgTokenReductionPct}%`);
  console.log(`  - Average TTFT Latency Speedup:   ${allResults.summary.lowCorrelation.avgTtftSpeedupPct}%`);
  console.log(`  - Average API Cost Savings:       ${allResults.summary.lowCorrelation.avgCostSavingsPct}%`);
  console.log(`  - Task Accuracy (v2.2 vs v2.3):    ${(allResults.summary.lowCorrelation.v22AvgAccuracy * 100).toFixed(1)}% vs ${(allResults.summary.lowCorrelation.v23AvgAccuracy * 100).toFixed(1)}%`);
  console.log(`\n[High-Correlation Tasks]`);
  console.log(`  - v2.2 Standard Accuracy:          ${(allResults.summary.highCorrelation.v22AvgAccuracy * 100).toFixed(1)}%`);
  console.log(`  - v2.3 Distilled (No Recall) Acc:  ${(allResults.summary.highCorrelation.v23NoRecallAvgAccuracy * 100).toFixed(1)}%`);
  console.log(`  - v2.3 Recall 'tool' Accuracy:     ${(allResults.summary.highCorrelation.v23RecallToolAvgAccuracy * 100).toFixed(1)}%`);
  console.log(`  - v2.3 Recall 'think' Accuracy:    ${(allResults.summary.highCorrelation.v23RecallThinkAvgAccuracy * 100).toFixed(1)}%`);
  console.log(`  - v2.3 Recall 'both' Accuracy:     ${(allResults.summary.highCorrelation.v23RecallBothAvgAccuracy * 100).toFixed(1)}%`);
  console.log('='.repeat(70));

  // Write output JSON
  const outDir = resolve(__dirname, '../data');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const outPath = resolve(outDir, 'v23_stratified_benchmark_results.json');
  writeFileSync(outPath, JSON.stringify(allResults, null, 2), 'utf8');
  console.log(`\n[SUCCESS] Raw benchmark data written to: ${outPath}`);
}

runBenchmark().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
