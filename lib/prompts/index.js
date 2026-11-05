/**
 * dsh-oswyn/prompts — Barrel for modular protocol prompts and smart nudges.
 *
 * @module dsh-oswyn/prompts
 */

import {
  PROTOCOL_SECTION,
  SUMMARY_OPEN_TAG,
  REPLY_SUMMARY_OPEN_TAG,
  STRIP_PLACEHOLDER
} from './base.js';
import { buildStandardProtocolPrompt } from './preset-standard.js';
import { buildPtcProtocolPrompt } from './preset-ptc.js';
import { collectNudgeCandidates, buildNudgePromptText } from './nudge.js';

export {
  PROTOCOL_SECTION,
  SUMMARY_OPEN_TAG,
  REPLY_SUMMARY_OPEN_TAG,
  STRIP_PLACEHOLDER,
  buildStandardProtocolPrompt,
  buildPtcProtocolPrompt,
  collectNudgeCandidates,
  buildNudgePromptText
};

/**
 * Build the protocol prompt section injected into the model system prompt,
 * dispatching to the `ptc` or `standard` preset prompt builder.
 */
export function protocolText(mode = 'native') {
  return mode === 'ptc'
    ? buildPtcProtocolPrompt()
    : buildStandardProtocolPrompt();
}
