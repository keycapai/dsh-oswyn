/**
 * dsh-oswyn/store/ledger — per-session audit ledger (source of truth for metrics).
 *
 * Persists one append-only event log per session under
 *   ~/.dsh/storages/oswyn/sessions/<id>.json   (atomic write via temp+rename)
 * and an append-only recall side-ledger so that recall cost accumulates across
 * turns without rewriting heavy history.
 *
 * THE ACCOUNTING MODEL (why this file exists):
 *   A compression action both SAVES and SPENDS.
 *     - tokensSaved   : input tokens removed from context = round((before-after)/3.5)
 *     - extraSummaryTokens : tokens SPENT producing the summary text = round(summaryLen/3.5)
 *     - recallTokens  : tokens SPENT re-injecting originals later via tool_result_recall
 *                       = round(recallChars/3.5), accumulated per session across turns
 *     - net           : tokensSaved - extraSummaryTokens - recallTokens
 *
 * TRUTH GUARD: a compress-mode event that did not actually shrink the content
 * (after >= before) is booked compressed:false, tokensSaved:0 — never a fake win.
 *
 * Pure-ish module: only does file IO in this file. Never imports core/session.
 *
 * @module dsh-oswyn/store/ledger
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_ENTRIES = 300;
const CHARS_PER_TOKEN = 3.5;

function storageRoot() {
  if (process.env.DSH_OSWYN_STORAGE_DIR) {
    const dir = resolve(process.env.DSH_OSWYN_STORAGE_DIR);
    ensureDir(join(dir, 'sessions'));
    return dir;
  }
  const base = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
  const dir = join(base, 'storages', 'oswyn');
  const legacy = join(base, 'storages', 'context-distill');
  if (!existsSync(dir) && existsSync(legacy)) {
    try { renameSync(legacy, dir); } catch (_) {}
  }
  ensureDir(join(dir, 'sessions'));
  return dir;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function sessionsDir() {
  return join(storageRoot(), 'sessions');
}

export function sessionFile(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(sessionsDir(), safe + '.json');
}

function isTestFile(name) {
  return name.startsWith('test_') || name.startsWith('test-');
}

function atomicWriteJson(filePath, data) {
  const temp = filePath + '.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, filePath);
    return true;
  } catch (err) {
    console.error('[dsh-oswyn] ledger atomic write failed:', err.message);
    try { if (existsSync(temp)) renameSync(temp, filePath); } catch (_) {}
    return false;
  }
}

/**
 * Per-session record of POST-CACHE DEEP DISTILLATION (v2.4).
 *
 * A distillation is not a ledger row: it rewrites the outgoing request surface
 * instead of rewriting one stored tool result, so it has no before/after row of
 * its own. It still has to be visible, so it is booked here as a session-level
 * counter block: how many times the surface was reset, and how many tokens each
 * reset removed.
 */
function emptyDistill() {
  return {
    events: 0,
    rawChars: 0,
    distChars: 0,
    rawTokens: 0,
    distTokens: 0,
    surplusTokens: 0,
    reasons: { ttl: 0, volume: 0, rounds: 0, ceiling: 0, manual: 0 },
    // Cumulative tokens avoided across every request since the first distill.
    cumulativeSaved: 0,
    lastAt: 0,
    lastTurn: null,
    turns: {},
    // Why the LAST dispatch did or did not fire. Without this the mechanism is
    // unfalsifiable from the outside: an armed-but-blocked trigger and a trigger
    // that never armed look identical (both simply produce no event).
    lastEval: null
  };
}

function normalizeLastEval(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const sig = raw.signals && typeof raw.signals === 'object' ? raw.signals : {};
  return {
    at: num(raw.at),
    distill: raw.distill === true,
    reason: raw.reason ? String(raw.reason) : null,
    armed: raw.armed === true,
    floorBlocked: raw.floorBlocked === true,
    surplusTokens: num(raw.surplusTokens),
    rawTokens: num(raw.rawTokens),
    compressedTokens: num(raw.compressedTokens),
    uncompressedTokens: num(raw.uncompressedTokens),
    systemTokens: num(raw.systemTokens),
    messageCount: num(raw.messageCount),
    userTurns: num(raw.userTurns),
    claimedCount: num(raw.claimedCount),
    roundsSinceDistill: num(raw.roundsSinceDistill),
    signals: {
      manual: sig.manual === true,
      ttl: sig.ttl === true,
      volume: sig.volume === true,
      rounds: sig.rounds === true,
      ceiling: sig.ceiling === true
    }
  };
}

