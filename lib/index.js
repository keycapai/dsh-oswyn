/**
 * DSH-OSWYN (Only See What You Need) — plugin assembly.
 *
 * Thin composition root. All capability lives in focused modules:
 *   - config.js / format.js                        (config schema, formatting)
 *   - core/{parse,plan,markers,projection,primitives}.js (pure core & atomic primitives)
 *   - modes/{truncate,replace,discard,protect,reply-summary}.js (per-mode strategies)
 *   - presets/{standard,ptc,index}.js              (preset-specific orchestration)
 *   - prompts/{base,preset-standard,preset-ptc,nudge,index}.js (prompts & smart nudges)
 *   - session/{surface,applier,ptc,auto-policy,retain}.js (kernel surface & facades)
 *   - store/{ledger,metrics}.js                    (audit ledger + metrics)
 *   - server/{routes,commands}.js                  (web API + slash commands)
 *   - tools/{recall,stats,protect}.js              (tool_result_recall, oswyn_stats, oswyn_protect_tool)
 *   - client/{shared,settings-panel,fence-fold,tool-badges,state}.js -> client.js
 *
 * @module dsh-oswyn
 */
import { Config, CONFIG_DEFAULTS, liveConfig } from './config.js';
import {
  PROTOCOL_SECTION,
  protocolText,
  SUMMARY_OPEN_TAG,
  REPLY_SUMMARY_OPEN_TAG,
  collectNudgeCandidates,
  buildNudgePromptText
} from './prompts/index.js';
import { buildAdaptiveNudgeNotice } from './prompts/nudge.js';
import { WillingnessTracker } from './session/willingness-tracker.js';
import { pruneToolCallArgs, projectDistilledHistory, discardToolCallArgs, isOrganicUserMessage, isBackgroundJobStatusMessage } from './core/projection.js';
import { measureSurfaces, evaluateTrigger, ensureTriggerState, estimateTokens } from './core/triggers.js';
import { oswynDistillProjection, OSWYN_DISTILL_EVENT, buildTurnDistillCheckpoints, measureSurfaceBreakdown, partitionSurfacePairsIntoTurns, isTurnIncompleteOrAwaitingAnswer, isTurnTriggeredByBackgroundJob } from './core/distill-projection.js';
import {
  alreadyProcessed,
  isCallArgDiscarded
} from './core/primitives.js';
import {
  applyFromAssistantMessage,
  resolveSessionPreset,
  runAllAutoPolicies
} from './presets/index.js';
import { getToolName, recordSessionActivity, isCacheExpired, collectSurfaceMessages, appendCheckpointReplace } from './session/surface.js';
import { matchesToolName } from './session/auto-policy.js';
import { appendEvent, loadProtectedTools, loadAllSessions, recordSessionTurn, recordDistill, recordDistillEval } from './store/ledger.js';
import { warmRequestCache, turnForSeq } from './store/requests.js';
import { registerWebRoutes } from './server/routes.js';
import { registerCommands } from './server/commands.js';
import { registerRecallTool } from './tools/recall.js';
import { registerHistoryRecallTool } from './tools/history-recall.js';
import { registerStatsTool } from './tools/stats.js';
import { registerProtectTool } from './tools/protect.js';

export const name = 'oswyn';
export const inject = ['tools', 'commands', 'systemPrompt', 'sessions'];
export { Config, PROTOCOL_SECTION, WillingnessTracker, registerRecallTool, registerHistoryRecallTool };

const sessionTrackers = new Map();
const weakTrackers = new WeakMap();

export function getSessionTracker(session, resolved = {}) {
  const trackerOptions = {
    uncompressedStepThreshold: resolved.uncompressedStepThreshold,
    accumulatedPayloadThreshold: resolved.accumulatedPayloadThreshold,
    cooldownSteps: resolved.cooldownSteps,
    minChars: resolved.minChars ?? resolved.nudgeThresholdChars ?? 600,
    coldStartSteps: resolved.coldStartSteps ?? 2,
    deepHorizonTurns: resolved.deepHorizonTurns ?? 8
  };

  if (!session) return new WillingnessTracker(trackerOptions);

  if (typeof session === 'object' && session !== null) {
    if (session.id) {
      if (!sessionTrackers.has(session.id)) {
        sessionTrackers.set(session.id, new WillingnessTracker(trackerOptions));
      }
      const tracker = sessionTrackers.get(session.id);
      tracker.updateOptions(trackerOptions);
      return tracker;
    }
    if (!weakTrackers.has(session)) {
      weakTrackers.set(session, new WillingnessTracker(trackerOptions));
    }
    const tracker = weakTrackers.get(session);
    tracker.updateOptions(trackerOptions);
    return tracker;
  }

  if (typeof session === 'string') {
    if (!sessionTrackers.has(session)) {
      sessionTrackers.set(session, new WillingnessTracker(trackerOptions));
    }
    const tracker = sessionTrackers.get(session);
    tracker.updateOptions(trackerOptions);
    return tracker;
  }

  return new WillingnessTracker(trackerOptions);
}

/**
 * Retrieve the active context messages for the session, preferring the kernel
 * active surface projection via session.deriveMessages(), with fallback to
 * session.messages or outgoing pre-step messages.
 */
export function getContextMessages(session, fallbackMessages = []) {
  const fallback = Array.isArray(fallbackMessages) ? fallbackMessages : [];
  const mergeOrPrefer = (base) => {
    if (fallback.length === 0) return base;
    const looksFullHistory = fallback.length >= base.length
      || (fallback[0]?.role && base[0]?.role && fallback[0].role === base[0].role
        && (fallback[0].role === 'system' || fallback[0].role === 'user'));
    return looksFullHistory ? fallback : [...base, ...fallback];
  };
  if (session && typeof session.deriveMessages === 'function') {
    try {
      const derived = session.deriveMessages();
      if (Array.isArray(derived) && derived.length > 0) {
        return mergeOrPrefer(derived);
      }
    } catch (_) {}
  }
  if (session && Array.isArray(session.messages) && session.messages.length > 0) {
    return mergeOrPrefer(session.messages);
  }
  return fallback;
}

/**
 * Count the surface-replacement events currently recorded on a session.
 * Used as a ground-truth signal for "did a compression actually land?" — the
 * `applied` array returned by the fence applier is empty whenever the fence was
 * already consumed by the pre-step path, so it cannot distinguish a real
 * compression from a rejected one.
 */
function surfaceReplaceCount(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : (Array.isArray(session?.log) ? session.log : null);
    if (!Array.isArray(events)) return 0;
    let count = 0;
    for (const ev of events) {
      if (ev && ev.surfaceOp && ev.surfaceOp.op === 'replace') count++;
    }
    return count;
  } catch (_) {
    return 0;
  }
}

/** Diagnostic: append a line to /tmp/oswyn-diag.log (best-effort, never throws). */
function diag(line) {
  try {
    // eslint-disable-next-line no-undef
    const fs = (globalThis.process && globalThis.process.getBuiltinModule)
      ? globalThis.process.getBuiltinModule('node:fs') : null;
    if (fs) fs.appendFileSync('/tmp/oswyn-diag.log', new Date().toISOString() + ' ' + line + '\n');
  } catch { /* ignore */ }
}

