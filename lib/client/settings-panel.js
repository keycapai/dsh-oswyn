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
            kpiCard('平均压缩率', (firstNum(g.avgSavingsRate) || 0) + '%', '#f59e0b', '所有真实缩小的工具输出与回复加权降幅'),
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

