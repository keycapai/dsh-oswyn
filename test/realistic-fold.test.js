import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    const self = this;
    this.classList = {
      contains: (c) => self._cls.has(c),
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
      has: (c) => self._cls.has(c)
    };
    this._text = '';
    this._listeners = {};
    this.style = {
      display: '',
      _p: {},
      setProperty(k, v) { this._p[k] = v; if (k === 'display') this.display = v; },
      removeProperty(k) { delete this._p[k]; if (k === 'display') this.display = ''; },
      getPropertyValue(k) { return this._p[k] || ''; }
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(n, ref) { n.parentNode = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); } }
  get nextElementSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; }
  get nextSibling() { return this.nextElementSibling; }
  get parentElement() { return this.parentNode; }
  get textContent() { let t = this._text; for (const c of this.children) t += c.textContent; return t; }
  set textContent(v) { this._text = String(v); this.children = []; }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  querySelectorAll(sel) { const out = []; walkAll(this, (n) => { if (n !== this && matchSel(n, sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; }
}
function walkAll(n, cb) { for (const c of n.children) { cb(c); walkAll(c, cb); } }
const SIMPLE = /(^[a-zA-Z0-9]+)|(\[[^\]]+\])|(\.[a-zA-Z0-9_-]+)/g;
function matchSimple(n, compound) {
  const parts = compound.match(SIMPLE) || [];
  if (!parts.length) return false;
  for (const p of parts) {
    if (p[0] === '[') {
      const body = p.slice(1, -1);
      const eq = body.indexOf('=');
      const k = eq < 0 ? body : body.slice(0, eq);
      const v = eq < 0 ? null : body.slice(eq + 1).replace(/^[\"\']|[\"\']$/g, '');
      if (!(k in n.attrs)) return false;
      if (v !== null && n.attrs[k] !== v) return false;
    } else if (p[0] === '.') {
      if (!n._cls.has(p.slice(1))) return false;
    } else {
      if (n.tagName !== p.toUpperCase()) return false;
    }
  }
  return true;
}
function matchSel(n, sel) {
  for (const g of sel.split(',').map((s) => s.trim())) {
    if (/\s|>|:/.test(g)) {
      const toks = g.replace(/>/g, ' ').split(/\s+/).filter(Boolean);
      const last = toks[toks.length - 1];
      if (last === '*') return true;
      if (matchSimple(n, last)) return true;
    } else if (matchSimple(n, g)) return true;
  }
  return false;
}

function makeDoc() {
  const doc = {
    head: new El('head'), body: new El('body'), documentElement: new El('html'),
    createElement(t) { return new El(t); },
    getElementById(id) { let f = null; walkAll(this.documentElement, (n) => { if (!f && n.attrs.id === id) f = n; }); return f; },
    querySelector(sel) { let f = null; walkAll(this.body, (n) => { if (!f && matchSel(n, sel)) f = n; }); return f; },
    querySelectorAll(sel) { const o = []; walkAll(this.body, (n) => { if (matchSel(n, sel)) o.push(n); }); return o; }
  };
  return doc;
}

function loadClient(doc) {
  const win = { __ModuleLoader__: { load(e) { win._entry = e; } }, requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  const sandbox = {
    window: win, document: doc,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: { hideReplySummaryInUi: true }, sessions: [] }) }),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  vm.runInContext(src, sandbox);
  const req = createRequire(path.join(__dirname, 'x.js'));
  const fakeRequire = (id) => (id === 'react' ? req('react') : {});
  return win._entry.factory(fakeRequire);
}

test('Realistic Assistant Message: user prose stays visible while only the fence is folded', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  // Realistic assistant message structure from AssistantMarkdown.tsx:
  // div.body -> MarkdownText -> p (prose) + div.md-code-block (with banner and infostring)
  const msgBody = new El('div'); msgBody._cls.add('body');
  const prose = new El('p'); prose._cls.add('prose');
  prose._text = 'Here is the user visible detailed reply that must NOT be folded.';
  msgBody.appendChild(prose);

  const codeBlock = new El('div'); codeBlock._cls.add('md-code-block');
  const bannerWrap = new El('div'); bannerWrap._cls.add('bannerWrap');
  const banner = new El('div'); banner._cls.add('banner');
  const info = new El('div'); info._cls.add('infostring'); info._text = 'dsh-reply-summary';
  banner.appendChild(info);
  bannerWrap.appendChild(banner);
  codeBlock.appendChild(bannerWrap);

  const pre = new El('pre'); pre._cls.add('shiki');
  const code = new El('code');
  code._text = '- DENSE DECISION-COMPLETE MEMO: line 12\n- STATUS: ok';
  pre.appendChild(code);
  codeBlock.appendChild(pre);

  msgBody.appendChild(codeBlock);
  doc.body.appendChild(msgBody);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  // Check if prose or msgBody was folded:
  assert.equal(msgBody.getAttribute('data-oswyn-folded'), null, 'msgBody must NOT be folded');
  assert.notEqual(msgBody.style.display, 'none', 'msgBody must be visible');
  assert.equal(prose.getAttribute('data-oswyn-folded'), null, 'prose must NOT be folded');
  assert.notEqual(prose.style.display, 'none', 'prose must be visible');

  // The codeBlock must be folded:
  assert.equal(codeBlock.getAttribute('data-oswyn-folded'), '1', 'codeBlock should be folded');
});

test('Ordinary code blocks mentioning [oswyn-meta: ...] or code examples are NEVER folded', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  // A code block with json language containing [oswyn-meta: ...] example
  const block1 = new El('div'); block1._cls.add('md-code-block');
  const banner1 = new El('div'); banner1._cls.add('banner');
  const info1 = new El('div'); info1._cls.add('infostring'); info1._text = 'json';
  banner1.appendChild(info1); block1.appendChild(banner1);
  const pre1 = new El('pre'); const code1 = new El('code');
  code1._text = '{"marker": "[oswyn-meta: before=12909 after=2129 keep=1990 mode=truncate seq=42]"}';
  pre1.appendChild(code1); block1.appendChild(pre1);
  doc.body.appendChild(block1);

  // Another code block with bash language
  const block2 = new El('div'); block2._cls.add('md-code-block');
  const banner2 = new El('div'); banner2._cls.add('banner');
  const info2 = new El('div'); info2._cls.add('infostring'); info2._text = 'bash';
  banner2.appendChild(info2); block2.appendChild(banner2);
  const pre2 = new El('pre'); const code2 = new El('code');
  code2._text = 'echo "[oswyn-meta: before=100 after=50 keep=0 mode=replace seq=1]"';
  pre2.appendChild(code2); block2.appendChild(pre2);
  doc.body.appendChild(block2);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(block1.getAttribute('data-oswyn-folded'), null, 'json code block must not be folded');
  assert.notEqual(block1.style.display, 'none', 'json code block must be visible');
  assert.equal(block2.getAttribute('data-oswyn-folded'), null, 'bash code block must not be folded');
  assert.notEqual(block2.style.display, 'none', 'bash code block must be visible');
});

