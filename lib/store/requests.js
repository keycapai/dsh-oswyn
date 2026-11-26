/**
 * dsh-oswyn/store/requests — how many model round-trips a compressed row has served.
 *
 * WHY THIS FILE EXISTS
 *   A compressed block stops entering the context from its own step onward, so it
 *   saves (before-after) tokens on EVERY subsequent model request — not once, and
 *   not once per human turn. A 110-step session therefore re-saves a 2K row about
 *   110 times. Without this multiplier the dashboard reports a number that is
 *   ~2 orders of magnitude too small.
 *
 * SOURCE OF TRUTH
 *   The host's own session event log (one 'step/start' event per model request):
 *     ~/.dsh/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd
 *   We only read it, never write. Anything unreadable degrades to 'no data' so the
 *   caller can fall back to a conservative multiplier — never a fabricated one.
 *
 * @module dsh-oswyn/store/requests
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const LOG_FILE = 'session.v4.jsonl.zstd';
const MAX_LOG_BYTES = 512 * 1024 * 1024;

/** In-memory cache: sessionId -> { key, seqs, turnMarks, toolCalls } */
const seqCache = new Map();
/** In-memory cache: sessionId -> absolute log path ('' = known-missing) */
const pathCache = new Map();

function homeBase() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
}

function sessionRoots() {
  if (process.env.DSH_OSWYN_SESSIONS_ROOT) {
    return [resolve(process.env.DSH_OSWYN_SESSIONS_ROOT)];
  }
  const base = homeBase();
  const roots = [join(base, 'sessions')];
  const profilesDir = join(base, 'profiles');
  try {
    if (existsSync(profilesDir)) {
      for (const prof of readdirSync(profilesDir)) {
        roots.push(join(profilesDir, prof, 'sessions'));
      }
    }
  } catch (_) {}
  return roots;
}

export function isRequestLogEnabled() {
  return process.env.DSH_OSWYN_SESSION_LOG !== '0';
}

/**
 * Locate the host event log for one session. Workspace directory names are
 * derived from the cwd, so we scan one level and match the session folder.
 * @param {string} sessionId
 * @returns {string|null}
 */
export function sessionLogPath(sessionId) {
  if (!sessionId) return null;
  if (pathCache.has(sessionId)) return pathCache.get(sessionId) || null;
  let found = '';
  try {
    for (const root of sessionRoots()) {
      if (!existsSync(root)) continue;
      for (const ws of readdirSync(root)) {
        const candidate = join(root, ws, sessionId, LOG_FILE);
        if (existsSync(candidate)) { found = candidate; break; }
      }
      if (found) break;
    }
  } catch (_) {}
  // Only cache hits. A miss must be retried: the live session's event log is
  // commonly written after this plugin starts (and after the warm-up pass).
  if (found) pathCache.set(sessionId, found);
  return found || null;
}

function decompress(buf) {
  // Node >= 22.15 ships zstd; fall back to the CLI, then give up quietly.
  const zstd = zlib.zstdDecompressSync || zlib.zstdDecompress;
  if (typeof zstd === 'function') {
    try { return zstd(buf).toString('utf8'); } catch (_) {}
  }
  return null;
}

/**
 * Sorted seq numbers of every model request ('step/start') in a session.
 * @param {string} sessionId
 * @returns {number[]} ascending; empty when unavailable
 */
export function readRequestSeqs(sessionId) {
  if (!isRequestLogEnabled()) return [];
  const file = sessionLogPath(sessionId);
  if (!file) return [];
  let stat;
  try { stat = statSync(file); } catch (_) { return []; }
  const key = String(stat.mtimeMs) + ':' + String(stat.size);
  const hit = seqCache.get(sessionId);
  if (hit && hit.key === key) return hit.seqs;
  if (stat.size > MAX_LOG_BYTES) return [];
  let text = null;
  try { text = decompress(readFileSync(file)); } catch (_) {}
  if (text === null) {
    try {
      text = execFileSync('zstd', ['-dc', file], { maxBuffer: MAX_LOG_BYTES }).toString('utf8');
    } catch (_) { text = null; }
  }
  if (text === null) return [];
  const seqs = [];
  const assistantSeqs = [];
  const turnMarks = [];
  const compactionEndSeqs = {};
  let toolCalls = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let ev = null;
    if (
      line.indexOf('"step/start"') >= 0 ||
      line.indexOf('"turn/start"') >= 0 ||
      line.indexOf('"assistant/message"') >= 0 ||
      line.indexOf('"tool/result"') >= 0 ||
      line.indexOf('"oswyn-compaction"') >= 0
    ) {
      try { ev = JSON.parse(line); } catch (_) {}
    }
    if (!ev) continue;
    if (ev.type === 'step/start' && Number.isInteger(ev.seq)) seqs.push(ev.seq);
    else if (ev.type === 'assistant/message' && !ev.ignorable && Number.isInteger(ev.seq)) assistantSeqs.push(ev.seq);
    else if (ev.type === 'turn/start' && Number.isInteger(ev.seq) && Number.isFinite(Number(ev.data?.turn))) {
      turnMarks.push({ seq: ev.seq, turn: Number(ev.data.turn) });
    } else if (ev.type === 'tool/result') {
      toolCalls += 1;
    } else if (
      ev.type === 'user/message'
      && ev.data?.source?.kind === 'oswyn-compaction'
      && Number.isInteger(ev.seq)
      && Number.isInteger(ev.surfaceOp?.endSeq)
    ) {
      compactionEndSeqs[ev.seq] = ev.surfaceOp.endSeq;
    }
  }
  const effectiveSeqs = seqs.length > 0 ? seqs : assistantSeqs;
  effectiveSeqs.sort((a, b) => a - b);
  turnMarks.sort((a, b) => a.seq - b.seq);
  seqCache.set(sessionId, { key, seqs: effectiveSeqs, turnMarks, compactionEndSeqs, toolCalls });
  return effectiveSeqs;
}

