/**
 * dsh-oswyn/client/build — Assembles `lib/client.js` from the modular source
 * files in `lib/client/`:
 *   1. `shared.js`         — Marker parser (`parseMetaToken`), byte/number/ratio formatters
 *   2. `settings-panel.js` — Settings dashboard React component (`ContextDistillCard`)
 *   3. `tool-badges.js`    — Per-row inline compression badge & expandable detail panel
 *   4. `fence-fold.js`     — `dsh-result-summary` hiding, `dsh-reply-summary` fold chip & merged-fence rescue
 *   5. `state.js`          — Status polling (`pullConfig`), group header aggregation & DOM observer (`sync`)
 *
 * Keeps `lib/client.js` 100% compatible with DSH's browser `window.__ModuleLoader__`
 * and Node VM tests while allowing maintainers to inspect and edit small, focused files.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CLIENT_MODULE_ORDER = Object.freeze([
  'shared.js',
  'settings-panel.js',
  'tool-badges.js',
  'fence-fold.js',
  'state.js'
]);

export function assembleClientSource() {
  const parts = CLIENT_MODULE_ORDER.map((file) => {
    const raw = readFileSync(join(__dirname, file), 'utf8');
    return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  });
  return parts.join('\n');
}

export function buildClientBundle() {
  const targetPath = join(__dirname, '..', 'client.js');
  const next = assembleClientSource();
  let current = '';
  try { current = readFileSync(targetPath, 'utf8'); } catch (_) {}
  if (current !== next) {
    writeFileSync(targetPath, next, 'utf8');
  }
  return targetPath;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildClientBundle();
}
