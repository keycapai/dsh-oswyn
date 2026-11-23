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
    function isPureResultSummaryText(text) {
      if (!text || typeof text !== 'string') return false;
      var t = text.trim();
      if (!t) return false;
      var stripped = t.replace(/```(?:(?:dsh-)?result-summary\b[^\n]*\n[\s\S]*?```|(?:dsh-)?result-summary\b[\s\S]*?$)/gi, '').trim();
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
        if (rawText.indexOf('result-summary') >= 0 || rawText.indexOf('dsh-result-summary') >= 0 || (typeof hasResultDirectivePrefix === 'function' && hasResultDirectivePrefix(rawText))) {
          if (isPureResultSummaryText(rawText)) {
            changed = true;
            continue;
          }
          var strippedText = rawText.replace(/```(?:(?:dsh-)?result-summary\b[^\n]*\n[\s\S]*?```|(?:dsh-)?result-summary\b[\s\S]*?$)/gi, '').trim();
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
            if (!elNode || !elNode.textContent) continue;
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
              if (isUserFlowNode(directBtns[di])) continue;
              var dRow = directBtns[di].parentNode;
              if (!dRow || seenTargetRows.indexOf(dRow) >= 0) continue;
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

      function renderContextChip() {
        try {
          if (typeof document === 'undefined') return;
          if (hideSetting) { ensureStyles(); hideReplySummaryBlocks(); }
          renderTurnTailFallback();
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
          // React can leave our node under a detached subtree (parentNode still set).
          // document.contains is the reliable "is it actually on screen" check.
          if (!document.contains(ctxChip)) {
            host.root.parentNode.insertBefore(ctxChip, host.root.nextSibling);
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
            // The host stats dialog is React-rendered on click; reinject our rows
            // into it whenever it appears. Ignore mutations caused by our own rows,
            // otherwise remove+append would retrigger this observer forever.
            var selfChange = false;
            for (var sk = 0; sk < mutations.length; sk++) {
              var sn = mutations[sk].target;
              if (sn && sn.closest && sn.closest('[data-oswyn-detail]')) selfChange = true;
            }
            if (!hideSetting && !badgeSetting) return;
            for (var m = 0; m < mutations.length; m++) {
              var t = mutations[m].target;
              if (t && t.closest && t.closest('.' + BADGE_CLASS + ', .' + PANEL_CLASS + ', .' + GROUP_HINT_CLASS + ', .' + FOLD_CHIP_CLASS + ', .dsh-oswyn-deep-turn-chip, .dsh-oswyn-turn-pill, .dsh-oswyn-reply-summary-hidden, .dsh-oswyn-reply-popover, [data-oswyn-reply-fallback-wrap], [data-oswyn-deep-turn-wrap]')) continue;
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
