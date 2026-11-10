import http from 'node:http';
import fs from 'node:fs';

const API_URL = 'http://127.0.0.1:3425/v1/chat/completions';
const MODEL = 'workbuddy/deepseek-v4.1-flash';

function callChatAPI(payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_URL);
    const postData = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 120000
      },
      (res) => {
        let body = '';
        res.on('data', (chk) => (body += chk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.write(postData);
    req.end();
  });
}

// Generate a 50-step SWE debugging & refactoring sequence
function generate50Steps() {
  const steps = [];
  const modules = ['auth', 'redis', 'spinlock', 'chronos', 'scheduler', 'limiter', 'sbox', 'crypto', 'banker', 'dsp'];
  for (let s = 1; s <= 50; s++) {
    const modIdx = (s - 1) % modules.length;
    const mod = modules[modIdx];
    const cycle = Math.floor((s - 1) / modules.length) + 1;
    
    // Vary between code read, test failure, and scan logs
    const kind = s % 3 === 1 ? 'read' : (s % 3 === 2 ? 'bash_fail' : 'bash_pass');
    let toolName = 'read';
    let args = { file_path: `src/${mod}/worker_${cycle}.ts` };
    let rawOutput = '';
    let summaryOutput = '';

    if (kind === 'read') {
      toolName = 'read';
      args = { file_path: `src/${mod}/worker_${cycle}.ts` };
      rawOutput = `// Source file src/${mod}/worker_${cycle}.ts\n` +
        `export const MOD_CONSTANT_${s} = "CONST_VAL_${s}_${mod}";\n` +
        Array.from({ length: 45 }, (_, i) => `export const SHADOW_PARAM_${s}_${i} = { id: ${i}, weight: ${i * 7} };`).join('\n') +
        `\nexport function processBatch_${s}(x: number) { return x * ${cycle} + ${s}; }`;
      summaryOutput = `\`\`\`dsh-result-summary\nreplace\n- Read src/${mod}/worker_${cycle}.ts: MOD_CONSTANT_${s} = "CONST_VAL_${s}_${mod}"; processBatch_${s}(x) = x * ${cycle} + ${s}\n\`\`\``;
    } else if (kind === 'bash_fail') {
      toolName = 'bash';
      args = { command: `npm test test/${mod}-cycle${cycle}.test.ts` };
      rawOutput = `FAIL test/${mod}-cycle${cycle}.test.ts\n` +
        `  AssertionError: Invariant broken at step ${s} with ERR_CODE_${s} = 0x${(s * 17).toString(16)}\n` +
        Array.from({ length: 40 }, (_, i) => `    at Runner.execute (src/${mod}/runner.ts:${100 + i}:12)`).join('\n') +
        `\n[exit code: 1]`;
      summaryOutput = `\`\`\`dsh-result-summary\ndiscard\n- Test fail in test/${mod}-cycle${cycle}.test.ts: ERR_CODE_${s} = 0x${(s * 17).toString(16)}\n\`\`\``;
    } else {
      toolName = 'bash';
      args = { command: `npm run build --module=${mod}` };
      rawOutput = `Build output for module ${mod} (cycle ${cycle}):\n` +
        Array.from({ length: 50 }, (_, i) => `[webpack] asset chunk_${s}_${i}.js size ${(i + 1) * 1024} bytes [emitted]`).join('\n') +
        `\nBuild finished with 0 errors in 124 ms. [exit code: 0]`;
      summaryOutput = `\`\`\`dsh-result-summary\ntruncate keep 15 lines\n- Build succeeded for ${mod} cycle ${cycle} (0 errors)\n\`\`\``;
    }

    steps.push({
      step: s,
      toolName,
      args,
      rawOutput,
      summaryOutput,
      instruction: `Step ${s}: Inspect output and proceed with refactoring module ${mod}.`
    });
  }
  return steps;
}

