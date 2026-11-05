import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BADGE = 'dsh-oswyn-inline-badge';

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parentNode = null; this._cls = new Set(); const self = this; this.classList = { contains: (c) => self._cls.has(c), add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c), has: (c) => self._cls.has(c) }; this._text = ''; this._listeners = {}; this.style = { display: '', _p: {}, setProperty(k, v) { this._p[k] = v; if (k === 'display') this.display = v; }, removeProperty(k) { delete this._p[k]; if (k === 'display') this.display = ''; }, getPropertyValue(k) { return this._p[k] || ''; } }; }
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
  set innerHTML(_v) {}
  set innerText(v) { this._text = String(v); }
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
    if (p[0] === '[') { const body = p.slice(1, -1); const eq = body.indexOf('='); const k = eq < 0 ? body : body.slice(0, eq); const v = eq < 0 ? null : body.slice(eq + 1).replace(/^["']|["']$/g, ''); if (!(k in n.attrs)) return false; if (v !== null && n.attrs[k] !== v) return false; }
    else if (p[0] === '.') { if (!n._cls.has(p.slice(1))) return false; }
    else { if (n.tagName !== p.toUpperCase()) return false; }
  }
  return true;
}
function matchSel(n, sel) {
  for (const g of sel.split(',').map((s) => s.trim())) {
    if (/\s|>|:/.test(g)) {
      const toks = g.replace(/>/g, ' ').split(/\s+/).filter(Boolean);
      const last = toks[toks.length - 1];
      if (last.includes(':has')) { const m = last.match(/:has\(([^)]*)\)/); if (m && n.querySelectorAll(m[1]).length) return true; continue; }
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
    getElementById(id) { let f = null; walkAll(this.documentElement, (n) => { if (!f && n.attrs.id === id) f = n; }); walkAll(this.head, (n) => { if (!f && n.attrs.id === id) f = n; }); return f; },
    querySelector(sel) { let f = null; walkAll(this.body, (n) => { if (!f && matchSel(n, sel)) f = n; }); return f; },
    querySelectorAll(sel) { const o = []; walkAll(this.body, (n) => { if (matchSel(n, sel)) o.push(n); }); return o; }
  };
  return doc;
}

function loadClient(doc, fetchData) {
  const win = { __ModuleLoader__: { load(e) { win._entry = e; } }, requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: () => {}, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {} };
  const sandbox = {
    window: win, document: doc,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(fetchData || { ok: true, config: { hideReplySummaryInUi: true }, sessions: [] }) }),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  vm.runInContext(src, sandbox);
  const req = createRequire(path.join(__dirname, 'x.js'));
  const fakeRequire = (id) => {
    if (id === 'react') return req('react');
    if (id.includes('dsh-client-ui-primitives')) return {};
    return {};
  };
  return win._entry.factory(fakeRequire);
}

function findAll(root, cls) { const o = []; (function w(n) { for (const c of n.children) { if (c._cls.has(cls)) o.push(c); w(c); } })(root); return o; }