test('Real DSH CodeToolbar ("代码块" header): hides tool fences; folds Chinese dsh-reply-summary even when banner text prefixes el.textContent', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  // 1) Real DSH CodeBlock with CodeToolbar where unsupported lang "dsh-result-summary"
  // renders as <span class="language">代码块</span><button>复制</button>
  const resultFence = new El('div'); resultFence._cls.add('md-code-block');
  const bw1 = new El('div'); bw1._cls.add('bannerWrap');
  const hdr1 = new El('div'); hdr1.setAttribute('data-code-block-banner', 'true');
  const lang1 = new El('span'); lang1._cls.add('language'); lang1._text = '代码块';
  const copy1 = new El('button'); copy1._text = '复制';
  hdr1.appendChild(lang1); hdr1.appendChild(copy1); bw1.appendChild(hdr1);
  resultFence.appendChild(bw1);
  const content1 = new El('div'); content1.setAttribute('data-code-block-content', 'true');
  const pre1 = new El('pre'); const code1 = new El('code');
  code1._text = 'replace\n- 已读取并确认模块逻辑，无需修改';
  pre1.appendChild(code1); content1.appendChild(pre1); resultFence.appendChild(content1);
  doc.body.appendChild(resultFence);

  // 2) Real DSH CodeBlock with CodeToolbar where unsupported lang "dsh-reply-summary"
  // renders as "代码块" and uses Chinese summary bullets (no English DENSE MEMO keyword)
  const replyFence = new El('div'); replyFence._cls.add('md-code-block');
  const bw2 = new El('div'); bw2._cls.add('bannerWrap');
  const hdr2 = new El('div'); hdr2.setAttribute('data-code-block-banner', 'true');
  const lang2 = new El('span'); lang2._cls.add('language'); lang2._text = '代码块';
  hdr2.appendChild(lang2); bw2.appendChild(hdr2);
  replyFence.appendChild(bw2);
  const content2 = new El('div'); content2.setAttribute('data-code-block-content', 'true');
  const pre2 = new El('pre'); const code2 = new El('code');
  code2._text = '- 改动文件：lib/client.js 与 lib/session/applier.js\n- 验证：单元测试全部通过\n- 待办：无';
  pre2.appendChild(code2); content2.appendChild(pre2); replyFence.appendChild(content2);
  doc.body.appendChild(replyFence);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(resultFence.getAttribute('data-oswyn-folded'), null, 'tool-result fence must NOT become a 已压缩 chip');
  assert.equal(resultFence.style.display, 'none', 'tool-result fence is hidden entirely');
  assert.ok(!resultFence.previousElementSibling || !resultFence.previousElementSibling._cls.has('dsh-oswyn-fold-chip'), 'no chip is inserted before a tool-result fence');
  assert.equal(replyFence.getAttribute('data-oswyn-folded'), '1', 'Chinese dsh-reply-summary with 代码块 banner must be folded');
  assert.equal(replyFence.style.display, 'none', 'Chinese dsh-reply-summary hidden by default');
});

