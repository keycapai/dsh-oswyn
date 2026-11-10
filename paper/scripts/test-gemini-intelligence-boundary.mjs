import http from 'node:http';
import fs from 'node:fs';

const API_URL = 'http://127.0.0.1:3425/v1/chat/completions';
const MODEL = 'ai-studio/gemini-4-argon';

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
        timeout: 180000
      },
      (res) => {
        let body = '';
        res.on('data', (chk) => (body += chk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gateway Timeout (180s)'));
    });
    req.write(postData);
    req.end();
  });
}

// 4 High-Difficulty Problems for Gemini Capability Boundary:
// B10 (Nonlinear DSP Filter)
// B11 (AIME Cubic Modular Coprime Sieve)
// B12 (Banker's Algorithm 5-Process Multi-Resource Safe Sequence)
// B13 (Finite Field F_97 Discrete Log & Polynomial Key Schedule)

const PROBLEMS = [
  {
    id: 'B10_Nonlinear_DSP_Filter',
    title: 'B10: 4 寄存器非线性位运算滤波与中间状态突变追踪',
    expected: '369',
    verify: (t) => /\b369\b/.test(t),
    steps: [
      {
        step: 1,
        tool: 'read',
        args: { file_path: 'src/dsp/filter-stage1.ts' },
        rawOutput: [
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
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- INIT_STATE = { A: 45, B: 29, C: 78, D: 19 }',
          '- stepRound(state, r): t=((A*3)^B)%100; nextA=(B+C)%100; nextB=(t+D*r)%100;',
          '  If nextA > nextB: nextC=(C^nextA)%100, nextD=D; Else: nextC=C, nextD=(D+nextB)%100;',
          '```'
        ].join('\n'),
        userNudge: 'Inspect `src/dsp/filter-stage1.ts` and trace Stage 1 (`r = 1` then `r = 2`). Next, run `npm test test/dsp-pipeline.test.ts` via bash.'
      },
      {
        step: 2,
        tool: 'bash',
        args: { command: 'npm test test/dsp-pipeline.test.ts' },
        rawOutput: [
          'FAIL test/dsp-pipeline.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `  [dma-channel-${i}] buffer_status=ok, watermark=${200 + i * 4}`),
          '  DmaInterruptException: Between Stage 1 (after r=2) and Stage 2 (before r=3), DMA interrupt mutates registers: A = (A ^ 39), C = (C + 47) % 100 (while B and D are unchanged)',
          '[exit code: 1]'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'discard',
          '- DMA interrupt mutation (between r=2 and r=3): A = (A ^ 39), C = (C + 47) % 100 (B, D unchanged)',
          '```'
        ].join('\n'),
        userNudge: 'Inspect the DMA interrupt mutation from Step 2. Next, read `src/dsp/filter-stage2.ts` via read tool.'
      },
      {
        step: 3,
        tool: 'read',
        args: { file_path: 'src/dsp/filter-stage2.ts' },
        rawOutput: [
          '// Filter Stage 2 Finalizer',
          ...Array.from({ length: 40 }, (_, i) => `export const STAGE2_DITHER_MASK_${i} = ${300 + i * 9};`),
          '// Stage 2 executes one final round of `stepRound(state, r)` with `r = 3` on the post-DMA-interrupt state,',
          '// and then outputs the checksum:',
          '//   FinalHash = A * 100 + B * 10 + C + D'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- Stage 2: execute stepRound(state, r=3) on mutated state; FinalHash = A*100 + B*10 + C + D',
          '```'
        ].join('\n'),
        userNudge: 'Compute the exact state `(A, B, C, D)` after Stage 1 (`r=1`, `r=2`), apply the DMA interrupt mutation from Step 2, then execute Stage 2 (`stepRound` with `r=3`), and compute `FinalHash = A * 100 + B * 10 + C + D`. Output `FINAL_ANSWER: <number>`.'
      }
    ]
  },
  {
    id: 'B11_AIME_Cubic_CRT_Coprime',
    title: 'B11: 三次多项式模 105 同余根集与模 42 互质筛的边界计数及极值耦合求解',
    expected: '16194',
    verify: (t) => /\b16194\b/.test(t),
    steps: [
      {
        step: 1,
        tool: 'read',
        args: { file_path: 'src/math/polynomial-sieve.ts' },
        rawOutput: [
          '// Polynomial Congruence & Coprimality Sieve Specification',
          ...Array.from({ length: 40 }, (_, i) => `export const SIEVE_TABLE_HEADER_${i} = ${1000 + i * 19};`),
          '// Let S be the set of all positive integers n in the range 1 <= n <= 200 that satisfy BOTH:',
          '//   Condition 1: (n^3 + 7*n^2 + 14*n + 8) is divisible by 105',
          '//   Condition 2: gcd(n + 3, 42) === 1'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- S = { n in [1, 200] | (n^3 + 7*n^2 + 14*n + 8) % 105 === 0 and gcd(n + 3, 42) === 1 }',
          '```'
        ].join('\n'),
        userNudge: 'Analyze the set `S` defined in `src/math/polynomial-sieve.ts`. Next, run `npm test test/sieve-verify.test.ts` via bash.'
      },
      {
        step: 2,
        tool: 'bash',
        args: { command: 'npm test test/sieve-verify.test.ts' },
        rawOutput: [
          'FAIL test/sieve-verify.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `    at SieveRunner.checkBound (src/math/sieve.ts:${50 + i}:9)`),
          '  SieveVerificationError: Expected invariant `(|S| * 1000) + max(S)` where |S| is the exact number of elements in S (for 1 <= n <= 200) and max(S) is the largest integer in S.',
          '[exit code: 1]'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'discard',
          '- Target metric: (|S| * 1000) + max(S) for n in [1, 200]',
          '```'
        ].join('\n'),
        userNudge: 'Find the exact cardinality `|S|` and the largest element `max(S)` for `1 <= n <= 200` satisfying both Condition 1 and Condition 2 from Step 1. Then compute `(|S| * 1000) + max(S)` and output `FINAL_ANSWER: <number>`.'
      }
    ]
  },
  {
    id: 'B12_Bankers_Algorithm_Deadlock_Avoidance',
    title: 'B12: 多资源死锁避免银行家算法 (Banker\'s Algorithm) 字典序最小安全序列与状态校验和',
    expected: '16263',
    verify: (t) => /\b16263\b/.test(t),
    steps: [
      {
        step: 1,
        tool: 'read',
        args: { file_path: 'src/os/resource-manager.ts' },
        rawOutput: [
          '// Distributed OS Resource Allocation State',
          '// Resources: R0, R1, R2, R3 (4 classes)',
          '// Available vector:',
          'export const AVAILABLE = [3, 3, 2, 2];',
          '// Current Allocation Matrix for Processes P0..P4:',
          'export const ALLOCATION = [',
          '  [0, 0, 1, 2], // P0',
          '  [1, 0, 0, 0], // P1',
          '  [1, 3, 5, 4], // P2',
          '  [0, 6, 3, 2], // P3',
          '  [0, 0, 1, 4]  // P4',
          '];',
          ...Array.from({ length: 40 }, (_, i) => `export const KERNEL_IPC_SLOT_${i} = { pid: ${100 + i}, quantum: ${20 + (i % 5)} };`)
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- Resources (R0, R1, R2, R3). Available = [3, 3, 2, 2]',
          '- Allocation: P0=[0,0,1,2], P1=[1,0,0,0], P2=[1,3,5,4], P3=[0,6,3,2], P4=[0,0,1,4]',
          '```'
        ].join('\n'),
        userNudge: 'Note AVAILABLE and ALLOCATION matrix. Next, read `src/os/max-claim.ts` via read tool.'
      },
      {
        step: 2,
        tool: 'read',
        args: { file_path: 'src/os/max-claim.ts' },
        rawOutput: [
          '// Process Maximum Resource Claims (Max Matrix)',
          'export const MAX_CLAIMS = [',
          '  [0, 0, 1, 2], // P0',
          '  [1, 7, 5, 0], // P1',
          '  [2, 3, 5, 6], // P2',
          '  [0, 6, 5, 2], // P3',
          '  [0, 6, 5, 6]  // P4',
          '];',
          ...Array.from({ length: 40 }, (_, i) => `export const AUDIT_LOG_ENTRY_${i} = "audit_claim_valid_${i}";`),
          '// Need Matrix = Max Claims - Allocation'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- Max Claims: P0=[0,0,1,2], P1=[1,7,5,0], P2=[2,3,5,6], P3=[0,6,5,2], P4=[0,6,5,6]',
          '- Need = Max - Allocation',
          '```'
        ].join('\n'),
        userNudge: 'Calculate Need matrix. Next, run `npm test test/banker.test.ts` via bash to verify the required checksum formula.'
      },
      {
        step: 3,
        tool: 'bash',
        args: { command: 'npm test test/banker.test.ts' },
        rawOutput: [
          'FAIL test/banker.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `    at BankerValidator.checkSchedule (src/os/banker.ts:${100 + i}:11)`),
          '  SafetySequenceInvariantError: Find the unique LEXICOGRAPHICALLY SMALLEST safe sequence of process indices [p_0, p_1, p_2, p_3, p_4].',
          '  Then compute: FinalChecksum = (p_0*10000 + p_1*1000 + p_2*100 + p_3*10 + p_4) * 7 + FinalWork[0] * 13',
          '  where FinalWork[0] is the final available quantity of R0 when all processes have terminated.',
          '[exit code: 1]'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'discard',
          '- Invariant: Find lexicographically smallest safe sequence [p_0..p_4]. FinalChecksum = (p_0*10000 + p_1*1000 + p_2*100 + p_3*10 + p_4) * 7 + FinalWork[0] * 13',
          '```'
        ].join('\n'),
        userNudge: 'Execute Banker\'s Algorithm step-by-step: find the lexicographically smallest safe sequence [p_0, p_1, p_2, p_3, p_4] where Need <= Work, updating Work = Work + Allocation. Then compute `FinalChecksum = (p_0*10000 + p_1*1000 + p_2*100 + p_3*10 + p_4) * 7 + FinalWork[0] * 13`. Output `FINAL_ANSWER: <number>`.'
      }
    ]
  },
  {
    id: 'B13_FiniteField_DiscreteLog_Polynomial',
    title: 'B13: 有限域 F_97 原根离散对数与三次非线性密钥编排',
    expected: '91',
    verify: (t) => /\b91\b/.test(t),
    steps: [
      {
        step: 1,
        tool: 'read',
        args: { file_path: 'src/crypto/diffie-hellman.ts' },
        rawOutput: [
          '// Prime Group & Discrete Log Parameters',
          'export const MOD_PRIME = 97; // prime p = 97',
          'export const GENERATOR = 5;  // primitive root g = 5 mod 97',
          'export const TARGET_PUBKEY = 35; // g^x === 35 (mod 97)',
          ...Array.from({ length: 45 }, (_, i) => `export const DUMMY_CERT_REVOCATION_${i} = "revocation_entry_${i}";`),
          '// Private key x is an integer in range [0, 95].'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'replace',
          '- Prime p = 97, generator g = 5. Target: 5^x === 35 (mod 97), with x in [0, 95].',
          '```'
        ].join('\n'),
        userNudge: 'Note p=97, g=5, 5^x === 35 mod 97. Next, run `npm test test/key-schedule.test.ts` via bash.'
      },
      {
        step: 2,
        tool: 'bash',
        args: { command: 'npm test test/key-schedule.test.ts' },
        rawOutput: [
          'FAIL test/key-schedule.test.ts',
          ...Array.from({ length: 40 }, (_, i) => `    at KeyDeriver.derive (src/crypto/kdf.ts:${75 + i}:13)`),
          '  KeyScheduleError: Final key derivation rule:',
          '    1. Find private exponent x in [0, 95] such that (5^x) % 97 === 35.',
          '    2. Compute polynomial f(x) = (x^3 + 11*x^2 + 7) % 97.',
          '    3. FinalMasterKey = f(x) ^ 90  (bitwise XOR with 90, i.e. 0x5A).',
          '[exit code: 1]'
        ].join('\n'),
        compressedOutput: [
          '```dsh-result-summary',
          'discard',
          '- Derivation: x = log_5(35) mod 97; f(x) = (x^3 + 11*x^2 + 7) % 97; FinalMasterKey = f(x) ^ 90',
          '```'
        ].join('\n'),
        userNudge: 'Solve for x such that (5^x) % 97 === 35. Compute f(x) = (x^3 + 11*x^2 + 7) % 97. Then compute `FinalMasterKey = f(x) ^ 90`. Output `FINAL_ANSWER: <number>`.'
      }
    ]
  }
];