test('Client DOM: badges attach ONLY to leaf tool rows with REAL per-row before→after; process-group header never badged', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const group = new El('div'); group.setAttribute('data-step-process', 'true');
  const groupHeader = new El('button'); groupHeader._cls.add('grp_title'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);
  function mk(tool, before, after, keep) {
    const row = new El('div'); row.setAttribute('data-tool', tool); row.setAttribute('data-variant', 'bash'); row.setAttribute('data-state', 'done');
    const d = new El('div'); d.setAttribute('data-disclosure-row', 'true');
    const t = new El('span'); t._cls.add('Xhh_title'); t._text = tool + ' command'; d.appendChild(t); row.appendChild(d);
    const rt = new El('span'); rt._text = '[oswyn-meta: before=' + before + ' after=' + after + ' keep=' + keep + ' mode=truncate]'; row.appendChild(rt);
    return row;
  }
  const row1 = mk('run_code', 2400, 350, 5);
  const row2 = mk('glob', 100000, 200, 0);
  pbody.appendChild(row1); pbody.appendChild(row2); doc.body.appendChild(group);

  assert.equal(doc.querySelectorAll('div[data-tool]').length, 2);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 500));

  const total = findAll(doc.body, BADGE).length;
  const groupBadges = findAll(groupHeader, BADGE).length;
  const b1 = findAll(row1, BADGE).map((b) => b.textContent);
  const b2 = findAll(row2, BADGE).map((b) => b.textContent);

  assert.equal(groupBadges, 0, 'process-group header must NEVER be badged');
  assert.equal(total, 2, 'exactly one badge per leaf tool row');
  assert.match(b1[0], /2\.4K/);
  assert.match(b1[0], /350/);
  assert.match(b1[0], /-85%/);
  assert.match(b1[0], /2\.4K→350/, 'row1 compact figure 2.4K→350');
  assert.match(b2[0], /100\.0K→200/, 'row2 compact figure 100.0K→200');
  assert.match(b2[0], /-99%/, 'second row must show its own distinct ratio (no hardcoded 86%)');
  assert.ok(!/86%/.test(b1[0]) && !/86%/.test(b2[0]), 'no fake 86%');
  assert.equal(row1.querySelector('.dsh-oswyn-inline-badge').getAttribute('data-tone'), 'agent', 'marker-only badge is an agent/manual compression tone');

  // Expandable panel must exist on each badge and carry 压缩前/压缩后 detail.
  const panel1 = row1.querySelector('.dsh-oswyn-inline-panel');
  assert.ok(panel1, 'row1 badge must contain an expandable detail panel');
  const pt = panel1.textContent;
  assert.match(pt, /压缩前/, 'panel lists 压缩前');
  assert.match(pt, /压缩后/, 'panel lists 压缩后');
  assert.match(pt, /2\.4 KB|2,400/, 'panel shows real before size');
  assert.match(pt, /350/, 'panel shows real after size');
  assert.match(pt, /减少/, 'panel shows reduction');
  assert.match(pt, /工具/, 'panel shows tool identity');
  assert.match(pt, /节省/, 'panel shows saved chars/tokens');
  assert.ok(!/召回/.test(pt), 'panel must not show recall wording');
  assert.ok(row2.querySelector('.dsh-oswyn-inline-panel'), 'row2 badge also expandable');

  // No scissors / no "OSWYN 精炼" strip text anywhere in the decorated DOM.
  const allText = doc.body.textContent;
  assert.ok(!/[\u2702\u2704\u2700-\u27BF\uFE0F]/.test(allText), 'no scissor/misc-symbol emoji in DOM');
  assert.ok(!/OSWYN\s*精炼/.test(allText), 'no "OSWYN 精炼" strip text');
});

test('Client DOM: a leaf row with NO distill data shows NOTHING (never fake)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true');
  const row = new El('div'); row.setAttribute('data-tool', 'read'); row.setAttribute('data-variant', 'read'); row.setAttribute('data-state', 'done');
  const d = new El('div'); d.setAttribute('data-disclosure-row', 'true');
  const t = new El('span'); t._cls.add('Xhh_title'); t._text = 'read file'; d.appendChild(t); row.appendChild(d);
  row.appendChild(new El('span')); // no oswyn-meta, no history
  pbody.appendChild(row); doc.body.appendChild(pbody);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(findAll(row, BADGE).length, 0, 'un-distilled row must have no badge');
});


