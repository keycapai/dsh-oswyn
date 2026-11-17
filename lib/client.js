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
      var standingSaved = firstNum(g.standingTokensSaved) || 0;

      var sessions = (data && data.sessions) || [];

      var kpiCard = function (label, value, color, sub) {
        return el('div', {
          style: { padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.04))', display: 'flex', flexDirection: 'column', gap: '4px' }
        },
          el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, label),
          el('div', { style: { fontSize: '22px', fontWeight: 700, color: color } }, value),
          sub ? el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #999)' } }, sub) : null
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
            padding: '6px 12px', fontWeight: activeTab === id ? 600 : 400, cursor: 'pointer', fontSize: '13px'
          }
        }, label);
      };

      var defaultProtectedTools = [
        'run_code', 'read', 'write', 'edit', 'apply_patch', 'notebook',
        'read_image', 'todo_write', 'ask_user_question', 'skill', 'tool_search',
        'tool_result_recall', 'oswyn_stats', 'oswyn_protect_tool',
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
              padding: '12px 14px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
              background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
              gap: '16px'
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
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))',
              background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
              gap: '16px'
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
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 } },
              el('input', {
                type: 'number',
                value: Number.isFinite(Number(item.value)) ? Number(item.value) : 0,
                min: item.min,
                step: item.step || 1,
                disabled: disabled,
                style: {
                  width: '90px', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))',
                  background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
                  fontSize: '12px', textAlign: 'right'
                },
                onChange: function (e) {
                  var n = Number(e.target.value);
                  if (Number.isFinite(n)) setField(item.field, n);
                }
              }),
              item.unit ? el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-tertiary, #888)', minWidth: '24px' } }, item.unit) : null
            )
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
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
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

      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 20px', color: 'var(--dsw-alias-text-primary, inherit)', fontSize: '13px' } },
        // Header
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))' } },
          el('div', null,
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              el('span', { style: { fontWeight: 600, fontSize: '15px' } }, 'DSH-OSWYN · 上下文精炼 (Only See What You Need)'),
              el('span', { style: { fontSize: '11px', padding: '2px 7px', borderRadius: '10px', background: cfg.enabled !== false ? 'rgba(59,130,246,0.15)' : 'rgba(128,128,128,0.2)', color: cfg.enabled !== false ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-label-tertiary, #888)', fontWeight: 500 } }, cfg.enabled !== false ? '全局生效' : '已禁用')
            ),
            el('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, rgba(128,128,128,0.7))', marginTop: '4px' } }, 'Agent 自主决策 · 保留前缀 KV 缓存 · 回复双轨备忘')
          ),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            el('button', { type: 'button', onClick: refetch, disabled: live.loading, style: { padding: '4px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, live.loading ? '同步中…' : '刷新'),
            el(SwitchComp, { checked: cfg.enabled !== false, disabled: disabled, onChange: function (val) { setField('enabled', val); } })
          )
        ),

        // Tabs
        el('div', { style: { display: 'flex', gap: '8px', borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))', paddingBottom: '2px' } },
          tabBtn('stats', '运行统计与收益'),
          tabBtn('sessions', '会话精炼明细 (' + sessions.length + ')'),
          tabBtn('config', '精炼参数配置')
        ),

        // TAB 1: stats
        activeTab === 'stats' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' } },
            kpiCard('累计净节省 Token (Net)', '~' + formatNumber(totalNet), '#3b82f6', '输入省 ~' + formatNumber(totalTokensSaved) + ' · 额外耗 ' + formatNumber(totalExtra + totalRecall)),
            kpiCard('每轮持续省 Token (Standing)', '~' + formatNumber(standingSaved), '#0ea5e9', '已压缩内容每轮都不再进入上下文，持续生效（累计 ' + formatNumber(totalNet) + ' tok 已按步累加）'),
            kpiCard('工具精炼触发率', distillRate + '%', '#10b981', '截断/替换/丢弃: ' + (totalTruncations + totalReplacements + totalDiscards) + ' / 工具执行 ' + totalToolCalls + ' 次'),
            kpiCard('助手回复双轨精炼', totalReplySummaries + ' 次', '#8b5cf6', '用户看详尽版 · 模型看精炼备忘'),
            kpiCard('总精炼事件 / 会话数', totalActions + ' / ' + totalSessions, 'inherit', '截断 ' + totalTruncations + ' · 替换 ' + totalReplacements + ' · 丢弃 ' + totalDiscards)
          ),
          el('div', { style: { padding: '14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.02))', display: 'flex', flexDirection: 'column', gap: '8px' } },
            el('div', { style: { fontWeight: 600, fontSize: '13px' } }, '上下文精炼架构优势'),
            el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' } },
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
              el('div', { onClick: function () { toggleSession(sess.sessionId); }, style: { padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', background: isExpanded ? 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))' : 'transparent' } },
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                  el('div', { style: { fontWeight: 600, fontSize: '13px' } }, (sess.title || sess.sessionId) + ' ' + (isExpanded ? '▾' : '▸')),
                  el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, 'ID: ' + sess.sessionId + ' · 精炼 ' + acts.length + ' 次')
                ),
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' } },
                  el('span', { style: { color: '#3b82f6', fontWeight: 600 } }, '净 ~' + formatNumber(totals.net) + ' tok'),
                  el('span', { style: { color: '#10b981', fontWeight: 600 } }, '省 ~' + formatNumber(totals.savedIn) + ' tok'),
                  el('span', { style: { color: 'var(--dsw-alias-text-secondary, #888)' } }, '多花 ' + formatNumber(totals.extra + totals.recall) + ' tok')
                )
              ),
              isExpanded ? el('div', { style: { padding: '12px 14px', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))', display: 'flex', flexDirection: 'column', gap: '8px' } },
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
                    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
                        el('span', { style: { fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: modeColor + '20', color: modeColor, fontWeight: 600, flex: 'none' } }, label),
                        el('span', { style: { fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: triggerColor + '20', color: triggerColor, fontWeight: 600, flex: 'none' } }, triggerLabel),
                        el('span', { style: { fontWeight: 600, fontSize: '12px' } }, toolTitle),
                        keepBadge ? el('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-text-secondary, #888)' } }, keepBadge) : null
                      ),
                      el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', flex: 'none' } }, timeStr(item.ts || item.timestamp))
                    ),
                    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', gap: '8px' } },
                      el('span', { style: { minWidth: 0 } }, delta),
                      el('span', { style: { flex: 'none' } }, '省 ' + formatNumber(n.savedIn) + ' · 多花 ' + formatNumber(n.extra + n.recall) + ' · 净 ' + formatNumber(n.net) + ' tok'),
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
              icon: '🧠',
              title: '多轮压缩意愿动态感知 (Adaptive Nudge)',
              badge: '核心治理 · 意愿衰减防治',
              color: '#8b5cf6',
              desc: '针对深层多轮对话中的「Turn-8 意愿断崖」与惯性遗忘，通过 3D 亏损检测（连续步数、累积字符、对话深度）与 5 重零误报守卫，自适应注入 Tier 1~3 阶梯提示。100% 保护服务端 KV-Cache，零磁盘持久化污染。',
              items: [
                { type: 'switch', field: 'adaptiveNudgeEnabled', title: '多轮自适应意愿提示引擎', desc: '核心总控开关。在多轮对话中动态监测模型的主动压缩意愿，检测到意愿亏损时自适应注入分级提示（Tier 1 建议 / Tier 2 契约 / Tier 3 预算告警）。', badge: '推荐开启', checked: cfg.adaptiveNudgeEnabled !== false },
                { type: 'number', field: 'uncompressedStepThreshold', title: '连续未压缩步数触发门槛', desc: '[3D 维度 1] 连续执行 N 步工具且未进行任何压缩时，判定模型产生非压缩惯性，触发 Tier 2 契约强化提示。推荐值：2 步。', value: cfg.uncompressedStepThreshold ?? 2, min: 1, step: 1, unit: '步' },
                { type: 'number', field: 'accumulatedPayloadThreshold', title: '累积未压缩字符增量门槛', desc: '[3D 维度 2] 会话中未压缩工具输出的累积字符增量达到此上限时，触发 Tier 3 上下文预算警报。推荐值：2000 字符。', value: cfg.accumulatedPayloadThreshold ?? 2000, min: 500, step: 200, unit: '字符' },
                { type: 'number', field: 'deepHorizonTurns', title: '深度对话注意力稀释轮数', desc: '[3D 维度 3] 对话深度达到此轮数后，模型对初期系统提示注意力产生稀释，激活长程意愿保护模式。推荐值：8 轮。', value: cfg.deepHorizonTurns ?? 8, min: 3, step: 1, unit: '轮' },
                { type: 'number', field: 'coldStartSteps', title: '冷启动探索静默轮数', desc: '[守卫 2] 任务前 N 轮通常为项目结构初探与配置读取，期间强制静默提示，绝不干扰模型初期探索。推荐值：2 轮。', value: cfg.coldStartSteps ?? 2, min: 0, step: 1, unit: '轮' },
                { type: 'number', field: 'cooldownSteps', title: '提示冷却间隔步数', desc: '[守卫 4] 每次发出意愿提示后必须等待的步数，防止高频提示造成模型注意力干扰。推荐值：2 步。', value: cfg.cooldownSteps ?? 2, min: 1, step: 1, unit: '步' },
                { type: 'number', field: 'minChars', title: '候选噪声输出字符下限', desc: '过滤短文本输出。低于此长度的简短命令返回视为安全紧凑内容，不计入亏损累加与候选目标。推荐值：600 字符。', value: cfg.minChars ?? 600, min: 100, step: 50, unit: '字符' }
              ]
            },
            {
              id: 'single-nudge',
              icon: '⚡',
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
              icon: '🛡️',
              title: '分级自动兜底与工具安全保护 (Protection & Fallback)',
              badge: 'Agent-First 护栏',
              color: '#10b981',
              desc: '贯彻 Agent-First 自主决策原则：优先由模型决策压缩与保留；为防超大输出意外击穿窗口提供分级兜底；高价值源码与配置受保护名单 100% 豁免。',
              items: [
                { type: 'switch', field: 'autoCompressTiered', title: '分级自动兜底', desc: '除保护名单外的工具，超过字符门槛且模型未写压缩围栏时自动截断，防止意外打爆上下文窗口。', badge: '安全兜底', checked: cfg.autoCompressTiered !== false },
                { type: 'switch', field: 'autoCompress', title: '全量强制自动压缩', desc: '是否无差别对所有未保护输出进行强制自动截断。建议保持关闭（源码读取等建议由 Agent 自主决策）。', badge: '谨慎开启', checked: cfg.autoCompress === true },
                { type: 'number', field: 'autoCompressMinChars', title: '自动兜底触发字符门槛', desc: '输出超过此字符数且模型未处理时才触发自动兜底；默认 4000 字符，代码有效下限 200。', value: cfg.autoCompressMinChars ?? 4000, min: 200, step: 100, unit: '字符' },
                { type: 'number', field: 'autoCompressKeepLines', title: '自动兜底保留头部行数', desc: '自动截断时从第 0 行起原样保留的头部行数（不影响模型围栏自定的行数）；默认 30。', value: cfg.autoCompressKeepLines ?? 30, min: 1, step: 1, unit: '行' },
                { type: 'switch', field: 'autoCompressPtcSubcalls', title: 'PTC 子调用聚合折叠', desc: 'run_code 一次批量执行多个子调用时，按子调用生成结构化摘要并替换外层结果；run_code 本身仍受普通保护排除。', badge: '推荐开启', checked: cfg.autoCompressPtcSubcalls !== false },
                { type: 'switch', field: 'autoDiscardFailed', title: '失败调用自动丢弃', desc: '退出码非 0、异常堆栈等失败输出在下一步自动整段丢弃，仅保留精炼失败结论。', badge: '推荐开启', checked: cfg.autoDiscardFailed !== false },
                { type: 'textList', field: 'autoDiscardTools', title: '始终丢弃工具名单', desc: '此名单中的工具无论输出长度都会自动丢弃；默认包含 validate_dsh_ui，支持逗号分隔与末尾 * 通配符。', list: Array.isArray(cfg.autoDiscardTools) ? cfg.autoDiscardTools : defaultDiscardTools },
                { type: 'textList', field: 'autoCompressTieredProtectedTools', title: '重要不可压缩保护名单', desc: '此列表中的工具永远不会被自动兜底压缩，源码与高价值数据 100% 完整保留；支持逗号分隔与通配符。', list: Array.isArray(cfg.autoCompressTieredProtectedTools) ? cfg.autoCompressTieredProtectedTools : defaultProtectedTools }
              ]
            },
            {
              id: 'ui',
              icon: '🎨',
              title: '界面展示与双轨交互体验 (UI Display & Dual-Track)',
              badge: '视觉体验',
              color: '#06b6d4',
              desc: '控制前端界面视觉渲染与双轨精炼展现形式，保持对话流清爽易读，同时与后端推理上下文解耦。',
              items: [
                { type: 'switch', field: 'badgeEnabled', title: '行内压缩附件徽章与抽屉', desc: '在已压缩的工具行末尾显示「已压缩 -85%」徽章，点击可展开前后大小、节省量及原始内容抽屉。', badge: '推荐开启', checked: cfg.badgeEnabled !== false },
                { type: 'switch', field: 'replySummaryEnabled', title: '助手回复双轨投影', desc: '长篇回复生成双轨内容——当前轮向用户展示详尽版，提炼紧凑备忘供后续模型轮次使用。', badge: '核心机制', checked: cfg.replySummaryEnabled !== false },
                { type: 'switch', field: 'foldReplySummary', title: '回复精炼围栏折叠为「已压缩」条', desc: '开启后，对话中用于下轮模型的 dsh-reply-summary 备忘围栏会折叠成一条「已压缩 · 点击展开」小条，而不是直接消失。', badge: '推荐开启', checked: cfg.foldReplySummary !== false },
                { type: 'switch', field: 'showCompressedReply', title: '默认展开已压缩回复', desc: '开启后，「已压缩」条默认展开显示被压缩的原文块；关闭则默认折叠，保持界面整洁。', badge: '界面默认', checked: cfg.showCompressedReply === true }
              ]
            },
            {
              id: 'post-cache',
              icon: '⚡',
              title: 'KV-Cache 失效与后缓存深层精炼 (Post-Cache Distill)',
              badge: 'v2.3 核心',
              color: '#8b5cf6',
              desc: '在服务端 KV-Cache 超时失效后启动深层精炼，剥离历史轮次中的所有思考链与工具调用，仅保留用户文本与紧凑回复，大幅降低冷重启成本。',
              items: [
                { type: 'switch', field: 'postCacheDistillEnabled', title: '后缓存深层精炼总开关', desc: '服务端 KV-Cache 失效后，自动剥离历史轮次思考链与工具调用序列。', badge: '推荐开启', checked: cfg.postCacheDistillEnabled !== false },
                { type: 'number', field: 'cacheTtlSeconds', title: '服务端 KV-Cache 空闲超时阈值', desc: '两轮会话之间超过该空闲时长判定为缓存已失效（默认 300 秒即 5 分钟）。', value: cfg.cacheTtlSeconds ?? 300, min: 10, step: 10, unit: '秒' },
                { type: 'switch', field: 'distillStripThinking', title: '失效后剥离历史思考链', desc: '缓存失效后从历史助手回复中移除 <think> 推理内容，仅保留最终紧凑回复。', badge: '深度瘦身', checked: cfg.distillStripThinking !== false },
                { type: 'switch', field: 'distillStripToolCalls', title: '失效后剥离历史工具调用与结果', desc: '缓存失效后从历史上下文中移除所有工具调用序列与返回结果，底账完整留存可按轮次召回。', badge: '极大降费', checked: cfg.distillStripToolCalls !== false }
              ]
            },
            {
              id: 'core',
              icon: '⚙️',
              title: '全局核心与运行策略 (Global Core & Strategy)',
              badge: '系统控制',
              color: '#64748b',
              desc: 'OSWYN 全局生效总控、步骤边界钩子流水线与运行期诊断配置。',
              items: [
                { type: 'switch', field: 'enabled', title: '全局总开关', desc: '全局启用或禁用 DSH-OSWYN 上下文精炼与压缩契约。关闭后所有压缩、提示与投影全部暂停。', badge: '全局总控', checked: cfg.enabled !== false },
                { type: 'switch', field: 'autoApply', title: '智能体步骤边界自动精炼', desc: '在智能体每步执行前后自动扫描模型输出中的精炼围栏并落地生效。', badge: '核心流水线', checked: cfg.autoApply !== false },
                { type: 'switch', field: 'verbose', title: '详细诊断日志输出', desc: '在控制台输出详细的精炼执行日志、守卫评估状态与提示注入明细，便于调试与分析。', badge: '调试排错', checked: cfg.verbose === true }
              ]
            }
          ];

          var totalSettingsCount = CONFIG_GROUPS.reduce(function (sum, g) { return sum + g.items.length; }, 0);

          var categoryPills = [
            { id: 'all', label: '全部设置', count: totalSettingsCount, icon: '📋' },
            { id: 'post-cache', label: 'KV缓存深层精炼', count: 4, icon: '⚡' },
            { id: 'willingness', label: '多轮意愿感知', count: 7, icon: '🧠' },
            { id: 'single-nudge', label: '单步压力感知', count: 5, icon: '⚡' },
            { id: 'protection', label: '自动兜底保护', count: 8, icon: '🛡️' },
            { id: 'ui', label: '界面与双轨', count: 4, icon: '🎨' },
            { id: 'core', label: '全局与基础', count: 3, icon: '⚙️' }
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
                  placeholder: '🔍 快速搜索设置项名称、参数 key 或功能说明 (如: 意愿 / 提示 / 阈值 / 保护 / adaptiveNudge)...',
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
                    cursor: 'pointer', fontSize: '14px', padding: '2px 6px'
                  }
                }, '✕') : null
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
                    padding: '5px 12px', borderRadius: '16px',
                    border: '1px solid ' + (isSel ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))'),
                    background: isSel ? 'rgba(59,130,246,0.15)' : 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.03))',
                    color: isSel ? 'var(--dsw-alias-text-accent, #3b82f6)' : 'var(--dsw-alias-text-secondary, #888)',
                    fontWeight: isSel ? 600 : 400, fontSize: '12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }
                },
                  cat.icon ? el('span', null, cat.icon) : null,
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
                padding: '40px 20px', textAlign: 'center', borderRadius: '8px',
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
                  display: 'flex', flexDirection: 'column', gap: '10px',
                  padding: '16px', borderRadius: '10px',
                  border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.2))',
                  background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.02))'
                }
              },
                // Group Header
                el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                  el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    el('span', { style: { fontSize: '16px' } }, grp.icon),
                    el('span', { style: { fontWeight: 700, fontSize: '14px', color: grp.color || 'var(--dsw-alias-text-primary, inherit)' } }, grp.title)
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
                padding: '14px 16px', borderRadius: '8px',
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
    // Known summary bodies from the live ledger (used to identify oswyn fences
    // even when DSH's CodeToolbar replaces unknown lang tags with "代码块").
    var knownSummaries = {};
    var knownToolSummaries = {};
    var knownReplySummaries = {};
    var replyStatsBySummary = {};

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

      // Expandable detail panel (hidden by default; toggled on click/keydown).
      var panel = document.createElement('span');
      panel.className = PANEL_CLASS;
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
      var toolLabel = String(meta.toolName || 'tool');
      if (meta.seq !== undefined && meta.seq !== null && meta.seq !== '') toolLabel += ' · seq ' + meta.seq;
      var beforeDetail = formatBytes(before) + '（' + formatNumber(before) + ' 字符' + (meta.inputChars > 0 ? ('，含调用输入 ' + formatNumber(meta.inputChars) + ' 字符') : '') + '）';
      var afterDetail = formatBytes(after) + '（' + formatNumber(after) + ' 字符）';
      var remainPct = Math.max(2, Math.min(100, 100 - pct));
      var accentColor = triggerTone === 'auto' ? '#d49b6a' : '#6aa6d4';

      // 1) Compact Header: Tool + Mode/Trigger Pill
      var hdr = document.createElement('div');
      hdr.setAttribute('data-dsh-oswyn-panel-title', 'true');
      hdr.style.setProperty('display', 'flex');
      hdr.style.setProperty('align-items', 'center');
      hdr.style.setProperty('justify-content', 'space-between');
      hdr.style.setProperty('gap', '8px');
      hdr.style.setProperty('margin-bottom', '8px');
      var hdrLeft = document.createElement('span');
      hdrLeft.style.setProperty('font-weight', '600');
      hdrLeft.style.setProperty('font-size', '12px');
      hdrLeft.style.setProperty('color', '#f1f3f4');
      hdrLeft.textContent = '工具：' + toolLabel;
      var hdrRight = document.createElement('span');
      hdrRight.style.setProperty('font-size', '11px');
      hdrRight.style.setProperty('padding', '1px 6px');
      hdrRight.style.setProperty('border-radius', '4px');
      hdrRight.style.setProperty('background', 'rgba(255,255,255,0.08)');
      hdrRight.style.setProperty('color', accentColor);
      hdrRight.textContent = (triggerTone === 'auto' ? '自动' : '主动') + ' · ' + modeLabel(mode);
      hdr.appendChild(hdrLeft);
      hdr.appendChild(hdrRight);
      panel.appendChild(hdr);

      // 2) Visual Before→After Chart Bar + Key Metrics
      var chartBox = document.createElement('div');
      chartBox.setAttribute('data-dsh-oswyn-chart', 'true');
      chartBox.style.setProperty('padding', '8px 10px');
      chartBox.style.setProperty('border-radius', '6px');
      chartBox.style.setProperty('background', 'rgba(255,255,255,0.04)');
      chartBox.style.setProperty('border', '1px solid rgba(255,255,255,0.08)');
      chartBox.style.setProperty('margin-bottom', '8px');

      var metricTop = document.createElement('div');
      metricTop.style.setProperty('display', 'flex');
      metricTop.style.setProperty('justify-content', 'space-between');
      metricTop.style.setProperty('align-items', 'baseline');
      metricTop.style.setProperty('margin-bottom', '6px');
      var metricMain = document.createElement('span');
      metricMain.style.setProperty('font-weight', '600');
      metricMain.style.setProperty('font-size', '12px');
      metricMain.style.setProperty('color', '#e8eaed');
      metricMain.textContent = '减少 ' + pct + '% · 节省 ' + formatNumber(savedChars) + ' 字符 (≈' + formatNumber(savedTokens) + ' tok)';
      metricTop.appendChild(metricMain);
      chartBox.appendChild(metricTop);

      // Stacked visual bar: kept/after vs saved
      var track = document.createElement('div');
      track.style.setProperty('height', '8px');
      track.style.setProperty('border-radius', '4px');
      track.style.setProperty('background', 'rgba(255,255,255,0.10)');
      track.style.setProperty('overflow', 'hidden');
      track.style.setProperty('display', 'flex');
      track.style.setProperty('margin-bottom', '6px');
      var fillAfter = document.createElement('div');
      fillAfter.style.setProperty('width', remainPct + '%');
      fillAfter.style.setProperty('background', accentColor);
      fillAfter.style.setProperty('height', '100%');
      track.appendChild(fillAfter);
      chartBox.appendChild(track);

      // Legend: 压缩前 vs 压缩后
      var legend = document.createElement('div');
      legend.style.setProperty('display', 'flex');
      legend.style.setProperty('flex-direction', 'column');
      legend.style.setProperty('gap', '2px');
      legend.style.setProperty('font-size', '11px');
      legend.style.setProperty('color', '#bdc1c6');
      var legBefore = document.createElement('div');
      legBefore.textContent = '压缩前：' + beforeDetail;
      var legAfter = document.createElement('div');
      legAfter.textContent = '压缩后：' + afterDetail;
      legend.appendChild(legBefore);
      legend.appendChild(legAfter);
      chartBox.appendChild(legend);
      panel.appendChild(chartBox);

      // 3) Essential Key Info Only (保留策略 + 简短摘要)
      var rows = [
        ['保留', keepNote]
      ];
      if (meta.pruneCall) rows.push(['参数', '已折叠超长参数 (prune-call)']);
      if (meta.summary) rows.push(['摘要', String(meta.summary).slice(0, 240)]);
      for (var i = 0; i < rows.length; i++) {
        var line = document.createElement('span');
        line.setAttribute('data-dsh-oswyn-kv', 'true');
        line.style.setProperty('display', 'block');
        line.style.setProperty('padding', '2px 0');
        var k = document.createElement('span');
        k.setAttribute('data-dsh-oswyn-k', 'true');
        k.textContent = rows[i][0] + '：';
        var v = document.createElement('span');
        v.setAttribute('data-dsh-oswyn-v', 'true');
        v.textContent = rows[i][1];
        line.appendChild(k);
        line.appendChild(v);
        panel.appendChild(line);
      }
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
          var rect = badge.getBoundingClientRect ? badge.getBoundingClientRect() : null;
          var vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
          var vw = (typeof window !== 'undefined' && window.innerWidth) || 1200;
          var top = rect ? Math.min(rect.bottom + 6, vh - 240) : 120;
          var left = rect ? Math.max(8, Math.min(rect.left, vw - 340)) : 60;
          panel.style.setProperty('top', top + 'px');
          panel.style.setProperty('left', left + 'px');
          panel.style.setProperty('display', 'block');
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
      if (t.indexOf('dsh-result-summary') >= 0 || t.indexOf('dsh-reply-summary') >= 0) return true;
      if (hasResultDirectivePrefix(t)) return true;
      if (/^[-*•\s]*DENSE\s+(DECISION|MEMO)\b/i.test(t)) return true;
      return false;
    }

    // Compute before→after character stats for a reply-summary fence block.
    // Prefers authoritative ledger numbers when available; otherwise measures
    // the visible assistant message container vs the memo body.
    function computeReplyBlockStats(block) {
      try {
        var bodyText = extractCodeBodyText(block);
        var after = bodyText ? bodyText.length : 0;
        if (bodyText && replyStatsBySummary[bodyText]) {
          var st = replyStatsBySummary[bodyText];
          if (st.before > 0 && st.after > 0) return { before: st.before, after: st.after };
        }
        var before = 0;
        var parent = block && block.parentElement;
        if (parent) {
          var siblings = parent.children || [];
          for (var i = 0; i < siblings.length; i++) {
            var sib = siblings[i];
            if (!sib || sib === block) continue;
            if (sib.classList && (sib.classList.contains(FOLD_CHIP_CLASS) || sib.classList.contains('dsh-oswyn-reply-summary-hidden'))) continue;
            before += String(sib.textContent || '').length;
          }
          before += after;
        }
        if (before > after && after > 0) return { before: before, after: after };
      } catch (_) {}
      return null;
    }

    function formatReplyChipText(block, isOpen) {
      var stats = computeReplyBlockStats(block);
      var statStr = '';
      if (stats && stats.before > 0 && stats.after >= 0 && stats.after < stats.before) {
        var pct = ratioPct(stats.before, stats.after);
        statStr = ' ' + formatNumber(stats.before) + '→' + formatNumber(stats.after) + ' 字符' + (pct > 0 ? ' (-' + pct + '%)' : '');
      }
      return '已压缩' + statStr + (isOpen ? ' · 点击收起' : ' · 点击展开');
    }

    // Collapse an oswyn reply-summary fence block into a "已压缩 <before>→<after> 字符 (-X%) · 点击展开" chip.
    // Idempotent. If showExpanded is true the block stays visible.
    function foldBlock(block, showExpanded) {
      if (!block || !block.classList) return;
      var chip = null;
      try {
        var prev = prevSiblingOf(block);
        if (prev && prev.classList && prev.classList.contains(FOLD_CHIP_CLASS)) chip = prev;
      } catch (_) {}
      if (block.getAttribute && block.getAttribute('data-oswyn-folded') === '1') {
        // Already folded: preserve whatever the user chose, and keep stats label up-to-date if ledger loaded.
        var opened = block.getAttribute('data-oswyn-open') === '1';
        var wantOpen = showExpanded || opened;
        if (wantOpen) block.style.removeProperty('display');
        else block.style.setProperty('display', 'none', 'important');
        if (chip) {
          var nextLabel = formatReplyChipText(block, wantOpen);
          if (chip.textContent !== nextLabel) chip.textContent = nextLabel;
        }
        return;
      }
      block.classList.remove('dsh-oswyn-reply-summary-hidden');
      block.setAttribute('data-oswyn-folded', '1');
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = FOLD_CHIP_CLASS;
        chip.setAttribute('data-dsh-oswyn-fold-chip', 'true');
        chip.textContent = formatReplyChipText(block, Boolean(showExpanded));
        chip.addEventListener('click', function (e) {
          if (e && e.stopPropagation) e.stopPropagation();
          var hidden = block.style.display === 'none' || block.getAttribute('data-oswyn-open') !== '1';
          block.setAttribute('data-oswyn-open', hidden ? '1' : '0');
          if (hidden) block.style.removeProperty('display'); else block.style.setProperty('display', 'none', 'important');
          chip.textContent = formatReplyChipText(block, hidden);
        });
        try { block.parentNode.insertBefore(chip, block); } catch (_) {}
      }
      if (showExpanded) {
        block.setAttribute('data-oswyn-open', '1');
        block.style.removeProperty('display');
        chip.textContent = formatReplyChipText(block, true);
      } else {
        block.setAttribute('data-oswyn-open', '0');
        block.style.setProperty('display', 'none', 'important');
        chip.textContent = formatReplyChipText(block, false);
      }
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
      return hasExplicitFenceTag(el, 'dsh-reply-summary') || hasExplicitFenceTag(el, 'dsh-result-summary');
    }

    // Extract ONLY the code body inside a code-block element, stripping the
    // CodeToolbar banner ("代码块" / "Code" / "复制") that otherwise prefixes
    // el.textContent and breaks line-anchored regexes.
    function extractCodeBodyText(el) {
      if (!el) return '';
      try {
        if (el.querySelector) {
          var codeNode = el.querySelector('[data-code-block-content] code, [data-code-block-content] pre, pre code, pre, code');
          if (codeNode && codeNode.textContent !== undefined) {
            return String(codeNode.textContent || '').trim();
          }
        }
        return String(el.textContent || '').trim();
      } catch (_) {
        return '';
      }
    }

    // Structured reply-memo bullet detector (requires `key：value` or `key: value`
    // memo lines and that the block sits at the tail of its parent message container).
    var REPLY_MEMO_BULLET_RE = /^[-*•]\s*(?:\*\*)?(?:改动(?:文件|内容|详情)?|修改(?:文件|内容|详情)?|验证(?:结果|情况)?|待办(?:事项)?|待用户(?:确认)?|结论(?:与细节)?|测试(?:结果|情况)?|状态|未修改|已完成|核心(?:改动|结论|细节|要点)?|关键(?:细节|结论|改动|信息|数据|配置)?|回答(?:要点|细节|结论)?|分析(?:结论|要点)?|方案(?:细节|要点)?|配置(?:变更|详情)?|文件|问题|原因(?:与修复)?|根因(?:与修复)?|修复(?:内容|方案)?|Root\s+cause(?:\s*&\s*fix)?|Key\s+(?:details|findings|changes|points|decisions)|Summary|Changes|Verification|Conclusion|Details)(?:\*\*)?\s*[：:]/i;

    function isLikelyChineseReplyMemo(el, text) {
      if (!el || !text) return false;
      // Must be the trailing block in its parent container (reply summaries are always at the end of the reply).
      var next = el.nextElementSibling;
      if (next && (!next.classList || !next.classList.contains(FOLD_CHIP_CLASS))) return false;
      var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length < 2) return false;
      if (!lines.every(function (l) { return /^[-*•]/.test(l); })) return false;
      var matchedKeys = 0;
      for (var i = 0; i < lines.length; i++) {
        if (REPLY_MEMO_BULLET_RE.test(lines[i])) matchedKeys++;
      }
      return matchedKeys >= 2;
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

        // 1) Exact match against known summaries recorded in the session ledger
        if (knownSummaries[text] || (stripped && knownSummaries[stripped])) return true;

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

        // 4) Chinese / structured multi-bullet reply summary inside a generic "代码块" banner block:
        if (hasBanner && isGenericHeader && isLikelyChineseReplyMemo(el, text)) {
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
        // Explicit dsh-result-summary fence or inside a tool step is NEVER a reply fence.
        if (hasExplicitFenceTag(el, 'dsh-result-summary')) return false;
        if (el.closest && el.closest('[data-step-process], div[data-tool]')) return false;
        if (hasExplicitFenceTag(el, 'dsh-reply-summary')) return true;

        var text = extractCodeBodyText(el);
        if (!text) return false;
        var stripped = stripLeadingDirectiveLines(text);

        // If the block starts with a tool-result directive (`replace`, `truncate`, `discard`,
        // `discard entire-ptc`, `seq ...`, `protect`, `prune-call`, etc.), it is a tool-result
        // summary fence and must NEVER be folded into a reply chip.
        if (hasResultDirectivePrefix(text)) return false;

        // Authoritative ledger check: if recorded as a tool summary (and not a reply summary), it's a tool fence.
        if (knownReplySummaries[text]) return true;
        if (knownToolSummaries[text] || (stripped && knownToolSummaries[stripped])) return false;

        if (/^(?:>\s*)?[-*•\s]*DENSE\s+(?:DECISION-COMPLETE\s+)?MEMO/im.test(text)) return true;
        if (text.indexOf('[oswyn 双轨备忘') >= 0 || text.indexOf('[oswyn 双轨') >= 0) return true;
        if (/^(?:>\s*)?[-*•\s]*(?:STATUS\s*&|OPEN\s+ITEMS)/im.test(text)) return true;

        var hasBanner = Boolean(el.hasAttribute && el.hasAttribute('data-code-block-banner')) ||
                        Boolean(el.querySelector && el.querySelector('[data-code-block-banner], .bannerWrap, .banner, [class*="bannerWrap"], [class*="header"]'));
        if (hasBanner && isLikelyChineseReplyMemo(el, text)) {
          return true;
        }
      } catch (_) {}
      return false;
    }

    // Hide/fold oswyn fences: reply memos become a chip; tool-result directives
    // disappear entirely (their result row already carries the compression badge).
    function hideReplySummaryBlocks() {
      if (typeof document === 'undefined') return;
      var showExpanded = (typeof window !== 'undefined' && window.__oswynShowCompressed === true);
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
        if (isReplyFenceBlock(block)) foldBlock(block, showExpanded);
        else markHidden(block);
      }
      // 2) Standalone pre blocks NOT enclosed in a standard code-block container.
      // If a pre/code is already inside .md-code-block or [class*="code-block"], it was
      // already evaluated by step 1. Never re-evaluate children to overturn step 1!
      var pres = document.querySelectorAll('pre');
      for (var p = 0; p < pres.length; p++) {
        var pre = pres[p];
        if (pre.closest && pre.closest('.md-code-block, .code-block, [class*="code-block"]')) continue;
        if (rescueMergedResultFence(pre)) continue;
        if (!isOswynBlock(pre)) {
          unmarkBlock(pre);
          continue;
        }
        if (isReplyFenceBlock(pre)) foldBlock(pre, showExpanded);
        else markHidden(pre);
      }
      // 3) Clean up any orphaned or stale `.dsh-oswyn-fold-chip` elements left behind
      // when React unmounts/reuses a block or when a message has no reply summary.
      try {
        var chips = document.querySelectorAll('.' + FOLD_CHIP_CLASS);
        for (var c = 0; c < chips.length; c++) {
          var chip = chips[c];
          var target = chip.nextElementSibling;
          if (!target || !target.getAttribute || target.getAttribute('data-oswyn-folded') !== '1' || !isOswynBlock(target) || !isReplyFenceBlock(target)) {
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
        '.dsh-oswyn-reply-summary-hidden { display: none !important; }',
        '.dsh-oswyn-fold-chip { display: inline-flex; align-items: center; gap: 4px; margin: 2px 0; padding: 1px 8px; height: 20px; border-radius: 5px; font-size: 11px; line-height: 1; cursor: pointer; color: var(--dsw-alias-label-secondary, #8a8a8a); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); border: 1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.22)); white-space: nowrap; }',
        '.dsh-oswyn-fold-chip:hover { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.14)); }',
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
        '.' + BADGE_CLASS + '[data-tone="agent"] { color: #7c93a8; }',
        '.' + BADGE_CLASS + '[data-tone="auto"] { color: #b08a68; }',
        '.' + BADGE_CLASS + '[data-mode="discard"] { opacity: 0.85; }',
        '.' + BADGE_CLASS + ' [data-dsh-oswyn-cap] { opacity: 0.75; }',
        '.dsh-oswyn-inline-panel {',
        '  position: fixed;',
        '  z-index: 9999;',
        '  width: 360px;',
        '  max-width: calc(100vw - 32px);',
        '  max-height: calc(100vh - 24px);',
        '  overflow-y: auto;',
        '  box-sizing: border-box;',
        '  padding: 12px 14px;',
        '  border-radius: 8px;',
        '  background: #23262d;',
        '  border: 1px solid rgba(255,255,255,0.14);',
        '  box-shadow: 0 8px 24px rgba(0,0,0,0.35);',
        '  font-size: 12px;',
        '  line-height: 1.55;',
        '  color: #e8eaed;',
        '  white-space: normal;',
        '  text-align: left;',
        '  cursor: default;',
        '  font-weight: 400;',
        '}',
        '.dsh-oswyn-inline-panel [data-dsh-oswyn-k] { color: #9aa0a6; display: block; font-size: 10px; }',
        '.dsh-oswyn-inline-panel [data-dsh-oswyn-v] { color: #f1f3f4; display: block; white-space: normal; word-break: break-word; font-weight: 500; }'
      ].join('\n');
      (document.head || document.documentElement).appendChild(styleEl);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Timeline Projection Patch: clean pure dsh-result-summary machine fences
    // from assistant-step reply blocks so DSH natively merges consecutive tool calls
    // into a single unified "运行了代码和命令" ProcessGroup.
    // ─────────────────────────────────────────────────────────────────────────
    function isPureResultSummaryText(text) {
      if (!text || typeof text !== 'string') return false;
      var t = text.trim();
      if (!t) return false;
      var stripped = t.replace(/```(?:dsh-result-summary\b[^\n]*\n[\s\S]*?```|dsh-result-summary\b[\s\S]*?$)/gi, '').trim();
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
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (b && (b.kind === 'tool-call' || b.type === 'tool-call' || b.callId)) {
          hasToolCall = true;
          break;
        }
      }
      if (!hasToolCall) return blocks;

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
        if (rawText.indexOf('dsh-result-summary') >= 0 || (typeof hasResultDirectivePrefix === 'function' && hasResultDirectivePrefix(rawText))) {
          if (isPureResultSummaryText(rawText)) {
            changed = true;
            continue;
          }
          var strippedText = rawText.replace(/```(?:dsh-result-summary\b[^\n]*\n[\s\S]*?```|dsh-result-summary\b[\s\S]*?$)/gi, '').trim();
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

    exports.name = 'dsh-oswyn';
    // `slots` is required for the in-conversation decorators. `configForms` is
    // OPTIONAL: treating it as a hard inject made the whole client half wait
    // forever when the settings form service was not ready, which disabled both
    // fence folding and compression badges. Resolve it lazily instead.
    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      try { document.documentElement.setAttribute('data-oswyn-client-applied', '1'); } catch (_) {}

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

        } finally {
          applying = false;
        }
      }

      function pullConfig() {
        if (typeof fetch !== 'function') return;
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
                  knownSummaries = summaries;
                  knownToolSummaries = toolSummaries;
                  knownReplySummaries = replySummaries;
                  replyStatsBySummary = replyStats;
                }
                var gs = data && data.globalStats;
                if (gs && typeof gs.totalTokensSaved === 'number') {
                  lastTotals = {
                    tokensSaved: gs.totalTokensSaved,
                    events: (gs.totalTruncations || 0) + (gs.totalReplacements || 0) + (gs.totalDiscards || 0) + (gs.totalPruneCalls || 0) + (gs.totalReplySummaries || 0)
                  };
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
                // Reply-summary folding: fold (default) vs default-expanded.
                if (typeof data.config.foldReplySummary === 'boolean') {
                  hideSetting = data.config.foldReplySummary; // reuse: enables the fold pass
                  try { localStorage.setItem('dsh-oswyn:hideReplySummaryInUi', String(hideSetting)); } catch (_) {}
                }
                if (typeof data.config.showCompressedReply === 'boolean') {
                  window.__oswynShowCompressed = data.config.showCompressedReply === true;
                }
              }
              schedule();
              setTimeout(sync, 100);
              setTimeout(sync, 400);
            })
            .catch(function () { schedule(); });
        } catch (_) { schedule(); }
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
            if (!hideSetting && !badgeSetting) return;
            for (var m = 0; m < mutations.length; m++) {
              var t = mutations[m].target;
              if (t && t.closest && t.closest('.' + BADGE_CLASS + ', .' + PANEL_CLASS + ', .' + GROUP_HINT_CLASS + ', .' + FOLD_CHIP_CLASS + ', .dsh-oswyn-reply-summary-hidden')) continue;
              schedule();
              return;
            }
          });
          observer.observe(root, { childList: true, subtree: true });
        }
        return function () {
          if (observer) observer.disconnect();
          if (pullTimer) clearInterval(pullTimer);
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
              if (typeof cfg.badgeEnabled === 'boolean') {
                badgeSetting = cfg.badgeEnabled;
                try { localStorage.setItem('dsh-oswyn:badgeEnabled', String(badgeSetting)); } catch (_) {}
              }
              schedule();
            });

            var unregSettings = slots.inject('settings.section', function () {
              return slots.register({ name: 'settings.section', id: 'oswyn', label: 'OSWYN 上下文精炼', order: 25 }, function () {
                return el('div', { style: { padding: '16px 20px', maxWidth: '1080px', margin: '0 auto' } }, el(ContextDistillCard, { form: store }));
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