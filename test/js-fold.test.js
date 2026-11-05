
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

test('BUG REPRO: javascript code block containing regex or memo keywords must NEVER be folded', async () => {
  const doc = makeDoc();
  const mod = loadClient(doc);

  // A realistic javascript code block as rendered by CodeBlock.tsx
  const wrap = new El('div'); wrap._cls.add('md-code-block');
  const bannerWrap = new El('div'); bannerWrap._cls.add('bannerWrap');
  const banner = new El('div'); banner._cls.add('banner');
  const info = new El('div'); info._cls.add('infostring'); info._text = 'javascript';
  banner.appendChild(info); bannerWrap.appendChild(banner); wrap.appendChild(bannerWrap);

  const pre = new El('pre'); pre._cls.add('shiki');
  const code = new El('code');
  // Code snippet that talks about DENSE DECISION-COMPLETE MEMO or replace
  code._text = 'function parse() {\n  // match DENSE DECISION-COMPLETE MEMO\n  const re = /DENSE DECISION-COMPLETE MEMO/;\n  return str.replace(/^replace\\s*\\n\\s*[-*•]/, "");\n}';
  pre.appendChild(code); wrap.appendChild(pre);
  doc.body.appendChild(wrap);

  const ctx = { effect(fn) { return fn(); }, get() {}, on() {}, logger: { info() {}, warn() {}, debug() {} } };
  mod.apply(ctx);
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(wrap.getAttribute('data-oswyn-folded'), null, 'javascript code block must NOT be folded');
  assert.notEqual(wrap.style.display, 'none', 'javascript code block must stay visible');
});