async function runProblem(problem, mode) {
  const isCompressed = mode === 'OSWYN_Compressed';
  console.log(`\n======================================================`);
  console.log(`Starting ${problem.id} [${mode}]`);
  console.log(`======================================================`);

  const messages = [
    {
      role: 'system',
      content: 'You are an expert software engineering and algorithmic reasoning agent. Solve the multi-step problem carefully, show exact arithmetic/logical steps, and always end your final step with `FINAL_ANSWER: <number>`.'
    },
    {
      role: 'user',
      content: `Problem (${problem.title}): Follow the steps to inspect the files/logs and compute the exact final answer.`
    }
  ];

  let totalPromptTok = 0;
  let totalCachedTok = 0;
  let totalComplTok = 0;
  let finalContent = '';

  for (let i = 0; i < problem.steps.length; i++) {
    const st = problem.steps[i];
    const isFinalStep = i === problem.steps.length - 1;
    const toolOutput = isCompressed ? st.compressedOutput : st.rawOutput;

    // Simulate multi-step tool conversation
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${st.step}`,
          type: 'function',
          function: { name: st.tool, arguments: JSON.stringify(st.args) }
        }
      ]
    });

    messages.push({
      role: 'tool',
      tool_call_id: `call_${st.step}`,
      content: toolOutput
    });

    messages.push({
      role: 'user',
      content: `[Step ${st.step} Instruction]: ${st.userNudge}`
    });

    if (isFinalStep) {
      console.log(`[${mode}] Calling Gemini 4 for final calculation on ${problem.id}...`);
      const resp = await callChatAPI({
        model: MODEL,
        messages,
        max_tokens: 4096,
        temperature: 0.0
      });

      const usage = resp.usage || {};
      totalPromptTok += usage.prompt_tokens || 0;
      totalCachedTok += usage.prompt_tokens_details?.cached_tokens || usage.cached_tokens || 0;
      totalComplTok += usage.completion_tokens || 0;

      finalContent = resp.choices?.[0]?.message?.content || '';
      console.log(`[${mode}] Response length: ${finalContent.length} chars. Tokens: prompt=${usage.prompt_tokens}, cached=${usage.prompt_tokens_details?.cached_tokens || 0}, compl=${usage.completion_tokens}`);
    } else {
      // Intermediate step: simulate lightweight model response acknowledge
      messages.push({
        role: 'assistant',
        content: `Acknowledged Step ${st.step} output.`
      });
    }
  }

  const passed = problem.verify(finalContent);
  const match = finalContent.match(/FINAL_ANSWER:\s*([^\s.,;]+)/i);
  const extracted = match ? match[1] : (passed ? problem.expected : 'wrong/missing');

  console.log(`[Result] Problem: ${problem.id} | Mode: ${mode} | Passed: ${passed} | Expected: ${problem.expected} | Got: ${extracted}`);
  return {
    problemId: problem.id,
    mode,
    passed,
    expected: problem.expected,
    extracted,
    promptTokens: totalPromptTok,
    cachedTokens: totalCachedTok,
    completionTokens: totalComplTok,
    finalSnippet: finalContent.substring(0, 300)
  };
}

async function main() {
  const results = [];
  for (const prob of PROBLEMS) {
    // Run Baseline
    try {
      const resBase = await runProblem(prob, 'Uncompressed_Baseline');
      results.push(resBase);
    } catch (e) {
      console.error(`Baseline failed on ${prob.id}:`, e.message);
      results.push({ problemId: prob.id, mode: 'Uncompressed_Baseline', passed: false, error: e.message });
    }

    // Run OSWYN Compressed
    try {
      const resComp = await runProblem(prob, 'OSWYN_Compressed');
      results.push(resComp);
    } catch (e) {
      console.error(`OSWYN failed on ${prob.id}:`, e.message);
      results.push({ problemId: prob.id, mode: 'OSWYN_Compressed', passed: false, error: e.message });
    }
  }

  console.log('\n======================================================');
  console.log('SUMMARY OF GEMINI 4 CAPABILITY BOUNDARY TEST');
  console.log('======================================================');
  console.table(results.map(r => ({
    Problem: r.problemId,
    Mode: r.mode,
    Passed: r.passed,
    Extracted: r.extracted,
    Expected: r.expected,
    PromptTok: r.promptTokens,
    CachedTok: r.cachedTokens,
    ComplTok: r.completionTokens
  })));

  fs.writeFileSync('gemini-capability-test-results.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
