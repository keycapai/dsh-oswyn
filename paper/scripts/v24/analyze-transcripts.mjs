#!/usr/bin/env node
/**
 * v2.4 Experiment B: Real-transcript surface growth + true distillation savings.
 *
 * Replays every real DSH session transcript found under ~/.dsh/sessions (session.v4.jsonl.zstd)
 * through the SHIPPING OSWYN projection engine (lib/core/projection.js) and measures,
 * at every historical turn boundary:
 *   - raw surface size S_t (Origin Replay / undistilled)
 *   - distilled surface size D_t (post-cache deep distill)
 *   - the "uncompressed tail" U_t = S_t - D_{t-1}  (what a volume trigger would watch)
 *
 * Output: per-session curves + population statistics used to calibrate the v2.4
 * volume / round-count trigger thresholds.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(os.homedir(), '.dsh', 'sessions');
const PROJ = pathToFileURL(path.resolve('lib/core/projection.js')).href;
const { projectDistilledHistory, partitionMessagesIntoTurns } = await import(PROJ);

// ---------------------------------------------------------------- token model
// Calibrated from real assistant usage below (chars -> tokens).
let CHARS_PER_TOKEN = 3.6;

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let s = '';
  for (const b of content) {
    if (!b) continue;
    if (typeof b === 'string') { s += b; continue; }
    if (typeof b.text === 'string') s += b.text;
    else if (typeof b.content === 'string') s += b.content;
    else if (typeof b.output === 'string') s += b.output;
    else if (typeof b.thinking === 'string') s += b.thinking;
    else s += JSON.stringify(b);
  }
  return s;
}

function msgChars(m) {
  if (!m) return 0;
  let n = textOfContent(m.content).length;
  if (Array.isArray(m.tool_calls)) n += JSON.stringify(m.tool_calls).length;
  return n;
}

function tok(chars) { return Math.max(1, Math.round(chars / CHARS_PER_TOKEN)); }

function arrayTokens(msgs) {
  let n = 0;
  for (const m of msgs) n += tok(msgChars(m));
  return n;
}

// ---------------------------------------------------------------- discovery
function listSessions() {
  const out = [];
  for (const proj of fs.readdirSync(ROOT)) {
    const pd = path.join(ROOT, proj);
    let st; try { st = fs.statSync(pd); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const sid of fs.readdirSync(pd)) {
      const sd = path.join(pd, sid);
      let st2; try { st2 = fs.statSync(sd); } catch { continue; }
      if (!st2.isDirectory()) continue;
      const f = path.join(sd, 'session.v4.jsonl.zstd');
      if (fs.existsSync(f)) out.push({ project: proj, sessionId: sid, file: f });
    }
  }
  return out;
}

// ---------------------------------------------------------------- reconstruction
function reconstruct(file) {
  let text;
  try { text = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8'); } catch { return null; }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    events.push(e);
  }

  const messages = [];
  const usages = [];
  let firstTime = null;
  let lastTime = null;

  for (const e of events) {
    const d = e.data || {};
    if (typeof e.time === 'number') {
      if (firstTime === null) firstTime = e.time;
      lastTime = e.time;
    }
    if (e.type === 'system/message' || e.type === 'developer/message') {
      messages.push({ role: 'system', content: d.content ?? d.message?.content ?? '' });
    } else if (e.type === 'user/message') {
      messages.push({ role: 'user', content: d.content ?? d.message?.content ?? '' });
    } else if (e.type === 'assistant/message') {
      const msg = d.message ? JSON.parse(JSON.stringify(d.message)) : { role: 'assistant', content: d.content ?? '' };
      msg.role = 'assistant';
      messages.push(msg);
      if (d.usage && typeof d.usage.inputTokens === 'number') usages.push(d.usage);
    } else if (e.type === 'tool/call') {
      // tool calls are carried on assistant messages; skip duplicates
    } else if (e.type === 'tool/result') {
      const c = d.message?.content ?? d.content ?? '';
      messages.push({ role: 'tool', content: c });
    }
  }
  if (messages.length < 8) return null;
  return { messages, usages, firstTime, lastTime };
}

// ---------------------------------------------------------------- calibration
const sessions = listSessions();
const records = [];
let calChars = 0;
let calTokens = 0;
let skipped = 0;

for (const s of sessions) {
  const rec = reconstruct(s.file);
  if (!rec) { skipped += 1; continue; }
  const { messages, usages } = rec;

  // calibrate chars/token on assistant text vs reported output tokens
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const c = msgChars(m);
    if (c > 200) calChars += c;
  }
  for (const u of usages) {
    if (typeof u.outputTokens === 'number') calTokens += u.outputTokens;
  }

  records.push({ ...s, ...rec });
}

if (calChars > 0 && calTokens > 0) {
  // assistant text chars / output tokens; assistant text is the dominant calibrated quantity
  const ratio = calChars / calTokens;
  if (ratio > 2 && ratio < 8) CHARS_PER_TOKEN = ratio;
}

// ---------------------------------------------------------------- per-session curves
const curves = [];
for (const r of records) {
  const { messages } = r;
  const { turns } = partitionMessagesIntoTurns(messages);
  if (turns.length < 3) continue;

  const points = [];
  // walk prefixes at each completed turn boundary
  let cursor = 0;
  const turnSizes = turns.map((t) => t.length);
  const turnCharSizes = turns.map((t) => t.reduce((a, m) => a + msgChars(m), 0));

  // Build the two candidate surfaces for every prefix length, using the SAME turn list,
  // so the distilled surface of prefix i+1 is a strict prefix-extension of that of
  // prefix i. That property is what lets a server-side prefix cache actually hit.
  const rawHistTokens = [];   // raw history tokens for turns 1..i (excludes current)
  const distHistTokens = [];  // distilled history tokens for the same turns
  let accMsgs = [];
  for (let i = 0; i < turns.length; i += 1) {
    rawHistTokens.push(arrayTokens(accMsgs));
    distHistTokens.push(accMsgs.length
      ? arrayTokens(projectDistilledHistory(accMsgs, { isExpired: true }))
      : 0);
    accMsgs = accMsgs.concat(turns[i]);
  }

  for (let i = 0; i < turns.length; i += 1) {
    const turnTokens = tok(turnCharSizes[i]);
    points.push({
      turn: i + 1,
      rawTokens: rawHistTokens[i] + turnTokens,
      rawHistTokens: rawHistTokens[i],
      distHistTokens: distHistTokens[i],
      surplusTokens: Math.max(0, rawHistTokens[i] - distHistTokens[i]),
      turnTokens,
      turnMsgs: turnSizes[i],
    });
  }

  curves.push({
    sessionId: r.sessionId,
    project: r.project,
    turns: turns.length,
    steps: r.usages.length,
    durationMin: r.firstTime && r.lastTime ? +((r.lastTime - r.firstTime) / 60000).toFixed(1) : null,
    points,
  });
}

// ---------------------------------------------------------------- population stats
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}
function summarize(arr) {
  if (!arr.length) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    mean: +mean.toFixed(1),
    p10: pct(arr, 0.10), p25: pct(arr, 0.25), p50: pct(arr, 0.50),
    p75: pct(arr, 0.75), p90: pct(arr, 0.90), p95: pct(arr, 0.95), p99: pct(arr, 0.99),
    max: Math.max(...arr),
  };
}

const allTail = [];
const allRaw = [];
const allTurn = [];
const ratioAt = [];
const turnsPerSession = [];

for (const c of curves) {
  turnsPerSession.push(c.turns);
  for (const p of c.points) {
    allTail.push(p.surplusTokens);
    allRaw.push(p.rawTokens);
    allTurn.push(p.turnTokens);
    if (p.rawHistTokens > 0) ratioAt.push(p.distHistTokens / p.rawHistTokens);
  }
}

const summary = {
  calibration: {
    charsPerToken: +CHARS_PER_TOKEN.toFixed(3),
    sessionsScanned: sessions.length,
    sessionsUsable: curves.length,
    sessionsSkipped: skipped,
  },
  turnsPerSession: summarize(turnsPerSession),
  perTurnRawSurfaceTokens: summarize(allRaw),
  perTurnTailTokens: summarize(allTail),
  perTurnOwnTokens: summarize(allTurn),
  distillRatio: summarize(ratioAt),
};

const outDir = path.join(process.cwd(), 'paper', 'data', 'v24');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'expB-transcript-curves.json'), JSON.stringify({ summary, curves }, null, 2));
console.log(JSON.stringify(summary, null, 2));
