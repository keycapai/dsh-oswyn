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
                { type: 'number', field: 'cacheTtlHours', title: '服务端 KV-Cache 空闲超时阈值', desc: '两轮会话之间超过该空闲时长判定为缓存已失效（默认 24 小时）。', value: cfg.cacheTtlHours ?? 24, min: 1, step: 1, unit: '小时' },
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

