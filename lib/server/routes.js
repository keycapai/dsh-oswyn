/**
 * dsh-oswyn/server/routes — thin HTTP API over the ledger + metrics.
 *
 * Exposes /api/oswyn/status and /api/oswyn/session, with /api/context-distill/*
 * backward-compatible aliases. Every handler degrades gracefully (500 json, never throw).
 *
 * @module dsh-oswyn/server/routes
 */

import { loadAllSessions, loadSession } from '../store/ledger.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { parseMeta } from '../core/markers.js';
import { getCallInputChars, getToolName, collectSurfaceMessages } from '../session/surface.js';
import { measureSurfaceBreakdown } from '../core/distill-projection.js';
import { computeMetrics, computeSessionMetrics, entryMetrics } from '../store/metrics.js';
import { readRequestSeqs, readToolCallCount, readTurnMarks, readCompactionEndSeqs, turnForSeq } from '../store/requests.js';

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body, 'utf8')
  });
  res.end(body);
}

function configView(config = {}) {
  return {
    enabled: config.enabled !== false,
    autoApply: config.autoApply !== false,
    replySummaryEnabled: config.replySummaryEnabled !== false,
    hideReplySummaryInUi: config.hideReplySummaryInUi !== false,
    nudgeEnabled: config.nudgeEnabled !== false,
    nudgeThresholdChars: config.nudgeThresholdChars ?? CONFIG_DEFAULTS.nudgeThresholdChars,
    nudgeThresholdLines: config.nudgeThresholdLines ?? CONFIG_DEFAULTS.nudgeThresholdLines,
    nudgeErrorThresholdChars: config.nudgeErrorThresholdChars ?? CONFIG_DEFAULTS.nudgeErrorThresholdChars,
    nudgeErrorThresholdLines: config.nudgeErrorThresholdLines ?? CONFIG_DEFAULTS.nudgeErrorThresholdLines,
    adaptiveNudgeEnabled: config.adaptiveNudgeEnabled !== false,
    uncompressedStepThreshold: config.uncompressedStepThreshold ?? CONFIG_DEFAULTS.uncompressedStepThreshold,
    accumulatedPayloadThreshold: config.accumulatedPayloadThreshold ?? CONFIG_DEFAULTS.accumulatedPayloadThreshold,
    cooldownSteps: config.cooldownSteps ?? CONFIG_DEFAULTS.cooldownSteps,
    minChars: config.minChars ?? CONFIG_DEFAULTS.minChars,
    coldStartSteps: config.coldStartSteps ?? CONFIG_DEFAULTS.coldStartSteps,
    deepHorizonTurns: config.deepHorizonTurns ?? CONFIG_DEFAULTS.deepHorizonTurns,
    verbose: config.verbose === true,
    badgeEnabled: config.badgeEnabled !== false,
    contextRatioBadge: config.contextRatioBadge !== false,
    contextRatioDetail: config.contextRatioDetail !== false,
    perTurnStats: config.perTurnStats !== false,
    deepTurnBadge: config.deepTurnBadge !== false,
    autoCompress: config.autoCompress === true,
    autoCompressTiered: config.autoCompressTiered !== false,
    autoCompressPtcSubcalls: config.autoCompressPtcSubcalls !== false,
    autoDiscardFailed: config.autoDiscardFailed !== false,
    autoDiscardTools: Array.isArray(config.autoDiscardTools) ? config.autoDiscardTools : [...CONFIG_DEFAULTS.autoDiscardTools],
    autoCompressTieredProtectedTools: Array.isArray(config.autoCompressTieredProtectedTools) ? config.autoCompressTieredProtectedTools : [...CONFIG_DEFAULTS.autoCompressTieredProtectedTools],
    autoCompressMinChars: config.autoCompressMinChars ?? CONFIG_DEFAULTS.autoCompressMinChars,
    autoCompressKeepLines: config.autoCompressKeepLines ?? CONFIG_DEFAULTS.autoCompressKeepLines,
    foldReplySummary: config.foldReplySummary !== false,
    // v2.4 multi-signal distillation. Exposed so the settings panel shows the values
    // actually in force instead of guessing defaults (the panel used to render an
    // unchecked coalesce switch while the runtime default was true).
    cacheTtlHours: config.cacheTtlHours ?? CONFIG_DEFAULTS.cacheTtlHours,
    cacheTtlSeconds: config.cacheTtlSeconds ?? CONFIG_DEFAULTS.cacheTtlSeconds,
    postCacheDistillEnabled: config.postCacheDistillEnabled !== false,
    distillStripThinking: config.distillStripThinking !== false,
    distillStripToolCalls: config.distillStripToolCalls !== false,
    triggerTtlEnabled: config.triggerTtlEnabled !== false,
    triggerVolumeEnabled: config.triggerVolumeEnabled !== false,
    triggerRoundsEnabled: config.triggerRoundsEnabled !== false,
    triggerVolumeTokens: config.triggerVolumeTokens ?? CONFIG_DEFAULTS.triggerVolumeTokens,
    triggerRounds: config.triggerRounds ?? CONFIG_DEFAULTS.triggerRounds,
    triggerCeilingTokens: config.triggerCeilingTokens ?? CONFIG_DEFAULTS.triggerCeilingTokens,
    triggerMinSurplusTokens: config.triggerMinSurplusTokens ?? CONFIG_DEFAULTS.triggerMinSurplusTokens
  };
}

