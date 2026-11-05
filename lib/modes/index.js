/**
 * dsh-oswyn/modes — barrel exporting all compression and discard mode strategies.
 *
 *   - truncate.js      : Mode A — Prefix truncation (Compress Output Only)
 *   - replace.js       : Mode B — Fact replacement (Compress Output Only)
 *   - discard.js       : Mode C/D — Full discard (Replaces Input + Output), cascade, prune-call
 *   - protect.js       : Mode E — Per-call & tool-level protection
 *   - reply-summary.js : Mode F — Dual-track assistant reply memo projection
 *
 * @module dsh-oswyn/modes
 */

export {
  normalizeTruncateDirective,
  applyActiveTruncate,
  applyAutoTruncate
} from './truncate.js';

export {
  applyActiveReplace
} from './replace.js';

export {
  priorFailedToolResults,
  applyCascadeDiscard,
  applyActiveDiscardTargets,
  applyActivePruneCall,
  applyCallArgRewrite,
  applyAutoDiscard
} from './discard.js';

export {
  applyProtectToolDirective,
  applyProtectCallDirective
} from './protect.js';

export {
  applyReplySummary
} from './reply-summary.js';
