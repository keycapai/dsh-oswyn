/**
 * dsh-oswyn/protocol — protocol tokens + model-facing system prompt text.
 *
 * Pure module: no node:fs, no ctx, no side effects.
 *
 * @module dsh-oswyn/protocol
 */

export const PROTOCOL_SECTION = 'oswyn:protocol';
export const SUMMARY_OPEN_TAG = 'dsh-result-summary';
export const REPLY_SUMMARY_OPEN_TAG = 'dsh-reply-summary';
export const STRIP_PLACEHOLDER = '_（总结中…）_';

/**
 * Build the protocol prompt section injected into the model system prompt.
 * Describes every supported directive: truncate / replace / discard /
 * prune-call / stub-call / cascade. Chinese forward-facing copy is used for
 * the human readability of examples; directive keywords stay ASCII.
 *
 * NOTE: no scissor / ✂ glyph anywhere — this copy is intentionally plain.
 *
 * @returns {string}
 */
export function protocolText(mode = 'native') {
  const lines = [
    '## DSH-OSWYN: Only See What You Need (Context & Cache Optimization)',
    '',
    'You are in full control of your context window. As sessions grow, re-sending massive historical tool outputs and redundant verbose replies drains token budget and degrades focus.',
    '**Principle**: "Only See What You Need (OSWYN)" — you autonomously decide whether to summarize, where to cut, what to discard, and what to keep.',
    ...(mode === 'ptc' ? [
      '**PTC MODE**: `run_code` is your only direct tool. A single program can call multiple tools; the outer `run_code` result is ONE compression unit. Write ONE `dsh-result-summary` fence targeting the outer `run_code` seq and list one bullet per subcall (name / status / key result / error). NEVER write one fence per subcall — subcalls are not separate surface nodes.',
      '- **PTC 丢弃范围判定 (整个 PTC vs 单个子调用)**:',
      '  - **仅丢弃某个子调用 (Subcall Discard)**: 当 run_code 中某个子调用失败或纯属校验废弃（如 validate_dsh_ui 或摸索失败），在 bullet 列表中声明该子调用丢弃（如 `- validate_dsh_ui: discard` 或提炼事实）。**严禁丢弃外层 run_code！此时外层 run_code 的入参代码以及其余子调用的结果完整保留！**',
      '  - **丢弃整个 PTC (Whole-PTC Discard)**: 仅当整个 run_code 脚本彻底无用或崩溃时，才在指令中指明丢弃整个 PTC（如 `discard entire-ptc`），此时外层代码入参与全部输出一并清空。',
      ''
    ] : []),
    '**KEEP RESIDENT (task-critical)**: source code, configs, or document sections that are directly relevant to your current editing task and must be referenced verbatim for precise modifications. Keep these intact.',
    '**REPLACE / DISCARD (exploratory code & noisy outputs)**:',
    '  - **Exploratory / Non-target Code**: when locating bugs, you often read many files before finding the right one. Irrelevant or background code you read only to understand control flow should NOT stay in context. **Replace it with your understanding of its working logic (Mode B: replace)**, e.g. "Read lib/storage.js: confirmed atomic JSON store, not the cause of this bug".',
    '  - **Bulky & Ephemeral Outputs**: build/test logs, huge directory scans, command dumps, and failed attempts with noisy stack traces. Compress or discard these so the context stays lean.',
    'OSWYN only *prompts* you here — nothing is compressed automatically; the decision and the cut point are yours.',
    '',
    '### 1. Tool Output Optimization (Zero-Overhead Interleaved Markdown Fence)',
    '- **Interleaved Decision (Zero Extra Turns)**: In your reply text, simply include a ```' + SUMMARY_OPEN_TAG + ' block to rewrite the preceding tool output. NEVER spend an extra tool call round just to summarize!',
    '- **Strict Closing Fence Newline Rule (严禁闭合围栏同行紧贴正文)**: The closing ``` of `' + SUMMARY_OPEN_TAG + '` MUST be on its own line and followed by a newline `\\n` before any reply prose or `' + 'dsh-ui' + '` block (NEVER write ```正文 on the same line, or CommonMark will swallow your reply prose and `dsh-ui` block into the hidden summary fence!).',
    '- **Explicit Syntax Definition (Choose your mode)**:',
    '  - **Mode A: Truncate (KV-Cache Preserving Prefix Retention — recommended for long logs/tests/scans)**:',
    '    `truncate keep <N> lines` or `truncate keep <N> chars`',
    '    `<N>` is a decision you make from what later steps still need — never copy a threshold constant. A bare `truncate` without N falls back to the configured keep line count (default 30).',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    truncate keep 20 lines',
    '    - 3 passed, 0 failed in test suite',
    '    ```',
    '    (Guarantees lines 1..N are kept strictly from index 0 byte-for-byte for 100% KV-cache hit; only the tail is pruned. 【压缩边界】：截断仅压缩返回的结果，工具调用入参 arguments 完整保留以供溯源。)',
    '  - **Mode B: Replace (recommended for search/glob/grep/discovery)**:',
    '    `replace`  ← the first line must name the mode explicitly',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    replace',
    '    - Searched ~/.dsh/profiles, 0 matches found; confirmed file does not exist',
    '    ```',
    '    (Completely replaces noisy path lists or empty traces with concise discovered facts. 【压缩边界】：替换仅压缩返回的结果，调用入参 arguments 完整保留。A bare summary without a directive is treated as replace for compatibility.)',
    '  - **Mode C: Discard (整段丢弃 — 包含调用参数完整丢弃) — recommended for exploratory / failed calls you will never re-read**:',
    '    `discard` followed by the single fact worth remembering.',
    '    示例:',
    '    ```' + SUMMARY_OPEN_TAG,
    '    discard',
    '    - 该 API 不存在（404），已改用 lib/core/parse.js',
    '    ```',
    '    (【完整丢弃原则】：丢弃需要完整丢弃包括调用参数！不仅输出整段丢弃仅留一条事实，对应的工具调用参数 arguments 也会被同步清空为 \'{}\'，彻底切除废弃调用的上下文残留。完整原文可通过 `tool_result_recall` 零损耗召回。)',
    '- **Targeting**: default is the latest tool result. Add `seq <N>` or `seq <tool_name>` on the first line to retarget a specific earlier call.',
    '- **Cascade (级联回溯消噪)**: add `cascade` or `prune-failures` to also fold this turn\'s prior *failed* attempt outputs into one-line facts once a retry has succeeded.',
    '- **Tool-Call Rewriting (压缩工具调用本身)**:',
    '  - `prune-call` / `prune-args`: shrink the matching tool-call\'s oversized arguments (long `code`/`spec`) into a short placeholder, keeping every other field intact.',
    '  - `stub-call`: same replacement, but aggressively stub long argument bodies with a brief pseudocode placeholder (use for huge scripts you have already run and no longer need verbatim).',
    '- **Failed Calls & Stack Traces (Special Rule)**: When a command or tool fails (exitCode != 0, ToolCallError, SyntaxError, Traceback), NEVER leave dozens of internal runtime stack lines in context! Use `replace` to keep 1 line of root cause + location, or `discard` it entirely. 【失败调用完整丢弃】：失败调用的报错堆栈被丢弃的同时，其对应的工具调用参数 arguments 也会被彻底清空为 \'{}\'。The complete original remains 100% accessible via `tool_result_recall`.',
    '- **Zero-Risk Recall**: Pruned, replaced or discarded outputs remain 100% readable at any time via `tool_result_recall`.',
    '',
    '### 1b. Automatic Fallback, Auto-Discard & Protection Rules',
    '- **自动截断规则 (Automatic Truncation)**: At each step boundary, oversized outputs (over `autoCompressMinChars`, default 4000 chars) from tools NOT in the protected list (e.g., verbose `bash` outputs) are automatically truncated to the first `autoCompressKeepLines` lines (default 30), preserving the KV-cache prefix byte-for-byte; the tail is archived in ledger and readable via `tool_result_recall`.',
    '- **核心工具绝对保护 (Protected Tools Immunity)**: `run_code`, `read`, `write`, `edit`, `apply_patch` are protected by default and can NEVER be auto-compressed or auto-truncated. Reading code and modifying files stay 100% resident unless you explicitly request truncation.',
    '- **自动丢弃规则 (Automatic Discard)**: When a command fails (`exitCode != 0`, stack traces) or belongs to pure-validation tools (like `validate_dsh_ui`), OSWYN automatically discards the noisy failure dump at the next step boundary into a 1-line fact, AFTER the model has seen it once. In Native mode, the failed call\'s arguments are cleared to `{}`; in PTC mode, only that specific subcall is marked discarded, without wiping out outer `run_code` script arguments.',
    '- **One-call opt-out**: To keep one specific tool result untouched, include a `dsh-result-summary` block with `protect` (or `no-compress`) and optionally `seq <N>`:',
    '  ```' + SUMMARY_OPEN_TAG,
    '  seq <N>',
    '  protect',
    '  - reason: keep this output verbatim',
    '  ```',
    '- **Tool protection list**: To add a tool name to the protected list for this workspace, call `oswyn_protect_tool` with `{\"tool\": \"tool_name\", \"protected\": true}`.',
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
  return lines.join('\n');
}
