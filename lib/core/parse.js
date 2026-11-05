/**
 * dsh-oswyn/core/parse — pure markdown-fence parsers for oswyn directives.
 *
 * Pure module: no node:fs, no node:path, no ctx, no side effects.
 * Accepts the fence tags as explicit params (defaults from protocol.js) so this
 * stays free of any runtime coupling while remaining the canonical parser.
 *
 * @module dsh-oswyn/core/parse
 */

const DEFAULT_SUMMARY_TAG = 'dsh-result-summary';
const DEFAULT_REPLY_TAG = 'dsh-reply-summary';

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOpenRe(tag) {
  // Matches ```<tag> optionally followed by ": header" or bare "header" on the same line.
  return new RegExp('\u0060\u0060\u0060' + escapeRe(tag) + '(?::\\s*([^\\n]*)|[ \\t]*([^\\n]*))?\\n', 'g');
}

function scanBlocks(text, tag) {
  if (typeof text !== 'string') return [];
  const openRe = buildOpenRe(tag);
  const results = [];
  let match;
  while ((match = openRe.exec(text)) !== null) {
    const rawHeader = (match[1] || match[2] || '').trim();
    const contentStart = openRe.lastIndex;
    const closeIdx = text.indexOf('\u0060\u0060\u0060', contentStart);
    if (closeIdx !== -1) {
      results.push({
        rawHeader,
        body: text.slice(contentStart, closeIdx).trim(),
        start: match.index,
        end: closeIdx + 3
      });
    }
  }
  return results;
}

/** Locate ALL tool-result summary fenced blocks (cascade / multi-target). */
export function findAllSummaryBlocks(text, tag = DEFAULT_SUMMARY_TAG) {
  return scanBlocks(text, tag);
}

/** Locate the LAST tool-result summary fenced block. */
export function findSummaryBlock(text, tag = DEFAULT_SUMMARY_TAG) {
  const all = scanBlocks(text, tag);
  return all.length ? all[all.length - 1] : null;
}

/** Locate the LAST assistant reply summary fenced block. */
export function findReplySummaryBlock(text, tag = DEFAULT_REPLY_TAG) {
  const all = scanBlocks(text, tag);
  return all.length ? all[all.length - 1] : null;
}

const DIRECTIVE_LINE_RE = /^(?:seq\b|subcall\b|entire-ptc\b|whole-ptc\b|truncate\b|replace\b|discard\b|keep\b|protect\b|no-compress\b|protect-tool\b|prune-call|prune-args|prune-code|prune-failures|stub-call|cascade|clean-call)/i;

/**
 * Parse a tool-result summary block (header + body) into a structured request.
 *
 * Recognized directives (header OR first body line):
 *   truncate keep <N> lines|chars   -> mode 'truncate'
 *   replace                         -> mode 'replace'
 *   discard                         -> mode 'discard'
 *   seq <N> | seq <tool_name>       -> target
 *   cascade / prune-failures        -> cascadePrune
 *   prune-call / prune-args         -> pruneCall
 *   stub-call                       -> stubCall (implies pruneCall)
 *
 * @returns {{
 *   targetSeq:(number|null), targetTool:(string|null), mode:'truncate'|'replace'|'discard',
 *   keepCount:(number|null), keepUnit:'chars'|'lines', cascadePrune:boolean,
 *   pruneCall:boolean, stubCall:boolean, summary:string, fact:string
 * }}
 */
