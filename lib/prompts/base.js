/**
 * dsh-oswyn/prompts/base — shared protocol constants, decision tree, and
 * dual-track reply summary sections (Optimized P3 + v2.1 Capability-Boundary
 * Formula-Safe Verbatim & Final-Turn Reasoning-First Exemption).
 *
 * @module dsh-oswyn/prompts/base
 */

export const PROTOCOL_SECTION = 'oswyn:protocol';
export const SUMMARY_OPEN_TAG = 'dsh-result-summary';
export const REPLY_SUMMARY_OPEN_TAG = 'dsh-reply-summary';
export const STRIP_PLACEHOLDER = '_（总结中…）_';

/** Shared opening principles and the core Discard vs. Compress boundary table. */
export function buildProtocolHeaderLines(presetSectionLines = []) {
  return [
    '## DSH-OSWYN: Tool Context & Output Optimization',
    '',
    'Tool outputs take up 80%+ of conversation context. To prevent context bloat and focus loss, you MUST proactively compress or discard preceding tool calls using an interleaved ```' + SUMMARY_OPEN_TAG + ' block at the start of every turn following a tool execution.',
    '',
    '### Core Boundary: Discard (Replaces Input + Output) vs. Compress (Replaces Output Only)',
    '- **丢弃 (Discard: `discard` / `discard entire-ptc` / `cascade`) — 同时替换输入 + 输出 (`before = inputChars + outputChars`)**:',
    '  - Clears matching tool-call input `arguments` to \'{}\' AND replaces output with a 1-line fact. Use immediately for failed tool calls, errors, or one-off scripts.',
    '- **压缩 (Compress: `truncate` / `replace`) — 只替换输出，保留输入 (`before = outputChars`)**:',
    '  - Keeps tool input `arguments` 100% intact for traceability, and ONLY shrinks tool output.',
    '',
    ...presetSectionLines,
    '**Proactive 3-Step Decision Tree (Run after EVERY tool step)**:',
    '  1. **Step 1 — Did the tool FAIL or throw an error?** $\\rightarrow$ Line 1 **`discard`** (1-line root cause, clears error stack + broken input; **preserve any active assertion parameters or failure constants verbatim**).',
    '  2. **Step 2 — Is tool output a long log, scan, or command dump?** $\\rightarrow$ Line 1 **`truncate keep 15 lines`** (preserves prefix for 100% KV-cache hit).',
    '  3. **Step 3 — Did you read exploratory / non-target code or broad search results?** $\\rightarrow$ Line 1 **`replace`** (1-3 concise fact bullets; **FORMULA-SAFE VERBATIM RULE: you MUST copy all mathematical formulas, divisors, bitwise/modulo expressions (`+`, `-`, `*`, `/`, `%`, `^`, `&`), constants, and branch thresholds VERBATIM—NEVER paraphrase an exact formula into vague prose!**).',
    '  - **When to Skip (Keep Resident)**: Keep active target source code, reusable multi-round loop functions, and configs you are actively editing untouched.',
    '  - **Final-Turn Reasoning-First Exemption**: When you are on your final answer turn (no further tool calls needed) and solving a complex mathematical/algorithmic proof or bitwise calculation, you may skip `' + SUMMARY_OPEN_TAG + '` and `' + REPLY_SUMMARY_OPEN_TAG + '` on that final turn to focus 100% of attention on exact step-by-step arithmetic, factorization, and boundary verification.',
    ''
  ];
}

/** Shared syntax reference and dual-track reply section. */
export function buildProtocolBodyLines() {
  return [
    '### 1. Tool Call Compression Directives (First line MUST specify the mode)',
    '- Immediately at the start of your message following a tool call, output a ```' + SUMMARY_OPEN_TAG + ' fence:',
    '  - **Failed Tool / Error Dump** $\\rightarrow$ Use `discard` (keep exact error numbers/constants):',
    '    ```' + SUMMARY_OPEN_TAG,
    '    discard',
    '    - Failed at worker_17 (ACTIVE_PROD_PRIMARY): initialTokens=190, burstSec=14, rawSkewMs=1750',
    '    ```',
    '  - **Verbose Log / Command Output** $\\rightarrow$ Use `truncate keep <N> lines`:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    truncate keep 15 lines',
    '    - 3 passed, 0 failed in test suite; active reserve PROD_SAFETY_RESERVE = 29',
    '    ```',
    '  - **Exploratory Code Read (Formula-Safe Verbatim)** $\\rightarrow$ Use `replace`:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    replace',
    '    - Read rate-limiter.ts: BUCKET_REFILL_RATE = 43; applyBurstWindow(tokens, burstSec, effectiveSkewMs) = tokens + (burstSec * 43) - Math.floor(effectiveSkewMs / 250)',
    '    ```',
    '- **Proactive Recall Gate (`tool_result_recall`)**: All pruned, replaced, or discarded outputs remain 100% readable via `tool_result_recall`. Before computing any final numerical answer that depends on an earlier compressed step, if any formula, divisor, slot, or loop rule is not 100% verbatim in the summary, call `tool_result_recall(call_id)` first—never guess!',
    '',
    '### 2. Dual-Track Assistant Reply Projection (User vs. Next-Turn Self)',
    'Every substantive intermediate assistant response MUST end with a ```' + REPLY_SUMMARY_OPEN_TAG + ' block:',
    '- **Free-Form Key-Detail Memo (No Rigid Template)**: Write natural, information-dense bullets tailored to what this reply accomplished. Do NOT force fixed boilerplate headings like `STATUS & VERIFICATION` or `OPEN ITEMS` — open items rarely exist; omit them unless unfinished work remains.',
    '- **Preserve Critical Answer Details**: Retain concrete facts your next-turn self will need: exact file paths with line numbers, key constants/hashes, verbatim formulas, error root causes, and verification outcomes.',
    '- **Example**:',
    '  ```' + REPLY_SUMMARY_OPEN_TAG,
    '  - Root cause & fix: RingBuffer overflow in src/core/worker.ts:84; resized cap to 2048 (16/16 passed).',
    '  - Key details: HMAC secret unchanged; QUEUE_DRAIN_TIMEOUT_MS = 4500.',
    '  ```',
    ''
  ];
}
