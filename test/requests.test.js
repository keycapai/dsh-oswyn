import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

const root = mkdtempSync(join(tmpdir(), 'dsh-oswyn-requests-'));
process.env.DSH_OSWYN_SESSIONS_ROOT = root;
const { clearRequestCache, readRequestSeqs, readTurnMarks, turnForSeq } = await import('../lib/store/requests.js');

test.after(() => rmSync(root, { recursive: true, force: true }));

test('a session log created after the first lookup is picked up on retry', () => {
  clearRequestCache();
  const id = 'late-session';
  assert.deepEqual(readRequestSeqs(id), []);          // miss, must NOT be cached
  const dir = join(root, 'workspace-x', id);
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'turn/start', seq: 4, data: { turn: 1 } }),
    JSON.stringify({ type: 'step/start', seq: 6 }),
    JSON.stringify({ type: 'turn/start', seq: 20, data: { turn: 2 } }),
    JSON.stringify({ type: 'step/start', seq: 22 })
  ].join('\n');
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines)));
  clearRequestCache();
  assert.deepEqual(readRequestSeqs(id), [6, 22]);
  const marks = readTurnMarks(id);
  assert.deepEqual(marks, [{ seq: 4, turn: 1 }, { seq: 20, turn: 2 }]);
  assert.equal(turnForSeq(marks, 6), 1);
  assert.equal(turnForSeq(marks, 22), 2);
});
