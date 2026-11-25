/**
 * dsh-oswyn/prompts/preset-ptc — System prompt builder for PTC (`run_code`) preset.
 *
 * Includes dedicated rules for `run_code` envelope compression and explicitly
 * distinguishes:
 *   - Subcall-only compression/discard (preserves outer `run_code` input script)
 *   - Whole-PTC discard (`discard entire-ptc`: clears outer `run_code` input script + all outputs)
 *
 * @module dsh-oswyn/prompts/preset-ptc
 */

import { buildProtocolHeaderLines, buildProtocolBodyLines } from './base.js';

const PTC_HEADER_LINES = [
  '- **PTC Mode (`run_code`)**: Write ONE `result-summary` fence targeting the outer `run_code` seq with 1 bullet per subcall (never one fence per subcall):',
  '  - **Subcall-only compress/discard** (`truncate keep <N> lines` or `replace` listing `- <subcall>: discard`): shrinks output only, keeping the outer `run_code` script intact.',
  '  - **Whole-PTC discard** (`discard entire-ptc`): clears outer `run_code` script args + all outputs for failed or one-off scripts.',
  '  - **Script-only shrink** (`prune-call` / `stub-call`): collapses long outer script args while keeping short output.',
  ''
];

/** Build the system prompt section for PTC (`run_code`) sessions. */
export function buildPtcProtocolPrompt() {
  const lines = [
    ...buildProtocolHeaderLines(PTC_HEADER_LINES),
    ...buildProtocolBodyLines()
  ];
  return lines.join('\n');
}