/** Read the last assistant/message from a session snapshot. */
function lastAssistantMessage(session) {
  if (typeof session?.snapshotEvents === 'function') {
    const all = session.snapshotEvents();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const ev = all[i];
      if (ev.type === 'assistant/message') return { message: ev.data?.message, seq: ev.seq };
    }
    return null;
  }
  try {
    const msg = [...session.deriveMessages()].reverse().find((m) => m.role === 'assistant');
    return msg ? { message: msg, seq: undefined } : null;
  } catch {
    return null;
  }
}

/**
 * Tool results from the immediately preceding step (after the prior assistant/user
 * boundary and before the latest assistant message) that the model has now seen once.
 */
export function seenToolResults(session) {
  if (typeof session?.snapshotEvents !== 'function') return [];
  const all = session.snapshotEvents();
  const last = lastAssistantMessage(session);
  if (!last || !Number.isInteger(last.seq)) return [];
  let boundarySeq = -1;
  for (const ev of all) {
    if (!ev || !Number.isInteger(ev.seq) || ev.seq >= last.seq) continue;
    if (ev.type === 'user/message' && ev.data?.source?.kind !== 'oswyn-compaction' && ev.data?.message?.source?.kind !== 'oswyn-compaction') {
      boundarySeq = ev.seq;
    } else if (ev.type === 'assistant/message') {
      boundarySeq = ev.seq;
    }
  }
  return all.filter((ev) => ev?.type === 'tool/result' && ev.seq > boundarySeq && ev.seq < last.seq);
}

/** Plain text of one message (for fence detection). */
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** Resolve the effective protected-tool list (config + runtime additions). */
function protectedToolList(resolved) {
  const configured = Array.isArray(resolved.autoCompressTieredProtectedTools)
    ? resolved.autoCompressTieredProtectedTools : CONFIG_DEFAULTS.autoCompressTieredProtectedTools;
  return configured.concat(loadProtectedTools());
}

/** True when this tool must never be auto-compressed. Protection always wins. */
function isProtectedTool(session, event, resolved) {
  if (!event) return true;
  const toolName = String(getToolName(session, event) || '').toLowerCase();
  if (!toolName) return true;
  if (toolName === 'run_code') return true; // hard guard, even if config is edited
  return protectedToolList(resolved).some((p) => matchesToolName(p, toolName));
}

/** A tiered fallback is allowed only for non-protected tools and only when the agent wrote no result fence. */
function tieredFallbackEligible(session, event, lastMessage, resolved) {
  if (!event || isProtectedTool(session, event, resolved)) return false;
  const t = messageText(lastMessage);
  if (t.indexOf('```' + SUMMARY_OPEN_TAG) >= 0 || t.indexOf('```dsh-result-summary') >= 0) return false;
  return true;
}

/** Persist one applyFromAssistantMessage result into the ledger. */
function recordResult(session, result, turn) {
  if (!session?.id || !result) {
    diag('recordResult skip: id=' + (session && session.id) + ' hasResult=' + !!result);
    return;
  }
  const title = session.title || session.header?.title || '';
  // session/event has no explicit turn argument; the host keeps the current
  // round on the session object, so use it as the fallback for per-turn stats.
  const effectiveTurn = Number.isFinite(Number(turn)) && Number(turn) > 0
    ? Math.trunc(Number(turn))
    : (Number.isFinite(Number(session?.turn)) && Number(session.turn) > 0 ? Math.trunc(Number(session.turn)) : null);
  for (const item of result.applied || []) {
    const summaryLen = item.fact ? item.fact.length : (item.summary ? item.summary.length : 0);
    const savedEntry = appendEvent(session.id, {
      sessionTitle: title,
      seq: item.seq,
      turn: effectiveTurn,
      mode: item.mode,
      toolName: item.toolName || '',
      callId: item.callId || '',
      before: item.before,
      inputChars: item.inputChars || 0,
      after: item.after,
      keepChars: item.keepChars || 0,
      keepLines: item.keepLines ?? null,
      fact: item.fact || '',
      summary: item.summary || '',
      summaryLen,
      trigger: item.trigger || 'agent'
    });
    diag('appendEvent session=' + session.id + ' seq=' + item.seq + ' -> ' + (savedEntry ? 'ok' : 'NULL'));
  }
  if (result.replySummary) {
    appendEvent(session.id, {
      sessionTitle: title,
      seq: result.replySummary.targetSeq,
      turn: effectiveTurn,
      mode: 'reply',
      toolName: 'assistant_reply',
      before: result.replySummary.charsBefore ?? 0,
      after: result.replySummary.summary ? result.replySummary.summary.length : 0,
      summary: result.replySummary.summary || '',
      summaryLen: result.replySummary.summary ? result.replySummary.summary.length : 0,
      trigger: 'agent'
    });
  }
}

/**
 * Resolve the true DSH turn number for a distilled checkpoint so `distill.turns`
 * aligns with the DOM's `data-chat-turn` even when non-organic turns (subagents,
 * background jobs, goals) exist in the session. Falls back to `cp.round` when
 * the session carries no `turn/start` or per-event turn metadata.
 */
function buildDistillTurnDetails(session, appliedCheckpoints, reason) {
  if (!Array.isArray(appliedCheckpoints) || appliedCheckpoints.length === 0) return [];
  const turnMarks = [];
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
    for (const ev of events) {
      if (ev && ev.type === 'turn/start' && Number.isInteger(ev.seq) && Number.isFinite(Number(ev.data?.turn))) {
        turnMarks.push({ seq: ev.seq, turn: Math.trunc(Number(ev.data.turn)) });
      }
    }
    turnMarks.sort((a, b) => a.seq - b.seq);
  } catch (_) {}

  const resolveDshTurn = (cp) => {
    const targetSeq = Number.isInteger(cp?.endSeq) ? cp.endSeq : cp?.startSeq;
    if (turnMarks.length > 0 && Number.isInteger(targetSeq)) {
      const mapped = turnForSeq(turnMarks, targetSeq);
      if (mapped > 0) return mapped;
    }
    if (typeof session?.eventAt === 'function') {
      const seqCandidates = Array.isArray(cp?.shadowedSeqs) && cp.shadowedSeqs.length > 0
        ? [...cp.shadowedSeqs].reverse()
        : (Number.isInteger(targetSeq) ? [targetSeq] : []);
      for (const s of seqCandidates) {
        try {
          const ev = session.eventAt(s);
          const t = Number(ev?.data?.turn);
          if (Number.isFinite(t) && t > 0) return Math.trunc(t);
        } catch (_) {}
      }
    }
    return cp.round;
  };

  const byTurn = new Map();
  for (const cp of appliedCheckpoints) {
    const dshTurn = resolveDshTurn(cp);
    const rawT = estimateTokens(cp.beforeChars);
    const distT = estimateTokens(cp.afterChars);
    const surplusT = Math.max(0, rawT - distT);
    const prev = byTurn.get(dshTurn);
    if (prev) {
      prev.rawTokens += rawT;
      prev.distTokens += distT;
      prev.surplusTokens += surplusT;
      if (Number.isInteger(cp.seq) && (prev.seq === null || cp.seq > prev.seq)) prev.seq = cp.seq;
    } else {
      byTurn.set(dshTurn, {
        round: dshTurn,
        reason,
        rawTokens: rawT,
        distTokens: distT,
        surplusTokens: surplusT,
        seq: Number.isInteger(cp.seq) ? cp.seq : null
      });
    }
  }
  return [...byTurn.values()];
}

