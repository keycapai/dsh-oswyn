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
  if (findSummaryBlock(text) || findReplySummaryBlock(text)) return true;
  if (text.includes('```result-summary') || text.includes('```dsh-result-summary') || text.includes('```reply-summary') || text.includes('```dsh-reply-summary')) return true;
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

    this.consecutiveUncompressedSteps = 0;
    this.accumulatedUncompressedChars = 0;
    this.lastCompressStep = null;
    this.lastNudgeStep = null;
    this.totalStepsRecorded = 0;
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
  }

  reset() {
    this.consecutiveUncompressedSteps = 0;
    this.accumulatedUncompressedChars = 0;
    this.lastCompressStep = null;
    this.lastNudgeStep = null;
    this.totalStepsRecorded = 0;
  }

  recordNudgeEmitted(step) {
    this.lastNudgeStep = step;
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

  updateStep({ turn, step, outgoingMessages, incomingDecision }) {
    this.totalStepsRecorded++;
    const assistantText = extractMessageText(incomingDecision);
    const hasDistillation = hasDistillationFence(assistantText);

    if (hasDistillation) {
      this.consecutiveUncompressedSteps = 0;
      this.accumulatedUncompressedChars = 0;
      this.lastCompressStep = step;
      return;
    }

    // Inspect trailing tool outputs in outgoingMessages
    const trailingCandidates = this.collectCandidates(outgoingMessages);
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

    // 3. Active compliance silence: model compressed in immediately preceding step
    if (this.lastCompressStep !== null && this.lastCompressStep === step - 1) {
      return { shouldNudge: false, reason: 'ALREADY_COMPRESSED', candidateTargets: [] };
    }

    // 4. Cooldown window
    if (this.lastNudgeStep !== null && (step - this.lastNudgeStep < this.cooldownSteps)) {
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
    if (this.consecutiveUncompressedSteps >= this.uncompressedStepThreshold) {
      return {
        shouldNudge: true,
        tier: 'contractual',
        reason: 'CONSECUTIVE_UNCOMPRESSED_INERTIA',
        candidateTargets: nonExemptCandidates
      };
    }

    // 8. Accumulated payload bloat trigger (including current incoming candidate chars)
    const currentPendingChars = nonExemptCandidates.reduce((acc, c) => acc + c.chars, 0);
    if ((this.accumulatedUncompressedChars + currentPendingChars) >= this.accumulatedPayloadThreshold) {
      return {
        shouldNudge: true,
        tier: 'budget',
        reason: 'CUMULATIVE_PAYLOAD_BLOAT',
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