function normalizeDistillTurns(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const r = Math.trunc(Number(k));
    if (!Number.isFinite(r) || r <= 0 || !v || typeof v !== 'object') continue;
    out[String(r)] = {
      reason: v.reason ? String(v.reason) : '',
      rawTokens: num(v.rawTokens),
      distTokens: num(v.distTokens),
      surplusTokens: num(v.surplusTokens),
      at: num(v.at)
    };
  }
  return out;
}

function normalizeDistill(raw) {
  const base = emptyDistill();
  if (!raw || typeof raw !== 'object') return base;
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const reasons = raw.reasons && typeof raw.reasons === 'object' ? raw.reasons : {};
  return {
    events: Math.trunc(num(raw.events)),
    rawChars: num(raw.rawChars),
    distChars: num(raw.distChars),
    rawTokens: num(raw.rawTokens),
    distTokens: num(raw.distTokens),
    surplusTokens: num(raw.surplusTokens),
    cumulativeSaved: num(raw.cumulativeSaved),
    reasons: {
      ttl: Math.trunc(num(reasons.ttl)),
      volume: Math.trunc(num(reasons.volume)),
      rounds: Math.trunc(num(reasons.rounds)),
      ceiling: Math.trunc(num(reasons.ceiling)),
      manual: Math.trunc(num(reasons.manual))
    },
    lastAt: num(raw.lastAt),
    lastTurn: Number.isFinite(Number(raw.lastTurn)) ? Math.trunc(Number(raw.lastTurn)) : null,
    turns: normalizeDistillTurns(raw.turns),
    lastEval: normalizeLastEval(raw.lastEval)
  };
}

function emptySession(sessionId) {
  return {
    sessionId,
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recallChars: 0,
    turns: 0,
    distill: emptyDistill(),
    entries: []
  };
}

/**
 * Resolve the authentic session title from DSH's projection cache.
 * Never throws.
 * @param {string} sessionId
 * @returns {string|null}
 */
export function resolveSessionTitle(sessionId) {
  try {
    const base = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
    const proj = join(base, 'storages', 'session_projcache', 'sessions', sessionId + '.json');
    if (!existsSync(proj)) return null;
    const data = JSON.parse(readFileSync(proj, 'utf8'));
    const title = data?.record?.rows?.title?.val;
    if (typeof title === 'string' && title.trim()) return title.trim();
  } catch (_) {}
  return null;
}

/**
 * Load one session ledger. Always returns a well-formed object.
 * @param {string} sessionId
 */
export function loadSession(sessionId) {
  const file = sessionFile(sessionId);
  if (!existsSync(file)) return emptySession(sessionId);
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return emptySession(sessionId);
    return {
      sessionId: data.sessionId || sessionId,
      title: data.title || resolveSessionTitle(sessionId) || '',
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now(),
      recallChars: Number.isFinite(data.recallChars) ? data.recallChars : 0,
      // Highest agent-turn seen for this session (see recordSessionTurn).
      turns: Number.isFinite(data.turns) ? data.turns : 0,
      // Post-cache deep distillation counters (v2.4). Absent on older ledgers.
      distill: normalizeDistill(data.distill),
      entries: Array.isArray(data.entries) ? data.entries : []
    };
  } catch (_) {
    return emptySession(sessionId);
  }
}

/**
 * Pure: derive the book-keeping fields of one entry. Exposed for testing.
 *
 * @param {object} e
 * @returns {object} the normalized entry (id/ts filled when absent are left to caller)
 */