/** Extract step request seqs, turn boundaries, compaction ranges, and total tool calls from an in-memory live session. */
function extractLiveSessionFacts(liveSession) {
  const stepSeqs = [];
  const assistantSeqs = [];
  const turnMarks = [];
  const compactionEndSeqs = {};
  let toolCallCount = 0;
  if (!liveSession || typeof liveSession.snapshotEvents !== 'function') {
    return { requestSeqs: [], turnMarks: [], compactionEndSeqs, toolCallCount: 0 };
  }
  try {
    const events = liveSession.snapshotEvents() || [];
    for (const ev of events) {
      if (!ev || !Number.isInteger(ev.seq)) continue;
      if (ev.type === 'step/start') stepSeqs.push(ev.seq);
      else if (ev.type === 'assistant/message' && !ev.ignorable) assistantSeqs.push(ev.seq);
      else if (ev.type === 'turn/start' && Number.isFinite(Number(ev.data?.turn))) {
        turnMarks.push({ seq: ev.seq, turn: Number(ev.data.turn) });
      } else if (ev.type === 'tool/result') {
        toolCallCount += 1;
      } else if (
        ev.type === 'user/message'
        && ev.data?.source?.kind === 'oswyn-compaction'
        && Number.isInteger(ev.surfaceOp?.endSeq)
      ) {
        compactionEndSeqs[ev.seq] = ev.surfaceOp.endSeq;
      }
    }
    const requestSeqs = stepSeqs.length > 0 ? stepSeqs : assistantSeqs;
    requestSeqs.sort((a, b) => a - b);
    turnMarks.sort((a, b) => a.seq - b.seq);
    return { requestSeqs, turnMarks, compactionEndSeqs, toolCallCount };
  } catch (_) {
    return { requestSeqs: [], turnMarks: [], compactionEndSeqs, toolCallCount: 0 };
  }
}

/**
 * Remap legacy `distill.turns` keys (which used 1-based organic user turn ordinals)
 * to true DSH turn numbers using each checkpoint's replaced `surfaceOp.endSeq`.
 */
function remapDistillTurns(distill, marks, compactionEndSeqs) {
  if (!distill || typeof distill !== 'object' || !distill.turns || typeof distill.turns !== 'object') return distill;
  if (!Array.isArray(marks) || marks.length === 0) return distill;
  const endSeqMap = compactionEndSeqs && typeof compactionEndSeqs === 'object' ? compactionEndSeqs : {};
  const remapped = {};
  let changed = false;
  for (const [k, td] of Object.entries(distill.turns)) {
    if (!td || typeof td !== 'object') continue;
    let targetKey = k;
    const tdSeq = Number.isInteger(Number(td.seq)) ? Number(td.seq) : null;
    const endSeq = tdSeq !== null ? endSeqMap[tdSeq] : undefined;
    if (Number.isInteger(endSeq)) {
      const dshTurn = turnForSeq(marks, endSeq);
      if (dshTurn > 0) {
        targetKey = String(dshTurn);
        if (targetKey !== k) changed = true;
      }
    }
    const prev = remapped[targetKey];
    if (!prev || (Number(td.at) || 0) >= (Number(prev.at) || 0)) {
      remapped[targetKey] = td;
    }
  }
  return changed ? { ...distill, turns: remapped } : distill;
}

