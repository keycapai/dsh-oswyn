/**
 * dsh-oswyn/prompts/base — shared protocol constants, decision tree, and
 * dual-track reply summary sections (Optimized P3 + v2.1 Capability-Boundary
 * Formula-Safe Verbatim & Final-Turn Reasoning-First Exemption).
 *
 * @module dsh-oswyn/prompts/base
 */

export const PROTOCOL_SECTION = 'oswyn:protocol';
export const SUMMARY_OPEN_TAG = 'result-summary';
export const REPLY_SUMMARY_OPEN_TAG = 'reply-summary';
export const LEGACY_SUMMARY_OPEN_TAG = 'dsh-result-summary';
export const LEGACY_REPLY_SUMMARY_OPEN_TAG = 'dsh-reply-summary';
export const STRIP_PLACEHOLDER = '_（总结中…）_';

/** Shared opening principles, mode boundary, and decision rules. */
export function buildProtocolHeaderLines(presetSectionLines = []) {
  return [
    '## DSH-OSWYN: Context Distillation Protocol',
    '',
    'After any tool execution, emit a ```' + SUMMARY_OPEN_TAG + ' fence at the start of your message — **including before/alongside subsequent tool calls** (never leave message text empty when compressing noisy output).',
    '',
    '### 1. Tool Result Compression (`' + SUMMARY_OPEN_TAG + '`)',
    'First line specifies the mode, followed by 1–3 concise fact bullets:',
    '- **`discard`** (replaces input args → `{}` AND output): failed/errored calls or one-off probes; keep root cause and failure constants verbatim.',
    '- **`truncate keep 15 lines`** (replaces output only, keeps input): long logs, test runs, or command dumps (preserves prefix for KV-cache hit).',
    '- **`replace`** (replaces output only, keeps input): exploratory code reads or broad searches; **copy all formulas, operators (`+ - * / % ^ &`), constants, and thresholds verbatim**.',
    '',
    ...presetSectionLines,
    '- **Keep Resident (Skip)**: active target source code, reusable loop helpers, and configs you are currently editing.',
    '- **Final-Turn Exemption**: on a final answer turn with complex math/algorithmic derivation (no more tool calls), you may skip `' + SUMMARY_OPEN_TAG + '`.',
    '- **Recall Gate**: original outputs remain readable via `tool_result_recall(seq)` or `history_recall(round, step)`. Call recall before computing any final answer if an earlier formula/constant is not verbatim in the summary.',
    ''
  ];
}

/** Shared compact syntax examples and dual-track reply section. */
export function buildProtocolBodyLines() {
  return [
    'Syntax:',
    '```' + SUMMARY_OPEN_TAG,
    'truncate keep 15 lines',
    '- 3 passed, 0 failed; SAFETY_RESERVE = 29',
    '```',
    '',
    '### 2. Dual-Track Reply Memo (`' + REPLY_SUMMARY_OPEN_TAG + '`)',
    'End every substantive user-facing reply (>200 chars; skip trivial 1–2 line replies) with a ```' + REPLY_SUMMARY_OPEN_TAG + ' block (1–4 dense, free-form bullets for your next-turn self: file paths + line numbers, constants, verbatim formulas, root causes, and verification results):',
    '```' + REPLY_SUMMARY_OPEN_TAG,
    '- Fixed RingBuffer overflow in src/core/worker.ts:84 (cap → 2048; 16/16 passed); QUEUE_DRAIN_TIMEOUT_MS = 4500.',
    '```',
    ''
  ];
}
