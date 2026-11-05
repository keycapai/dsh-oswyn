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

  for (const s of sessions) {
    const entries = Array.isArray(s.entries) ? s.entries : [];
    // per-session recall accumulator: the ledger's recallChars is the running total;
    // attribute it to a synthetic recall cost so totals stay multi-turn cumulative
    // even if individual entries did not stamp recallTokens.
    let entryRecallStamp = 0;
    for (const e of entries) {
      const a = entryAccounting(e);
      totalActions += 1;
      if (a.mode === 'truncate') totalTruncations += 1;
      else if (a.mode === 'replace') totalReplacements += 1;
      else if (a.mode === 'discard') totalDiscards += 1;
      else if (a.mode === 'prune-call') totalPruneCalls += 1;
      else if (a.mode === 'reply') totalReplySummaries += 1;
      totalTokensSaved += a.tokensSaved;
      totalExtraSummaryTokens += a.extraSummaryTokens;
      entryRecallStamp += a.recallTokens;
      if (a.compressed) { compressedRows += 1; totalBefore += a.before; totalAfter += a.after; standingChars += (a.before - a.after); }
    }
    // recall is session-level cumulative; use ledger recallChars if it exceeds
    // what was already stamped on entries, to avoid double counting.
    const ledgerRecallTokens = Math.round((Number(s.recallChars) || 0) / CHARS_PER_TOKEN);
    totalRecallTokens += Math.max(ledgerRecallTokens, entryRecallStamp);
  }

  totalNetTokensSaved = totalTokensSaved - totalExtraSummaryTokens - totalRecallTokens;
  // Standing savings: the compressed bytes stay out of context on EVERY subsequent
  // turn. This is the amount re-saved each turn thereafter (accumulated across all
  // compressions in the session(s)).
  const standingTokensSaved = Math.round(standingChars / CHARS_PER_TOKEN);

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

  // Average savings rate = aggregate byte reduction over rows that really shrank.
  const avgSavingsRate = totalBefore > 0 ? round1(((totalBefore - totalAfter) / totalBefore) * 100) : 0;

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
    avgSavingsRate
  };
}

/** Convenience: metrics for a single session ledger. */
export function computeSessionMetrics(session) {
  return computeMetrics(session ? [session] : []);
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