function mergeRequestSeqs(sessionId, liveSeqs) {
  const diskSeqs = readRequestSeqs(sessionId);
  if (!liveSeqs || liveSeqs.length === 0) return diskSeqs;
  if (!diskSeqs || diskSeqs.length === 0) return liveSeqs;
  if (liveSeqs.length >= diskSeqs.length) return liveSeqs;
  const set = new Set(diskSeqs);
  for (const s of liveSeqs) set.add(s);
  return [...set].sort((a, b) => a - b);
}

function computeSurfaceBreakdown(liveSession, distill) {
  if (liveSession) {
    try {
      const pairs = collectSurfaceMessages(liveSession);
      if (pairs.length > 0) return measureSurfaceBreakdown(pairs);
    } catch (_) {}
  }
  const le = distill && distill.lastEval;
  if (le && (Number(le.compressedTokens) > 0 || Number(le.uncompressedTokens) > 0)) {
    const compressedTokens = Math.max(0, Number(le.compressedTokens) || 0);
    const uncompressedTokens = Math.max(0, Number(le.uncompressedTokens) || 0);
    const systemTokens = Math.max(0, Number(le.systemTokens) || 0);
    return {
      totalTokens: compressedTokens + uncompressedTokens,
      compressedTokens,
      uncompressedTokens,
      systemTokens,
      distilledTurnsTokens: Math.max(0, compressedTokens - systemTokens)
    };
  }
  return null;
}

/** Enrich a session's entries with per-row accounting before sending. */
function enrichSession(s, liveSession = null, liveFacts = null) {
  const facts = liveFacts || extractLiveSessionFacts(liveSession);
  const marks = facts.turnMarks.length > 0 ? facts.turnMarks : readTurnMarks(s.sessionId);
  const compactionEndSeqs = (facts.compactionEndSeqs && Object.keys(facts.compactionEndSeqs).length > 0)
    ? facts.compactionEndSeqs
    : readCompactionEndSeqs(s.sessionId);
  const rawEntries = (s.entries || []).map((e) => {
    if (!e) return e;
    let out = e;
    if ((!Number.isFinite(Number(out.turn)) || Number(out.turn) <= 0) && marks.length > 0) {
      const derivedTurn = turnForSeq(marks, out.seq);
      if (derivedTurn > 0) out = { ...out, turn: derivedTurn };
    }
    if (liveSession && !out.callId && Number.isInteger(out.seq) && out.mode !== 'reply') {
      try {
        const ev = typeof liveSession.eventAt === 'function' ? liveSession.eventAt(out.seq) : null;
        let cid = ev?.data?.message?.source?.callId || ev?.data?.message?.toolCallId || ev?.data?.callId || '';
        if (!cid && ev && Array.isArray(ev.sourceEventSeqs)) {
          for (const srcSeq of ev.sourceEventSeqs) {
            const srcEv = typeof liveSession.eventAt === 'function' ? liveSession.eventAt(srcSeq) : null;
            if (srcEv?.type === 'tool/call' && (srcEv.data?.callId || srcEv.data?.id)) {
              cid = String(srcEv.data.callId || srcEv.data.id);
              break;
            }
          }
        }
        if (cid) out = { ...out, callId: String(cid) };
      } catch (_) {}
    }
    if (liveSession && out.mode === 'discard' && !out.inputChars && out.callId) {
      const inputChars = getCallInputChars(liveSession, null, out.callId);
      if (inputChars > 0) {
        const origEv = Number.isInteger(out.seq) && typeof liveSession.eventAt === 'function' ? liveSession.eventAt(out.seq) : null;
        const origLen = origEv ? eventText(origEv).length : out.before;
        if (out.before <= origLen) {
          out = { ...out, before: origLen + inputChars, inputChars };
        }
      }
    }
    return out;
  });
  const enrichedRaw = { ...s, entries: rawEntries };
  const mergedSeqs = mergeRequestSeqs(s.sessionId, facts.requestSeqs);
  const diskToolCalls = readToolCallCount(s.sessionId);
  const sessionToolCalls = Math.max(facts.toolCallCount || 0, diskToolCalls || 0);
  const metrics = computeSessionMetrics(enrichedRaw, {
    resolveRequestSeqs: (id) => (id === s.sessionId ? mergedSeqs : readRequestSeqs(id)),
    toolCalls: sessionToolCalls > 0 ? sessionToolCalls : undefined
  });
  const history = rawEntries.map((e) => ({ ...e, ...entryMetrics(e) }));
  return {
    sessionId: s.sessionId,
    title: s.title || s.sessionId,
    updatedAt: s.updatedAt,
    recallChars: s.recallChars || 0,
    // Session-level deep distillation counters (v2.4). Passed through so the client
    // can show the deep track even when the session has no per-row ledger entries.
    distill: remapDistillTurns(s.distill || null, marks, compactionEndSeqs),
    surfaceBreakdown: computeSurfaceBreakdown(liveSession, s.distill),
    ...metrics,
    history
  };
}

