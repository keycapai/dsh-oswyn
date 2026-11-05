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
  '**PTC MODE**: `run_code` is your only direct tool. A single program can call multiple tools; the outer `run_code` result is ONE compression unit. Write ONE `dsh-result-summary` fence targeting the outer `run_code` seq and list one bullet per subcall (name / status / key result / error). NEVER write one fence per subcall — subcalls are not separate surface nodes.',
  '- **PTC 丢弃与压缩范围判定 (Whole-PTC Discard vs. Output-Only Compress)**:',
  '  - **只压缩/丢弃子调用输出（保留外层 `run_code` 脚本入参）**: 当 `run_code` 中仅某个子调用失败或需要压缩输出（如用 `truncate keep <N> lines` 截断长输出，或在 `replace` 列表中声明 `- validate_dsh_ui: discard`），**严禁丢弃外层 `run_code`！此时外层 `run_code` 的入参代码保留，仅替换外层返回结果（只替换输出）**。',
  '  - **丢弃整个 PTC (`discard entire-ptc`：同时清空外层代码入参 + 全部输出)**: 当整个 `run_code` 脚本执行报错、纯属一次性校验/探针、或脚本代码很长且执行完毕后不再需要保留脚本源码与输出时，使用 **`discard entire-ptc`**，此时外层 `run_code` 的大段代码入参（`arguments` → `\'{}\'`）与全部输出一并清空！',
  '  - **单独瘦身外层大脚本入参 (`prune-call` / `stub-call`)**: 若 `run_code` 脚本入参很长但输出很短且需保留输出结论，可使用 `prune-call` 或 `stub-call` 折叠外层代码入参。',
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
