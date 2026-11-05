/**
 * dsh-oswyn/core/markers — SINGLE SOURCE OF TRUTH for the [oswyn-meta: ...] machine marker.
 *
 * Pure module: no node:fs, no node:path, no ctx, no side effects.
 *
 * Marker form (prepended to the first line of a rewritten tool result, or at the tail of a truncated one):
 *   [oswyn-meta: before=<N> after=<M> keep=<K> mode=<truncate|replace|discard> seq=<S>]
 *
 * IMPORTANT: The frontend (client) copies MARKER_RE verbatim. Keep this regex
 * stable and simple — do not reformat it without bumping both sides together.
 *
 * @module dsh-oswyn/core/markers
 */

/** Accepted rewrite modes. */
export const MODES = Object.freeze(['truncate', 'replace', 'discard']);

/**
 * Canonical marker regex. Must remain a stable, simple, global-flag-free shape
 * so the client can reuse it byte-for-byte.
 * Groups: 1=before, 2=after, 3=keep, 4=mode, 5=seq
 */
export const MARKER_RE = /\[oswyn-meta: before=(\d+|\?) after=(\d+|\?) keep=(\d+|\?) mode=(truncate|replace|discard) seq=([^\]\s]+)\]/;

/** Global variant for locate/replace-all in a blob of text. */
export const MARKER_RE_GLOBAL = /\[oswyn-meta: before=(\d+|\?) after=(\d+|\?) keep=(\d+|\?) mode=(truncate|replace|discard) seq=([^\]\s]+)\]/g;

/**
 * Check whether an index in text appears to be inside a serialized JSON/JS string
 * (e.g. when a tool reads source files or tests containing literal [oswyn-meta:] examples)
 * rather than at the start of an actual OSWYN marker line.
 */
function isRealMarkerAt(text, index) {
  if (index === 0) return true;
  let lineStart = text.lastIndexOf('\n', index - 1);
  lineStart = lineStart < 0 ? 0 : lineStart + 1;
  const prefix = text.slice(lineStart, index).trim();
  return prefix === '';
}

function normalizedMode(mode) {
  return MODES.includes(mode) ? mode : 'replace';
}

function numOrQ(v) {
  return Number.isFinite(v) ? String(v) : '?';
}

/**
 * Encode a machine marker string.
 * @param {{before:number, after:number, keep:number, mode:string, seq:(number|string)}} meta
 * @returns {string}
 */
export function encodeMeta(meta = {}) {
  const before = numOrQ(meta.before);
  const after = numOrQ(meta.after);
  const keep = numOrQ(meta.keep === undefined ? meta.keepChars : meta.keep);
  const mode = normalizedMode(meta.mode);
  const seq = meta.seq === undefined || meta.seq === null ? '?' : String(meta.seq);
  return `[oswyn-meta: before=${before} after=${after} keep=${keep} mode=${mode} seq=${seq}]`;
}

/**
 * Parse a machine marker out of a text blob.
 * Prefers a marker that stands on its own line (ignoring markers embedded inside
 * quoted JSON/code strings when reading files), and when multiple standalone
 * markers exist, prefers the last one (since truncate appends the marker at the tail).
 *
 * @param {string} text
 * @returns {{before:number|null, after:number|null, keep:number|null, mode:string, seq:string|null}|null}
 */
export function parseMeta(text) {
  if (typeof text !== 'string') return null;
  const re = new RegExp(MARKER_RE.source, 'g');
  let best = null;
  let fallback = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!fallback) fallback = m;
    if (isRealMarkerAt(text, m.index)) {
      best = m;
    }
  }
  const chosen = best || fallback;
  if (!chosen) return null;
  const toNum = (s) => (s === '?' ? null : parseInt(s, 10));
  return {
    before: toNum(chosen[1]),
    after: toNum(chosen[2]),
    keep: toNum(chosen[3]),
    mode: chosen[4],
    seq: chosen[5] === '?' ? null : chosen[5]
  };
}

/**
 * True when the text already carries an oswyn marker (used for idempotency).
 * @param {string} text
 */
export function hasMeta(text) {
  if (typeof text !== 'string') return false;
  const re = new RegExp(MARKER_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isRealMarkerAt(text, m.index)) return true;
  }
  return false;
}