export function deriveEntry(e = {}) {
  const mode = e.mode || 'truncate';
  const inputChars = Math.max(0, Math.trunc(Number(e.inputChars) || 0));
  const before = Math.max(0, Number(e.before) || 0);
  const rawAfter = Math.max(0, Number(e.after) || 0);
  const summaryLen = typeof e.summary === 'string' ? e.summary.length : (Number(e.summaryLen) || 0);
  const recallChars = Math.max(0, Number(e.recallChars) || 0);

  const compressMode = mode === 'truncate' || mode === 'replace' || mode === 'discard';
  const compressed = compressMode ? rawAfter < before : rawAfter < before;
  const effectiveAfter = compressMode && rawAfter >= before ? before : rawAfter;

  const tokensSaved = compressed ? Math.round((before - effectiveAfter) / CHARS_PER_TOKEN) : 0;
  // "Extra output" = the whole summary/replacement block the model had to carry
  // (issue: count the entire multi-output code block, not just summary length).
  const keepChars = Math.max(0, Number(e.keepChars) || 0);
  const extraChars = mode === 'truncate'
    ? Math.max(0, effectiveAfter - keepChars)
    : (mode === 'prune-call' ? 0 : (summaryLen > 0 ? summaryLen : effectiveAfter));
  const extraSummaryTokens = Math.round(extraChars / CHARS_PER_TOKEN);
  const recallTokens = Math.round(recallChars / CHARS_PER_TOKEN);
  const net = tokensSaved - extraSummaryTokens - recallTokens;

  return {
    id: e.id,
    ts: e.ts,
    seq: e.seq === undefined ? null : e.seq,
    // Round (agent turn) in which this compression happened. Needed because a
    // compressed block keeps saving tokens on EVERY later round, so cumulative
    // savings are per-row tokens × elapsed rounds — not a one-shot sum.
    // `Number(null)` and `Number('')` are both 0 and both pass `isFinite`, so a row
    // written without a turn used to come back as `turn: 0` — an orphan round the
    // client then skipped, silently hiding its savings. Absence must stay absent.
    turn: (e.turn === null || e.turn === undefined || e.turn === '')
      ? null
      : (Number.isFinite(Number(e.turn)) ? Math.max(0, Math.trunc(Number(e.turn))) : null),
    mode,
    toolName: e.toolName || '',
    callId: e.callId || '',
    before,
    inputChars: inputChars > 0 ? inputChars : null,
    after: effectiveAfter,
    keepChars: keepChars > 0 ? keepChars : null,
    keepLines: e.keepLines === undefined ? null : e.keepLines,
    fact: e.fact ? String(e.fact).slice(0, 2000) : '',
    summary: typeof e.summary === 'string' ? e.summary.slice(0, 4000) : '',
    compressed,
    tokensSaved,
    extraSummaryTokens,
    recallTokens,
    net,
    trigger: e.mode === 'reply' ? 'agent' : (e.trigger || 'autonomous')
  };
}

/**
 * Append one ledger event (a compression action) and persist atomically.
 *
 * @param {string} sessionId
 * @param {object} event  {seq,mode,toolName,callId,before,after,keepChars,keepLines,fact,summary,trigger}
 * @returns {object|null} the normalized entry, or null on failure
 */
export function appendEvent(sessionId, event = {}) {
  if (!sessionId) return null;
  try {
    const session = loadSession(sessionId);
    const ts = Date.now();
    const derived = deriveEntry({
      ...event,
      id: event.id || (String(event.seq ?? 'step') + '_' + ts + '_' + Math.random().toString(36).slice(2, 6)),
      ts
    });
    if (event.summaryLen !== undefined && !event.summary) derived.summary = '';
    // Override extraSummaryTokens from explicit summaryLen only when positive or in reply mode
    if (event.summaryLen !== undefined && (Number(event.summaryLen) > 0 || derived.mode === 'reply')) {
      derived.extraSummaryTokens = Math.round((Number(event.summaryLen) || 0) / CHARS_PER_TOKEN);
      derived.net = derived.tokensSaved - derived.extraSummaryTokens - derived.recallTokens;
    }
    if (!session.title) session.title = resolveSessionTitle(sessionId) || event.sessionTitle || '';
    session.updatedAt = ts;
    session.entries.push(derived);
    if (session.entries.length > MAX_ENTRIES) {
      session.entries.splice(0, session.entries.length - MAX_ENTRIES);
    }
    atomicWriteJson(sessionFile(sessionId), session);
    return derived;
  } catch (err) {
    console.error('[dsh-oswyn] appendEvent failed:', err.message);
    return null;
  }
}

/**
 * Remember the highest agent-turn seen for a session. Metrics use it as the
 * session's current round when computing how many rounds each compressed row
 * has already been saving tokens. Only writes when the round advances, so the
 * cost is one small atomic write per round (not per step).
 *
 * @param {string} sessionId
 * @param {number} turn 1-based agent turn
 * @returns {number} highest round known after this call (0 on failure)
 */
