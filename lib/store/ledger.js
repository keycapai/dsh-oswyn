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

function emptySession(sessionId) {
  return {
    sessionId,
    title: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recallChars: 0,
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