async function runArm(armName) {
  const isCompressed = armName === 'OSWYN_Standard';
  console.log(`\n======================================================`);
  console.log(`Starting real test for ${armName} (50 steps)`);
  console.log(`======================================================`);

  const steps = generate50Steps();
  const checkpoints = [5, 10, 15, 30, 50];
  const snapshots = {};

  const messages = [
    {
      role: 'system',
      content: 'You are an expert autonomous software engineer executing a 50-step debugging and refactoring session. Analyze each tool result carefully, preserve all constants, and proceed efficiently.'
    },
    {
      role: 'user',
      content: 'Begin 50-step software engineering task.'
    }
  ];

  let cumPromptTokens = 0;
  let cumCachedTokens = 0;
  let cumCompletionTokens = 0;

  for (let s = 1; s <= 50; s++) {
    const st = steps[s - 1];
    const toolContent = isCompressed ? st.summaryOutput : st.rawOutput;

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${s}`,
          type: 'function',
          function: { name: st.toolName, arguments: JSON.stringify(st.args) }
        }
      ]
    });

    messages.push({
      role: 'tool',
      tool_call_id: `call_${s}`,
      content: toolContent
    });

    messages.push({
      role: 'user',
      content: st.instruction
    });

    // Make real API call to DeepSeek
    const resp = await callChatAPI({
      model: MODEL,
      messages,
      max_tokens: 512,
      temperature: 0.0
    });

    const usage = resp.usage || {};
    const pTok = usage.prompt_tokens || 0;
    const cTok = usage.prompt_tokens_details?.cached_tokens || usage.cached_tokens || 0;
    const outTok = usage.completion_tokens || 0;

    cumPromptTokens += pTok;
    cumCachedTokens += cTok;
    cumCompletionTokens += outTok;

    const reply = resp.choices?.[0]?.message?.content || 'OK';
    messages.push({
      role: 'assistant',
      content: reply
    });

    if (checkpoints.includes(s)) {
      const freshPrompt = cumPromptTokens - cumCachedTokens;
      // DeepSeek Flash pricing: cached = 0.02 / M, fresh = 1.00 / M, out = 4.00 / M
      const billedCostCNY = (cumCachedTokens * 0.02 + freshPrompt * 1.00 + cumCompletionTokens * 4.00) / 1000000;
      snapshots[s] = {
        step: s,
        cumPromptTokens,
        cumCachedTokens,
        freshPrompt,
        cumCompletionTokens,
        totalBilledTokens: cumPromptTokens + cumCompletionTokens,
        billedCostCNY: Number(billedCostCNY.toFixed(4)),
        stepPromptTokens: pTok
      };
      console.log(`[Step ${s}] Prompt: ${cumPromptTokens} (Cached: ${cumCachedTokens}, Fresh: ${freshPrompt}), Out: ${cumCompletionTokens}, Cost: ¥${billedCostCNY.toFixed(4)}`);
    }
  }

  return snapshots;
}

async function main() {
  const baseSnapshots = await runArm('Baseline');
  const oswynSnapshots = await runArm('OSWYN_Standard');

  const finalTable = [];
  const checkpoints = [5, 10, 15, 30, 50];
  for (const cp of checkpoints) {
    const b = baseSnapshots[cp];
    const o = oswynSnapshots[cp];
    const deltaPrompt = ((o.cumPromptTokens - b.cumPromptTokens) / b.cumPromptTokens * 100).toFixed(2);
    const deltaTokens = ((o.totalBilledTokens - b.totalBilledTokens) / b.totalBilledTokens * 100).toFixed(2);
    const deltaCost = ((o.billedCostCNY - b.billedCostCNY) / b.billedCostCNY * 100).toFixed(2);

    finalTable.push({
      checkpoint: `第 ${cp} 步`,
      basePrompt: b.cumPromptTokens,
      baseCached: b.cumCachedTokens,
      baseFresh: b.freshPrompt,
      baseCompl: b.cumCompletionTokens,
      baseTokens: b.totalBilledTokens,
      baseCost: b.billedCostCNY,
      oswynPrompt: o.cumPromptTokens,
      oswynCached: o.cumCachedTokens,
      oswynFresh: o.freshPrompt,
      oswynCompl: o.cumCompletionTokens,
      oswynTokens: o.totalBilledTokens,
      oswynCost: o.billedCostCNY,
      deltaTokens: `${deltaTokens}%`,
      deltaCost: `${deltaCost}%`
    });
  }

  console.log('\n======================================================');
  console.log('REAL 50-STEP MEASURED COMPARISON (NO EXTRAPOLATION, NO CACHE GUESS)');
  console.log('======================================================');
  console.table(finalTable);

  fs.writeFileSync('dsh-oswyn/paper/data/exp1-50step-real-snapshots.json', JSON.stringify({ baseSnapshots, oswynSnapshots, finalTable }, null, 2));
}

main().catch(console.error);
