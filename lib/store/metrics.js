/**
 * dsh-oswyn/store/metrics — pure derivations from the ledger.
 *
 * Every metric is computed INDEPENDENTLY from the raw entry stream; an average
 * (avgSavingsRate) never stands in for a row/total. Counts, rates and token
 * totals are all first-class so the UI can show real numbers per row.
 *
 * Pure module: no node:fs. Consumes in-memory ledger objects from ./ledger.js.
 *
 * @module dsh-oswyn/store/metrics
 */

const CHARS_PER_TOKEN = 3.5;
const DISTILL_CHARS_PER_TOKEN = 2.9;

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/** Count compress-type modes (truncate/replace/discard) in a list. */
function isCompress(mode) {
  return mode === 'truncate' || mode === 'replace' || mode === 'discard';
}

/**
 * Per-entry accounting, recomputed from raw fields so an entry that was stored
 * before the truth-guard, or with a fake after, still books truthfully here.
 *
 * @param {object} e
 */
export function entryAccounting(e = {}) {
  const mode = e.mode || 'truncate';
  const before = Math.max(0, Number(e.before) || 0);
  const rawAfter = Math.max(0, Number(e.after) || 0);
  const compress = isCompress(mode);
  const compressed = rawAfter < before;
  const effectiveAfter = compress && rawAfter >= before ? before : rawAfter;
  const tokensSaved = compressed ? Math.round((before - effectiveAfter) / CHARS_PER_TOKEN) : 0;
  const extraSummaryTokens = Number.isFinite(e.extraSummaryTokens)
    ? e.extraSummaryTokens
    : Math.round((typeof e.summary === 'string' ? e.summary.length : 0) / CHARS_PER_TOKEN);
  const recallTokens = Number.isFinite(e.recallTokens)
    ? e.recallTokens
    : Math.round((Number(e.recallChars) || 0) / CHARS_PER_TOKEN);
  const net = tokensSaved - extraSummaryTokens - recallTokens;
  return { mode, before, after: effectiveAfter, compressed, tokensSaved, extraSummaryTokens, recallTokens, net };
}

/**
 * Compute metrics over a set of session ledgers.
 *
 * @param {Array<{sessionId:string,title?:string,updatedAt?:number,recallChars?:number,entries?:object[]}>} sessions
 * @param {{toolCalls?:number}} [opts] optional externally-known tool-call total for distillRate denominator
 * @returns {object}
 */
/** A session counts as "active" (its compressed rows still occupy a live context) when it was touched inside this window. */
export const ACTIVE_SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Pure: how many ascending seqs are >= from (binary search).
 * Mirrors store/requests.requestsAliveFrom so this module stays fs-free.
 */
function countSeqsFrom(seqs, from) {
  const value = Number(from);
  if (!Number.isFinite(value)) return 0;
  let lo = 0;
  let hi = seqs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (seqs[mid] < value) lo = mid + 1; else hi = mid;
  }
  return seqs.length - lo;
}