export function recordSessionTurn(sessionId, turn) {
  if (!sessionId) return 0;
  const next = Math.max(0, Math.trunc(Number(turn) || 0));
  if (!next) return 0;
  try {
    const session = loadSession(sessionId);
    const prev = Math.max(0, Math.trunc(Number(session.turns) || 0));
    if (next <= prev) return prev;
    session.turns = next;
    session.updatedAt = Date.now();
    atomicWriteJson(sessionFile(sessionId), session);
    return next;
  } catch (err) {
    console.error('[dsh-oswyn] recordSessionTurn failed:', err.message);
    return 0;
  }
}

/**
 * Record recall cost for a session (accumulated across turns). Called by
 * tool_result_recall.execute whenever it re-injects original content.
 *
 * @param {string} sessionId
 * @param {number} chars  number of characters re-injected
 * @returns {number} cumulative recall chars after this call (0 on failure)
 */
export function recordRecall(sessionId, chars) {
  if (!sessionId) return 0;
  const delta = Math.max(0, Math.trunc(Number(chars) || 0));
  try {
    const session = loadSession(sessionId);
    session.recallChars = (session.recallChars || 0) + delta;
    session.updatedAt = Date.now();
    atomicWriteJson(sessionFile(sessionId), session);
    return session.recallChars;
  } catch (err) {
    console.error('[dsh-oswyn] recordRecall failed:', err.message);
    return 0;
  }
}

/**
 * Record one post-cache deep distillation (v2.4) for a session.
 *
 * Called once per executed surface reset. Distillation replaces the whole
 * historical surface, so its saving is a single delta per event, not a per-row
 * before/after: raw - dist is what that reset removed from the outgoing request.
 * Counters accumulate across the session so the UI can show how much the deep
 * track contributed on top of the per-row ledger.
 *
 * @param {string} sessionId
 * @param {{rawChars?:number, distChars?:number, rawTokens?:number, distTokens?:number, surplusTokens?:number, reason?:string, turn?:number}} info
 * @returns {object} the accumulated distill block after this call
 */
export function recordDistill(sessionId, info = {}) {
  if (!sessionId) return emptyDistill();
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const rawChars = num(info.rawChars);
  const distChars = num(info.distChars);
  const surplusTokens = num(info.surplusTokens);
  // A reset that removed nothing is not worth a write (and must not inflate counts).
  // Return the block as it stands so callers never mistake "ignored" for "reset to 0".
  if (surplusTokens <= 0 && distChars >= rawChars) {
    try { return normalizeDistill(loadSession(sessionId).distill); } catch (_) { return emptyDistill(); }
  }
  try {
    const session = loadSession(sessionId);
    const prev = normalizeDistill(session.distill);
    const reason = String(info.reason || '');
    // A steady-state request repeats the same saving without moving the frontier.
    // It must NOT increment `events` (that would report one compression per request)
    // but it DOES belong in cumulativeSaved.
    const countEvent = info.countEvent !== false;
    const next = {
      events: prev.events + (countEvent ? 1 : 0),
      // Surface fields describe the MOST RECENT request, not a running sum: the UI
      // shows them as "this is what one request now costs / saves". The running sum
      // lives in cumulativeSaved, so the two are never the same number.
      rawChars: rawChars,
      distChars: distChars,
      rawTokens: num(info.rawTokens) || Math.round(rawChars / CHARS_PER_TOKEN),
      distTokens: num(info.distTokens) || Math.round(distChars / CHARS_PER_TOKEN),
      surplusTokens: surplusTokens,
      cumulativeSaved: prev.cumulativeSaved + surplusTokens,
      reasons: { ...prev.reasons },
      lastAt: Date.now(),
      lastTurn: Number.isFinite(Number(info.turn)) ? Math.trunc(Number(info.turn)) : prev.lastTurn,
      turns: { ...(prev.turns || {}) },
      lastEval: prev.lastEval
    };
    if (Array.isArray(info.turnDetails)) {
      for (const td of info.turnDetails) {
        const r = Math.trunc(Number(td && td.round));
        if (!Number.isFinite(r) || r <= 0) continue;
        next.turns[String(r)] = {
          reason: String((td && td.reason) || reason || ''),
          rawTokens: num(td && td.rawTokens),
          distTokens: num(td && td.distTokens),
          surplusTokens: num(td && td.surplusTokens),
          at: next.lastAt
        };
      }
    }
    // reasons only tracks the four arming signals; 'advance' is not one of them,
    // so a frontier advance without an arming signal leaves the tally untouched.
    if (reason && Object.prototype.hasOwnProperty.call(next.reasons, reason)) {
      next.reasons[reason] += 1;
    }
    session.distill = next;
    session.updatedAt = next.lastAt;
    atomicWriteJson(sessionFile(sessionId), session);
    return next;
  } catch (err) {
    console.error('[dsh-oswyn] recordDistill failed:', err.message);
    return emptyDistill();
  }
}

