/**
 * dsh-oswyn client half — settings dashboard + in-conversation, official-style
 * per-row "compression" disclosure decorator.
 *
 * Design goals (user-mandated):
 *  - ONLY leaf tool rows (div[data-tool] with [data-state], no nested div[data-tool])
 *    receive a decoration. The outer process group (div[data-step-process]) NEVER does.
 *  - No scissor emoji, no verbose branded strip anywhere. Official, restrained look
 *    reusing --dsw-alias-* theme variables.
 *  - Numbers come ONLY from the row's own [oswyn-meta: ...] text. If absent → render
 *    nothing. Never fake, never guess history.
 *  - Degrades gracefully: everything try/catch- wrapped.
 *
 * Stable data-* selectors only (no hashed class names):
 *  leaf row : div[data-tool][data-state]
 *  header   : [data-disclosure-row]
 *  group    : [data-step-process]  (never decorated)
 *  marker   : [oswyn-meta: before=.. after=.. keep=.. mode=.. seq=..]  (see core/markers)
 *
 * @module dsh-oswyn/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-oswyn',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var el = React.createElement;

    var primitives = (function () {
      try { return require('@deepseek-ai/dsh-client-ui-primitives') || {}; } catch (_) { return {}; }
    })();

    // ─────────────────────────────────────────────────────────────────────────
    // Shared pure helpers (mirror lib/format.js + lib/core/markers.js) so the
    // byte/char labels and marker regex never drift from the backend.
    // ─────────────────────────────────────────────────────────────────────────

    // CANONICAL regex — copied VERBATIM from lib/core/markers.js MARKER_RE
    // (single source of truth). Groups: 1=before 2=after 3=keep 4=mode 5=seq.
    var MARKER_RE = /\[oswyn-meta: before=(\d+|\?) after=(\d+|\?) keep=(\d+|\?) mode=(truncate|replace|discard) seq=([^\]\s]+)\]/;
    // Tolerant fallback: older/simplified banners may omit mode=/seq=. This is used
    // ONLY when the canonical regex finds no match, so real data always goes through
    // the exact core shape and we never diverge on the authoritative format.
    var MARKER_RE_LOOSE = /\[oswyn-meta: before=(\d+|\?) after=(\d+|\?) keep=(\d+|\?)(?: mode=(truncate|replace|discard))?(?: seq=([^\]\s]+))?\]/;

    function isStandaloneMarkerAt(s, idx) {
      if (idx === 0) return true;
      var ls = s.lastIndexOf('\n', idx - 1);
      ls = ls < 0 ? 0 : ls + 1;
      return s.slice(ls, idx).trim() === '';
    }

    function findBestMarkerMatch(s, re) {
      var gRe = new RegExp(re.source, 'g');
      var best = null;
      var fallback = null;
      var m;
      while ((m = gRe.exec(s)) !== null) {
        if (!fallback) fallback = { match: m, index: m.index };
        if (isStandaloneMarkerAt(s, m.index)) best = { match: m, index: m.index };
      }
      return best || fallback;
    }

    function parseMetaToken(text) {
      if (!text) return null;
      var s = String(text);
      var hit = findBestMarkerMatch(s, MARKER_RE) || findBestMarkerMatch(s, MARKER_RE_LOOSE);
      if (!hit) return null;
      var m = hit.match;
      var toNum = function (x) { return x && x !== '?' ? parseInt(x, 10) : null; };
      var before = toNum(m[1]);
      var after = toNum(m[2]);
      if (!(typeof before === 'number' && before > 0) || typeof after !== 'number') return null;
      var inlineSummary = '';
      var idx = hit.index;
      if (idx >= 0) {
        var tail = s.slice(idx + m[0].length).replace(/^\r?\n\[oswyn[^\]]*\]\r?\n?/, '').trim();
        if (tail) inlineSummary = tail;
      }
      return {
        before: before,
        after: after,
        keep: m[3] ? toNum(m[3]) : null,
        mode: m[4] || 'truncate',
        seq: m[5] && m[5] !== '?' ? m[5] : null,
        summary: inlineSummary
      };
    }

    function compactChars(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(Math.round(n));
    }

    function formatNumber(num) {
      var v = Number.isFinite(num) ? Math.round(num) : 0;
      return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Human size label shared with backend format.formatBytes (decimal 1000 units).
    function formatBytes(chars) {
      var n = Number.isFinite(chars) ? Math.max(0, chars) : 0;
      if (n < 1000) return n + ' chars';
      var kb = n / 1000;
      if (kb < 1000) return trim1(kb) + ' KB';
      var mb = kb / 1000;
      if (mb < 1000) return trim1(mb) + ' MB';
      return trim1(mb / 1000) + ' GB';
    }
    function trim1(v) { var r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); }

    function ratioPct(before, after) {
      if (!(before > 0)) return 0;
      // Floor (never overstate savings): 100000→200 shows -99%, 2400→350 shows -85%.
      var r = Math.floor(((before - after) / before) * 100);
      return Math.max(0, Math.min(100, r));
    }

    function modeLabel(mode) {
      if (mode === 'replace') return '事实替换';
      if (mode === 'discard') return '整段丢弃·留事实';
      if (mode === 'prune-call') return '调用参数瘦身';
      return '前缀截断';
    }