function eventText(event) {
  const blocks = event?.data?.message?.content ?? event?.data?.content ?? [];
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** Snapshot every tool result/subcall size visible in one live session (bounded). */
export function collectLiveTools(session) {
  const out = [];
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
    for (const ev of events) {
      if (out.length >= 600) break;
      if (ev.type === 'tool/result') {
        const text = eventText(ev);
        const meta = parseMeta(text);
        const callId = ev.data?.message?.source?.callId || ev.data?.message?.toolCallId || ev.data?.callId || '';
        let before = meta?.before ?? text.length;
        let after = meta?.after ?? text.length;
        let inputChars = 0;
        if (meta && meta.mode === 'discard') {
          if (meta.after === 160 && text.length !== 160) after = text.length;
          inputChars = getCallInputChars(session, ev, callId);
          if (inputChars > 0) {
            const origSeq = meta.seq !== null && /^\d+$/.test(String(meta.seq)) ? Number(meta.seq) : null;
            const origEv = origSeq !== null && typeof session?.eventAt === 'function' ? session.eventAt(origSeq) : null;
            const origLen = origEv ? eventText(origEv).length : before;
            if (before <= origLen) before = origLen + inputChars;
          }
        }
        out.push({
          seq: ev.seq,
          callId,
          toolName: getToolName(session, ev) || '',
          turn: ev.data?.turn ?? null,
          step: ev.data?.step ?? null,
          chars: text.length,
          before,
          after,
          inputChars,
          compressed: Boolean(meta && after < before),
          isError: Boolean(ev.data?.message?.isError || ev.data?.message?.source?.isError)
        });
      } else if (ev.type === 'tool/ptc-dispatch') {
        const text = eventText(ev);
        out.push({
          seq: ev.seq,
          callId: ev.data?.subCallId || '',
          toolName: ev.data?.name || '',
          turn: ev.data?.turn ?? null,
          step: ev.data?.step ?? null,
          chars: text.length,
          before: text.length,
          after: text.length,
          compressed: false,
          isError: ev.data?.isError === true
        });
      }
    }
  } catch (_) {}
  return out;
}

