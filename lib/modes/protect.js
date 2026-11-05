/**
 * dsh-oswyn/modes/protect — Mode E: Per-Call & Tool-Level Protection.
 *
 * Semantics:
 *   - `protect` / `no-compress`: marks a specific tool/result seq so automatic
 *     policies (`autoCompressToolResult`, `autoDiscardToolResult`, `autoCompressPtcSubcalls`)
 *     never rewrite it.
 *   - `protect-tool <name>`: adds a tool name to the persistent protected list.
 *
 * @module dsh-oswyn/modes/protect
 */

import { markAutoCompressSkip } from '../core/primitives.js';
import { getToolName } from '../session/surface.js';
import { addProtectedTool } from '../store/ledger.js';

/** Handle `protect-tool <name>` directive. */
export function applyProtectToolDirective(protectToolName) {
  if (!protectToolName) return null;
  try { addProtectedTool(protectToolName, true); } catch (_) {}
  return protectToolName;
}

/** Handle per-call `protect` / `no-compress` directive on a resolved target. */
export function applyProtectCallDirective(session, target, parsed) {
  markAutoCompressSkip(session, target.seq);
  return {
    seq: target.seq,
    toolName: getToolName(session, target.event) || '',
    reason: parsed.summary || ''
  };
}