export function computeMetrics(sessions = [], opts = {}) {
  let totalActions = 0;
  let totalTruncations = 0;
  let totalReplacements = 0;
  let totalDiscards = 0;
  let totalReplySummaries = 0;
  let totalPruneCalls = 0;
  let totalTokensSaved = 0;
  let totalExtraSummaryTokens = 0;
  let totalRecallTokens = 0;
  let totalNetTokensSaved = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  let compressedRows = 0;
  let standingChars = 0; // sum of (before-after) over compressed rows = what stays saved EVERY turn
  // Multi-round accumulation: a compressed row stops entering context from its own
  // round onward, so it saves (before-after) on that round AND on every later round.
  let cumulativeTokensSaved = 0; // Σ row.tokensSaved × elapsed rounds for that row
  let multiTurnRows = 0;         // rows that have already lived through >1 round
  let elapsedRounds = 0;         // Σ rounds contributed (for the average)
  let legacyRows = 0;            // compressed rows with no round stamp (counted as 1 round)
  let requestBasedRows = 0;      // rows whose multiplier came from the host request log
  let totalRequests = 0;         // model round-trips observed across sessions
  // "Per round" only means something for sessions that are still alive: a session
  // closed last month is not saving anything on this turn. Track that separately.
  let activeStandingChars = 0;
  let activeSessions = 0;
  // Post-cache deep distillation (v2.4) is NOT a ledger row: it rewrites the whole
  // outgoing surface once, so its savings are booked per event (session.distill)
  // rather than per row. Aggregate it separately so the UI can show the deep track
  // next to the row-level track instead of hiding it inside the row average.
  let totalDistillEvents = 0;
  let distillRawTokens = 0;
  let distillDistTokens = 0;
  let distillTokensSaved = 0;
  let distillBeforeChars = 0;
  let distillAfterChars = 0;
  // Cumulative saving across every request the distilled surface served. This is the
  // honest "how much has the deep track been worth" number: the frontier only moves
  // R rounds at a time, but the saving repeats on every request in between.
  let distillCumulativeSaved = 0;
  let distillLastAt = 0;
  let distillSessions = 0;
  const distillReasons = { ttl: 0, volume: 0, rounds: 0, ceiling: 0, manual: 0 };
  const resolveRequestSeqs = typeof opts.resolveRequestSeqs === 'function' ? opts.resolveRequestSeqs : null;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const activeWindowMs = Number.isFinite(opts.activeWindowMs) ? opts.activeWindowMs : ACTIVE_SESSION_WINDOW_MS;

  for (const s of sessions) {
    const entries = Array.isArray(s.entries) ? s.entries : [];
    const rows = entries.map((e) => ({ e, a: entryAccounting(e) }));
    // per-session recall accumulator: the ledger's recallChars is the running total;
    // attribute it to a synthetic recall cost so totals stay multi-turn cumulative
    // even if individual entries did not stamp recallTokens.
    let entryRecallStamp = 0;
    // How many rounds has this session already lived through? Prefer the explicit
    // session round recorded on agent/pre-step; otherwise fall back to the highest
    // round stamped on any entry (still conservative: never invents future rounds).
    let maxEntryTurn = 0;
    for (const { e, a } of rows) {
      entryRecallStamp += a.recallTokens;
      if (!a.compressed) continue;
      const t = Number.isFinite(Number(e.turn)) ? Math.trunc(Number(e.turn)) : 0;
      if (t > maxEntryTurn) maxEntryTurn = t;
    }
    const sessionTurns = Math.max(
      Number.isFinite(Number(s.turns)) ? Math.trunc(Number(s.turns)) : 0,
      maxEntryTurn
    );
    // Exact multiplier: how many model requests this session actually made.
    // Supplied by the caller (host session log) or resolved lazily per session.
    let requestSeqs = Array.isArray(s.requestSeqs) ? s.requestSeqs : null;
    if (!requestSeqs && resolveRequestSeqs) {
      try { requestSeqs = resolveRequestSeqs(s.sessionId) || null; } catch (_) { requestSeqs = null; }
    }
    if (requestSeqs && requestSeqs.length) totalRequests += requestSeqs.length;
    const updatedAt = Number(s.updatedAt) || 0;
    const isActive = updatedAt > 0 && (now - updatedAt) <= activeWindowMs;
    if (isActive) activeSessions += 1;
    for (const { e, a } of rows) {
      totalActions += 1;
      if (a.mode === 'truncate') totalTruncations += 1;
      else if (a.mode === 'replace') totalReplacements += 1;
      else if (a.mode === 'discard') totalDiscards += 1;
      else if (a.mode === 'prune-call') totalPruneCalls += 1;
      else if (a.mode === 'reply') totalReplySummaries += 1;
      totalTokensSaved += a.tokensSaved;
      totalExtraSummaryTokens += a.extraSummaryTokens;
      if (a.compressed) {
        compressedRows += 1; totalBefore += a.before; totalAfter += a.after;
        standingChars += (a.before - a.after);
        if (isActive) activeStandingChars += (a.before - a.after);
        // Rounds this row has already stayed out of context: its own round + every
        // later one. Rows from before round-stamping existed count as 1 (one-shot),
        // so old ledgers can never be inflated.
        const t = Number.isFinite(Number(e.turn)) ? Math.trunc(Number(e.turn)) : 0;
        if (t <= 0) legacyRows += 1;
        // 1st choice: real model round-trips served (exact, from the host event log).
        // 2nd: elapsed agent turns. 3rd: 1 (never inflate what we cannot prove).
        let roundsAlive = 0;
        if (requestSeqs && requestSeqs.length) {
          const served = countSeqsFrom(requestSeqs, e.seq);
          if (served > 0) { roundsAlive = served; requestBasedRows += 1; }
        }
        if (!roundsAlive) roundsAlive = (t > 0 && sessionTurns >= t) ? (sessionTurns - t + 1) : 1;
        cumulativeTokensSaved += a.tokensSaved * roundsAlive;
        elapsedRounds += roundsAlive;
        if (roundsAlive > 1) multiTurnRows += 1;
      }
    }
    // recall is session-level cumulative; use ledger recallChars if it exceeds
    // what was already stamped on entries, to avoid double counting.
    const ledgerRecallTokens = Math.round((Number(s.recallChars) || 0) / CHARS_PER_TOKEN);
    totalRecallTokens += Math.max(ledgerRecallTokens, entryRecallStamp);
    // ── post-cache deep distillation (session-level, not a row) ──────────────
    const d = s.distill;
    if (d && typeof d === 'object' && Number(d.events) > 0) {
      distillSessions += 1;
      totalDistillEvents += Math.trunc(Number(d.events) || 0);
      distillRawTokens += Number(d.rawTokens) || 0;
      distillDistTokens += Number(d.distTokens) || 0;
      distillTokensSaved += Number(d.surplusTokens) || 0;
      if (Number(d.lastAt) > distillLastAt) distillLastAt = Number(d.lastAt);
      const dr = d.reasons && typeof d.reasons === 'object' ? d.reasons : {};
      for (const key of Object.keys(distillReasons)) {
        distillReasons[key] += Math.trunc(Number(dr[key]) || 0);
      }

      // Per-request round-trip accumulation for turn-level distillation:
      // each distilled turn stays out of context on EVERY subsequent model request.
      const turnEntries = d.turns && typeof d.turns === 'object'
        ? Object.entries(d.turns).filter(([k, td]) => Number.isFinite(Number(k)) && Number(k) > 0 && td && typeof td === 'object')
        : [];
      if (turnEntries.length > 0) {
        let sessionDistillCum = 0;
        for (const [k, td] of turnEntries) {
          const round = Math.trunc(Number(k));
          const tdSurplus = Math.max(0, Number(td.surplusTokens) || 0);
          const tdRaw = Math.max(0, Number(td.rawTokens) || 0);
          const tdDist = Math.max(0, Number(td.distTokens) || 0);
          if (tdRaw > tdDist) {
            distillBeforeChars += Math.round(tdRaw * DISTILL_CHARS_PER_TOKEN);
            distillAfterChars += Math.round(tdDist * DISTILL_CHARS_PER_TOKEN);
          }
          let served = 0;
          if (requestSeqs && requestSeqs.length && td.seq !== null && td.seq !== undefined && Number.isFinite(Number(td.seq))) {
            served = countSeqsFrom(requestSeqs, td.seq);
          }
          if (!served) {
            served = (sessionTurns >= round) ? (sessionTurns - round + 1) : 1;
          }
          sessionDistillCum += tdSurplus * Math.max(1, served);
        }
        distillCumulativeSaved += Math.max(Number(d.cumulativeSaved) || 0, Math.round(sessionDistillCum));
      } else {
        const rawC = Number(d.rawChars) > 0 ? Number(d.rawChars) : Math.round((Number(d.rawTokens) || 0) * DISTILL_CHARS_PER_TOKEN);
        const distC = Number(d.distChars) > 0 ? Number(d.distChars) : Math.round((Number(d.distTokens) || 0) * DISTILL_CHARS_PER_TOKEN);
        if (rawC > distC) {
          distillBeforeChars += rawC;
          distillAfterChars += distC;
        }
        let served = 0;
        if (requestSeqs && requestSeqs.length && d.lastSeq !== null && d.lastSeq !== undefined && Number.isFinite(Number(d.lastSeq))) {
          served = countSeqsFrom(requestSeqs, d.lastSeq);
        }
        if (!served && Number.isFinite(Number(d.lastTurn)) && sessionTurns >= Number(d.lastTurn)) {
          served = sessionTurns - Math.trunc(Number(d.lastTurn)) + 1;
        }
        const computed = (Number(d.surplusTokens) || 0) * Math.max(1, served);
        distillCumulativeSaved += Math.max(Number(d.cumulativeSaved) || 0, Math.round(computed));
      }
    }
  }

  totalNetTokensSaved = totalTokensSaved - totalExtraSummaryTokens - totalRecallTokens;

  // Cumulative (multi-round) view: savings keep accruing every round a compressed
  // block stays out of context. Costs (summary + recall) are one-shot, so they are
  // subtracted once — the net therefore grows with the round count, which is exactly
  // what "累计节省" should mean.
  cumulativeTokensSaved = Math.round(cumulativeTokensSaved);
  const cumulativeNetTokensSaved = cumulativeTokensSaved - totalExtraSummaryTokens - totalRecallTokens;
  const avgRoundsPerRow = compressedRows > 0 ? round1(elapsedRounds / compressedRows) : 0;
  // Standing savings: the compressed bytes stay out of context on EVERY subsequent
  // turn. This is the amount re-saved each turn thereafter (accumulated across all
  // compressions in the session(s)).
  // STOCK: every byte ever compressed away, summed over all sessions (incl. finished
  // ones). This is NOT "savings per round" — see activeStandingTokensSaved for that.
  const standingTokensSaved = Math.round(standingChars / CHARS_PER_TOKEN);
  const activeStandingTokensSaved = Math.round(activeStandingChars / CHARS_PER_TOKEN);

  // Distill rate = share of tool calls that were distilled. Denominator prefers
  // an explicit tool-call count (recorded elsewhere); else uses action count as a
  // conservative floor so the rate is never a divide-by-zero.
  const toolCalls = Number.isFinite(opts.toolCalls) && opts.toolCalls > 0
    ? opts.toolCalls
    : Math.max(totalActions, 0);
  const distilled = totalTruncations + totalReplacements + totalDiscards;
  const distillRate = toolCalls > 0 ? round1(Math.min(100, (distilled / toolCalls) * 100)) : 0;

  // Prefix-cache protection = truncations (head preserved byte-for-byte) / actions.
  const cacheHitProtectionRate = totalActions > 0 ? round1((totalTruncations / totalActions) * 100) : 0;

  // Average savings rate = combined byte reduction across BOTH step-level rows
  // and turn-level deep distillation (reduces to step-only when no deep distill ran).
  const rowAvgSavingsRate = totalBefore > 0 ? round1(((totalBefore - totalAfter) / totalBefore) * 100) : 0;
  const combinedBefore = totalBefore + distillBeforeChars;
  const combinedAfter = totalAfter + distillAfterChars;
  const avgSavingsRate = combinedBefore > 0 ? round1(((combinedBefore - combinedAfter) / combinedBefore) * 100) : 0;

  // ── post-cache deep distillation roll-up ────────────────────────────────
  // Reported on its own axis: it is a surface reset, not a row rewrite, so folding
  // it into avgSavingsRate would silently mix two different denominators.
  const distillSavingsRate = distillRawTokens > 0
    ? round1(((distillRawTokens - distillDistTokens) / distillRawTokens) * 100)
    : 0;
  const distillAvgSurplusTokens = totalDistillEvents > 0
    ? Math.round(distillTokensSaved / totalDistillEvents)
    : 0;
  const distillActive = distillLastAt > 0 && (now - distillLastAt) <= activeWindowMs;

  return {
    totalSessions: sessions.length,
    totalActions,
    totalTruncations,
    totalReplacements,
    totalDiscards,
    totalReplySummaries,
    totalPruneCalls,
    totalToolCalls: toolCalls,
    distilledActions: distilled,
    distillRate,
    cacheHitProtectionRate,
    compressedRows,
    totalTokensSaved,
    totalExtraSummaryTokens,
    totalRecallTokens,
    totalNetTokensSaved,
    standingTokensSaved,
    activeStandingTokensSaved,
    archivedStandingTokensSaved: Math.max(0, standingTokensSaved - activeStandingTokensSaved),
    activeSessions,
    activeWindowMs,
    legacyRows,
    requestBasedRows,
    totalRequests,
    cumulativeTokensSaved,
    cumulativeNetTokensSaved,
    multiTurnRows,
    avgRoundsPerRow,
    rowAvgSavingsRate,
    avgSavingsRate,
    // Deep (post-cache) distillation track — see store/ledger.recordDistill.
    totalDistillEvents,
    distillSessions,
    distillRawTokens,
    distillDistTokens,
    distillTokensSaved,
    distillCumulativeSaved,
    distillSavingsRate,
    distillAvgSurplusTokens,
    distillReasons,
    distillLastAt,
    distillActive
  };
}

/** Convenience: metrics for a single session ledger. */
export function computeSessionMetrics(session, opts = {}) {
  return computeMetrics(session ? [session] : [], opts);
}

/**
 * Metrics for a single raw entry (used by routes/commands to show per-row truth).
 * @param {object} e
 */
export function entryMetrics(e) {
  const a = entryAccounting(e);
  const savingsRate = a.before > 0 ? round1(((a.before - a.after) / a.before) * 100) : 0;
  return { ...a, savingsRate };
}
