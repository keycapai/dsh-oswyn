/**
 * dsh-oswyn/format — pure human-facing formatting helpers.
 *
 * Shared by backend (index/engine) and the frontend (client) — both import the
 * exact same copy so byte/char/size labels never drift between UI and logs.
 *
 * Pure module: no node:fs, no ctx, no side effects.
 *
 * @module dsh-oswyn/format
 */

/**
 * Format a character count into a compact human string.
 *   formatBytes(12)        -> '12 chars'
 *   formatBytes(350)       -> '350 chars'
 *   formatBytes(2458)      -> '2.4 KB'
 *   formatBytes(1530000)   -> '1.5 MB'
 *
 * Uses decimal 1000 units (chars -> KB/MB) which matches how token budget is
 * discussed. Non-finite / negative inputs clamp to 0.
 * @param {number} chars
 * @returns {string}
 */
export function formatBytes(chars) {
  const n = Number.isFinite(chars) ? Math.max(0, chars) : 0;
  if (n < 1000) return `${n} chars`;
  const kb = n / 1000;
  if (kb < 1000) return `${trim(kb)} KB`;
  const mb = kb / 1000;
  if (mb < 1000) return `${trim(mb)} MB`;
  return `${trim(mb / 1000)} GB`;
}

function trim(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Group a number with thousands separators.
 *   formatNumber(1234567) -> '1,234,567'
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  const v = Number.isFinite(n) ? n : 0;
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Locale-stable clock time HH:MM:SS from an epoch-ms timestamp.
 *   formatTime(0) -> '08:00:00' in +08:00 (deterministic only within a fixed TZ)
 * Returns '' for non-finite input. Local time is used on purpose (dashboard).
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
