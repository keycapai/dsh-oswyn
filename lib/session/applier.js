/**
 * dsh-oswyn/session/applier — backward-compatible facade over the modular
 * architecture (`lib/core/primitives.js`, `lib/modes/*`, `lib/presets/*`).
 *
 * All implementation lives in focused single-responsibility modules:
 *   - `lib/core/primitives.js` : atomic `compressOutputOnly` & `discardInputAndOutput`, state maps
 *   - `lib/modes/truncate.js`  : active & auto prefix truncation (output-only)
 *   - `lib/modes/replace.js`   : active fact replacement (output-only)
 *   - `lib/modes/discard.js`   : active & auto discard (input + output), cascade, prune-call
 *   - `lib/modes/protect.js`   : per-call & tool-level protection
 *   - `lib/modes/reply-summary.js` : dual-track assistant reply memo projection
 *   - `lib/presets/standard.js`: fence & auto-policy orchestration
 *
 * @module dsh-oswyn/session/applier
 */

export {
  markAutoCompressSkip,
  isAutoCompressSkipped,
  markCallArgsDiscarded,
  isCallArgDiscarded,
  alreadyProcessed,
  markProcessed,
  resolveCallId,
  inspectToolCall,
  findLatestToolResult,
  resolveTarget,
  compressOutputOnly,
  discardInputAndOutput
} from '../core/primitives.js';

export {
  applyAutoTruncate as autoCompressToolResult,
  applyAutoDiscard as autoDiscardToolResult,
  applyCallArgRewrite
} from '../modes/index.js';

export {
  applyFromAssistantMessage
} from '../presets/standard.js';

export { analyze } from './retain.js';