/** Simulate the surface after applying native `oswyn-compaction` checkpoints. */
function simulateDistilledSurface(surfacePairs, surfaceMessages, checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return surfaceMessages;
  const shadowedSet = new Set();
  const firstSeqToText = new Map();
  for (const cp of checkpoints) {
    for (const s of cp.shadowedSeqs) shadowedSet.add(s);
    firstSeqToText.set(cp.startSeq, cp.text);
  }
  const projected = [];
  for (const pair of surfacePairs) {
    if (firstSeqToText.has(pair.seq)) {
      projected.push({
        role: 'user',
        source: { kind: 'oswyn-compaction' },
        content: [{ type: 'text', text: firstSeqToText.get(pair.seq) }]
      });
    } else if (!shadowedSet.has(pair.seq)) {
      projected.push(pair.message);
    }
  }
  return projected;
}

/**
 * Evaluate non-TTL turn-level distillation (`volume`, `rounds`, `ceiling`) immediately
 * when a turn closes cleanly in `agent/turn-stopping`. TTL triggers remain evaluated
 * on the next turn's `projectOutgoing`.
 */
function runTurnCloseNonTtlDistill(session, resolved, stoppingTurn) {
  if (!session || resolved?.postCacheDistillEnabled === false) return;
  if (typeof session.append !== 'function') return;
  const state = ensureTriggerState(session);
  const surfacePairs = collectSurfaceMessages(session);
  if (surfacePairs.length === 0) return;
  const surfaceMessages = surfacePairs.map((p) => p.message);

  const { turns } = partitionSurfacePairsIntoTurns(surfacePairs);
  const closingTurnPairs = turns.length > 0 ? turns[turns.length - 1] : null;
  let continuationSkipReason = null;
  if (state.lastTurnWasBackgroundJob === true || (closingTurnPairs && isTurnTriggeredByBackgroundJob(closingTurnPairs))) {
    continuationSkipReason = 'background_job_update';
  } else if (closingTurnPairs) {
    const check = isTurnIncompleteOrAwaitingAnswer(closingTurnPairs);
    if (check.excluded) continuationSkipReason = check.reason;
  }

  const breakdown = measureSurfaceBreakdown(surfacePairs);
  if (continuationSkipReason) {
    if (session.id) {
      const rawNow = measureSurfaces(surfaceMessages, null);
      recordDistillEval(session.id, {
        distill: false,
        reason: continuationSkipReason,
        armed: false,
        floorBlocked: false,
        surplusTokens: 0,
        rawTokens: rawNow.rawTokens,
        compressedTokens: breakdown.compressedTokens,
        uncompressedTokens: breakdown.uncompressedTokens,
        systemTokens: breakdown.systemTokens,
        roundsSinceDistill: state.roundsSinceDistill,
        messageCount: surfaceMessages.length,
        userTurns: surfaceMessages.filter((m) => isOrganicUserMessage(m)).length,
        claimedCount: 0
      });
    }
    return;
  }

  if (state.lastCountedTurnClose !== stoppingTurn) {
    state.roundsSinceDistill += 1;
    state.lastCountedTurnClose = stoppingTurn;
  }
  state.lastObservedTurn = stoppingTurn;

  const distillOptions = {
    session,
    cacheTtlSeconds: resolved?.cacheTtlSeconds,
    distillStripThinking: resolved?.distillStripThinking,
    distillStripToolCalls: resolved?.distillStripToolCalls,
    activeRecalls: session?.activeRecalls,
    includeLastTurn: true,
    excludeIncompletePreviousTurn: true,
    previousTurnInterrupted: false
  };
  const pendingCheckpoints = buildTurnDistillCheckpoints(surfacePairs, distillOptions);

  const nonTtlEnabled = resolved?.triggerVolumeEnabled !== false
    || resolved?.triggerRoundsEnabled !== false
    || Boolean(resolved?.triggerCeilingTokens);
  if (!nonTtlEnabled) return;

  const measured = measureSurfaces(surfaceMessages, () => simulateDistilledSurface(surfacePairs, surfaceMessages, pendingCheckpoints));
  const triggerInfo = evaluateTrigger({
    surplusTokens: measured.surplusTokens,
    rawTokens: measured.rawTokens,
    roundsSinceDistill: state.roundsSinceDistill,
    cacheExpired: false,
    manual: false
  }, resolved);

  if (session.id) {
    recordDistillEval(session.id, {
      ...triggerInfo,
      surplusTokens: measured.surplusTokens,
      rawTokens: measured.rawTokens,
      compressedTokens: breakdown.compressedTokens,
      uncompressedTokens: breakdown.uncompressedTokens,
      systemTokens: breakdown.systemTokens,
      roundsSinceDistill: state.roundsSinceDistill,
      messageCount: surfaceMessages.length,
      userTurns: surfaceMessages.filter((m) => isOrganicUserMessage(m)).length,
      claimedCount: 0
    });
  }

  if (triggerInfo.distill && pendingCheckpoints.length > 0) {
    const appliedCheckpoints = [];
    const reason = triggerInfo.reason || '';
    for (const cp of pendingCheckpoints) {
      const res = appendCheckpointReplace(session, cp.startSeq, cp.endSeq, cp.text, {
        shadowedSeqs: cp.shadowedSeqs
      });
      if (res.ok) {
        appliedCheckpoints.push({ ...cp, seq: Number.isInteger(res.seq) ? res.seq : cp.endSeq });
      } else {
        diag('turn-close distill checkpoint failed round=' + cp.round + ': ' + String(res.reason || '').slice(0, 200));
      }
    }
    if (appliedCheckpoints.length > 0) {
      state.distilled = true;
      state.roundsSinceDistill = 0;
      state.lastDistillTurn = stoppingTurn;
      const rawNow = measureSurfaces(surfaceMessages, null);
      const distNow = measureSurfaces(simulateDistilledSurface(surfacePairs, surfaceMessages, appliedCheckpoints), null);
      const surplusTokens = Math.max(0, rawNow.rawTokens - distNow.rawTokens);
      const turnDetails = buildDistillTurnDetails(session, appliedCheckpoints, reason);
      if (session.id) {
        recordDistill(session.id, {
          rawChars: rawNow.rawChars,
          distChars: distNow.rawChars,
          rawTokens: rawNow.rawTokens,
          distTokens: distNow.rawTokens,
          surplusTokens,
          reason,
          turn: stoppingTurn,
          seq: appliedCheckpoints[appliedCheckpoints.length - 1]?.seq,
          turnDetails,
          countEvent: true
        });
        const afterBreakdown = measureSurfaceBreakdown(collectSurfaceMessages(session));
        recordDistillEval(session.id, {
          ...triggerInfo,
          distill: true,
          reason,
          surplusTokens,
          rawTokens: distNow.rawTokens,
          compressedTokens: afterBreakdown.compressedTokens,
          uncompressedTokens: afterBreakdown.uncompressedTokens,
          systemTokens: afterBreakdown.systemTokens,
          roundsSinceDistill: 0
        });
      }
    }
  }
  state.lastTrigger = triggerInfo;
}

