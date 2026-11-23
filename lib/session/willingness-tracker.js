/**
 * dsh-oswyn/session/willingness-tracker — Dynamic Willingness-Aware Nudge Engine.
 *
 * Tracks consecutive uncompressed steps, accumulated payload bloat, and
 * enforces zero-false-positive guards:
 *   1. Step 0 Exemption Guard (100% preservation for .env, configs, secrets, active source)
 *   2. Cold-Start Silence (turn <= coldStartSteps && context < 4000 tokens)
 *   3. Active-Compliance Silence (immediate reset and silence on valid summary fence)
 *   4. Cooldown Enforcement (delta_s < cooldownSteps)
 *   5. Final-Turn Reasoning-First Exemption (silence during end calculation/synthesis)
 *
 * @module dsh-oswyn/session/willingness-tracker
 */

import { findSummaryBlock, findReplySummaryBlock } from '../core/parse.js';
import { hasMeta } from '../core/markers.js';

function parseNum(val, fallback) {
  if (val === null || val === undefined || typeof val === 'boolean') return fallback;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Step 0 Exemption checker for file targets or command args.
 * High-signal assets (.env, config, settings, yaml, json, toml, secrets)
 * must be 100% preserved in context and never nudged for compression.
 */
export function isStep0ExemptTarget(target) {
  if (!target || typeof target !== 'string') return false;
  const lower = target.toLowerCase();
  const exemptPatterns = [
    /\.env/i,
    /config\./i,
    /settings\./i,
    /\.ya?ml/i,
    /\.json/i,
    /\.toml/i,
    /secret/i,
    /credentials/i,
    /auth/i,
    /\.ini$/i
  ];
  return exemptPatterns.some((pattern) => pattern.test(lower));
}

/**
 * Extract plain text from a message payload.
 */
export function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text || '')
      .join('\n');
  }
  return '';
}

function hasDistillationFence(text) {
  if (typeof text !== 'string' || !text) return false;
  // Only a *parseable* fence counts. A bare literal mention of
  // "```result-summary" inside prose (the model explaining the protocol, or
  // quoting an earlier fence while reasoning) used to be credited as compliance
  // even though no surface replacement ever landed — that false credit zeroed the
  // backlog and is what produced "compress, then get nudged three steps later".
  if (findSummaryBlock(text) || findReplySummaryBlock(text)) return true;
  if (/<(?:dsh-)?result-summary[\s>]/.test(text) || /<(?:dsh-)?reply-summary[\s>]/.test(text)) return true;
  return false;
}

export class WillingnessTracker {
  constructor(options = {}) {
    this.uncompressedStepThreshold = parseNum(options.uncompressedStepThreshold, 2);
    this.accumulatedPayloadThreshold = parseNum(options.accumulatedPayloadThreshold, 2000);
    this.cooldownSteps = parseNum(options.cooldownSteps, 2);
    this.minChars = parseNum(options.minChars, 600);
    this.coldStartSteps = parseNum(options.coldStartSteps, 2);
    this.deepHorizonTurns = parseNum(options.deepHorizonTurns, 8);
    // Minimum number of steps of silence granted after a *verified* compression.
    // Effective window is max(this, uncompressedStepThreshold + 1) so compliance is
    // never immediately followed by the inertia trigger that just reset.
    this.complianceWindowSteps = parseNum(options.complianceWindowSteps, 3);

    this.consecutiveUncompressedSteps = 0;
    this.accumulatedUncompressedChars = 0;
    this.lastCompressStep = null;
    this.lastNudgeStep = null;
    this.totalStepsRecorded = 0;
    this.lastObservedTurn = null;
    this.lastObservedStep = null;
    this.lastSurfaceReplaceCount = null;
    // Assistant messages whose fence is waiting for a legal append point.
    this.pendingFences = [];
    this._recordedEventSeqs = new Set();
  }