/**
 * Total completed tool/result events observed in a session log (0 when unavailable).
 * @param {string} sessionId
 * @returns {number}
 */
export function readToolCallCount(sessionId) {
  if (!isRequestLogEnabled()) return 0;
  const cached = seqCache.get(sessionId);
  if (cached && Number.isFinite(cached.toolCalls)) return cached.toolCalls;
  readRequestSeqs(sessionId);
  const after = seqCache.get(sessionId);
  return after && Number.isFinite(after.toolCalls) ? after.toolCalls : 0;
}

/**
 * How many model requests at or after 'seq' did this row serve?
 * A request at exactly the compression seq already carries the reduced context.
 * @param {number[]} seqs ascending request seqs
 * @param {number} seq row compression seq
 * @returns {number} 0 when nothing is known
 */
export function requestsAliveFrom(seqs, seq) {
  if (!Array.isArray(seqs) || seqs.length === 0) return 0;
  const from = Number(seq);
  if (!Number.isFinite(from)) return 0;
  let lo = 0;
  let hi = seqs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seqs[mid] < from) lo = mid + 1; else hi = mid;
  }
  return seqs.length - lo;
}

/**
 * Pre-warm the cache in the background so the first dashboard open is not blocked
 * by decompressing every session log. Chunked + unref'd: never delays shutdown.
 * @param {string[]} sessionIds
 * @param {{chunk?:number, delayMs?:number}} [opts]
 */
export function warmRequestCache(sessionIds = [], opts = {}) {
  if (!isRequestLogEnabled() || !Array.isArray(sessionIds) || sessionIds.length === 0) return;
  const chunk = Math.max(1, Number(opts.chunk) || 3);
  const delayMs = Math.max(10, Number(opts.delayMs) || 80);
  let index = 0;
  const step = () => {
    const end = Math.min(sessionIds.length, index + chunk);
    for (; index < end; index++) {
      try { readRequestSeqs(sessionIds[index]); } catch (_) {}
    }
    if (index < sessionIds.length) {
      const timer = setTimeout(step, delayMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  };
  const first = setTimeout(step, delayMs);
  if (first && typeof first.unref === 'function') first.unref();
}

/**
 * Turn boundaries from the host event log: one 'turn/start' event per human round.
 * @param {string} sessionId
 * @returns {{seq:number, turn:number}[]} ascending by seq
 */
export function readTurnMarks(sessionId) {
  if (!isRequestLogEnabled()) return [];
  const file = sessionLogPath(sessionId);
  if (!file) return [];
  const cached = seqCache.get(sessionId);
  if (cached && Array.isArray(cached.turnMarks)) return cached.turnMarks;
  // readRequestSeqs() populates both caches from the same decompressed log.
  readRequestSeqs(sessionId);
  const after = seqCache.get(sessionId);
  return after && Array.isArray(after.turnMarks) ? after.turnMarks : [];
}

/**
 * Map of `oswyn-compaction` checkpoint seq -> its replaced range `endSeq`.
 * Used to resolve the true DSH turn of historical turn-distill entries.
 * @param {string} sessionId
 * @returns {Record<number, number>}
 */
export function readCompactionEndSeqs(sessionId) {
  if (!isRequestLogEnabled()) return {};
  const file = sessionLogPath(sessionId);
  if (!file) return {};
  const cached = seqCache.get(sessionId);
  if (cached && cached.compactionEndSeqs && typeof cached.compactionEndSeqs === 'object') {
    return cached.compactionEndSeqs;
  }
  readRequestSeqs(sessionId);
  const after = seqCache.get(sessionId);
  return (after && after.compactionEndSeqs && typeof after.compactionEndSeqs === 'object')
    ? after.compactionEndSeqs
    : {};
}

/** Last turn whose start seq is <= the given row seq (0 = unknown). */
export function turnForSeq(marks, seq) {
  if (!Array.isArray(marks) || marks.length === 0) return 0;
  const target = Number(seq);
  if (!Number.isFinite(target)) return 0;
  let found = 0;
  for (let i = 0; i < marks.length; i++) {
    if (Number(marks[i].seq) <= target) found = Number(marks[i].turn) || found;
    else break;
  }
  return found;
}

export function clearRequestCache() {
  seqCache.clear();
  pathCache.clear();
}