/** Project historical assistant messages for the outgoing LLM request (dual-track + arg pruning + post-cache deep distillation). */
function projectOutgoing(messages, resolved, session, opts = {}) {
  if (!Array.isArray(messages)) return messages;
  let outgoing = messages;
  const projectionRegistered = opts.projectionRegistered === true;
  if (resolved?.postCacheDistillEnabled !== false) {
    const state = ensureTriggerState(session);
    // A distill decision is durable (an `oswyn/distill` event). On a fresh process,
    // adopt the existing decision instead of appending a duplicate one.
    if (!state.distillLogChecked) {
      state.distillLogChecked = true;
      try {
        const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : [];
        if (events.some((e) => e && e.type === OSWYN_DISTILL_EVENT)) state.distilled = true;
      } catch (_) { /* best effort */ }
    }

    // THE SURFACE THE NEXT REQUEST WILL CARRY is the kernel's derived history.
    // Anything measured from `messages` (the per-step inbox claim) is a different,
    // tiny quantity, and measuring it made the whole deep track a silent no-op.
    const surfacePairs = collectSurfaceMessages(session);
    const surfaceMessages = surfacePairs.length > 0
      ? surfacePairs.map((p) => p.message)
      : getContextMessages(session, messages);

    // In DSH `agent/pre-step`, Step 1 of a new turn carries the new organic user
    // message in `messages` (claimed from inbox) BEFORE the kernel appends it to
    // `session.surface`. Detect this so Turn N is distilled RIGHT ON Turn N+1 Step 1
    // (before `buildRequest()` runs) instead of sending full context on Step 1 and
    // breaking the cache on Step 2.
    const incomingHasNewUser = messages.some((m) => isOrganicUserMessage(m));
    const incomingHasBackgroundJob = messages.some((m) => isBackgroundJobStatusMessage(m));
    const lastSurfacePair = surfacePairs.length > 0 ? surfacePairs[surfacePairs.length - 1] : null;
    const surfaceTailIsOrganicUser = Boolean(
      lastSurfacePair && lastSurfacePair.type === 'user/message' && isOrganicUserMessage(lastSurfacePair.message)
    );
    const surfaceTailIsBackgroundJob = Boolean(
      lastSurfacePair && lastSurfacePair.type === 'user/message' && isBackgroundJobStatusMessage(lastSurfacePair.message)
    );
    const enteringNewTurnBeforeSurfaceAppend = incomingHasNewUser && !surfaceTailIsOrganicUser;

    const surfaceTurns = surfacePairs.length > 0 ? partitionSurfacePairsIntoTurns(surfacePairs).turns : [];
    const activeTurnIsBackgroundJob = !incomingHasNewUser
      && surfaceTurns.length > 0
      && isTurnTriggeredByBackgroundJob(surfaceTurns[surfaceTurns.length - 1]);

    if (incomingHasNewUser) {
      state.lastTurnWasBackgroundJob = false;
    } else if (incomingHasBackgroundJob || surfaceTailIsBackgroundJob || activeTurnIsBackgroundJob) {
      state.lastTurnWasBackgroundJob = true;
    }
    const isBackgroundJobDispatch = !incomingHasNewUser && (
      incomingHasBackgroundJob
      || surfaceTailIsBackgroundJob
      || activeTurnIsBackgroundJob
      || state.lastTurnWasBackgroundJob === true
    );

    const distillOptions = {
      session,
      cacheTtlSeconds: resolved?.cacheTtlSeconds,
      forceCacheExpired: session?.forceCacheExpired,
      distillStripThinking: resolved?.distillStripThinking,
      distillStripToolCalls: resolved?.distillStripToolCalls,
      activeRecalls: session?.activeRecalls,
      includeLastTurn: enteringNewTurnBeforeSurfaceAppend
    };
    const manualTriggered = session?.forceManualDistill === true;
    const expired = manualTriggered ? false : isCacheExpired(session, distillOptions);

    // Exclude background task status updates, manual stop, error/abort, or
    // awaiting-user-answer turns from triggering automatic turn distillation.
    let continuationSkipReason = null;
    if (!manualTriggered && isBackgroundJobDispatch) {
      continuationSkipReason = 'background_job_update';
    } else if (!manualTriggered && surfacePairs.length > 0) {
      if (state.lastTurnInterrupted === true) {
        continuationSkipReason = 'interrupted_turn';
      } else {
        const { turns } = partitionSurfacePairsIntoTurns(surfacePairs);
        const prevIdx = enteringNewTurnBeforeSurfaceAppend ? (turns.length - 1) : (turns.length - 2);
        const prevTurnPairs = prevIdx >= 0 ? turns[prevIdx] : null;
        if (prevTurnPairs) {
          const check = isTurnIncompleteOrAwaitingAnswer(prevTurnPairs);
          if (check.excluded) continuationSkipReason = check.reason;
        }
      }
    }

    // Advance round counter BEFORE evaluating trigger when a new clean turn starts,
    // unless `agent/turn-stopping` already counted the closing turn.
    const turnNow = opts.currentTurn ?? session?.turn;
    const turnChanged = turnNow !== undefined
      && state.lastObservedTurn !== undefined
      && turnNow !== state.lastObservedTurn;
    if (turnChanged && !continuationSkipReason && state.lastCountedTurnClose !== state.lastObservedTurn) {
      state.roundsSinceDistill += 1;
    }

    const pendingCheckpoints = surfacePairs.length > 0
      ? buildTurnDistillCheckpoints(surfacePairs, {
          ...distillOptions,
          excludeIncompletePreviousTurn: !manualTriggered,
          previousTurnInterrupted: state.lastTurnInterrupted === true
        })
      : [];

    // ── v2.4 multi-signal trigger ──────────────────────────────────────────
    // E1 TTL / E2 VOLUME / E3 ROUNDS / E4 CEILING / MANUAL. R counts CONVERSATION TURNS
    // (paper §9.1 "未精炼轮次"), not model requests.
    let distillNow = manualTriggered || expired;
    let triggerInfo = null;
    if (manualTriggered
      || resolved?.triggerVolumeEnabled !== false
      || resolved?.triggerRoundsEnabled !== false
      || resolved?.triggerCeilingTokens) {
      try {
        const measured = surfacePairs.length > 0
          ? measureSurfaces(surfaceMessages, () => simulateDistilledSurface(surfacePairs, surfaceMessages, pendingCheckpoints))
          : measureSurfaces(surfaceMessages, (msgs) => projectDistilledHistory(msgs, {
              ...distillOptions,
              isExpired: true
            }));
        triggerInfo = evaluateTrigger({
          surplusTokens: measured.surplusTokens,
          rawTokens: measured.rawTokens,
          roundsSinceDistill: state.roundsSinceDistill,
          cacheExpired: expired,
          manual: manualTriggered
        }, resolved);
        if (triggerInfo.distill) distillNow = true;
        // Continuation & background-job guard: background task status updates never
        // trigger automatic turn distillation; other continuation turns skip all
        // automatic distillation except emergency ceiling.
        if (continuationSkipReason && (continuationSkipReason === 'background_job_update' || triggerInfo?.reason !== 'ceiling')) {
          distillNow = false;
          triggerInfo = { ...triggerInfo, distill: false, reason: continuationSkipReason };
        }
        // Persist the decision so "why didn't it fire?" is answerable without a debugger.
        if (session?.id) {
          const breakdown = measureSurfaceBreakdown(surfacePairs);
          recordDistillEval(session.id, {
            ...triggerInfo,
            surplusTokens: measured.surplusTokens,
            rawTokens: measured.rawTokens,
            compressedTokens: breakdown.compressedTokens,
            uncompressedTokens: breakdown.uncompressedTokens,
            systemTokens: breakdown.systemTokens,
            roundsSinceDistill: state.roundsSinceDistill,
            messageCount: surfaceMessages.length,
            userTurns: surfaceMessages.filter((m) => isOrganicUserMessage(m)).length,
            claimedCount: messages.length
          });
        }
      } catch { /* keep v2.3 behaviour */ }
    }

    if (distillNow) {
      // Use native `user/message` (`oswyn-compaction`) surface replacements instead
      // of an unknown `oswyn/distill` event type: `@deepseek-ai/dsh-session`'s
      // `Session.append()` drops `opts.ignorable`, so writing a custom event type
      // crashes `gateway/internal` on session reload. Native `user/message` replace
      // is 100% within `KNOWN_SESSION_EVENT_TYPES`, removes historical thinking +
      // tool calls + tool results cleanly, and preserves shadowed seqs for recall.
      let applied = false;
      try {
        if (session?.id && typeof session.append === 'function' && pendingCheckpoints.length > 0) {
          const appliedCheckpoints = [];
          const reason = manualTriggered ? 'manual' : (triggerInfo?.reason || (expired ? 'ttl' : ''));
          for (const cp of pendingCheckpoints) {
            const res = appendCheckpointReplace(session, cp.startSeq, cp.endSeq, cp.text, {
              shadowedSeqs: cp.shadowedSeqs
            });
            if (res.ok) {
              appliedCheckpoints.push({ ...cp, seq: Number.isInteger(res.seq) ? res.seq : cp.endSeq });
            } else {
              diag('distill checkpoint failed round=' + cp.round + ': ' + String(res.reason || '').slice(0, 200));
            }
          }
          if (appliedCheckpoints.length > 0) {
            applied = true;
            state.distilled = true;
            state.roundsSinceDistill = 0;
            state.lastDistillTurn = session?.turn ?? state.lastDistillTurn;
            if (session.forceCacheExpired === true) session.forceCacheExpired = false;
            if (session.forceManualDistill === true) session.forceManualDistill = false;
            const rawNow = measureSurfaces(surfaceMessages, null);
            const distNow = measureSurfaces(simulateDistilledSurface(surfacePairs, surfaceMessages, appliedCheckpoints), null);
            const surplusTokens = Math.max(0, rawNow.rawTokens - distNow.rawTokens);
            const turnDetails = buildDistillTurnDetails(session, appliedCheckpoints, reason);
            recordDistill(session.id, {
              rawChars: rawNow.rawChars,
              distChars: distNow.rawChars,
              rawTokens: rawNow.rawTokens,
              distTokens: distNow.rawTokens,
              surplusTokens,
              reason,
              turn: session?.turn,
              seq: appliedCheckpoints[appliedCheckpoints.length - 1]?.seq,
              turnDetails,
              countEvent: true
            });
            const afterBreakdown = measureSurfaceBreakdown(collectSurfaceMessages(session));
            recordDistillEval(session.id, {
              ...(triggerInfo || {}),
              distill: true,
              reason,
              surplusTokens,
              rawTokens: distNow.rawTokens,
              compressedTokens: afterBreakdown.compressedTokens,
              uncompressedTokens: afterBreakdown.uncompressedTokens,
              systemTokens: afterBreakdown.systemTokens,
              roundsSinceDistill: 0
            });
          }
        }
      } catch (err) {
        diag('distill append failed: ' + String(err && err.message ? err.message : err).slice(0, 300));
      }
    }
    state.lastObservedTurn = turnNow ?? state.lastObservedTurn;
    state.lastTrigger = triggerInfo;
  }
  return outgoing.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    const content = msg.content;
    if (!Array.isArray(content)) return msg;
    let pruned = msg;
    try {
      const prunedMsg = pruneToolCallArgs(msg, { maxCodeLen: 160, maxSpecLen: 160 });
      if (prunedMsg && prunedMsg !== msg) pruned = prunedMsg;
      if (session && Array.isArray(pruned.content)) {
        let changed = false;
        const nextContent = pruned.content.map((block) => {
          const cid = block && (block.callId || block.id);
          if (block && block.type === 'tool-call' && cid && isCallArgDiscarded(session, cid)) {
            changed = true;
            return { ...block, arguments: discardToolCallArgs(block.arguments) };
          }
          return block;
        });
        if (changed) pruned = { ...pruned, content: nextContent };
      }
    } catch { /* keep original */ }
    return pruned;
  });
}