export function registerWebRoutes(ctx, config = {}) {
  const ws = ctx.webServer ?? ctx.get?.('webServer');
  if (!ws || typeof ws.register !== 'function') return () => {};

  const unregisters = [];

  const handleStatus = async (req, res) => {
    try {
      const rawSessions = loadAllSessions();
      const live = ctx.sessions?.list?.() || [];
      const liveById = new Map();
      const liveFactsById = new Map();
      for (const s of live) {
        if (!s.id) continue;
        liveById.set(s.id, s);
        liveFactsById.set(s.id, extractLiveSessionFacts(s));
      }
      const sessions = rawSessions.map((s) => enrichSession(s, liveById.get(s.sessionId) || null, liveFactsById.get(s.sessionId) || null));
      let toolCalls = 0;
      try {
        for (const s of sessions) {
          const liveSession = liveById.get(s.sessionId);
          if (liveSession) {
            s.title = liveSession.title || liveSession.header?.title || s.title;
            s.liveTools = collectLiveTools(liveSession);
          }
          if (Number.isFinite(s.totalToolCalls) && s.totalToolCalls > 0) {
            toolCalls += s.totalToolCalls;
          }
        }
        for (const s of live) {
          if (!s.id || sessions.some((row) => row.sessionId === s.id)) continue;
          const facts = liveFactsById.get(s.id) || { requestSeqs: [], turnMarks: [], toolCallCount: 0 };
          const mergedSeqs = mergeRequestSeqs(s.id, facts.requestSeqs);
          const sessionToolCalls = Math.max(facts.toolCallCount || 0, readToolCallCount(s.id) || 0);
          if (sessionToolCalls > 0) toolCalls += sessionToolCalls;
          // A live session with no ledger file can still have deep-distill counters
          // (recordDistill writes the ledger itself), so read them instead of
          // reporting "never distilled".
          const liveLedger = loadSession(s.id);
          const liveMarks = facts.turnMarks.length > 0 ? facts.turnMarks : readTurnMarks(s.id);
          const liveEndSeqs = (facts.compactionEndSeqs && Object.keys(facts.compactionEndSeqs).length > 0)
            ? facts.compactionEndSeqs
            : readCompactionEndSeqs(s.id);
          sessions.push({
            sessionId: s.id,
            title: s.title || s.header?.title || s.id,
            updatedAt: Date.now(),
            recallChars: liveLedger.recallChars || 0,
            distill: remapDistillTurns(liveLedger.distill || null, liveMarks, liveEndSeqs),
            surfaceBreakdown: computeSurfaceBreakdown(s, liveLedger.distill),
            history: [],
            liveTools: collectLiveTools(s),
            ...computeSessionMetrics({ sessionId: s.id, entries: [], distill: liveLedger.distill }, {
              resolveRequestSeqs: (id) => (id === s.id ? mergedSeqs : readRequestSeqs(id)),
              toolCalls: sessionToolCalls > 0 ? sessionToolCalls : undefined
            })
          });
        }
        for (const s of sessions) {
          const liveSession = liveById.get(s.sessionId);
          if (liveSession) s.title = liveSession.title || liveSession.header?.title || s.title;
        }
      } catch (_) {}
      const globalStats = computeMetrics(sessions.map((s) => ({ ...s, entries: s.history || [] })), {
        toolCalls: toolCalls > 0 ? toolCalls : undefined,
        // Every compressed row re-saves its bytes on each later model request; the
        // host event log (plus live in-memory session events) is the source for that multiplier.
        resolveRequestSeqs: (id) => mergeRequestSeqs(id, liveFactsById.get(id)?.requestSeqs || [])
      });
      sendJson(res, 200, {
        ok: true,
        enabled: config.enabled !== false,
        config: configView(config),
        globalStats,
        sessions
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  };

  const handleSession = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const sessionId = url.searchParams.get('id');
      if (!sessionId) return sendJson(res, 400, { ok: false, error: 'Missing session id' });
      const live = ctx.sessions?.list?.() || [];
      const liveSession = live.find((s) => s && s.id === sessionId) || null;
      sendJson(res, 200, { ok: true, session: enrichSession(loadSession(sessionId), liveSession) });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
  };

  unregisters.push(ws.register({ kind: 'exact', path: '/api/oswyn/status', handler: handleStatus }));
  unregisters.push(ws.register({ kind: 'prefix', path: '/api/oswyn/session', handler: handleSession }));
  unregisters.push(ws.register({ kind: 'exact', path: '/api/context-distill/status', handler: handleStatus }));
  unregisters.push(ws.register({ kind: 'prefix', path: '/api/context-distill/session', handler: handleSession }));

  return () => {
    for (const off of unregisters) { try { off?.(); } catch (_) {} }
  };
}
