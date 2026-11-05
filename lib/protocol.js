/**
 * dsh-oswyn/protocol — backward-compatible facade over `lib/prompts/*`.
 *
 * Pure module: no node:fs, no ctx, no side effects.
 *
 * @module dsh-oswyn/protocol
 */

export {
  PROTOCOL_SECTION,
  SUMMARY_OPEN_TAG,
  REPLY_SUMMARY_OPEN_TAG,
  STRIP_PLACEHOLDER,
  protocolText,
  buildStandardProtocolPrompt,
  buildPtcProtocolPrompt,
  collectNudgeCandidates,
  buildNudgePromptText
} from './prompts/index.js';
