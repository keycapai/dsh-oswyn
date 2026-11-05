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

      var switchRow = function (title, desc, field, checked) {
        return el('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.04))', gap: '16px' }
        },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 } },
            el('div', { style: { fontWeight: 600, fontSize: '13px' } }, title),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, desc)
          ),
          el('div', { style: { flexShrink: 0 } },
            el(SwitchComp, { checked: checked, disabled: disabled, onChange: function (val) { setField(field, val); } })
          )
        );
      };

      // Numeric setting row for compression / nudge thresholds.
      var numberRow = function (title, desc, field, value, min, step) {
        return el('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.04))', gap: '16px' }
        },
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 } },
            el('div', { style: { fontWeight: 600, fontSize: '13px' } }, title),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, desc)
          ),
          el('input', {
            type: 'number',
            value: Number.isFinite(Number(value)) ? Number(value) : 0,
            min: min,
            step: step || 1,
            disabled: disabled,
            style: { width: '110px', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', fontSize: '12px', textAlign: 'right' },
            onChange: function (e) {
              var n = Number(e.target.value);
              if (Number.isFinite(n)) setField(field, n);
            }
          })
        );
      };

      // Comma-separated tool-name list editor (supports trailing-* wildcards).
      var textListRow = function (title, desc, field, list) {
        var value = Array.isArray(list) ? list.join(', ') : '';
        return el('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.18))', background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.04))' }
        },
          el('div', { style: { fontWeight: 600, fontSize: '13px' } }, title),
          el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)' } }, desc),
          el('input', {
            type: 'text',
            defaultValue: value,
            disabled: disabled,
            style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.3))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', fontSize: '12px' },
            onChange: function (e) {
              var arr = String(e.target.value || '').split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
              setField(field, arr);
            }
          })
        );
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
        activeTab === 'config' ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          el('div', { style: { fontWeight: 600, fontSize: '13px', color: 'var(--dsw-alias-text-accent, #3b82f6)' } }, '压缩与提示阈值'),
          numberRow('自动压缩字符阈值 (autoCompressMinChars)', '输出超过此字符数才触发自动压缩；默认 4000，代码有效下限 200。', 'autoCompressMinChars', cfg.autoCompressMinChars, 200, 100),
          numberRow('自动压缩保留行数 (autoCompressKeepLines)', '自动截断时从第 0 行原样保留的行数；默认 30。', 'autoCompressKeepLines', cfg.autoCompressKeepLines, 1, 1),
          numberRow('常规提示字符阈值 (nudgeThresholdChars)', '工具输出超过此字符数时注入精炼提示；默认 600。', 'nudgeThresholdChars', cfg.nudgeThresholdChars, 0, 50),
          numberRow('常规提示行数阈值 (nudgeThresholdLines)', '工具输出超过此行数时注入精炼提示；默认 18。', 'nudgeThresholdLines', cfg.nudgeThresholdLines, 1, 1),
          numberRow('失败提示字符阈值 (nudgeErrorThresholdChars)', '失败调用专属提示字符阈值；默认 400。', 'nudgeErrorThresholdChars', cfg.nudgeErrorThresholdChars, 0, 50),
          numberRow('失败提示行数阈值 (nudgeErrorThresholdLines)', '失败调用专属提示行数阈值；默认 12。', 'nudgeErrorThresholdLines', cfg.nudgeErrorThresholdLines, 1, 1),
          switchRow('行内压缩附件显示 (badgeEnabled)', '开启后，已压缩的工具行末尾显示一个可展开的「压缩」小附件（点击查看工具、前后大小、节省量、摘要与处理方式）；可随时关闭保持界面纯净。', 'badgeEnabled', cfg.badgeEnabled !== false),
          switchRow('助手回复双轨投影 (replySummaryEnabled)', '允许模型将长篇回复提炼为仅供未来轮次自身可见的紧凑备忘，用户端保留完整视图。', 'replySummaryEnabled', cfg.replySummaryEnabled !== false),
          switchRow('回复精炼围栏折叠为「已压缩」条 (foldReplySummary)', '开启后，对话中用于下轮模型的 dsh-reply-summary 备忘围栏会折叠成一条「已压缩 · 点击展开」小条，而不是直接消失。', 'foldReplySummary', cfg.foldReplySummary !== false),
          switchRow('默认展开已压缩回复 (showCompressedReply)', '开启后，「已压缩」条默认展开显示被压缩的原文块；关闭则默认折叠，点击可展开。', 'showCompressedReply', cfg.showCompressedReply === true),
          switchRow('单步工具压力感知提示 (nudgeEnabled)', '当上一步工具返回体积过大时，在下一步执行前自动注入轻量截断指引，提高 Agent 主动截断的频率。', 'nudgeEnabled', cfg.nudgeEnabled !== false),
          switchRow('分级自动兜底 (autoCompressTiered)', '保护名单之外的工具都会自动兜底；run_code/read/write/edit 等永远不压缩。', 'autoCompressTiered', cfg.autoCompressTiered !== false),
          switchRow('PTC 子调用自动压缩 (autoCompressPtcSubcalls)', 'run_code 一次调用多个工具时，按子调用生成结构化摘要并替换外层结果；run_code 本身仍不进入普通自动压缩。', 'autoCompressPtcSubcalls', cfg.autoCompressPtcSubcalls !== false),
          switchRow('失败调用自动丢弃 (autoDiscardFailed)', '退出码非 0、异常堆栈等失败输出在下一步自动整段丢弃，仅保留失败结论。', 'autoDiscardFailed', cfg.autoDiscardFailed !== false),
          textListRow('始终丢弃工具名单 (autoDiscardTools)', '此名单中的工具无论输出长度都会自动丢弃；默认包含 validate_dsh_ui，可在设置页移除或添加其他工具，支持逗号分隔与末尾 * 通配符。', 'autoDiscardTools', cfg.autoDiscardTools),
          textListRow('重要不可压缩保护名单 (autoCompressTieredProtectedTools)', '此列表中的工具永远不会被自动压缩，其余工具都会自动压缩（run_code 永远排除）；支持逗号分隔与末尾通配符。', 'autoCompressTieredProtectedTools', cfg.autoCompressTieredProtectedTools),
          el('div', { style: { padding: '14px 16px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-subtle, rgba(128,128,128,0.15))', background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.02))', display: 'flex', flexDirection: 'column', gap: '8px' } },
            el('div', { style: { fontWeight: 600, fontSize: '12px', color: 'var(--dsw-alias-accent, #007acc)' } }, 'Agent-First 自主决策机制'),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 零额外轮次：模型在执行当前步骤或回复时同步判定上一步工具输出，无需专门多耗思考步骤。'),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 意图由模型自主决定：何时截断、保留前多少行完全按上下文价值动态决定。'),
            el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-text-secondary, #888)', lineHeight: 1.6 } }, '· 全量重要绝不压缩：输出整体具备价值时 100% 字节原样保留，保障 KV Cache 命中与推理精度。')
          )
        ) : null
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