  updateOptions(options = {}) {
    if (options.uncompressedStepThreshold !== undefined) {
      this.uncompressedStepThreshold = parseNum(options.uncompressedStepThreshold, this.uncompressedStepThreshold);
    }
    if (options.accumulatedPayloadThreshold !== undefined) {
      this.accumulatedPayloadThreshold = parseNum(options.accumulatedPayloadThreshold, this.accumulatedPayloadThreshold);
    }
    if (options.cooldownSteps !== undefined) {
      this.cooldownSteps = parseNum(options.cooldownSteps, this.cooldownSteps);
    }
    if (options.minChars !== undefined) {
      this.minChars = parseNum(options.minChars, this.minChars);
    }
    if (options.coldStartSteps !== undefined) {
      this.coldStartSteps = parseNum(options.coldStartSteps, this.coldStartSteps);
    }
    if (options.deepHorizonTurns !== undefined) {
      this.deepHorizonTurns = parseNum(options.deepHorizonTurns, this.deepHorizonTurns);
    }
    if (options.complianceWindowSteps !== undefined) {
      this.complianceWindowSteps = parseNum(options.complianceWindowSteps, this.complianceWindowSteps);
    }
  }

  reset() {
    this.consecutiveUncompressedSteps = 0;
    this.accumulatedUncompressedChars = 0;
    this.lastCompressStep = null;
    this.lastNudgeStep = null;
    this.totalStepsRecorded = 0;
    this.lastObservedTurn = null;
    this.lastObservedStep = null;
    this.lastSurfaceReplaceCount = null;
    this.pendingFences = [];
    this._recordedEventSeqs.clear();
  }

  /**
   * Sync the surface-replacement counter and report whether new replacements landed
   * since the previous observation.
   *
   * Deliberately does NOT record compression itself: the caller knows which step the
   * fence was authored on and must pass that step to {@link recordCompression}.
   */
  observeSurfaceReplaces(count) {
    if (!Number.isFinite(count)) return false;
    const previous = this.lastSurfaceReplaceCount;
    this.lastSurfaceReplaceCount = count;
    return Number.isFinite(previous) && count > previous;
  }

  syncStep(turn, step) {
    if (Number.isFinite(turn) && turn >= 0) {
      this.lastObservedTurn = turn;
    }
    if (Number.isFinite(step) && step >= 0) {
      this.lastObservedStep = step;
    }
  }

  recordCompression(step) {
    this.consecutiveUncompressedSteps = 0;
    this.accumulatedUncompressedChars = 0;
    const effectiveStep = Number.isFinite(step) ? step : this.lastObservedStep;
    if (Number.isFinite(effectiveStep)) {
      this.lastCompressStep = effectiveStep;
    }
  }

  recordNudgeEmitted(step) {
    this.lastNudgeStep = step;
    // The nudge already reported the accumulated backlog; clear it so the next nudge
    // measures only payload that arrives after this reminder instead of re-reporting
    // the same characters every cooldown cycle.
    this.accumulatedUncompressedChars = 0;
    this.consecutiveUncompressedSteps = 0;
  }

  collectCandidates(outgoingMessages) {
    if (!Array.isArray(outgoingMessages) || outgoingMessages.length === 0) return [];
    const candidates = [];
    for (let i = outgoingMessages.length - 1; i >= 0; i--) {
      const m = outgoingMessages[i];
      if (m && m.role === 'assistant') break; // prior assistant boundary
      const isToolMsg = m && (m.role === 'tool' || m.source?.toolName !== undefined || m.toolCallId !== undefined);
      if (isToolMsg) {
        const txt = extractMessageText(m);
        // Skip already-compressed or discarded results
        if (hasMeta(txt) || txt.includes('[oswyn-meta:')) continue;

        let target = '';
        if (m.callArgs) {
          if (typeof m.callArgs === 'string') {
            try {
              const parsed = JSON.parse(m.callArgs);
              target = parsed.file_path || parsed.path || parsed.command || '';
            } catch {
              target = m.callArgs;
            }
          } else if (typeof m.callArgs === 'object') {
            target = m.callArgs.file_path || m.callArgs.path || m.callArgs.command || '';
          }
        }
        target = target || m.source?.target || m.target || '';

        const isExempt = isStep0ExemptTarget(target) || isStep0ExemptTarget(txt.slice(0, 80));
        candidates.unshift({
          callId: m.toolCallId || m.tool_call_id || m.callId || m.source?.callId || '',
          toolName: m.toolName || m.name || m.source?.toolName || 'tool',
          txt,
          chars: txt.length,
          isError: Boolean(m.isError || m.source?.isError),
          isExempt,
          target
        });
      }
    }
    return candidates;
  }

