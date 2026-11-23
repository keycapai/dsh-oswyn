#!/usr/bin/env node
/**
 * v2.4 helper: extract a realistic noise corpus from REAL session transcripts.
 *
 * The attention-dilution experiment (Exp F) must use the same kind of payload that
 * actually fills an agent's context in production: raw tool/result bodies, not
 * synthetic lorem ipsum. We therefore harvest real tool outputs and keep their sizes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.join(os.homedir(), '.dsh', 'sessions');
const OUT = path.join(process.cwd(), 'paper', 'data', 'v24', 'noise-corpus.json');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let s = '';
  for (const b of content) {
    if (!b) continue;
    if (typeof b === 'string') s += b;
    else if (typeof b.text === 'string') s += b.text;
    else if (typeof b.content === 'string') s += b.content;
    else if (typeof b.output === 'string') s += b.output;
    else s += JSON.stringify(b);
  }
  return s;
}

const chunks = [];
for (const proj of fs.readdirSync(ROOT)) {
  const pd = path.join(ROOT, proj);
  let st; try { st = fs.statSync(pd); } catch { continue; }
  if (!st.isDirectory()) continue;
  for (const sid of fs.readdirSync(pd)) {
    const sd = path.join(pd, sid);
    let st2; try { st2 = fs.statSync(sd); } catch { continue; }
    if (!st2.isDirectory()) continue;
    const f = path.join(sd, 'session.v4.jsonl.zstd');
    if (!fs.existsSync(f)) continue;
    let text;
    try { text = zlib.zstdDecompressSync(fs.readFileSync(f)).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'tool/result') continue;
      const body = textOf(e.data?.message?.content ?? e.data?.content ?? '');
      if (body.length < 1500) continue;
      chunks.push(body.slice(0, 24000));
    }
  }
}

// de-duplicate near-identical payloads by their first 120 chars
const seen = new Set();
const uniq = [];
for (const c of chunks) {
  const key = c.slice(0, 120);
  if (seen.has(key)) continue;
  seen.add(key);
  uniq.push(c);
}
uniq.sort((a, b) => b.length - a.length);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ count: uniq.length, chunks: uniq.slice(0, 200) }, null, 2));
console.log('harvested', chunks.length, 'unique', uniq.length, 'kept', Math.min(200, uniq.length));
console.log('total chars', uniq.slice(0, 200).reduce((a, c) => a + c.length, 0));