export function parseSummaryBody(rawHeader, rawBody) {
  let targetSeq = null;
  let targetTool = null;
  let mode = 'replace';
  let keepCount = null;
  let keepUnit = 'chars';
  let fact = '';
  let protectTool = null;

  const lines = String(rawBody || '').split('\n');
  // Directives may span several leading lines: e.g.
  //   seq 329
  //   truncate keep 120 chars
  //   - fact...
  // Parse only that leading directive region, never the fact body (a fact such as
  // "replace X with Y" or "keep 20 rows" must not change the requested mode).
  const directiveParts = [];
  const rawHeaderText = String(rawHeader || '').trim();
  if (rawHeaderText) directiveParts.push(rawHeaderText);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (DIRECTIVE_LINE_RE.test(trimmed)) { directiveParts.push(trimmed); continue; }
    break; // first fact/prose line ends the directive region
  }
  const headerText = directiveParts.join(' ');
  const probe = headerText;

  // --- protect-tool / per-call protect directives ---
  const protectToolMatch = probe.match(/\bprotect-tool\s+([a-zA-Z0-9_.*-]+)/i);
  if (protectToolMatch) protectTool = protectToolMatch[1].toLowerCase().replace(/[^a-z0-9_.*-]/g, '');

  // --- mode ---
  // explicitMode stays null when the agent did not name a directive, so the
  // retention policy (not a silent default) decides what happens next.
  let explicitMode = null;
  if (protectTool) {
    mode = 'keep';
    explicitMode = 'keep';
  } else if (/\b(?:protect|no-compress)\b/i.test(probe)) {
    mode = 'keep';
    explicitMode = 'keep';
  } else if (/\bdiscard\b/i.test(probe)) {
    mode = 'discard';
    explicitMode = 'discard';
  } else {
    const truncateMatch = headerText.match(/\b(?:keep|retain|truncate)\s+(\d+)\s*(lines?|chars?|characters?)?/i);
    if (truncateMatch) {
      mode = 'truncate';
      explicitMode = 'truncate';
      keepCount = parseInt(truncateMatch[1], 10);
      const unit = (truncateMatch[2] || '').toLowerCase();
      keepUnit = unit.startsWith('line') ? 'lines' : 'chars';
    } else if (/\btruncate\b/i.test(probe)) {
      mode = 'truncate';
      explicitMode = 'truncate';
    } else if (/\breplace\b/i.test(probe)) {
      mode = 'replace';
      explicitMode = 'replace';
    } else if (/\b(?:prune-call|prune-args|stub-call|clean-call)\b/i.test(probe)) {
      mode = 'prune-call';
      explicitMode = 'prune-call';
    }
  }

  // --- seq target ---
  const seqMatch = headerText.match(/\bseq[:=\s]+(\d+)\b/i) || headerText.match(/\bseq[:=\s]+([a-zA-Z0-9_-]+)\b/i);
  if (seqMatch) {
    if (/^\d+$/.test(seqMatch[1])) targetSeq = parseInt(seqMatch[1], 10);
    else targetTool = seqMatch[1];
  }

  // --- subcall target / entire-ptc flag ---
  let targetSubcall = null;
  const subcallMatch = probe.match(/\bsubcall[:=\s]+([a-zA-Z0-9_-]+)\b/i);
  if (subcallMatch) targetSubcall = subcallMatch[1].toLowerCase();
  const entirePtc = /\b(?:entire-ptc|all-ptc|whole-ptc)\b/i.test(probe);

  // --- flags ---
  const cascadePrune = /\b(?:cascade|prune-failures|cascade-prune)\b/i.test(probe);
  const stubCall = /\bstub-call\b/i.test(probe);
  const pruneCall = stubCall || /\b(?:prune-call|prune-args|prune-code|clean-call)\b/i.test(probe);

  // --- facts: body lines minus directive-only lines ---
  const bodyLines = lines.filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (DIRECTIVE_LINE_RE.test(t)) return false;
    // a bare directive word alone on a line
    if (/^(?:truncate|replace|discard)$/i.test(t)) return false;
    return true;
  });
  const summary = bodyLines.join('\n').trim();
  if (mode === 'discard') fact = summary;

  return {
    targetSeq,
    targetTool,
    targetSubcall,
    entirePtc,
    mode,
    explicitMode,
    keepCount,
    keepUnit,
    cascadePrune,
    pruneCall,
    stubCall,
    protectTool,
    summary,
    fact
  };
}

/** Parse an assistant reply summary block (optional `seq <N>` header). */
export function parseReplySummaryBody(rawHeader, rawBody) {
  let targetSeq = null;
  const headerMatch = String(rawHeader || '').match(/\bseq[:=\s]+(\d+)\b/i);
  if (headerMatch) targetSeq = parseInt(headerMatch[1], 10);
  return {
    targetSeq,
    summary: String(rawBody || '').trim()
  };
}
