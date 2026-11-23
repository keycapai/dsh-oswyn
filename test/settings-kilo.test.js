/**
 * Settings widgets edit large counts in thousands (64k instead of 64000).
 *
 * The scaling contract is deliberately narrow: only the WIDGET is scaled. The stored
 * config keeps its real unit, so nothing downstream (backend thresholds, existing
 * ledgers, other clients) sees a different number.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadClient() {
  const win = {
    __ModuleLoader__: { load(e) { win._entry = e; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {}
  };
  const doc = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
    addEventListener() {}, removeEventListener() {},
    head: { appendChild() {} }, body: { appendChild() {} }
  };
  const sandbox = {
    window: win, document: doc,
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  vm.runInContext(src, sandbox);
  const req = createRequire(path.join(__dirname, 'x.js'));
  return win._entry.factory((id) => (id === 'react' ? req('react') : {}));
}

const client = loadClient();

test('kilo: large counts display as thousands', () => {
  assert.equal(client.kiloToDisplay(64000, true), 64, '64k token threshold reads 64');
  assert.equal(client.kiloToDisplay(256000, true), 256, 'ceiling reads 256');
  assert.equal(client.kiloToDisplay(4000, true), 4);
  assert.equal(client.kiloToDisplay(2000, true), 2);
  assert.equal(client.kiloToDisplay(12500, true), 12.5, 'fractional thousands keep one decimal');
  assert.equal(client.kiloToDisplay(500, true), 0.5);
});

test('kilo: unscaled fields are untouched', () => {
  assert.equal(client.kiloToDisplay(600, false), 600);
  assert.equal(client.kiloToDisplay(18, false), 18);
  assert.equal(client.kiloToStored(600, false), 600);
});

test('kilo: writing back restores the stored unit exactly', () => {
  assert.equal(client.kiloToStored(64, true), 64000);
  assert.equal(client.kiloToStored(256, true), 256000);
  assert.equal(client.kiloToStored(0.5, true), 500);
  for (const stored of [2000, 4000, 64000, 256000, 48000]) {
    assert.equal(client.kiloToStored(client.kiloToDisplay(stored, true), true), stored, 'round-trips ' + stored);
  }
});

test('kilo: the widget view carries the scaled value, step, min and unit', () => {
  const volume = client.numberFieldView({ field: 'triggerVolumeTokens', value: 64000, min: 4000, step: 4000, unit: 'Token', kilo: true });
  assert.equal(volume.shown, 64, 'reads 64, not 64000');
  assert.equal(volume.step, 4, 'step scales with the value');
  assert.equal(volume.min, 4);
  assert.equal(volume.unitText, 'k Token', 'unit says k so the number is unambiguous');

  const ceiling = client.numberFieldView({ value: 256000, min: 16000, step: 16000, unit: 'Token', kilo: true });
  assert.equal(ceiling.shown, 256);
  assert.equal(ceiling.min, 16);
  assert.equal(ceiling.step, 16);

  const small = client.numberFieldView({ value: 600, min: 100, step: 50, unit: '字符' });
  assert.equal(small.shown, 600, 'unscaled fields keep their exact value');
  assert.equal(small.step, 50);
  assert.equal(small.unitText, '字符', 'no k prefix where none was asked for');
});

test('kilo: junk input never writes a bogus number', () => {
  assert.equal(client.kiloToStored('', true), 0, 'an empty box reads as zero, not NaN');
  assert.equal(client.kiloToStored('abc', true), null, 'non-numeric input is refused');
  assert.equal(client.kiloToStored(NaN, true), null);
  assert.equal(client.kiloToDisplay(NaN, true), 0);
  assert.equal(client.kiloToDisplay(undefined, true), 0);
});
