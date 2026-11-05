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

    exports.name = 'dsh-oswyn';
    // `slots` is required for the in-conversation decorators. `configForms` is
    // OPTIONAL: treating it as a hard inject made the whole client half wait
    // forever when the settings form service was not ready, which disabled both
    // fence folding and compression badges. Resolve it lazily instead.
    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      try { document.documentElement.setAttribute('data-oswyn-client-applied', '1'); } catch (_) {}
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
      pullConfig();
      var pullTimer = setInterval(function () {
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
