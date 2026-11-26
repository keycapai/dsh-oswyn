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