  updateStep({ turn, step, outgoingMessages, incomingDecision, compressed = false, eventSeq, surfaceReplaces }) {
    const effectiveStep = Number.isFinite(step) ? step : (this.lastObservedStep ?? 1);
    const assistantText = extractMessageText(incomingDecision);
    // Ground truth: did any surface replacement land since we last looked? The fence is
    // normally consumed by the pre-step hook, so by the time session/event fires the
    // applier reports `applied=[]` and `compressed` is false even though a real
    // compression just happened. Counting surface writes catches both paths.
    let landedCompression = false;
    if (Number.isFinite(surfaceReplaces)) {
      if (Number.isFinite(this.lastSurfaceReplaceCount) && surfaceReplaces > this.lastSurfaceReplaceCount) {
        landedCompression = true;
      }
      this.lastSurfaceReplaceCount = surfaceReplaces;
    }
    const hasDistillation = Boolean(compressed) || landedCompression || hasDistillationFence(assistantText);

    if (Number.isInteger(eventSeq)) {
      if (this._recordedEventSeqs.has(eventSeq)) {
        if (hasDistillation) {
          this.recordCompression(effectiveStep);
        }
        return;
      }
      if (this._recordedEventSeqs.size >= 500) {
        this._recordedEventSeqs.clear();
      }
      this._recordedEventSeqs.add(eventSeq);
    }

    this.totalStepsRecorded++;

    if (hasDistillation) {
      this.recordCompression(effectiveStep);
      return;
    }

    // Pending-fence note: session/event runs while the assistant message is still being
    // published, so its fence cannot be applied there (the kernel forbids reentrant
    // append). The message is parked here and applied at the next step boundary, where
    // appending is legal. Parked text must not count as backlog in the meantime.
    if (this.pendingFenceText && assistantText && assistantText.indexOf(this.pendingFenceText) >= 0) {
      return;
    }

    // Inspect trailing tool outputs in outgoingMessages.
    // In session/event, the newly appended assistant message may already sit at the tail.
    let inspectMessages = outgoingMessages;
    if (Array.isArray(outgoingMessages) && outgoingMessages.length > 0
      && outgoingMessages[outgoingMessages.length - 1]?.role === 'assistant') {
      inspectMessages = outgoingMessages.slice(0, -1);
    }
    const trailingCandidates = this.collectCandidates(inspectMessages);
    const noisyCandidates = trailingCandidates.filter(
      (c) => !c.isExempt && (c.chars >= this.minChars || c.isError)
    );

    if (noisyCandidates.length > 0) {
      this.consecutiveUncompressedSteps++;
      const addedChars = noisyCandidates.reduce((acc, c) => acc + c.chars, 0);
      this.accumulatedUncompressedChars += addedChars;
    }
  }

