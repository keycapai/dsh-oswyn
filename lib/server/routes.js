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
import { getCallInputChars, getToolName } from '../session/surface.js';
import { computeMetrics, computeSessionMetrics, entryMetrics } from '../store/metrics.js';

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
    replySummaryEnabled: config.replySummaryEnabled !== false,
    hideReplySummaryInUi: config.hideReplySummaryInUi !== false,
    nudgeEnabled: config.nudgeEnabled !== false,
    nudgeThresholdChars: config.nudgeThresholdChars ?? 1000,
    nudgeThresholdLines: config.nudgeThresholdLines ?? 25,
    nudgeErrorThresholdChars: config.nudgeErrorThresholdChars ?? 400,
    nudgeErrorThresholdLines: config.nudgeErrorThresholdLines ?? 12,
    autoCompress: config.autoCompress === true,
    autoCompressTiered: config.autoCompressTiered !== false,
    autoCompressPtcSubcalls: config.autoCompressPtcSubcalls !== false,
    autoDiscardFailed: config.autoDiscardFailed !== false,
    autoDiscardTools: Array.isArray(config.autoDiscardTools) ? config.autoDiscardTools : [...CONFIG_DEFAULTS.autoDiscardTools],
    autoCompressTieredProtectedTools: Array.isArray(config.autoCompressTieredProtectedTools) ? config.autoCompressTieredProtectedTools : [...CONFIG_DEFAULTS.autoCompressTieredProtectedTools],
    autoCompressMinChars: config.autoCompressMinChars ?? 4000,
    autoCompressKeepLines: config.autoCompressKeepLines ?? 30,
    badgeEnabled: config.badgeEnabled !== false
  };
}

/** Enrich a session's entries with per-row accounting before sending. */
function enrichSession(s, liveSession = null) {
  const rawEntries = (s.entries || []).map((e) => {
    if (!e) return e;
    let out = e;
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
  const metrics = computeSessionMetrics(enrichedRaw);
  const history = rawEntries.map((e) => ({ ...e, ...entryMetrics(e) }));
  return {
    sessionId: s.sessionId,
    title: s.title || s.sessionId,
    updatedAt: s.updatedAt,
    recallChars: s.recallChars || 0,
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
      for (const s of live) if (s.id) liveById.set(s.id, s);
      const sessions = rawSessions.map((s) => enrichSession(s, liveById.get(s.sessionId) || null));
      let toolCalls;
      try {
        for (const s of sessions) {
          const liveSession = liveById.get(s.sessionId);
          if (liveSession) {
            s.title = liveSession.title || liveSession.header?.title || s.title;
            s.liveTools = collectLiveTools(liveSession);
          }
        }
        for (const s of live) {
          if (!s.id || sessions.some((row) => row.sessionId === s.id)) continue;
          sessions.push({
            sessionId: s.id,
            title: s.title || s.header?.title || s.id,
            updatedAt: Date.now(),
            recallChars: 0,
            history: [],
            liveTools: collectLiveTools(s),
            ...computeSessionMetrics({ sessionId: s.id, entries: [] })
          });
        }
        for (const s of sessions) {
          const liveSession = liveById.get(s.sessionId);
          if (liveSession) s.title = liveSession.title || liveSession.header?.title || s.title;
        }
      } catch (_) {}
      const globalStats = computeMetrics(sessions.map((s) => ({ ...s, entries: s.history || [] })), { toolCalls });
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
      sendJson(res, 200, { ok: true, session: enrichSession(loadSession(sessionId)) });
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
