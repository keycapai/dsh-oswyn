/**
 * dsh-oswyn/prompts/base — shared protocol constants, decision tree, and
 * dual-track reply summary sections.
 *
 * Explicitly distinguishes:
 *   - 丢弃 (Discard: replaces BOTH tool-call input arguments AND tool-result output)
 *   - 压缩 (Compress: replaces ONLY tool-result output, keeping input arguments intact)
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
    '## DSH-OSWYN: Only See What You Need (Context & Cache Optimization)',
    '',
    'You are in full control of your context window. As sessions grow, re-sending massive historical tool outputs, oversized one-off tool inputs, and redundant verbose replies drains token budget and degrades focus.',
    '**Principle**: "Only See What You Need (OSWYN)" — after every tool step, proactively evaluate the step and emit a `' + SUMMARY_OPEN_TAG + '` fence whenever the raw output or one-off input is no longer needed verbatim.',
    '',
    '### Core Boundary: Discard (Replaces Input + Output) vs. Compress (Replaces Output Only)',
    '- **丢弃 (Discard: `discard` / `discard entire-ptc` / `cascade`) — 同时替换输入 + 输出 (`before = inputChars + outputChars`)**:',
    '  - Clears the matching tool call\'s input `arguments` to `\'{}\'` AND replaces the `tool/result` output with a 1-line fact.',
    '  - **Crucial Rule for Large-Input / Short-Output Calls**: When a tool call has large input arguments (e.g., a long `run_code` script, a big `validate_dsh_ui` spec, or a failed command) but a short output (e.g., 100 chars), you **MUST use `discard` (or `prune-call`)** to reclaim the input tokens. Never use `replace` on a short output — `replace` only compares against `outputChars` and will be rejected as `not worth it`!',
    '- **压缩 (Compress: `truncate` / `replace`) — 只替换输出，保留输入 (`before = outputChars`)**:',
    '  - Keeps the tool call\'s input `arguments` 100% intact in context for traceability, and ONLY shrinks the `tool/result` output.',
    '  - Use `truncate` or `replace` ONLY when the tool output itself is large (e.g. >= 300 chars) and your rewrite is strictly shorter than the original output.',
    '',
    ...presetSectionLines,
    '**Proactive 3-Step Decision Tree (Run after EVERY tool step)**:',
    '  1. **Step 1 — Should I DISCARD (Input + Output)?** If the call failed (`exitCode != 0` / exception), was a one-off validation (`validate_dsh_ui`), returned 0 matches / not found, or was a one-off script whose input + output are no longer needed → **emit `discard` immediately**.',
    '  2. **Step 2 — Can I TRUNCATE (Output Only, Zero Summary Cost)?** If the output is a long log, test run, directory scan, or command dump (>= 20 lines or >= 600 chars) where the leading lines are sufficient → **prefer `truncate keep <N> lines`** (preserves byte-0 prefix for 100% KV-cache hit).',
    '  3. **Step 3 — Should I REPLACE (Output Only, Distill Facts)?** If you read exploratory/non-target code or ran a broad search (>= 600 chars output) just to understand control flow or locate files → **emit `replace` with 1-3 concise fact bullets (< 30% of original output length)**.',
    '  - **When to Skip (Keep Resident)**: Keep task-critical source code/configs you are actively editing untouched, and skip fences when both input and output are already short (< 300 chars total).',
    'OSWYN only *prompts* you here — you make the active decision and choose the exact cut point.',
    ''
  ];
}

/** Shared syntax reference, automatic fallback rules, and dual-track reply section. */
export function buildProtocolBodyLines() {
  return [
    '### 1. Tool Output & Input Optimization (Zero-Overhead Interleaved Markdown Fence)',
    '- **Interleaved Decision (Zero Extra Turns)**: At the start of your reply or next step text, include a ```' + SUMMARY_OPEN_TAG + ' block to rewrite the preceding tool step. NEVER spend an extra tool call round just to summarize!',
    '- **Strict Closing Fence Newline Rule (严禁闭合围栏同行紧贴正文)**: The closing ``` of `' + SUMMARY_OPEN_TAG + '` MUST be on its own line and followed by a newline `\\n` before any reply prose or `dsh-ui` block (NEVER write ```正文 on the same line, or CommonMark will swallow your reply prose and `dsh-ui` block into the hidden summary fence!).',
    '- **Explicit Syntax Definition (Choose your mode)**:',
    '  - **Mode A: Truncate (只替换输出 · KV-Cache Preserving Prefix Retention — first choice for logs/tests/scans)**:',
    '    `truncate keep <N> lines` or `truncate keep <N> chars`',
    '    `<N>` is a decision you make from what later steps still need — never copy a threshold constant. A bare `truncate` without N falls back to the configured keep line count (default 30).',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    truncate keep 20 lines',
    '    - 3 passed, 0 failed in test suite',
    '    ```',
    '    (Guarantees lines 1..N are kept strictly from index 0 byte-for-byte for 100% KV-cache hit; only the tail is pruned. 【压缩边界：只替换输出】：工具调用入参 arguments 完整保留，仅截断返回结果。)',
    '  - **Mode B: Replace (只替换输出 · Fact Distillation — for exploratory code reads/search/grep/glob)**:',
    '    `replace`  ← the first line must name the mode explicitly (summary must be < 30% of original output length)',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    replace',
    '    - Read lib/storage.js: confirmed atomic JSON store, not the cause of this bug',
    '    ```',
    '    (Replaces bulky exploratory outputs with concise discovered facts. 【压缩边界：只替换输出】：调用入参 arguments 完整保留，仅替换返回结果；切勿对短输出使用 replace。)',
    '  - **Mode C: Discard (替换输入+输出 · Full Input & Output Discard — for failed / validation / obsolete exploratory calls)**:',
    '    `discard` followed by the single fact worth remembering.',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    discard',
    '    - 该 API 不存在（404），已改用 lib/core/parse.js',
    '    ```',
    '    (【丢弃边界：同时替换输入与输出】：不仅返回结果整段替换为一行事实，对应的工具调用参数 arguments 也会被同步清空为 \'{}\'，彻底回收废弃入参和输出的全部 Token。完整原文可通过 `tool_result_recall` 零损耗召回。)',
    '- **Targeting**: default is the latest tool result. Add `seq <N>` or `seq <tool_name>` on the first line to retarget a specific earlier call.',
    '- **Cascade (级联回溯消噪)**: add `cascade` or `prune-failures` to also fold this turn\'s prior *failed* attempt inputs and outputs into one-line facts once a retry has succeeded.',
    '- **Tool-Call Input Rewriting (单独压缩超长调用输入参数，保留输出)**:',
    '  - `prune-call` / `prune-args`: shrink the matching tool-call\'s oversized arguments (long `code`/`spec`) into a short placeholder while keeping the tool output intact.',
    '  - `stub-call`: aggressively stub long argument bodies with a brief pseudocode placeholder (ideal after a large script has succeeded and you only need its output).',
    '- **Failed Calls & Stack Traces (Special Rule)**: When a command or tool fails (`exitCode != 0`, `ToolCallError`, `SyntaxError`, `Traceback`), NEVER leave stack traces or broken script inputs in context! Use `discard` to clear both the failed input arguments (`{}`) and stack trace into a 1-line root cause.',
    '- **Zero-Risk Recall**: Pruned, replaced or discarded outputs remain 100% readable at any time via `tool_result_recall`.',
    '',
    '### 1b. Automatic Fallback, Auto-Discard & Protection Rules',
    '- **自动截断规则 (Automatic Output Truncation)**: At each step boundary, oversized outputs (over `autoCompressMinChars`, default 4000 chars) from tools NOT in the protected list (e.g., verbose `bash` outputs) are automatically truncated to the first `autoCompressKeepLines` lines (default 30), preserving the KV-cache prefix byte-for-byte; input arguments stay untouched.',
    '- **核心工具绝对保护 (Protected Tools Immunity)**: `run_code`, `read`, `write`, `edit`, `apply_patch` are protected by default and can NEVER be auto-compressed or auto-truncated. Reading code and modifying files stay 100% resident unless you explicitly emit a `dsh-result-summary` fence.',
    '- **自动丢弃规则 (Automatic Input + Output Discard)**: When a command fails (`exitCode != 0`, stack traces) or belongs to pure-validation tools (like `validate_dsh_ui`), OSWYN automatically discards it at the next step boundary into a 1-line fact AFTER you have seen it once. In Native mode, the failed call\'s arguments are cleared to `{}`; in PTC mode, only that specific subcall is marked discarded unless all subcalls were discarded.',
    '- **One-call opt-out**: To keep one specific tool result untouched, include a `dsh-result-summary` block with `protect` (or `no-compress`) and optionally `seq <N>`:',
    '  ```' + SUMMARY_OPEN_TAG,
    '  seq <N>',
    '  protect',
    '  - reason: keep this output verbatim',
    '  ```',
    '- **Tool protection list**: To add a tool name to the protected list for this workspace, call `oswyn_protect_tool` with `{"tool": "tool_name", "protected": true}`.',
    '',
    '### 2. Dual-Track Assistant Reply Projection (User vs. Next-Turn Self)',
    'Every substantive assistant response MUST end with a ```' + REPLY_SUMMARY_OPEN_TAG + ' block. This keeps future context lean while the user sees the complete detailed reply in the chat UI:',
    '- **Free-Form Key-Detail Memo (No Rigid Template)**: Write natural, information-dense bullets tailored to what this reply actually did or answered. Do NOT force fixed boilerplate headings like `DENSE DECISION-COMPLETE MEMO`, `STATUS & VERIFICATION`, or `OPEN ITEMS` — open items rarely exist; omit them entirely unless real unfinished work remains.',
    '- **Preserve Critical Answer Details**: Retain the concrete substance your next-turn self will need without re-reading the full prose — core conclusions, root causes, design rationale, key data/metrics, exact file paths with line numbers (`lib/core/plan.js:1-40`), symbol/function names, active config/command values, and verification results.',
    '- **Example**:',
    '  ```' + REPLY_SUMMARY_OPEN_TAG,
    '  - Root cause & fix: `rescueMergedResultFence` in `lib/client.js:1032-1081` splits glued closing fences before `dsh-ui` blocks; `test/realistic-fold.test.js` (8/8 passed).',
    '  - Key details: Preserves inline markdown formatting in rescued prose; leaves normal code blocks (`json`, `bash`, `dsh-ui`) untouched.',
    '  ```',
    "- **Strict Current-Turn Exclusivity & Overwrite Rule**: Summarize ONLY the current turn's verified conclusions, key details, and active state. NEVER copy forward superseded or obsolete facts from earlier history; when state changes (e.g., renamed symbol, updated config/port), record ONLY the new active state.",
    'The user in the Web UI sees the full prose response. On next turns, only this memo enters LLM context, keeping context window usage minimal and the prompt cache stable.',
    ''
  ];
}