test('Client DOM: compression attachment is an expandable disclosure (panel hidden by default, aria controls)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const row = new El('div'); row.setAttribute('data-tool', 'bash'); row.setAttribute('data-variant', 'bash'); row.setAttribute('data-state', 'done');
  const d = new El('div'); d.setAttribute('data-disclosure-row', 'true');
  const t = new El('span'); t._cls.add('Xhh_title'); t._text = 'bash command'; d.appendChild(t); row.appendChild(d);
  const rt = new El('span'); rt._text = '[oswyn-meta: before=2400 after=350 keep=5 mode=truncate seq=12]'; row.appendChild(rt);
  doc.body.appendChild(row);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 450));

  const badge = row.querySelector('.dsh-oswyn-inline-badge');
  assert.ok(badge, 'leaf row decorated');
  assert.equal(findAll(row, 'dsh-oswyn-inline-badge').length, 1, 'exactly one attachment');
  const fig = badge.querySelector('[data-dsh-oswyn-fig]');
  assert.ok(fig && /2\.4K→350 -85%/.test(fig.textContent), 'figure reads real numbers incl seq marker');

  const panel = badge.querySelector('.dsh-oswyn-inline-panel');
  assert.ok(panel, 'panel exists');
  assert.equal(badge.getAttribute('aria-expanded'), 'false', 'collapsed by default');
  assert.equal(badge.getAttribute('role'), 'button', 'badge is a role=button disclosure');
  assert.equal(panel.getAttribute('aria-hidden'), 'true', 'panel aria-hidden when collapsed');
  assert.match(panel.textContent, /压缩前/, 'panel carries 压缩前 detail');
  assert.match(panel.textContent, /压缩后/, 'panel carries 压缩后 detail');
});
test('Client DOM: process-group header shows ITS OWN aggregate (本组 N 项, real tokens), not a session-wide number', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const group = new El('div'); group.setAttribute('data-step-process', 'true');
  const groupHeader = new El('button'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);
  function mk(tool, before, after) {
    const row = new El('div'); row.setAttribute('data-tool', tool); row.setAttribute('data-state', 'done');
    const d = new El('div'); d.setAttribute('data-disclosure-row', 'true');
    const t = new El('span'); t._cls.add('Xhh_title'); t._text = tool; d.appendChild(t); row.appendChild(d);
    const rt = new El('span'); rt._text = '[oswyn-meta: before=' + before + ' after=' + after + ' keep=10 mode=truncate]'; row.appendChild(rt);
    return row;
  }
  pbody.appendChild(mk('run_code', 1000, 200));
  pbody.appendChild(mk('bash', 2000, 500));
  doc.body.appendChild(group);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));
  const hint = groupHeader.querySelector('.dsh-oswyn-group-hint');
  assert.ok(hint, 'group header has an aggregate hint');
  // New header answers three questions: how many calls, how many compressed,
  // and the real before→after character totals.
  assert.match(hint.textContent, /本组 2 次调用 · 压缩 2 次/, 'shows total calls AND compressed count');
  assert.match(hint.textContent, /3,000→700 字符/, 'shows real before→after character totals');
  // sum before = 3000, after = 700 => saved 2300, pct floor(2300/3000*100)=76
  assert.match(hint.textContent, /-76%/, 'group pct from its own rows');
  assert.match(hint.textContent, /2,300|2300/, 'group saved chars from its own rows');
  assert.ok(!/5,313|5313/.test(hint.textContent), 'must NOT show a session-wide constant');
});

test('Client DOM: a leaf row with data-tool but NO marker gets NO badge (never fake via unknown history)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true');
  const row = new El('div'); row.setAttribute('data-tool', 'read'); row.setAttribute('data-state', 'done');
  const d = new El('div'); d.setAttribute('data-disclosure-row', 'true');
  const t = new El('span'); t._cls.add('Xhh_title'); t._text = 'read'; d.appendChild(t); row.appendChild(d);
  row.appendChild(new El('span'));
  pbody.appendChild(row); doc.body.appendChild(pbody);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(findAll(row, BADGE).length, 0, 'no marker + no history => no badge');
});
test('Client DOM: reply fence is FOLDED into a 已压缩 chip (not fully hidden) and chip toggles visibility', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  // A code block whose <code data-lang="dsh-reply-summary"> holds the memo.
  const wrap = new El('div'); wrap._cls.add('code-block');
  const pre = new El('pre');
  const code = new El('code'); code.setAttribute('data-lang', 'dsh-reply-summary');
  code._text = '- memo of the reply'; pre.appendChild(code); wrap.appendChild(pre);
  doc.body.appendChild(wrap);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));
  const chip = doc.querySelector('.dsh-oswyn-fold-chip');
  assert.ok(chip, 'a 已压缩 chip is inserted');
  assert.match(chip.textContent, /已压缩/, 'chip says 已压缩');
  // The block is collapsed by default (display none set via style shim recorded by class attr).
  assert.equal(wrap.getAttribute('data-oswyn-folded'), '1', 'block marked folded');
  assert.equal(wrap.getAttribute('data-oswyn-open'), '0', 'collapsed by default');
});
test('Client DOM: folded reply chip EXPANDS on click and stays expanded across a re-sync (regression)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const wrap = new El('div'); wrap._cls.add('code-block');
  const pre = new El('pre');
  const code = new El('code'); code.setAttribute('data-lang', 'dsh-reply-summary');
  code._text = '- memo'; pre.appendChild(code); wrap.appendChild(pre);
  doc.body.appendChild(wrap);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 500));
  const chip = doc.querySelector('.dsh-oswyn-fold-chip');
  assert.ok(chip, 'chip exists');
  assert.equal(wrap.style.display, 'none', 'collapsed by default');
  // Click the chip -> expand.
  (chip._listeners.click || []).forEach((fn) => fn({ stopPropagation() {} }));
  assert.equal(wrap.getAttribute('data-oswyn-open'), '1', 'open flag set after click');
  // Force another sync pass (mutation) — must NOT re-collapse.
  const chip2 = doc.querySelector('.dsh-oswyn-fold-chip');
  (chip2 && (chip2._listeners.click || [])).forEach(() => {});
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(wrap.getAttribute('data-oswyn-open'), '1', 'still open after re-sync');
  assert.notEqual(wrap.style.display, 'none', 'block visible after re-sync');
});
test('Client DOM: ordinary user-facing content is NEVER folded (no fence language)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  // (a) a normal code block starting with "replace ..." (old heuristic would fold it)
  const b1 = new El('div'); b1._cls.add('code-block');
  const c1 = new El('code'); c1.setAttribute('data-lang', 'bash'); c1._text = 'replace all foo with bar'; b1.appendChild(c1);
  doc.body.appendChild(b1);
  // (b) a normal prose paragraph
  const p = new El('div'); p._cls.add('prose'); p._text = 'Here is the explanation for you.'; doc.body.appendChild(p);
  // (c) a normal code block with no data-lang
  const b2 = new El('div'); b2._cls.add('code-block');
  const c2 = new El('code'); c2._text = 'truncate keep 20 lines'; b2.appendChild(c2);
  doc.body.appendChild(b2);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(doc.querySelectorAll('.dsh-oswyn-fold-chip').length, 0, 'no fold chip for ordinary content');
  assert.equal(b1.getAttribute('data-oswyn-folded'), null, 'prose-replace code block untouched');
  assert.equal(b2.getAttribute('data-oswyn-folded'), null, 'directive-looking code block without fence lang untouched');
  assert.notEqual(b1.style.display, 'none', 'user code block stays visible');
  assert.notEqual(b2.style.display, 'none', 'other code block stays visible');
});

