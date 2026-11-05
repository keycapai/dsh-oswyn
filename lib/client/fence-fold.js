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
