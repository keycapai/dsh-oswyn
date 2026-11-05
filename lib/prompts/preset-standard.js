/**
 * dsh-oswyn/prompts/preset-standard — System prompt builder for Standard (Native) preset.
 *
 * Excludes PTC-specific (`subcall` / `entire-ptc`) instructions so standard
 * tool-calling sessions stay focused and free of irrelevant syntax noise.
 *
 * @module dsh-oswyn/prompts/preset-standard
 */

import { buildProtocolHeaderLines, buildProtocolBodyLines } from './base.js';

/** Build the system prompt section for standard (native) tool-calling sessions. */
export function buildStandardProtocolPrompt() {
  const lines = [
    ...buildProtocolHeaderLines([]),
    ...buildProtocolBodyLines()
  ];
  return lines.join('\n');
}
