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

    function fixedTrim(v, digits) {
      var p = Math.pow(10, digits);
      var r = Math.round(v * p) / p;
      return String(r);
    }

    // Token counts on dashboards: 1.78M / 92K / 348. Large totals stop being
    // 7-digit noise; sub-thousand values stay exact.
    function formatTokens(num) {
      var v = Number(num);
      if (!Number.isFinite(v)) return '0';
      var sign = v < 0 ? '-' : '';
      var a = Math.abs(v);
      if (a >= 1000000) return sign + fixedTrim(a / 1000000, a >= 10000000 ? 1 : 2) + 'M';
      if (a >= 1000) return sign + fixedTrim(a / 1000, a >= 10000 ? 1 : 2) + 'K';
      return sign + String(Math.round(a));
    }

    function formatNumber(num) {
      var v = Number.isFinite(num) ? Math.round(num) : 0;
      return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Settings fields that hold large counts (64000 tokens, 256000 tokens) are edited
    // in thousands: the box reads 64 / 256 instead of a wall of zeros. Storage keeps
    // the real unit — only the widget is scaled — so the config format never changes.
    var KILO = 1000;
    function kiloToDisplay(stored, kilo) {
      var v = Number(stored);
      if (!Number.isFinite(v)) v = 0;
      if (!kilo) return v;
      // Round to 3 decimals so 12500 renders 12.5 and 1 renders 0.001.
      return Math.round((v / KILO) * 1000) / 1000;
    }
    function kiloToStored(displayed, kilo) {
      var v = Number(displayed);
      if (!Number.isFinite(v)) return null;
      if (!kilo) return v;
      return Math.round(v * KILO);
    }

    /** Everything a number row needs to render, in the widget's own unit. */
    function numberFieldView(item) {
      var it = item || {};
      var kilo = it.kilo === true;
      var unitText = kilo ? ('k' + (it.unit ? ' ' + it.unit : '')) : (it.unit || null);
      return {
        kilo: kilo,
        shown: kiloToDisplay(it.value, kilo),
        step: kiloToDisplay(it.step || 1, kilo),
        min: Number.isFinite(Number(it.min)) ? kiloToDisplay(it.min, kilo) : undefined,
        unitText: unitText
      };
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

    // ─────────────────────────────────────────────────────────────────────────
    // Settings dashboard card
    // ─────────────────────────────────────────────────────────────────────────

    function useForm(form) {
      var state = React.useState(function () {
        var snap = form.getSnapshot();
        return { status: snap.status, value: snap.value, writable: snap.writable };
      });
      var current = state[0];
      var setCurrent = state[1];
      React.useEffect(function () {
        return form.subscribe(function () {
          var snap = form.getSnapshot();
          setCurrent({ status: snap.status, value: snap.value, writable: snap.writable });
        });
      }, [form]);
      var setField = React.useCallback(function (field, value) {
        try { form.set(field, value).catch(function () {}); } catch (_) {}
      }, [form]);
      return [current, setField];
    }

    function useLiveStatus() {
      var state = React.useState({ data: null, loading: false, error: null });
      var status = state[0];
      var setStatus = state[1];

      var fetchStatus = React.useCallback(function () {
        setStatus(function (prev) { return { data: prev.data, loading: true, error: null }; });
        try {
          fetch('/api/oswyn/status', { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(function (json) {
              if (json && json.ok) setStatus({ data: json, loading: false, error: null });
              else setStatus({ data: null, loading: false, error: (json && json.error) || 'Failed' });
            })
            .catch(function (err) { setStatus({ data: null, loading: false, error: err.message || String(err) }); });
        } catch (err) {
          setStatus({ data: null, loading: false, error: String(err) });
        }
      }, []);

      React.useEffect(function () {
        fetchStatus();
        var timer = setInterval(function () { fetchStatus(); }, 10000);
        return function () { clearInterval(timer); };
      }, [fetchStatus]);

      return [status, fetchStatus];
    }

    // Defensively read a ledger-ish event regardless of old/new field names.
    function readEventNumbers(item) {
      var before = firstNum(item.before, item.charsBefore);
      var after = firstNum(item.after, item.charsAfter);
      var keep = firstNum(item.keepLines, item.keep);
      var keepChars = firstNum(item.keepChars);
      var savedIn = firstNum(item.tokensSaved, item.inputTokensSaved);
      if (savedIn === null && before !== null && after !== null && before > after) {
        savedIn = Math.round((before - after) / 3.5);
      }
      if (savedIn === null) savedIn = 0;
      if (before !== null && after !== null && after >= before) savedIn = 0; // truth guard (read-side)
      var extra = firstNum(item.extraSummaryTokens, item.extraOutputTokens) || 0;
      var recall = firstNum(item.recallTokens) || 0;
      var net = firstNum(item.net, item.netTokensSaved);
      if (net === null) net = savedIn - extra - recall;
      return { before: before, after: after, keep: keep || 0, keepChars: keepChars || 0, savedIn: savedIn, extra: extra, recall: recall, net: net };
    }
    function firstNum() { for (var i = 0; i < arguments.length; i++) { var v = arguments[i]; if (typeof v === 'number' && Number.isFinite(v)) return v; } return null; }

    // ── Narrow-width adaptation ───────────────────────────────────────────────
    // The settings panel is docked into a drawer / split pane as often as it is
    // shown full-width, so we measure the *panel container* (not the viewport)
    // and degrade the layout in two tiers. Inline styles cannot express @media,
    // hence the ResizeObserver hook.
    var NARROW_MAX = 480;   // single-column, stacked rows
    var COMPACT_MAX = 760;  // tighter gutters, wrapped control rows

    function usePanelWidth() {
      var refState = React.useRef ? React.useRef(null) : { current: null };
      var widthState = React.useState(0);
      var width = widthState[0];
      var setWidth = widthState[1];
      React.useEffect(function () {
        var node = refState.current;
        function apply(w) {
          var next = Math.round(w || 0);
          setWidth(function (prev) { return prev === next ? prev : next; });
        }
        function measureNode() {
          if (node && node.clientWidth) { apply(node.clientWidth); return true; }
          return false;
        }
        var ro = null;
        if (node && typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(function (entries) {
            var entry = entries && entries[0];
            apply(entry && entry.contentRect ? entry.contentRect.width : (node ? node.clientWidth : 0));
          });
          ro.observe(node);
        }
        if (!measureNode()) apply(window.innerWidth || 0);
        function onResize() { if (!measureNode()) apply(window.innerWidth || 0); }
        window.addEventListener('resize', onResize);
        return function () {
          if (ro) ro.disconnect();
          window.removeEventListener('resize', onResize);
        };
      }, []);
      return { ref: refState, width: width };
    }

    function ContextDistillCard(props) {
      var formState = useForm(props.form);
      var current = formState[0];
      var setField = formState[1];
      var cfg = current.value || {};
      var disabled = !current.writable || current.status !== 'ready';
      var TRIGGER_COLORS = { agent: '#7c93a8', auto: '#b08a68' };

      var statusState = useLiveStatus();
      var live = statusState[0];
      var refetch = statusState[1];
      var data = live.data;

      var panelBox = usePanelWidth();
      var panelWidth = panelBox.width;
      // width === 0 → not measured yet, keep the comfortable wide layout.
      var isCompact = panelWidth > 0 && panelWidth < COMPACT_MAX;
      var isNarrow = panelWidth > 0 && panelWidth < NARROW_MAX;
      var gutter = isNarrow ? '12px 10px' : (isCompact ? '14px 14px' : '16px 20px');

      var tabState = React.useState('stats');
      var activeTab = tabState[0];
      var setActiveTab = tabState[1];

      var searchState = React.useState('');
      var searchQuery = searchState[0];
      var setSearchQuery = searchState[1];

      var catState = React.useState('all');
      var activeCategory = catState[0];
      var setActiveCategory = catState[1];

      var expandedState = React.useState({});
      var expandedSessions = expandedState[0];
      var setExpandedSessions = expandedState[1];
      var toggleSession = React.useCallback(function (id) {
        setExpandedSessions(function (prev) { var n = Object.assign({}, prev); n[id] = !n[id]; return n; });
      }, []);

      var expandedItemsState = React.useState({});
      var expandedItems = expandedItemsState[0];
      var setExpandedItems = expandedItemsState[1];
      var toggleItem = React.useCallback(function (id, ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        setExpandedItems(function (prev) { var n = Object.assign({}, prev); n[id] = !n[id]; return n; });
      }, []);

      var SwitchComp = primitives.Switch || function (p) {
        return el('input', { type: 'checkbox', checked: !!p.checked, disabled: !!p.disabled, onChange: function (e) { p.onChange(e.target.checked); } });
      };

      // A number box that keeps what the user is typing instead of re-formatting on every
      // keystroke. Committing per keystroke made half-typed values impossible: clearing the
      // box committed 0, and typing '0.5' in a k-scaled field was swallowed at the dot.
      // The draft is committed on blur and on Enter, and re-synced when the value changes
      // underneath (another window editing the same config).
      var NumberField = function (p) {
        var state = React.useState(function () { return String(p.value); });
        var draft = state[0];
        var setDraft = state[1];
        var editing = React.useRef(false);
        React.useEffect(function () {
          if (!editing.current) setDraft(String(p.value));
        }, [p.value]);
        var commit = function (rawText) {
          editing.current = false;
          var n = Number(rawText);
          if (!Number.isFinite(n)) { setDraft(String(p.value)); return; }
          if (n === p.value) return;
          p.onCommit(n);
        };
        return el('input', {
          type: 'number',
          value: draft,
          min: p.min,
          step: p.step,
          disabled: p.disabled,
          style: p.style,
          onChange: function (e) {
            editing.current = true;
            setDraft(e.target.value);
          },
          onBlur: function (e) { commit(e.target.value); },
          onKeyDown: function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); }
            if (e.key === 'Escape') { editing.current = false; setDraft(String(p.value)); }
          }
        });
      };

      // Metrics: accept both new (metrics) and legacy (globalStats) roots.
      var g = (data && (data.metrics || data.globalStats)) || {};
      var totalSessions = firstNum(g.totalSessions) || 0;
      var totalActions = firstNum(g.totalActions) || 0;
      var totalTruncations = firstNum(g.totalTruncations) || 0;
      var totalReplacements = firstNum(g.totalReplacements) || 0;
      var totalDiscards = firstNum(g.totalDiscards) || 0;
      var totalReplySummaries = firstNum(g.totalReplySummaries) || 0;
      var totalToolCalls = firstNum(g.totalToolCalls, g.totalActions) || 0;
      var distillRate = firstNum(g.distillRate) || 0;
      var totalTokensSaved = firstNum(g.totalTokensSaved, g.totalCharsSaved) || 0;
      var totalExtra = firstNum(g.totalExtraSummaryTokens, g.totalExtraOutputTokens) || 0;
      var totalRecall = firstNum(g.totalRecallTokens) || 0;
      var totalNet = firstNum(g.totalNetTokensSaved, g.totalTokensSaved) || 0;
      // Multi-round cumulative: savings that keep accruing every round a compressed
      // block stays out of context. Falls back to the one-shot totals so an older
      // backend (no cumulative fields) still shows a sane number.
      // Never display the one-shot total as if it were the multi-round cumulative.
      var cumulativeSaved = firstNum(g.cumulativeTokensSaved) || 0;
      var cumulativeNet = firstNum(g.cumulativeNetTokensSaved, g.totalNetTokensSaved, g.totalTokensSaved) || 0;
      var avgRoundsPerRow = firstNum(g.avgRoundsPerRow) || 0;
      // How many rows got their multiplier from the host request log. When 0, we had
      // no logs and fell back to the (much more conservative) turn-based estimate.
      var legacyRows = firstNum(g.legacyRows) || 0;
      var totalRequests = firstNum(g.totalRequests) || 0;
      var requestBasedRows = firstNum(g.requestBasedRows) || 0;
      // Post-cache deep distillation (v2.4): a whole-surface reset with no ledger row
      // of its own, so it gets its own KPI instead of hiding inside the row average.
      var totalDistillEvents = firstNum(g.totalDistillEvents) || 0;
      var distillSessions = firstNum(g.distillSessions) || 0;
      var distillTokensSaved = firstNum(g.distillTokensSaved) || 0;
      var distillCumulative = firstNum(g.distillCumulativeSaved) || 0;
      var distillSavingsRate = firstNum(g.distillSavingsRate) || 0;
      var distillAvgSurplus = firstNum(g.distillAvgSurplusTokens) || 0;
      var distillReasons = (g.distillReasons && typeof g.distillReasons === 'object') ? g.distillReasons : {};
      var distillReasonText = (function () {
        var parts = [];
        if (firstNum(distillReasons.manual) > 0) parts.push('手动 ' + firstNum(distillReasons.manual));
        if (firstNum(distillReasons.ttl) > 0) parts.push('缓存过期 ' + firstNum(distillReasons.ttl));
        if (firstNum(distillReasons.volume) > 0) parts.push('体积 ' + firstNum(distillReasons.volume));
        if (firstNum(distillReasons.rounds) > 0) parts.push('轮次 ' + firstNum(distillReasons.rounds));
        if (firstNum(distillReasons.ceiling) > 0) parts.push('上限 ' + firstNum(distillReasons.ceiling));
        return parts.length ? ('触发：' + parts.join(' · ')) : '尚未触发';
      })();

      var sessions = (data && data.sessions) || [];

      // Visible turn distribution — useful to confirm per-turn statistics have data.
      var sessionTurnBuckets = function (acts) {
        var buckets = {};
        for (var i = 0; i < (acts || []).length; i++) {
          var t = Number(acts[i] && acts[i].turn);
          if (!Number.isFinite(t) || t <= 0) continue;
          buckets[t] = (buckets[t] || 0) + 1;
        }
        var keys = Object.keys(buckets).sort(function (a, b) { return Number(a) - Number(b); });
        return keys.length ? keys.map(function (k) { return k + '轮×' + buckets[k]; }).join(' · ') : '无轮次标记';
      };

      // Per-session compression %: prefer the server number, else derive from rows.
      var sessionSavingsRate = function (sess, acts) {
        var direct = firstNum(sess && sess.avgSavingsRate);
        if (direct !== null) return direct;
        var before = 0;
        var after = 0;
        for (var i = 0; i < (acts || []).length; i++) {
          var it = acts[i];
          if (!it || it.before === undefined || it.after === undefined) continue;
          var b = Number(it.before) || 0;
          var a = Number(it.after) || 0;
          if (b > a) { before += b; after += a; }
        }
        return before > 0 ? Math.round(((before - after) / before) * 1000) / 10 : 0;
      };

      var kpiCard = function (label, value, color, sub) {
        return el('div', {
          style: { padding: isNarrow ? '10px 12px' : '12px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.04))', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }
        },
          el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', overflowWrap: 'anywhere' } }, label),
          el('div', { style: { fontSize: isNarrow ? '19px' : '22px', fontWeight: 700, color: color, lineHeight: 1.2, overflowWrap: 'anywhere' } }, value),
          sub ? el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #999)', lineHeight: 1.5, overflowWrap: 'anywhere' } }, sub) : null
        );
      };

      var tabBtn = function (id, label) {
        return el('button', {
          type: 'button',
          onClick: function () { setActiveTab(id); },
          style: {
            background: 'none', border: 'none',
            borderBottom: activeTab === id ? '2px solid var(--dsw-alias-text-accent, #3b82f6)' : '2px solid transparent',
            color: activeTab === id ? 'var(--dsw-alias-text-primary, inherit)' : 'var(--dsw-alias-text-secondary, #888)',
            padding: isNarrow ? '6px 10px' : '6px 12px', fontWeight: activeTab === id ? 600 : 400, cursor: 'pointer',
            fontSize: isNarrow ? '12px' : '13px', flexShrink: 0, whiteSpace: 'nowrap'
          }
        }, label);
      };

      var defaultProtectedTools = [
        'run_code', 'read', 'write', 'edit', 'apply_patch', 'notebook',
        'read_image', 'todo_write', 'ask_user_question', 'skill', 'tool_search',
        'tool_result_recall', 'history_recall', 'oswyn_stats', 'oswyn_protect_tool',
        'create_goal', 'update_goal', 'get_goal', 'create_worktree',
        'exit_plan_mode', 'list_agents', 'spawn_teammate', 'send_message',
        'interrupt_agent', 'wait_agent', 'team_task_create', 'team_task_update',
        'team_task_get', 'team_task_list', 'workflow', 'subagent', 'subagent_fork'
      ];
      var defaultDiscardTools = ['validate_dsh_ui'];

      var renderItem = function (item) {
        if (item.type === 'switch') {
          return el('div', {
            key: item.field,
            style: {
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexWrap: 'wrap', rowGap: '8px',
              padding: isNarrow ? '10px 12px' : '12px 14px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
              background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
              gap: isCompact ? '10px' : '16px'
            }
          },
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                el('span', { style: { fontWeight: 600, fontSize: '13px' } }, item.title),
                el('code', { style: { fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))', color: 'var(--dsw-alias-text-tertiary, #888)', fontFamily: 'monospace' } }, item.field),
                item.badge ? el('span', { style: { fontSize: '10px', padding: '1px 6px', borderRadius: '6px', background: 'rgba(59,130,246,0.12)', color: 'var(--dsw-alias-text-accent, #3b82f6)', fontWeight: 500 } }, item.badge) : null
              ),
              el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.5 } }, item.desc)
            ),
            el('div', { style: { flexShrink: 0 } },
              el(SwitchComp, { checked: item.checked, disabled: disabled, onChange: function (val) { setField(item.field, val); } })
            )
          );
        }
        if (item.type === 'number') {
          return el('div', {
            key: item.field,
            style: {
              display: 'flex', flexDirection: isNarrow ? 'column' : 'row',
              justifyContent: 'space-between', alignItems: isNarrow ? 'stretch' : 'center',
              flexWrap: isNarrow ? 'nowrap' : 'wrap', rowGap: '8px',
              padding: isNarrow ? '10px 12px' : '10px 14px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
              background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
              gap: isCompact ? '10px' : '16px'
            }
          },
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                el('span', { style: { fontWeight: 600, fontSize: '13px' } }, item.title),
                el('code', { style: { fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))', color: 'var(--dsw-alias-text-tertiary, #888)', fontFamily: 'monospace' } }, item.field),
                item.badge ? el('span', { style: { fontSize: '10px', padding: '1px 6px', borderRadius: '6px', background: 'rgba(59,130,246,0.12)', color: 'var(--dsw-alias-text-accent, #3b82f6)', fontWeight: 500 } }, item.badge) : null
              ),
              el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.5 } }, item.desc)
            ),
            (function () {
              // Large counts (64000 tokens, 256000 tokens) are unreadable as raw digits.
              // With `kilo` the field is edited in thousands and written back in units,
              // so the stored config never changes shape — only what the box shows.
              var view = numberFieldView(item);
              var kilo = view.kilo;
              var shown = view.shown;
              var stepShown = view.step;
              var minShown = view.min;
              var unitText = view.unitText;
              return el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, alignSelf: isNarrow ? 'flex-end' : 'auto' } },
                el(NumberField, {
                  value: shown,
                  min: minShown,
                  step: stepShown,
                  disabled: disabled,
                  style: {
                    width: isNarrow ? '104px' : '90px', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                    background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
                    fontSize: '12px', textAlign: 'right'
                  },
                  onCommit: function (n) {
                    var stored = kiloToStored(n, kilo);
                    if (stored !== null) setField(item.field, stored);
                  }
                }),
                unitText ? el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #888)', minWidth: '24px' } }, unitText) : null
              );
            })()
          );
        }
        if (item.type === 'textList') {
          var rawList = Array.isArray(item.list) ? item.list : [];
          var valStr = rawList.join(', ');
          return el('div', {
            key: item.field,
            style: {
              display: 'flex', flexDirection: 'column', gap: '6px',
              padding: '12px 14px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
              background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))'
            }
          },
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 } },
                el('span', { style: { fontWeight: 600, fontSize: '13px' } }, item.title),
                el('code', { style: { fontSize: '10.5px', padding: '1px 5px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12))', color: 'var(--dsw-alias-text-tertiary, #888)', fontFamily: 'monospace' } }, item.field)
              ),
              el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-accent, #3b82f6)' } }, '已配置 ' + rawList.length + ' 项')
            ),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.5 } }, item.desc),
            el('input', {
              type: 'text',
              defaultValue: valStr,
              disabled: disabled,
              placeholder: '以英文逗号分隔工具名称，支持末尾 * 通配符...',
              style: {
                width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', fontSize: '12px'
              },
              onChange: function (e) {
                var arr = String(e.target.value || '').split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
                setField(item.field, arr);
              }
            })
          );
        }
        return null;
      };

      return el('div', { ref: panelBox.ref, style: { display: 'flex', flexDirection: 'column', gap: isCompact ? '12px' : '16px', padding: gutter, color: 'var(--dsw-alias-text-primary, inherit)', fontSize: '13px', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' } },
        // Header
        el('div', { style: { display: 'flex', flexDirection: isNarrow ? 'column' : 'row', justifyContent: 'space-between', alignItems: isNarrow ? 'stretch' : 'center', gap: isNarrow ? '10px' : '12px', paddingBottom: '12px', borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))' } },
          el('div', { style: { minWidth: 0 } },
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 } },
              el('span', { style: { fontWeight: 600, fontSize: isNarrow ? '14px' : '15px', lineHeight: 1.35, overflowWrap: 'anywhere' } }, 'DSH-OSWYN · 上下文精炼 (Only See What You Need)'),
              el('span', { style: { fontSize: '11px', padding: '2px 7px', borderRadius: '10px', background: cfg.enabled !== false ? 'rgba(59,130,246,0.15)' : 'rgba(128,128,128,0.2)', color: cfg.enabled !== false ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-label-tertiary, #888)', fontWeight: 500 } }, cfg.enabled !== false ? '全局生效' : '已禁用')
            ),
            el('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.7))', marginTop: '4px' } }, 'Agent 自主决策 · 保留前缀 KV 缓存 · 回复双轨备忘')
          ),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flexShrink: 0, justifyContent: isNarrow ? 'flex-end' : 'flex-start' } },
            el('button', { type: 'button', onClick: refetch, disabled: live.loading, style: { padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, live.loading ? '同步中…' : '刷新'),
            el(SwitchComp, { checked: cfg.enabled !== false, disabled: disabled, onChange: function (val) { setField('enabled', val); } })
          )
        ),

        // Tabs
        el('div', { style: { display: 'flex', gap: isNarrow ? '2px' : '8px', borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))', paddingBottom: '2px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', minWidth: 0 } },
          tabBtn('stats', '运行统计与收益'),
          tabBtn('sessions', '会话精炼明细 (' + sessions.length + ')'),
          tabBtn('config', '精炼参数配置')
        ),

        // TAB 1: stats
        activeTab === 'stats' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(' + (isCompact ? '150px' : '200px') + ', 1fr))', gap: isNarrow ? '8px' : '12px' } },
            kpiCard('步内单次节省', '~' + formatTokens(totalTokensSaved) + ' tok', '#3b82f6', '净 ~' + formatTokens(totalNet) + ' tok · 摘要与召回成本 ' + formatTokens(totalExtra + totalRecall) + ' tok'),
            kpiCard('步内累计节省', cumulativeSaved > 0 ? ('~' + formatTokens(cumulativeSaved) + ' tok') : '—', '#0ea5e9', '已服务 ' + formatTokens(totalRequests) + ' 次请求 · 平均复用 ' + (avgRoundsPerRow || 1) + ' 步 · 净 ~' + formatTokens(cumulativeNet) + ' tok'),
            kpiCard('工具压缩覆盖率', distillRate + '%', '#10b981', '已压缩 ' + (totalTruncations + totalReplacements + totalDiscards) + ' / 工具总调用 ' + totalToolCalls + ' 次'),
            kpiCard('平均压缩率', (firstNum(g.avgSavingsRate) || 0) + '%', '#f59e0b', '步内压缩与轮次深度蒸馏综合压缩率'),
            kpiCard('轮次深度蒸馏', totalDistillEvents > 0 ? (totalDistillEvents + ' 次') : '0 次', '#ec4899', totalDistillEvents > 0
              ? ('平均每次省 ~' + formatTokens(distillAvgSurplus) + ' tok · 累计省 ~' + formatTokens(distillCumulative) + ' tok · 整轮降 ' + distillSavingsRate + '% · ' + distillReasonText)
              : '尚未触发：未达到体积/轮次/超时门槛'),
            kpiCard('助手回复双轨', totalReplySummaries + ' 次', '#8b5cf6', '用户看完整解答 · 后续轮次仅向模型发送紧凑备忘'),
            kpiCard('压缩明细 / 会话数', totalActions + ' 次 / ' + totalSessions + ' 会话', 'inherit', '截断 ' + totalTruncations + ' · 替换 ' + totalReplacements + ' · 丢弃 ' + totalDiscards + ' · 轮次蒸馏覆盖 ' + distillSessions + ' 会话')
          ),
          el('div', { style: { padding: isNarrow ? '12px' : '14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.02))', display: 'flex', flexDirection: 'column', gap: '8px' } },
            el('div', { style: { fontWeight: 600, fontSize: '13px' } }, '上下文精炼架构优势'),
            el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(' + (isCompact ? '190px' : '260px') + ', 1fr))', gap: isNarrow ? '8px' : '10px' } },
              arch('1. 截断保留 (KV-Cache 保护)', '#3b82f6', '从第 0 字节开始原样保留前缀，KV 缓存达成前缀命中；仅把尾部冗余日志替换为提炼摘要。'),
              arch('2. 双轨回复投影', '#10b981', '用户在网页端完整阅读长篇解答，下轮向模型投影时自动转为精炼备忘，抑制历史回合膨胀。'),
              arch('3. 无损审计底账', '#8b5cf6', '原始输出永久留在会话底层事件流，用于审计与内部诊断，不影响用户视图。')
            )
          )
        ) : null,

        // TAB 2: sessions
        activeTab === 'sessions' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          sessions.length === 0 ? el('div', { style: { padding: '28px', textAlign: 'center', color: 'var(--dsw-alias-text-secondary, #888)', borderRadius: '8px', border: '1px dashed var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))' } }, '暂无记录的精炼会话。当有工具输出或回复被精炼时，此处实时展示明细与审计流。') : null,
          sessions.map(function (sess) {
            var isExpanded = !!expandedSessions[sess.sessionId];
            var acts = sess.history || sess.entries || [];
            var totals = acts.reduce(function (acc, it) {
              var n = readEventNumbers(it);
              acc.savedIn += n.savedIn; acc.extra += n.extra; acc.recall += n.recall; acc.net += n.net;
              return acc;
            }, { savedIn: 0, extra: 0, recall: 0, net: 0 });
            return el('div', { key: sess.sessionId, style: { borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))', overflow: 'hidden' } },
              el('div', { onClick: function () { toggleSession(sess.sessionId); }, style: { padding: isNarrow ? '10px 12px' : '10px 14px', display: 'flex', flexDirection: isNarrow ? 'column' : 'row', justifyContent: 'space-between', alignItems: isNarrow ? 'stretch' : 'center', gap: isNarrow ? '6px' : '10px', cursor: 'pointer', userSelect: 'none', background: isExpanded ? 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))' : 'transparent' } },
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
                  el('div', { style: { fontWeight: 600, fontSize: '13px', overflowWrap: 'anywhere', lineHeight: 1.4 } }, (sess.title || sess.sessionId) + ' ' + (isExpanded ? '▾' : '▸')),
                  el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', overflowWrap: 'anywhere' } }, 'ID: ' + sess.sessionId + ' · 精炼 ' + acts.length + ' 次 · 压缩率 ' + sessionSavingsRate(sess, acts) + '%')
                ),
                el('div', { style: { display: 'flex', alignItems: 'center', gap: isNarrow ? '8px 12px' : '14px', flexWrap: 'wrap', fontSize: '12px', minWidth: 0 } },
                  el('span', { style: { color: '#f59e0b', fontWeight: 600, flex: 'none' } }, '压缩 -' + sessionSavingsRate(sess, acts) + '%'),
                // Deep track marker per session: without it a distilled session looks
                // untouched because the reset leaves no ledger row behind.
                (firstNum(sess && sess.totalDistillEvents) > 0 || firstNum(sess && sess.distill && sess.distill.events) > 0)
                  ? el('span', { style: { color: '#ec4899', fontWeight: 600, flex: 'none' } }, '深度 ' + (firstNum(sess && sess.totalDistillEvents) || firstNum(sess && sess.distill && sess.distill.events)) + ' 次')
                  : null,
                  el('span', { style: { color: '#3b82f6', fontWeight: 600 } }, '净 ~' + formatTokens(totals.net) + ' tok'),
                  el('span', { style: { color: '#10b981', fontWeight: 600 } }, '省 ~' + formatTokens(totals.savedIn) + ' tok'),
                  el('span', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } }, '多花 ' + formatTokens(totals.extra + totals.recall) + ' tok')
                )
              ),
              isExpanded ? el('div', { style: { padding: '12px 14px', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))', display: 'flex', flexDirection: 'column', gap: '8px' } },
                // Deep distillation summary: it produces no rows, so the operation stream
                // below can never show it. Surface it explicitly at the top.
                (function () {
                  var de = firstNum(sess && sess.distill && sess.distill.events) || firstNum(sess && sess.totalDistillEvents) || 0;
                  if (de <= 0) return null;
                  var dd = (sess && sess.distill) || {};
                  var dr = (dd.reasons && typeof dd.reasons === 'object') ? dd.reasons : {};
                  var parts = [];
                  if (firstNum(dr.manual) > 0) parts.push('手动 ' + firstNum(dr.manual));
                  if (firstNum(dr.ttl) > 0) parts.push('缓存过期 ' + firstNum(dr.ttl));
                  if (firstNum(dr.volume) > 0) parts.push('体积 ' + firstNum(dr.volume));
                  if (firstNum(dr.rounds) > 0) parts.push('轮次 ' + firstNum(dr.rounds));
                  if (firstNum(dr.ceiling) > 0) parts.push('上限 ' + firstNum(dr.ceiling));
                  var savedTok = firstNum(dd.surplusTokens) || firstNum(sess && sess.distillTokensSaved) || 0;
                  var rawTok = firstNum(dd.rawTokens) || 0;
                  var distTok = firstNum(dd.distTokens) || 0;
                  var rate = rawTok > 0 ? Math.round(((rawTok - distTok) / rawTok) * 1000) / 10 : (firstNum(sess && sess.distillSavingsRate) || 0);
                  return el('div', { style: { padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(236,72,153,0.35)', background: 'rgba(236,72,153,0.06)', display: 'flex', flexDirection: 'column', gap: '3px' } },
                    el('div', { style: { fontWeight: 600, fontSize: '12px', color: '#ec4899' } }, '深度蒸馏 ' + de + ' 次' + (parts.length ? ('（' + parts.join(' · ') + '）') : '')),
                    el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, '整面重置节省 ~' + formatTokens(savedTok) + ' tok' + (rate > 0 ? (' · 整面降 ' + rate + '%') : '') + (rawTok > 0 ? (' · ' + formatTokens(rawTok) + ' → ' + formatTokens(distTok) + ' tok') : '')),
                    el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #999)' } }, '发生在缓存失效后的整面重写，不产生行级徽章；原始内容仍可从历史召回。')
                  );
                })(),
                (function () {
                  var sb = (sess && sess.surfaceBreakdown && typeof sess.surfaceBreakdown === 'object')
                    ? sess.surfaceBreakdown
                    : (sess && sess.distill && sess.distill.lastEval && (firstNum(sess.distill.lastEval.compressedTokens) > 0 || firstNum(sess.distill.lastEval.uncompressedTokens) > 0) ? sess.distill.lastEval : null);
                  if (!sb) return null;
                  var comp = firstNum(sb.compressedTokens) || 0;
                  var uncomp = firstNum(sb.uncompressedTokens) || 0;
                  var sys = firstNum(sb.systemTokens) || 0;
                  var sysHint = sys > 0 ? ('（含系统提示词 ~' + formatTokens(sys) + ' tok）') : '';
                  return el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } },
                    '上下文构成：已压缩 ~' + formatTokens(comp) + ' tok' + sysHint + ' · 未压缩 ~' + formatTokens(uncomp) + ' tok'
                  );
                })(),
                el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, '轮次分布: ' + sessionTurnBuckets(acts)),
                el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, '操作流水 (共 ' + acts.length + ' 条)'),
                acts.length === 0 ? el('div', { style: { fontSize: '12px', color: '#888' } }, '暂无操作流') : null,
                acts.map(function (item, idx) {
                  var n = readEventNumbers(item);
                  var modeColor = item.mode === 'truncate' ? '#7a9e8a' : (item.mode === 'reply' ? '#9086a8' : (item.mode === 'discard' ? '#b08a70' : '#b09a6a'));
                  var triggerRaw = String(item.trigger || 'agent').toLowerCase();
                  var triggerIsAuto = item.mode !== 'reply' && (triggerRaw === 'auto' || triggerRaw === 'autonomous');
                  var triggerColor = TRIGGER_COLORS[triggerIsAuto ? 'auto' : 'agent'];
                  var triggerLabel = triggerIsAuto ? '自动' : '主动';
                  var label = item.mode === 'reply' ? '回复摘要' : modeLabel(item.mode);
                  var inputHint = item.inputChars > 0 ? ('（含调用输入 ' + formatBytes(item.inputChars) + '）') : '';
                  var delta = (n.before !== null && n.after !== null) ? (formatBytes(n.before) + inputHint + ' → ' + formatBytes(n.after) + '  -' + ratioPct(n.before, n.after) + '%') : '(未记录尺寸)';
                  var itemKey = sess.sessionId + ':' + (item.id || idx);
                  var itemOpen = !!expandedItems[itemKey];
                  var summaryText = item.summary || item.fact || '';
                  var keepBadge = n.keep > 0 ? ('保留前 ' + n.keep + ' 行') : (n.keepChars > 0 ? ('保留前 ' + n.keepChars + ' 字符') : null);
                  var toolTitle = (item.toolName || (item.mode === 'reply' ? 'assistant_reply' : 'tool')) + (item.seq != null ? ' #' + item.seq : '');
                  return el('div', { key: item.id || idx, style: { padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))', background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.02))', display: 'flex', flexDirection: 'column', gap: '4px' } },
                    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' } },
                      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap', rowGap: '4px' } },
                        el('span', { style: { fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: modeColor + '20', color: modeColor, fontWeight: 600, flex: 'none' } }, label),
                        el('span', { style: { fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: triggerColor + '20', color: triggerColor, fontWeight: 600, flex: 'none' } }, triggerLabel),
                        el('span', { style: { fontWeight: 600, fontSize: '12px', minWidth: 0, overflowWrap: 'anywhere' } }, toolTitle),
                        keepBadge ? el('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-text-secondary, #888)' } }, keepBadge) : null
                      ),
                      el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', flex: 'none' } }, timeStr(item.ts || item.timestamp))
                    ),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', gap: isNarrow ? '4px 8px' : '8px', flexWrap: 'wrap', rowGap: '2px' } },
                      el('span', { style: { minWidth: 0, flex: isNarrow ? '1 1 100%' : 'initial', overflowWrap: 'anywhere' } }, delta),
                      el('span', { style: { flex: 'none' } }, '省 ' + formatTokens(n.savedIn) + ' · 多花 ' + formatTokens(n.extra + n.recall) + ' · 净 ' + formatTokens(n.net) + ' tok'),
                      el('button', { type: 'button', onClick: function (ev) { toggleItem(itemKey, ev); }, style: { flex: 'none', background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '11px', padding: '0 4px' } }, itemOpen ? '收起 ▴' : '详情 ▸')
                    ),
                    itemOpen ? el('div', { style: { marginTop: '4px', padding: '6px 8px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' } },
                      el('div', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } },
                        '节点序号：' + (item.seq != null ? ('seq=' + item.seq) : '未记录') +
                        (item.callId ? (' · 调用 ID：' + item.callId) : '') +
                        ' · 触发：' + triggerLabel +
                        (item.inputChars > 0 ? (' · 丢弃调用输入：' + formatBytes(item.inputChars)) : '')
                      ),
                      keepBadge ? el('div', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } }, '保留边界：' + keepBadge + '（从 index 0 原样保留，KV 缓存前缀命中）') : null,
                      summaryText ? el('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                        el('span', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } }, '提炼总结：'),
                        el('span', null, summaryText)
                      ) : el('div', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } }, '提炼总结：（仅执行结构化截断/替换，未附加额外文本摘要）'),
                      el('div', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } },
                        '记录编号：' + (item.id || '未记录')
                      )
                    ) : null
                  );
                })
              ) : null
            );
          })
        ) : null,

        // TAB 3: config
        activeTab === 'config' ? (function () {
          var CONFIG_GROUPS = [
            {
              id: 'willingness',
              title: '多轮压缩意愿动态感知 (Adaptive Nudge)',
              badge: '核心治理 · 意愿衰减防治',
              color: '#8b5cf6',
              desc: '针对深层多轮对话中的「Turn-8 意愿断崖」与惯性遗忘，通过 3D 亏损检测（连续步数、累积字符、对话深度）与 5 重零误报守卫，自适应注入 Tier 1~3 阶梯提示。100% 保护服务端 KV-Cache，零磁盘持久化污染。',
              items: [
                { type: 'switch', field: 'adaptiveNudgeEnabled', title: '多轮自适应意愿提示引擎', desc: '核心总控开关。在多轮对话中动态监测模型的主动压缩意愿，检测到意愿亏损时自适应注入分级提示（Tier 1 建议 / Tier 2 契约 / Tier 3 预算告警）。', badge: '推荐开启', checked: cfg.adaptiveNudgeEnabled !== false },
                { type: 'number', field: 'uncompressedStepThreshold', title: '连续未压缩步数触发门槛', desc: '[3D 维度 1] 连续执行 N 步工具且未进行任何压缩时，判定模型产生非压缩惯性，触发 Tier 2 契约强化提示。推荐值：2 步。', value: cfg.uncompressedStepThreshold ?? 2, min: 1, step: 1, unit: '步' },
                { type: 'number', field: 'accumulatedPayloadThreshold', title: '累积未压缩字符增量门槛', desc: '[3D 维度 2] 会话中未压缩工具输出的累积字符增量达到此上限时，触发 Tier 3 上下文预算警报。推荐值：2k 字符。', value: cfg.accumulatedPayloadThreshold ?? 2000, min: 500, step: 200, unit: '字符', kilo: true },
                { type: 'number', field: 'deepHorizonTurns', title: '深度对话注意力稀释轮数', desc: '[3D 维度 3] 对话深度达到此轮数后，模型对初期系统提示注意力产生稀释，激活长程意愿保护模式。推荐值：8 轮。', value: cfg.deepHorizonTurns ?? 8, min: 3, step: 1, unit: '轮' },
                { type: 'number', field: 'coldStartSteps', title: '冷启动探索静默轮数', desc: '[守卫 2] 任务前 N 轮通常为项目结构初探与配置读取，期间强制静默提示，绝不干扰模型初期探索。推荐值：2 轮。', value: cfg.coldStartSteps ?? 2, min: 0, step: 1, unit: '轮' },
                { type: 'number', field: 'cooldownSteps', title: '提示冷却间隔步数', desc: '[守卫 4] 每次发出意愿提示后必须等待的步数，防止高频提示造成模型注意力干扰。推荐值：2 步。', value: cfg.cooldownSteps ?? 2, min: 1, step: 1, unit: '步' },
                { type: 'number', field: 'minChars', title: '候选噪声输出字符下限', desc: '过滤短文本输出。低于此长度的简短命令返回视为安全紧凑内容，不计入亏损累加与候选目标。推荐值：600 字符。', value: cfg.minChars ?? 600, min: 100, step: 50, unit: '字符' }
              ]
            },
            {
              id: 'single-nudge',
              title: '单步工具压力感知提示 (Single-Step Nudge)',
              badge: '即时引导',
              color: '#3b82f6',
              desc: '单步工具产生巨量输出或执行报错时的即刻感知引导。引导模型采用 Co-Emission Contract 协同发射压缩围栏，零额外轮次损耗。',
              items: [
                { type: 'switch', field: 'nudgeEnabled', title: '单步工具压力感知提示总开关', desc: '当上一步单次工具返回体积过大或报错时，在下一步执行前自动注入轻量截断指引。', badge: '推荐开启', checked: cfg.nudgeEnabled !== false },
                { type: 'number', field: 'nudgeThresholdChars', title: '单步正常调用字符触发门槛', desc: '工具单次执行成功返回的字符数超过此门槛时，注入单步精炼提示。默认 600。', value: cfg.nudgeThresholdChars ?? 600, min: 100, step: 50, unit: '字符' },
                { type: 'number', field: 'nudgeThresholdLines', title: '单步正常调用行数触发门槛', desc: '工具单次执行成功返回的行数超过此门槛时触发提示。默认 18。', value: cfg.nudgeThresholdLines ?? 18, min: 5, step: 1, unit: '行' },
                { type: 'number', field: 'nudgeErrorThresholdChars', title: '报错调用敏感字符触发门槛', desc: '工具报错/异常时的专属敏感字符门槛（错误堆栈高噪，采用更低门槛快速提醒模型截断或丢弃）。默认 300。', value: cfg.nudgeErrorThresholdChars ?? 300, min: 50, step: 25, unit: '字符' },
                { type: 'number', field: 'nudgeErrorThresholdLines', title: '报错调用敏感行数触发门槛', desc: '工具报错/异常时的专属敏感行数门槛。默认 10。', value: cfg.nudgeErrorThresholdLines ?? 10, min: 3, step: 1, unit: '行' }
              ]
            },
            {
              id: 'protection',
              title: '分级自动兜底与工具安全保护 (Protection & Fallback)',
              badge: 'Agent-First 护栏',
              color: '#10b981',
              desc: '贯彻 Agent-First 自主决策原则：优先由模型决策压缩与保留；为防超大输出意外击穿窗口提供分级兜底；高价值源码与配置受保护名单 100% 豁免。',
              items: [
                { type: 'switch', field: 'autoCompressTiered', title: '分级自动兜底', desc: '除保护名单外的工具，超过字符门槛且模型未写压缩围栏时自动截断，防止意外打爆上下文窗口。', badge: '安全兜底', checked: cfg.autoCompressTiered !== false },
                { type: 'switch', field: 'autoCompress', title: '全量强制自动压缩', desc: '是否无差别对所有未保护输出进行强制自动截断。建议保持关闭（源码读取等建议由 Agent 自主决策）。', badge: '谨慎开启', checked: cfg.autoCompress === true },
                { type: 'number', field: 'autoCompressMinChars', title: '自动兜底触发字符门槛', desc: '输出超过此字符数且模型未处理时才触发自动兜底；默认 4k 字符，代码有效下限 200。', value: cfg.autoCompressMinChars ?? 4000, min: 200, step: 100, unit: '字符', kilo: true },
                { type: 'number', field: 'autoCompressKeepLines', title: '自动兜底保留头部行数', desc: '自动截断时从第 0 行起原样保留的头部行数（不影响模型围栏自定的行数）；默认 30。', value: cfg.autoCompressKeepLines ?? 30, min: 1, step: 1, unit: '行' },
                { type: 'switch', field: 'autoCompressPtcSubcalls', title: 'PTC 子调用聚合折叠', desc: 'run_code 一次批量执行多个子调用时，按子调用生成结构化摘要并替换外层结果；run_code 本身仍受普通保护排除。', badge: '推荐开启', checked: cfg.autoCompressPtcSubcalls !== false },
                { type: 'switch', field: 'autoDiscardFailed', title: '失败调用自动丢弃', desc: '退出码非 0、异常堆栈等失败输出在下一步自动整段丢弃，仅保留精炼失败结论。', badge: '推荐开启', checked: cfg.autoDiscardFailed !== false },
                { type: 'textList', field: 'autoDiscardTools', title: '始终丢弃工具名单', desc: '此名单中的工具无论输出长度都会自动丢弃；默认包含 validate_dsh_ui，支持逗号分隔与末尾 * 通配符。', list: Array.isArray(cfg.autoDiscardTools) ? cfg.autoDiscardTools : defaultDiscardTools },
                { type: 'textList', field: 'autoCompressTieredProtectedTools', title: '重要不可压缩保护名单', desc: '此列表中的工具永远不会被自动兜底压缩，源码与高价值数据 100% 完整保留；支持逗号分隔与通配符。', list: Array.isArray(cfg.autoCompressTieredProtectedTools) ? cfg.autoCompressTieredProtectedTools : defaultProtectedTools }
              ]
            },
            {
              id: 'ui',
              title: '界面标记与双轨展示',
              badge: '视觉体验',
              color: '#06b6d4',
              desc: '控制对话界面中的压缩比例、轮次蒸馏标记与回复折叠样式，只影响界面展示，不影响后端压缩效果。',
              items: [
                { type: 'switch', field: 'contextRatioBadge', title: '底部压缩占比徽标', desc: '在输入框下方上下文指示旁显示「−XX%」压缩比例徽标。', badge: '默认开', checked: cfg.contextRatioBadge !== false },
                { type: 'switch', field: 'contextRatioDetail', title: '底部统计详情浮窗', desc: '点击底部「−XX%」徽标时，弹出本会话的步内压缩与轮次蒸馏统计浮窗。', badge: '默认开', checked: cfg.contextRatioDetail !== false },
                { type: 'switch', field: 'perTurnStats', title: '分支旁本轮压缩比例', desc: '在每轮消息底部分支按钮旁显示本轮压缩比例数字，点击查看本轮明细。', badge: '默认开', checked: cfg.perTurnStats !== false },
                { type: 'switch', field: 'deepTurnBadge', title: '轮次蒸馏标记条', desc: '在已完成轮次深度蒸馏的历史轮次下方显示「已轮次蒸馏」标记条，点击查看本轮蒸馏详情。', badge: '默认开', checked: cfg.deepTurnBadge !== false },
                { type: 'switch', field: 'badgeEnabled', title: '工具行内压缩徽章', desc: '在已压缩的工具调用行末尾显示「已压缩 -XX%」徽章，点击可展开前后大小与摘要。', badge: '推荐开启', checked: cfg.badgeEnabled !== false },
                { type: 'switch', field: 'replySummaryEnabled', title: '助手回复双轨备忘', desc: '长篇回复同时生成紧凑备忘：当前轮向用户展示完整版，后续轮次向模型发送备忘以节省上下文。', badge: '核心机制', checked: cfg.replySummaryEnabled !== false },
                { type: 'switch', field: 'foldReplySummary', title: '回复备忘折叠为「已压缩」条', desc: '开启后，回复末尾用于下轮模型的备忘块会折叠为可点击的「已压缩」小条；关闭后直接隐藏。', badge: '默认开', checked: cfg.foldReplySummary !== false }
              ]
            },
            {
              id: 'post-cache',
              title: '轮次深度蒸馏（跨轮历史瘦身）',
              badge: 'v2.4 核心',
              color: '#8b5cf6',
              desc: '自动将历史已完成轮次的思考链与工具过程折叠为紧凑结论，任意一项触发条件满足即立刻执行；原文完整保留在底账，模型可随时按轮次召回。',
              items: [
                { type: 'switch', field: 'postCacheDistillEnabled', title: '启用轮次深度蒸馏', desc: '总开关。开启后，满足体积、轮次、超时或上限任一条件即自动压缩历史已完成轮次。', badge: '推荐开启', checked: cfg.postCacheDistillEnabled !== false },
                { type: 'switch', field: 'triggerVolumeEnabled', title: '按体积自动触发', desc: '未蒸馏历史中可省下的冗余达到体积门槛时立刻压缩（适合工具输出密集的长任务突发止损）。', badge: '默认开', checked: cfg.triggerVolumeEnabled !== false },
                { type: 'number', field: 'triggerVolumeTokens', title: '体积触发门槛', desc: '未蒸馏历史可省 Token 达到此值即触发（默认 64k，推荐 48k–64k）。', value: cfg.triggerVolumeTokens ?? 64000, min: 4000, step: 4000, unit: 'Token', kilo: true },
                { type: 'switch', field: 'triggerRoundsEnabled', title: '按轮次自动触发', desc: '连续多轮未蒸馏时按固定轮次自动压缩，保证普通长对话上下文不会持续膨胀。', badge: '默认开', checked: cfg.triggerRoundsEnabled !== false },
                { type: 'number', field: 'triggerRounds', title: '轮次触发门槛', desc: '连续未蒸馏满 N 轮即触发（默认 8 轮，推荐 6–10 轮）。', value: cfg.triggerRounds ?? 8, min: 1, step: 1, unit: '轮' },
                { type: 'number', field: 'triggerMinSurplusTokens', title: '最小收益门槛', desc: '可省 Token 低于此值时跳过蒸馏，避免为极小收益打断缓存（默认 4k）。', value: cfg.triggerMinSurplusTokens ?? 4000, min: 0, step: 500, unit: 'Token', kilo: true },
                { type: 'number', field: 'triggerCeilingTokens', title: '最大上下文安全阀', desc: '当前上下文总 Token 超过此值时强制触发蒸馏，无视最小收益门槛（默认 256k）。', value: cfg.triggerCeilingTokens ?? 256000, min: 16000, step: 16000, unit: 'Token', kilo: true },
                { type: 'number', field: 'cacheTtlHours', title: '缓存空闲超时', desc: '两轮对话间隔超过该时长视为服务端缓存已过期，自动触发一次蒸馏（默认 24 小时）。', value: cfg.cacheTtlHours ?? 24, min: 1, step: 1, unit: '小时' },
                { type: 'switch', field: 'distillStripThinking', title: '蒸馏时剥离历史思考链', desc: '压缩历史轮次时移除思考过程，仅保留最终结论。', badge: '默认开', checked: cfg.distillStripThinking !== false },
                { type: 'switch', field: 'distillStripToolCalls', title: '蒸馏时剥离历史工具过程', desc: '压缩历史轮次时移除中间工具调用与结果，原文保留在底账支持按轮次召回。', badge: '默认开', checked: cfg.distillStripToolCalls !== false }
              ]
            },
            {
              id: 'core',
              title: '全局总控与调试',
              badge: '系统控制',
              color: '#64748b',
              desc: '控制 OSWYN 全局开关、自动应用与诊断日志输出。',
              items: [
                { type: 'switch', field: 'enabled', title: '全局总开关', desc: '全局启用或禁用 DSH-OSWYN；关闭后所有步内压缩、提示与轮次蒸馏全部暂停。', badge: '全局总控', checked: cfg.enabled !== false },
                { type: 'switch', field: 'autoApply', title: '自动应用压缩指令', desc: '在每步执行前后自动识别并应用模型输出的压缩标记。', badge: '默认开', checked: cfg.autoApply !== false },
                { type: 'switch', field: 'verbose', title: '输出详细调试日志', desc: '在控制台打印每步压缩与轮次触发详情，便于排错。', badge: '调试', checked: cfg.verbose === true }
              ]
            }
          ];

          var totalSettingsCount = CONFIG_GROUPS.reduce(function (sum, g) { return sum + g.items.length; }, 0);

          var countById = function (id) {
            var found = CONFIG_GROUPS.find(function (g) { return g.id === id; });
            return found ? found.items.length : 0;
          };
          var categoryPills = [
            { id: 'all', label: '全部设置', count: totalSettingsCount },
            { id: 'post-cache', label: '轮次深度蒸馏', count: countById('post-cache') },
            { id: 'willingness', label: '多轮意愿感知', count: countById('willingness') },
            { id: 'single-nudge', label: '单步压力感知', count: countById('single-nudge') },
            { id: 'protection', label: '自动兜底保护', count: countById('protection') },
            { id: 'ui', label: '界面标记与双轨', count: countById('ui') },
            { id: 'core', label: '全局总控', count: countById('core') }
          ];

          var qLower = String(searchQuery || '').trim().toLowerCase();
          var totalMatchedItems = 0;
          var filteredGroups = CONFIG_GROUPS.map(function (grp) {
            if (activeCategory !== 'all' && grp.id !== activeCategory) return null;
            var matchedItems = grp.items.filter(function (it) {
              if (!qLower) return true;
              return it.field.toLowerCase().includes(qLower) ||
                     it.title.toLowerCase().includes(qLower) ||
                     it.desc.toLowerCase().includes(qLower) ||
                     grp.title.toLowerCase().includes(qLower);
            });
            if (matchedItems.length === 0) return null;
            totalMatchedItems += matchedItems.length;
            return Object.assign({}, grp, { items: matchedItems });
          }).filter(Boolean);

          return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            // 1. Search Bar & Clear Action
            el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
              el('div', { style: { position: 'relative', flex: 1 } },
                el('input', {
                  type: 'text',
                  value: searchQuery,
                  placeholder: isNarrow
                    ? '搜索设置项 / 参数 key / 说明'
                    : '快速搜索设置项名称、参数 key 或功能说明 (如: 意愿 / 提示 / 阈值 / 保护 / adaptiveNudge)...',
                  onChange: function (e) { setSearchQuery(e.target.value); },
                  style: {
                    width: '100%', boxSizing: 'border-box', padding: '9px 36px 9px 12px',
                    borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                    background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.05))',
                    color: 'inherit', fontSize: '13px'
                  }
                }),
                searchQuery ? el('button', {
                  type: 'button',
                  onClick: function () { setSearchQuery(''); },
                  style: {
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: 'var(--dsw-alias-text-tertiary, #888)',
                    cursor: 'pointer', fontSize: '12px', padding: '2px 6px'
                  }
                }, '清除') : null
              )
            ),

            // 2. Category Navigation Pills
            el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
              categoryPills.map(function (cat) {
                var isSel = activeCategory === cat.id;
                return el('button', {
                  key: cat.id,
                  type: 'button',
                  onClick: function () { setActiveCategory(cat.id); },
                  style: {
                    padding: isNarrow ? '4px 9px' : '5px 12px', borderRadius: '16px',
                    border: '1px solid ' + (isSel ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))'),
                    background: isSel ? 'rgba(59,130,246,0.15)' : 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
                    color: isSel ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-text-secondary, #888)',
                    fontWeight: isSel ? 600 : 400, fontSize: isNarrow ? '11.5px' : '12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }
                },
                  el('span', null, cat.label),
                  el('span', {
                    style: {
                      fontSize: '10.5px', opacity: isSel ? 1 : 0.75,
                      background: isSel ? 'rgba(59,130,246,0.25)' : 'rgba(128,128,128,0.15)',
                      padding: '1px 6px', borderRadius: '8px'
                    }
                  }, cat.count)
                );
              })
            ),

            // Search match feedback
            searchQuery ? el('div', {
              style: {
                fontSize: '12px', color: 'var(--dsw-alias-text-secondary, #888)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexWrap: 'wrap', gap: '4px 8px',
                padding: '4px 2px', borderBottom: '1px dashed var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))'
              }
            },
              el('span', null, '搜索 “' + searchQuery + '”：匹配到 ' + totalMatchedItems + ' 项设置'),
              el('button', {
                type: 'button',
                onClick: function () { setSearchQuery(''); setActiveCategory('all'); },
                style: { background: 'none', border: 'none', color: 'var(--dsw-alias-text-accent, #3b82f6)', cursor: 'pointer', fontSize: '12px' }
              }, '清除搜索与筛选')
            ) : null,

            // 3. Render Categorized Groups
            filteredGroups.length === 0 ? el('div', {
              style: {
                padding: isNarrow ? '28px 12px' : '40px 20px', textAlign: 'center', borderRadius: '8px',
                border: '1px dashed var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                color: 'var(--dsw-alias-text-tertiary, #888)', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.02))'
              }
            },
              el('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: 'inherit' } }, '未找到匹配的设置项'),
              el('div', { style: { fontSize: '12px', marginBottom: '14px' } }, '没有找到与关键词匹配的配置项，请尝试更换关键词。'),
              el('button', {
                type: 'button',
                onClick: function () { setSearchQuery(''); setActiveCategory('all'); },
                style: {
                  padding: '6px 14px', borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                  background: 'var(--dsw-alias-bg-base, transparent)', color: 'var(--dsw-alias-text-accent, #3b82f6)',
                  cursor: 'pointer', fontSize: '12px', fontWeight: 500
                }
              }, '重置搜索与分类')
            ) : filteredGroups.map(function (grp) {
              return el('div', {
                key: grp.id,
                style: {
                  display: 'flex', flexDirection: 'column', gap: isNarrow ? '8px' : '10px',
                  padding: isNarrow ? '10px' : '16px', borderRadius: '10px',
                  border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))',
                  background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.02))'
                }
              },
                // Group Header
                el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                  el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
                    el('span', { style: { fontWeight: 700, fontSize: isNarrow ? '13px' : '14px', color: grp.color || 'var(--dsw-alias-text-primary, inherit)', overflowWrap: 'anywhere' } }, grp.title)
                  ),
                  grp.badge ? el('span', {
                    style: {
                      fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                      background: grp.color ? (grp.color + '18') : 'rgba(59,130,246,0.12)',
                      color: grp.color || 'var(--dsw-alias-text-accent, #3b82f6)', fontWeight: 500
                    }
                  }, grp.badge) : null
                ),
                // Group Description Block
                grp.desc ? el('div', {
                  style: {
                    fontSize: '11.5px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6,
                    padding: '8px 12px', borderRadius: '6px',
                    background: grp.color ? (grp.color + '0a') : 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
                    border: '1px solid ' + (grp.color ? (grp.color + '20') : 'var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))')
                  }
                }, grp.desc) : null,
                // Group Items
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' } },
                  grp.items.map(renderItem)
                )
              );
            }),

            // 4. Architectural Guidance Box
            el('div', {
              style: {
                padding: isNarrow ? '12px' : '14px 16px', borderRadius: '8px',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))',
                background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.02))',
                display: 'flex', flexDirection: 'column', gap: '8px'
              }
            },
              el('div', { style: { fontWeight: 600, fontSize: '12px', color: 'var(--dsw-alias-accent, #007acc)' } }, 'Agent-First 自主决策与系统原则'),
              el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 100% KV-Cache 保护：Nudge 提示采用单步尾部瞬态注入（Ephemeral Tail Injection），历史 Token 字节级绝对不变，完全命中服务端 KV-Cache。'),
              el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 零额外轮次：模型在执行当前步骤或回复时同步判定上一步工具输出（Co-Emission），无需专门多耗交互轮次。'),
              el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 5 重零误报守卫：Step-0 资产豁免、冷启动静默、履约重置、步间冷却与终局推理豁免，确保高价值源码 100% 原样保留。')
            )
          );
        })() : null
      );
    }

    function arch(title, color, body) {
      return el('div', { style: { padding: '8px 10px', borderRadius: '6px', background: color + '0d', border: '1px solid ' + color + '26' } },
        el('div', { style: { fontWeight: 600, color: color, marginBottom: '2px' } }, title),
        el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.4 } }, body)
      );
    }
    function timeStr(ts) {
      if (!ts) return '—';
      try { var d = new Date(ts); var p = function (x) { return String(x).padStart(2, '0'); }; return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); } catch (_) { return '—'; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // In-conversation decorator (DOM observer)
    // ─────────────────────────────────────────────────────────────────────────

    var BADGE_CLASS = 'dsh-oswyn-inline-badge';
    var PANEL_CLASS = 'dsh-oswyn-inline-panel';
    var GROUP_HINT_CLASS = 'dsh-oswyn-group-hint';
    var STYLE_ID = 'dsh-oswyn-inline-style';
    var OSWYN_BADGE_UI = {
      panel: 'mR10tW_panel', title: 'mR10tW_title', titleLabel: 'mR10tW_titleLabel',
      titleRule: 'mR10tW_titleRule', titleValue: 'mR10tW_titleValue', details: 'mR10tW_details'
    };
    // Known summary bodies from the live ledger (used to identify oswyn fences
    // even when DSH's CodeToolbar replaces unknown lang tags with "代码块").
    var knownSummaries = {};
    var knownToolSummaries = {};
    var knownReplySummaries = {};
    var replyStatsBySummary = {};

    // ── Sticky fence classification ───────────────────────────────────────────
    // The ledger is polled every 3s and REPLACED wholesale, and DSH's CodeToolbar
    // rewrites unknown fence languages to "代码块". Re-deriving "is this an oswyn
    // fence? reply or tool?" on every sync therefore flips classification mid-flight
    // (an already-folded reply memo gets un-folded and re-folded), which shows up as
    // the reply chip blinking / the message jumping on long, older conversations.
    // Both functions are sticky: once a code body has been identified they never
    // change their mind for that body again within the page lifetime.
    var replyMemoBodies = {};
    var toolMemoBodies = {};

    function memoBodyKey(text) {
      var t = String(text || '').trim();
      return t || '';
    }

    function markReplyMemoBody(text) {
      var k = memoBodyKey(text);
      if (k) replyMemoBodies[k] = true;
      return Boolean(k);
    }

    function markToolMemoBody(text) {
      var k = memoBodyKey(text);
      if (k) toolMemoBodies[k] = true;
      return Boolean(k);
    }

    // true / false once known, null when the body has never been classified.
    function knownMemoKind(text) {
      var k = memoBodyKey(text);
      if (!k) return null;
      if (replyMemoBodies[k]) return true;
      if (toolMemoBodies[k]) return false;
      return null;
    }

    function addDetailRow(dl, label, value) {
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.textContent = value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }

    function buildBadge(meta) {
      // meta: { before, after, keep, keepLines, keepChars, mode, seq, summary, pruneCall }
      var before = meta.before;
      var after = meta.after;
      var keep = meta.keep || 0;
      var keepLines = meta.keepLines || 0;
      var keepChars = meta.keepChars || keep;
      var mode = meta.mode || 'truncate';
      var pct = ratioPct(before, after);
      var trigger = String(meta.trigger || 'agent').toLowerCase();
      var triggerTone = (trigger === 'auto' || trigger === 'autonomous' || trigger === 'auto-compress') ? 'auto' : 'agent';

      // Root is a <span> acting as a toggle button (role=button). It contains a tiny
      // caption "压缩" plus the compact before→after; a hidden child panel expands.
      var badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.setAttribute('data-dsh-oswyn-badge', 'true');
      badge.setAttribute('data-tone', triggerTone);
      badge.setAttribute('data-mode', mode);
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      badge.setAttribute('aria-expanded', 'false');
      badge.setAttribute('title', (meta.toolName || 'tool') + ' · ' + formatNumber(before) + '→' + formatNumber(after) + ' 字符 · 减少 ' + pct + '%');

      var cap = document.createElement('span');
      cap.setAttribute('data-dsh-oswyn-cap', 'true');
      cap.textContent = mode === 'discard' ? '丢弃' : (mode === 'prune-call' ? '瘦身' : '压缩');
      badge.appendChild(cap);

      var sep = document.createElement('span');
      sep.setAttribute('data-dsh-oswyn-sep', 'true');
      sep.textContent = ' ';
      badge.appendChild(sep);

      // Compact visible figure: e.g. "2.4K→350 -85%"
      var fig = document.createElement('span');
      fig.setAttribute('data-dsh-oswyn-fig', 'true');
      fig.textContent = compactChars(before) + '→' + compactChars(after) + (pct > 0 ? ' -' + pct + '%' : '');
      badge.appendChild(fig);

      // Expandable detail panel styled with DSH's native popover classes.
      var panel = document.createElement('div');
      panel.className = OSWYN_BADGE_UI.panel + ' ' + PANEL_CLASS;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('data-dsh-oswyn-panel', 'true');
      panel.setAttribute('aria-hidden', 'true');
      panel.style.setProperty('display', 'none');

      var keepNote;
      if (mode === 'truncate') {
        if (keepLines > 0) {
          keepNote = '保留前 ' + keepLines + ' 行' + (keepChars > 0 ? '（' + keepChars + ' chars，前缀缓存命中）' : '（前缀缓存命中）');
        } else if (keepChars > 0) {
          keepNote = '保留前 ' + keepChars + ' 字符（前缀缓存命中）';
        } else if (keep > 0) {
          keepNote = '保留前 ' + keep + ' 字符（前缀缓存命中）';
        } else {
          keepNote = '保留前缀 0 字节起原样内容';
        }
      } else if (mode === 'replace') {
        keepNote = '无（全量替换为提炼事实）';
      } else if (mode === 'discard') {
        keepNote = '无（整段已丢弃，仅留结论）';
      } else if (mode === 'prune-call') {
        keepNote = '仅折叠超长调用参数';
      } else {
        keepNote = keep > 0 ? ('保留前 ' + keep + ' 行（前缀缓存命中）') : '保留前缀 0 字节起原样内容';
      }

      var savedChars = Math.max(0, before - after);
      var savedTokens = Math.round(savedChars / 3.5);
      var remainPct = before > 0 ? Math.max(0, Math.min(100, Math.round((after / before) * 100))) : 0;
      var toolLabel = String(meta.toolName || 'tool');
      if (meta.seq !== undefined && meta.seq !== null && meta.seq !== '') toolLabel += ' · seq ' + meta.seq;
      var beforeDetail = formatBytes(before) + '（' + formatNumber(before) + ' 字符' + (meta.inputChars > 0 ? ('，含调用输入 ' + formatNumber(meta.inputChars) + ' 字符') : '') + '）';
      var afterDetail = formatBytes(after) + '（' + formatNumber(after) + ' 字符）';

      var title = document.createElement('div');
      title.className = OSWYN_BADGE_UI.title;
      var lab = document.createElement('span');
      lab.className = OSWYN_BADGE_UI.titleLabel;
      lab.textContent = toolLabel;
      var val = document.createElement('span');
      val.className = OSWYN_BADGE_UI.titleValue;
      val.textContent = pct > 0 ? ('−' + pct + '%') : modeLabel(mode);
      title.appendChild(lab);
      title.appendChild(val);
      panel.appendChild(title);

      var rule = document.createElement('div');
      rule.className = OSWYN_BADGE_UI.titleRule;
      rule.setAttribute('aria-hidden', 'true');
      panel.appendChild(rule);

      // Visual before→after chart. Kept as a real element (data-dsh-oswyn-chart) so
      // the panel always answers "how much did this cost before vs after" at a glance,
      // and so the tool identity stays readable without opening the summary row.
      var chartBox = document.createElement('div');
      chartBox.setAttribute('data-dsh-oswyn-chart', 'true');
      chartBox.setAttribute('data-dsh-oswyn-tool', toolLabel);
      chartBox.style.setProperty('padding', '6px 8px');
      chartBox.style.setProperty('border-radius', '6px');
      chartBox.style.setProperty('margin-bottom', '6px');

      var metricTop = document.createElement('div');
      metricTop.style.setProperty('font-weight', '600');
      metricTop.style.setProperty('font-size', '12px');
      metricTop.textContent = '减少 ' + (pct > 0 ? pct : 0) + '% · 节省 ' + formatNumber(savedChars) + ' 字符 (≈' + formatNumber(savedTokens) + ' tok)';
      chartBox.appendChild(metricTop);

      var track = document.createElement('div');
      track.style.setProperty('height', '8px');
      track.style.setProperty('border-radius', '4px');
      track.style.setProperty('overflow', 'hidden');
      track.style.setProperty('display', 'flex');
      track.style.setProperty('margin', '6px 0');
      var fillAfter = document.createElement('div');
      fillAfter.style.setProperty('width', remainPct + '%');
      fillAfter.style.setProperty('height', '100%');
      track.appendChild(fillAfter);
      chartBox.appendChild(track);

      var legend = document.createElement('div');
      legend.style.setProperty('font-size', '11px');
      var legBefore = document.createElement('div');
      legBefore.textContent = '压缩前：' + beforeDetail;
      var legAfter = document.createElement('div');
      legAfter.textContent = '压缩后：' + afterDetail;
      legend.appendChild(legBefore);
      legend.appendChild(legAfter);
      chartBox.appendChild(legend);
      panel.appendChild(chartBox);

      var dl = document.createElement('dl');
      dl.className = OSWYN_BADGE_UI.details;
      addDetailRow(dl, '工具', toolLabel);
      addDetailRow(dl, '策略', (triggerTone === 'auto' ? '自动' : '主动') + ' · ' + modeLabel(mode));
      addDetailRow(dl, '减少', (pct > 0 ? (pct + '%') : '0%') + ' · 节省 ' + formatNumber(savedChars) + ' 字符 (≈' + formatNumber(savedTokens) + ' tok)');
      addDetailRow(dl, '压缩前', beforeDetail);
      addDetailRow(dl, '压缩后', afterDetail);
      addDetailRow(dl, '保留', keepNote);
      if (meta.pruneCall) addDetailRow(dl, '参数', '已折叠超长调用参数 (prune-call)');
      if (meta.summary) addDetailRow(dl, '摘要', String(meta.summary).slice(0, 240));
      panel.appendChild(dl);

      // Panel is a child of the badge (so it lives with the row) but positioned
      // fixed with coordinates computed on open — this escapes row overflow clipping.
      badge.appendChild(panel);

      var ownerId = 'ow' + Math.random().toString(36).slice(2, 9);
      badge.setAttribute('data-dsh-oswyn-owner', ownerId);
      panel.setAttribute('data-dsh-oswyn-owner', ownerId);
      var openPanel = function () {
        try {
          if (typeof document !== 'undefined' && panel.parentNode !== document.body && document.body) {
            document.body.appendChild(panel);
          }
          panel.style.setProperty('display', 'block');
          var rect = badge.getBoundingClientRect ? badge.getBoundingClientRect() : null;
          var vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
          var vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
          var w = panel.offsetWidth || 300;
          var h = panel.offsetHeight || 200;
          var top = rect ? ((rect.bottom + h + 16 <= vh || rect.top < h + 16) ? Math.min(rect.bottom + 6, vh - h - 8) : Math.max(8, rect.top - h - 6)) : 120;
          var left = rect ? Math.max(8, Math.min(rect.left, vw - w - 8)) : 60;
          panel.style.setProperty('top', Math.max(8, top) + 'px');
          panel.style.setProperty('left', left + 'px');
        } catch (_) {}
        badge.setAttribute('data-open', 'true');
        badge.setAttribute('aria-expanded', 'true');
        panel.setAttribute('aria-hidden', 'false');
      };
      var closePanel = function () {
        try { panel.style.setProperty('display', 'none'); } catch (_) {}
        if (panel.parentNode && panel.parentNode === document.body) { try { panel.parentNode.removeChild(panel); } catch (_) {} }
        badge.setAttribute('data-open', 'false');
        badge.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-hidden', 'true');
      };
      var toggle = function () {
        if (badge.getAttribute('data-open') === 'true') closePanel(); else openPanel();
      };
      // Global dismissal: pointerdown anywhere outside the badge/panel, Escape, or scroll.
      try {
        if (typeof document !== 'undefined' && !window.__oswynPanelCloser) {
          window.__oswynPanelCloser = true;
          var closer = function (ev) {
            var t = ev && ev.target;
            var panels = document.querySelectorAll('.' + PANEL_CLASS);
            for (var i = 0; i < panels.length; i++) {
              var p = panels[i];
              if (!p || p.style.display === 'none') continue;
              if (t && p.contains && p.contains(t)) continue;
              if (t && t.closest && t.closest('.' + BADGE_CLASS)) continue;
              p.style.setProperty('display', 'none');
              var ownerId = p.getAttribute('data-dsh-oswyn-owner');
              if (ownerId) {
                var b = document.querySelector('[data-dsh-oswyn-owner="' + ownerId + '"]');
                if (b && b !== p) { b.setAttribute('data-open', 'false'); b.setAttribute('aria-expanded', 'false'); }
              }
            }
          };
          document.addEventListener('pointerdown', closer, true);
          document.addEventListener('keydown', function (ev) { if (ev && ev.key === 'Escape') closer({ target: null }); }, true);
          window.addEventListener('scroll', function () { closer({ target: null }); }, true);
        }
      } catch (_) {}
      try {
        badge.addEventListener('click', function (e) { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); toggle(); });
        badge.addEventListener('keydown', function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) { if (e.preventDefault) e.preventDefault(); toggle(); } });
      } catch (_) {}

      return badge;
    }

    // Return the row's OWN disclosure header (not one belonging to a nested
    // subcall). An outer PTC run_code row contains the rows of its inner tool
    // calls, so a plain row.querySelector('[data-disclosure-row]') can return a
    // descendant header and the badge would be attached to the wrong row.
    function ownDisclosureRow(row) {
      try {
        var headers = row.querySelectorAll ? row.querySelectorAll('[data-disclosure-row]') : [];
        for (var i = 0; i < headers.length; i++) {
          var owner = headers[i].closest ? headers[i].closest('div[data-tool]') : null;
          if (owner === row) return headers[i];
        }
        return headers[0] || null;
      } catch (_) {
        try { return row.querySelector('[data-disclosure-row]'); } catch (__) { return null; }
      }
    }

    function findAnchor(row) {
      // Insert directly into the disclosure header flex row. Never insert inside
      // leaf spans like .summary, which have overflow:hidden and clip the badge.
      var headerRow = ownDisclosureRow(row);
      if (headerRow) {
        return { parent: headerRow, before: null };
      }
      return { parent: row, before: null };
    }

    // Text that belongs to this row itself, excluding text of nested tool-call
    // subtrees (PTC subcalls). Used so a parent run_code row never parses an
    // [oswyn-meta:] marker that belongs to one of its children.
    function ownText(row) {
      try {
        var id = callIdOfRow(row);
        var out = '';
        var walk = function (node) {
          if (!node) return;
          if (node.nodeType === 3) { out += node.nodeValue || ''; return; }
          if (node.nodeType !== 1) return;
          if (node !== row) {
            var cid = node.getAttribute && node.getAttribute('data-chat-call-id');
            if (cid && cid !== id) return; // skip nested tool-call subtree
          }
          var kids = node.childNodes || [];
          for (var i = 0; i < kids.length; i++) walk(kids[i]);
        };
        walk(row);
        return out || row.textContent || '';
      } catch (_) {
        return row.textContent || '';
      }
    }

    function placeBadge(row, badge) {
      var a = findAnchor(row);
      if (!a || !a.parent) return;
      if (a.before) a.parent.insertBefore(badge, a.before);
      else a.parent.appendChild(badge);
    }

    var FOLD_CHIP_CLASS = 'dsh-oswyn-fold-chip';

    function prevSiblingOf(el) {
      if (!el) return null;
      if (el.previousElementSibling !== undefined) return el.previousElementSibling;
      if (el.parentNode && Array.isArray(el.parentNode.children)) {
        var idx = el.parentNode.children.indexOf(el);
        return idx > 0 ? el.parentNode.children[idx - 1] : null;
      }
      return null;
    }

    function clearAttr(el, name) {
      if (!el) return;
      try {
        if (typeof el.removeAttribute === 'function') el.removeAttribute(name);
        else if (el.attrs && name in el.attrs) delete el.attrs[name];
      } catch (_) {}
    }

    // Mark element (and its banner sibling) hidden. Idempotent.
    function markHidden(el) {
      if (!el || !el.classList) return;
      // Remove any fold chip that may have been inserted before this block.
      try {
        var prev = prevSiblingOf(el);
        if (prev && prev.classList && prev.classList.contains(FOLD_CHIP_CLASS) && prev.remove) prev.remove();
      } catch (_) {}
      clearAttr(el, 'data-oswyn-folded');
      clearAttr(el, 'data-oswyn-open');
      el.classList.add('dsh-oswyn-reply-summary-hidden');
      try { el.style.setProperty('display', 'none', 'important'); } catch (_) {}
    }

    // Restore a previously hidden/folded block if React reused the DOM node for non-oswyn content.
    function unmarkBlock(el) {
      if (!el || !el.classList) return;
      var wasFolded = el.getAttribute && el.getAttribute('data-oswyn-folded') === '1';
      var wasHidden = el.classList.contains('dsh-oswyn-reply-summary-hidden');
      if (!wasFolded && !wasHidden) return;
      try {
        var prev = prevSiblingOf(el);
        if (prev && prev.classList && prev.classList.contains(FOLD_CHIP_CLASS) && prev.remove) prev.remove();
      } catch (_) {}
      clearAttr(el, 'data-oswyn-folded');
      clearAttr(el, 'data-oswyn-open');
      // The element is being restored as non-oswyn content, so its sticky fence
      // verdict must go too (React reused this node for another block).
      clearAttr(el, 'data-oswyn-fence');
      clearAttr(el, 'data-oswyn-fence-kind');
      try { el.__oswynFenceBody = undefined; } catch (_) {}
      el.classList.remove('dsh-oswyn-reply-summary-hidden');
      try { el.style.removeProperty('display'); } catch (_) {}
    }

    // Directives supported by dsh-oswyn/core/parse (including flags like `discard entire-ptc`,
    // `seq 12`, `subcall bash_1`, `protect-tool ...`, optional leading `>` blockquote).
    var RESULT_DIRECTIVE_LINE_RE = /^(?:>\s*)?(?:(?:seq|subcall)[:=\s]+[a-zA-Z0-9_.*-]+\s*)*(?:truncate(?:\s+(?:keep|retain))?(?:\s+\d+\s*(?:lines?|chars?|characters?)?)?|(?:keep|retain)\s+\d+\s*(?:lines?|chars?|characters?)?|replace|discard|protect|no-compress|protect-tool\s+[a-zA-Z0-9_.*-]+|prune-call|prune-args|prune-code|clean-call|stub-call|cascade|prune-failures|entire-ptc|whole-ptc|all-ptc)(?:\s+(?:(?:seq|subcall)[:=\s]+[a-zA-Z0-9_.*-]+|entire-ptc|whole-ptc|all-ptc|cascade|prune-failures|prune-call|prune-args|prune-code|clean-call|stub-call|keep\s+\d+\s*(?:lines?|chars?|characters?)?|retain\s+\d+\s*(?:lines?|chars?|characters?)?))*$/i;
    var RESULT_TARGET_ONLY_LINE_RE = /^(?:>\s*)?(?:(?:seq|subcall)[:=\s]+[a-zA-Z0-9_.*-]+\s*)+$/i;

    function hasResultDirectivePrefix(text) {
      if (!text) return false;
      var lines = String(text).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return false;
      var first = lines[0];
      var second = lines[1] || '';
      if (RESULT_DIRECTIVE_LINE_RE.test(first)) return true;
      if (RESULT_TARGET_ONLY_LINE_RE.test(first) && second && RESULT_DIRECTIVE_LINE_RE.test(second)) return true;
      return false;
    }

    function stripLeadingDirectiveLines(text) {
      if (!text) return '';
      var lines = String(text).split('\n');
      var out = [];
      var inHeader = true;
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        var t = raw.trim();
        if (!t) {
          if (!inHeader) out.push(raw);
          continue;
        }
        if (inHeader && (RESULT_DIRECTIVE_LINE_RE.test(t) || RESULT_TARGET_ONLY_LINE_RE.test(t))) {
          continue;
        }
        inHeader = false;
        out.push(raw.replace(/^\s*>\s?/, ''));
      }
      return out.join('\n').trim();
    }

    // Return true when a text blob is an oswyn distillation fence body / memo.
    function looksLikeDistill(text) {
      var t = (text || '').trim();
      if (!t) return false;
      if (/(?:dsh[-_])?(?:result|reply)[-_]summary/i.test(t)) return true;
      if (hasResultDirectivePrefix(t)) return true;
      if (/^[-*•\s]*DENSE\s+(DECISION|MEMO)\b/i.test(t)) return true;
      return false;
    }

    // Tolerant match against a ledger body set: exact first, then a prefix match.
    // Ledgers store the memo as written; an older session's fence may differ by a
    // trailing line, and a strict equality test then loses both the fold and the stats.
    function matchesKnownBody(map, text) {
      if (!map || !text) return false;
      if (map[text]) return true;
      var t = String(text).trim();
      if (!t) return false;
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        if (k.length < 12) continue;
        if (Math.abs(k.length - t.length) > 200) continue;
        if (t.indexOf(k) === 0 || k.indexOf(t) === 0) return true;
      }
      return false;
    }

    // Compute before→after character stats for a reply-summary fence block.
    // Prefers authoritative ledger numbers when available; otherwise measures
    // the visible assistant message container vs the memo body.
    var CODE_CHROME_RE = /^(?:代码块|Code|复制|Copy|已复制|Copied)$/;

    // DSH wraps each fence in its own seat element, so block.parentElement usually
    // holds nothing but the block itself — measuring it yields before == after and the
    // chip loses its "1,234→567 字符 (-54%)" figure. Climb until a container with real
    // surrounding prose is found.
    function statsContainerOf(block) {
      var el = block;
      for (var depth = 0; el && depth < 6; depth++) {
        var parent = el.parentElement;
        if (!parent) return null;
        var others = 0;
        var kids = parent.children || [];
        for (var i = 0; i < kids.length; i++) {
          var kid = kids[i];
          if (!kid || kid === el) continue;
          if (kid.classList && (kid.classList.contains(FOLD_CHIP_CLASS) || kid.classList.contains('dsh-oswyn-reply-summary-hidden'))) continue;
          var txt = String(kid.textContent || '').trim();
          if (!txt) continue;
          if (CODE_CHROME_RE.test(txt)) continue;
          if ((kid.tagName || '').toUpperCase() === 'BUTTON') continue;
          others += txt.length;
        }
        if (others >= 12) return parent;
        el = parent;
      }
      return block.parentElement;
    }

    function computeReplyBlockStats(block) {
      try {
        var bodyText = extractCodeBodyText(block);
        var after = bodyText ? bodyText.length : 0;
        if (bodyText) {
          var st = replyStatsBySummary[bodyText] || null;
          if (!st) {
            // Prefix match against ledger stats (see matchesKnownBody).
            for (var sk in replyStatsBySummary) {
              if (!Object.prototype.hasOwnProperty.call(replyStatsBySummary, sk) || sk.length < 12) continue;
              if (Math.abs(sk.length - bodyText.length) > 200) continue;
              if (bodyText.indexOf(sk) === 0 || sk.indexOf(bodyText) === 0) { st = replyStatsBySummary[sk]; break; }
            }
          }
          if (st && st.before > 0 && st.after > 0) return { before: st.before, after: st.after };
        }
        var before = 0;
        var parent = statsContainerOf(block);
        if (parent) {
          var siblings = parent.children || [];
          for (var i = 0; i < siblings.length; i++) {
            var sib = siblings[i];
            if (!sib || sib === block) continue;
            if (sib.classList && (sib.classList.contains(FOLD_CHIP_CLASS) || sib.classList.contains('dsh-oswyn-reply-summary-hidden'))) continue;
            var sTxt = String(sib.textContent || '').trim();
            if (!sTxt || CODE_CHROME_RE.test(sTxt)) continue;
            before += sTxt.length;
          }
          before += after;
        }
        if (before > after && after > 0) return { before: before, after: after };
      } catch (_) {}
      return null;
    }

    function formatReplyChipText(block) {
      var stats = computeReplyBlockStats(block);
      var statStr = '';
      if (stats && stats.before > 0 && stats.after >= 0 && stats.after < stats.before) {
        var pct = ratioPct(stats.before, stats.after);
        statStr = ' ' + formatNumber(stats.before) + '→' + formatNumber(stats.after) + ' 字符' + (pct > 0 ? ' (-' + pct + '%)' : '');
      }
      return '已压缩' + statStr;
    }

    function cleanReplyMemoBody(rawText) {
      var text = String(rawText || '').trim();
      if (!text) return '';
      var lines = text.split('\n');
      var out = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (/^\[oswyn\s*双轨[^\]]*\]$/i.test(line)) continue;
        if (/^```/.test(line)) continue;
        out.push(lines[i]);
      }
      return out.join('\n').trim();
    }

    function closeReplyFoldPopover() {
      try {
        if (typeof window !== 'undefined' && window.__oswynReplyPop) {
          var p = window.__oswynReplyPop;
          if (p.parentNode) p.parentNode.removeChild(p);
          window.__oswynReplyPop = null;
        }
        var openChips = document.querySelectorAll('.' + FOLD_CHIP_CLASS + '[data-open="true"]');
        for (var i = 0; i < openChips.length; i++) {
          openChips[i].removeAttribute('data-open');
          openChips[i].setAttribute('aria-expanded', 'false');
        }
      } catch (_) {}
    }

    function openReplyMemoPopover(chip, stats, rawMemoText) {
      if (typeof document === 'undefined' || !chip) return;
      var wasOpen = chip.getAttribute('data-open') === 'true';
      closeReplyFoldPopover();
      // Also close any other open OSWYN detail popover
      try {
        var others = document.querySelectorAll('[data-oswyn-detail]');
        for (var oi = 0; oi < others.length; oi++) {
          if (others[oi].parentNode) others[oi].parentNode.removeChild(others[oi]);
        }
      } catch (_) {}
      if (wasOpen) return;

      var pct = (stats && stats.before > 0 && stats.after < stats.before) ? ratioPct(stats.before, stats.after) : 0;
      var savedChars = (stats && stats.before > stats.after) ? (stats.before - stats.after) : 0;
      var savedTokens = Math.round(savedChars / 3.5);

      var panel = document.createElement('div');
      panel.className = OSWYN_BADGE_UI.panel + ' dsh-oswyn-reply-popover';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('data-oswyn-detail', '1');
      panel.style.position = 'fixed';
      panel.style.zIndex = '99999';
      panel.style.maxWidth = 'min(400px, calc(100vw - 32px))';
      panel.style.maxHeight = 'min(420px, calc(100vh - 32px))';
      panel.style.overflowY = 'auto';

      var title = document.createElement('div');
      title.className = OSWYN_BADGE_UI.title;
      var lab = document.createElement('span');
      lab.className = OSWYN_BADGE_UI.titleLabel;
      lab.textContent = '回复精炼备忘';
      var val = document.createElement('span');
      val.className = OSWYN_BADGE_UI.titleValue;
      val.textContent = pct > 0 ? ('−' + pct + '%') : '双轨';
      title.appendChild(lab);
      title.appendChild(val);
      panel.appendChild(title);

      var rule = document.createElement('div');
      rule.className = OSWYN_BADGE_UI.titleRule;
      rule.setAttribute('aria-hidden', 'true');
      panel.appendChild(rule);

      if (stats && stats.before > 0) {
        var dl = document.createElement('dl');
        dl.className = OSWYN_BADGE_UI.details;
        addDetailRow(dl, '字符变化', formatNumber(stats.before) + '→' + formatNumber(stats.after));
        addDetailRow(dl, '节省', formatNumber(savedChars) + ' 字符 (≈' + formatNumber(savedTokens) + ' tok)');
        panel.appendChild(dl);
      }

      var memoText = cleanReplyMemoBody(rawMemoText);
      if (memoText) {
        var bodyWrap = buildRescuedProseNode(memoText);
        bodyWrap.className = 'dsh-oswyn-reply-memo-body';
        clearAttr(bodyWrap, 'data-oswyn-rescued-prose');
        panel.appendChild(bodyWrap);
      }

      document.body.appendChild(panel);
      var rect = (typeof chip.getBoundingClientRect === 'function')
        ? chip.getBoundingClientRect()
        : { left: 0, top: 0, right: 0, bottom: 0 };
      var vw = window.innerWidth || 1024;
      var vh = window.innerHeight || 768;
      var w = panel.offsetWidth || 320;
      var h = panel.offsetHeight || 200;
      var left = Math.max(8, Math.min(rect.left, vw - w - 8));
      var top = (rect.top >= h + 16) ? (rect.top - h - 8) : Math.min(vh - h - 8, rect.bottom + 8);
      panel.style.left = left + 'px';
      panel.style.top = Math.max(8, top) + 'px';

      chip.setAttribute('data-open', 'true');
      chip.setAttribute('aria-expanded', 'true');
      window.__oswynReplyPop = panel;

      if (!window.__oswynReplyPopCloser && typeof document.addEventListener === 'function') {
        window.__oswynReplyPopCloser = true;
        document.addEventListener('pointerdown', function (ev) {
          var t = ev && ev.target;
          if (t && t.closest && (t.closest('.dsh-oswyn-reply-popover') || t.closest('.' + FOLD_CHIP_CLASS))) return;
          closeReplyFoldPopover();
        }, true);
        document.addEventListener('keydown', function (ev) {
          if (ev && ev.key === 'Escape') closeReplyFoldPopover();
        }, true);
      }
    }

    function openReplyFoldPopover(chip, block) {
      if (!block) return;
      openReplyMemoPopover(chip, computeReplyBlockStats(block), extractCodeBodyText(block));
    }

    // Collapse an oswyn reply-summary fence block into a "已压缩 <before>→<after> 字符 (-X%)" chip.
    // Never reveals the raw code block; clicking opens a DSH-styled popover with formatted memo details.
    function foldBlock(block) {
      if (!block || !block.classList) return;
      var chip = null;
      try {
        var prev = prevSiblingOf(block);
        if (prev && prev.classList && prev.classList.contains(FOLD_CHIP_CLASS)) chip = prev;
      } catch (_) {}
      block.classList.remove('dsh-oswyn-reply-summary-hidden');
      block.setAttribute('data-oswyn-folded', '1');
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = FOLD_CHIP_CLASS;
        chip.setAttribute('data-dsh-oswyn-fold-chip', 'true');
        chip.setAttribute('aria-haspopup', 'dialog');
        chip.setAttribute('aria-expanded', 'false');
        chip.title = '回复精炼双轨压缩 · 点击查看详情';
        chip.textContent = formatReplyChipText(block);
        chip.addEventListener('click', function (e) {
          if (e && e.preventDefault) e.preventDefault();
          if (e && e.stopPropagation) e.stopPropagation();
          // The chip opens the formatted memo popover; it must never reveal the raw
          // fence code block inline (that was the old, ugly behaviour).
          openReplyFoldPopover(chip, block);
        });
        try { block.parentNode.insertBefore(chip, block); } catch (_) {}
      } else {
        var nextLabel = formatReplyChipText(block);
        if (chip.textContent !== nextLabel) chip.textContent = nextLabel;
      }
      // The raw fence always stays collapsed; details live in the popover.
      block.setAttribute('data-oswyn-open', '0');
      block.style.setProperty('display', 'none', 'important');
    }

    // Check whether a code-block element explicitly names a specific oswyn fence tag
    // in its attributes, classes, or banner/infostring (never in the code body text).
    function hasExplicitFenceTag(el, targetTag) {
      if (!el || !targetTag) return false;
      try {
        var lang = '';
        if (el.getAttribute) lang += ' ' + (el.getAttribute('data-lang') || '');
        var cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
        lang += ' ' + String(cls);
        if (lang.toLowerCase().indexOf(targetTag) >= 0) return true;
        if (el.querySelector) {
          var info = el.querySelector('.infostring, [class*="infostring"], [data-code-block-lang], [class*="language"], [data-code-block-banner]');
          if (info) {
            var infoText = (info.textContent || '').trim().toLowerCase();
            if (infoText === targetTag || infoText.indexOf(targetTag) >= 0) return true;
          }
          var cEl = el.querySelector('code') || el.querySelector('pre');
          if (cEl && cEl.getAttribute) {
            var cLang = ((cEl.getAttribute('data-lang') || '') + ' ' + (cEl.className || '')).toLowerCase();
            if (cLang.indexOf(targetTag) >= 0) return true;
          }
        }
      } catch (_) {}
      return false;
    }

    // Does this code-block element directly name an oswyn fence language?
    function hasFenceLang(el) {
      return hasExplicitFenceTag(el, 'reply-summary') || hasExplicitFenceTag(el, 'dsh-reply-summary')
        || hasExplicitFenceTag(el, 'reply_summary') || hasExplicitFenceTag(el, 'dsh_reply_summary')
        || hasExplicitFenceTag(el, 'result-summary') || hasExplicitFenceTag(el, 'dsh-result-summary')
        || hasExplicitFenceTag(el, 'result_summary') || hasExplicitFenceTag(el, 'dsh_result_summary');
    }

    // Extract ONLY the code body inside a code-block element, stripping the
    // CodeToolbar banner ("代码块" / "Code" / "复制") that otherwise prefixes
    // el.textContent and breaks line-anchored regexes.
    function extractCodeBodyText(el) {
      if (!el) return '';
      try {
        if (el.querySelector) {
          // Prefer the dedicated content container: DSH marks it explicitly.
          var content = el.querySelector('[data-code-block-content]');
          if (content && content.textContent !== undefined) {
            return String(content.textContent || '').trim();
          }
          var codeNode = el.querySelector('pre code, pre, code');
          if (codeNode && codeNode.textContent !== undefined) {
            return String(codeNode.textContent || '').trim();
          }
          // Last resort: el.textContent includes the CodeToolbar ("代码块" / "复制").
          // Leaving it in made the body start with chrome text, so the memo detector
          // failed on every pass AFTER the toolbar had rendered — the chip appeared on
          // the first paint and vanished on the next one. Strip the banner text.
          var raw = String(el.textContent || '');
          var chrome = el.querySelector('[data-code-block-banner], [class*="bannerWrap"], [class*="banner"], [class*="header"]');
          if (chrome) {
            var chromeText = String(chrome.textContent || '').trim();
            if (chromeText) raw = raw.split(chromeText).join('');
          }
          return raw.trim();
        }
        return String(el.textContent || '').trim();
      } catch (_) {
        return '';
      }
    }

    // Structured reply-memo bullet detector.
    //
    // DSH renders every unknown fence language with the generic "代码块" header, so the
    // fence language cannot be read back from the DOM. The memo body itself is the only
    // signal: an oswyn reply memo is a short bullet list that sits at the very tail of
    // an assistant message. Requiring two KNOWN Chinese key words (the old rule) missed
    // most real memos ("- 移植核心洞察：…", "- 用户所说的 … 实为 …"), which is why some
    // conversations showed no marker and left the raw fence visible.
    function turnKeyOf(el) {
      try {
        var cur = el;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          var v = cur.getAttribute && cur.getAttribute('data-chat-turn');
          if (v !== null && v !== undefined && v !== '') return String(v);
          cur = cur.parentElement;
        }
      } catch (_) {}
      return '';
    }

    function isIgnorableFollowingSibling(sib) {
      if (!sib) return true;
      if (sib.classList && (
        sib.classList.contains(FOLD_CHIP_CLASS) ||
        sib.classList.contains('dsh-oswyn-reply-summary-hidden') ||
        sib.classList.contains('dsh-oswyn-turn-pill') ||
        sib.classList.contains('dsh-oswyn-reply-popover')
      )) return true;
      if (sib.getAttribute && (
        sib.getAttribute('data-oswyn-folded') === '1' ||
        sib.getAttribute('data-oswyn-reply-fallback-wrap') !== null ||
        sib.getAttribute('data-oswyn-turn-tail') !== null ||
        sib.getAttribute('data-oswyn-detail') !== null
      )) return true;
      // Action bar / footer row (branch button, copy button, usage meter) sits after
      // a trailing reply memo and must not disqualify it.
      try {
        var cls = sib.className && sib.className.baseVal !== undefined ? sib.className.baseVal : String(sib.className || '');
        if ((/_actions\b|endInfo\b/i.test(cls) || (sib.querySelector && sib.querySelector('[data-action="branch"], [data-action="fork"], button[aria-label*="分支"], button[title*="分支"]'))) &&
            (!sib.querySelector || !sib.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, pre'))) {
          return true;
        }
      } catch (_) {}
      return false;
    }

    function hasSubstantiveFollowingContent(sib) {
      if (isIgnorableFollowingSibling(sib)) return false;
      var txt = String(sib.textContent || '').trim();
      if (!txt) return false;
      var tag = (sib.tagName || '').toUpperCase();
      if (/^(P|PRE|UL|OL|TABLE|H1|H2|H3|H4|H5|H6|BLOCKQUOTE)$/.test(tag)) return true;
      if (sib.querySelector) {
        var proseEl = sib.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote');
        if (proseEl && String(proseEl.textContent || '').trim().length > 0) return true;
        var codeEls = sib.querySelectorAll ? sib.querySelectorAll('pre, .md-code-block, .code-block') : [];
        for (var ci = 0; ci < codeEls.length; ci++) {
          var ce = codeEls[ci];
          if (ce.classList && ce.classList.contains('dsh-oswyn-reply-summary-hidden')) continue;
          if (ce.getAttribute && ce.getAttribute('data-oswyn-folded') === '1') continue;
          if (String(ce.textContent || '').trim().length > 0) return true;
        }
      }
      if (txt.length > 40) return true;
      return false;
    }

    // True only when NO substantive answer content follows `el` in the same message
    // or turn. DSH wraps each code block in its own seat element, so checking only
    // `el.nextElementSibling` missed following answer prose and folded leading blocks
    // (such as a leading result-summary fence) into a "已压缩" chip before the answer.
    function isTrailingFence(el) {
      try {
        var ownTurn = turnKeyOf(el);
        var cur = el;
        for (var depth = 0; cur && cur !== document.body && cur !== document.documentElement && depth < 6; depth++) {
          var parent = cur.parentElement;
          var parentIsBody = !parent || parent === document.body || parent === document.documentElement;
          var curTurn = cur.getAttribute && cur.getAttribute('data-chat-turn');
          // When we climbed to a top-level element directly under <body>, only inspect
          // siblings that explicitly share the SAME data-chat-turn (never bleed into
          // unrelated messages or sibling test fixtures).
          if (depth > 0 && parentIsBody && !ownTurn) break;
          var sib = cur.nextElementSibling;
          while (sib) {
            if (sib.getAttribute && sib.getAttribute('data-chat-flow-kind') === 'user') break;
            var sibTurn = sib.getAttribute && sib.getAttribute('data-chat-turn');
            if (ownTurn && sibTurn !== null && sibTurn !== undefined && sibTurn !== '' && String(sibTurn) !== ownTurn) break;
            if (depth > 0 && parentIsBody && ownTurn && String(sibTurn || '') !== ownTurn) break;
            if (hasSubstantiveFollowingContent(sib)) return false;
            sib = sib.nextElementSibling;
          }
          if (parentIsBody) break;
          if (cur.hasAttribute && (cur.hasAttribute('data-message-id') || cur.hasAttribute('data-chat-message'))) break;
          if ((cur.tagName || '').toUpperCase() === 'ARTICLE') break;
          // Once we checked same-turn siblings of a [data-chat-turn] node, only keep
          // climbing if the parent still carries the same turn.
          if (curTurn !== null && curTurn !== undefined && curTurn !== '') {
            var pTurn = parent.getAttribute && parent.getAttribute('data-chat-turn');
            if (String(pTurn || '') !== String(curTurn)) break;
          }
          cur = parent;
        }
        return true;
      } catch (_) { return false; }
    }

    // True when substantive assistant answer prose precedes `el` in the same
    // turn/message (ignoring tool rows and step-process groups). A mid-step
    // streaming fence before any answer prose has no preceding prose and must
    // never flash a bare "已压缩" chip with no before→after stats.
    function hasPrecedingAnswerProse(el) {
      try {
        var ownTurn = turnKeyOf(el);
        var cur = el;
        for (var depth = 0; cur && cur !== document.body && cur !== document.documentElement && depth < 6; depth++) {
          var parent = cur.parentElement;
          var parentIsBody = !parent || parent === document.body || parent === document.documentElement;
          var curTurn = cur.getAttribute && cur.getAttribute('data-chat-turn');
          if (depth > 0 && parentIsBody && !ownTurn) break;
          var sib = prevSiblingOf(cur);
          while (sib) {
            if (sib.getAttribute && sib.getAttribute('data-chat-flow-kind') === 'user') break;
            var sibTurn = sib.getAttribute && sib.getAttribute('data-chat-turn');
            if (ownTurn && sibTurn !== null && sibTurn !== undefined && sibTurn !== '' && String(sibTurn) !== ownTurn) break;
            if (depth > 0 && parentIsBody && ownTurn && String(sibTurn || '') !== ownTurn) break;
            var isToolOrProcess = Boolean(
              (sib.hasAttribute && (sib.hasAttribute('data-tool') || sib.hasAttribute('data-step-process'))) ||
              (sib.querySelector && sib.querySelector('div[data-tool], [data-step-process]') && !sib.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote'))
            );
            if (!isToolOrProcess && hasSubstantiveFollowingContent(sib)) return true;
            sib = prevSiblingOf(sib);
          }
          if (parentIsBody) break;
          if (cur.hasAttribute && (cur.hasAttribute('data-message-id') || cur.hasAttribute('data-chat-message'))) break;
          if ((cur.tagName || '').toUpperCase() === 'ARTICLE') break;
          if (curTurn !== null && curTurn !== undefined && curTurn !== '') {
            var pTurn = parent.getAttribute && parent.getAttribute('data-chat-turn');
            if (String(pTurn || '') !== String(curTurn)) break;
          }
          cur = parent;
        }
        return false;
      } catch (_) { return false; }
    }

    var REPLY_MEMO_KEY_RE = /^[-*•]\s*(?:\*\*)?[^：:\n]{1,30}[：:]/;
    var REPLY_MEMO_CODE_RE = /(?:[{};]\s*$)|=>|<\/?[a-zA-Z][^>]*>|^\s*(?:const|let|var|function|class|def|import|export|return|package|SELECT|INSERT|UPDATE|DELETE)\b/i;

    function isLikelyChineseReplyMemo(el, text) {
      if (!el || !text) return false;
      // Never inside a user's own message: only assistant replies carry memos.
      try {
        if (el.closest && el.closest('[data-chat-flow-kind="user"]')) return false;
      } catch (_) {}
      var raw = String(text).split('\n');
      var lines = [];
      for (var r = 0; r < raw.length; r++) {
        var t = raw[r].trim();
        if (!t) continue;
        lines.push({ t: t, indented: /^\s{2,}/.test(raw[r]) });
      }
      if (!lines.length || lines.length > 10) return false;
      if (!/^[-*•]/.test(lines[0].t)) return false;
      if (String(text).length > 2000) return false;
      var bullets = 0;
      var keyed = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].t;
        if (/^[-*•]\s+/.test(line)) bullets++;
        else if (!lines[i].indented) return false;
        if (REPLY_MEMO_KEY_RE.test(line)) keyed++;
        if (REPLY_MEMO_CODE_RE.test(line)) return false;
      }
      if (bullets < 1) return false;
      // A memo with no "key: value" line is only accepted when it is unmistakably a
      // list (3+ bullets); this keeps ordinary unlabelled code samples out.
      if (keyed < 1 && bullets < 3) return false;
      return isTrailingFence(el);
    }

    function appendInlineMarkdown(parent, text) {
      if (!parent || !text) return;
      var s = String(text);
      var tokenRe = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(<?([^)>]+)>?\))/g;
      var lastIdx = 0;
      var m;
      while ((m = tokenRe.exec(s)) !== null) {
        if (m.index > lastIdx) {
          var span0 = document.createElement('span');
          span0.textContent = s.slice(lastIdx, m.index);
          parent.appendChild(span0);
        }
        if (m[2] !== undefined) {
          var strong = document.createElement('strong');
          strong.textContent = m[2];
          parent.appendChild(strong);
        } else if (m[3] !== undefined) {
          var code = document.createElement('code');
          code.textContent = m[3];
          parent.appendChild(code);
        } else if (m[4] !== undefined) {
          var codeLink = document.createElement('code');
          codeLink.textContent = m[4];
          if (m[5]) codeLink.setAttribute('title', m[5]);
          parent.appendChild(codeLink);
        }
        lastIdx = tokenRe.lastIndex;
      }
      if (lastIdx === 0) {
        parent.textContent = s;
      } else if (lastIdx < s.length) {
        var tailSpan = document.createElement('span');
        tailSpan.textContent = s.slice(lastIdx);
        parent.appendChild(tailSpan);
      }
    }

    function buildRescuedProseNode(proseText) {
      var wrap = document.createElement('div');
      wrap.className = 'dsh-oswyn-rescued-prose';
      wrap.setAttribute('data-oswyn-rescued-prose', '1');
      var lines = String(proseText || '').split('\n');
      var currentList = null;
      var currentListTag = '';
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        var t = raw.trim();
        if (!t) {
          currentList = null;
          currentListTag = '';
          continue;
        }
        var hMatch = t.match(/^(#{1,6})\s+(.*)$/);
        if (hMatch) {
          currentList = null;
          currentListTag = '';
          var hTag = 'h' + Math.min(6, hMatch[1].length);
          var hEl = document.createElement(hTag);
          appendInlineMarkdown(hEl, hMatch[2]);
          wrap.appendChild(hEl);
          continue;
        }
        var olMatch = t.match(/^\d+\.\s+(.*)$/);
        var ulMatch = !olMatch ? t.match(/^[-*•]\s+(.*)$/) : null;
        if (olMatch || ulMatch) {
          var wantTag = olMatch ? 'ol' : 'ul';
          if (!currentList || currentListTag !== wantTag) {
            currentList = document.createElement(wantTag);
            currentListTag = wantTag;
            wrap.appendChild(currentList);
          }
          var li = document.createElement('li');
          appendInlineMarkdown(li, (olMatch ? olMatch[1] : ulMatch[1]));
          currentList.appendChild(li);
          continue;
        }
        currentList = null;
        currentListTag = '';
        var p = document.createElement('p');
        appendInlineMarkdown(p, t);
        wrap.appendChild(p);
      }
      return wrap;
    }

    // Detect and split a merged fence where the model omitted the newline after the
    // closing ``` of dsh-result-summary (e.g. ```已定位并修复... followed by ```dsh-ui),
    // causing CommonMark to swallow the prose and/or dsh-ui block into the directive block.
    function rescueMergedResultFence(block) {
      if (!block || !block.getAttribute) return false;
      if (block.getAttribute('data-genui-rendered') !== null || block.getAttribute('data-oswyn-rescued-ui') === '1') {
        return true;
      }
      var text = extractCodeBodyText(block);
      if (!text || !hasResultDirectivePrefix(text)) return false;
      var closeIdx = text.indexOf('\n\u0060\u0060\u0060');
      if (closeIdx < 0) return false;
      var tail = text.slice(closeIdx + 4);
      if (!tail || !tail.trim()) return false;

      var uiMatch = tail.match(/(?:^|\n)\u0060\u0060\u0060(dsh-ui|svg)\b[^\n]*\n([\s\S]*)$/i);
      var proseText = '';
      var uiLang = '';
      var uiCode = '';
      if (uiMatch) {
        proseText = tail.slice(0, uiMatch.index).trim();
        uiLang = uiMatch[1].toLowerCase();
        uiCode = uiMatch[2].replace(/\n\u0060\u0060\u0060\s*$/, '').trim();
      } else {
        proseText = tail.replace(/\n\u0060\u0060\u0060\s*$/, '').trim();
      }

      if (proseText && block.parentNode) {
        var prev = prevSiblingOf(block);
        if (!prev || !prev.getAttribute || prev.getAttribute('data-oswyn-rescued-prose') !== '1') {
          try {
            var proseNode = buildRescuedProseNode(proseText);
            block.parentNode.insertBefore(proseNode, block);
          } catch (_) {}
        }
      }

      if (uiLang && uiCode) {
        try {
          var codeNode = (block.querySelector && (block.querySelector('code') || block.querySelector('pre'))) || null;
          if (codeNode) codeNode.textContent = uiCode;
          var langNode = block.querySelector && block.querySelector('.language, [class*="language"], .infostring, [class*="infostring"]');
          if (langNode) langNode.textContent = uiLang;
          if (block.setAttribute) {
            block.setAttribute('data-lang', uiLang);
            block.setAttribute('data-oswyn-rescued-ui', '1');
          }
          unmarkBlock(block);
        } catch (_) {}
        return true;
      }
      return false;
    }

    // Comprehensive test whether an element represents an oswyn distillation fence.
    // Checks fence tags, recorded ledger summaries, and authoritative directive/memo signatures.
    // NEVER matches regular user prose paragraphs or programming language code blocks.
    function isOswynBlock(el) {
      if (!el) return false;
      if (el.closest && !el.closest('[data-chat-turn]') && el.closest('nav, aside, [role="navigation"], [data-sidebar], [class*="sidebar" i], [class*="sessionList" i], [class*="conversationList" i]')) {
        return false;
      }
      // Sticky: once this element was identified as an oswyn fence it stays one, so a
      // later ledger refresh can never un-mark (reveal) an already folded fence.
      // Guarded by the recorded body text, so a DOM node React reused for different
      // content is re-classified instead of staying hidden forever.
      if (el.getAttribute && el.getAttribute('data-oswyn-fence') === '1') {
        if (el.__oswynFenceBody === undefined || el.__oswynFenceBody === extractCodeBodyText(el)) return true;
        clearAttr(el, 'data-oswyn-fence');
      }
      if (el.getAttribute && (el.getAttribute('data-genui-rendered') !== null || el.getAttribute('data-oswyn-rescued-ui') === '1')) {
        return false;
      }
      var tag = (el.tagName || '').toUpperCase();
      // Guard: prose containers (paragraphs, headings, lists, tables) must NEVER be treated as oswyn blocks
      if (tag === 'P' || tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'FORM' || /^H[1-6]$/.test(tag)) return false;
      if (el.querySelector && el.querySelector('p, ul, ol, table, form, h1, h2, h3, h4, h5, h6')) return false;

      // Must have code-block characteristics
      var isCodeLike = tag === 'PRE' || tag === 'CODE' || (el.classList && el.classList.contains('md-code-block')) || (el.className && String(el.className).indexOf('code-block') >= 0);
      if (!isCodeLike) return false;

      // Extract explicit language tag on the code block (if any)
      var langTag = (el.getAttribute && el.getAttribute('data-lang')) || '';
      if (!langTag && el.querySelector) {
        var info = el.querySelector('.infostring, [class*="infostring"], [data-code-block-lang]');
        if (info) langTag = (info.textContent || '').trim();
        if (!langTag) {
          var langEl = el.querySelector('[class*="language"], .language');
          if (langEl) langTag = (langEl.textContent || '').trim();
        }
        if (!langTag) {
          var cChild = el.querySelector('code[data-lang],pre[data-lang]');
          if (cChild) langTag = (cChild.getAttribute('data-lang') || '').trim();
        }
      }
      langTag = String(langTag).toLowerCase();

      // Guard: ordinary programming/markup or UI code blocks (e.g. dsh-ui, svg, json, bash, ts, js, diff, etc.)
      // must NEVER be folded, even if their code body mentions oswyn markers or memos.
      // Note: DSH's CodeToolbar renders "代码块" or "code" when lang is unsupported (like dsh-reply-summary).
      var NORMAL_LANGS = /^(dsh-ui|svg|javascript|js|typescript|ts|jsx|tsx|python|py|bash|sh|shell|zsh|json|markdown|md|diff|yaml|yml|css|scss|less|html|sql|rust|go|c|cpp|java|kotlin|swift|ruby|php|xml|toml|ini)$/;
      if (langTag && NORMAL_LANGS.test(langTag)) return false;

      if (hasFenceLang(el)) return true;
      try {
        var text = extractCodeBodyText(el);
        if (!text) return false;
        var stripped = stripLeadingDirectiveLines(text);

        // 0) Sticky per-body classification from an earlier sync (survives ledger refresh).
        // Both verdicts mean "this IS an oswyn fence": reply memos become a chip,
        // tool summaries are hidden. Returning `false` here for a tool fence used to
        // make unmarkBlock() re-reveal blocks that had already been hidden.
        if (knownMemoKind(text) !== null) return true;

        // 1) Exact match against known summaries recorded in the session ledger
        if (matchesKnownBody(knownSummaries, text) || (stripped && matchesKnownBody(knownSummaries, stripped))) return true;

        // 2) Authoritative memo signatures (reply summary):
        if (/^(?:>\s*)?[-*•\s]*DENSE\s+(?:DECISION-COMPLETE\s+)?MEMO/im.test(text)) return true;
        if (text.indexOf('[oswyn 双轨备忘') >= 0) return true;
        if (/^(?:>\s*)?[-*•\s]*(?:STATUS\s*&|OPEN\s+ITEMS|OSWYN\s+测试|双轨备忘)/im.test(text)) return true;

        var hasBanner = Boolean(el.hasAttribute && el.hasAttribute('data-code-block-banner')) ||
                        Boolean(el.querySelector && el.querySelector('[data-code-block-banner], .bannerWrap, .banner, [class*="bannerWrap"], [class*="header"]'));
        var isGenericHeader = !langTag || langTag === '代码块' || langTag === 'code';

        // 3) For directive-based summary blocks (dsh-result-summary) whose header was rendered as "代码块":
        // Matches all valid oswyn directives (including `discard entire-ptc`, 1-line `truncate keep 8 lines`,
        // `seq 1\nprotect`, `> discard`, etc.).
        if (hasBanner && isGenericHeader && hasResultDirectivePrefix(text)) {
          return true;
        }

        // 4) Structured multi-bullet reply memo inside a fenced block. The header text is
        // NOT required to be the generic "代码块": some builds keep the raw fence language,
        // some localise the label; the memo body + tail position identify it either way.
        // A fence block is also accepted when the toolbar has not rendered (yet): DSH
        // builds it lazily, and requiring it made the first paint fold and the next
        // paint un-fold (the chip that disappeared right after appearing).
        var isFenced = hasBanner ||
          Boolean(el.classList && (el.classList.contains('md-code-block') || el.classList.contains('code-block'))) ||
          Boolean(el.hasAttribute && el.hasAttribute('data-code-block-content'));
        if (isFenced && isLikelyChineseReplyMemo(el, text)) {
          return true;
        }
      } catch (_) {}
      return false;
    }

    // True only for an ASSISTANT REPLY memo fence (dsh-reply-summary). Tool-result
    // fences (dsh-result-summary) are machine directives for a compressed tool
    // row and must be hidden entirely, not shown as a "已压缩 · 点击展开" chip.
    function isReplyFenceBlock(el) {
      if (!el) return false;
      try {
        // Explicit result-summary (or legacy/underscore variants) fence or inside a tool row is NEVER a reply fence.
        if (hasExplicitFenceTag(el, 'result-summary') || hasExplicitFenceTag(el, 'dsh-result-summary')
          || hasExplicitFenceTag(el, 'result_summary') || hasExplicitFenceTag(el, 'dsh_result_summary')) return false;
        // NOTE: do not reject everything under [data-step-process] — DSH's step-process
        // group also wraps assistant content, and that blanket rejection is what made a
        // reply chip appear and then vanish once the group mounted.
        if (el.closest && el.closest('div[data-tool]')) return false;

        // A reply-summary fence ALWAYS sits at the tail of an assistant answer.
        // Any block followed by substantive answer prose in the same message/turn
        // (e.g. a leading result-summary fence before the answer, or an intermediate
        // step fence before the final answer) must NEVER render a "已压缩" chip —
        // even if it was earlier sticky-marked during streaming before prose arrived.
        if (!isTrailingFence(el)) return false;

        var explicitReplyTag = hasExplicitFenceTag(el, 'reply-summary') || hasExplicitFenceTag(el, 'dsh-reply-summary');
        var text = extractCodeBodyText(el);
        var stripped = text ? stripLeadingDirectiveLines(text) : '';

        // If the ledger authoritatively identifies this body as a tool summary (and not
        // a reply summary) and the fence has no explicit reply-summary tag, override any
        // pre-ledger heuristic guess so a leading tool fence never stays a reply chip.
        if (!explicitReplyTag && text && !matchesKnownBody(knownReplySummaries, text) &&
            (matchesKnownBody(knownToolSummaries, text) || (stripped && matchesKnownBody(knownToolSummaries, stripped)))) {
          return false;
        }

        // Sticky per-element verdict, recorded by hideReplySummaryBlocks(). Without it a
        // ledger refresh can re-classify an already folded reply memo as a tool fence,
        // which deletes its chip and re-reveals the raw block (visible as blinking).
        var stickyKind = el.getAttribute && el.getAttribute('data-oswyn-fence-kind');
        if (stickyKind) {
          if (el.__oswynFenceBody === undefined || el.__oswynFenceBody === text) {
            if (stickyKind === 'reply') return true;
            if (stickyKind === 'tool') return false;
          } else {
            clearAttr(el, 'data-oswyn-fence-kind');
          }
        }

        if (explicitReplyTag) return true;
        if (!text) return false;

        // Sticky per-body verdict from an earlier sync (survives a ledger refresh).
        var bodyKind = knownMemoKind(text);
        if (bodyKind !== null) return bodyKind;

        // If the block starts with a tool-result directive (`replace`, `truncate`, `discard`,
        // `discard entire-ptc`, `seq ...`, `protect`, `prune-call`, etc.), it is a tool-result
        // summary fence and must NEVER be folded into a reply chip.
        if (hasResultDirectivePrefix(text)) return false;

        // Authoritative ledger check: if recorded as a reply summary, fold it.
        if (matchesKnownBody(knownReplySummaries, text)) return true;

        if (/^(?:>\s*)?[-*•\s]*DENSE\s+(?:DECISION-COMPLETE\s+)?MEMO/im.test(text)) return true;
        if (text.indexOf('[oswyn 双轨备忘') >= 0 || text.indexOf('[oswyn 双轨') >= 0) return true;
        if (/^(?:>\s*)?[-*•\s]*(?:STATUS\s*&|OPEN\s+ITEMS)/im.test(text)) return true;

        var hasBanner = Boolean(el.hasAttribute && el.hasAttribute('data-code-block-banner')) ||
                        Boolean(el.querySelector && el.querySelector('[data-code-block-banner], .bannerWrap, .banner, [class*="bannerWrap"], [class*="header"]'));
        var isFenced = hasBanner ||
          Boolean(el.classList && (el.classList.contains('md-code-block') || el.classList.contains('code-block'))) ||
          Boolean(el.hasAttribute && el.hasAttribute('data-code-block-content'));
        if (isFenced && isLikelyChineseReplyMemo(el, text)) {
          // Inside a real chat turn ([data-chat-turn]), a heuristic bullet fence with
          // NO preceding answer prose is a mid-step tool summary (streaming before the
          // next tool call or answer). Hide it silently instead of flashing a bare
          // "已压缩" chip with no before→after stats.
          if (turnKeyOf(el) && !hasPrecedingAnswerProse(el)) return false;
          return true;
        }
      } catch (_) {}
      return false;
    }

    // Hide/fold oswyn fences: reply memos become a chip when foldReplySummary is enabled
    // (otherwise hidden); tool-result directives disappear entirely.
    function hideReplySummaryBlocks() {
      if (typeof document === 'undefined') return;
      var foldEnabled = (typeof window === 'undefined' || window.__oswynFoldReplySummary !== false);
      // 1) Known-class blocks (covers builds that use md-code-block/code-block).
      var blocks = document.querySelectorAll('.md-code-block, .code-block, [class*="code-block"]');
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.parentElement && block.parentElement.closest && block.parentElement.closest('.md-code-block, .code-block, [class*="code-block"]')) continue;
        if (rescueMergedResultFence(block)) continue;
        if (!isOswynBlock(block)) {
          unmarkBlock(block);
          continue;
        }
        var isReply = isReplyFenceBlock(block);
        // Remember the verdict on the element and on its body text so a later ledger
        // refresh can never flip this fence between "reply memo" and "tool directive".
        try {
          block.__oswynFenceBody = extractCodeBodyText(block);
          block.setAttribute('data-oswyn-fence', '1');
          block.setAttribute('data-oswyn-fence-kind', isReply ? 'reply' : 'tool');
        } catch (_) {}
        if (isReply) {
          markReplyMemoBody(extractCodeBodyText(block));
          if (foldEnabled) foldBlock(block);
          else markHidden(block);
        } else {
          markToolMemoBody(extractCodeBodyText(block));
          markHidden(block);
        }
      }
      // 2) Standalone pre blocks NOT enclosed in a standard code-block container.
      var pres = document.querySelectorAll('pre');
      for (var p = 0; p < pres.length; p++) {
        var pre = pres[p];
        if (pre.closest && pre.closest('.md-code-block, .code-block, [class*="code-block"]')) continue;
        if (rescueMergedResultFence(pre)) continue;
        if (!isOswynBlock(pre)) {
          unmarkBlock(pre);
          continue;
        }
        var isPreReply = isReplyFenceBlock(pre);
        try {
          pre.__oswynFenceBody = extractCodeBodyText(pre);
          pre.setAttribute('data-oswyn-fence', '1');
          pre.setAttribute('data-oswyn-fence-kind', isPreReply ? 'reply' : 'tool');
        } catch (_) {}
        if (isPreReply) {
          markReplyMemoBody(extractCodeBodyText(pre));
          if (foldEnabled) foldBlock(pre);
          else markHidden(pre);
        } else {
          markToolMemoBody(extractCodeBodyText(pre));
          markHidden(pre);
        }
      }
      // 2a) Hide raw XML result-summary elements or paragraphs rendered literally in assistant messages.
      try {
        var xmlTags = document.querySelectorAll('result_summary, result-summary, dsh-result-summary, dsh_result_summary');
        for (var xi = 0; xi < xmlTags.length; xi++) {
          markHidden(xmlTags[xi]);
        }
        var paras = document.querySelectorAll('p');
        for (var pi = 0; pi < paras.length; pi++) {
          var para = paras[pi];
          if (para.closest && (para.closest('[data-chat-flow-kind="user"]') || para.closest('pre, code, .md-code-block, .code-block'))) continue;
          var pText = String(para.textContent || '').trim();
          if (!pText) continue;
          if (/^<(?:dsh[-_])?result[-_]summary(?:\s[^>]*)?>[\s\S]*?(?:<\/(?:dsh[-_])?result[-_]summary>)?$/i.test(pText) ||
              /^<\/(?:dsh[-_])?result[-_]summary>$/i.test(pText)) {
            markHidden(para);
          }
        }
      } catch (_) {}

      // 2b) Collapse duplicate DOM fold chips: a block must own exactly one chip, and
      // a chip must own exactly one block. React re-mounting a message (conversation
      // switch, virtualised list) can otherwise leave a stale chip behind.
      try {
        var dupChips = document.querySelectorAll('.' + FOLD_CHIP_CLASS);
        var seenBlocks = [];
        for (var dci = 0; dci < dupChips.length; dci++) {
          var dChip = dupChips[dci];
          if (dChip.hasAttribute && dChip.hasAttribute('data-oswyn-reply-fallback')) continue;
          if (dChip.hasAttribute && dChip.hasAttribute('data-oswyn-turn-tail')) continue;
          var dTarget = dChip.nextElementSibling;
          if (!dTarget) continue;
          if (seenBlocks.indexOf(dTarget) >= 0) { if (dChip.remove) dChip.remove(); continue; }
          seenBlocks.push(dTarget);
        }
      } catch (_) {}

      // 2c) At most ONE DOM fold chip per turn (always the LAST/trailing one at the
      // end of the answer). Any earlier chip in the same turn (e.g. from an
      // intermediate step or leading fence before the answer) is converted to hidden.
      try {
        var turnChips = document.querySelectorAll('.' + FOLD_CHIP_CLASS);
        var byTurn = {};
        for (var tci = 0; tci < turnChips.length; tci++) {
          var tChip = turnChips[tci];
          if (tChip.hasAttribute && tChip.hasAttribute('data-oswyn-reply-fallback')) continue;
          if (tChip.hasAttribute && tChip.hasAttribute('data-oswyn-turn-tail')) continue;
          var tTarget = tChip.nextElementSibling;
          if (!tTarget) continue;
          var tk = turnKeyOf(tTarget);
          if (!tk) continue;
          (byTurn[tk] || (byTurn[tk] = [])).push({ chip: tChip, target: tTarget });
        }
        for (var turnId in byTurn) {
          if (!Object.prototype.hasOwnProperty.call(byTurn, turnId)) continue;
          var arr = byTurn[turnId];
          if (arr.length <= 1) continue;
          for (var ai = 0; ai < arr.length - 1; ai++) {
            try { arr[ai].target.setAttribute('data-oswyn-fence-kind', 'tool'); } catch (_) {}
            markHidden(arr[ai].target);
            if (arr[ai].chip && arr[ai].chip.parentNode && arr[ai].chip.remove) arr[ai].chip.remove();
          }
        }
      } catch (_) {}

      // 3) Clean up any orphaned or stale `.dsh-oswyn-fold-chip` elements left behind
      // when React unmounts/reuses a block or when foldReplySummary is disabled.
      try {
        var chips = document.querySelectorAll('.' + FOLD_CHIP_CLASS);
        for (var c = 0; c < chips.length; c++) {
          var chip = chips[c];
          if (chip.hasAttribute && chip.hasAttribute('data-oswyn-turn-tail')) continue;
          if (chip.hasAttribute && chip.hasAttribute('data-oswyn-reply-fallback')) {
            if (!foldEnabled) {
              var wrapEl = chip.parentNode;
              if (wrapEl && wrapEl.hasAttribute && wrapEl.hasAttribute('data-oswyn-reply-fallback-wrap') && wrapEl.remove) wrapEl.remove();
              else if (chip.remove) chip.remove();
            }
            continue;
          }
          var target = chip.nextElementSibling;
          if (!foldEnabled || !target || !target.getAttribute || target.getAttribute('data-oswyn-folded') !== '1' || !isOswynBlock(target) || !isReplyFenceBlock(target)) {
            if (chip.remove) chip.remove();
          }
        }
      } catch (_) {}
    }

    // Resolve a row's call id from itself or its nearest [data-chat-call-id] ancestor.
    function callIdOfRow(row) {
      try {
        var el = row;
        for (var d = 0; el && d < 6; d++) {
          var cid = el.getAttribute && el.getAttribute('data-chat-call-id');
          if (cid) return cid;
          el = el.parentElement;
        }
        var anc = row.closest && row.closest('[data-chat-call-id]');
        return anc ? anc.getAttribute('data-chat-call-id') : '';
      } catch (_) { return ''; }
    }

    // Collect every tool row, INCLUDING container rows. PTC `run_code` rows own
    // the compressed tool result but also contain the subcall rows of the
    // program they executed; skipping containers made exactly those compressed
    // rows undecoratable. Ownership is resolved per row by data-chat-call-id.
    function collectToolRows() {
      if (typeof document === 'undefined') return [];
      var nodes = document.querySelectorAll('div[data-tool], div[data-sample="bash"][data-state], div[data-variant][data-state]');
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.hasAttribute('data-step-process')) continue;
        if (!node.hasAttribute('data-state')) continue; // require real tool-row shape
        out.push(node);
      }
      return out;
    }

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) return;
      var styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.setAttribute('data-plugin-css', 'dsh-oswyn');
      styleEl.textContent = [
        '/* hide oswyn tool fences and reply-summary memo fences (never real user content) */',
        '.dsh-oswyn-reply-summary-hidden, result_summary, result-summary, dsh-result-summary, dsh_result_summary { display: none !important; }',
        '.dsh-oswyn-fold-chip { display: inline-flex; align-items: center; gap: 4px; margin: 2px 0; padding: 2px 8px; height: 22px; border-radius: 6px; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; cursor: pointer; outline: none; color: var(--dsw-alias-label-secondary, #8a8a8a); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); border: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2)); white-space: nowrap; transition: background 0.15s ease, color 0.15s ease; }',
        '.dsh-oswyn-fold-chip:hover, .dsh-oswyn-fold-chip[data-open="true"] { color: var(--dsw-alias-label-primary, #e8eaed); background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.12)); }',
        '.dsh-oswyn-fold-chip:focus { outline: none; }',
        '.dsh-oswyn-reply-memo-body { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.08)); font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-primary, #e8eaed); }',
        '.dsh-oswyn-reply-memo-body p { margin: 0 0 6px 0; }',
        '.dsh-oswyn-reply-memo-body p:last-child { margin-bottom: 0; }',
        '.dsh-oswyn-reply-memo-body ul, .dsh-oswyn-reply-memo-body ol { margin: 0; padding-left: 16px; }',
        '.dsh-oswyn-reply-memo-body li { margin: 2px 0; }',
        '.dsh-oswyn-reply-memo-body code { font-size: 11px; padding: 1px 4px; border-radius: 4px; background: rgba(255,255,255,0.08); }',
        // Sits in the message footer next to the host's own stats, so it must look
        // like one of them: inherit the neighbour's font, size, weight and colour,
        // and add no padding/box of its own (it used to stand out as a chip).
        '.dsh-oswyn-deep-turn-chip { display: inline-flex; align-items: center; gap: 4px; margin: 2px 0; padding: 2px 8px; height: 22px; border-radius: 6px; font-size: 11px; line-height: 1; font-variant-numeric: tabular-nums; cursor: pointer; outline: none; color: var(--dsw-alias-label-secondary, #8a8a8a); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); border: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.22)); white-space: nowrap; transition: background 0.15s ease, color 0.15s ease; }',
        '.dsh-oswyn-deep-turn-chip:hover, .dsh-oswyn-deep-turn-chip[data-open="true"] { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.14)); }',
        '.dsh-oswyn-deep-turn-chip:focus { outline: none; }',
        '.dsh-oswyn-turn-pill { display: inline-flex; align-items: center; gap: 2px; margin: 0 0 0 2px; padding: 0; height: auto; border-radius: 0; font: inherit; font-size: inherit; font-weight: inherit; line-height: inherit; font-variant-numeric: tabular-nums; cursor: pointer; color: inherit; background: none; border: none; outline: none; white-space: nowrap; vertical-align: baseline; opacity: 1; }',
        '.dsh-oswyn-turn-pill:hover, .dsh-oswyn-turn-pill[data-open="true"] { color: inherit; background: none; text-decoration: none; }',
        '.dsh-oswyn-turn-pill:focus { outline: none; }',
        '',
        '/* official-style, restrained inline compression attachment */',
        '.' + GROUP_HINT_CLASS + ' { margin-left: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #999); font-weight: 400; white-space: nowrap; }',
        '.' + BADGE_CLASS + ' {',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 2px;',
        '  margin-left: 6px;',
        '  padding: 0 6px;',
        '  height: 16px;',
        '  border-radius: 4px;',
        '  font-size: 11px;',
        '  line-height: 1;',
        '  font-weight: 500;',
        '  font-variant-numeric: tabular-nums;',
        '  white-space: nowrap;',
        '  vertical-align: middle;',
        '  flex: none;',
        '  cursor: pointer;',
        '  user-select: none;',
        '  color: var(--dsw-alias-label-secondary, #8a8a8a);',
        '  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));',
        '  border: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.22));',
        '  transition: background 0.15s ease, color 0.15s ease;',
        '  position: relative;',
        '}',
        '.' + BADGE_CLASS + ':hover { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.14)); }',
        '.' + BADGE_CLASS + '[data-open="true"] { display: inline-block; }',
        '.' + BADGE_CLASS + '[data-open="true"] [data-dsh-oswyn-fig] { display: inline; }',
        '.' + BADGE_CLASS + '[data-mode="discard"] { opacity: 0.85; }',
        '.' + BADGE_CLASS + ' [data-dsh-oswyn-cap] { opacity: 0.75; }',
        '.dsh-oswyn-inline-panel {',
        '  position: fixed;',
        '  z-index: 9999;',
        '  min-width: 280px;',
        '  max-width: min(360px, calc(100vw - 32px));',
        '  max-height: calc(100vh - 24px);',
        '  overflow-y: auto;',
        '  box-sizing: border-box;',
        '  white-space: normal;',
        '  text-align: left;',
        '  cursor: default;',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(styleEl);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Timeline Projection Patch: clean pure dsh-result-summary machine fences
    // from assistant-step reply blocks so DSH natively merges consecutive tool calls
    // into a single unified "运行了代码和命令" ProcessGroup.
    // ─────────────────────────────────────────────────────────────────────────
    var UI_RESULT_FENCE_RE = /```(?:(?:dsh[-_])?result[-_]summary\b[^\n]*\n[\s\S]*?```|(?:dsh[-_])?result[-_]summary\b[\s\S]*?$)/gi;
    var UI_RESULT_XML_RE = /<(?:dsh[-_])?result[-_]summary(?:\s[^>]*)?>[\s\S]*?(?:<\/(?:dsh[-_])?result[-_]summary>|$)/gi;

    function stripUiResultSummary(text) {
      if (!text || typeof text !== 'string') return '';
      return text.replace(UI_RESULT_XML_RE, '').replace(UI_RESULT_FENCE_RE, '').trim();
    }

    function hasUiResultSummary(text) {
      if (!text || typeof text !== 'string') return false;
      return /(?:dsh[-_])?result[-_]summary/i.test(text);
    }

    function isPureResultSummaryText(text) {
      if (!text || typeof text !== 'string') return false;
      var t = text.trim();
      if (!t) return false;
      var stripped = stripUiResultSummary(t);
      if (!stripped) return true;
      if (typeof hasResultDirectivePrefix === 'function' && hasResultDirectivePrefix(stripped)) {
        var withoutDirectives = typeof stripLeadingDirectiveLines === 'function'
          ? stripLeadingDirectiveLines(stripped)
          : '';
        if (!withoutDirectives) return true;
      }
      return false;
    }

    function cleanAssistantBlocksForUi(blocks) {
      if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
      var hasToolCall = false;
      var hasXmlResultTag = false;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b && (b.kind === 'tool-call' || b.type === 'tool-call' || b.callId)) {
          hasToolCall = true;
        }
        if (b && (b.kind === 'text' || b.type === 'text') && typeof b.text === 'string' && /<(?:dsh[-_])?result[-_]summary(?:\s|>)/i.test(b.text)) {
          hasXmlResultTag = true;
        }
      }
      if (!hasToolCall && !hasXmlResultTag) return blocks;

      var changed = false;
      var out = [];
      for (var j = 0; j < blocks.length; j++) {
        var blk = blocks[j];
        var isText = blk && (blk.kind === 'text' || blk.type === 'text') && typeof blk.text === 'string';
        if (!isText) {
          out.push(blk);
          continue;
        }
        var rawText = blk.text;
        if (hasUiResultSummary(rawText) || (hasToolCall && typeof hasResultDirectivePrefix === 'function' && hasResultDirectivePrefix(rawText))) {
          if (isPureResultSummaryText(rawText)) {
            changed = true;
            continue;
          }
          var strippedText = stripUiResultSummary(rawText);
          if (strippedText !== rawText.trim()) {
            changed = true;
            if (strippedText.length > 0) {
              out.push(Object.assign({}, blk, { text: strippedText }));
            }
            continue;
          }
        }
        out.push(blk);
      }
      return changed ? out : blocks;
    }

    function patchUiConversationEvents(uiConversation) {
      if (!uiConversation || !uiConversation.events) return;
      var registry = uiConversation.events;
      var defs = registry.definitions;
      if (!defs || typeof defs.get !== 'function') return;

      function installPatch(assistantDef) {
        if (!assistantDef || assistantDef.__oswynPatched) return;
        assistantDef.__oswynPatched = true;

        var origBuildLocationData = assistantDef.buildLocationData;
        if (typeof origBuildLocationData === 'function') {
          assistantDef.buildLocationData = function (context, scope) {
            var res = origBuildLocationData.apply(this, arguments);
            if (res && res.value && Array.isArray(res.value.blocks)) {
              var cleaned = cleanAssistantBlocksForUi(res.value.blocks);
              if (cleaned !== res.value.blocks) {
                res = Object.assign({}, res, {
                  value: Object.assign({}, res.value, { blocks: cleaned })
                });
              }
            }
            return res;
          };
        }

        var origBuildViewNode = assistantDef.buildViewNode;
        if (typeof origBuildViewNode === 'function') {
          assistantDef.buildViewNode = function (context) {
            var node = origBuildViewNode.apply(this, arguments);
            if (node && node.data && Array.isArray(node.data.blocks)) {
              var cleanedNodeBlocks = cleanAssistantBlocksForUi(node.data.blocks);
              if (cleanedNodeBlocks !== node.data.blocks) {
                node = Object.assign({}, node, {
                  data: Object.assign({}, node.data, { blocks: cleanedNodeBlocks })
                });
              }
            }
            return node;
          };
        }

        var origUpdate = assistantDef.update;
        if (typeof origUpdate === 'function') {
          assistantDef.update = function (context, match) {
            var nextState = origUpdate.apply(this, arguments);
            if (nextState && Array.isArray(nextState.blocks)) {
              var cleanedStateBlocks = cleanAssistantBlocksForUi(nextState.blocks);
              if (cleanedStateBlocks !== nextState.blocks) {
                nextState = Object.assign({}, nextState, {
                  blocks: cleanedStateBlocks
                });
              }
            }
            return nextState;
          };
        }

        try {
          if (typeof registry.refresh === 'function') {
            registry.refresh();
          }
        } catch (_) {}
      }

      var existing = defs.get('assistant-step');
      if (existing) installPatch(existing);
      if (typeof registry.subscribe === 'function') {
        registry.subscribe(function () {
          var stepDef = defs.get('assistant-step');
          if (stepDef) installPatch(stepDef);
        });
      }
    }

    exports.isPureResultSummaryText = isPureResultSummaryText;
    exports.cleanAssistantBlocksForUi = cleanAssistantBlocksForUi;
    exports.patchUiConversationEvents = patchUiConversationEvents;
    // Settings widgets edit large counts in thousands; exposed for tests so the
    // scaling contract (display = stored/1000, stored = round(display*1000)) is
    // pinned independently of the React tree.
    exports.kiloToDisplay = kiloToDisplay;
    exports.kiloToStored = kiloToStored;
    exports.numberFieldView = numberFieldView;

    exports.name = 'dsh-oswyn';
    // `slots` is required for the in-conversation decorators. `configForms` is
    // OPTIONAL: treating it as a hard inject made the whole client half wait
    // forever when the settings form service was not ready, which disabled both
    // fence folding and compression badges. Resolve it lazily instead.
    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      try { document.documentElement.setAttribute('data-oswyn-client-applied', '1'); } catch (_) {}

      // Register the turn-tail slot at apply() level: whileServed(...) only runs on
      // the plugins page, which is why the marker never appeared in normal chat.
      var turnTailListeners = [];
      function notifyTurnTailListeners() {
        for (var i = 0; i < turnTailListeners.length; i++) {
          try { turnTailListeners[i](); } catch (_) {}
        }
      }
      (function () {
        try {
          var ts = ctx.slots || (ctx.get && ctx.get('slots'));
          if (!ts || typeof ts.inject !== 'function') return;
          function OswynTurnTail(props) {
            var tickState = React.useState(0);
            var setTick = tickState[1];
            React.useEffect(function () {
              var fn = function () { setTick(function (n) { return n + 1; }); };
              turnTailListeners.push(fn);
              return function () {
                var idx = turnTailListeners.indexOf(fn);
                if (idx >= 0) turnTailListeners.splice(idx, 1);
              };
            }, []);
            try {
              if (!ctxPerTurnEnabled) return null;
              var sessionId = props && (props.sessionId || (props.owner && props.owner.sessionId));
              var owner = (props && props.owner) || {};
              var rawTurn = props && (props.turn !== undefined ? props.turn :
                (props.turnIndex !== undefined ? props.turnIndex :
                  (owner.turn !== undefined ? owner.turn :
                    (owner.turnNumber !== undefined ? owner.turnNumber : props.turnNumber))));
              var turn = Number(rawTurn);
              if (!Number.isFinite(turn) || turn <= 0) return null;
              var sess = null;
              for (var i = 0; i < ctxAllSessions.length; i++) {
                if (ctxAllSessions[i] && (!sessionId || String(ctxAllSessions[i].sessionId) === String(sessionId))) { sess = ctxAllSessions[i]; break; }
              }
              if (!sess) return null;
              var per = ctxTurnStats(sess);
              var m = per[turn];
              if (!m || (!m.events && !m.replies && !m.deepDistilled)) return null;
              var totalEvents = (m.events || 0) + (m.replies || 0);
              var pct = m.before > 0 ? Math.round(((m.before - m.after) / m.before) * 100) : 0;
              var deepPct = (m.deepRawTokens > 0 && m.deepSaved > 0) ? Math.round((m.deepSaved / m.deepRawTokens) * 100) : 0;
              var label;
              if (totalEvents > 0) {
                label = (m.before > 0 && pct > 0) ? ('−' + pct + '%') : (totalEvents + ' 次');
              } else if (deepPct > 0) {
                label = '−' + deepPct + '%';
              } else {
                return null;
              }
              return el('button', {
                type: 'button',
                className: 'dsh-oswyn-turn-pill',
                'data-oswyn-turn-tail': 'slot:' + turn,
                'data-oswyn-deep-turn': m.deepDistilled ? 'true' : 'false',
                'aria-haspopup': 'dialog',
                title: '本轮压缩 −' + pct + '%（含回复双轨）' + (m.deepDistilled ? (' · 2.4 轮次蒸馏' + (m.deepSaved > 0 ? (' 省 ~' + formatTokens(m.deepSaved) + ' tok') : '')) : '') + ' · 点击查看详情',
                // Match the host footer text at mount time: the pill sits in the same
                // row as "用量 … tok" and must be indistinguishable from it in size.
                ref: function (node) {
                  if (!node) return;
                  matchFooterTypography(node, findUsageSibling(node) || node.parentElement);
                },
                onClick: function (ev) {
                  if (ev && ev.preventDefault) ev.preventDefault();
                  if (ev && ev.stopPropagation) ev.stopPropagation();
                  if (ev && ev.currentTarget) ctxOpenTurnDetail(ev.currentTarget, turn, m);
                }
              }, label);
            } catch (_) { return null; }
          }
          var unreg = ts.inject('conversation.chat.turnTail', function () {
            return ts.register({
              name: 'conversation.chat.turnTail',
              id: 'dsh-oswyn-turn-stats',
              inject: function (id) { return { sessionId: id }; }
            }, OswynTurnTail);
          });
          if (typeof ctx.effect === 'function') {
            ctx.effect(function () { return function () { if (typeof unreg === 'function') unreg(); }; });
          }
        } catch (_) {}
      })();

      function trySetupUiConversation() {
        try {
          var conv = (ctx && typeof ctx.get === 'function' ? ctx.get('uiConversation') : null)
            || (ctx && ctx.uiConversation)
            || (typeof window !== 'undefined' && window.__dshUiConversation)
            || null;
          if (conv && conv.events) {
            patchUiConversationEvents(conv);
            return true;
          }
        } catch (_) {}
        return false;
      }

      if (!trySetupUiConversation()) {
        if (typeof ctx.inject === 'function') {
          try {
            ctx.inject(['uiConversation'], function (sub) {
              if (sub && sub.uiConversation) {
                patchUiConversationEvents(sub.uiConversation);
              }
            });
          } catch (_) {}
        }
      }
      // Runtime flags synced from config/form/API.
      var hideSetting = true;
      var badgeSetting = true;
      // Ledger readiness. Until the first successful poll — and, when the host exposes
      // a conversation marker, until the CURRENT conversation appears in that poll —
      // ledger-backed chips must not be added or removed: an empty ledger looks exactly
      // like "this conversation has no reply summaries" and makes the marker flicker.
      var ledgerReady = false;
      var ledgerHasCurrentSession = false;
      var rafId = null;
      var applying = false;
      // toolName(lower) -> array of compression entries (oldest -> newest), for
      // collapsed rows whose oswyn-meta lives in the collapsed body.
      var histByTool = {};
      var histByCallId = {};
      var liveToolsByCall = {};
      var histOrder = {};
      // Session-level compression totals from the last status poll (for the
      // collapsed-group aggregate hint, since leaf rows are not in the DOM when
      // a process group is collapsed).
      var lastTotals = null;

      try {
        var c1 = localStorage.getItem('dsh-oswyn:hideReplySummaryInUi');
        if (c1 !== null) hideSetting = c1 === 'true';
        var c2 = localStorage.getItem('dsh-oswyn:badgeEnabled');
        if (c2 !== null) badgeSetting = c2 === 'true';
        var c3 = localStorage.getItem('dsh-oswyn:foldReplySummary');
        if (typeof window !== 'undefined') window.__oswynFoldReplySummary = (c3 === null ? true : c3 !== 'false');
      } catch (_) {}

      function schedule() {
        if (typeof window === 'undefined') return;
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(function () { rafId = null; sync(); });
      }

      // Aggregate hint on EACH process-group header: sum of THAT group's own
      // compressed child tool rows (before-after). Never a session-wide number.
      function decorateGroupHeaders() {
        if (!badgeSetting) return;
        var groups = document.querySelectorAll('div[data-step-process]');
        for (var g = 0; g < groups.length; g++) {
          var grp = groups[g];
          var headerBtn = grp.querySelector('button');
          if (!headerBtn) continue;
          var existing = headerBtn.querySelector('.' + GROUP_HINT_CLASS);
          // Aggregate over EVERY tool call in this group. Compressed rows use
          // the original before/after from live session data (falling back to the
          // badge/marker); uncompressed rows contribute their current size to BOTH
          // sides, so the header compares theoretical total with post-compression
          // total instead of reporting only compressed rows.
          var leaves = grp.querySelectorAll('div[data-tool]');
          var groupBefore = 0, groupAfter = 0, count = 0, calls = 0;
          var sawLeaf = false;
          for (var li = 0; li < leaves.length; li++) {
            var lr = leaves[li];
            if (!lr.hasAttribute || !lr.hasAttribute('data-state')) continue;
            sawLeaf = true;
            var hasNested = Boolean(lr.querySelector && lr.querySelector('div[data-tool]'));
            var outerContainer = lr.parentElement && lr.parentElement.closest ? lr.parentElement.closest('div[data-tool]') : null;
            var outerBadged = Boolean(outerContainer && (ownDisclosureRow(outerContainer) || outerContainer).querySelector('.' + BADGE_CLASS + '[data-dsh-oswyn-sig]'));
            var cid = callIdOfRow(lr);
            var live = (!outerBadged && cid) ? liveToolsByCall[String(cid)] : null;
            var sigEl = (ownDisclosureRow(lr) || lr).querySelector('.' + BADGE_CLASS + '[data-dsh-oswyn-sig]');
            var sig = sigEl && sigEl.getAttribute('data-dsh-oswyn-sig');
            var mb = null;
            if (sig) {
              var parts = sig.split(':');
              if (parts.length >= 2) mb = { before: Number(parts[0]), after: Number(parts[1]) };
            }
            if (!mb && !hasNested) mb = parseMetaToken(ownText(lr));
            // If this is a nested subcall inside a badged outer PTC container,
            // the outer container's before→after ALREADY accounts for its subcalls'
            // output characters. Count the subcall in `calls` but NEVER add its
            // expanded DOM text length to groupBefore/groupAfter (otherwise expanding
            // or collapsing a subcall causes the group header stats to flicker and
            // double-count).
            if (outerBadged) {
              calls += 1;
              if (mb && Number.isFinite(mb.before) && Number.isFinite(mb.after) && mb.after < mb.before) {
                count += 1;
              }
              continue;
            }
            var before = null, after = null;
            if (mb && Number.isFinite(mb.before) && Number.isFinite(mb.after)) {
              before = (live && Number.isFinite(Number(live.before))) ? Math.max(mb.before, Number(live.before)) : mb.before;
              after = (live && Number.isFinite(Number(live.after)) && Number(live.after) < before && mb.after >= before) ? Number(live.after) : mb.after;
            } else if (live && Number.isFinite(Number(live.before)) && Number.isFinite(Number(live.after))) {
              before = Number(live.before);
              after = Number(live.after);
            } else if (typeof lr.__oswynUncompressedLen === 'number') {
              before = lr.__oswynUncompressedLen;
              after = lr.__oswynUncompressedLen;
            } else {
              var ownLen = String(ownText(lr) || '').length;
              lr.__oswynUncompressedLen = ownLen;
              before = ownLen;
              after = ownLen;
            }
            calls += 1;
            groupBefore += Math.max(0, before);
            groupAfter += Math.max(0, after);
            if (after < before) count += 1;
          }
          // A collapsed group has no mounted tool rows. Do NOT guess from a
          // turn-wide map: one turn can span many groups, and a global map also
          // mixes sessions (the old fallback produced absurd 315-call stats on a
          // conversation with no tool calls). Show the hint only for groups whose
          // real rows are mounted and measured.
          if (!sawLeaf || (count === 0 && groupBefore === groupAfter)) { if (existing) existing.remove(); continue; }
          var saved = groupBefore - groupAfter;
          var pct = groupBefore > 0 ? Math.floor((saved / groupBefore) * 100) : 0;
          var savedTok = Math.round(saved / 3.5);
          // Calls + how many of them were compressed + the real before→after
          // character totals, so the header answers "how much of this group did
          // OSWYN actually touch" instead of showing a bare ratio.
          var text = '· 本组 ' + calls + ' 次调用 · 压缩 ' + count + ' 次 · '
            + formatNumber(groupBefore) + '→' + formatNumber(groupAfter) + ' 字符 -' + pct + '%'
            + '（省 ' + formatNumber(saved) + ' 字符 ≈ ' + formatNumber(savedTok) + ' tok）';
          if (existing) { if (existing.getAttribute('data-dsh-oswyn-gsig') === text) continue; existing.remove(); }
          var hint = document.createElement('span');
          hint.className = GROUP_HINT_CLASS;
          hint.setAttribute('data-dsh-oswyn-group-hint', 'true');
          hint.setAttribute('data-dsh-oswyn-gsig', text);
          hint.textContent = text;
          try { headerBtn.appendChild(hint); } catch (_) {}
        }
      }

      function sync() {
        if (typeof document === 'undefined') return;
        if (applying) return;
        applying = true;
        try {
          if (hideSetting) { ensureStyles(); hideReplySummaryBlocks(); }

          // Clean legacy junk stripped in older builds (defensive).
          var stale = document.querySelectorAll('.dsh-oswyn-tool-strip, .dsh-oswyn-reply-badge-card, .dsh-oswyn-tool-compact-view');
          for (var s = 0; s < stale.length; s++) { if (stale[s].remove) stale[s].remove(); }

          // Close any floating detail panel that no longer has a live owning badge
          // (e.g. the user switched conversation while it was open).
          try {
            var floats = document.querySelectorAll('body > .' + PANEL_CLASS);
            for (var fi = 0; fi < floats.length; fi++) {
              var owner = floats[fi].getAttribute && floats[fi].getAttribute('data-dsh-oswyn-owner');
              var stillThere = owner && document.querySelector('[' + 'data-dsh-oswyn-owner="' + owner + '"]');
              if (!stillThere) { floats[fi].remove(); }
            }
          } catch (_) {}

          var rows = collectToolRows();
          histOrder = {};
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var ownHeader = ownDisclosureRow(row);
            var existing = (ownHeader || row).querySelector('.' + BADGE_CLASS);

            if (!badgeSetting) { if (existing) existing.remove(); continue; }

            // Numbers from this row's own marker (authoritative). When the body is not
            // in the DOM (row collapsed) or the rewrite replaced the node with a checkpoint,
            // fall back to the ledger or compressed liveTools entry through the row's own
            // data-chat-call-id, which is unique across sessions.
            var meta = null;
            var rowText = row.textContent || '';
            if (rowText.indexOf('[oswyn-meta:') >= 0) meta = parseMetaToken(ownText(row));
            var callId = callIdOfRow(row);
            var ledgerEntry = (callId && histByCallId[callId]) ? histByCallId[callId] : null;
            var liveEntry = (callId && liveToolsByCall[callId]) ? liveToolsByCall[callId] : null;
            // Guard against false-positive inline markers inside code/JSON strings when
            // liveTools knows this callId was never compressed and has no ledger entry.
            if (meta && !ledgerEntry && liveEntry && liveEntry.compressed === false && liveEntry.before === liveEntry.after) {
              meta = null;
            }
            if (!meta && ledgerEntry && typeof ledgerEntry.before === 'number' && typeof ledgerEntry.after === 'number'
                && (ledgerEntry.after < ledgerEntry.before || ledgerEntry.mode === 'discard')) {
              meta = {
                before: ledgerEntry.before,
                inputChars: ledgerEntry.inputChars || 0,
                after: ledgerEntry.after,
                keep: ledgerEntry.keepLines || ledgerEntry.keepChars || 0,
                keepLines: ledgerEntry.keepLines || 0,
                keepChars: ledgerEntry.keepChars || 0,
                mode: ledgerEntry.mode || 'truncate',
                toolName: ledgerEntry.toolName || '',
                trigger: ledgerEntry.trigger || 'agent',
                seq: ledgerEntry.seq != null ? String(ledgerEntry.seq) : null,
                summary: ledgerEntry.summary || ledgerEntry.fact || '',
                pruneCall: Boolean(ledgerEntry.pruneCall)
              };
            }
            if (!meta && liveEntry && liveEntry.compressed && typeof liveEntry.before === 'number' && typeof liveEntry.after === 'number' && liveEntry.after < liveEntry.before) {
              meta = {
                before: liveEntry.before,
                inputChars: liveEntry.inputChars || 0,
                after: liveEntry.after,
                keep: 0,
                keepLines: 0,
                keepChars: 0,
                mode: 'truncate',
                toolName: liveEntry.toolName || '',
                trigger: 'agent',
                seq: liveEntry.seq != null ? String(liveEntry.seq) : null,
                summary: '',
                pruneCall: false
              };
            }
            if (!meta && row.__oswynCachedMeta) meta = row.__oswynCachedMeta;
            if (!meta) { if (existing) existing.remove(); continue; }
            if (!meta.toolName) meta.toolName = row.getAttribute('data-tool') || '';
            try {
              var cachedLabel = row.getAttribute('data-dsh-oswyn-label');
              if (!cachedLabel) {
                var ownHdr = ownDisclosureRow(row);
                cachedLabel = ownHdr ? String(ownHdr.textContent || '').trim().slice(0, 160) : '';
                if (cachedLabel) row.setAttribute('data-dsh-oswyn-label', cachedLabel);
              }
              if (cachedLabel) meta.callLabel = cachedLabel;
            } catch (_) {}
            // Enrich expanded-row meta with ledger keepLines / summary / pruneCall / trigger / inputChars when available.
            if (ledgerEntry) {
              if (ledgerEntry.trigger && !meta.trigger) meta.trigger = ledgerEntry.trigger;
              if (ledgerEntry.inputChars && !meta.inputChars) meta.inputChars = ledgerEntry.inputChars;
              if (ledgerEntry.keepLines && !meta.keepLines) {
                meta.keepLines = ledgerEntry.keepLines;
                if (meta.keep && meta.keep !== ledgerEntry.keepLines) meta.keepChars = meta.keep;
              }
              if (ledgerEntry.keepChars && !meta.keepChars) meta.keepChars = ledgerEntry.keepChars;
              if (!meta.summary && (ledgerEntry.summary || ledgerEntry.fact)) {
                meta.summary = ledgerEntry.summary || ledgerEntry.fact;
              }
              if (ledgerEntry.pruneCall) meta.pruneCall = true;
              // If the tool result was compressed multiple times or enriched with discarded call inputChars, keep the full before size.
              if (typeof ledgerEntry.before === 'number' && ledgerEntry.before > meta.before && ledgerEntry.mode !== 'prune-call') {
                meta.before = ledgerEntry.before;
              }
              if (meta.mode === 'discard' && typeof ledgerEntry.after === 'number' && ledgerEntry.after > 0 && ledgerEntry.after < meta.after) {
                meta.after = ledgerEntry.after;
              }
            }
            if (liveEntry) {
              if (liveEntry.inputChars && !meta.inputChars) meta.inputChars = liveEntry.inputChars;
              if (typeof liveEntry.before === 'number' && liveEntry.before > meta.before) meta.before = liveEntry.before;
              if (meta.mode === 'discard' && typeof liveEntry.after === 'number' && liveEntry.after > 0 && liveEntry.after < meta.after) {
                meta.after = liveEntry.after;
              }
            }
            // Cache the resolved meta on the row DOM node so collapsing/expanding
            // subcalls never loses or flickers the row's compression badge.
            try {
              var prevCached = row.__oswynCachedMeta;
              if (prevCached && prevCached.before > meta.before) meta.before = prevCached.before;
              if (prevCached && prevCached.trigger && !meta.trigger) meta.trigger = prevCached.trigger;
              if (prevCached && prevCached.summary && !meta.summary) meta.summary = prevCached.summary;
              if (prevCached && prevCached.keepLines && !meta.keepLines) meta.keepLines = prevCached.keepLines;
              row.__oswynCachedMeta = meta;
            } catch (_) {}

            var sig = meta.before + ':' + meta.after + ':' + (meta.keepLines || meta.keep || 0) + ':' + meta.mode + ':' + (meta.seq || '') + ':' + (meta.pruneCall ? '1' : '0') + ':' + (meta.trigger || '') + ':' + (meta.inputChars || 0);
            if (existing) {
              if (existing.getAttribute('data-dsh-oswyn-sig') === sig) continue;
              existing.remove();
            }
            var badge = buildBadge(meta);
            badge.setAttribute('data-dsh-oswyn-sig', sig);
            placeBadge(row, badge);
            row.setAttribute('data-dsh-oswyn-done', 'true');
          }

          // Decorate group headers AFTER leaf row badges are synced so the very
          // first render pass sees every leaf badge's resolved before→after.
          decorateGroupHeaders();
          renderTurnTailFallback();
          renderContextChip({ skipTurnTail: true });

        } finally {
          applying = false;
        }
      }

      // ── OSWYN 压缩占比徽标（对话框下方上下文指示旁） ─────────────────────
      var ctxChip = null;
      var ctxStats = null;
      var ctxChipEnabled = true;
      var ctxAllSessions = [];
      var ctxCurrent = null;
      var ctxPop = null;
      var ctxDetailEnabled = true;
      var ctxPerTurnEnabled = true;
      var ctxDeepTurnBadgeEnabled = true;
      // Hashed CSS-module names of the host stats dialog — using them means our
      // popover and per-turn rows are styled by the host stylesheet itself.
      var OSWYN_UI = {
        panel: 'mR10tW_panel', title: 'mR10tW_title', titleLabel: 'mR10tW_titleLabel',
        titleRule: 'mR10tW_titleRule', titleValue: 'mR10tW_titleValue', details: 'mR10tW_details'
      };
      try {
        var __d = localStorage.getItem('dsh-oswyn:contextRatioDetail'); if (__d !== null) ctxDetailEnabled = __d === 'true';
        var __t = localStorage.getItem('dsh-oswyn:perTurnStats'); if (__t !== null) ctxPerTurnEnabled = __t === 'true';
        var __dt = localStorage.getItem('dsh-oswyn:deepTurnBadge'); if (__dt !== null) ctxDeepTurnBadgeEnabled = __dt === 'true';
      } catch (_) {}
      try {
        var __ctxPref = localStorage.getItem('dsh-oswyn:contextRatioBadge');
        if (__ctxPref !== null) ctxChipEnabled = __ctxPref === 'true';
      } catch (_) {}

      /** The conversation currently on screen: explicit DOM attribute first, else newest activity. */
      function ctxCurrentSession() {
        try {
          var marker = document.querySelector('[data-conversation-session]');
          var wanted = marker ? (marker.getAttribute('data-conversation-session') || '') : '';
          if (wanted) {
            for (var i = 0; i < ctxAllSessions.length; i++) {
              if (ctxAllSessions[i] && String(ctxAllSessions[i].sessionId) === String(wanted)) return ctxAllSessions[i];
            }
          }
        } catch (_) {}
        var best = null;
        for (var j = 0; j < ctxAllSessions.length; j++) {
          var s = ctxAllSessions[j];
          if (!s) continue;
          if (!best || (Number(s.updatedAt) || 0) > (Number(best.updatedAt) || 0)) best = s;
        }
        return best;
      }

      // Reuse the host's own stat pill markup/classes — no custom CSS, no floating
      // layer of our own. The host exposes span[data-composer-stat] >
      // button[aria-haspopup="dialog"] > span.label, and a dl[data-session-stats-details]
      // dialog. We copy that shape and add our rows into the host dialog.
      function hostStatAnchor() {
        try {
          var stats = document.querySelectorAll('span[data-composer-stat]');
          var last = null;
          for (var i = 0; i < stats.length; i++) {
            var host = stats[i];
            if (host.getAttribute('data-composer-stat') === 'oswyn') continue;
            if (!host.parentNode) continue;
            var btn = host.querySelector('button[aria-haspopup="dialog"]') || host.querySelector('button');
            if (!btn) continue;
            last = { root: host, button: btn };
          }
          return last;
        } catch (_) {}
        return null;
      }

      function ctxClose() {
        if (ctxPop && ctxPop.parentNode) ctxPop.parentNode.removeChild(ctxPop);
        ctxPop = null;
        try {
          var openBtns = document.querySelectorAll('.dsh-oswyn-turn-pill[data-open="true"]');
          for (var i = 0; i < openBtns.length; i++) openBtns[i].removeAttribute('data-open');
        } catch (_) {}
      }

      function ctxDetailRow(dl, label, value) {
        var dt = document.createElement('dt');
        dt.textContent = label;
        var dd = document.createElement('dd');
        dd.textContent = value;
        dl.appendChild(dt);
        dl.appendChild(dd);
      }

      /** Separate popover, styled entirely with the host's stat-dialog classes. */
      function ctxOpenDetail(pill) {
        ctxClose();
        if (!ctxDetailEnabled || !ctxStats || ctxStats.scope !== 'session') return;
        var panel = document.createElement('div');
        panel.className = OSWYN_UI.panel;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('data-oswyn-detail', '1');
        var title = document.createElement('div');
        title.className = OSWYN_UI.title;
        var lab = document.createElement('span');
        lab.className = OSWYN_UI.titleLabel;
        lab.textContent = '压缩统计';
        var val = document.createElement('span');
        val.className = OSWYN_UI.titleValue;
        val.textContent = ctxStats.ratio + '%';
        title.appendChild(lab);
        title.appendChild(val);
        panel.appendChild(title);
        var rule = document.createElement('div');
        rule.className = OSWYN_UI.titleRule;
        rule.setAttribute('aria-hidden', 'true');
        panel.appendChild(rule);
        var dl = document.createElement('dl');
        dl.className = OSWYN_UI.details;
        ctxDetailRow(dl, '工具调用', ctxStats.toolCalls > 0 ? (formatNumber(ctxStats.toolCalls) + ' 次') : '—');
        ctxDetailRow(dl, '步内压缩', ctxStats.events + ' 次（工具 ' + ctxStats.toolEvents + ' · 回复 ' + ctxStats.replies + '）');
        ctxDetailRow(dl, '压缩覆盖率', ctxStats.toolCalls > 0 ? (ctxStats.distillRate + '%（' + ctxStats.distilled + ' / ' + formatNumber(ctxStats.toolCalls) + '）') : '—');
        ctxDetailRow(dl, '主动 / 自动', '主动 ' + ctxStats.agent + ' 次 · 自动 ' + ctxStats.auto + ' 次');
        ctxDetailRow(dl, '单次节省', '~' + formatTokens(ctxStats.saved) + ' tok');
        var cumText = '—';
        if (ctxStats.cum > 0) {
          cumText = '~' + formatTokens(ctxStats.cum) + ' tok';
          if (ctxStats.totalRequests > 0) {
            cumText += '（' + formatNumber(ctxStats.totalRequests) + ' 步往返）';
          }
        }
        ctxDetailRow(dl, '累计节省', cumText);
        ctxDetailRow(dl, '净节省', '~' + formatTokens(ctxStats.net) + ' tok（已扣摘要与召回）');
        if (ctxStats.compressedTokens > 0 || ctxStats.uncompressedTokens > 0) {
          var sysHint = ctxStats.systemTokens > 0 ? ('（含系统提示词 ~' + formatTokens(ctxStats.systemTokens) + ' tok）') : '';
          ctxDetailRow(dl, '已压缩量', '~' + formatTokens(ctxStats.compressedTokens) + ' tok' + sysHint);
          ctxDetailRow(dl, '未压缩量', '~' + formatTokens(ctxStats.uncompressedTokens) + ' tok');
        }
        if (ctxStats.deepEvents > 0) {
          var deepReasonText = '';
          var dR = ctxStats.deepReasons || {};
          var reasonParts = [];
          if (Number(dR.manual) > 0) reasonParts.push('手动 ' + dR.manual);
          if (Number(dR.volume) > 0) reasonParts.push('体积 ' + dR.volume);
          if (Number(dR.rounds) > 0) reasonParts.push('轮次 ' + dR.rounds);
          if (Number(dR.ttl) > 0) reasonParts.push('超时 ' + dR.ttl);
          if (Number(dR.ceiling) > 0) reasonParts.push('上限 ' + dR.ceiling);
          if (reasonParts.length) deepReasonText = '（' + reasonParts.join(' · ') + '）';
          var lastTurnHint = ctxStats.deepLastTurn > 0 ? (' · 最近第 ' + ctxStats.deepLastTurn + ' 轮') : '';
          ctxDetailRow(dl, '轮次蒸馏', ctxStats.deepEvents + ' 次' + deepReasonText + lastTurnHint);
          ctxDetailRow(dl, '轮次单次节省', '~' + formatTokens(ctxStats.deepSaved) + ' tok'
            + (ctxStats.deepRate > 0 ? '（整轮 −' + ctxStats.deepRate + '%）' : ''));
          if (ctxStats.deepCumulative > 0) {
            ctxDetailRow(dl, '轮次累计节省', '~' + formatTokens(ctxStats.deepCumulative) + ' tok');
          }
        }
        panel.appendChild(dl);
        document.body.appendChild(panel);
        positionPopover(panel, pill);
        ctxPop = panel;
      }

      function positionPopover(panel, anchorEl) {
        var rect = anchorEl.getBoundingClientRect();
        var vw = window.innerWidth || 1024;
        var vh = window.innerHeight || 768;
        var w = panel.offsetWidth || 260;
        var h = panel.offsetHeight || 200;
        panel.style.position = 'fixed';
        panel.style.zIndex = '99999';
        var left = Math.max(8, Math.min(rect.left, vw - w - 8));
        var top = (rect.top >= h + 16) ? (rect.top - h - 8) : Math.min(vh - h - 8, rect.bottom + 8);
        panel.style.left = left + 'px';
        panel.style.top = Math.max(8, top) + 'px';
      }

      function deepReasonLabel(reason) {
        if (reason === 'manual') return '手动触发';
        if (reason === 'ttl') return '缓存过期';
        if (reason === 'volume') return '体积阈值';
        if (reason === 'rounds') return '轮次阈值';
        if (reason === 'ceiling') return '上限安全阀';
        return reason ? String(reason) : '已触发';
      }

      function ctxOpenTurnDetail(anchorEl, turn, m) {
        ctxClose();
        if (!ctxDetailEnabled || !m) return;
        var totalEvents = (m.events || 0) + (m.replies || 0);
        var pct = m.before > 0 ? Math.round(((m.before - m.after) / m.before) * 1000) / 10 : 0;
        var deepPct = (m.deepRawTokens > 0 && m.deepSaved > 0) ? Math.round((m.deepSaved / m.deepRawTokens) * 1000) / 10 : 0;
        var panel = document.createElement('div');
        panel.className = OSWYN_UI.panel;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('data-oswyn-detail', '1');
        var title = document.createElement('div');
        title.className = OSWYN_UI.title;
        var lab = document.createElement('span');
        lab.className = OSWYN_UI.titleLabel;
        lab.textContent = '第 ' + turn + ' 轮压缩';
        var val = document.createElement('span');
        val.className = OSWYN_UI.titleValue;
        val.textContent = pct > 0 ? ('−' + pct + '%') : (m.deepDistilled && deepPct > 0 ? ('−' + deepPct + '%') : (totalEvents + ' 次'));
        title.appendChild(lab);
        title.appendChild(val);
        panel.appendChild(title);
        var rule = document.createElement('div');
        rule.className = OSWYN_UI.titleRule;
        rule.setAttribute('aria-hidden', 'true');
        panel.appendChild(rule);
        var dl = document.createElement('dl');
        dl.className = OSWYN_UI.details;
        if (m.deepDistilled) {
          ctxDetailRow(dl, '轮次蒸馏', '已整轮压缩（' + deepReasonLabel(m.deepReason) + '）');
          if (m.deepSaved > 0) {
            ctxDetailRow(dl, '轮次节省', '~' + formatTokens(m.deepSaved) + ' tok' + (m.deepRawTokens > 0 ? ('（' + formatTokens(m.deepRawTokens) + '→' + formatTokens(m.deepDistTokens || 0) + ' tok）') : ''));
          }
        }
        ctxDetailRow(dl, '步内压缩', totalEvents + ' 次（工具 ' + (m.events || 0) + ' · 回复 ' + (m.replies || 0) + '）');
        ctxDetailRow(dl, '主动 / 自动', '主动 ' + (m.agent || 0) + ' 次 · 自动 ' + (m.auto || 0) + ' 次');
        ctxDetailRow(dl, '字符变化', m.before > 0 ? (formatNumber(m.before) + '→' + formatNumber(m.after)) : '—');
        ctxDetailRow(dl, '单次节省', '~' + formatTokens((m.saved || 0) + (m.replySaved || 0)) + ' tok');
        ctxDetailRow(dl, '净节省', '~' + formatTokens(m.net || 0) + ' tok（已扣成本）');
        panel.appendChild(dl);
        document.body.appendChild(panel);
        positionPopover(panel, anchorEl);
        try { if (anchorEl && anchorEl.setAttribute) anchorEl.setAttribute('data-open', 'true'); } catch (_) {}
        ctxPop = panel;
      }

      /** Per-turn rows from THIS session, keyed by the turn stamped on each entry. */
      function ctxTurnStats(target) {
        var out = {};
        var sess = target || ctxCurrent;
        if (!sess) return out;
        var hist = sess.history || sess.entries || [];
        var hasStampedTurn = false;
        for (var ti = 0; ti < hist.length; ti++) {
          var tv = Number(hist[ti] && hist[ti].turn);
          if (Number.isFinite(tv) && tv > 0) { hasStampedTurn = true; break; }
        }
        for (var i = 0; i < hist.length; i++) {
          var e = hist[i];
          if (!e) continue;
          var turn = Number(e.turn);
          if (!Number.isFinite(turn) || turn <= 0) {
            if (!hasStampedTurn) turn = 1;
            else continue;
          }
          var m = out[turn] || (out[turn] = { events: 0, agent: 0, auto: 0, saved: 0, replies: 0, replySaved: 0, replyBefore: 0, replyAfter: 0, replySummaries: [], net: 0, before: 0, after: 0, deepDistilled: false, deepReason: '', deepSaved: 0, deepRawTokens: 0, deepDistTokens: 0, deepAt: 0 });
          var cb = Number(e.before);
          var ca = Number(e.after);
          if (Number.isFinite(cb) && Number.isFinite(ca) && cb > ca) { m.before += cb; m.after += ca; }
          if (e.mode === 'reply') {
            m.replies += 1;
            if (Number.isFinite(cb) && Number.isFinite(ca) && cb > ca) { m.replyBefore += cb; m.replyAfter += ca; }
            var rSum = String(e.summary || e.fact || '').trim();
            if (rSum) m.replySummaries.push(rSum);
            var rn = (typeof readEventNumbers === 'function') ? readEventNumbers(e) : null;
            if (rn) {
              m.replySaved += rn.savedIn || 0;
              m.net += rn.net || 0;
            }
            continue;
          }
          if (e.mode === 'truncate' || e.mode === 'replace' || e.mode === 'discard' || e.mode === 'prune-call') {
            m.events += 1;
            if (e.trigger === 'auto' || e.trigger === 'autonomous') m.auto += 1;
            else m.agent += 1;
            var n = (typeof readEventNumbers === 'function') ? readEventNumbers(e) : null;
            if (n) {
              m.saved += n.savedIn || 0;
              m.net += n.net || 0;
            }
          }
        }
        var deepTurns = sess.distill && sess.distill.turns && typeof sess.distill.turns === 'object' ? sess.distill.turns : null;
        if (deepTurns) {
          for (var dk in deepTurns) {
            if (!Object.prototype.hasOwnProperty.call(deepTurns, dk)) continue;
            var dTurn = Number(dk);
            var td = deepTurns[dk];
            if (!Number.isFinite(dTurn) || dTurn <= 0 || !td || typeof td !== 'object') continue;
            var dm = out[dTurn] || (out[dTurn] = { events: 0, agent: 0, auto: 0, saved: 0, replies: 0, replySaved: 0, replyBefore: 0, replyAfter: 0, replySummaries: [], net: 0, before: 0, after: 0, deepDistilled: false, deepReason: '', deepSaved: 0, deepRawTokens: 0, deepDistTokens: 0, deepAt: 0 });
            dm.deepDistilled = true;
            dm.deepReason = String(td.reason || '');
            dm.deepSaved = Number(td.surplusTokens) || 0;
            dm.deepRawTokens = Number(td.rawTokens) || 0;
            dm.deepDistTokens = Number(td.distTokens) || 0;
            dm.deepAt = Number(td.at) || 0;
          }
        }
        return out;
      }

      /**
       * Copy the footer's own typography onto our pill.
       *
       * The footer strip already contains the host's "用量 5.4M tok" text; that is the
       * ground truth for size/weight/colour. Copying computed values (rather than
       * trusting inherited CSS) keeps the pill visually identical even when the host
       * wraps its stats in a differently-styled container.
       */
      function matchFooterTypography(target, styleRef) {
        if (!target || !target.style) return;
        var ref = styleRef;
        // A caller may hand us a wrapper (composer button, branch button) instead of the
        // footer text itself. Only the "用量 … tok" node is a valid typography source.
        try {
          var txt = ref && ref.textContent ? String(ref.textContent).trim() : '';
          if (!/^用量\s+[\d.,]+\s*[KMB]?\s*tok$/i.test(txt)) {
            ref = findUsageSibling(target) || findUsageSibling(ref) || null;
          }
        } catch (_) { ref = styleRef; }
        var cs = null;
        try {
          if (ref && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            cs = window.getComputedStyle(ref);
          }
        } catch (_) { cs = null; }
        if (!cs) return;
        try {
          if (cs.fontSize) target.style.fontSize = cs.fontSize;
          if (cs.fontFamily) target.style.fontFamily = cs.fontFamily;
          if (cs.fontWeight) target.style.fontWeight = cs.fontWeight;
          if (cs.lineHeight && cs.lineHeight !== 'normal') target.style.lineHeight = cs.lineHeight;
          if (cs.letterSpacing && cs.letterSpacing !== 'normal') target.style.letterSpacing = cs.letterSpacing;
          if (cs.color) target.style.color = cs.color;
        } catch (_) {}
      }

      /** Nearest "用量 … tok" node in the same footer row as `node`. */
      function findUsageSibling(node) {
        try {
          var scope = node && node.parentElement;
          for (var up = 0; scope && up < 3; up += 1) {
            var hit = findUsageInContainer(scope);
            if (hit) return hit;
            scope = scope.parentElement;
          }
        } catch (_) {}
        return null;
      }

      function buildTurnStatsChip(m, sig, turn, styleRef) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'dsh-oswyn-turn-pill';
        chip.setAttribute('data-oswyn-turn-tail', sig);
        chip.setAttribute('data-oswyn-deep-turn', m.deepDistilled ? 'true' : 'false');
        chip.setAttribute('aria-haspopup', 'dialog');
        var totalEvents = (m.events || 0) + (m.replies || 0);
        var pct = m.before > 0 ? Math.round(((m.before - m.after) / m.before) * 100) : 0;
        var deepPct = (m.deepRawTokens > 0 && m.deepSaved > 0) ? Math.round((m.deepSaved / m.deepRawTokens) * 100) : 0;
        if (totalEvents > 0) {
          chip.textContent = (m.before > 0 && pct > 0) ? ('−' + pct + '%') : (totalEvents + ' 次');
        } else if (deepPct > 0) {
          chip.textContent = '−' + deepPct + '%';
        } else {
          return null;
        }
        chip.title = m.deepDistilled
          ? ('第 ' + turn + ' 轮已完成 2.4 轮次蒸馏' + (m.deepSaved > 0 ? ('（省 ~' + formatTokens(m.deepSaved) + ' tok）') : '') + ' · 点击查看详情')
          : ('本轮压缩 −' + pct + '%（含回复双轨）· 点击查看详情');
        matchFooterTypography(chip, styleRef);
        chip.addEventListener('click', function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var wasOpen = chip.getAttribute('data-open') === 'true';
          if (wasOpen) { ctxClose(); return; }
          ctxOpenTurnDetail(chip, turn, m);
        });
        return chip;
      }

      function isUserFlowNode(node) {
        try {
          return Boolean(node && node.closest && node.closest('[data-chat-flow-kind="user"]'));
        } catch (_) { return false; }
      }

      function isInSidebarOrNav(node) {
        try {
          if (!node || !node.closest) return false;
          if (node.closest('[data-chat-turn]')) return false;
          return Boolean(node.closest(
            'nav, aside, [role="navigation"], [role="complementary"], [role="listbox"], ' +
            '[data-sidebar], [data-session-list], [data-conversation-list], ' +
            '[class*="sidebar" i], [class*="sideBar" i], [class*="sessionList" i], ' +
            '[class*="conversationList" i], [class*="chatList" i], [class*="historyList" i], ' +
            'a[href*="/chat"], a[href*="/session"], a[href*="/conversation"], ' +
            'li, [role="listitem"], [role="option"], [role="treeitem"]'
          ));
        } catch (_) { return false; }
      }

      function findBranchButton(container) {
        if (!container) return null;
        var sel =
          'button[aria-label*="分支"], button[title*="分支"], ' +
          'button[aria-label*="branch" i], button[title*="branch" i], ' +
          'button[aria-label*="fork" i], button[title*="fork" i], ' +
          '[data-action="branch"], [data-action="fork"]';
        if (container.querySelectorAll) {
          var all = container.querySelectorAll(sel);
          var lastOutsideProcess = null;
          var lastAny = null;
          for (var i = 0; i < all.length; i++) {
            var b = all[i];
            if (isUserFlowNode(b)) continue;
            lastAny = b;
            var inStepProcess = Boolean(b.closest && b.closest('[data-step-process]'));
            if (!inStepProcess) lastOutsideProcess = b;
          }
          return lastOutsideProcess || lastAny;
        }
        if (!container.querySelector) return null;
        var single = container.querySelector(sel);
        return (single && !isUserFlowNode(single)) ? single : null;
      }

      function findUsageInContainer(container) {
        if (!container || !container.querySelectorAll) return null;
        var candidates = container.querySelectorAll('span, div, button');
        for (var i = 0; i < candidates.length; i++) {
          var elNode = candidates[i];
          if (!elNode || !elNode.textContent) continue;
          if (elNode.children && elNode.children.length > 2) continue;
          if (/^用量\s+[\d.,]+\s*[KMB]?\s*tok$/i.test(elNode.textContent.trim())) return elNode;
        }
        return null;
      }

      function findUsageAnchors() {
        var out = [];
        var seenRows = [];
        try {
          var candidates = document.querySelectorAll('span, div, button');
          for (var i = 0; i < candidates.length; i++) {
            var elNode = candidates[i];
            if (!elNode || !elNode.textContent || isInSidebarOrNav(elNode)) continue;
            if (elNode.children && elNode.children.length > 2) continue;
            var txt = elNode.textContent.trim();
            if (!/^用量\s+[\d.,]+\s*[KMB]?\s*tok$/i.test(txt)) continue;
            var row = elNode.parentElement;
            while (row && row !== document.body) {
              var btns = row.querySelectorAll ? row.querySelectorAll('button') : [];
              if (btns.length >= 2) {
                if (seenRows.indexOf(row) >= 0) break;
                seenRows.push(row);
                var usageChild = elNode;
                while (usageChild.parentElement && usageChild.parentElement !== row) {
                  usageChild = usageChild.parentElement;
                }
                var branchBtn = null;
                for (var bi = 0; bi < btns.length; bi++) {
                  if (usageChild.contains && usageChild.contains(btns[bi])) continue;
                  if (btns[bi].hasAttribute && btns[bi].hasAttribute('data-oswyn-turn-tail')) continue;
                  branchBtn = btns[bi];
                }
                out.push({ row: row, branchBtn: branchBtn, beforeNode: usageChild });
                break;
              }
              row = row.parentElement;
            }
          }
        } catch (_) {}
        return out;
      }

      var BRANCH_BTN_SELECTOR =
        'button[aria-label*="分支"], button[title*="分支"], ' +
        'button[aria-label*="branch" i], button[title*="branch" i], ' +
        'button[aria-label*="fork" i], button[title*="fork" i], ' +
        '[data-action="branch"], [data-action="fork"]';

      // Walk up from an action bar to the full enclosing assistant turn container
      // (which contains both the markdown body and the footer action bar), stopping
      // before any ancestor that spans multiple assistant turns.
      function resolveTurnContainer(actionsRow, explicitScope) {
        if (explicitScope && explicitScope.hasAttribute &&
            (explicitScope.hasAttribute('data-chat-turn') || explicitScope.hasAttribute('data-turn') || explicitScope.hasAttribute('data-turn-index'))) {
          return explicitScope;
        }
        var direct = actionsRow && actionsRow.closest && actionsRow.closest('[data-chat-turn], [data-turn], [data-turn-index], [data-message-id], [data-chat-message], article');
        if (direct) return direct;
        var cur = explicitScope || (actionsRow && actionsRow.parentNode) || null;
        var best = cur;
        for (var depth = 0; cur && cur.parentElement && depth < 6; depth++) {
          var parent = cur.parentElement;
          if (parent === document.body || parent === document.documentElement) break;
          var branches = parent.querySelectorAll ? parent.querySelectorAll(BRANCH_BTN_SELECTOR) : [];
          if (branches.length > 1) break;
          best = parent;
          cur = parent;
        }
        return best;
      }

      function hasSlotTurnPill(scopeEl) {
        if (!scopeEl || !scopeEl.querySelector) return false;
        return Boolean(scopeEl.querySelector('[data-oswyn-turn-tail^="slot:"]'));
      }

      function removeTurnPillsForTurn(turn) {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        var pills = document.querySelectorAll('[data-oswyn-turn-tail]');
        for (var i = 0; i < pills.length; i++) {
          var v = pills[i].getAttribute('data-oswyn-turn-tail') || '';
          if (v.indexOf('slot:') === 0) continue;
          if (!belongsToTurn(pills[i], turn)) continue;
          if (pills[i].parentNode) pills[i].parentNode.removeChild(pills[i]);
        }
      }

      function removeNonSlotTurnPills(scopeEl) {
        if (!scopeEl || !scopeEl.querySelectorAll) return;
        var pills = scopeEl.querySelectorAll('[data-oswyn-turn-tail]');
        for (var i = 0; i < pills.length; i++) {
          var val = pills[i].getAttribute('data-oswyn-turn-tail') || '';
          if (val.indexOf('slot:') === 0) continue;
          if (pills[i].parentNode) pills[i].parentNode.removeChild(pills[i]);
        }
      }

      // True when `el` lives inside the DOM subtree of the given chat turn.
      function belongsToTurn(el, turn) {
        try {
          var want = Number(turn);
          var cur = el;
          while (cur && cur !== document.body && cur !== document.documentElement) {
            var v = cur.getAttribute && cur.getAttribute('data-chat-turn');
            if (v !== null && v !== undefined && v !== '') {
              if (Number(v) === want) return true;
              // Another turn's node: this branch cannot belong to `want`.
              return false;
            }
            cur = cur.parentNode;
          }
        } catch (_) {}
        return false;
      }

      // Remove every fallback chip of this turn, wherever a per-node turn container
      // happened to place it (DSH stamps data-chat-turn on each flow node AND on the
      // step-process group, so one turn can otherwise end up with two chips).
      function removeFallbackWrapsEverywhere(turn) {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        var wraps = document.querySelectorAll('[data-oswyn-reply-fallback-wrap]');
        for (var i = 0; i < wraps.length; i++) {
          var owner = wraps[i].getAttribute && wraps[i].getAttribute('data-oswyn-reply-fallback-wrap');
          if (String(owner) !== String(turn)) continue;
          if (wraps[i].parentNode) wraps[i].parentNode.removeChild(wraps[i]);
        }
      }

      // Remove only the fallback chip that belongs to THIS turn. A blanket removal
      // wiped chips of other turns whenever one turn re-rendered, which is what made
      // the reply marker blink on long, older conversations.
      function removeFallbackWrapsForTurn(parentEl, turn) {
        if (!parentEl || !parentEl.querySelectorAll) return;
        var wraps = parentEl.querySelectorAll('[data-oswyn-reply-fallback-wrap]');
        for (var i = 0; i < wraps.length; i++) {
          var owner = wraps[i].getAttribute && wraps[i].getAttribute('data-oswyn-reply-fallback-wrap');
          if (String(owner) !== String(turn)) continue;
          if (wraps[i].parentNode) wraps[i].parentNode.removeChild(wraps[i]);
        }
      }

      function removeAllFallbackWraps(parentEl) {
        if (!parentEl || !parentEl.querySelectorAll) return;
        var wraps = parentEl.querySelectorAll('[data-oswyn-reply-fallback-wrap]');
        for (var i = 0; i < wraps.length; i++) {
          if (wraps[i].parentNode) wraps[i].parentNode.removeChild(wraps[i]);
        }
      }

      // True if a DOM-folded reply chip or folded reply block already exists for this turn,
      // checked both inside searchScope and by DOM document order between prevActionsRow and actionsRow.
      function hasDomFoldedReplyForTurn(searchScope, prevActionsRow, actionsRow, turn) {
        try {
          // The turn number is the only identity that is stable across the several
          // [data-chat-turn] nodes DSH renders for ONE turn (each flow node and the
          // step-process group all carry it). Scoping by element therefore missed the
          // fold chip and let a second, ledger-backed marker appear beside it.
          if (turn !== undefined && turn !== null && typeof document !== 'undefined' && document.querySelectorAll) {
            var allChips = document.querySelectorAll('.' + FOLD_CHIP_CLASS);
            for (var ci = 0; ci < allChips.length; ci++) {
              var cEl = allChips[ci];
              if (cEl.hasAttribute && cEl.hasAttribute('data-oswyn-reply-fallback')) continue;
              if (cEl.hasAttribute && cEl.hasAttribute('data-oswyn-turn-tail')) continue;
              if (belongsToTurn(cEl, turn)) return true;
            }
          }
          if (searchScope && searchScope.querySelectorAll) {
            var scoped = searchScope.querySelectorAll('.' + FOLD_CHIP_CLASS + ', [data-oswyn-folded="1"]');
            for (var i = 0; i < scoped.length; i++) {
              if (!scoped[i].hasAttribute('data-oswyn-reply-fallback')) return true;
            }
          }
          // No document-wide document-order scan: a folded block from an EARLIER turn
          // sits before this turn's action row too, so the old heuristic credited this
          // turn with another turn's chip and the two renderers fought every sync.
          // The turn container is the correct scope; when the host exposes none we
          // fall back to the action row's own parent (already searched above).
        } catch (_) {}
        return false;
      }

      // Ledger-backed reply-compression chip: when foldReplySummary is enabled and a turn
      // has a reply-summary entry in the session ledger, render the "已压缩" chip above the
      // turn action bar ONLY when no DOM-folded reply chip exists in this turn.
      function syncReplyFallbackChip(scopeEl, actionsRow, prevActionsRow, m, turn) {
        try {
          if (!actionsRow || !actionsRow.parentNode) return;
          var hostParent = actionsRow.parentNode;
          var searchScope = resolveTurnContainer(actionsRow, scopeEl) || hostParent;
          var foldEnabled = (typeof window === 'undefined' || window.__oswynFoldReplySummary !== false);
          // Until the ledger actually covers this conversation, an empty answer is
          // indistinguishable from "not loaded yet". Do not create AND do not delete:
          // deleting here is what made an existing chip vanish and reappear.
          var ledgerUsable = ledgerReady && ledgerHasCurrentSession;
          if (!foldEnabled) {
            removeAllFallbackWraps(hostParent);
            return;
          }
          if (!ledgerUsable) return;
          if (!m || !m.replies) {
            // Authoritative "this turn has no reply summary": clear this turn's chip
            // wherever a previous pass placed it.
            removeFallbackWrapsForTurn(hostParent, turn);
            removeFallbackWrapsEverywhere(turn);
            return;
          }
          if (hasDomFoldedReplyForTurn(searchScope, prevActionsRow, actionsRow, turn)) {
            removeFallbackWrapsForTurn(hostParent, turn);
            removeFallbackWrapsEverywhere(turn);
            return;
          }
          var rBefore = m.replyBefore || 0;
          var rAfter = m.replyAfter || 0;
          var pct = (rBefore > 0 && rAfter >= 0 && rAfter < rBefore) ? ratioPct(rBefore, rAfter) : 0;
          var label = '已压缩' + (rBefore > 0 && rAfter < rBefore
            ? (' ' + formatNumber(rBefore) + '→' + formatNumber(rAfter) + ' 字符' + (pct > 0 ? ' (-' + pct + '%)' : ''))
            : (' · 回复 ' + m.replies + ' 次'));
          var rSig = turn + ':' + m.replies + ':' + rBefore + ':' + rAfter;
          // Exactly one chip per turn, wherever earlier passes put it. DSH stamps
          // data-chat-turn on every flow node AND on the step-process group, so the
          // same turn is visited more than once per sync with different parents.
          var existingWraps = (typeof document !== 'undefined' && document.querySelectorAll)
            ? document.querySelectorAll('[data-oswyn-reply-fallback-wrap]')
            : [];
          var keptOne = false;
          for (var wi = 0; wi < existingWraps.length; wi++) {
            if (String(existingWraps[wi].getAttribute('data-oswyn-reply-fallback-wrap')) !== String(turn)) continue;
            if (!keptOne && existingWraps[wi].getAttribute('data-oswyn-reply-sig') === rSig
                && existingWraps[wi].parentNode === hostParent) {
              keptOne = true;
              continue;
            }
            if (existingWraps[wi].parentNode) existingWraps[wi].parentNode.removeChild(existingWraps[wi]);
          }
          if (keptOne) return;
          removeFallbackWrapsForTurn(hostParent, turn);
          var wrap = document.createElement('div');
          wrap.setAttribute('data-oswyn-reply-fallback-wrap', String(turn));
          wrap.setAttribute('data-oswyn-reply-sig', rSig);
          wrap.style.margin = '6px 0 4px 0';
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = FOLD_CHIP_CLASS;
          chip.setAttribute('data-dsh-oswyn-fold-chip', 'true');
          chip.setAttribute('data-oswyn-reply-fallback', '1');
          chip.setAttribute('aria-haspopup', 'dialog');
          chip.setAttribute('aria-expanded', 'false');
          chip.title = '回复精炼双轨压缩 · 点击查看详情';
          chip.textContent = label;
          var memoText = (m.replySummaries && m.replySummaries.length) ? m.replySummaries.join('\n\n') : '';
          var statsObj = (rBefore > 0 && rAfter < rBefore) ? { before: rBefore, after: rAfter } : null;
          chip.addEventListener('click', function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            openReplyMemoPopover(chip, statsObj, memoText);
          });
          wrap.appendChild(chip);
          hostParent.insertBefore(wrap, actionsRow);
        } catch (_) {}
      }

      function removeDeepTurnChipsEverywhere(turn) {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        var wraps = document.querySelectorAll('[data-oswyn-deep-turn-wrap]');
        for (var i = 0; i < wraps.length; i++) {
          var owner = wraps[i].getAttribute && wraps[i].getAttribute('data-oswyn-deep-turn-wrap');
          if (String(owner) !== String(turn)) continue;
          if (wraps[i].parentNode) wraps[i].parentNode.removeChild(wraps[i]);
        }
      }

      // Dedicated inline marker for v2.4 turn-level deep distillation above the turn's footer.
      function syncDeepTurnChip(actionsRow, m, turn) {
        try {
          if (!actionsRow || !actionsRow.parentNode) return;
          var hostParent = actionsRow.parentNode;
          if (!ctxDeepTurnBadgeEnabled) {
            removeDeepTurnChipsEverywhere(turn);
            return;
          }
          var ledgerUsable = ledgerReady && ledgerHasCurrentSession;
          if (!ledgerUsable) return;
          if (!m || !m.deepDistilled) {
            removeDeepTurnChipsEverywhere(turn);
            return;
          }
          var deepPct = (m.deepRawTokens > 0 && m.deepSaved > 0) ? Math.round((m.deepSaved / m.deepRawTokens) * 100) : 0;
          var label = '已轮次蒸馏' + (m.deepSaved > 0
            ? (' 省 ~' + formatTokens(m.deepSaved) + ' tok' + (deepPct > 0 ? ' (-' + deepPct + '%)' : ''))
            : '');
          var dSig = turn + ':' + (m.deepReason || '') + ':' + (m.deepSaved || 0) + ':' + (m.deepRawTokens || 0);
          var existingWraps = (typeof document !== 'undefined' && document.querySelectorAll)
            ? document.querySelectorAll('[data-oswyn-deep-turn-wrap]')
            : [];
          var keptOne = false;
          for (var wi = 0; wi < existingWraps.length; wi++) {
            if (String(existingWraps[wi].getAttribute('data-oswyn-deep-turn-wrap')) !== String(turn)) continue;
            if (!keptOne && existingWraps[wi].getAttribute('data-oswyn-deep-turn-sig') === dSig
                && existingWraps[wi].parentNode === hostParent) {
              keptOne = true;
              continue;
            }
            if (existingWraps[wi].parentNode) existingWraps[wi].parentNode.removeChild(existingWraps[wi]);
          }
          if (keptOne) return;
          var wrap = document.createElement('div');
          wrap.setAttribute('data-oswyn-deep-turn-wrap', String(turn));
          wrap.setAttribute('data-oswyn-deep-turn-sig', dSig);
          wrap.style.margin = '4px 0 4px 0';
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'dsh-oswyn-deep-turn-chip';
          chip.setAttribute('data-oswyn-deep-turn-chip', String(turn));
          chip.setAttribute('aria-haspopup', 'dialog');
          chip.title = '2.4 轮次深度蒸馏（' + deepReasonLabel(m.deepReason) + '）· 可通过 history_recall 召回 · 点击查看详情';
          chip.textContent = label;
          chip.addEventListener('click', function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            ctxOpenTurnDetail(chip, turn, m);
          });
          wrap.appendChild(chip);
          hostParent.insertBefore(wrap, actionsRow);
        } catch (_) {}
      }

      // Place per-turn stats next to the branch button in each assistant turn (never on user messages).
      function renderTurnTailFallback() {
        try {
          if (typeof document === 'undefined') return;
          ensureStyles();
          var allTurnStats = ctxTurnStats();
          var per = ctxPerTurnEnabled ? allTurnStats : {};
          var hostRef = hostStatAnchor();
          var fallbackStyleRef = (hostRef && hostRef.button) || null;
          var nodes = document.querySelectorAll('[data-chat-turn]');
          if (nodes && nodes.length > 0) {
            // DSH stamps data-chat-turn on EVERY flow node AND on the nested
            // step-process group, so one turn appears many times in this list. Group
            // by turn and process each turn EXACTLY once: the old per-node loop added a
            // pill and a later sibling node deleted it again in the same pass, which is
            // the marker that "shows for a moment and then disappears".
            var groups = [];
            var groupIndex = {};
            for (var ni = 0; ni < nodes.length; ni++) {
              var nNode = nodes[ni];
              if (isUserFlowNode(nNode)) continue;
              var rawTurn = nNode.getAttribute('data-chat-turn');
              if (rawTurn === null || rawTurn === '') continue;
              var nTurn = Number(rawTurn);
              if (!isFinite(nTurn)) continue;
              if (!groupIndex[nTurn]) { groupIndex[nTurn] = { turn: nTurn, nodes: [] }; groups.push(groupIndex[nTurn]); }
              groupIndex[nTurn].nodes.push(nNode);
            }
            var prevNodeActions = null;
            for (var gi = 0; gi < groups.length; gi++) {
              var grp = groups[gi];
              var turn = grp.turn;
              var m = per[turn];
              var hostNode = null;
              var branchBtn = null;
              var usageNode = null;
              var actions = null;
              // Prefer a non-step-process assistant node (the final answer container)
              // over a [data-step-process] group that sits before the answer.
              for (var pass = 0; pass < 2 && !hostNode; pass++) {
                for (var hi = grp.nodes.length - 1; hi >= 0; hi--) {
                  var cand = grp.nodes[hi];
                  var isStepProc = Boolean(cand.hasAttribute && cand.hasAttribute('data-step-process'));
                  if (pass === 0 && isStepProc) continue;
                  var cBranch = findBranchButton(cand);
                  var cUsage = findUsageInContainer(cand);
                  if (!cBranch && !cUsage) continue;
                  var cActions = (cBranch && cBranch.parentNode) || cand.querySelector('[class*="_actions"]') || cand.querySelector('[class*="endInfo"]');
                  if (!cActions) continue;
                  hostNode = cand; branchBtn = cBranch; usageNode = cUsage; actions = cActions;
                  break;
                }
              }
              if (!hostNode || !actions) {
                // No action row for this turn (typically a user message): clear any stale pill.
                removeTurnPillsForTurn(turn);
                continue;
              }
              syncReplyFallbackChip(hostNode, actions, prevNodeActions, allTurnStats[turn], turn);
              syncDeepTurnChip(actions, allTurnStats[turn], turn);
              prevNodeActions = actions;
              if (hasSlotTurnPill(hostNode)) {
                removeNonSlotTurnPills(hostNode);
                continue;
              }
              var existing = null;
              var allPills = document.querySelectorAll('[data-oswyn-turn-tail]');
              for (var pi = 0; pi < allPills.length; pi++) {
                var pv = allPills[pi].getAttribute('data-oswyn-turn-tail') || '';
                if (pv.indexOf('slot:') === 0) continue;
                if (!belongsToTurn(allPills[pi], turn)) continue;
                if (!existing) existing = allPills[pi];
                else if (allPills[pi].parentNode) allPills[pi].parentNode.removeChild(allPills[pi]);
              }
              if (!m || (!m.events && !m.replies && !m.deepDistilled)) {
                if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
                continue;
              }
              var sig = m.events + ':' + m.agent + ':' + m.auto + ':' + m.saved + ':' + m.replies + ':' + m.replySaved + ':' + m.before + ':' + m.after + ':' + (m.deepDistilled ? ('D' + (m.deepSaved || 0)) : '0');
              if (existing && existing.getAttribute('data-oswyn-turn-tail') === sig) continue;
              if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
              var styleRef = usageNode || fallbackStyleRef || branchBtn;
              var chip = buildTurnStatsChip(m, sig, turn, styleRef);
              if (!chip) continue;
              if (branchBtn && branchBtn.parentNode) {
                branchBtn.parentNode.insertBefore(chip, branchBtn.nextSibling);
              } else {
                actions.appendChild(chip);
              }
            }
            return;
          }

          var targets = [];
          var seenTargetRows = [];
          var directBtns = document.querySelectorAll(BRANCH_BTN_SELECTOR);
          if (directBtns && directBtns.length > 0) {
            for (var di = 0; di < directBtns.length; di++) {
              if (isUserFlowNode(directBtns[di]) || isInSidebarOrNav(directBtns[di])) continue;
              var dRow = directBtns[di].parentNode;
              if (!dRow || isInSidebarOrNav(dRow) || seenTargetRows.indexOf(dRow) >= 0) continue;
              seenTargetRows.push(dRow);
              targets.push({ row: dRow, branchBtn: directBtns[di], beforeNode: directBtns[di].nextSibling });
            }
          } else {
            targets = findUsageAnchors();
          }
          var allKeys = Object.keys(allTurnStats);
          var prevTgtRow = null;
          for (var ti = 0; ti < targets.length; ti++) {
            var tgt = targets[ti];
            if (!tgt || !tgt.row) continue;
            var turnAttrEl = tgt.row.closest && tgt.row.closest('[data-chat-turn], [data-turn], [data-turn-index]');
            var resolvedTurn = turnAttrEl
              ? Number(turnAttrEl.getAttribute('data-chat-turn') || turnAttrEl.getAttribute('data-turn') || turnAttrEl.getAttribute('data-turn-index'))
              : (targets.length === 1 && allKeys.length === 1 ? Number(allKeys[0]) : (ti + 1));
            var turnScope = resolveTurnContainer(tgt.row, turnAttrEl);
            syncReplyFallbackChip(turnScope, tgt.row, prevTgtRow, allTurnStats[resolvedTurn], resolvedTurn);
            syncDeepTurnChip(tgt.row, allTurnStats[resolvedTurn], resolvedTurn);
            prevTgtRow = tgt.row;
            if (hasSlotTurnPill(turnScope || tgt.row)) {
              removeNonSlotTurnPills(turnScope || tgt.row);
              continue;
            }
            var tm = per[resolvedTurn];
            var prevChip = tgt.row.querySelector('[data-oswyn-turn-tail]:not([data-oswyn-turn-tail^="slot:"])');
            if (!tm || (!tm.events && !tm.replies && !tm.deepDistilled)) {
              if (prevChip && prevChip.parentNode) prevChip.parentNode.removeChild(prevChip);
              continue;
            }
            var tSig = tm.events + ':' + tm.agent + ':' + tm.auto + ':' + tm.saved + ':' + tm.replies + ':' + tm.before + ':' + tm.after + ':' + (tm.deepDistilled ? ('D' + (tm.deepSaved || 0)) : '0');
            if (prevChip && prevChip.getAttribute('data-oswyn-turn-tail') === tSig) continue;
            if (prevChip && prevChip.parentNode) prevChip.parentNode.removeChild(prevChip);
            var rowUsage = findUsageInContainer(tgt.row);
            var tChip = buildTurnStatsChip(tm, tSig, resolvedTurn, rowUsage || fallbackStyleRef || tgt.branchBtn);
            if (!tChip) continue;
            if (tgt.branchBtn && tgt.branchBtn.parentNode === tgt.row) {
              tgt.row.insertBefore(tChip, tgt.branchBtn.nextSibling);
            } else if (tgt.beforeNode && tgt.beforeNode.parentNode === tgt.row) {
              tgt.row.insertBefore(tChip, tgt.beforeNode);
            } else {
              tgt.row.appendChild(tChip);
            }
          }
        } catch (_) {}
      }

      function renderContextChip(opts) {
        try {
          if (typeof document === 'undefined') return;
          if (hideSetting) { ensureStyles(); hideReplySummaryBlocks(); }
          if (!opts || !opts.skipTurnTail) renderTurnTailFallback();
          // No host stat bar (e.g. compact host mode) or no current session -> stay out.
          if (!ctxChipEnabled || !ctxStats || ctxStats.scope !== 'session') {
            if (ctxChip && ctxChip.parentNode) ctxChip.parentNode.removeChild(ctxChip);
            return;
          }
          var host = hostStatAnchor();
          if (!host) return;
          // Host re-renders can leave stale copies behind. Keep exactly one.
          try {
            var dup = document.querySelectorAll('span[data-composer-stat="oswyn"]');
            for (var dp = 0; dp < dup.length; dp++) {
              if (dup[dp] !== ctxChip && dup[dp].parentNode) dup[dp].parentNode.removeChild(dup[dp]);
            }
          } catch (_) {}
          var hostLabel = host.button.querySelector('span');
          if (!ctxChip) {
            ctxChip = document.createElement('span');
            ctxChip.setAttribute('data-composer-stat', 'oswyn');
            ctxChip.className = host.root.className;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = host.button.className;
            btn.setAttribute('aria-haspopup', 'dialog');
            var lbl = document.createElement('span');
            lbl.className = hostLabel ? hostLabel.className : '';
            btn.appendChild(lbl);
            btn.addEventListener('click', function (ev) {
              ev.preventDefault();
              ev.stopPropagation();
              ctxOpenDetail(ctxChip);
            });
            ctxChip.appendChild(btn);
          }
          var label = ctxChip.querySelector('span');
          // The row-level ratio alone hides the deep track, so when a post-cache
          // distillation has run the chip shows its own marker next to the ratio.
          // Keep it short: the host stat pill is narrow, so the deep track gets a
          // compact marker here and the full wording lives in the tooltip/popover.
          var chipText = '−' + ctxStats.ratio + '%';
          if (label) label.textContent = chipText;
          ctxChip.setAttribute('data-oswyn-deep', ctxStats.deepEvents > 0 ? 'true' : 'false');
          var chipTitle = '本会话压缩统计 · 点击查看详情';
          if (ctxStats.deepEvents > 0) {
            chipTitle = '本会话压缩统计：行级 −' + ctxStats.ratio + '%'
              + ' · 深度蒸馏 ' + ctxStats.deepEvents + ' 次（约省 '
              + formatTokens(ctxStats.deepSaved) + ' tok）· 点击查看详情';
          }
          ctxChip.setAttribute('title', chipTitle);
          // Always keep ctxChip anchored directly after the LAST host stat pill
          // (e.g. after 缓存), even when React mounts new stat pills later.
          var targetParent = host.root.parentNode;
          if (!document.contains(ctxChip) || ctxChip.parentNode !== targetParent || ctxChip.previousElementSibling !== host.root) {
            targetParent.insertBefore(ctxChip, host.root.nextSibling);
          }
        } catch (_) {}
      }

      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', function (ev) {
          var t = ev && ev.target;
          var inTurnPill = t && t.closest && t.closest('[data-oswyn-turn-tail]');
          if (t && (inTurnPill || (ctxChip && ctxChip.contains && ctxChip.contains(t)) || (ctxPop && ctxPop.contains && ctxPop.contains(t)))) return;
          ctxClose();
        }, true);
        document.addEventListener('keydown', function (ev) { if (ev && ev.key === 'Escape') ctxClose(); }, true);
      }

      // Union two "known body text" sets. Union (not replace) keeps fence
      // classification stable across polls; entries are short strings, so the set
      // stays bounded by the number of distilled rows in the ledger.
      function mergeKnownBodies(prev, next) {
        var out = {};
        var k;
        for (k in prev) { if (Object.prototype.hasOwnProperty.call(prev, k)) out[k] = true; }
        for (k in next) { if (Object.prototype.hasOwnProperty.call(next, k)) out[k] = true; }
        return out;
      }

      function mergeStats(prev, next) {
        var out = {};
        var k;
        for (k in prev) { if (Object.prototype.hasOwnProperty.call(prev, k)) out[k] = prev[k]; }
        for (k in next) { if (Object.prototype.hasOwnProperty.call(next, k)) out[k] = next[k]; }
        return out;
      }

      var pullInFlight = false;
      var pullPending = false;
      var lastPullAt = 0;
      var pullDebounceTimer = null;
      var PULL_MIN_INTERVAL_MS = 500;

      function requestPull(delayMs) {
        if (typeof fetch !== 'function') return;
        if (pullInFlight) { pullPending = true; return; }
        var now = Date.now();
        var since = now - lastPullAt;
        var wait = Math.max(Number(delayMs) || 0, since < PULL_MIN_INTERVAL_MS ? (PULL_MIN_INTERVAL_MS - since) : 0);
        if (pullDebounceTimer !== null) return;
        pullDebounceTimer = setTimeout(function () {
          pullDebounceTimer = null;
          pullConfig();
        }, wait);
      }

      function finishPull() {
        pullInFlight = false;
        if (pullPending) {
          pullPending = false;
          requestPull(150);
        }
      }

      function pullConfig() {
        if (typeof fetch !== 'function') return;
        if (pullInFlight) { pullPending = true; return; }
        pullInFlight = true;
        lastPullAt = Date.now();
        try {
          fetch('/api/oswyn/status', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              // Build per-tool history buckets + per-callId merged records + knownSummaries.
              try {
                if (data && Array.isArray(data.sessions)) {
                  var buckets = {};
                  var byCall = {};
                  var summaries = {};
                  var toolSummaries = {};
                  var replySummaries = {};
                  var replyStats = {};
                  var liveByCall = {};
                  for (var si = 0; si < data.sessions.length; si++) {
                    var sess = data.sessions[si];
                    if (sess && Array.isArray(sess.liveTools)) {
                      for (var lti = 0; lti < sess.liveTools.length; lti++) {
                        var lt = sess.liveTools[lti];
                        if (!lt || !lt.callId) continue;
                        var ltCid = String(lt.callId);
                        var prevLt = liveByCall[ltCid];
                        if (!prevLt) {
                          liveByCall[ltCid] = Object.assign({}, lt);
                        } else {
                          var maxBefore = Math.max(Number(prevLt.before) || 0, Number(lt.before) || 0);
                          var minAfter = (prevLt.compressed || lt.compressed)
                            ? Math.min(Number(prevLt.after) || maxBefore, Number(lt.after) || maxBefore)
                            : Number(lt.after) || 0;
                          liveByCall[ltCid] = Object.assign({}, prevLt, lt, {
                            before: maxBefore,
                            after: minAfter,
                            inputChars: Math.max(Number(prevLt.inputChars) || 0, Number(lt.inputChars) || 0),
                            compressed: Boolean(prevLt.compressed || lt.compressed || minAfter < maxBefore)
                          });
                        }
                      }
                    }
                    var list = (sess && (sess.history || sess.entries)) || [];
                    for (var ei = 0; ei < list.length; ei++) {
                      var ent = list[ei];
                      if (!ent) continue;
                      if (ent.summary && typeof ent.summary === 'string') {
                        var sumTrim = ent.summary.trim();
                        if (sumTrim) {
                          summaries[sumTrim] = true;
                          if (ent.mode === 'reply') {
                            replySummaries[sumTrim] = true;
                            if (typeof ent.before === 'number' && typeof ent.after === 'number' && ent.before > 0) {
                              replyStats[sumTrim] = { before: ent.before, after: ent.after };
                            }
                          } else {
                            toolSummaries[sumTrim] = true;
                          }
                        }
                      }
                      if (ent.fact && typeof ent.fact === 'string') {
                        var factTrim = ent.fact.trim();
                        if (factTrim) {
                          summaries[factTrim] = true;
                          if (ent.mode !== 'reply') toolSummaries[factTrim] = true;
                        }
                      }
                      if (ent.mode === 'reply') continue;
                      if (ent.callId) {
                        var cid = String(ent.callId);
                        var prev = byCall[cid];
                        if (!prev) {
                          byCall[cid] = Object.assign({}, ent, { pruneCall: ent.mode === 'prune-call' });
                        } else if (ent.mode === 'prune-call') {
                          prev.pruneCall = true;
                        } else if (prev.mode === 'prune-call') {
                          byCall[cid] = Object.assign({}, ent, { pruneCall: true });
                        } else {
                          // Re-compression on the same callId: keep earliest before and first keepLines/toolName, update after/summary.
                          prev.before = Math.max(prev.before || 0, ent.before || 0);
                          prev.after = ent.after;
                          if (!prev.inputChars && ent.inputChars) prev.inputChars = ent.inputChars;
                          if (!prev.toolName && ent.toolName) prev.toolName = ent.toolName;
                          if (!prev.keepLines && ent.keepLines) prev.keepLines = ent.keepLines;
                          if (!prev.keepChars && ent.keepChars) prev.keepChars = ent.keepChars;
                          if (ent.summary) prev.summary = ent.summary;
                          if (ent.fact) prev.fact = ent.fact;
                        }
                      }
                      if (ent.toolName) {
                        var key = String(ent.toolName).toLowerCase();
                        (buckets[key] || (buckets[key] = [])).push(ent);
                      }
                    }
                  }
                  for (var bk in buckets) {
                    if (!Object.prototype.hasOwnProperty.call(buckets, bk)) continue;
                    buckets[bk].sort(function (a, b) { return ((a.seq || 0) - (b.seq || 0)) || ((a.ts || 0) - (b.ts || 0)); });
                  }
                  histByTool = buckets;
                  histByCallId = byCall;
                  liveToolsByCall = liveByCall;
                  // Merge, never replace: a conversation that scrolls out of the ledger
                  // (or a session list that arrives partially) must not un-learn the
                  // fences we already folded, otherwise every 3s poll re-opens them.
                  knownSummaries = mergeKnownBodies(knownSummaries, summaries);
                  knownToolSummaries = mergeKnownBodies(knownToolSummaries, toolSummaries);
                  knownReplySummaries = mergeKnownBodies(knownReplySummaries, replySummaries);
                  replyStatsBySummary = mergeStats(replyStatsBySummary, replyStats);
                  ledgerReady = true;
                  try {
                    var markerEl = document.querySelector('[data-conversation-session]');
                    var wantedId = markerEl ? (markerEl.getAttribute('data-conversation-session') || '') : '';
                    if (!markerEl) {
                      // This build exposes no conversation marker: keep the legacy behaviour.
                      ledgerHasCurrentSession = true;
                    } else if (wantedId) {
                      ledgerHasCurrentSession = false;
                      for (var qi = 0; qi < data.sessions.length; qi++) {
                        if (data.sessions[qi] && String(data.sessions[qi].sessionId) === String(wantedId)) { ledgerHasCurrentSession = true; break; }
                      }
                    } else {
                      ledgerHasCurrentSession = false;
                    }
                  } catch (_) { ledgerHasCurrentSession = false; }
                }
                var gs = data && data.globalStats;
                if (gs && typeof gs.totalTokensSaved === 'number') {
                  lastTotals = {
                    tokensSaved: gs.totalTokensSaved,
                    events: (gs.totalTruncations || 0) + (gs.totalReplacements || 0) + (gs.totalDiscards || 0) + (gs.totalPruneCalls || 0) + (gs.totalReplySummaries || 0)
                  };
                }
                // Feed the composer chip with THIS conversation's stats (not global).
                if (gs) {
                  ctxAllSessions = (data && data.sessions) || [];
                  var cur = ctxCurrentSession();
                  ctxCurrent = cur;
                  var chipAgent = 0;
                  var chipAuto = 0;
                  var chipEvents = 0;
                  var chipToolEvents = 0;
                  var chipReplies = 0;
                  var chipRatio = null;
                  var chipSaved = 0;
                  var chipCum = 0;
                  var chipNet = 0;
                  var chipTotalRequests = 0;
                  var chipRequestBasedRows = 0;
                  var chipToolCalls = 0;
                  var chipDistilled = 0;
                  var chipDistillRate = 0;
                  var chipLabel = '';
                  // Post-cache deep distillation is a session-level surface reset, not a
                  // row: it has no badge of its own, so the chip carries its own marker.
                  var chipDeepEvents = 0;
                  var chipDeepSaved = 0;
                  var chipDeepRate = 0;
                  var chipDeepActive = false;
                  var chipDeepReasons = null;
                  var chipDeepLastTurn = null;
                  var chipDeepLastEval = null;
                  var chipDeepCumulative = 0;
                  var chipCompressedTokens = 0;
                  var chipUncompressedTokens = 0;
                  var chipSystemTokens = 0;
                  if (cur) {
                    var chipHist = cur.history || cur.entries || [];
                    var chipBefore = 0;
                    var chipAfter = 0;
                    for (var ch = 0; ch < chipHist.length; ch++) {
                      var ce = chipHist[ch];
                      if (!ce) continue;
                      if (ce.mode === 'reply') {
                        chipEvents += 1;
                        chipReplies += 1;
                      } else if (ce.mode === 'truncate' || ce.mode === 'replace' || ce.mode === 'discard' || ce.mode === 'prune-call') {
                        chipEvents += 1;
                        chipToolEvents += 1;
                        if (ce.trigger === 'auto' || ce.trigger === 'autonomous') chipAuto += 1;
                        else chipAgent += 1;
                      }
                      var cb = Number(ce.before);
                      var ca = Number(ce.after);
                      if (Number.isFinite(cb) && Number.isFinite(ca) && cb > ca) { chipBefore += cb; chipAfter += ca; }
                    }
                    if (Number.isFinite(Number(cur.avgSavingsRate))) chipRatio = Number(cur.avgSavingsRate);
                    else if (chipBefore > 0) chipRatio = Math.round(((chipBefore - chipAfter) / chipBefore) * 1000) / 10;
                    chipSaved = Number(cur.totalTokensSaved) || 0;
                    chipCum = Number(cur.cumulativeTokensSaved) || 0;
                    chipNet = Number(cur.totalNetTokensSaved) || 0;
                    chipTotalRequests = Number(cur.totalRequests) || 0;
                    chipRequestBasedRows = Number(cur.requestBasedRows) || 0;
                    chipToolCalls = Number(cur.totalToolCalls) || 0;
                    chipDistilled = Number(cur.distilledActions) || 0;
                    chipDistillRate = Number.isFinite(Number(cur.distillRate))
                      ? Number(cur.distillRate)
                      : (chipToolCalls > 0 ? Math.round(Math.min(100, (chipDistilled / chipToolCalls) * 100) * 10) / 10 : 0);
                    chipLabel = cur.title || cur.sessionId || '';
                    var deep = cur.distill && typeof cur.distill === 'object' ? cur.distill : null;
                    chipDeepEvents = Number(cur.totalDistillEvents) || (deep ? Number(deep.events) || 0 : 0);
                    chipDeepSaved = Number(cur.distillTokensSaved) || (deep ? Number(deep.surplusTokens) || 0 : 0);
                    chipDeepRate = Number(cur.distillSavingsRate) || 0;
                    chipDeepActive = cur.distillActive === true;
                    chipDeepReasons = (cur.distillReasons && typeof cur.distillReasons === 'object')
                      ? cur.distillReasons
                      : (deep && deep.reasons ? deep.reasons : null);
                    chipDeepLastTurn = deep && Number.isFinite(Number(deep.lastTurn)) ? Number(deep.lastTurn) : null;
                    chipDeepLastEval = (deep && deep.lastEval && typeof deep.lastEval === 'object') ? deep.lastEval : null;
                    chipDeepCumulative = Number(cur.distillCumulativeSaved) || (deep ? Number(deep.cumulativeSaved) || 0 : 0);
                    var sb = (cur.surfaceBreakdown && typeof cur.surfaceBreakdown === 'object')
                      ? cur.surfaceBreakdown
                      : (chipDeepLastEval && (Number(chipDeepLastEval.compressedTokens) > 0 || Number(chipDeepLastEval.uncompressedTokens) > 0) ? chipDeepLastEval : null);
                    if (sb) {
                      chipCompressedTokens = Number(sb.compressedTokens) || 0;
                      chipUncompressedTokens = Number(sb.uncompressedTokens) || 0;
                      chipSystemTokens = Number(sb.systemTokens) || 0;
                    }
                  }
                  ctxStats = {
                    scope: cur ? 'session' : 'global',
                    label: chipLabel,
                    ratio: chipRatio === null ? (Math.round((Number(gs.avgSavingsRate) || 0) * 10) / 10) : chipRatio,
                    events: chipEvents,
                    toolEvents: chipToolEvents,
                    replies: chipReplies,
                    agent: chipAgent,
                    auto: chipAuto,
                    saved: chipSaved,
                    cum: chipCum,
                    net: chipNet,
                    totalRequests: chipTotalRequests || 0,
                    requestBasedRows: chipRequestBasedRows || 0,
                    toolCalls: chipToolCalls || 0,
                    distilled: chipDistilled || 0,
                    distillRate: chipDistillRate || 0,
                    deepEvents: chipDeepEvents || 0,
                    deepSaved: chipDeepSaved || 0,
                    deepRate: chipDeepRate || 0,
                    deepActive: chipDeepActive === true,
                    deepReasons: chipDeepReasons,
                    deepLastTurn: chipDeepLastTurn,
                    deepLastEval: chipDeepLastEval,
                    deepCumulative: chipDeepCumulative || 0,
                    compressedTokens: chipCompressedTokens || 0,
                    uncompressedTokens: chipUncompressedTokens || 0,
                    systemTokens: chipSystemTokens || 0
                  };
                  renderContextChip();
                  notifyTurnTailListeners();
                }
                if (data && data.config) {
                  if (typeof data.config.contextRatioDetail === 'boolean') {
                    ctxDetailEnabled = data.config.contextRatioDetail;
                    try { localStorage.setItem('dsh-oswyn:contextRatioDetail', String(ctxDetailEnabled)); } catch (_) {}
                  }
                  if (typeof data.config.perTurnStats === 'boolean') {
                    ctxPerTurnEnabled = data.config.perTurnStats;
                    try { localStorage.setItem('dsh-oswyn:perTurnStats', String(ctxPerTurnEnabled)); } catch (_) {}
                  }
                  if (typeof data.config.deepTurnBadge === 'boolean') {
                    ctxDeepTurnBadgeEnabled = data.config.deepTurnBadge;
                    try { localStorage.setItem('dsh-oswyn:deepTurnBadge', String(ctxDeepTurnBadgeEnabled)); } catch (_) {}
                  }
                }
                if (data && data.config && typeof data.config.contextRatioBadge === 'boolean') {
                  ctxChipEnabled = data.config.contextRatioBadge;
                  try { localStorage.setItem('dsh-oswyn:contextRatioBadge', String(ctxChipEnabled)); } catch (_) {}
                  renderContextChip();
                }
              } catch (_) {}
              if (data && data.config) {
                if (typeof data.config.hideReplySummaryInUi === 'boolean') {
                  hideSetting = data.config.hideReplySummaryInUi;
                  try { localStorage.setItem('dsh-oswyn:hideReplySummaryInUi', String(hideSetting)); } catch (_) {}
                }
                if (typeof data.config.badgeEnabled === 'boolean') {
                  badgeSetting = data.config.badgeEnabled;
                  try { localStorage.setItem('dsh-oswyn:badgeEnabled', String(badgeSetting)); } catch (_) {}
                }
                // Reply-summary folding: fold into "已压缩" chip (default true).
                if (typeof data.config.foldReplySummary === 'boolean') {
                  try {
                    window.__oswynFoldReplySummary = data.config.foldReplySummary !== false;
                    localStorage.setItem('dsh-oswyn:foldReplySummary', String(data.config.foldReplySummary !== false));
                  } catch (_) {}
                }

              }
              sync();
              setTimeout(sync, 120);
              setTimeout(sync, 400);
              finishPull();
            })
            .catch(function () { schedule(); finishPull(); });
        } catch (_) { schedule(); finishPull(); }
      }

      function isPullTriggerNode(node) {
        if (!node || node.nodeType !== 1) return false;
        try {
          if (node.hasAttribute && (
            node.hasAttribute('data-tool') ||
            node.hasAttribute('data-chat-call-id') ||
            node.hasAttribute('data-step-process') ||
            node.hasAttribute('data-chat-turn') ||
            node.hasAttribute('data-conversation-session') ||
            node.hasAttribute('data-state') ||
            node.getAttribute('data-action') === 'branch' ||
            node.getAttribute('data-action') === 'fork' ||
            (node.hasAttribute('data-composer-stat') && node.getAttribute('data-composer-stat') !== 'oswyn')
          )) return true;
          if (node.matches && node.matches('[class*="_actions"], [class*="endInfo"], button[aria-label*="分支"], button[title*="分支"], button[aria-label*="branch" i], button[title*="branch" i]')) {
            return true;
          }
          if (node.querySelector && node.querySelector('div[data-tool], [data-chat-call-id], [data-step-process], [data-chat-turn], [data-conversation-session], [class*="_actions"], [class*="endInfo"], [data-action="branch"], [data-action="fork"], button[aria-label*="分支"], button[title*="分支"], span[data-composer-stat]:not([data-composer-stat="oswyn"])')) {
            return true;
          }
          var txt = node.textContent ? String(node.textContent).trim() : '';
          if (txt && txt.length <= 40 && /^用量\s+[\d.,]+\s*[KMB]?\s*tok$/i.test(txt)) {
            return true;
          }
        } catch (_) {}
        return false;
      }

      function isHostStatOrFooterTarget(target) {
        if (!target) return false;
        var elTarget = target.nodeType === 1 ? target : target.parentElement;
        if (!elTarget || !elTarget.closest) return false;
        return Boolean(elTarget.closest('span[data-composer-stat]:not([data-composer-stat="oswyn"]), [class*="_actions"], [class*="endInfo"]'));
      }

      schedule();
      trySetupUiConversation();
      pullConfig();
      var pullTimer = setInterval(function () {
        trySetupUiConversation();
        pullConfig();
      }, 3000);

      ctx.effect(function () {
        var observer = null;
        var root = (typeof document !== 'undefined' && (document.body || document.documentElement)) || null;
        if (typeof MutationObserver !== 'undefined' && root) {
          observer = new MutationObserver(function (mutations) {
            // The host stats dialog is React-rendered on click; reinject our rows
            // into it whenever it appears. Ignore mutations caused by our own rows,
            // otherwise remove+append would retrigger this observer forever.
            if (!hideSetting && !badgeSetting) return;
            var needSync = false;
            var needPull = false;
            for (var m = 0; m < mutations.length; m++) {
              var mut = mutations[m];
              var t = mut.target;
              if (mut.type === 'characterData') {
                if (!needPull && isHostStatOrFooterTarget(t)) {
                  needPull = true;
                }
                continue;
              }
              if (t && t.closest && t.closest('.' + BADGE_CLASS + ', .' + PANEL_CLASS + ', .' + GROUP_HINT_CLASS + ', .' + FOLD_CHIP_CLASS + ', .dsh-oswyn-deep-turn-chip, .dsh-oswyn-turn-pill, .dsh-oswyn-reply-summary-hidden, .dsh-oswyn-reply-popover, [data-oswyn-reply-fallback-wrap], [data-oswyn-deep-turn-wrap], [data-composer-stat="oswyn"]')) continue;
              needSync = true;
              if (!needPull) {
                if (mut.type === 'attributes') {
                  needPull = true;
                } else if (isHostStatOrFooterTarget(t)) {
                  needPull = true;
                } else if (mut.addedNodes && mut.addedNodes.length > 0) {
                  for (var ai = 0; ai < mut.addedNodes.length; ai++) {
                    if (isPullTriggerNode(mut.addedNodes[ai])) { needPull = true; break; }
                  }
                }
              }
            }
            if (needSync) schedule();
            if (needPull) requestPull(180);
          });
          observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state', 'data-conversation-session'] });
        }
        return function () {
          if (observer) observer.disconnect();
          if (pullTimer) clearInterval(pullTimer);
          if (pullDebounceTimer !== null) { clearTimeout(pullDebounceTimer); pullDebounceTimer = null; }
          if (rafId !== null && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(rafId); rafId = null; }
          var styleEl = document.getElementById(STYLE_ID);
          if (styleEl) styleEl.remove();
        };
      }, 'oswyn: chat compression attachment DOM observer');

      // Settings page card + slots
      var slots = ctx.slots || (ctx.get && ctx.get('slots'));
      var configForms = (ctx.get && ctx.get('configForms')) || null;
      if (slots && typeof slots.inject === 'function' && configForms && typeof configForms.whileServed === 'function') {
        ctx.effect(function () {
          return configForms.whileServed(['oswyn', 'context-distill'], function () {
            var form = configForms.get('oswyn') || configForms.get('context-distill');
            if (!form) return;

            var store = {
              subscribe: function (listener) { return form.subscribe(listener); },
              getSnapshot: function () { return form.getSnapshot(); },
              set: function (field, value) {
                if (field === 'hideReplySummaryInUi') {
                  hideSetting = value !== false;
                  try { localStorage.setItem('dsh-oswyn:hideReplySummaryInUi', String(hideSetting)); } catch (_) {}
                }
                if (field === 'foldReplySummary') {
                  var foldVal = value !== false;
                  try {
                    window.__oswynFoldReplySummary = foldVal;
                    localStorage.setItem('dsh-oswyn:foldReplySummary', String(foldVal));
                  } catch (_) {}
                }
                if (field === 'perTurnStats') {
                  ctxPerTurnEnabled = value !== false;
                  try { localStorage.setItem('dsh-oswyn:perTurnStats', String(ctxPerTurnEnabled)); } catch (_) {}
                  renderTurnTailFallback();
                  notifyTurnTailListeners();
                }
                if (field === 'deepTurnBadge') {
                  ctxDeepTurnBadgeEnabled = value !== false;
                  try { localStorage.setItem('dsh-oswyn:deepTurnBadge', String(ctxDeepTurnBadgeEnabled)); } catch (_) {}
                  renderTurnTailFallback();
                }
                if (field === 'badgeEnabled') {
                  badgeSetting = value !== false;
                  try { localStorage.setItem('dsh-oswyn:badgeEnabled', String(badgeSetting)); } catch (_) {}
                }
                schedule();
                return form.set(field, value);
              }
            };

            var unlisten = form.subscribe(function () {
              var snap = form.getSnapshot();
              var cfg = (snap && snap.value) || {};
              if (typeof cfg.hideReplySummaryInUi === 'boolean') {
                hideSetting = cfg.hideReplySummaryInUi;
                try { localStorage.setItem('dsh-oswyn:hideReplySummaryInUi', String(hideSetting)); } catch (_) {}
              }
              if (typeof cfg.foldReplySummary === 'boolean') {
                try {
                  window.__oswynFoldReplySummary = cfg.foldReplySummary !== false;
                  localStorage.setItem('dsh-oswyn:foldReplySummary', String(cfg.foldReplySummary !== false));
                } catch (_) {}
              }
              if (typeof cfg.perTurnStats === 'boolean') {
                ctxPerTurnEnabled = cfg.perTurnStats;
                try { localStorage.setItem('dsh-oswyn:perTurnStats', String(ctxPerTurnEnabled)); } catch (_) {}
                renderTurnTailFallback();
                notifyTurnTailListeners();
              }
              if (typeof cfg.deepTurnBadge === 'boolean') {
                ctxDeepTurnBadgeEnabled = cfg.deepTurnBadge;
                try { localStorage.setItem('dsh-oswyn:deepTurnBadge', String(ctxDeepTurnBadgeEnabled)); } catch (_) {}
                renderTurnTailFallback();
              }
              if (typeof cfg.badgeEnabled === 'boolean') {
                badgeSetting = cfg.badgeEnabled;
                try { localStorage.setItem('dsh-oswyn:badgeEnabled', String(badgeSetting)); } catch (_) {}
              }
              schedule();
            });

            var unregSettings = slots.inject('settings.section', function () {
              return slots.register({ name: 'settings.section', id: 'oswyn', label: 'OSWYN 上下文精炼', order: 25 }, function () {
                // Gutter lives inside the card (responsive: 16/20px wide → 12/10px narrow),
            // so the slot wrapper must not add a second, width-oblivious padding.
            return el('div', { style: { padding: '0', maxWidth: '1080px', margin: '0 auto' } }, el(ContextDistillCard, { form: store }));
              });
            });

            var unregBundleConfig = slots.inject('plugins.bundle.config', function () {
              return slots.register({ name: 'plugins.bundle.config', key: 'dsh-oswyn', label: 'DSH-OSWYN (Only See What You Need)' }, function () {
                return el(ContextDistillCard, { form: store });
              });
            });

            return function () {
              unlisten();
              if (typeof unregSettings === 'function') unregSettings();
              if (typeof unregBundleConfig === 'function') unregBundleConfig();
            };
          });
        }, 'oswyn: plugins-page card');
      }
    };

    return module.exports;
  }
});