/**
 * Immediately run turn-level deep distillation on a live session (for /oswyn-distill).
 * Applies native checkpoint replacements right away and logs reason = 'manual'.
 */
export function executeTurnDistillNow(session, resolved = {}, opts = {}) {
  const manual = opts.manual !== false;
  const includeLastTurn = opts.includeLastTurn !== false;
  if (!session || typeof session.append !== 'function') {
    return { ok: false, applied: false, reason: 'no_session', checkpoints: 0, surplusTokens: 0, rounds: [] };
  }
  const state = ensureTriggerState(session);
  const surfacePairs = collectSurfaceMessages(session);
  const surfaceMessages = surfacePairs.length > 0
    ? surfacePairs.map((p) => p.message)
    : getContextMessages(session, []);
  const distillOptions = {
    session,
    cacheTtlSeconds: resolved?.cacheTtlSeconds,
    distillStripThinking: resolved?.distillStripThinking,
    distillStripToolCalls: resolved?.distillStripToolCalls,
    activeRecalls: session?.activeRecalls,
    includeLastTurn
  };
  const pendingCheckpoints = surfacePairs.length > 0
    ? buildTurnDistillCheckpoints(surfacePairs, distillOptions)
    : [];

  const simulateDistilledSurface = (checkpoints) => {
    if (!Array.isArray(checkpoints) || checkpoints.length === 0) return surfaceMessages;
    const shadowedSet = new Set();
    const firstSeqToText = new Map();
    for (const cp of checkpoints) {
      for (const s of cp.shadowedSeqs) shadowedSet.add(s);
      firstSeqToText.set(cp.startSeq, cp.text);
    }
    const projected = [];
    for (const pair of surfacePairs) {
      if (firstSeqToText.has(pair.seq)) {
        projected.push({
          role: 'user',
          source: { kind: 'oswyn-compaction' },
          content: [{ type: 'text', text: firstSeqToText.get(pair.seq) }]
        });
      } else if (!shadowedSet.has(pair.seq)) {
        projected.push(pair.message);
      }
    }
    return projected;
  };

  const reason = manual ? 'manual' : (opts.reason || 'manual');
  const rawNow = measureSurfaces(surfaceMessages, null);

  if (pendingCheckpoints.length === 0) {
    if (session.id) {
      const breakdown = measureSurfaceBreakdown(surfacePairs);
      recordDistillEval(session.id, {
        distill: false,
        reason: null,
        armed: false,
        floorBlocked: false,
        surplusTokens: 0,
        rawTokens: rawNow.rawTokens,
        compressedTokens: breakdown.compressedTokens,
        uncompressedTokens: breakdown.uncompressedTokens,
        systemTokens: breakdown.systemTokens,
        roundsSinceDistill: state.roundsSinceDistill,
        signals: { manual, ttl: false, volume: false, rounds: false, ceiling: false }
      });
    }
    return { ok: true, applied: false, reason, checkpoints: 0, surplusTokens: 0, rawTokens: rawNow.rawTokens, distTokens: rawNow.rawTokens, rounds: [] };
  }

  const appliedCheckpoints = [];
  for (const cp of pendingCheckpoints) {
    const res = appendCheckpointReplace(session, cp.startSeq, cp.endSeq, cp.text, {
      shadowedSeqs: cp.shadowedSeqs
    });
    if (res.ok) {
      appliedCheckpoints.push({ ...cp, seq: Number.isInteger(res.seq) ? res.seq : cp.endSeq });
    } else {
      diag('manual distill checkpoint failed round=' + cp.round + ': ' + String(res.reason || '').slice(0, 200));
    }
  }

  if (appliedCheckpoints.length === 0) {
    return { ok: true, applied: false, reason, checkpoints: 0, surplusTokens: 0, rawTokens: rawNow.rawTokens, distTokens: rawNow.rawTokens, rounds: [] };
  }

  state.distilled = true;
  state.roundsSinceDistill = 0;
  state.lastDistillTurn = session?.turn ?? state.lastDistillTurn;
  if (session.forceCacheExpired === true) session.forceCacheExpired = false;
  if (session.forceManualDistill === true) session.forceManualDistill = false;

  const distNow = measureSurfaces(simulateDistilledSurface(appliedCheckpoints), null);
  const surplusTokens = Math.max(0, rawNow.rawTokens - distNow.rawTokens);
  const turnDetails = buildDistillTurnDetails(session, appliedCheckpoints, reason);

  if (session.id) {
    const afterBreakdown = measureSurfaceBreakdown(collectSurfaceMessages(session));
    recordDistillEval(session.id, {
      distill: true,
      reason,
      armed: true,
      floorBlocked: false,
      surplusTokens,
      rawTokens: distNow.rawTokens,
      compressedTokens: afterBreakdown.compressedTokens,
      uncompressedTokens: afterBreakdown.uncompressedTokens,
      systemTokens: afterBreakdown.systemTokens,
      roundsSinceDistill: 0,
      signals: { manual, ttl: false, volume: false, rounds: false, ceiling: false }
    });
    recordDistill(session.id, {
      rawChars: rawNow.rawChars,
      distChars: distNow.rawChars,
      rawTokens: rawNow.rawTokens,
      distTokens: distNow.rawTokens,
      surplusTokens,
      reason,
      turn: session?.turn ?? appliedCheckpoints[appliedCheckpoints.length - 1]?.round,
      seq: appliedCheckpoints[appliedCheckpoints.length - 1]?.seq,
      turnDetails,
      countEvent: true
    });
  }

  return {
    ok: true,
    applied: true,
    reason,
    checkpoints: appliedCheckpoints.length,
    surplusTokens,
    rawTokens: rawNow.rawTokens,
    distTokens: distNow.rawTokens,
    rounds: appliedCheckpoints.map((cp) => cp.round)
  };
}

