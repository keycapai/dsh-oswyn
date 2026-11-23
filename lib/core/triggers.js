/**
 * OSWYN v2.4 - Multi-signal distillation trigger.
 *
 * v2.3 distilled on ONE signal: server-side KV-cache expiry (idle time >= TTL).
 * Production telemetry (paper/data/v24/expA-billing-cache-survival.json) shows that
 * signal alone is structurally insufficient: 6.8% of calls miss the cache even with a
 * sub-10-second idle gap, because eviction is LRU-driven and concurrency-driven, not
 * purely time-driven. Meanwhile the surface keeps growing between those misses.
 *
 * v2.4 therefore arms distillation on independent signals and executes the reset only
 * when it is free (coalescing), with a hard ceiling as the safety valve.
 *
 *   E1 TTL      idle >= tau_TTL          (v2.3 behaviour, retained)
 *   E2 VOLUME   removable surplus >= V   (absolute tokens, not a ratio: a ratio is
 *                                        degenerate for short clean sessions)
 *   E3 ROUNDS   undistilled rounds >= R
 *   E4 CEILING  raw surface >= V_hard    (bypasses coalescing)
 *
 * Execution policy:
 *   - sticky latch: once distilled, stay distilled (re-distilling an already distilled
 *     surface is a no-op, and un-distilling would pay a reset for nothing)
 *   - floor: never fire for less than triggerMinSurplusTokens removable tokens.
 *
 * Execution is EAGER: an armed trigger resets on that dispatch. There is no
 * "wait for a naturally cold call" mode. Such a mode is unobservable here (the only
 * cold signal is the TTL itself, so waiting degenerates into waiting for the TTL),
 * and deferring by N rounds is arithmetically identical to simply raising R by N —
 * a case the parameter sweep already covers. Paper §6.2 also shows eager is cheaper
 * ($26.47 vs $27.19, non-overlapping 95% CIs) with no TTFT penalty.
 */

export const TRIGGER_DEFAULTS = Object.freeze({
  triggerTtlEnabled: true,
  triggerVolumeEnabled: true,
  triggerRoundsEnabled: true,
  triggerVolumeTokens: 64000,
  triggerRounds: 8,
  triggerCeilingTokens: 256000,
  triggerMinSurplusTokens: 4000
});

/** Token estimate used for trigger arithmetic (calibrated at 2.9 chars/token). */
export const CHARS_PER_TOKEN = 2.9;

export function estimateTokens(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.round(chars / CHARS_PER_TOKEN);
}

function textLength(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      if (!block) continue;
      if (typeof block === 'string') n += block.length;
      else if (typeof block.text === 'string') n += block.text.length;
      else if (typeof block.content === 'string') n += block.content.length;
      else if (typeof block.thinking === 'string') n += block.thinking.length;
      else if (block.type === 'tool-call' || block.type === 'tool_call' || block.type === 'tool_use') {
        const raw = block.arguments ?? block.input;
        if (typeof raw === 'string') n += raw.length;
        else if (raw !== undefined && raw !== null) {
          try { n += JSON.stringify(raw).length; } catch { n += 32; }
        } else {
          n += 32;
        }
      } else {
        try { n += JSON.stringify(block).length; } catch { n += 32; }
      }
    }
    return n;
  }
  if (content && typeof content === 'object') {
    try { return JSON.stringify(content).length; } catch { return 0; }
  }
  return 0;
}

/** Characters in one message, including tool-call argument payloads. */
export function messageChars(msg) {
  if (!msg) return 0;
  let n = textLength(msg.content);
  if (typeof msg.reasoning_content === 'string') n += msg.reasoning_content.length;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    try { n += JSON.stringify(msg.tool_calls).length; } catch { n += 64 * msg.tool_calls.length; }
  }
  return n;
}

/**
 * Measure the two candidate surfaces of a history prefix.
 *
 * rawChars  - everything as-is (Origin Replay)
 * distChars - what the post-cache distill projection would keep
 *
 * The surplus is the absolute number of tokens a distill would remove right now.
 * It is measured in ABSOLUTE tokens rather than a ratio because real sessions show
 * a bimodal ratio distribution: ~10% of turns have ratio 1.0 (nothing to remove),
 * which makes any ratio threshold fire spuriously or never fire at all.
 */