/**
 * Persist the trigger decision of the latest dispatch (fired or not).
 *
 * This is the answer to "did the deep track even consider compressing?" — without
 * it, a blocked trigger and a never-armed trigger are indistinguishable from the UI,
 * because neither produces a ledger row.
 *
 * @param {string} sessionId
 * @param {{distill:boolean, reason?:string|null, armed?:boolean, floorBlocked?:boolean, surplusTokens?:number, rawTokens?:number, roundsSinceDistill?:number, signals?:object}} evalInfo
 */
export function recordDistillEval(sessionId, evalInfo = {}) {
  if (!sessionId) return null;
  try {
    const session = loadSession(sessionId);
    const prev = normalizeDistill(session.distill);
    session.distill = {
      ...prev,
      lastEval: normalizeLastEval({
        at: Date.now(),
        distill: evalInfo.distill === true,
        reason: evalInfo.reason ?? null,
        armed: evalInfo.armed === true,
        floorBlocked: evalInfo.floorBlocked === true,
        surplusTokens: evalInfo.surplusTokens,
        rawTokens: evalInfo.rawTokens,
        compressedTokens: evalInfo.compressedTokens,
        uncompressedTokens: evalInfo.uncompressedTokens,
        systemTokens: evalInfo.systemTokens,
        roundsSinceDistill: evalInfo.roundsSinceDistill,
        signals: evalInfo.signals
      })
    };
    session.updatedAt = Date.now();
    atomicWriteJson(sessionFile(sessionId), session);
    return session.distill.lastEval;
  } catch (err) {
    console.error('[dsh-oswyn] recordDistillEval failed:', err.message);
    return null;
  }
}

/**
 * Load every non-test session ledger.
 * @returns {object[]}
 */
export function loadAllSessions() {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !isTestFile(f));
    const out = [];
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (data && data.sessionId) {
          out.push({
            sessionId: data.sessionId,
            title: data.title || resolveSessionTitle(data.sessionId) || '',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0,
            recallChars: Number.isFinite(data.recallChars) ? data.recallChars : 0,
            // Must survive here too: global metrics read rounds via loadAllSessions.
            turns: Number.isFinite(data.turns) ? data.turns : 0,
            distill: normalizeDistill(data.distill),
            entries: Array.isArray(data.entries) ? data.entries : []
          });
        }
      } catch (_) {}
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  } catch (_) {
    return [];
  }
}

export const LEDGER_MAX_ENTRIES = MAX_ENTRIES;
export const TOKENS_PER_CHAR = 1 / CHARS_PER_TOKEN;

// ── Auto-compress protection list (agent-configurable at runtime) ──────────
// A small persistent allowlist of tool names that autoCompressTiered must never
// touch. It is merged with the static config default by the plugin.
const PROTECTED_TOOLS_FILE = 'protected-tools.json';

export function loadProtectedTools() {
  try {
    const file = join(storageRoot(), PROTECTED_TOOLS_FILE);
    if (!existsSync(file)) return [];
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(data) ? data : (Array.isArray(data?.tools) ? data.tools : []);
    return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  } catch (_) {
    return [];
  }
}

/**
 * Add (or remove) one tool name in the runtime protected list.
 * @param {string} toolName
 * @param {boolean} shouldProtect
 * @returns {string[]} updated list
 */
export function addProtectedTool(toolName, shouldProtect = true) {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return loadProtectedTools();
  const current = new Set(loadProtectedTools());
  if (shouldProtect) current.add(name); else current.delete(name);
  const list = [...current].sort();
  try {
    atomicWriteJson(join(storageRoot(), PROTECTED_TOOLS_FILE), { tools: list });
  } catch (_) {}
  return list;
}

export function removeProtectedTool(toolName) {
  return addProtectedTool(toolName, false);
}
