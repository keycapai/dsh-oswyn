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