test('Real DSH CodeToolbar ("代码块" header): folds free-form key-detail dsh-reply-summary (without OPEN ITEMS or DENSE MEMO boilerplate)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  const replyFence = new El('div'); replyFence._cls.add('md-code-block');
  const bw = new El('div'); bw._cls.add('bannerWrap');
  const hdr = new El('div'); hdr.setAttribute('data-code-block-banner', 'true');
  const lang = new El('span'); lang._cls.add('language'); lang._text = '代码块';
  hdr.appendChild(lang); bw.appendChild(hdr);
  replyFence.appendChild(bw);
  const content = new El('div'); content.setAttribute('data-code-block-content', 'true');
  const pre = new El('pre'); const code = new El('code');
  code._text = '- 关键结论：优化了 lib/protocol.js:92-104 的双轨回复提示词，移除死板三段式与强制 OPEN ITEMS\n- 核心细节：保留文件行号、根因分析、关键配置参数等高价值信息，支持自由结构化备忘';
  pre.appendChild(code); content.appendChild(pre); replyFence.appendChild(content);
  doc.body.appendChild(replyFence);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(replyFence.getAttribute('data-oswyn-folded'), '1', 'Free-form key-detail dsh-reply-summary with 代码块 banner must be folded');
  assert.equal(replyFence.style.display, 'none', 'Free-form dsh-reply-summary hidden by default');
});

test('Real DSH CodeToolbar ("代码块"): hides `discard entire-ptc`, 1-line `truncate keep 8 lines`, `seq 1\\nprotect`, and blockquote `> discard` without fold chips', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  function mkCodeBlock(bodyText) {
    const blk = new El('div'); blk._cls.add('md-code-block');
    const bw = new El('div'); bw._cls.add('bannerWrap');
    const hdr = new El('div'); hdr.setAttribute('data-code-block-banner', 'true');
    const lang = new El('span'); lang._cls.add('language'); lang._text = '代码块';
    const copy = new El('button'); copy._text = '复制';
    hdr.appendChild(lang); hdr.appendChild(copy); bw.appendChild(hdr);
    blk.appendChild(bw);
    const content = new El('div'); content.setAttribute('data-code-block-content', 'true');
    const pre = new El('pre'); const code = new El('code');
    code._text = bodyText;
    pre.appendChild(code); content.appendChild(pre); blk.appendChild(content);
    return blk;
  }

  const bDiscardEntirePtc = mkCodeBlock('discard entire-ptc\n- Failed due to returning raw fs.Stats object (non-lossless JSON).');
  const bOneLineTruncate = mkCodeBlock('truncate keep 8 lines');
  const bSeqProtect = mkCodeBlock('seq 1\nprotect\n- First turn has no prior tool result');
  const bBlockquoteDiscard = mkCodeBlock('> discard\n> - Failed subcall');
  const bResultMentioningReplyTag = mkCodeBlock('replace\n- 已验证 dsh-reply-summary 折叠逻辑正常');

  doc.body.appendChild(bDiscardEntirePtc);
  doc.body.appendChild(bOneLineTruncate);
  doc.body.appendChild(bSeqProtect);
  doc.body.appendChild(bBlockquoteDiscard);
  doc.body.appendChild(bResultMentioningReplyTag);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  for (const [name, blk] of [
    ['discard entire-ptc', bDiscardEntirePtc],
    ['1-line truncate keep 8 lines', bOneLineTruncate],
    ['seq 1 protect', bSeqProtect],
    ['blockquote > discard', bBlockquoteDiscard],
    ['result summary mentioning dsh-reply-summary', bResultMentioningReplyTag]
  ]) {
    assert.equal(blk.style.display, 'none', `${name} must be hidden`);
    assert.equal(blk.getAttribute('data-oswyn-folded'), null, `${name} must NOT be marked folded`);
  }
  assert.equal(doc.querySelectorAll('.dsh-oswyn-fold-chip').length, 0, 'zero fold chips for tool-result directive fences');
});