export function measureSurfaces(messages, projectFn) {
  const rawChars = messages.reduce((acc, m) => acc + messageChars(m), 0);
  let distChars = rawChars;
  if (typeof projectFn === 'function' && messages.length) {
    try {
      const projected = projectFn(messages);
      if (Array.isArray(projected)) {
        distChars = projected.reduce((acc, m) => acc + messageChars(m), 0);
      }
    } catch { /* fall back to raw */ }
  }
  const rawTokens = estimateTokens(rawChars);
  const distTokens = estimateTokens(distChars);
  return {
    rawChars,
    distChars,
    rawTokens,
    distTokens,
    surplusTokens: Math.max(0, rawTokens - distTokens)
  };
}

/**
 * Lazily attach the per-session trigger latch.
 *
 * The latch must survive across dispatches because the sticky/distilled state is a
 * property of the SESSION, not of one request: un-distilling would force another
 * prefix reset for no gain.
 */
export function ensureTriggerState(session) {
  if (!session || typeof session !== 'object') {
    return { distilled: false, roundsSinceDistill: 0, lastDistillTurn: null, lastObservedTurn: undefined, lastTrigger: null, armedRounds: 0 };
  }
  if (!session.__oswynTrigger || typeof session.__oswynTrigger !== 'object') {
    Object.defineProperty(session, '__oswynTrigger', {
      value: { distilled: false, roundsSinceDistill: 0, lastDistillTurn: null, lastObservedTurn: undefined, lastTrigger: null, armedRounds: 0 },
      enumerable: false,
      writable: true,
      configurable: true
    });
  }
  return session.__oswynTrigger;
}

/**
 * Evaluate the trigger state for one dispatch.
 *
 * @param {object} input
 * @param {number} input.surplusTokens      removable tokens (from measureSurfaces)
 * @param {number} input.rawTokens          absolute raw surface tokens
 * @param {number} input.roundsSinceDistill completed rounds since the last distill
 * @param {boolean} input.cacheExpired      E1 (TTL / force)
 * @param {object} config                   resolved OSWYN config
 * @returns {{distill:boolean, reason:string|null, armed:boolean, floorBlocked:boolean, signals:object}}
 */
export function evaluateTrigger(input, config = {}) {
  const cfg = { ...TRIGGER_DEFAULTS, ...config };
  const surplus = Math.max(0, input.surplusTokens || 0);
  const rawTokens = Math.max(0, input.rawTokens || 0);
  const rounds = Math.max(0, input.roundsSinceDistill || 0);

  const signals = {
    manual: input.manual === true,
    ttl: cfg.triggerTtlEnabled !== false && input.cacheExpired === true,
    volume: cfg.triggerVolumeEnabled !== false && surplus >= cfg.triggerVolumeTokens,
    rounds: cfg.triggerRoundsEnabled !== false && rounds >= cfg.triggerRounds,
    ceiling: rawTokens >= cfg.triggerCeilingTokens
  };

  const anyArmed = signals.manual || signals.ttl || signals.volume || signals.rounds;

  // Floor: a reset that removes almost nothing is pure loss (it destroys a live prefix
  // to save a few hundred tokens). Manual triggers and the ceiling bypass it.
  const floorBlocked = anyArmed && !signals.manual && !signals.ceiling && surplus < cfg.triggerMinSurplusTokens;
  const armed = anyArmed && !floorBlocked;

  let distill = false;
  let reason = null;

  if (signals.manual) {
    // Explicit manual trigger (/oswyn-distill): fires immediately and is always logged as 'manual'.
    distill = true;
    reason = 'manual';
  } else if (signals.ceiling) {
    // The ceiling is a safety valve: it bypasses the floor and fires immediately.
    distill = true;
    reason = 'ceiling';
  } else if (armed) {
    // Eager: the reset happens on this dispatch, no deferral.
    distill = true;
    reason = signals.ttl ? 'ttl' : (signals.volume ? 'volume' : 'rounds');
  }

  return { distill, reason, armed, floorBlocked, signals };
}