  evaluateNudgeNeeded({ turn, step, outgoingMessages, session }) {
    const candidates = this.collectCandidates(outgoingMessages);
    if (candidates.length === 0) {
      return { shouldNudge: false, reason: 'NO_TOOL_CANDIDATES', candidateTargets: [] };
    }

    // 1. Step 0 Exemption Guard: if all candidates are high-signal exempt assets, 100% suppress
    const nonExemptCandidates = candidates.filter((c) => !c.isExempt);
    if (nonExemptCandidates.length === 0) {
      return { shouldNudge: false, reason: 'STEP_0_EXEMPTION', candidateTargets: [] };
    }

    // 2. Cold start silence: initial exploration steps with short context (< 4000 tokens)
    let totalTokens = typeof session?.tokenMeasurement?.anchor?.usage?.totalTokens === 'number'
      ? session.tokenMeasurement.anchor.usage.totalTokens
      : (typeof session?.totalTokens === 'number' ? session.totalTokens : null);
    if (totalTokens === null && Array.isArray(outgoingMessages) && outgoingMessages.length > 0) {
      let charSum = 0;
      for (const m of outgoingMessages) {
        if (typeof m?.content === 'string') charSum += m.content.length;
        else if (Array.isArray(m?.content)) {
          for (const b of m.content) charSum += (b?.text || '').length;
        }
      }
      totalTokens = Math.round(charSum / 3.5);
    }
    if (totalTokens === null) totalTokens = 1000;

    const isColdStart = (turn <= this.coldStartSteps && (step === undefined || step <= this.coldStartSteps)) && totalTokens < 4000;
    if (isColdStart) {
      return { shouldNudge: false, reason: 'COLD_START_SILENCE', candidateTargets: [] };
    }

    // 3. Active compliance silence: the model (or an auto-policy) compressed recently.
    // The window MUST be strictly wider than the inertia trigger window
    // (uncompressedStepThreshold). With both at 2 the arithmetic guaranteed a nudge on
    // the 3rd step after every compression: recordCompression() zeroes the counter, the
    // next step counts 1, the one after counts 2 -> CONSECUTIVE_UNCOMPRESSED_INERTIA
    // fires on step+3 while the "you already compressed" guard has just expired.
    // The +1 keeps a real gap between "complied" and "nagging again".
    const complianceWindow = Math.max(
      this.complianceWindowSteps,
      this.uncompressedStepThreshold + 1
    );
    if (this.lastCompressStep !== null && Number.isFinite(step)
      && this.lastCompressStep >= step - complianceWindow && this.lastCompressStep <= step) {
      return { shouldNudge: false, reason: 'ALREADY_COMPRESSED', candidateTargets: [] };
    }

    // 4. Cooldown window
    if (this.lastNudgeStep !== null && Number.isFinite(step)
      && step >= this.lastNudgeStep && (step - this.lastNudgeStep < this.cooldownSteps)) {
      return { shouldNudge: false, reason: 'COOLDOWN_ACTIVE', candidateTargets: [] };
    }

    // 5. Final turn reasoning-first exemption
    if (session?.isFinalSynthesis || session?.isFinalTurn) {
      return { shouldNudge: false, reason: 'FINAL_TURN_EXEMPTION', candidateTargets: [] };
    }

    // 6. Error channel sensitivity trigger
    const criticalError = nonExemptCandidates.find((c) => c.isError && c.chars >= 300);
    if (criticalError) {
      return {
        shouldNudge: true,
        tier: 'contractual',
        reason: 'CRITICAL_ERROR_STACK',
        candidateTargets: [criticalError]
      };
    }

    // 7. Consecutive uncompressed inertia trigger
    const pendingChars = nonExemptCandidates.reduce((acc, c) => acc + c.chars, 0);
    if (this.consecutiveUncompressedSteps >= this.uncompressedStepThreshold
      && pendingChars >= this.minChars) {
      return {
        shouldNudge: true,
        tier: 'contractual',
        reason: 'CONSECUTIVE_UNCOMPRESSED_INERTIA',
        candidateTargets: nonExemptCandidates
      };
    }

    // 8. Accumulated payload bloat trigger (including current incoming candidate chars)
    const currentPendingChars = pendingChars;
    const reportedChars = this.accumulatedUncompressedChars + currentPendingChars;
    if (reportedChars >= this.accumulatedPayloadThreshold) {
      return {
        shouldNudge: true,
        tier: 'budget',
        reason: 'CUMULATIVE_PAYLOAD_BLOAT',
        reportedChars,
        candidateTargets: nonExemptCandidates
      };
    }

    // 9. Horizon decay trigger (either turn >= deepHorizon OR step >= deepHorizon with active pending noisy payload)
    const deepHorizon = this.deepHorizonTurns ?? 8;
    const isDeepHorizon = (turn >= deepHorizon || (typeof step === 'number' && step >= deepHorizon));
    if (isDeepHorizon && nonExemptCandidates.some((c) => c.chars >= this.minChars)) {
      return {
        shouldNudge: true,
        tier: 'budget',
        reason: 'DEEP_TURN_ATTENTION_DILUTION',
        candidateTargets: nonExemptCandidates
      };
    }

    return { shouldNudge: false, reason: 'HEALTHY_BOUNDS', candidateTargets: [] };
  }
}

export default WillingnessTracker;