export function apply(ctx, config = {}) {
  const resolved = liveConfig(config);

  // Register the message projection via ctx.effect BEFORE the enabled check so
  // toggling OSWYN off in settings never removes the interpreter from an already-open
  // session (which would trigger SurfaceManager._assertProjections() to throw), and
  // plugin reloads cleanly dispose and re-register the same projection reference.
  let projectionRegistered = false;
  const registerProjection = () => {
    if (typeof ctx.sessions?.registerMessageProjection !== 'function') return undefined;
    try {
      const dispose = ctx.sessions.registerMessageProjection(oswynDistillProjection);
      projectionRegistered = true;
      return () => {
        projectionRegistered = false;
        if (typeof dispose === 'function') dispose();
      };
    } catch (err) {
      ctx.logger?.warn?.('[dsh-oswyn] registerMessageProjection failed: '
        + String(err && err.message ? err.message : err));
      return undefined;
    }
  };
  if (typeof ctx.effect === 'function') {
    ctx.effect(registerProjection, 'oswyn: distill projection');
  } else {
    registerProjection();
  }

  if (!resolved.enabled) {
    ctx.logger?.info?.('[dsh-oswyn] disabled in configuration.');
    return;
  }

  // ── 1. System prompt protocol section (Preset-aware: standard vs ptc) ──────
  ctx.effect?.(() => ctx.systemPrompt?.section?.({
    name: PROTOCOL_SECTION,
    order: 2500,
    text: (context) => protocolText(resolveSessionPreset(ctx, context))
  }), 'oswyn: protocol section');

  // The agent whose session most recently crossed a hook this plugin observes.
  // `agent/turn-stopping` carries no agent in its payload, so the turn-close flush
  // needs a last-known fallback when the dispatch scope is unavailable.
  let lastActiveSession = null;

  /**
   * Apply every fence parked by the `session/event` observer, in arrival order.
   *
   * The kernel forbids appending while an append is being published, so fences cannot
   * be applied where they are first observed. This runs at the step boundary instead,
   * where the publication window is closed, and is the only writer of agent fences.
   *
   * `applyFromAssistantMessage` is idempotent (`alreadyProcessed`/`markProcessed`), so a
   * fence that a fallback path already applied is a harmless no-op here.
   */
  function flushPendingFences(session, tracker, cfg, turn) {
    const out = { applied: [], compressed: false };
    if (!session || !Array.isArray(tracker?.pendingFences)) return out;

    const queue = tracker.pendingFences.slice();
    tracker.pendingFences = [];

    // The tail assistant message is the normal case (session/event already parked it),
    // but a session seeded or resumed without that observer — or a fence written in the
    // very step that is starting — reaches us only here. Enqueue it explicitly so the
    // step boundary stays the single writer without depending on observer ordering.
    try {
      const last = lastAssistantMessage(session);
      if (last?.message && Number.isInteger(last.seq)
        && !queue.some((entry) => entry.seq === last.seq)
        && !alreadyProcessed(session, last.seq)) {
        queue.push({ seq: last.seq, message: last.message, turn, step: tracker.lastObservedStep });
      }
    } catch (_) {}
    for (const entry of queue) {
      try {
        if (!entry?.message || alreadyProcessed(session, entry.seq)) continue;
        const before = surfaceReplaceCount(session);
        const result = applyFromAssistantMessage(session, entry.message, entry.seq, cfg);
        // Stamp the round the fence was WRITTEN in, not the round we happen to flush in.
        // A fence is parked by the session/event observer and applied at the next step
        // boundary, which already belongs to the NEXT turn. Passing the caller's turn
        // here shifted every summary by +1 (turn N's numbers surfaced as turn N+1).
        const stampTurn = Number.isFinite(Number(entry?.turn)) && Number(entry.turn) > 0
          ? Math.trunc(Number(entry.turn))
          : turn;
        recordResult(session, result, stampTurn);
        if (result?.applied?.length) out.applied.push(...result.applied);
        // Credit what actually landed on the surface: `applied` is empty when a fence
        // was consumed by another path, and text alone is not proof of a rewrite.
        if ((result?.applied?.length || 0) > 0 || result?.replySummary
          || surfaceReplaceCount(session) > before) {
          out.compressed = true;
        }
        if (result.error || (Array.isArray(result.rejected) && result.rejected.length > 0)) {
          diag('reject seq=' + entry.seq + ' ' + String(result.error || result.rejected.join(' | ')).slice(0, 300));
        }
      } catch (err) {
        diag('flush throw seq=' + entry?.seq + ' ' + String(err).slice(0, 300));
        ctx.logger?.debug?.('[dsh-oswyn] pending fence skipped: ' + String(err).slice(0, 200));
      }
    }
    tracker.observeSurfaceReplaces(surfaceReplaceCount(session));
    return out;
  }

  function runAutoPolicies(session, turn) {
    if (!session) return [];
    const seen = seenToolResults(session);
    if (seen.length === 0) return [];
    const last = lastAssistantMessage(session);
    const lastText = messageText(last?.message);
    const hasFence = lastText.indexOf('```' + SUMMARY_OPEN_TAG) >= 0 || lastText.indexOf('```dsh-result-summary') >= 0;
    const applied = runAllAutoPolicies(session, seen, resolved, {
      isProtectedTool,
      tieredFallbackEligible,
      lastMessage: last?.message,
      hasFence,
      protectedTools: protectedToolList(resolved),
      logger: ctx.logger
    });
    if (applied.length > 0) {
      // Auto policies run at a step boundary, so the caller knows the round; without
      // it every autonomous row landed as turn 0 and vanished from per-turn stats.
      recordResult(session, { applied }, turn);
    }
    return applied;
  }

  // ── 1b. Warm the per-request multiplier cache (see store/requests.js) ─────
  // Decompressing every session log costs ~3s; do it chunked in the background so
  // the first dashboard open already has exact "each round-trip re-saves" numbers.
  ctx.effect?.(() => {
    try {
      warmRequestCache(loadAllSessions().map((s) => s.sessionId));
    } catch (_) {}
    return () => {};
  });

  // ── 2. Bookkeeping only — never append from inside an append ──────────────
  //
  // `session/event` fires while the kernel is still publishing the event, with
  // `entry.appending === true`, and Session#append() rejects any nested append in that
  // window ("session append cannot reenter while another append is being published").
  // Applying a fence here means appending a `surfaceOp: replace` event, so every fence
  // observed on this path was silently dropped — measured on a real session: 8 of 19
  // fences lost, 29,630 chars left in context.
  //
  // The fence is therefore only *registered* here and applied at the next step
  // boundary (see `flushPendingFences`), where appending is legal. This observer keeps
  // doing the accounting it is safe to do: step recording, auto policies on already
  // closed results, and surface-write observation.
  ctx.effect?.(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message' || event?.ignorable || !event?.data?.message) return;
    const run = () => {
      try {
        if (!session) return;
        lastActiveSession = session;
        const tracker = getSessionTracker(session, resolved);

        // Prefer the round stamped on the event itself. `session.turn` is already
        // advanced past the message by the time this observer runs on some paths,
        // which is how a fence written in turn N got parked as turn N+1.
        const observedTurn = Number.isFinite(Number(event.data.turn)) && Number(event.data.turn) > 0
          ? Math.trunc(Number(event.data.turn))
          : (session.turn ?? tracker.lastObservedTurn ?? 1);
        const observedStep = Number.isFinite(Number(event.data.step)) && Number(event.data.step) > 0
          ? Math.trunc(Number(event.data.step))
          : (session.step ?? tracker.lastObservedStep ?? 1);

        if (!alreadyProcessed(session, event.seq)) {
          tracker.pendingFences.push({
            seq: event.seq,
            message: event.data.message,
            turn: observedTurn,
            step: observedStep
          });
        }

        // Auto policies also append, so they are owned by the step boundary too.
        // Running them here would reintroduce the very reentrancy this refactor removes.
        recordSessionActivity(session);
        tracker.updateStep({
          turn: session.turn ?? tracker.lastObservedTurn ?? 1,
          step: session.step ?? tracker.lastObservedStep ?? 1,
          outgoingMessages: getContextMessages(session, []),
          incomingDecision: event.data.message,
          compressed: false,
          surfaceReplaces: surfaceReplaceCount(session),
          eventSeq: event.seq
        });
      } catch (err) {
        diag('throw seq=' + event.seq + ' ' + String(err).slice(0, 300));
        ctx.logger?.debug?.('[dsh-oswyn] event distillation skipped: ' + String(err).slice(0, 200));
      }
    };
    run();
  }), 'oswyn: session-event distillation');

  // ── 3. Step-boundary: agent fences first, auto policies second, smart nudge third ──
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const session = agent?.session;
    if (session) lastActiveSession = session;
    const currentTurn = turn ?? agent?.turn ?? session?.turn ?? 1;
    const currentStep = step ?? agent?.step ?? session?.step ?? 1;
    const tracker = getSessionTracker(session, resolved);
    tracker.syncStep(currentTurn, currentStep);

    // Ledger needs the round number twice: (a) stamped on every compression row,
    // (b) as the session's current round, so cumulative savings can be computed as
    // per-row tokens × rounds elapsed since that row was compressed.
    if (session?.id) {
      try { recordSessionTurn(session.id, currentTurn); } catch (_) {}
    }

    // Step boundary is the only place where appending is legal, so every fence that
    // session/event parked is applied here, in arrival order. This is the single
    // writer for agent fences (see the session/event observer above).
    let preStepCompressed = false;
    if (resolved.autoApply && !signal?.aborted) {
      try {
        const flushed = flushPendingFences(session, tracker, resolved, currentTurn);
        if (flushed.compressed) preStepCompressed = true;
      } catch (err) {
        ctx.logger?.warn?.('[dsh-oswyn] step distillation failed: ' + String(err).slice(0, 200));
      }
    }

    if (session && !signal?.aborted) {
      const autoApplied = runAutoPolicies(session, currentTurn);
      if (Array.isArray(autoApplied) && autoApplied.length > 0) {
        preStepCompressed = true;
      }
    }

    if (preStepCompressed) {
      tracker.recordCompression(Math.max(1, currentStep - 1), currentTurn);
    }

    const decision = await next();
    if (!decision || decision.kind === 'reject' || signal?.aborted) return decision;

    // A fence consumed in this pre-step lands on the surface but never reaches the
    // session/event handler (alreadyProcessed), so feed the count forward here too.
    if (session) {
      try { tracker.observeSurfaceReplaces(surfaceReplaceCount(session)); } catch (_) {}
    }

    let outgoing = projectOutgoing(decision.messages, resolved, session, { projectionRegistered, currentTurn });
    const contextMessages = getContextMessages(session, outgoing);

    const isMultiTurn = turn !== undefined || step !== undefined;
    if (resolved.adaptiveNudgeEnabled !== false && isMultiTurn) {
      try {
        const evalResult = tracker.evaluateNudgeNeeded({
          turn: currentTurn,
          step: currentStep,
          outgoingMessages: contextMessages,
          session
        });
        if (evalResult.shouldNudge) {
          const nudgeText = buildAdaptiveNudgeNotice(
            evalResult.tier,
            evalResult.candidateTargets,
            { turn: currentTurn, step: currentStep, session, reportedChars: evalResult.reportedChars }
          );
          if (nudgeText) {
            const outArr = Array.isArray(outgoing) ? outgoing : [];
            const lastMsg = outArr.length > 0 ? outArr[outArr.length - 1] : null;
            if (lastMsg && (lastMsg.source?.kind === 'oswyn-nudge' || lastMsg.source?.kind === 'oswyn-compaction')) {
              // Replace rather than stack consecutive synthetic user messages
              outgoing = [...outArr.slice(0, -1), {
                role: 'user',
                content: [{ type: 'text', text: nudgeText }],
                source: { kind: 'oswyn-nudge', time: Date.now() }
              }];
            } else {
              outgoing = [...outArr, {
                role: 'user',
                content: [{ type: 'text', text: nudgeText }],
                source: { kind: 'oswyn-nudge', time: Date.now() }
              }];
            }
            tracker.recordNudgeEmitted(currentStep, currentTurn);
          }
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] adaptive nudge skipped: ' + String(err).slice(0, 120));
      }
    } else if (resolved.nudgeEnabled !== false && Array.isArray(contextMessages) && contextMessages.length > 0) {
      try {
        const candidates = collectNudgeCandidates(contextMessages, resolved, session);
        const nudgeText = buildNudgePromptText(candidates);
        if (nudgeText) {
          outgoing = [...(Array.isArray(outgoing) ? outgoing : []), {
            role: 'user',
            content: [{ type: 'text', text: nudgeText }],
            source: { kind: 'oswyn-nudge', time: Date.now() }
          }];
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] nudge skipped: ' + String(err).slice(0, 120));
      }
    }

    return { ...decision, messages: outgoing };
  });

  // ── 3b. Turn close: the LAST round has no next pre-step ───────────────────
  //
  // `flushPendingFences` normally runs at the next step boundary, so the fence a
  // turn writes is only applied once the following turn begins. The final turn of
  // a conversation never gets that boundary, which is why the newest reply kept
  // showing the previous round's numbers and the newest round showed none at all.
  // `agent/turn-stopping` is serial and awaited, so appending is legal here.
  // The kernel dispatches this hook with `{ turn, signal }` only — the agent is the
  // dispatch scope, reachable through `this`, not a payload field. A closure arrow
  // would silently see no session and the hook would be dead weight.
  ctx.on('agent/turn-stopping', async function turnCloseFlush({ turn, signal, reason, error } = {}) {
    const session = this?.session || this?.agent?.session || lastActiveSession;
    if (!session) return;
    try {
      const triggerState = ensureTriggerState(session);
      const interrupted = Boolean(
        signal?.aborted
        || error
        || reason === 'abort'
        || reason === 'cancelled'
        || reason === 'canceled'
        || reason === 'error'
        || reason === 'interrupted'
      );
      triggerState.lastTurnInterrupted = interrupted;
      if (interrupted) return;
      const tracker = getSessionTracker(session, resolved);
      const stoppingTurn = Number.isFinite(Number(turn)) && Number(turn) > 0
        ? Math.trunc(Number(turn))
        : (session.turn ?? tracker.lastObservedTurn ?? 1);
      if (resolved.autoApply) {
        flushPendingFences(session, tracker, resolved, stoppingTurn);
      }
      runTurnCloseNonTtlDistill(session, resolved, stoppingTurn);
    } catch (err) {
      ctx.logger?.debug?.('[dsh-oswyn] turn-close flush skipped: ' + String(err).slice(0, 160));
    }
  });

  // ── 4. Slash commands ──────────────────────────────────────────────────────
  const commandHooks = {
    runManualDistill: (session) => executeTurnDistillNow(session, resolved, { manual: true, includeLastTurn: true })
  };
  if (typeof ctx.commands?.register === 'function') {
    try { registerCommands(ctx, resolved, commandHooks); } catch { /* ignore */ }
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (sub) => { try { registerCommands(sub, resolved, commandHooks); } catch { /* ignore */ } });
  }

  // ── 5. Web routes ──────────────────────────────────────────────────────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer', 'sessions'], (sub) => {
      ctx.effect?.(() => registerWebRoutes(sub, resolved), 'oswyn: web routes');
    });
  } else if (ctx.webServer) {
    ctx.effect?.(() => registerWebRoutes(ctx, resolved), 'oswyn: web routes');
  }

  // ── 6. Tools ───────────────────────────────────────────────────────────────
  try { registerRecallTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] recall tool skipped: ' + String(err)); }
  try { registerHistoryRecallTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] history recall tool skipped: ' + String(err)); }
  try { registerStatsTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] stats tool skipped: ' + String(err)); }
  try { registerProtectTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] protect tool skipped: ' + String(err)); }

  ctx.logger?.info?.('[dsh-oswyn] loaded (modular architecture: core + modes + presets + prompts + client).');
}

export default { name, inject, Config, apply };
