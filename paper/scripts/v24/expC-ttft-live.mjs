#!/usr/bin/env node
/**
 * v2.4 Experiment C: LIVE TTFT / cache economics on a real inference gateway.
 *
 * Measures, against the real DeepSeek 4.1 Flash endpoint, the two physical curves the
 * v2.4 trigger policy must optimise against:
 *   (1) TTFT as a function of UNIQUE (uncached) prompt tokens   -> cost of a cache reset
 *   (2) TTFT as a function of CACHED prompt tokens             -> cost of carrying history
 *
 * Protocol per size S:
 *   call 1  : cold prefix of S tokens  -> full prefill, uncached_tokens ~= S
 *   call 2  : identical prefix (warm)  -> cache read,     cached_tokens ~= S
 * Each call appends a tiny distinct question so the request is not deduplicated.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.OSWYN_GATEWAY || 'http://127.0.0.1:3425/v1';
const MODEL = process.env.OSWYN_MODEL || 'group/deepseek-v4.1-flash';

const SIZES = [4096, 16384, 65536, 131072, 262144];
const REPEATS = 3;

function filler(targetTokens, seed) {
  // ~3.55 chars/token of dense, low-redundancy technical prose
  const unit = `[seg-${seed}] The worker pool supervisor observes a mutex acquisition chain where thread ${seed} holds lock 0x7f9a and awaits a condition variable signalled by the ledger compaction routine; the retry budget is 17 attempts with exponential backoff capped at 4200 ms. `;
  const chars = Math.round(targetTokens * 3.55);
  let s = '';
  while (s.length < chars) s += unit;
  return s.slice(0, chars);
}

async function call(messages, label) {
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 24, temperature: 0, stream: false }),
  });
  const t1 = process.hrtime.bigint();
  const body = await res.json();
  const t2 = process.hrtime.bigint();
  if (!res.ok) throw new Error(label + ': HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 300));
  const u = body.usage || {};
  const details = u.prompt_tokens_details || {};
  return {
    label,
    wallMs: +(Number(t1 - t0) / 1e6).toFixed(1),
    totalMs: +(Number(t2 - t0) / 1e6).toFixed(1),
    promptTokens: u.prompt_tokens ?? null,
    cachedTokens: details.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
    completionTokens: u.completion_tokens ?? null,
  };
}

const rows = [];
for (const S of SIZES) {
  const seed = S + 7;
  const sys = 'You are a terse assistant. Answer with a single word.';
  const big = filler(S, seed);
  for (let r = 0; r < REPEATS; r += 1) {
    const msgs = [
      { role: 'system', content: sys },
      { role: 'user', content: big + `\n\nQuestion ${r}: reply with OK.` },
    ];
    try {
      const out = await call(msgs, `S=${S} rep=${r}`);
      out.requestedTokens = S;
      out.rep = r;
      rows.push(out);
      console.log(JSON.stringify(out));
    } catch (e) {
      console.log('ERR ' + e.message);
    }
  }
}

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expC-ttft-live.json'), JSON.stringify({ base: BASE, model: MODEL, rows }, null, 2));