test('Client DOM: real md-code-block + data-code-block-banner infostring is folded', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const wrap = new El('div'); wrap._cls.add('md-code-block');
  const banner = new El('div'); banner.setAttribute('data-code-block-banner', 'true');
  const info = new El('div'); info._cls.add('infostring'); info._text = 'dsh-reply-summary'; banner.appendChild(info);
  wrap.appendChild(banner);
  const pre = new El('pre'); const code = new El('code'); code._text = '- memo body'; pre.appendChild(code); wrap.appendChild(pre);
  doc.body.appendChild(wrap);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 500));

  assert.ok(doc.querySelector('.dsh-oswyn-fold-chip'), 'a fold chip is rendered for the real renderer structure');
  assert.equal(wrap.getAttribute('data-oswyn-folded'), '1');
  assert.equal(wrap.style.display, 'none', 'real fence block is hidden by default');
});

test('Client DOM: client activation does not hard-require configForms', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  assert.deepEqual(Array.from(mod.inject), ['slots'], 'only slots is a hard dependency');
  const ctx = { effect(fn) { return fn(); }, get() { return undefined; }, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(doc.documentElement.getAttribute('data-oswyn-client-applied'), '1', 'decorator half applies even when settings service is absent');
});

test('Client DOM: PTC run_code container row gets its own compression badge (nested subcall rows must not hide it)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);
  const group = new El('div'); group.setAttribute('data-step-process', 'true');
  const groupHeader = new El('button'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);

  // Outer PTC run_code row: owns the compressed tool result and contains the
  // inner tool calls it executed.
  const outerWrap = new El('div'); outerWrap.setAttribute('data-chat-call-id', 'call_outer');
  const outer = new El('div'); outer.setAttribute('data-tool', 'run_code'); outer.setAttribute('data-state', 'done');
  const outerHeader = new El('div'); outerHeader.setAttribute('data-disclosure-row', 'true');
  const outerTitle = new El('span'); outerTitle._text = '代码 · Check stats'; outerHeader.appendChild(outerTitle); outer.appendChild(outerHeader);
  const outerOutput = new El('span'); outerOutput._text = '[oswyn-meta: before=5000 after=200 keep=0 mode=replace seq=10]\n[oswyn 输出已压缩 · 原文 tool_result_recall 可召回]\n- stats ok'; outer.appendChild(outerOutput);
  outerWrap.appendChild(outer);

  // Nested PTC subcall row (not compressed).
  const innerWrap = new El('div'); innerWrap.setAttribute('data-chat-call-id', 'call_outer:ptc:1');
  const inner = new El('div'); inner.setAttribute('data-tool', 'oswyn_stats'); inner.setAttribute('data-state', 'done');
  const innerHeader = new El('div'); innerHeader.setAttribute('data-disclosure-row', 'true');
  const innerTitle = new El('span'); innerTitle._text = '工具调用 · oswyn_stats'; innerHeader.appendChild(innerTitle); inner.appendChild(innerHeader);
  innerWrap.appendChild(inner);
  outer.appendChild(innerWrap);
  pbody.appendChild(outerWrap); doc.body.appendChild(group);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  const outerBadges = findAll(outerHeader, BADGE).map((b) => b.textContent);
  const innerBadges = findAll(innerHeader, BADGE).map((b) => b.textContent);
  assert.equal(outerBadges.length, 1, 'outer PTC row must have exactly one badge');
  assert.match(outerBadges[0], /5\.0K→200/, 'badge carries the outer result before→after');
  assert.equal(innerBadges.length, 0, 'nested subcall row must not receive the outer badge');

  const hint = groupHeader.querySelector('.dsh-oswyn-group-hint');
  assert.ok(hint, 'group header shows aggregate hint for the compressed container row');
  assert.match(hint.textContent, /本组 2 次调用 · 压缩 1 次/);
  assert.match(hint.textContent, /5,000→200 字符/);
});

