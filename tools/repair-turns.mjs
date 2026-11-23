#!/usr/bin/env node
/**
 * One-off ledger repair: re-stamp compression rows with the round they belong to.
 *
 * Rows written before the attribution fix carry the FLUSHING turn, which is one past
 * the round the fence was written in, and rows written by auto policies carry turn 0
 * because no turn was passed at all. Both are recoverable from the session transcript:
 * every event is stamped with its own turn, and each ledger row records the seq of the
 * event it compressed.
 *
 * Usage: node tools/repair-turns.mjs <sessionId> [--apply]
 */
import { readFileSync, existsSync, copyFileSync, writeFileSync, renameSync, mkdtempSync, openSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const sessionId = process.argv[2];
const apply = process.argv.includes('--apply');
if (!sessionId) { console.error('usage: repair-turns.mjs <sessionId> [--apply]'); process.exit(2); }

const base = process.env.DSH_HOME || join(homedir(), '.dsh');
const ledgerFile = join(base, 'storages', 'oswyn', 'sessions', sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
if (!existsSync(ledgerFile)) { console.error('no ledger: ' + ledgerFile); process.exit(1); }

/** Locate the transcript for a session across every cwd bucket. */
function findTranscript(id) {
  const root = join(base, 'sessions');
  if (!existsSync(root)) return null;
  for (const bucket of execFileSync('ls', ['-1', root], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    const dir = join(root, bucket, id);
    if (!existsSync(dir)) continue;
    for (const f of execFileSync('ls', ['-1', dir], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
      if (!f.endsWith('.jsonl') && !f.endsWith('.zstd')) continue;
      const full = join(dir, f);
      if (f.endsWith('.zstd')) {
        const out = join(mkdtempSync(join(tmpdir(), 'oswyn-repair-')), 'session.jsonl');
        execFileSync('zstd', ['-dc', full], { stdio: ['ignore', openSync(out, 'w'), 'ignore'] });
        return out;
      }
      return full;
    }
  }
  return null;
}

const transcript = findTranscript(sessionId);
if (!transcript) { console.error('no transcript for ' + sessionId); process.exit(1); }

/** seq -> turn, from the authoritative per-event turn stamps. */
const seqTurn = new Map();
for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (!line) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  const t = Number(ev?.data?.turn);
  if (Number.isFinite(t) && t > 0 && Number.isInteger(ev.seq)) seqTurn.set(ev.seq, Math.trunc(t));
}

const data = JSON.parse(readFileSync(ledgerFile, 'utf8'));
const entries = Array.isArray(data.entries) ? data.entries : [];
const changes = [];
for (const e of entries) {
  const stamped = seqTurn.get(e.seq);
  if (!stamped) continue;
  const current = Number(e.turn);
  if (Number.isFinite(current) && current === stamped) continue;
  changes.push({ mode: e.mode, seq: e.seq, from: e.turn, to: stamped });
}

const hist = {};
for (const c of changes) { const k = String(c.from) + '->' + c.to; hist[k] = (hist[k] || 0) + 1; }
console.log('session ' + sessionId);
console.log('entries ' + entries.length + ', restampable ' + changes.length);
console.log('transitions ' + JSON.stringify(hist));
console.log('reply rows:');
for (const c of changes.filter((x) => x.mode === 'reply')) {
  console.log('  seq ' + c.seq + ' turn ' + c.from + ' -> ' + c.to);
}

// Rounds whose reply fence never reached the ledger at all: the last turn of a
// conversation has no following step boundary, so its fence was parked and then
// dropped. Recover the row from the transcript itself.
const replySeqs = new Set(entries.filter((e) => e.mode === 'reply').map((e) => e.seq));
const missing = [];
for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (!line) continue;
  let ev; try { ev = JSON.parse(line); } catch { continue; }
  if (ev.type !== 'assistant/message' || !Number.isInteger(ev.seq)) continue;
  const turn = Number(ev?.data?.turn);
  if (!Number.isFinite(turn) || turn <= 0) continue;
  const text = (ev.data?.message?.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const open = text.lastIndexOf('\u0060\u0060\u0060dsh-reply-summary');
  const legacy = text.lastIndexOf('\u0060\u0060\u0060reply-summary');
  const at = Math.max(open, legacy);
  if (at < 0) continue;
  const bodyStart = text.indexOf('\n', at);
  if (bodyStart < 0) continue;
  const close = text.indexOf('\u0060\u0060\u0060', bodyStart);
  if (close < 0) continue;
  const summary = text.slice(bodyStart, close).trim();
  if (!summary || replySeqs.has(ev.seq)) continue;
  missing.push({ seq: ev.seq, turn: Math.trunc(turn), before: text.length, after: summary.length, summary });
}
console.log('reply rows missing from the ledger: ' + missing.length);
for (const m of missing) console.log('  seq ' + m.seq + ' turn ' + m.turn + ' ' + m.before + '->' + m.after);

if (!apply) { console.log(''); console.log('(dry run; pass --apply to write)'); process.exit(0); }

copyFileSync(ledgerFile, ledgerFile + '.bak-' + Date.now());
for (const e of entries) {
  const stamped = seqTurn.get(e.seq);
  if (stamped) e.turn = stamped;
}
const ts = Date.now();
for (const m of missing) {
  entries.push({
    id: m.seq + '_' + ts + '_backfill',
    ts,
    seq: m.seq,
    turn: m.turn,
    mode: 'reply',
    toolName: 'assistant_reply',
    callId: '',
    before: m.before,
    inputChars: null,
    after: m.after,
    keepChars: null,
    keepLines: null,
    fact: '',
    summary: m.summary,
    compressed: m.before > m.after,
    tokensSaved: Math.max(0, Math.round((m.before - m.after) / 3.5)),
    extraSummaryTokens: Math.round(m.after / 3.5),
    recallTokens: 0,
    net: Math.max(0, Math.round((m.before - m.after) / 3.5)) - Math.round(m.after / 3.5),
    trigger: 'agent'
  });
}
entries.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
data.updatedAt = Date.now();
const tmp = ledgerFile + '.tmp-' + Date.now();
writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
renameSync(tmp, ledgerFile);
console.log('');
console.log('applied to ' + ledgerFile);
