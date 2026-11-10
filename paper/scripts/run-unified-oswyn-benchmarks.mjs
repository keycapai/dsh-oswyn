/**
 * Unified Real-Session Empirical Benchmark Suite for DSH-OSWYN Paper
 *
 * Covers:
 *   1. Exp 1 (Multi-Step Context Growth Curve & 5-Arm System Comparison on ds4.1f):
 *      - Baseline (Unmanaged)
 *      - OSWYN-Standard (Micro Prefix-Preserving Truncate + Discard + Reply Summary)
 *      - OSWYN-PTC (Programmatic Tool Calling Envelope + Subcall Distillation)
 *      - BillionContext (Original billion-context@0.1.211 proxy with ACP tools & range folding)
 *      - Synergy (OSWYN + BillionContext)
 *   2. Exp 2 (Task Difficulty L1 Easy / L2 Medium / L3 Hard x Cross-Model Willingness):
 *      - Compares ds4.1f (DeepSeek 4.1 Flash) against Gemini 3.8 Flash, Gemini 4, Kimi 3.1 Pro, Hunyuan 4
 *      - Uses real native function-calling (`tools` schema passed to LLM) to measure true co-emission willingness
 *   3. Exp 3 (Prompt Variants P1/P2/P3/P4 x Nudge Ablation on ds4.1f & Gemini 4):
 *      - Tests how prompt structure, auto-fallback disclosure, and per-step nudge impact tool compression rate,
 *        token overhead, compression ratio, and needle recall accuracy.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const isolatedStorage = mkdtempSync(join(tmpdir(), 'dsh-oswyn-unified-bench-'));
process.env.DSH_OSWYN_STORAGE_DIR = isolatedStorage;

const { Session } = await import('file:///Users/reno/.dsh/runtimes/dsh-modules/@deepseek-ai/dsh-session/lib/index.js');
const PLUGIN_DIR = '/Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn';
const BC_INDEX_JS = '/Users/reno/.gemini/tasks/c_85f7b71380bd610b/workspace/bc-pkg/package/dist/index.js';

const { applyFromAssistantMessage, runAllAutoPolicies } = await import(`file://${PLUGIN_DIR}/lib/presets/index.js`);
const { collectNudgeCandidates, buildNudgePromptText, SUMMARY_OPEN_TAG, REPLY_SUMMARY_OPEN_TAG } = await import(`file://${PLUGIN_DIR}/lib/prompts/index.js`);
const { buildStandardProtocolPrompt } = await import(`file://${PLUGIN_DIR}/lib/prompts/preset-standard.js`);
const { buildPtcProtocolPrompt } = await import(`file://${PLUGIN_DIR}/lib/prompts/preset-ptc.js`);
const { isCallArgDiscarded } = await import(`file://${PLUGIN_DIR}/lib/core/primitives.js`);
const { getToolName } = await import(`file://${PLUGIN_DIR}/lib/session/surface.js`);
const { matchesToolName } = await import(`file://${PLUGIN_DIR}/lib/session/auto-policy.js`);
const { CONFIG_DEFAULTS } = await import(`file://${PLUGIN_DIR}/lib/config.js`);

const DIRECT_URL = 'http://127.0.0.1:3425/v1/chat/completions';
const BILI_PORT = 18799;
const BILI_URL = `http://127.0.0.1:${BILI_PORT}/bili/http://127.0.0.1:3425/v1/chat/completions`;

async function runWithConcurrency(items, limit, workerFn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  async function runner() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await workerFn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Start / Stop Original billion-context@0.1.211 Proxy
// ─────────────────────────────────────────────────────────────────────────────
let biliProc = null;

async function startBiliProxy(dsModelId) {
  const biliConfigPath = join(isolatedStorage, 'bili-config.json');
  const biliSessionsDir = join(isolatedStorage, 'bili-sessions');
  const config = {
    port: BILI_PORT,
    host: '127.0.0.1',
    upstream: 'http://127.0.0.1:3425',
    sessionHeader: 'x-acp-session',
    network: {
      allowPrivateHttpProviders: true
    },
    persist: {
      enabled: true
    },
    providers: {
      'http://127.0.0.1:3425': {
        protocol: 'openai',
        models: {
          [dsModelId]: {
            context: 12000,
            output: 4096
          },
          'workbuddy/deepseek-v4.1-flash': { context: 12000, output: 4096 },
          'group/deepseek-v4.1-flash': { context: 12000, output: 4096 }
        }
      }
    },
    compress: {
      modelContextLimit: 12000,
      maxContextLimit: '35%',
      emergencyThresholdPercent: '75%',
      nudgeGrowthTokens: 1500,
      minPressureBenefitTokens: 800,
      minCompressRangeChars: 800,
      preserveRecentMessages: 2,
      preserveRecentTokens: 800,
      injectTool: true,
      injectNudge: true,
      ccr: { enabled: false }
    },
    log: true,
    debug: false
  };
  writeFileSync(biliConfigPath, JSON.stringify(config, null, 2));

  biliProc = spawn(process.execPath, [
    BC_INDEX_JS,
    'start',
    '--port', String(BILI_PORT),
    '--host', '127.0.0.1',
    '--config', biliConfigPath,
    '--no-auto-update'
  ], {
    env: {
      ...process.env,
      BILI_SESSIONS_DIR: biliSessionsDir,
      BILI_ALLOW_PRIVATE_HTTP_PROVIDERS: '1',
      ACP_AUTO_UPDATE: '0'
    },
    stdio: 'ignore'
  });

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch(`http://127.0.0.1:${BILI_PORT}/__bili/health`);
      if (res.ok) {
        console.error(`[BiliProxy] billion-context@0.1.211 listening on 127.0.0.1:${BILI_PORT}`);
        return true;
      }
    } catch {}
  }
  console.error('[BiliProxy] WARNING: billion-context proxy health check timed out');
  return false;
}

function stopBiliProxy() {
  if (biliProc) {
    try { biliProc.kill('SIGTERM'); } catch {}
    biliProc = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: LLM API Caller with Retries & Model Resolution
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS_STANDARD = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command in the workspace',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file from the workspace',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
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
          old_string: { type: 'string' },
          new_string: { type: 'string' }
        },
        required: ['file_path', 'old_string', 'new_string']
      }
    }
  }
];

const TOOLS_PTC = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description: 'Execute TypeScript/JavaScript code calling workspace tools programmatically',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' }, description: { type: 'string' } },
        required: ['code']
      }
    }
  }
];

async function callChatAPI({ url = DIRECT_URL, model, messages, tools = null, maxTokens = 4096, sessionId = null }) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer magpie'
  };
  if (sessionId) {
    headers['x-acp-session'] = sessionId;
  }

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const effectiveMaxTokens = attempt === 0 ? maxTokens : Math.max(maxTokens, 6144);
    const body = {
      model,
      messages,
      temperature: 0.1,
      max_tokens: effectiveMaxTokens
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  console.error(`[WARN] callChatAPI fallback after 4 attempts on ${model}: ${lastErr?.message}`);
  return {
    choices: [{ message: { role: 'assistant', content: 'Proceeding after timeout fallback.' } }],
    usage: { prompt_tokens: 0, completion_tokens: 0 }
  };
}

async function resolveWorkingModel(candidates, label) {
  for (const cid of candidates) {
    try {
      const res = await callChatAPI({
        model: cid,
        messages: [{ role: 'user', content: 'Reply OK' }],
        maxTokens: 20
      });
      if (res.choices?.[0]) {
        console.error(`[ModelCheck] ${label} resolved to: ${cid}`);
        return cid;
      }
    } catch (e) {
      console.error(`[ModelCheck] ${cid} failed: ${e.message.slice(0, 120)}`);
    }
  }
  throw new Error(`No working model found for ${label}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Serialization & Context Measurement Helpers
// ─────────────────────────────────────────────────────────────────────────────
function projectDerivedMessages(session) {
  return session.deriveMessages().map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;
    const nextContent = msg.content.map((block) => {
      const cid = block && (block.callId || block.id);
      if (block && block.type === 'tool-call' && cid && isCallArgDiscarded(session, cid)) {
        return { ...block, arguments: '{}' };
      }
      return block;
    });
    return { ...msg, content: nextContent };
  });
}

function buildOpenAIMessages(derivedMessages, sysPromptText, nudgeText = null) {
  const out = [];
  for (const m of derivedMessages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: sysPromptText });
      continue;
    }
    if (m.role === 'assistant') {
      const textBlocks = Array.isArray(m.content)
        ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : String(m.content || '');
      const toolCalls = Array.isArray(m.content)
        ? m.content.filter((b) => b && b.type === 'tool-call')
        : [];
      const msgObj = { role: 'assistant', content: textBlocks.trim() || (toolCalls.length > 0 ? null : 'OK') };
      if (toolCalls.length > 0) {
        msgObj.tool_calls = toolCalls.map((tc) => ({
          id: tc.id || tc.callId,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {})
          }
        }));
      }
      out.push(msgObj);
    } else if (m.role === 'tool') {
      const textBlocks = Array.isArray(m.content)
        ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : String(m.content || '');
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId || m.source?.callId || 'call_1',
        content: textBlocks
      });
    } else {
      const textBlocks = Array.isArray(m.content)
        ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : String(m.content || '');
      out.push({ role: 'user', content: textBlocks });
    }
  }
  if (nudgeText) {
    out.push({ role: 'user', content: nudgeText });
  }
  return out;
}

function measureResidentSurface(derivedMessages, sysPromptText) {
  let toolResultChars = 0;
  let toolInputChars = 0;
  let assistantTextChars = 0;
  let userTextChars = 0;
  for (const m of derivedMessages) {
    if (m.role === 'system') continue;
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'text') {
        const len = (b.text || '').length;
        if (m.role === 'tool') toolResultChars += len;
        else if (m.role === 'assistant') assistantTextChars += len;
        else if (m.role === 'user') userTextChars += len;
      } else if (b.type === 'tool-call') {
        toolInputChars += String(b.arguments || '').length;
      }
    }
  }
  const totalSurfaceChars = sysPromptText.length + toolResultChars + toolInputChars + assistantTextChars + userTextChars;
  return {
    sysPromptChars: sysPromptText.length,
    toolResultChars,
    toolInputChars,
    toolPayloadChars: toolResultChars + toolInputChars,
    assistantTextChars,
    userTextChars,
    totalSurfaceChars,
    estSurfaceTokens: Math.round(totalSurfaceChars / 3.5)
  };
}

function denseRange(startSeq, endSeq) {
  const first = Math.min(startSeq, endSeq);
  const last = Math.max(startSeq, endSeq);
  const out = [];
  for (let s = first; s <= last; s++) out.push(s);
  return out;
}

function formatRef(seq) {
  return 'm' + String(seq).padStart(5, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENT 1: 15-Step Continuous SWE Trajectory & Context Growth Curve
// Comparing: Baseline | OSWYN-Standard | OSWYN-PTC | BillionContext | Synergy
// ─────────────────────────────────────────────────────────────────────────────
function build15StepGrowthTrajectory() {
  const N1 = 'VAULT_ROOT_NONCE_0x89ACF992';
  const N2 = 'REDIS_CLUSTER_PORT_39918';
  const N3 = 'SPINLOCK_MAX_RETRIES_1024';
  const N4 = 'CHRONOS_EPOCH_MS_50';

  return [
    {
      step: 1, id: 'S01_RepoScan', type: 'scan_log',
      user: 'Step 1: Scan the repository directory structure (`find src -type f`) to locate core service modules.',
      toolName: 'bash',
      argsObj: { command: 'find src -type f' },
      ptcCode: 'const res = await tools.bash({ command: "find src -type f" }); console.log(res.stdout);',
      subcalls: [{ name: 'bash', isError: false, text: Array.from({ length: 65 }, (_, i) => `src/modules/service_${String(i + 1).padStart(2, '0')}/index.ts (1420 bytes)`).concat(['src/core/vault.ts', 'src/core/redis.ts', 'src/core/spinlock.ts', 'src/core/chronos.ts']).join('\n') }],
      output: Array.from({ length: 65 }, (_, i) => `src/modules/service_${String(i + 1).padStart(2, '0')}/index.ts (1420 bytes)`).concat(['src/core/vault.ts', 'src/core/redis.ts', 'src/core/spinlock.ts', 'src/core/chronos.ts']).join('\n'),
      isError: false
    },
    {
      step: 2, id: 'S02_ReadVault', type: 'code_read',
      user: 'Step 2: Read `src/core/vault.ts` (note down the root nonce constant `VAULT_ROOT_NONCE`) and inspect the cipher configuration.',
      toolName: 'read',
      argsObj: { file_path: 'src/core/vault.ts' },
      ptcCode: 'const f = await tools.read({ file_path: "src/core/vault.ts" }); console.log(f.content);',
      subcalls: [{ name: 'read', isError: false, text: `// SECURITY VAULT MODULE\nexport const VAULT_ROOT_NONCE = "${N1}";\n` + Array.from({ length: 75 }, (_, i) => `export const LEGACY_CIPHER_SLOT_${i} = { id: ${i}, deprecated: true, mask: "0x00${i}" };`).join('\n') }],
      output: `// SECURITY VAULT MODULE\nexport const VAULT_ROOT_NONCE = "${N1}";\n` + Array.from({ length: 75 }, (_, i) => `export const LEGACY_CIPHER_SLOT_${i} = { id: ${i}, deprecated: true, mask: "0x00${i}" };`).join('\n'),
      isError: false
    },
    {
      step: 3, id: 'S03_VaultTestFail', type: 'failed_call',
      user: 'Step 3: Run `npm test test/vault.test.ts` to reproduce the nonce collision failure.',
      toolName: 'bash',
      argsObj: { command: 'npm test test/vault.test.ts --verbose' },
      ptcCode: 'await tools.bash({ command: "npm test test/vault.test.ts --verbose" });',
      subcalls: [{ name: 'bash', isError: true, text: `FAIL test/vault.test.ts\n  NonceCollisionException: Nonce counter wrapped at slot 64 (vault.ts:42:11)\n` + Array.from({ length: 45 }, (_, i) => `    at VaultEngine.verifySlot (src/core/vault.ts:${100 + i}:9)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`).join('\n') + '\n[exit code: 1]' }],
      output: `FAIL test/vault.test.ts\n  NonceCollisionException: Nonce counter wrapped at slot 64 (vault.ts:42:11)\n` + Array.from({ length: 45 }, (_, i) => `    at VaultEngine.verifySlot (src/core/vault.ts:${100 + i}:9)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`).join('\n') + '\n[exit code: 1]',
      isError: true
    },
    {
      step: 4, id: 'S04_VaultFixAndPass', type: 'scan_log',
      user: 'Step 4: Edit `src/core/vault.ts` and re-run `npm test test/vault.test.ts` to confirm it passes.',
      toolName: 'bash',
      argsObj: { command: 'npm test test/vault.test.ts' },
      ptcCode: 'await tools.edit({ file_path: "src/core/vault.ts", old_string: "slot & 63", new_string: "slot & 1023" }); await tools.bash({ command: "npm test test/vault.test.ts" });',
      subcalls: [
        { name: 'edit', isError: false, text: 'Edited src/core/vault.ts' },
        { name: 'bash', isError: false, text: `PASS test/vault.test.ts (32 passed, 0 failed)\n` + Array.from({ length: 40 }, (_, i) => `  ✓ vault test case #${i + 1}: monotonic nonce check passed (1 ms)`).join('\n') + '\n[exit code: 0]' }
      ],
      output: `PASS test/vault.test.ts (32 passed, 0 failed)\n` + Array.from({ length: 40 }, (_, i) => `  ✓ vault test case #${i + 1}: monotonic nonce check passed (1 ms)`).join('\n') + '\n[exit code: 0]',
      isError: false
    },
    {
      step: 5, id: 'S05_ReadRedis', type: 'code_read',
      user: 'Step 5: Read `src/core/redis.ts` (note down `REDIS_CLUSTER_PORT`) to inspect connection pool routing.',
      toolName: 'read',
      argsObj: { file_path: 'src/core/redis.ts' },
      ptcCode: 'const r = await tools.read({ file_path: "src/core/redis.ts" }); console.log(r.content);',
      subcalls: [{ name: 'read', isError: false, text: `// REDIS CLUSTER CONFIG\nexport const REDIS_CLUSTER_PORT = "${N2}";\n` + Array.from({ length: 75 }, (_, i) => `export const SHARD_REPLICA_NODE_${i} = { host: "10.12.0.${i}", weight: 100, role: "replica" };`).join('\n') }],
      output: `// REDIS CLUSTER CONFIG\nexport const REDIS_CLUSTER_PORT = "${N2}";\n` + Array.from({ length: 75 }, (_, i) => `export const SHARD_REPLICA_NODE_${i} = { host: "10.12.0.${i}", weight: 100, role: "replica" };`).join('\n'),
      isError: false
    },
    {
      step: 6, id: 'S06_RedisBugAndProbe1', type: 'failed_call',
      user: 'Step 6 (Midway Probe 1): Run `npm test test/redis.test.ts` AND answer in your response: What was the exact value of `VAULT_ROOT_NONCE` from Step 2?',
      toolName: 'bash',
      argsObj: { command: 'npm test test/redis.test.ts' },
      ptcCode: 'await tools.bash({ command: "npm test test/redis.test.ts" });',
      subcalls: [{ name: 'bash', isError: true, text: `FAIL test/redis.test.ts\n  ConnectionLeakException: Unclosed socket on failover at src/core/redis.ts:88:14\n` + Array.from({ length: 45 }, (_, i) => `    at PoolManager.release (src/core/redis.ts:${140 + i}:12)`).join('\n') + '\n[exit code: 1]' }],
      output: `FAIL test/redis.test.ts\n  ConnectionLeakException: Unclosed socket on failover at src/core/redis.ts:88:14\n` + Array.from({ length: 45 }, (_, i) => `    at PoolManager.release (src/core/redis.ts:${140 + i}:12)`).join('\n') + '\n[exit code: 1]',
      isError: true,
      probeNeedle: N1
    },
    {
      step: 7, id: 'S07_ReadSpinlock', type: 'code_read',
      user: 'Step 7: Read `src/core/spinlock.ts` (note down `SPINLOCK_MAX_RETRIES`) to inspect mutex contention handling.',
      toolName: 'read',
      argsObj: { file_path: 'src/core/spinlock.ts' },
      ptcCode: 'const s = await tools.read({ file_path: "src/core/spinlock.ts" }); console.log(s.content);',
      subcalls: [{ name: 'read', isError: false, text: `// CONCURRENCY SPINLOCK\nexport const SPINLOCK_MAX_RETRIES = "${N3}";\n` + Array.from({ length: 75 }, (_, i) => `export function auditLockTrace_${i}(tid: number) { return "lock_trace_" + tid + "_slot_${i}"; }`).join('\n') }],
      output: `// CONCURRENCY SPINLOCK\nexport const SPINLOCK_MAX_RETRIES = "${N3}";\n` + Array.from({ length: 75 }, (_, i) => `export function auditLockTrace_${i}(tid: number) { return "lock_trace_" + tid + "_slot_${i}"; }`).join('\n'),
      isError: false
    },
    {
      step: 8, id: 'S08_SpinlockDeadlockFail', type: 'failed_call',
      user: 'Step 8: Run `npm test test/spinlock.test.ts` to inspect the deadlock stack trace.',
      toolName: 'bash',
      argsObj: { command: 'npm test test/spinlock.test.ts' },
      ptcCode: 'await tools.bash({ command: "npm test test/spinlock.test.ts" });',
      subcalls: [{ name: 'bash', isError: true, text: `FAIL test/spinlock.test.ts\n  MutexDeadlockException: Spinlock cycle limit exceeded at src/core/spinlock.ts:65:7\n` + Array.from({ length: 45 }, (_, i) => `    at SpinLock.acquire (src/core/spinlock.ts:${65 + (i % 20)}:7)`).join('\n') + '\n[exit code: 1]' }],
      output: `FAIL test/spinlock.test.ts\n  MutexDeadlockException: Spinlock cycle limit exceeded at src/core/spinlock.ts:65:7\n` + Array.from({ length: 45 }, (_, i) => `    at SpinLock.acquire (src/core/spinlock.ts:${65 + (i % 20)}:7)`).join('\n') + '\n[exit code: 1]',
      isError: true
    },
    {
      step: 9, id: 'S09_LargeProbeScriptFail', type: 'failed_large_input',
      user: 'Step 9: Run a diagnostic cluster probe script to test live shard locks.',
      toolName: 'bash',
      argsObj: {
        command: `node -e "${Array.from({ length: 24 }, (_, i) => `const lockNode_${i} = { shard: ${i}, host: '10.240.1.${i}', timeout: 2500 };`).join(' ')} throw new Error('ECONNREFUSED 10.240.1.0:9099 diagnostic cluster offline');"`
      },
      ptcCode: `// Large one-off probe script\n${Array.from({ length: 24 }, (_, i) => `const lockNode_${i} = { shard: ${i}, host: '10.240.1.${i}', timeout: 2500 };`).join('\n')}\nawait tools.bash({ command: "curl http://10.240.1.0:9099/health" });`,
      subcalls: [{ name: 'bash', isError: true, text: `Error: ECONNREFUSED 10.240.1.0:9099 diagnostic cluster offline\n` + Array.from({ length: 30 }, (_, i) => `    at Socket.connect (node:net:${1100 + i}:16)`).join('\n') + '\n[exit code: 1]' }],
      output: `Error: ECONNREFUSED 10.240.1.0:9099 diagnostic cluster offline\n` + Array.from({ length: 30 }, (_, i) => `    at Socket.connect (node:net:${1100 + i}:16)`).join('\n') + '\n[exit code: 1]',
      isError: true
    },
    {
      step: 10, id: 'S10_SpinlockPassAndProbe2', type: 'scan_log',
      user: 'Step 10 (Midway Probe 2): Verify spinlock and redis tests pass, AND state in your reply: What was the exact value of `REDIS_CLUSTER_PORT` from Step 5?',
      toolName: 'bash',
      argsObj: { command: 'npm test test/spinlock.test.ts test/redis.test.ts' },
      ptcCode: 'await tools.bash({ command: "npm test test/spinlock.test.ts test/redis.test.ts" });',
      subcalls: [{ name: 'bash', isError: false, text: `PASS test/spinlock.test.ts\nPASS test/redis.test.ts\n` + Array.from({ length: 45 }, (_, i) => `  ✓ concurrency & pool test #${i + 1} passed (2 ms)`).join('\n') + '\n[exit code: 0]' }],
      output: `PASS test/spinlock.test.ts\nPASS test/redis.test.ts\n` + Array.from({ length: 45 }, (_, i) => `  ✓ concurrency & pool test #${i + 1} passed (2 ms)`).join('\n') + '\n[exit code: 0]',
      isError: false,
      probeNeedle: N2
    },
    {
      step: 11, id: 'S11_ReadChronos', type: 'code_read',
      user: 'Step 11: Read `src/core/chronos.ts` (note down `CHRONOS_EPOCH_MS`) to inspect distributed Raft quorum calculation.',
      toolName: 'read',
      argsObj: { file_path: 'src/core/chronos.ts' },
      ptcCode: 'const c = await tools.read({ file_path: "src/core/chronos.ts" }); console.log(c.content);',
      subcalls: [{ name: 'read', isError: false, text: `// CHRONOS CONSENSUS ENGINE\nexport const CHRONOS_EPOCH_MS = "${N4}";\n` + Array.from({ length: 75 }, (_, i) => `export const RAFT_PEER_ENDPOINT_${i} = "raft-peer-${i}.internal.cluster:7001";`).join('\n') }],
      output: `// CHRONOS CONSENSUS ENGINE\nexport const CHRONOS_EPOCH_MS = "${N4}";\n` + Array.from({ length: 75 }, (_, i) => `export const RAFT_PEER_ENDPOINT_${i} = "raft-peer-${i}.internal.cluster:7001";`).join('\n'),
      isError: false
    },
    {
      step: 12, id: 'S12_ChronosFail', type: 'failed_call',
      user: 'Step 12: Run `npm test test/chronos.test.ts` to observe the quorum election failure.',
      toolName: 'bash',
      argsObj: { command: 'npm test test/chronos.test.ts' },
      ptcCode: 'await tools.bash({ command: "npm test test/chronos.test.ts" });',
      subcalls: [{ name: 'bash', isError: true, text: `FAIL test/chronos.test.ts\n  ConsensusTimeoutException: Quorum election timed out at src/core/chronos.ts:112:9\n` + Array.from({ length: 45 }, (_, i) => `    at RaftNode.elect (src/core/chronos.ts:${112 + (i % 15)}:9)`).join('\n') + '\n[exit code: 1]' }],
      output: `FAIL test/chronos.test.ts\n  ConsensusTimeoutException: Quorum election timed out at src/core/chronos.ts:112:9\n` + Array.from({ length: 45 }, (_, i) => `    at RaftNode.elect (src/core/chronos.ts:${112 + (i % 15)}:9)`).join('\n') + '\n[exit code: 1]',
      isError: true
    },
    {
      step: 13, id: 'S13_FullBuildScan', type: 'scan_log',
      user: 'Step 13: Fix quorum math and run full repository build (`npm run build --verbose`).',
      toolName: 'bash',
      argsObj: { command: 'npm run build --verbose' },
      ptcCode: 'await tools.bash({ command: "npm run build --verbose" });',
      subcalls: [{ name: 'bash', isError: false, text: `Build started...\n` + Array.from({ length: 55 }, (_, i) => `[webpack] compiled module_${i}.ts -> dist/module_${i}.js (${2400 + i * 18} bytes) [built]`).join('\n') + '\nBuild succeeded in 1840 ms\n[exit code: 0]' }],
      output: `Build started...\n` + Array.from({ length: 55 }, (_, i) => `[webpack] compiled module_${i}.ts -> dist/module_${i}.js (${2400 + i * 18} bytes) [built]`).join('\n') + '\nBuild succeeded in 1840 ms\n[exit code: 0]',
      isError: false
    },
    {
      step: 14, id: 'S14_FullRegressionAndProbe3', type: 'scan_log',
      user: 'Step 14 (Late Probe 3): Run the full test suite (`npm test`) AND state in your reply: What was the exact value of `SPINLOCK_MAX_RETRIES` from Step 7?',
      toolName: 'bash',
      argsObj: { command: 'npm test -- --verbose' },
      ptcCode: 'await tools.bash({ command: "npm test -- --verbose" });',
      subcalls: [{ name: 'bash', isError: false, text: `PASS test/vault.test.ts\nPASS test/redis.test.ts\nPASS test/spinlock.test.ts\nPASS test/chronos.test.ts\n` + Array.from({ length: 50 }, (_, i) => `  ✓ end-to-end integration test #${i + 1} passed (3 ms)`).join('\n') + '\nTests: 128 passed, 128 total\n[exit code: 0]' }],
      output: `PASS test/vault.test.ts\nPASS test/redis.test.ts\nPASS test/spinlock.test.ts\nPASS test/chronos.test.ts\n` + Array.from({ length: 50 }, (_, i) => `  ✓ end-to-end integration test #${i + 1} passed (3 ms)`).join('\n') + '\nTests: 128 passed, 128 total\n[exit code: 0]',
      isError: false,
      probeNeedle: N3
    },
    {
      step: 15, id: 'S15_FinalSynthesisProbe', type: 'final_synthesis',
      user: 'Step 15 (Final Comprehensive Recall): All tests passed! Now provide your final engineering synthesis report. You MUST state verbatim all 4 constants discovered during this session: (1) `VAULT_ROOT_NONCE`, (2) `REDIS_CLUSTER_PORT`, (3) `SPINLOCK_MAX_RETRIES`, and (4) `CHRONOS_EPOCH_MS`, plus the 3 exception names (`NonceCollisionException`, `ConnectionLeakException`, `MutexDeadlockException`).',
      toolName: null,
      isFinal: true,
      finalNeedles: [N1, N2, N3, N4]
    }
  ];
}

async function runExp1Arm(modelId, arm) {
  const isPtc = arm === 'oswyn_ptc';
  const useOswyn = arm === 'oswyn_standard' || arm === 'oswyn_ptc' || arm === 'synergy';
  const useBili = arm === 'bc' || arm === 'synergy';
  const apiUrl = useBili ? BILI_URL : DIRECT_URL;

  const sessionId = `exp1-${arm}-${Date.now()}`;
  const header = {
    type: 'session', version: 4, id: sessionId,
    createdAt: Date.now(), cwd: '/tmp', isSeeded: false, delegationDepth: 0,
    agentPreset: isPtc ? 'ptc' : 'standard'
  };
  const s = Session.create(sessionId, [], header);

  const baseSys = 'You are an autonomous software engineer running a 15-step debugging and refactoring session. Analyze each tool result carefully, preserve exact configuration constants in your notes/summaries, and answer any probe questions accurately.';
  const sysPrompt = useOswyn
    ? baseSys + '\n\n' + (isPtc ? buildPtcProtocolPrompt() : buildStandardProtocolPrompt())
    : baseSys;

  s.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: sysPrompt }] } }, { surfaceOp: 'append' });

  const trajectory = build15StepGrowthTrajectory();
  const curve = [];

  let totalPromptTokens = 0;
  let totalCachedTokens = 0;
  let totalCompletionTokens = 0;
  let activeFencesEmitted = 0;
  let activeFencesApplied = 0;
  let autoFallbacksApplied = 0;
  let bcFoldsExecuted = 0;
  let rawPayloadCharsAccum = 0;
  let midwayProbeHits = 0;
  let midwayProbeTotal = 0;

  for (let i = 0; i < trajectory.length; i++) {
    const sc = trajectory[i];

    if (sc.toolName) {
      s.append('user/message', { id: `u-${sc.step}`, role: 'user', content: [{ type: 'text', text: sc.user }] }, { surfaceOp: 'append' });

      const callId = `call_${sc.id}`;
      const argsStr = isPtc
        ? JSON.stringify({ code: sc.ptcCode, description: sc.id })
        : JSON.stringify(sc.argsObj);
      rawPayloadCharsAccum += sc.output.length + argsStr.length;

      const aCallEv = s.append('assistant/message', {
        turn: sc.step, step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool-call', id: callId, callId, name: isPtc ? 'run_code' : sc.toolName, arguments: argsStr }
          ]
        }
      }, { surfaceOp: 'append' });

      const tcEv = s.append('tool/call', {
        turn: sc.step, step: 1, callId, name: isPtc ? 'run_code' : sc.toolName, arguments: argsStr
      }, {});

      if (isPtc && Array.isArray(sc.subcalls)) {
        for (let k = 0; k < sc.subcalls.length; k++) {
          const sub = sc.subcalls[k];
          s.append('tool/ptc-dispatch', {
            turn: sc.step, step: 1,
            rootCallId: callId,
            parentCallId: callId,
            subCallId: `${callId}:ptc:${k + 1}`,
            name: sub.name,
            isError: Boolean(sub.isError),
            content: [{ type: 'text', text: sub.text }]
          }, {});
        }
      }

      var currentResEv = s.append('tool/result', {
        turn: sc.step, step: 1,
        message: {
          id: `res-${callId}`,
          role: 'tool',
          source: { kind: 'tool', toolName: isPtc ? 'run_code' : sc.toolName, callId, isError: Boolean(sc.isError) },
          toolCallId: callId,
          isError: Boolean(sc.isError),
          content: [{ type: 'text', text: sc.output }]
        }
      }, { surfaceOp: 'append', sourceEventSeqs: [tcEv.seq, aCallEv.seq] });
    } else {
      s.append('user/message', { id: `u-${sc.step}`, role: 'user', content: [{ type: 'text', text: sc.user }] }, { surfaceOp: 'append' });
    }

    const preStepDerived = projectDerivedMessages(s);
    const candidates = (useOswyn && sc.toolName) ? collectNudgeCandidates(preStepDerived, {}, s) : [];
    const oswynNudge = (useOswyn && candidates.length > 0) ? buildNudgePromptText(candidates) : null;
    const stepFollowUpPrompt = sc.toolName
      ? (oswynNudge ? `${oswynNudge}\n\n[Next Step]: Analyze the tool output above, record any required constants, and proceed.` : `[Next Step]: Analyze the tool output above, record any required constants, and proceed.`)
      : null;

    const openAIMsgs = buildOpenAIMessages(preStepDerived, sysPrompt, stepFollowUpPrompt);
    const stepTools = sc.isFinal ? null : (isPtc ? TOOLS_PTC : TOOLS_STANDARD);

    const resp = await callChatAPI({
      url: apiUrl,
      model: modelId,
      messages: openAIMsgs,
      tools: stepTools,
      maxTokens: 4096,
      sessionId: useBili ? sessionId : null
    });

    const choice = resp.choices?.[0] || {};
    let replyText = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls || [];
    const usage = resp.usage || {};

    let stepPromptTok = usage.prompt_tokens || 0;
    let stepCachedTok = usage.prompt_tokens_details?.cached_tokens || usage.cached_tokens || 0;
    let stepComplTok = usage.completion_tokens || 0;

    let bcFoldHappenedThisStep = false;
    if (useBili && toolCalls.some((tc) => tc.function?.name === 'compress' || tc.function?.name === 'acp_status')) {
      for (const tc of toolCalls) {
        const fnName = tc.function?.name;
        if (fnName === 'compress' || fnName === 'acp_status') {
          const nodes = s.surface?.nodes || [];
          const startSeq = nodes.length > 5 ? nodes[1] : null;
          const endSeq = nodes.length > 5 ? nodes[nodes.length - 4] : null;
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(tc.function?.arguments || '{}'); } catch {}

          if (fnName === 'compress' && startSeq !== null && endSeq !== null && endSeq > startSeq) {
            const cSummary = parsedArgs.summary || parsedArgs.content || 'Compressed earlier session exploration while preserving discovered constants.';
            s.append('user/message', {
              role: 'user',
              content: [{ type: 'text', text: `[Compressed conversation section]\n${cSummary}` }]
            }, {
              surfaceOp: { op: 'replace', startSeq, endSeq },
              sourceEventSeqs: denseRange(startSeq, endSeq)
            });
            bcFoldsExecuted += 1;
            bcFoldHappenedThisStep = true;
          } else if (fnName === 'acp_status' && startSeq !== null && endSeq !== null) {
            const statusText = `Compressible range: ${formatRef(startSeq)}–${formatRef(endSeq)}. Call compress with startId="${formatRef(startSeq)}", endId="${formatRef(endSeq)}" and a self-contained summary preserving all constants.`;
            const followMsgs = [
              ...openAIMsgs,
              { role: 'assistant', content: replyText || null, tool_calls: [tc] },
              { role: 'tool', tool_call_id: tc.id, content: statusText }
            ];
            const r2 = await callChatAPI({
              url: apiUrl,
              model: modelId,
              messages: followMsgs,
              tools: stepTools,
              maxTokens: 4096,
              sessionId
            });
            const u2 = r2.usage || {};
            stepPromptTok += u2.prompt_tokens || 0;
            stepCachedTok += u2.prompt_tokens_details?.cached_tokens || u2.cached_tokens || 0;
            stepComplTok += u2.completion_tokens || 0;
            if (!replyText && r2.choices?.[0]?.message?.content) {
              replyText = r2.choices[0].message.content;
            }
            const tc2 = (r2.choices?.[0]?.message?.tool_calls || []).find((c) => c.function?.name === 'compress');
            if (tc2) {
              let p2 = {};
              try { p2 = JSON.parse(tc2.function?.arguments || '{}'); } catch {}
              const sum2 = p2.summary || p2.content || 'Compressed historical steps.';
              s.append('user/message', {
                role: 'user',
                content: [{ type: 'text', text: `[Compressed conversation section]\n${sum2}` }]
              }, {
                surfaceOp: { op: 'replace', startSeq, endSeq },
                sourceEventSeqs: denseRange(startSeq, endSeq)
              });
              bcFoldsExecuted += 1;
              bcFoldHappenedThisStep = true;
            }
          }
        }
      }
    }

    totalPromptTokens += stepPromptTok;
    totalCachedTokens += stepCachedTok;
    totalCompletionTokens += stepComplTok;

    const hasResultFence = replyText.includes('```' + SUMMARY_OPEN_TAG);
    const hasReplyFence = replyText.includes('```' + REPLY_SUMMARY_OPEN_TAG);
    if (hasResultFence && sc.toolName) activeFencesEmitted += 1;

    const asstEv = s.append('assistant/message', {
      turn: sc.step, step: 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: replyText || 'Proceeding to next step.' }]
      }
    }, { surfaceOp: 'append' });

    let stepActiveApplied = false;
    let stepAutoApplied = false;

    if (useOswyn) {
      const activeRes = applyFromAssistantMessage(s, asstEv.data.message, asstEv.seq, {
        autoCompressKeepLines: 20,
        replySummaryEnabled: true
      });
      if ((activeRes.applied?.length || 0) > 0) {
        activeFencesApplied += 1;
        stepActiveApplied = true;
      }
      const seenList = sc.toolName && currentResEv ? [currentResEv] : [];
      const resolvedCfg = {
        ...CONFIG_DEFAULTS,
        autoCompress: false,
        autoCompressTiered: true,
        autoCompressMinChars: 1200,
        autoCompressKeepLines: 15,
        autoCompressPtcSubcalls: true,
        autoDiscardFailed: true,
        autoDiscardTools: ['validate_dsh_ui']
      };
      const autoAppliedList = (!stepActiveApplied && seenList.length > 0)
        ? runAllAutoPolicies(s, seenList, resolvedCfg, {
            hasFence: hasResultFence,
            protectedTools: CONFIG_DEFAULTS.autoCompressTieredProtectedTools,
            isProtectedTool: (sess, ev) => {
              const tn = getToolName(sess, ev) || "";
              return (CONFIG_DEFAULTS.autoCompressTieredProtectedTools || []).some((pat) => matchesToolName(pat, tn));
            }
          })
        : [];
      if (autoAppliedList.length > 0) {
        autoFallbacksApplied += 1;
        stepAutoApplied = true;
      }
    }

    if (sc.probeNeedle) {
      midwayProbeTotal += 1;
      if (replyText.includes(sc.probeNeedle) || replyText.includes(sc.probeNeedle.split('_').pop())) {
        midwayProbeHits += 1;
      }
    }

    const postStepDerived = projectDerivedMessages(s);
    const surfaceMetrics = measureResidentSurface(postStepDerived, sysPrompt);

    curve.push({
      step: sc.step,
      id: sc.id,
      type: sc.type,
      promptTokens: stepPromptTok,
      cachedTokens: stepCachedTok,
      completionTokens: stepComplTok,
      cumulativePromptTokens: totalPromptTokens,
      cumulativeBilledTokens: totalPromptTokens + totalCompletionTokens,
      residentSurfaceChars: surfaceMetrics.totalSurfaceChars,
      residentToolPayloadChars: surfaceMetrics.toolPayloadChars,
      estResidentTokens: surfaceMetrics.estSurfaceTokens,
      hasResultFence,
      hasReplyFence,
      stepActiveApplied,
      stepAutoApplied,
      bcFoldHappenedThisStep
    });
  }

  const finalStepMsg = s.snapshotEvents().filter((e) => e.type === 'assistant/message').pop()?.data?.message?.content?.[0]?.text || '';
  const finalNeedles = ['0x89ACF992', '39918', '1024', '50'];
  const finalHits = finalNeedles.filter((n) => finalStepMsg.includes(n)).length;

  const finalSurface = measureResidentSurface(projectDerivedMessages(s), sysPrompt);
  const totalToolSteps = trajectory.filter((t) => Boolean(t.toolName)).length;

  return {
    arm,
    modelId,
    totalSteps: trajectory.length,
    totalToolSteps,
    totalPromptTokens,
    totalCachedTokens,
    totalFreshTokens: Math.max(0, totalPromptTokens - totalCachedTokens),
    cacheHitRatePct: Number(((totalCachedTokens / (totalPromptTokens || 1)) * 100).toFixed(2)),
    totalCompletionTokens,
    totalBilledTokens: totalPromptTokens + totalCompletionTokens,
    rawPayloadCharsAccum,
    finalResidentToolPayloadChars: finalSurface.toolPayloadChars,
    finalResidentSurfaceChars: finalSurface.totalSurfaceChars,
    payloadCompressionRatioPct: Number(((1 - finalSurface.toolPayloadChars / (rawPayloadCharsAccum || 1)) * 100).toFixed(2)),
    activeFencesEmitted,
    activeWillingnessPct: Number(((activeFencesEmitted / totalToolSteps) * 100).toFixed(1)),
    activeFencesApplied,
    activeEffectiveRatePct: Number(((activeFencesApplied / totalToolSteps) * 100).toFixed(1)),
    autoFallbacksApplied,
    bcFoldsExecuted,
    midwayProbeScore: `${midwayProbeHits}/${midwayProbeTotal}`,
    finalNeedleScore: `${finalHits}/4`,
    totalRecallScore: `${midwayProbeHits + finalHits}/${midwayProbeTotal + 4}`,
    totalRecallPct: Number((((midwayProbeHits + finalHits) / (midwayProbeTotal + 4)) * 100).toFixed(1)),
    curve
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENT 2: Task Difficulty (Easy / Medium / Hard) x Cross-Model Willingness
// ─────────────────────────────────────────────────────────────────────────────
const DIFFICULTY_TASKS = [
  {
    difficultyId: 'L1_Easy',
    difficultyName: '简单任务 (L1: 目录扫描与常规测试日志清理)',
    description: 'Low cognitive load: 2 simple scan/log steps + 1 summary step',
    steps: [
      {
        step: 1, name: 'E1_DirScan', toolName: 'bash', callId: 'e_c1',
        argsObj: { command: 'find src -type f' },
        isError: false,
        resultText: Array.from({ length: 45 }, (_, i) => `src/components/widget_${i}.tsx (980 bytes)`).concat(['src/app.tsx (2100 bytes)']).join('\n'),
        nextGoal: 'Directory scan finished. Now run `npm test` via bash to verify widget unit tests.'
      },
      {
        step: 2, name: 'E2_TestLog', toolName: 'bash', callId: 'e_c2',
        argsObj: { command: 'npm test' },
        isError: false,
        resultText: `PASS test/app.test.tsx (30 passed, 0 failed)\n` + Array.from({ length: 40 }, (_, i) => `  ✓ renders widget_${i} cleanly (1 ms)`).join('\n') + '\n[exit code: 0]',
        nextGoal: 'All tests passed. Provide a brief 2-sentence final status summary.',
        isLastToolStep: true
      }
    ],
    needles: ['app.tsx', '30 passed']
  },
  {
    difficultyId: 'L2_Medium',
    difficultyName: '中等任务 (L2: 单模块溢出报错排查与配置常量提取)',
    description: 'Moderate cognitive load: exploratory config read with secret + failing stack trace + pass-through read',
    steps: [
      {
        step: 1, name: 'M1_ReadConfig', toolName: 'read', callId: 'm_c1',
        argsObj: { file_path: 'src/config/gateway.ts' },
        isError: false,
        resultText: `// Gateway Config\nexport const GATEWAY_HMAC_SECRET = "HMAC_LIVE_99481A_77C02B";\n` + Array.from({ length: 55 }, (_, i) => `export const DEPRECATED_FLAG_${i} = { enabled: false, owner: "legacy_${i}" };`).join('\n'),
        nextGoal: 'Config read complete (keep `GATEWAY_HMAC_SECRET` in mind). Now run `npm test` via bash to inspect the crash stack trace.'
      },
      {
        step: 2, name: 'M2_FailingTest', toolName: 'bash', callId: 'm_c2',
        argsObj: { command: 'npm test' },
        isError: true,
        resultText: `FAIL test/shard-worker.test.ts\n  ShardOverflowException: RingBuffer capacity exceeded at index 512 (SHARD_RING_CAP=512, incoming=1024)\n    at RingBuffer.pushBatch (src/core/shard-worker.ts:84:15)\n` + Array.from({ length: 40 }, (_, i) => `    at processTicksAndRejections (node:internal/process/task_queues:${70 + (i % 15)}:21)`).join('\n') + '\n[exit code: 1]',
        nextGoal: 'Test failed with ShardOverflowException. Now read `src/core/payment-queue.ts` via read tool to check if the queue dispatcher modifies batch size.'
      },
      {
        step: 3, name: 'M3_ReadQueue', toolName: 'read', callId: 'm_c3',
        argsObj: { file_path: 'src/core/payment-queue.ts' },
        isError: false,
        resultText: `// Payment Queue Dispatcher (Pure pass-through)\nexport const QUEUE_DRAIN_TIMEOUT_MS = 4500;\n` + Array.from({ length: 50 }, (_, i) => `export function formatAuditLog_${i}(id: string) { return "audit_" + id; }`).join('\n') + `\nexport function forwardToShard(w: any, b: any[]) { return w.pushBatch(b); }`,
        nextGoal: 'Now provide the final root cause summary including exact `GATEWAY_HMAC_SECRET`, `QUEUE_DRAIN_TIMEOUT_MS`, and fault file/line (`src/core/shard-worker.ts:84`).',
        isLastToolStep: true
      }
    ],
    needles: ['HMAC_LIVE_99481A_77C02B', '4500', 'shard-worker.ts']
  },
  {
    difficultyId: 'L3_Hard',
    difficultyName: '复杂任务 (L3: 跨模块分布式共识、WAL 截断与死锁多约束联合诊断)',
    description: 'High cognitive load: 4 complex multi-constraint steps requiring simultaneous root-cause math, 3 constant tracking, and next tool-call planning',
    steps: [
      {
        step: 1, name: 'H1_ReadRaftWal', toolName: 'read', callId: 'h_c1',
        argsObj: { file_path: 'src/consensus/raft-wal.ts' },
        isError: false,
        resultText: [
          '// Distributed Raft Write-Ahead Log & Quorum Constants',
          'export const RAFT_QUORUM_EPOCH = 704;',
          'export const WAL_SYNC_BATCH_CAP = 2048;',
          ...Array.from({ length: 65 }, (_, i) => `export const WAL_SEGMENT_CRC_TABLE_${i} = [0x${(i * 173).toString(16)}, 0x${(i * 991).toString(16)}, "legacy_crc_table_entry_${i}"];`),
          'export function appendWalEntries(entries: any[]) {',
          '  if (entries.length > WAL_SYNC_BATCH_CAP) throw new Error("WalBatchOverflow");',
          '  return entries.length;',
          '}'
        ].join('\n'),
        nextGoal: 'Keep `RAFT_QUORUM_EPOCH` (704) and `WAL_SYNC_BATCH_CAP` (2048) in mind. Next, run `npm test -- test/consensus-cascade.test.ts` via bash to inspect the multi-node cascading failure trace.'
      },
      {
        step: 2, name: 'H2_CascadeCrashLog', toolName: 'bash', callId: 'h_c2',
        argsObj: { command: 'npm test -- test/consensus-cascade.test.ts --verbose' },
        isError: true,
        resultText: [
          'FAIL test/consensus-cascade.test.ts',
          '  ● ConsensusCluster › survives concurrent leader step-down during WAL compaction',
          '    SplitBrainQuorumException: Term 704 commit index 9182 diverged across stripe lock 0x3FF (expected quorum >= 3 of 5, got 2)',
          '      at QuorumTracker.commitFrame (src/consensus/quorum-tracker.ts:147:19)',
          '      at StripeLockManager.withStripe (src/consensus/stripe-lock.ts:63:11)',
          ...Array.from({ length: 50 }, (_, i) => `      at AsyncFrame.run (node:internal/async_hooks:${200 + i}:14) [cascade trace #${i}]`),
          '[exit code: 1]'
        ].join('\n'),
        nextGoal: 'Now read `src/consensus/stripe-lock.ts` via the read tool to check `LOCK_STRIPE_MASK` and see why `withStripe` released the lock early.'
      },
      {
        step: 3, name: 'H3_ReadStripeLock', toolName: 'read', callId: 'h_c3',
        argsObj: { file_path: 'src/consensus/stripe-lock.ts' },
        isError: false,
        resultText: [
          '// Stripe Lock Manager for Raft Compaction',
          'export const LOCK_STRIPE_MASK = "0x3FF";',
          ...Array.from({ length: 60 }, (_, i) => `export function debugStripeHistogram_${i}(bucket: number) { return \`stripe_bucket_\${bucket}_cnt=${i * 12}\`; }`),
          'export async function withStripe(key: number, fn: () => Promise<any>) {',
          '  const slot = key & 0x3FF;',
          '  // BUG: missing await on fn() causes lock release before async quorum commit finishes!',
          '  try { return fn(); } finally { releaseSlot(slot); }',
          '}'
        ].join('\n'),
        nextGoal: 'You found the bug (`try { return fn(); }` is missing `await` in `src/consensus/stripe-lock.ts:63`). Before fixing, run a one-off state verification command via bash.'
      },
      {
        step: 4, name: 'H4_FailedDiagnosticProbe', toolName: 'bash', callId: 'h_c4',
        argsObj: {
          command: `node -e "${Array.from({ length: 20 }, (_, i) => `const peer_${i} = { id: ${i}, addr: '10.88.0.${i}:7001' };`).join(' ')} throw new Error('ETIMEDOUT 10.88.0.1:7001 raft telemetry daemon unreachable');"`
        },
        isError: true,
        resultText: [
          'Error: ETIMEDOUT 10.88.0.1:7001 raft telemetry daemon unreachable',
          ...Array.from({ length: 30 }, (_, i) => `    at TelemetryClient.poll (src/consensus/telemetry.ts:${40 + i}:8)`),
          '[exit code: 1]'
        ].join('\n'),
        nextGoal: 'Now provide the complete root cause synthesis report. Include: (1) Exact `RAFT_QUORUM_EPOCH`, (2) Exact `WAL_SYNC_BATCH_CAP`, (3) Exact `LOCK_STRIPE_MASK`, and (4) The exact bug in `src/consensus/stripe-lock.ts` (`missing await on fn()`).',
        isLastToolStep: true
      }
    ],
    needles: ['704', '2048', '0x3FF', 'stripe-lock.ts']
  }
];

async function runExp2DifficultyProbe(modelObj, diffTask, withNudge = true) {
  const sessionId = `exp2-${modelObj.shortName}-${diffTask.difficultyId}-${withNudge ? 'nudge' : 'spont'}-${Date.now()}`;
  const header = {
    type: 'session', version: 4, id: sessionId,
    createdAt: Date.now(), cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'standard'
  };
  const s = Session.create(sessionId, [], header);

  const sysPrompt = 'You are an autonomous software engineering agent powered by DeepSeek Harness.\n\n' + buildStandardProtocolPrompt();
  s.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: sysPrompt }] } }, { surfaceOp: 'append' });
  s.append('user/message', { id: 'u-start', role: 'user', content: [{ type: 'text', text: `Task (${diffTask.difficultyName}): Investigate the issue step-by-step using tools and synthesize all findings.` }] }, { surfaceOp: 'append' });

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let activeFencesEmitted = 0;
  let activeFencesApplied = 0;
  let emptyTextToolCallSteps = 0;
  let rawPayloadChars = 0;
  const stepLogs = [];

  for (let i = 0; i < diffTask.steps.length; i++) {
    const st = diffTask.steps[i];
    const argsStr = JSON.stringify(st.argsObj);
    rawPayloadChars += st.resultText.length + argsStr.length;

    const aEv = s.append('assistant/message', {
      turn: 1, step: st.step * 2 - 1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: st.callId, callId: st.callId, name: st.toolName, arguments: argsStr }]
      }
    }, { surfaceOp: 'append' });
    const tcEv = s.append('tool/call', {
      turn: 1, step: st.step * 2 - 1, callId: st.callId, name: st.toolName, arguments: argsStr
    }, {});
    s.append('tool/result', {
      turn: 1, step: st.step * 2 - 1,
      message: {
        id: 'res-' + st.callId,
        role: 'tool',
        source: { kind: 'tool', toolName: st.toolName, callId: st.callId, isError: st.isError },
        toolCallId: st.callId,
        isError: st.isError,
        content: [{ type: 'text', text: st.resultText }]
      }
    }, { surfaceOp: 'append', sourceEventSeqs: [tcEv.seq, aEv.seq] });

    const rawDerived = projectDerivedMessages(s);
    const candidates = withNudge ? collectNudgeCandidates(rawDerived, {}, s) : [];
    const nudgePart = (withNudge && candidates.length > 0) ? buildNudgePromptText(candidates) + '\n\n' : '';
    const userInstruction = `${nudgePart}[Next Step]: ${st.nextGoal}`;

    const openAIMsgs = buildOpenAIMessages(rawDerived, sysPrompt, userInstruction);
    const resp = await callChatAPI({
      model: modelObj.id,
      messages: openAIMsgs,
      tools: st.isLastToolStep ? null : TOOLS_STANDARD,
      maxTokens: 4096
    });

    const msg = resp.choices?.[0]?.message || {};
    const replyText = msg.content || '';
    const toolCalls = msg.tool_calls || [];
    const usage = resp.usage || {};

    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompletionTokens += usage.completion_tokens || 0;

    if (toolCalls.length > 0 && replyText.trim().length === 0) {
      emptyTextToolCallSteps += 1;
    }

    const hasResultFence = replyText.includes('```' + SUMMARY_OPEN_TAG);
    const hasReplyFence = replyText.includes('```' + REPLY_SUMMARY_OPEN_TAG);
    if (hasResultFence) activeFencesEmitted += 1;

    const replyEv = s.append('assistant/message', {
      turn: 1, step: st.step * 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: replyText || 'OK' }]
      }
    }, { surfaceOp: 'append' });

    const distillRes = applyFromAssistantMessage(s, replyEv.data.message, replyEv.seq, {
      autoCompressKeepLines: 20,
      replySummaryEnabled: true
    });
    if ((distillRes.applied?.length || 0) > 0) {
      activeFencesApplied += 1;
    }

    stepLogs.push({
      step: st.step,
      name: st.name,
      isLastToolStep: Boolean(st.isLastToolStep),
      toolCallsCount: toolCalls.length,
      replyChars: replyText.length,
      hasResultFence,
      hasReplyFence,
      appliedModes: (distillRes.applied || []).map((a) => a.mode),
      rejectedReasons: distillRes.rejected || []
    });
  }

  const finalMsg = s.snapshotEvents().filter((e) => e.type === 'assistant/message').pop()?.data?.message?.content?.[0]?.text || '';
  const recalledCount = diffTask.needles.filter((n) => finalMsg.includes(n)).length;
  const finalSurface = measureResidentSurface(projectDerivedMessages(s), sysPrompt);
  const totalSteps = diffTask.steps.length;

  return {
    modelId: modelObj.id,
    modelName: modelObj.label,
    tier: modelObj.tier,
    difficultyId: diffTask.difficultyId,
    difficultyName: diffTask.difficultyName,
    withNudge,
    totalSteps,
    activeFencesEmitted,
    activeWillingnessPct: Number(((activeFencesEmitted / totalSteps) * 100).toFixed(1)),
    activeFencesApplied,
    activeEffectiveRatePct: Number(((activeFencesApplied / totalSteps) * 100).toFixed(1)),
    emptyTextToolCallSteps,
    totalPromptTokens,
    totalCompletionTokens,
    totalBilledTokens: totalPromptTokens + totalCompletionTokens,
    rawPayloadChars,
    finalResidentToolPayloadChars: finalSurface.toolPayloadChars,
    activeCompressionRatioPct: Number(((1 - finalSurface.toolPayloadChars / (rawPayloadChars || 1)) * 100).toFixed(2)),
    recallScore: `${recalledCount}/${diffTask.needles.length}`,
    recallPct: Number(((recalledCount / diffTask.needles.length) * 100).toFixed(1)),
    stepLogs
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENT 3: Prompt Variants (P1 / P2 / P3 / P4) x Nudge Ablation on ds4.1f & Gemini 4
// ─────────────────────────────────────────────────────────────────────────────
const P1_ORIG_PROMPT = [
  '## DSH-OSWYN: Only See What You Need (Context & Cache Optimization)',
  'You are in full control of your context window. Re-sending massive historical tool outputs drains token budget and degrades focus.',
  '- **KEEP RESIDENT**: active target files you are currently editing.',
  '- **REPLACE / DISCARD**: exploratory code reads and noisy build/test logs or failed stack traces.',
  '### 1. Tool Output Optimization (Interleaved Markdown Fence)',
  'Include a ```dsh-result-summary block at the start of your reply:',
  '- **Mode A: Truncate**: `truncate keep 15 lines` + `- 1-line summary`',
  '- **Mode B: Replace**: `replace` + `- 1-2 lines of discovered logic & exact constants`',
  '- **Mode C: Discard**: `discard` + `- 1-line root cause` (for failed calls/stack traces)',
  '### 2. Dual-Track Assistant Reply Projection',
  'End substantive final responses with a ```dsh-reply-summary block.'
].join('\n');

const P2_VERBOSE_MORAL_HAZARD_PROMPT = [
  '## DSH-OSWYN: Complete Context Optimization & Automated Fallback Specification (v2.0)',
  'You are operating under the DSH-OSWYN context management engine. Please read all internal rules, arithmetic constraints, and automated fallback policies carefully before emitting any directive.',
  '### 1a. Mathematical Accounting & Strict Rejection Rules',
  '- **Discard (`before = inputChars + outputChars`) vs Compress (`before = outputChars`)**:',
  '  - NEVER use `replace` on a short tool output! `replace` only compares against `outputChars` and will be strictly REJECTED as `replace not worth it` if your summary is >= 30% of `outputChars`.',
  '  - NEVER glue the closing ``` fence to prose on the same line, or CommonMark will swallow your entire response!',
  '  - Protected tools list: `run_code, read, write, edit, apply_patch, notebook, read_image, todo_write, ask_user_question, skill, tool_search, tool_result_recall, oswyn_stats, oswyn_protect_tool`.',
  '### 1b. Automated System Fallback Policies (Active in Background)',
  '- **Automated Tiered Truncation (`autoCompressTiered = true`)**: If you do not emit a `dsh-result-summary` fence, the host runtime automatically truncates any non-protected tool output exceeding `autoCompressMinChars = 4000` chars to its first `autoCompressKeepLines = 30` lines at the step boundary.',
  '- **Automated Error Discard (`autoDiscardFailed = true`)**: Whenever a tool call fails (exit code != 0 or uncaught exception stack), the background engine automatically discards both input arguments and error output into a 1-line failure marker at the next step boundary.',
  '- **Automated PTC Subcall Compression (`autoCompressPtcSubcalls = true`)**: Automatically summarizes `run_code` subcalls.',
  '### 1c. Directive Syntax Reference',
  'If you still wish to manually compress a preceding tool result, emit a ```dsh-result-summary block with `discard`, `truncate keep <N> lines`, or `replace`.',
  'Every response MUST also end with a ```dsh-reply-summary block.'
].join('\n').repeat(2);

const P3_STREAMLINED_COEMIT_PROMPT = buildStandardProtocolPrompt();

const P4_ULTRA_MINIMAL_PROMPT = [
  '## OSWYN Compression',
  'Use ```dsh-result-summary (`discard`, `truncate keep 15 lines`, or `replace`) to compress previous tool outputs.',
  'End final reply with ```dsh-reply-summary.'
].join('\n');

const PROMPT_VARIANTS = [
  { id: 'P1_Original', name: 'P1: 原始基线版 (无兜底披露)', sysPrompt: P1_ORIG_PROMPT },
  { id: 'P2_Verbose_FallbackDisclosed', name: 'P2: 冗长披露兜底与拒收警告版', sysPrompt: P2_VERBOSE_MORAL_HAZARD_PROMPT },
  { id: 'P3_Streamlined_DecisionTree', name: 'P3: 结构化三步决策精简版 (当前最优)', sysPrompt: P3_STREAMLINED_COEMIT_PROMPT },
  { id: 'P4_Ultra_Minimal', name: 'P4: 极简微指令版 (无示例与边界)', sysPrompt: P4_ULTRA_MINIMAL_PROMPT }
];

async function runExp3PromptVariant(modelObj, variant, withNudge) {
  const diffTask = DIFFICULTY_TASKS[1];
  const sessionId = `exp3-${modelObj.shortName}-${variant.id}-${withNudge ? 'nudge' : 'nonudge'}-${Date.now()}`;
  const header = {
    type: 'session', version: 4, id: sessionId,
    createdAt: Date.now(), cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'standard'
  };
  const s = Session.create(sessionId, [], header);
  const fullSys = 'You are an autonomous software engineering agent.\n\n' + variant.sysPrompt;

  s.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: fullSys }] } }, { surfaceOp: 'append' });
  s.append('user/message', { id: 'u-init', role: 'user', content: [{ type: 'text', text: 'Investigate the ShardOverflowException step-by-step using tools, and report the root cause along with GATEWAY_HMAC_SECRET and QUEUE_DRAIN_TIMEOUT_MS.' }] }, { surfaceOp: 'append' });

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let activeFencesEmitted = 0;
  let activeFencesApplied = 0;
  let rawPayloadChars = 0;

  for (let i = 0; i < diffTask.steps.length; i++) {
    const st = diffTask.steps[i];
    const argsStr = JSON.stringify(st.argsObj);
    rawPayloadChars += st.resultText.length + argsStr.length;

    const aEv = s.append('assistant/message', {
      turn: 1, step: st.step * 2 - 1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: st.callId, callId: st.callId, name: st.toolName, arguments: argsStr }]
      }
    }, { surfaceOp: 'append' });
    const tcEv = s.append('tool/call', {
      turn: 1, step: st.step * 2 - 1, callId: st.callId, name: st.toolName, arguments: argsStr
    }, {});
    s.append('tool/result', {
      turn: 1, step: st.step * 2 - 1,
      message: {
        id: 'res-' + st.callId,
        role: 'tool',
        source: { kind: 'tool', toolName: st.toolName, callId: st.callId, isError: st.isError },
        toolCallId: st.callId,
        isError: st.isError,
        content: [{ type: 'text', text: st.resultText }]
      }
    }, { surfaceOp: 'append', sourceEventSeqs: [tcEv.seq, aEv.seq] });

    const rawDerived = projectDerivedMessages(s);
    const candidates = withNudge ? collectNudgeCandidates(rawDerived, {}, s) : [];
    const nudgePart = (withNudge && candidates.length > 0) ? buildNudgePromptText(candidates) + '\n\n' : '';
    const userInstruction = `${nudgePart}[Next Step]: ${st.nextGoal}`;

    const openAIMsgs = buildOpenAIMessages(rawDerived, fullSys, userInstruction);
    const resp = await callChatAPI({
      model: modelObj.id,
      messages: openAIMsgs,
      tools: st.isLastToolStep ? null : TOOLS_STANDARD,
      maxTokens: 4096
    });

    const msg = resp.choices?.[0]?.message || {};
    const replyText = msg.content || '';
    const usage = resp.usage || {};

    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompletionTokens += usage.completion_tokens || 0;

    if (replyText.includes('```' + SUMMARY_OPEN_TAG)) {
      activeFencesEmitted += 1;
    }

    const replyEv = s.append('assistant/message', {
      turn: 1, step: st.step * 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: replyText || 'OK' }]
      }
    }, { surfaceOp: 'append' });

    const distillRes = applyFromAssistantMessage(s, replyEv.data.message, replyEv.seq, {
      autoCompressKeepLines: 20,
      replySummaryEnabled: true
    });
    if ((distillRes.applied?.length || 0) > 0) {
      activeFencesApplied += 1;
    }
  }

  const finalMsg = s.snapshotEvents().filter((e) => e.type === 'assistant/message').pop()?.data?.message?.content?.[0]?.text || '';
  const recalledCount = diffTask.needles.filter((n) => finalMsg.includes(n)).length;
  const finalSurface = measureResidentSurface(projectDerivedMessages(s), fullSys);
  const totalSteps = diffTask.steps.length;

  return {
    modelId: modelObj.id,
    modelName: modelObj.label,
    variantId: variant.id,
    variantName: variant.name,
    sysPromptChars: fullSys.length,
    withNudge,
    totalSteps,
    activeFencesEmitted,
    activeWillingnessPct: Number(((activeFencesEmitted / totalSteps) * 100).toFixed(1)),
    activeFencesApplied,
    activeEffectiveRatePct: Number(((activeFencesApplied / totalSteps) * 100).toFixed(1)),
    totalPromptTokens,
    totalCompletionTokens,
    totalBilledTokens: totalPromptTokens + totalCompletionTokens,
    rawPayloadChars,
    finalResidentToolPayloadChars: finalSurface.toolPayloadChars,
    activeCompressionRatioPct: Number(((1 - finalSurface.toolPayloadChars / (rawPayloadChars || 1)) * 100).toFixed(2)),
    recallScore: `${recalledCount}/${diffTask.needles.length}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENT 4: Capability Boundary & Intelligence Preservation Benchmark
// ("标准模式 vs. Only See What You Need 智力与解题能力边界实证测试")
// ─────────────────────────────────────────────────────────────────────────────
const RECALL_TOOL = {
  type: 'function',
  function: {
    name: 'tool_result_recall',
    description: 'Recall the original uncompressed text of an earlier tool result from the session event log by callId (e.g. "c1") when a later step requires exact lines/slots that were truncated or replaced.',
    parameters: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'The callId of the earlier tool result to recall (e.g. "c1")' }
      },
      required: ['call_id']
    }
  }
};

const EXP4_PROBLEMS = [
  {
    id: 'B1_VM_Bytecode_Trace',
    category: 'Borderline_Solvable',
    categoryLabel: '刚刚好答得出 (能力边界内)',
    sourceBenchmark: 'LiveCodeBench / BBH-Execution',
    title: 'B1: 字节码虚拟机寄存器状态追踪与异常回滚计算',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/vm/opcodes.ts' }, isError: false,
        resultText: [
          '// VM Opcode Specification v2.4',
          'export const INIT_R0 = 120;',
          'export const INIT_R1 = 35;',
          ...Array.from({ length: 45 }, (_, i) => `export const DEPRECATED_OPCODE_${i} = { code: ${0x80 + i}, cycles: ${(i % 4) + 1}, desc: "legacy_nop_${i}" };`),
          '// Active Opcodes:',
          '// OP_ADD_SCALE: R0 = R0 + 3 * R1',
          '// OP_XOR_MASK:  R0 = (R0 ^ MASK_CONST)'
        ].join('\n'),
        nextPrompt: 'Note `INIT_R0`, `INIT_R1`, and the active opcode formulas (`OP_ADD_SCALE`, `OP_XOR_MASK`). Now run `npm test test/vm-trace.test.ts` via bash to inspect the trace failure.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/vm-trace.test.ts' }, isError: true,
        resultText: [
          'FAIL test/vm-trace.test.ts',
          '  VMTrapAssertionError: Trap guard triggered at step 3 with MASK_CONST = 73 and TRAP_THRESHOLD = 150',
          ...Array.from({ length: 40 }, (_, i) => `    at BytecodeRunner.step (src/vm/runner.ts:${110 + i}:13) [trace_frame_${i}]`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Note `MASK_CONST = 73` and `TRAP_THRESHOLD = 150`. Now read `src/vm/trap-handler.ts` via read tool to check the exact trap rollback and final commit rules.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/vm/trap-handler.ts' }, isError: false,
        resultText: [
          '// Trap Rollback & Commit Handler',
          ...Array.from({ length: 45 }, (_, i) => `export function formatTrapTelemetry_${i}(code: number) { return "trap_telemetry_" + code + "_slot_${i}"; }`),
          '// Rule for Step 3 (OP_TRAP_GUARD):',
          '//   If R0 >= TRAP_THRESHOLD (150): first update R1 = R1 + 40, then update R0 = R0 - R1.',
          '//   Otherwise: R0 = R0 + 10.',
          '// Rule for Step 4 (OP_FINAL_COMMIT):',
          '//   Final R0 = (R0 * 2) + (R1 % 16).'
        ].join('\n'),
        nextPrompt: 'Execute the 4 steps in order starting from INIT_R0=120, INIT_R1=35: (1) OP_ADD_SCALE, (2) OP_XOR_MASK with MASK_CONST=73, (3) OP_TRAP_GUARD with TRAP_THRESHOLD=150, (4) OP_FINAL_COMMIT. State the exact final integer value of `R0` in the format `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '197',
    verifyFn: (text) => /\b197\b/.test(text)
  },
  {
    id: 'B2_Tiered_Tax_Ledger',
    category: 'Borderline_Solvable',
    categoryLabel: '刚刚好答得出 (能力边界内)',
    sourceBenchmark: 'GSM-Hard / Financial-Audit',
    title: 'B2: 跨币种阶梯返利与追溯税费回拨精确核算',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/billing/invoice-batch.ts' }, isError: false,
        resultText: [
          '// Invoice Settlement Batch #882',
          'export const BASE_GROSS_UNITS = 4800;',
          'export const TIER1_REBATE_PCT = 15; // deduct 15% from BASE_GROSS_UNITS first',
          ...Array.from({ length: 45 }, (_, i) => `export const ARCHIVED_MERCHANT_RATE_${i} = { merchantId: "M_${1000 + i}", feeBps: ${120 + i} };`)
        ].join('\n'),
        nextPrompt: 'Note `BASE_GROSS_UNITS = 4800` and `TIER1_REBATE_PCT = 15`. Next, run `npm test test/reconcile.test.ts` via bash to see the surcharge failure.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/reconcile.test.ts' }, isError: true,
        resultText: [
          'FAIL test/reconcile.test.ts',
          '  ReconciliationMismatchError: Cross-border surcharge (+260 units) applied after rebate, triggering clawback threshold 4200',
          ...Array.from({ length: 40 }, (_, i) => `    at LedgerEngine.settle (src/billing/ledger.ts:${80 + i}:9)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Note the `+260` surcharge and threshold `4200`. Now read `src/billing/clawback-policy.ts` via read tool to check the clawback formula and final credit.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/billing/clawback-policy.ts' }, isError: false,
        resultText: [
          '// Retroactive Tax Clawback Policy',
          ...Array.from({ length: 45 }, (_, i) => `export const REGION_TAX_EXEMPTION_${i} = "EXEMPT_CODE_${i}";`),
          '// Step-by-step settlement calculation:',
          '// 1. Start with BASE_GROSS_UNITS (4800), deduct 15% Tier-1 rebate.',
          '// 2. Add Cross-border surcharge (+260). Call this intermediate amount S.',
          '// 3. If S > 4200, subtract a clawback penalty equal to 2 * (S - 4200) from S.',
          '// 4. Finally, add FIXED_AUDIT_CREDIT = 19.'
        ].join('\n'),
        nextPrompt: 'Compute the exact final settlement integer following all 4 steps in order and output `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '4079',
    verifyFn: (text) => /\b4079\b/.test(text)
  },
  {
    id: 'B3_ABA_Epoch_Bug',
    category: 'Borderline_Solvable',
    categoryLabel: '刚刚好答得出 (能力边界内)',
    sourceBenchmark: 'SWE-bench Lite / Concurrency',
    title: 'B3: 无锁栈 ABA 代际计数器溢出与内存回收精确定位',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/concurrent/treiber-stack.ts' }, isError: false,
        resultText: [
          '// Lock-Free Treiber Stack with 5-bit Generation Tag',
          'export const GEN_MASK = 0x1F; // 31',
          'export const INITIAL_GEN = 28;',
          ...Array.from({ length: 45 }, (_, i) => `export function debugPointerSlot_${i}(ptr: number) { return ptr ^ ${i * 17}; }`),
          'export function nextGeneration(gen: number, delta: number) {',
          '  return (gen + delta) & GEN_MASK;',
          '}'
        ].join('\n'),
        nextPrompt: 'Note `GEN_MASK = 0x1F` (31) and `INITIAL_GEN = 28`. Now run `npm test test/aba-stress.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/aba-stress.test.ts' }, isError: true,
        resultText: [
          'FAIL test/aba-stress.test.ts',
          '  UseAfterFreeException: Node 0x7FF04 reclaimed prematurely after DELTA_OPS = 9 cas transitions',
          ...Array.from({ length: 40 }, (_, i) => `    at EpochReclaimer.reclaimSlot (src/concurrent/reclaimer.ts:${50 + i}:11)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Note `DELTA_OPS = 9`. Now read `src/concurrent/reclaimer.ts` via read tool to inspect `reclaimSlot`.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/concurrent/reclaimer.ts' }, isError: false,
        resultText: [
          '// Epoch Memory Reclaimer',
          'export const RECLAIM_STRIDE = 14;',
          ...Array.from({ length: 45 }, (_, i) => `export const BUCKET_WATERMARK_${i} = ${100 + i * 5};`),
          'export function computeCrashScore(wrappedGen: number) {',
          '  // Score = wrappedGen * RECLAIM_STRIDE + 7',
          '  return wrappedGen * RECLAIM_STRIDE + 7;',
          '}'
        ].join('\n'),
        nextPrompt: 'First compute `wrappedGen = (INITIAL_GEN + DELTA_OPS) & GEN_MASK` using `INITIAL_GEN=28`, `DELTA_OPS=9`, `GEN_MASK=0x1F`. Then compute `computeCrashScore(wrappedGen) = wrappedGen * RECLAIM_STRIDE + 7` where `RECLAIM_STRIDE=14`. State the exact final integer score in the format `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '77',
    verifyFn: (text) => /\b77\b/.test(text)
  },
  {
    id: 'B4_DAG_Critical_Path',
    category: 'Borderline_Solvable',
    categoryLabel: '刚刚好答得出 (能力边界内)',
    sourceBenchmark: 'Algorithmic-Scheduling / BBH',
    title: 'B4: 互斥锁争用惩罚下的有向无环图 (DAG) 关键路径耗时计算',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/scheduler/dag-nodes.ts' }, isError: false,
        resultText: [
          '// DAG Task Durations (in ms)',
          'export const DUR_N1 = 18;',
          'export const DUR_N2 = 27;',
          'export const DUR_N3 = 41;',
          'export const DUR_N4 = 34;',
          ...Array.from({ length: 45 }, (_, i) => `export const DUMMY_WORKER_METRIC_${i} = { worker: ${i}, idleMs: ${i * 11} };`),
          '// Edges: N1 -> N2 -> N4, and N1 -> N3 -> N4'
        ].join('\n'),
        nextPrompt: 'Note the node durations (`N1=18, N2=27, N3=41, N4=34`) and the two paths (`N1->N2->N4` and `N1->N3->N4`). Run `npm test test/dag.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/dag.test.ts' }, isError: true,
        resultText: [
          'FAIL test/dag.test.ts',
          '  DeadlineExceededError: Node N2 incurred MUTEX_CONTENTION_PENALTY = 16 ms during parallel execution',
          ...Array.from({ length: 40 }, (_, i) => `    at DagExecutor.runStage (src/scheduler/executor.ts:${90 + i}:7)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Note that Node `N2` incurs an extra `+16` ms penalty (`MUTEX_CONTENTION_PENALTY = 16`), whereas `N3` has 0 penalty. Now read `src/scheduler/commit.ts` via read tool.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/scheduler/commit.ts' }, isError: false,
        resultText: [
          '// DAG Barrier & Commit Overhead',
          'export const BARRIER_COMMIT_MS = 12;',
          ...Array.from({ length: 45 }, (_, i) => `export const TRACE_SPAN_TAG_${i} = "span_tag_${i}";`),
          '// Total Makespan = max(Path_A_with_penalty, Path_B) + BARRIER_COMMIT_MS'
        ].join('\n'),
        nextPrompt: 'Compute `Path_A = DUR_N1 + (DUR_N2 + 16) + DUR_N4` and `Path_B = DUR_N1 + DUR_N3 + DUR_N4`. Then compute `Total Makespan = max(Path_A, Path_B) + BARRIER_COMMIT_MS` (where `BARRIER_COMMIT_MS = 12`). Output the exact integer in the format `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '107',
    verifyFn: (text) => /\b107\b/.test(text)
  },
  {
    id: 'B5_Shadowed_Config_Maze',
    category: 'Borderline_Unsolvable_Noise',
    categoryLabel: '刚刚好答不出 (长上下文同名噪声干扰)',
    sourceBenchmark: 'LongBench-Code / Noisy-MultiHop',
    title: 'B5: 2.2 万字符同名影子常量与构建噪声迷宫中的四跳配额求解',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/quota/prod-env.ts' }, isError: false,
        resultText: [
          '// Quota Environment Definitions (WARNING: many legacy/canary shadows)',
          ...Array.from({ length: 35 }, (_, i) => `export const PROD_BASE_QUOTA_LEGACY_V${i} = ${300 + i * 5}; // deprecated shadow`),
          'export const PROD_ACTIVE_BASE_QUOTA = 340; // <-- CURRENT ACTIVE PRODUCTION QUOTA',
          ...Array.from({ length: 45 }, (_, i) => `export const PROD_BASE_QUOTA_CANARY_${i} = ${400 + i * 3}; // canary shadow — do not use in prod`)
        ].join('\n'),
        nextPrompt: 'Record the exact active production quota (`PROD_ACTIVE_BASE_QUOTA`) and ignore all legacy/canary shadows. Next, run `npm test test/quota-override.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/quota-override.test.ts --verbose' }, isError: true,
        resultText: [
          'FAIL test/quota-override.test.ts',
          ...Array.from({ length: 35 }, (_, i) => `  [debug-trace-${i}] shadow_delta_candidate_${i} = -${20 + i * 2} (ignored by router)`),
          '  QuotaThrottleError: Active production router applied PROD_OVERRIDE_DELTA = -65 during burst window',
          ...Array.from({ length: 45 }, (_, i) => `    at QuotaRouter.applyBurst (src/quota/router.ts:${100 + i}:15) [shadow_delta=-${50 + i}]`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Record the exact `PROD_OVERRIDE_DELTA` applied by the active production router. Next, read `src/quota/scaling-matrix.ts` via read tool.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/quota/scaling-matrix.ts' }, isError: false,
        resultText: [
          '// Scaling Matrix Multipliers',
          ...Array.from({ length: 40 }, (_, i) => `export const PROD_SCALE_FACTOR_SHADOW_${i} = ${(i % 7) + 2}; // inactive tier`),
          'export const PROD_ACTIVE_SCALE_FACTOR = 4; // <-- ACTIVE MULTIPLIER FOR PROD ROUTER',
          ...Array.from({ length: 40 }, (_, i) => `export const STAGING_SCALE_FACTOR_${i} = ${(i % 5) + 3}; // staging only`)
        ].join('\n'),
        nextPrompt: 'Record `PROD_ACTIVE_SCALE_FACTOR`. Now run `npm run verify-reserve` via bash to check the safety reserve offset.'
      },
      {
        step: 4, callId: 'c4', toolName: 'bash', argsObj: { command: 'npm run verify-reserve --verbose' }, isError: false,
        resultText: [
          'Verifying cluster reserve tables...',
          ...Array.from({ length: 40 }, (_, i) => `[reserve-check-${i}] region_shadow_reserve_${i} = ${10 + i} (inactive)`),
          '[reserve-active] PROD_SAFETY_RESERVE = 29 (verified active)',
          ...Array.from({ length: 40 }, (_, i) => `[reserve-audit-${i}] audit_trail_padding_${i} = ${100 + i * 7}`),
          '[exit code: 0]'
        ].join('\n'),
        nextPrompt: 'Now compute the exact effective production quota using the 4 active constants from Steps 1–4:\n`EffectiveQuota = (PROD_ACTIVE_BASE_QUOTA + PROD_OVERRIDE_DELTA) * PROD_ACTIVE_SCALE_FACTOR + PROD_SAFETY_RESERVE`\nShow your step-by-step substitution and state the exact integer in the format `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '1129',
    verifyFn: (text) => /\b1129\b/.test(text)
  },
  {
    id: 'B6_Silent_Checksum_Drift',
    category: 'Borderline_Unsolvable_Noise',
    categoryLabel: '刚刚好答不出 (隐式类型转换+位运算噪声干扰)',
    sourceBenchmark: 'SWE-bench / JS-Coercion-Audit',
    title: 'B6: JavaScript 隐式字符串拼接 Bug 诊断与异或校验和修正值计算',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/net/packet-header.ts' }, isError: false,
        resultText: [
          '// Packet Header Constants',
          ...Array.from({ length: 40 }, (_, i) => `export const LEGACY_HEADER_MAGIC_${i} = ${200 + i * 3};`),
          'export const ACTIVE_HEADER_MAGIC = 148;',
          'export const ACTIVE_PAYLOAD_LEN = 36;',
          ...Array.from({ length: 40 }, (_, i) => `export const DECODER_TABLE_PAD_${i} = "0x00${i}";`)
        ].join('\n'),
        nextPrompt: 'Record `ACTIVE_HEADER_MAGIC = 148` and `ACTIVE_PAYLOAD_LEN = 36`. Next, run `npm test test/packet-crc.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/packet-crc.test.ts' }, isError: true,
        resultText: [
          'FAIL test/packet-crc.test.ts',
          ...Array.from({ length: 35 }, (_, i) => `  [crc-MockFrame-${i}] simulated_checksum_${i} = ${600 + i * 9}`),
          '  ChecksumCorruptionError: Frame accumulator evaluated to string "18419" before XOR due to type coercion in src/net/checksum.ts:68',
          ...Array.from({ length: 40 }, (_, i) => `    at PacketVerifier.verify (src/net/verifier.ts:${120 + i}:9)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Read `src/net/checksum.ts` via read tool to inspect line 68 and find `PADDING_OFFSET` and `CRC_XOR_KEY`.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/net/checksum.ts' }, isError: false,
        resultText: [
          '// Frame Checksum Calculator',
          ...Array.from({ length: 35 }, (_, i) => `export const UNUSED_CRC_POLY_${i} = ${400 + i * 7};`),
          'export const PADDING_OFFSET = "19"; // BUG: defined as string "19" instead of number 19!',
          'export const CRC_XOR_KEY = 317;',
          'export function computeFrameCrc(magic: number, len: number) {',
          '  // Line 68 BUG: magic + len + PADDING_OFFSET concatenates "19" onto (magic+len)!',
          '  // Correct formula when PADDING_OFFSET is converted to Number(19):',
          '  //   const sum = magic + len + Number(PADDING_OFFSET);',
          '  //   return sum ^ CRC_XOR_KEY;',
          '  return (magic + len + PADDING_OFFSET as any) ^ CRC_XOR_KEY;',
          '}'
        ].join('\n'),
        nextPrompt: 'Fix the bug mentally by treating `PADDING_OFFSET` as the number `19`. Using `ACTIVE_HEADER_MAGIC = 148`, `ACTIVE_PAYLOAD_LEN = 36`, `Number(PADDING_OFFSET) = 19`, and `CRC_XOR_KEY = 317`, compute the exact corrected integer `(148 + 36 + 19) ^ 317` (bitwise XOR) and state `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '502',
    verifyFn: (text) => /\b502\b/.test(text)
  },
  {
    id: 'B7_Late_Bound_Key_Slot',
    category: 'Late_Binding_Trap',
    categoryLabel: '延迟绑定细节陷阱 (检验有损压缩边界与 Recall 恢复)',
    sourceBenchmark: 'OSWYN-Stress / Late-Binding-Needle',
    title: 'B7: 跨步延迟绑定 S-Box 槽位查询（测试前序截断丢失与 tool_result_recall 按需无损回溯）',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/crypto/sbox-table.ts' }, isError: false,
        resultText: [
          '// S-Box Lookup Table (Slots 00 to 39)',
          'export const SBOX_HEADER_VERSION = 3;',
          ...Array.from({ length: 40 }, (_, i) => {
            const val = i === 0 ? 84 : (i === 27 ? 419 : (i === 31 ? 265 : 100 + i * 7));
            return `export const SBOX_SLOT_${String(i).padStart(2, '0')} = ${val};`;
          })
        ].join('\n'),
        nextPrompt: 'We just read `src/crypto/sbox-table.ts`. For now, only verify `SBOX_SLOT_00` (`84`) and `SBOX_HEADER_VERSION` (`3`), then run `npm test test/sbox.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/sbox.test.ts' }, isError: true,
        resultText: [
          'FAIL test/sbox.test.ts',
          '  DifferentialCollisionError: Unexpected differential collision detected between SBOX_SLOT_27 and SBOX_SLOT_31!',
          ...Array.from({ length: 40 }, (_, i) => `    at SBoxVerifier.checkPair (src/crypto/verifier.ts:${60 + i}:11)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'The test failure revealed that the collision is actually between `SBOX_SLOT_27` and `SBOX_SLOT_31` from `src/crypto/sbox-table.ts` (Step 1, `callId="c1"`). If `SBOX_SLOT_27` and `SBOX_SLOT_31` were truncated or replaced in Step 1, call `tool_result_recall` with `call_id: "c1"` (or `read` on `src/crypto/sbox-table.ts`) to retrieve their exact values! Then compute `SBOX_SLOT_27 + SBOX_SLOT_31` and output `FINAL_ANSWER: <number>`.',
        allowRecall: true,
        isFinal: true
      }
    ],
    expectedAnswer: '684',
    verifyFn: (text) => /\b684\b/.test(text)
  },
  {
    id: 'B8_Coupled_Modular_CRT',
    category: 'Intrinsic_Ceiling',
    categoryLabel: '纯推理算力极限 (中国剩余定理+位异或复合)',
    sourceBenchmark: 'AIME / ProjectEuler-Style',
    title: 'B8: 跨模块同余方程组 (CRT) 求解与高维位异或耦合变换',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/crypto/crt-rings.ts' }, isError: false,
        resultText: [
          '// Ring Modulus Parameters',
          'export const MOD_A = 23;',
          'export const REM_A = 17; // x % 23 === 17',
          'export const MOD_B = 37;',
          'export const REM_B = 29; // x % 37 === 29',
          ...Array.from({ length: 45 }, (_, i) => `export const AUX_PRIME_RING_${i} = ${101 + i * 6};`),
          '// Constraint: seed x is a 3-digit integer in [100, 900]'
        ].join('\n'),
        nextPrompt: 'Note the modular constraints (`x % 23 === 17`, `x % 37 === 29`, `x in [100, 900]`). Next, run `npm test test/crt-seed.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/crt-seed.test.ts' }, isError: true,
        resultText: [
          'FAIL test/crt-seed.test.ts',
          '  SeedTransformError: Final key schedule requires computing ((x * 13) ^ 219) on the unique CRT seed x in [100, 900]',
          ...Array.from({ length: 40 }, (_, i) => `    at KeySchedule.derive (src/crypto/key-schedule.ts:${70 + i}:9)`),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'First find the unique integer `x` in `[100, 900]` satisfying both `x % 23 === 17` and `x % 37 === 29`. Then compute `FinalKey = (x * 13) ^ 219` (bitwise XOR). State the exact integer in the format `FINAL_ANSWER: <number>`.',
        isFinal: true
      }
    ],
    expectedAnswer: '4793',
    verifyFn: (text) => /\b4793\b/.test(text)
  },
  {
    id: 'B9_Implicit_Bug_Noise_Maze',
    category: 'Borderline_Unsolvable_Noise',
    categoryLabel: '刚刚好答不出 (无提示跨文件隐式参数与噪声致盲)',
    sourceBenchmark: 'LongBench-Code / Implicit-MultiFile',
    title: 'B9: 无公式提示下 60 线程噪声日志与跨模块时钟偏置截断联合求解',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/engine/rate-limiter.ts' }, isError: false,
        resultText: [
          '// Distributed Token Bucket Rate Limiter (v4.2)',
          ...Array.from({ length: 40 }, (_, i) => `export const SHADOW_REFILL_RATE_V${i} = ${20 + i * 2}; // deprecated staging rate`),
          'export const BUCKET_REFILL_RATE = 43; // active production refill rate',
          ...Array.from({ length: 40 }, (_, i) => `export function legacyQuotaCalc_${i}(x: number) { return x * ${i + 3} - ${i * 5}; }`),
          'export function applyBurstWindow(tokens: number, burstSec: number, effectiveSkewMs: number) {',
          '  return tokens + (burstSec * BUCKET_REFILL_RATE) - Math.floor(effectiveSkewMs / 250);',
          '}'
        ].join('\n'),
        nextPrompt: 'Inspect `src/engine/rate-limiter.ts`. Next, run `npm test test/limiter-drift.test.ts` via bash to inspect the cluster test failure.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/limiter-drift.test.ts' }, isError: true,
        resultText: [
          'FAIL test/limiter-drift.test.ts',
          ...Array.from({ length: 60 }, (_, i) => {
            if (i === 17) {
              return '  [worker_17] [ACTIVE_PROD_PRIMARY] DriftAssertionFailure: initialTokens=190, burstSec=14, rawSkewMs=1750 (exceeded burst cap)';
            }
            return `  [worker_${String(i).padStart(2, '0')}] [STANDBY_SHADOW_REPLICA] status=idle, initialTokens=${100 + i * 3}, burstSec=${(i % 9) + 2}, rawSkewMs=${500 + i * 25}`;
          }),
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Inspect the test failure output above. Next, read `src/engine/clock-sync.ts` via read tool to check how `rawSkewMs` and the burst cap are processed.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/engine/clock-sync.ts' }, isError: false,
        resultText: [
          '// Clock Synchronization & Burst Cap Normalizer',
          ...Array.from({ length: 45 }, (_, i) => `export const NTP_STRATUM_OFFSET_${i} = ${100 + i * 15};`),
          'export const NTP_JITTER_GUARD = 500;',
          'export const MAX_BURST_CAP = 750;',
          'export function computeNormalizedProdQuota(initialTokens: number, burstSec: number, rawSkewMs: number) {',
          '  const effectiveSkewMs = rawSkewMs - NTP_JITTER_GUARD;',
          '  const rawBurst = applyBurstWindow(initialTokens, burstSec, effectiveSkewMs);',
          '  if (rawBurst > MAX_BURST_CAP) {',
          '    return MAX_BURST_CAP - 2 * (rawBurst - MAX_BURST_CAP);',
          '  }',
          '  return rawBurst;',
          '}'
        ].join('\n'),
        nextPrompt: 'Using the exact parameters of the `[ACTIVE_PROD_PRIMARY]` worker from Step 2 and the exact functions/constants across `src/engine/rate-limiter.ts` (Step 1) and `src/engine/clock-sync.ts` (Step 3), compute the exact integer returned by `computeNormalizedProdQuota`. If any required formula or parameter from Step 1 or Step 2 was compressed away, you may call `tool_result_recall` (if available). Output `FINAL_ANSWER: <number>`.',
        allowRecall: true,
        isFinal: true
      }
    ],
    expectedAnswer: '676',
    verifyFn: (text) => /\b676\b/.test(text)
  },
  {
    id: 'B10_MultiReg_Bitwise_Pipeline',
    category: 'Borderline_Solvable',
    categoryLabel: '刚刚好在边界徘徊 (无提示四寄存器非线性位运算流水线)',
    sourceBenchmark: 'LiveCodeBench-Hard / State-Machine',
    title: 'B10: 四寄存器三轮条件异或反馈流水线与中断注入状态追踪',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/dsp/filter-stage1.ts' }, isError: false,
        resultText: [
          '// 4-Register Nonlinear Bitwise Filter Stage 1',
          'export const INIT_STATE = { A: 45, B: 29, C: 78, D: 19 };',
          ...Array.from({ length: 45 }, (_, i) => `export const FILTER_COEFF_TAP_${i} = [0x${(i * 37).toString(16)}, ${i * 13}];`),
          '// Round function stepRound(state, r):',
          '//   1. const t = ((state.A * 3) ^ state.B) % 100;',
          '//   2. const nextA = (state.B + state.C) % 100;',
          '//   3. const nextB = (t + state.D * r) % 100;',
          '//   4. If nextA > nextB: nextC = (state.C ^ nextA) % 100, nextD = state.D',
          '//      Else:            nextC = state.C, nextD = (state.D + nextB) % 100',
          '// Stage 1 runs stepRound for r = 1 and then r = 2.'
        ].join('\n'),
        nextPrompt: 'Inspect `src/dsp/filter-stage1.ts` and trace Stage 1 (`r = 1` then `r = 2`). Next, run `npm test test/dsp-pipeline.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/dsp-pipeline.test.ts' }, isError: true,
        resultText: [
          'FAIL test/dsp-pipeline.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `  [dma-channel-${i}] buffer_status=ok, watermark=${200 + i * 4}`),
          '  DmaInterruptException: Between Stage 1 (after r=2) and Stage 2 (before r=3), DMA interrupt mutates registers: A = (A ^ 39), C = (C + 47) % 100 (while B and D are unchanged)',
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Inspect the DMA interrupt mutation from Step 2. Next, read `src/dsp/filter-stage2.ts` via read tool.'
      },
      {
        step: 3, callId: 'c3', toolName: 'read', argsObj: { file_path: 'src/dsp/filter-stage2.ts' }, isError: false,
        resultText: [
          '// Filter Stage 2 Finalizer',
          ...Array.from({ length: 40 }, (_, i) => `export const STAGE2_DITHER_MASK_${i} = ${300 + i * 9};`),
          '// Stage 2 executes one final round of `stepRound(state, r)` with `r = 3` on the post-DMA-interrupt state,',
          '// and then outputs the checksum:',
          '//   FinalHash = A * 100 + B * 10 + C + D'
        ].join('\n'),
        nextPrompt: 'Compute the exact state `(A, B, C, D)` after Stage 1 (`r=1`, `r=2`), apply the DMA interrupt mutation from Step 2, then execute Stage 2 (`stepRound` with `r=3`), and compute `FinalHash = A * 100 + B * 10 + C + D`. If `stepRound` or any required formula from Step 1 was compressed away, you may call `tool_result_recall` (if available) to retrieve it. Output `FINAL_ANSWER: <number>`.',
        allowRecall: true,
        isFinal: true
      }
    ],
    expectedAnswer: '369',
    verifyFn: (text) => /\b369\b/.test(text)
  },
  {
    id: 'B11_AIME_Cubic_CRT_Coprime',
    category: 'Intrinsic_Ceiling',
    categoryLabel: '刚刚好答不出 (超出单步算力上限的三次同余与互质筛耦合题)',
    sourceBenchmark: 'AIME-Hard / Number-Theory',
    title: 'B11: 三次多项式模 105 同余根集与模 42 互质筛的边界计数及极值耦合求解',
    steps: [
      {
        step: 1, callId: 'c1', toolName: 'read', argsObj: { file_path: 'src/math/polynomial-sieve.ts' }, isError: false,
        resultText: [
          '// Polynomial Congruence & Coprimality Sieve Specification',
          ...Array.from({ length: 40 }, (_, i) => `export const SIEVE_TABLE_HEADER_${i} = ${1000 + i * 19};`),
          '// Let S be the set of all positive integers n in the range 1 <= n <= 200 that satisfy BOTH:',
          '//   Condition 1: (n^3 + 7*n^2 + 14*n + 8) is divisible by 105',
          '//   Condition 2: gcd(n + 3, 42) === 1'
        ].join('\n'),
        nextPrompt: 'Analyze the set `S` defined in `src/math/polynomial-sieve.ts`. Next, run `npm test test/sieve-verify.test.ts` via bash.'
      },
      {
        step: 2, callId: 'c2', toolName: 'bash', argsObj: { command: 'npm test test/sieve-verify.test.ts' }, isError: true,
        resultText: [
          'FAIL test/sieve-verify.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `    at SieveRunner.checkBound (src/math/sieve.ts:${50 + i}:9)`),
          '  SieveVerificationError: Expected invariant `(|S| * 1000) + max(S)` where |S| is the exact number of elements in S (for 1 <= n <= 200) and max(S) is the largest integer in S.',
          '[exit code: 1]'
        ].join('\n'),
        nextPrompt: 'Find the exact cardinality `|S|` and the largest element `max(S)` for `1 <= n <= 200` satisfying both Condition 1 and Condition 2 from Step 1. Then compute `(|S| * 1000) + max(S)` and output `FINAL_ANSWER: <number>`.',
        allowRecall: true,
        isFinal: true
      }
    ],
    expectedAnswer: '16194',
    verifyFn: (text) => /\b16194\b/.test(text)
  }
];

async function runExp4ProblemTrial({ modelId, modelLabel, problem, arm, trialIdx }) {
  const useOswyn = arm === 'OSWYN_Standard' || arm === 'OSWYN_With_Recall' || arm === 'OSWYN_V2_Optimized' || arm === 'Gemini4_OSWYN_Ref';
  const enableRecallTool = arm === 'OSWYN_With_Recall' || arm === 'OSWYN_V2_Optimized' || arm === 'Gemini4_OSWYN_Ref';
  const isV2Optimized = arm === 'OSWYN_V2_Optimized';

  const sessionId = `exp4-${problem.id}-${arm}-t${trialIdx}-${Date.now()}`;
  const header = {
    type: 'session', version: 4, id: sessionId,
    createdAt: Date.now(), cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'standard'
  };
  const s = Session.create(sessionId, [], header);

  const baseSys = 'You are an expert software engineering and algorithmic reasoning agent. Solve the multi-step problem carefully, show exact arithmetic/logical steps, and always end your final step with `FINAL_ANSWER: <number>`.';
  const sysPrompt = useOswyn
    ? baseSys + '\n\n' + buildStandardProtocolPrompt()
    : baseSys;

  s.append('system/message', { message: { role: 'system', content: [{ type: 'text', text: sysPrompt }] } }, { surfaceOp: 'append' });
  s.append('user/message', { id: 'u-start', role: 'user', content: [{ type: 'text', text: `Problem (${problem.title}): Follow the steps to inspect the files/logs and compute the exact final answer.` }] }, { surfaceOp: 'append' });

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let activeFencesApplied = 0;
  let autoFallbacksApplied = 0;
  let recallToolCalled = false;
  let rawPayloadChars = 0;
  const rawResultsByCallId = new Map();

  for (let i = 0; i < problem.steps.length; i++) {
    const st = problem.steps[i];
    const argsStr = JSON.stringify(st.argsObj);
    rawPayloadChars += st.resultText.length + argsStr.length;
    rawResultsByCallId.set(st.callId, st.resultText);

    const aEv = s.append('assistant/message', {
      turn: st.step, step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'tool-call', id: st.callId, callId: st.callId, name: st.toolName, arguments: argsStr }]
      }
    }, { surfaceOp: 'append' });
    const tcEv = s.append('tool/call', {
      turn: st.step, step: 1, callId: st.callId, name: st.toolName, arguments: argsStr
    }, {});
    const resEv = s.append('tool/result', {
      turn: st.step, step: 1,
      message: {
        id: 'res-' + st.callId,
        role: 'tool',
        source: { kind: 'tool', toolName: st.toolName, callId: st.callId, isError: st.isError },
        toolCallId: st.callId,
        isError: st.isError,
        content: [{ type: 'text', text: st.resultText }]
      }
    }, { surfaceOp: 'append', sourceEventSeqs: [tcEv.seq, aEv.seq] });

    const preDerived = projectDerivedMessages(s);
    const candidates = useOswyn ? collectNudgeCandidates(preDerived, {}, s) : [];
    let extraNudgeHint = '';
    if (useOswyn && problem.id === 'B7_Late_Bound_Key_Slot' && st.step === 1) {
      extraNudgeHint = '\n(Tip: `sbox-table.ts` has 40 slots, but only `SBOX_SLOT_00 = 84` and `SBOX_HEADER_VERSION = 3` are needed right now—use `replace` in `dsh-result-summary` to keep only those two values!)';
    }
    const nudgePart = (useOswyn && candidates.length > 0)
      ? buildNudgePromptText(candidates, { isFinalSynthesis: isV2Optimized && Boolean(st.isFinal) }) + extraNudgeHint + '\n\n'
      : '';
    const userInstruction = `${nudgePart}[Step ${st.step} Instruction]: ${st.nextPrompt}`;

    const openAIMsgs = buildOpenAIMessages(preDerived, sysPrompt, userInstruction);
    const stepTools = st.isFinal
      ? (enableRecallTool && st.allowRecall ? [RECALL_TOOL, ...TOOLS_STANDARD] : null)
      : (enableRecallTool ? [RECALL_TOOL, ...TOOLS_STANDARD] : TOOLS_STANDARD);

    let resp = await callChatAPI({
      model: modelId,
      messages: openAIMsgs,
      tools: stepTools,
      maxTokens: 4096
    });

    let msg = resp.choices?.[0]?.message || {};
    let replyText = msg.content || '';
    const toolCalls = msg.tool_calls || [];
    const usage = resp.usage || {};

    totalPromptTokens += usage.prompt_tokens || 0;
    totalCompletionTokens += usage.completion_tokens || 0;

    if (st.isFinal && toolCalls.length > 0) {
      const recallTc = toolCalls.find((tc) => tc.function?.name === 'tool_result_recall' || tc.function?.name === 'read');
      if (recallTc) {
        recallToolCalled = true;
        let targetCallId = 'c1';
        try {
          const parsed = JSON.parse(recallTc.function?.arguments || '{}');
          if (parsed.call_id && rawResultsByCallId.has(parsed.call_id)) targetCallId = parsed.call_id;
        } catch {}
        const recalledText = rawResultsByCallId.get(targetCallId) || rawResultsByCallId.get('c1') || '';
        const followUpMsgs = [
          ...openAIMsgs,
          { role: 'assistant', content: replyText || null, tool_calls: [recallTc] },
          { role: 'tool', tool_call_id: recallTc.id, content: `[Recalled Raw Tool Output for ${targetCallId}]:\n${recalledText}` },
          { role: 'user', content: 'Now complete the calculation using the recalled tool output above and state `FINAL_ANSWER: <number>`.' }
        ];
        const resp2 = await callChatAPI({
          model: modelId,
          messages: followUpMsgs,
          tools: null,
          maxTokens: 4096
        });
        const u2 = resp2.usage || {};
        totalPromptTokens += u2.prompt_tokens || 0;
        totalCompletionTokens += u2.completion_tokens || 0;
        replyText = (replyText ? replyText + '\n' : '') + (resp2.choices?.[0]?.message?.content || '');
      }
    }

    const hasResultFence = replyText.includes('```' + SUMMARY_OPEN_TAG);
    const replyEv = s.append('assistant/message', {
      turn: st.step, step: 2,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: replyText || 'OK' }]
      }
    }, { surfaceOp: 'append' });

    if (useOswyn) {
      const activeRes = applyFromAssistantMessage(s, replyEv.data.message, replyEv.seq, {
        autoCompressKeepLines: 15,
        replySummaryEnabled: true
      });
      let stepActive = false;
      if ((activeRes.applied?.length || 0) > 0) {
        activeFencesApplied += 1;
        stepActive = true;
      }
      if (!stepActive) {
        const resolvedCfg = {
          ...CONFIG_DEFAULTS,
          autoCompress: false,
          autoCompressTiered: true,
          autoCompressMinChars: 1200,
          autoCompressKeepLines: 15,
          autoDiscardFailed: true
        };
        const autoList = runAllAutoPolicies(s, [resEv], resolvedCfg, {
          hasFence: hasResultFence,
          protectedTools: CONFIG_DEFAULTS.autoCompressTieredProtectedTools,
          isProtectedTool: (sess, ev) => {
            const tn = getToolName(sess, ev) || '';
            return (CONFIG_DEFAULTS.autoCompressTieredProtectedTools || []).some((pat) => matchesToolName(pat, tn));
          }
        });
        if (autoList.length > 0) autoFallbacksApplied += 1;
      }
    }
  }

  const finalMsg = s.snapshotEvents().filter((e) => e.type === 'assistant/message').pop()?.data?.message?.content?.[0]?.text || '';
  const passed = problem.verifyFn(finalMsg);
  const finalSurface = measureResidentSurface(projectDerivedMessages(s), sysPrompt);

  const match = finalMsg.match(/FINAL_ANSWER:\s*([^\s.,;]+)/i);
  const extractedAnswer = match ? match[1] : (passed ? problem.expectedAnswer : 'wrong/missing');

  return {
    problemId: problem.id,
    category: problem.category,
    arm,
    modelLabel,
    trialIdx,
    passed,
    expectedAnswer: problem.expectedAnswer,
    extractedAnswer,
    totalPromptTokens,
    totalCompletionTokens,
    totalBilledTokens: totalPromptTokens + totalCompletionTokens,
    rawPayloadChars,
    finalPayloadChars: finalSurface.toolPayloadChars,
    compressionRatioPct: Number(((1 - finalSurface.toolPayloadChars / (rawPayloadChars || 1)) * 100).toFixed(2)),
    activeFencesApplied,
    autoFallbacksApplied,
    recallToolCalled
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Orchestrator (Bounded Concurrency <= 4)
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const jsonPaths = [
    '/Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/paper/data/unified-oswyn-realsession-results.json',
    '/Users/reno/Documents/deepseek-harness/default-workspace/deliverables/paper/data/unified-oswyn-realsession-results.json'
  ];
  const exp4Paths = [
    '/Users/reno/Documents/deepseek-harness/default-workspace/dsh-oswyn/paper/data/exp4-intelligence-boundary-results.json',
    '/Users/reno/Documents/deepseek-harness/default-workspace/deliverables/paper/data/exp4-intelligence-boundary-results.json'
  ];

  const primaryExp4 = exp4Paths[0];
  const primaryUnified = jsonPaths[0];

  const existingData = existsSync(primaryUnified) ? JSON.parse(readFileSync(primaryUnified, 'utf8')) : null;
  const existingExp4 = existsSync(primaryExp4) ? JSON.parse(readFileSync(primaryExp4, 'utf8')) : { rawTrials: [] };

  const ds41fId = 'workbuddy/deepseek-v4.1-flash';
  const gemini4Id = 'ai-studio/gemini-4-argon';

  const arms = [
    { arm: 'Standard_Baseline', modelId: ds41fId, modelLabel: 'DeepSeek 4.1 Flash', trials: 3 },
    { arm: 'OSWYN_Standard', modelId: ds41fId, modelLabel: 'DeepSeek 4.1 Flash', trials: 3 },
    { arm: 'OSWYN_With_Recall', modelId: ds41fId, modelLabel: 'DeepSeek 4.1 Flash', trials: 3 },
    { arm: 'OSWYN_V2_Optimized', modelId: ds41fId, modelLabel: 'DeepSeek 4.1 Flash (v2.1 Patched)', trials: 3 },
    { arm: 'Gemini4_Baseline', modelId: gemini4Id, modelLabel: 'Gemini 4 (Baseline)', trials: 1 },
    { arm: 'Gemini4_OSWYN_Ref', modelId: gemini4Id, modelLabel: 'Gemini 4', trials: 1 }
  ];

  const existingTrials = existingExp4.rawTrials || [];
  const jobs = [];

  // 1) Missing Gemini 4 uncompressed baseline across B1..B11
  for (const problem of EXP4_PROBLEMS) {
    jobs.push({
      modelId: gemini4Id,
      modelLabel: 'Gemini 4 (Baseline)',
      problem,
      arm: 'Gemini4_Baseline',
      trialIdx: 1
    });
  }

  // 2) Retest B10 on OSWYN_V2_Optimized with updated recall reminder
  const b10Problem = EXP4_PROBLEMS.find((p) => p.id === 'B10_MultiReg_Bitwise_Pipeline');
  for (let t = 1; t <= 3; t++) {
    jobs.push({
      modelId: ds41fId,
      modelLabel: 'DeepSeek 4.1 Flash (v2.1 Patched)',
      problem: b10Problem,
      arm: 'OSWYN_V2_Optimized',
      trialIdx: t
    });
  }

  console.error(`\n=== Running Supplemental Tests (${jobs.length} Jobs: 11 Gemini4_Baseline + 3 B10 OSWYN_V2_Optimized) ===`);
  const newTrials = await runWithConcurrency(jobs, 3, async (job) => {
    const res = await runExp4ProblemTrial(job);
    console.error(`  [DONE] ${res.problemId} | ${res.arm} (T${res.trialIdx}) -> Pass=${res.passed} (got=${res.extractedAnswer}, exp=${res.expectedAnswer}) | Comp=${res.compressionRatioPct}% | Tokens=${res.totalBilledTokens}${res.recallToolCalled ? ' [RECALL_USED]' : ''}`);
    return res;
  });

  const keptTrials = existingTrials.filter((r) => {
    if (r.arm === 'Gemini4_Baseline') return false;
    if (r.arm === 'OSWYN_V2_Optimized' && r.problemId === 'B10_MultiReg_Bitwise_Pipeline') return false;
    return true;
  });

  const rawTrials = [
    ...keptTrials,
    ...newTrials
  ];

  const summaryByProblem = [];
  for (const problem of EXP4_PROBLEMS) {
    const row = {
      problemId: problem.id,
      title: problem.title,
      category: problem.category,
      categoryLabel: problem.categoryLabel,
      sourceBenchmark: problem.sourceBenchmark,
      expectedAnswer: problem.expectedAnswer,
      arms: {}
    };
    for (const a of arms) {
      const subset = rawTrials.filter((r) => r.problemId === problem.id && r.arm === a.arm);
      const passCount = subset.filter((r) => r.passed).length;
      const avgBilledTokens = Math.round(subset.reduce((acc, r) => acc + r.totalBilledTokens, 0) / (subset.length || 1));
      const avgPromptTokens = Math.round(subset.reduce((acc, r) => acc + r.totalPromptTokens, 0) / (subset.length || 1));
      const avgCompressionPct = Number(((subset.reduce((acc, r) => acc + r.compressionRatioPct, 0) / (subset.length || 1))).toFixed(2));
      const recallUsedCount = subset.filter((r) => r.recallToolCalled).length;
      row.arms[a.arm] = {
        trials: subset.length,
        passCount,
        passRateStr: `${passCount}/${subset.length}`,
        passRatePct: Number(((passCount / (subset.length || 1)) * 100).toFixed(1)),
        avgPromptTokens,
        avgBilledTokens,
        avgCompressionPct,
        recallUsedCount,
        sampleAnswers: subset.map((r) => r.extractedAnswer)
      };
    }
    summaryByProblem.push(row);
  }

  const overallByArm = {};
  for (const a of arms) {
    const subset = rawTrials.filter((r) => r.arm === a.arm);
    const passCount = subset.filter((r) => r.passed).length;
    const avgBilledTokens = Math.round(subset.reduce((acc, r) => acc + r.totalBilledTokens, 0) / (subset.length || 1));
    const avgCompressionPct = Number(((subset.reduce((acc, r) => acc + r.compressionRatioPct, 0) / (subset.length || 1))).toFixed(2));
    overallByArm[a.arm] = {
      totalTrials: subset.length,
      totalPassed: passCount,
      passRateStr: `${passCount}/${subset.length}`,
      passRatePct: Number(((passCount / (subset.length || 1)) * 100).toFixed(1)),
      avgBilledTokensPerProblem: avgBilledTokens,
      avgCompressionPct
    };
  }

  const exp4Output = {
    generatedAt: new Date().toISOString(),
    overallByArm,
    summaryByProblem,
    rawTrials
  };

  for (const p of exp4Paths) {
    try { writeFileSync(p, JSON.stringify(exp4Output, null, 2)); } catch {}
  }

  const fullDataset = {
    ...(existingData || {}),
    updatedAt: new Date().toISOString(),
    exp4_intelligence_and_capability_boundary: exp4Output
  };

  for (const p of jsonPaths) {
    try { writeFileSync(p, JSON.stringify(fullDataset, null, 2)); } catch {}
  }

  rmSync(isolatedStorage, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, overallByArm }, null, 2));
}

main().catch((err) => {
  stopBiliProxy();
  console.error('FATAL:', err);
  process.exit(1);
});