test('Client DOM: PTC run_code container row resolves its badge from the ledger when its output is collapsed (no marker in DOM)', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc, {
    ok: true,
    config: { hideReplySummaryInUi: true },
    sessions: [{ sessionId: 's1', title: 't', history: [
      { seq: 77, mode: 'replace', toolName: 'run_code', callId: 'call_run_code_77', before: 9000, after: 300, summary: '- done', trigger: 'auto' }
    ] }]
  });
  const group = new El('div'); group.setAttribute('data-step-process', 'true');
  const groupHeader = new El('button'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);

  const wrap = new El('div'); wrap.setAttribute('data-chat-call-id', 'call_run_code_77');
  const row = new El('div'); row.setAttribute('data-tool', 'run_code'); row.setAttribute('data-state', 'done');
  const hdr = new El('div'); hdr.setAttribute('data-disclosure-row', 'true');
  const title = new El('span'); title._text = '代码 · Do work'; hdr.appendChild(title); row.appendChild(hdr);
  // Nested subcall row exists, but the outer tool result text is NOT mounted
  // (collapsed row has no output). The only source is the ledger callId.
  const innerWrap = new El('div'); innerWrap.setAttribute('data-chat-call-id', 'call_run_code_77:ptc:1');
  const inner = new El('div'); inner.setAttribute('data-tool', 'read'); inner.setAttribute('data-state', 'done');
  const ih = new El('div'); ih.setAttribute('data-disclosure-row', 'true'); inner.appendChild(ih); innerWrap.appendChild(inner); row.appendChild(innerWrap);
  wrap.appendChild(row); pbody.appendChild(wrap); doc.body.appendChild(group);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));
  const badges = findAll(hdr, BADGE);
  assert.equal(badges.length, 1, 'collapsed outer row must resolve its badge from the ledger callId');
  assert.match(badges[0].textContent, /9\.0K→300/, 'badge carries the ledger before→after');
  assert.equal(badges[0].getAttribute('data-tone'), 'auto', 'ledger auto trigger gets auto tone');
});

test('Client DOM: auto discard badge says 丢弃 with auto tone and discard mode', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc, {
    ok: true,
    config: { hideReplySummaryInUi: true },
    sessions: [{ sessionId: 's1', title: 't', history: [
      { seq: 5, mode: 'discard', toolName: 'bash', callId: 'call_discard', before: 3906, after: 129, trigger: 'auto', fact: 'Execution failed' }
    ] }]
  });
  const row = new El('div'); row.setAttribute('data-tool', 'bash'); row.setAttribute('data-state', 'done'); row.setAttribute('data-chat-call-id', 'call_discard');
  const hdr = new El('div'); hdr.setAttribute('data-disclosure-row', 'true');
  const title = new El('span'); title._text = 'bash failed'; hdr.appendChild(title); row.appendChild(hdr);
  doc.body.appendChild(row);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));
  const badge = row.querySelector('.dsh-oswyn-inline-badge');
  assert.ok(badge, 'discard row must have a badge');
  assert.match(badge.textContent, /^丢弃/);
  assert.equal(badge.getAttribute('data-mode'), 'discard');
  assert.equal(badge.getAttribute('data-tone'), 'auto');
});

