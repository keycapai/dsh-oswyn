#!/usr/bin/env node
/**
 * v2.4 Experiment F: attention dilution vs undistilled volume (LIVE model calls).
 *
 * Question the trigger parameters must answer:
 *   At what undistilled history volume does carrying the raw surface measurably
 *   degrade the model's ability to do (a) a NEW orthogonal task and (b) recall a
 *   precise fact buried in the noise?
 *
 * Design
 * ------
 * Each trial builds one conversation:
 *   [system] + [turn 1..k of REAL tool-output noise] + [current question]
 * The noise is real production tool output (paper/data/v24/noise-corpus.json).
 * Two deterministic, exactly-gradable tasks:
 *   T1 ORTHOGONAL : sliding-window rate-limiter arithmetic, no dependence on history
 *   T2 NEEDLE     : an exact constant that appears in exactly ONE noise chunk
 *
 * Three surface conditions:
 *   RAW       full noise retained (Origin Replay / undistilled)
 *   DISTILL   noise stripped (post-cache deep distill, no recall)
 *   RECALL    noise stripped, but the needle-bearing chunk re-injected (mode:'tool')
 *
 * Grading is exact-match on a normalized numeric answer, so there is no judge model.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.OSWYN_GATEWAY || 'http://127.0.0.1:3425/v1';
const MODEL = process.env.OSWYN_MODEL || 'group/deepseek-v4.1-flash';
const CORPUS = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'paper', 'data', 'v24', 'noise-corpus.json'), 'utf8')).chunks;

const VOLUMES = [0, 8000, 32000, 128000, 256000];   // target noise tokens
const REPS = 3;
const CPT = 2.9;                                     // chars/token (Exp B calibration)

// ---- T1 ground truth: sliding window over a fixed timestamp list
const TS = [0, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44];
const NOW = 45;
const LIMIT = 50;
const WINDOW = 10;
const inWindow = TS.filter((t) => t > NOW - WINDOW && t <= NOW);
const T1_TRUTH = `${inWindow.length}, ${inWindow.length < LIMIT ? 'YES' : 'NO'}`;

function t1Prompt() {
  return `A sliding-window rate limiter admits at most ${LIMIT} requests per ${WINDOW}-second window.
The window is exclusive at the left edge: a request at time t is counted iff (now - ${WINDOW}) < t <= now.
Recorded request timestamps in seconds: ${TS.join(', ')}.
At now = ${NOW}s: how many recorded requests fall inside the current window, and would one more request be admitted?
Answer on ONE line exactly as: <count>, <YES or NO>`;
}

// ---- T2 needle
function makeNeedle(rep) {
  const v = 70000 + rep * 1111 + Math.floor(Math.random() * 900);
  const key = `LIMITER_EPOCH_FLOOR_${rep}`;
  return { v, key, line: `diagnostic: ${key}=${v} (immutable epoch floor, do not round)` };
}
function t2Prompt(needle) {
  return `Earlier in this session a diagnostic dump printed a line containing ${needle.key}.
What exact integer value was assigned to ${needle.key}? Answer with the integer only.`;
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9, ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildNoise(targetTokens, needle, seed) {
  if (targetTokens <= 0) return '';
  const wantChars = Math.round(targetTokens * CPT);
  let out = '';
  let i = seed;
  while (out.length < wantChars) {
    out += CORPUS[i % CORPUS.length] + '\n\n';
    i += 1;
  }
  out = out.slice(0, wantChars);
  if (needle) {
    const at = Math.floor(out.length * 0.43);
    out = out.slice(0, at) + '\n' + needle.line + '\n' + out.slice(at);
  }
  return out;
}

async function ask(messages) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 300, temperature: 0, stream: false }),
  });
  const body = await res.json();
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(body).slice(0, 200));
  const u = body.usage || {};
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    promptTokens: u.prompt_tokens ?? null,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: u.completion_tokens ?? null,
    ms,
  };
}

const rows = [];
for (const V of VOLUMES) {
  for (let rep = 0; rep < REPS; rep += 1) {
    const needle = makeNeedle(rep);
    const noise = buildNoise(V, needle, rep * 13 + 1);
    const needleChunk = needle.line;

    for (const cond of ['RAW', 'DISTILL', 'RECALL']) {
      let history = '';
      if (cond === 'RAW') history = noise;
      else if (cond === 'RECALL') history = needleChunk;

      for (const task of ['T1', 'T2']) {
        const q = task === 'T1' ? t1Prompt() : t2Prompt(needle);
        const messages = [
          { role: 'system', content: 'You are a precise engineering assistant. Follow the requested answer format exactly.' },
        ];
        if (history) {
          messages.push({ role: 'user', content: 'Here are earlier diagnostic outputs from this session:\n\n' + history });
          messages.push({ role: 'assistant', content: 'Noted.' });
        }
        messages.push({ role: 'user', content: q });

        let out;
        try { out = await ask(messages); } catch (e) { console.log('ERR', V, cond, task, e.message); continue; }
        const norm = normalize(out.text);
        let correct = false;
        if (task === 'T1') correct = norm.startsWith(normalize(T1_TRUTH));
        else correct = norm.includes(String(needle.v)) || norm.split(' ').includes(String(needle.v));

        const row = {
          volume: V, rep, cond, task, correct,
          expected: task === 'T1' ? T1_TRUTH : String(needle.v),
          answer: out.text.slice(0, 160),
          promptTokens: out.promptTokens, cachedTokens: out.cachedTokens, ms: out.ms,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
  }
}

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expF-dilution-live.json'), JSON.stringify({ model: MODEL, t1Truth: T1_TRUTH, volumes: VOLUMES, reps: REPS, rows }, null, 2));

// summary
const cells = {};
for (const r of rows) {
  const k = `${r.volume}|${r.cond}|${r.task}`;
  cells[k] = cells[k] || { n: 0, ok: 0 };
  cells[k].n += 1; if (r.correct) cells[k].ok += 1;
}
console.log('\nvolume  cond     T1        T2');
for (const V of VOLUMES) {
  const line = [];
  for (const cond of ['RAW', 'DISTILL', 'RECALL']) {
    const a = cells[`${V}|${cond}|T1`]; const b = cells[`${V}|${cond}|T2`];
    line.push(`${cond} T1=${a ? a.ok + '/' + a.n : '-'} T2=${b ? b.ok + '/' + b.n : '-'}`);
  }
  console.log(String(V).padStart(6), line.join('  '));
}