test('No false-positive fold chip when there is no reply summary (tool summary with Chinese bullets + orphaned chip cleanup)', async () => {
  const doc = makeDoc();
  const win = { __ModuleLoader__: { load(e) { win._entry = e; } }, requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  const toolSummaryText = '- 真实执行 run_code → bash("seq 1 200")，exit 0，200 行输出\n- 已用 truncate keep 12 lines 压缩：692 → 177 chars';
  const sandbox = {
    window: win, document: doc,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        config: { hideReplySummaryInUi: true },
        sessions: [{
          sessionId: 's1',
          history: [
            { seq: 81, mode: 'replace', toolName: 'run_code', summary: toolSummaryText, before: 692, after: 177 }
          ]
        }]
      })
    }),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  vm.runInContext(src, sandbox);
  const req = createRequire(path.join(__dirname, 'x.js'));
  const mod = win._entry.factory((id) => (id === 'react' ? req('react') : {}));

  // 1) A bare dsh-result-summary (no directive word on line 1, recorded in ledger as mode='replace')
  const toolFence = new El('div'); toolFence._cls.add('md-code-block');
  const hdr = new El('div'); hdr.setAttribute('data-code-block-banner', 'true');
  const lang = new El('span'); lang._cls.add('language'); lang._text = '代码块';
  hdr.appendChild(lang); toolFence.appendChild(hdr);
  const pre = new El('pre'); const code = new El('code');
  code._text = toolSummaryText;
  pre.appendChild(code); toolFence.appendChild(pre);
  doc.body.appendChild(toolFence);

  // 2) An orphaned .dsh-oswyn-fold-chip left behind in a message with no reply summary
  const orphanChip = new El('button');
  orphanChip._cls.add('dsh-oswyn-fold-chip');
  orphanChip._text = '已压缩 · 点击展开';
  const normalProse = new El('p');
  normalProse._text = 'Normal reply without reply summary';
  doc.body.appendChild(orphanChip);
  doc.body.appendChild(normalProse);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(toolFence.style.display, 'none', 'bare tool summary from ledger must be hidden');
  assert.equal(toolFence.getAttribute('data-oswyn-folded'), null, 'bare tool summary must NOT be folded as reply');
  assert.equal(doc.querySelectorAll('.dsh-oswyn-fold-chip').length, 0, 'orphaned fold chip and false-positive chip must be completely absent');
});

test('Merged fence rescue (session-e4e2da40 seq=610): splits glued `discard entire-ptc` + prose + `dsh-ui` so prose and UI both render', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  const merged = new El('div'); merged._cls.add('md-code-block');
  const bw = new El('div'); bw._cls.add('bannerWrap');
  const hdr = new El('div'); hdr.setAttribute('data-code-block-banner', 'true');
  const lang = new El('span'); lang._cls.add('language'); lang._text = '代码块';
  hdr.appendChild(lang); bw.appendChild(hdr); merged.appendChild(bw);
  const content = new El('div'); content.setAttribute('data-code-block-content', 'true');
  const pre = new El('pre'); const code = new El('code');
  const uiSpecJson = '{"title":"插件更新插件（dsh-plugin-updater）底部更新提示修复报告","gap":12,"items":[]}';
  code._text = [
    'discard entire-ptc',
    '- Validated `dsh-ui` spec (6 nodes, status=valid).',
    '```已定位并修复插件更新插件（`dsh-plugin-updater`）左下角底部更新提示消失的问题。',
    '',
    '### 原因分析',
    '1. **React Hook 顺序违规**：原代码在提前返回之后调用了 Hook。',
    '',
    '```dsh-ui',
    uiSpecJson
  ].join('\n');
  pre.appendChild(code); content.appendChild(pre); merged.appendChild(content);
  doc.body.appendChild(merged);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  const rescuedProse = doc.querySelector('.dsh-oswyn-rescued-prose');
  assert.ok(rescuedProse, 'rescued prose container must be inserted before the block');
  assert.match(rescuedProse.textContent, /已定位并修复插件更新插件/);
  assert.match(rescuedProse.textContent, /原因分析/);
  assert.ok(!rescuedProse.textContent.includes('discard entire-ptc'), 'directive text must not leak into rescued prose');

  assert.notEqual(merged.style.display, 'none', 'merged block must remain visible so dsh-genui can render the UI card');
  assert.equal(merged.getAttribute('data-oswyn-rescued-ui'), '1');
  assert.equal(lang.textContent, 'dsh-ui', 'banner language restored to dsh-ui for dsh-genui');
  assert.equal(code.textContent, uiSpecJson, 'code body stripped down to pure dsh-ui JSON');
});