test('Client DOM: group aggregate counts ALL calls and uses live before/after for uncompressed rows', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc, {
    ok: true,
    config: { hideReplySummaryInUi: true },
    sessions: [{
      sessionId: 's1', title: 't', history: [],
      liveTools: [
        { callId: 'call_a', before: 3906, after: 129, chars: 129, turn: 1 },
        { callId: 'call_b', before: 100, after: 100, chars: 100, turn: 1 },
        { callId: 'call_c', before: 200, after: 200, chars: 200, turn: 1 }
      ]
    }]
  });
  const group = new El('div'); group.setAttribute('data-step-process', 'true'); group.setAttribute('data-chat-turn', '1');
  const groupHeader = new El('button'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);
  function mk(callId, marker, label) {
    const row = new El('div'); row.setAttribute('data-tool', 'bash'); row.setAttribute('data-state', 'done'); row.setAttribute('data-chat-call-id', callId);
    const hdr = new El('div'); hdr.setAttribute('data-disclosure-row', 'true');
    const t = new El('span'); t._text = label; hdr.appendChild(t); row.appendChild(hdr);
    if (marker) { const o = new El('span'); o._text = marker; row.appendChild(o); }
    return row;
  }
  pbody.appendChild(mk('call_a', '[oswyn-meta: before=3906 after=129 keep=0 mode=discard seq=5]', 'bash failed'));
  pbody.appendChild(mk('call_b', '', 'bash ok 1'));
  pbody.appendChild(mk('call_c', '', 'bash ok 2'));
  doc.body.appendChild(group);
  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 700));
  const hint = groupHeader.querySelector('.dsh-oswyn-group-hint');
  assert.ok(hint, 'group hint exists');
  assert.match(hint.textContent, /本组 3 次调用 · 压缩 1 次/);
  assert.match(hint.textContent, /4,206→429 字符/);
  assert.match(hint.textContent, /省 3,777 字符/);
});

test('Client DOM: expanded row with inline [oswyn-meta:] preserves auto tone and displays discarded call inputChars from ledger', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc, {
    ok: true,
    config: { hideReplySummaryInUi: true },
    sessions: [{
      sessionId: 's1',
      title: 't',
      history: [
        { seq: 171, mode: 'discard', toolName: 'run_code', callId: 'call_disc_input', before: 708, inputChars: 612, after: 177, trigger: 'auto', fact: 'Execution failed' }
      ]
    }]
  });
  const row = new El('div'); row.setAttribute('data-tool', 'run_code'); row.setAttribute('data-state', 'done'); row.setAttribute('data-chat-call-id', 'call_disc_input');
  const hdr = new El('div'); hdr.setAttribute('data-disclosure-row', 'true');
  const title = new El('span'); title._text = '代码 · Inspect session'; hdr.appendChild(title); row.appendChild(hdr);
  const out = new El('span'); out._text = '[oswyn-meta: before=708 after=177 keep=0 mode=discard seq=171]\n[oswyn 整段已丢弃]\nExecution failed'; row.appendChild(out);
  doc.body.appendChild(row);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  const badge = row.querySelector('.dsh-oswyn-inline-badge');
  assert.ok(badge, 'badge exists on expanded discard row');
  assert.equal(badge.getAttribute('data-tone'), 'auto', 'expanded row must preserve auto tone from ledger');
  assert.equal(badge.getAttribute('data-mode'), 'discard');
  assert.match(badge.textContent, /丢弃\s*708→177 -75%/);
  const panel = badge.querySelector('.dsh-oswyn-inline-panel');
  assert.ok(panel, 'detail panel exists');
  assert.match(panel.textContent, /含调用输入 612 字符/, 'detail panel shows discarded call input chars');
  assert.ok(panel.querySelector('[data-dsh-oswyn-chart]'), 'detail panel includes visual before→after chart');
});

test('Client DOM: reply-summary fold chip displays before→after character stats and reduction percentage, and expanding subcalls never flickers group stats', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc, {
    ok: true,
    config: { hideReplySummaryInUi: true },
    sessions: [{
      sessionId: 's_chip',
      title: 't',
      history: [
        { seq: 20, mode: 'reply', toolName: 'assistant_reply', before: 2500, after: 250, summary: '- 核心改动：优化浮窗与折叠条统计', trigger: 'agent' },
        { seq: 10, mode: 'truncate', toolName: 'run_code', callId: 'call_outer_stable', before: 8000, after: 1200, keepLines: 30, trigger: 'agent', summary: '- kept 30 lines' }
      ],
      liveTools: [
        { seq: 10, callId: 'call_outer_stable', toolName: 'run_code', chars: 8000, before: 8000, after: 8000, compressed: false },
        { seq: 12, callId: 'call_outer_stable', toolName: 'run_code', chars: 1200, before: 8000, after: 1200, compressed: true }
      ]
    }]
  });

  // 1) Reply summary block
  const msgBody = new El('div'); msgBody._cls.add('body');
  const p = new El('p'); p._text = 'Detailed explanation '.repeat(80); msgBody.appendChild(p);
  const wrap = new El('div'); wrap._cls.add('code-block');
  const pre = new El('pre');
  const code = new El('code'); code.setAttribute('data-lang', 'dsh-reply-summary');
  code._text = '- 核心改动：优化浮窗与折叠条统计';
  pre.appendChild(code); wrap.appendChild(pre); msgBody.appendChild(wrap);
  doc.body.appendChild(msgBody);

  // 2) Process group with outer run_code row (collapsed) and nested subcall row
  const group = new El('div'); group.setAttribute('data-step-process', 'true');
  const groupHeader = new El('button'); group.appendChild(groupHeader);
  const pbody = new El('div'); pbody.setAttribute('data-step-process-body', 'true'); group.appendChild(pbody);

  const outerWrap = new El('div'); outerWrap.setAttribute('data-chat-call-id', 'call_outer_stable');
  const outer = new El('div'); outer.setAttribute('data-tool', 'run_code'); outer.setAttribute('data-state', 'done');
  const outerHdr = new El('div'); outerHdr.setAttribute('data-disclosure-row', 'true');
  const outerTitle = new El('span'); outerTitle._text = '代码 · Run tests'; outerHdr.appendChild(outerTitle); outer.appendChild(outerHdr);

  const innerWrap = new El('div'); innerWrap.setAttribute('data-chat-call-id', 'call_outer_stable:ptc:1');
  const inner = new El('div'); inner.setAttribute('data-tool', 'bash'); inner.setAttribute('data-state', 'done');
  const innerHdr = new El('div'); innerHdr.setAttribute('data-disclosure-row', 'true');
  const innerTitle = new El('span'); innerTitle._text = 'bash subcall'; innerHdr.appendChild(innerTitle); inner.appendChild(innerHdr);
  innerWrap.appendChild(inner); outer.appendChild(innerWrap);
  outerWrap.appendChild(outer); pbody.appendChild(outerWrap); doc.body.appendChild(group);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  // Verify reply chip shows stats: 2,500→250 字符 (-90%)
  const chip = doc.querySelector('.dsh-oswyn-fold-chip');
  assert.ok(chip, 'reply fold chip exists');
  assert.match(chip.textContent, /2,500→250 字符 \(-90%\)/, 'fold chip displays before→after chars and ratio');

  // Verify outer row badge is visible even when collapsed
  const outerBadge = outerHdr.querySelector('.dsh-oswyn-inline-badge');
  assert.ok(outerBadge, 'collapsed agent-compressed row shows badge immediately');
  assert.equal(outerBadge.getAttribute('data-tone'), 'agent', 'agent tone preserved');
  assert.match(outerBadge.textContent, /8\.0K→1\.2K -85%/);

  // Verify group header before expanding subcall
  const hintBefore = groupHeader.querySelector('.dsh-oswyn-group-hint').textContent;
  assert.match(hintBefore, /8,000→1,200 字符 -85%/);

  // Simulate user clicking to expand the nested subcall (which mounts 3000 chars of subcall output into inner)
  const subOutput = new El('div');
  subOutput._text = 'S'.repeat(3000);
  inner.appendChild(subOutput);
  await new Promise((r) => setTimeout(r, 500));

  const hintAfter = groupHeader.querySelector('.dsh-oswyn-group-hint').textContent;
  assert.equal(hintAfter, hintBefore, 'expanding nested subcall must NEVER change or flicker group header stats');
});
