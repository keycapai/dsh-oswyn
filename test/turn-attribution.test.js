/**
 * Regression tests for turn attribution of compression rows.
 *
 * The fence a turn writes is parked by the session/event observer and applied at the
 * NEXT step boundary. Stamping that row with the flushing turn shifted every summary
 * by +1 and left the newest round with no row at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate storage so tests never touch the user's real ledger.
const dir = mkdtempSync(join(tmpdir(), 'dsh-oswyn-turn-'));
process.env.DSH_OSWYN_STORAGE_DIR = dir;

test.after(() => rmSync(dir, { recursive: true, force: true }));

const { apply } = await import('../lib/index.js');
const { loadSession, deriveEntry } = await import('../lib/store/ledger.js');

const FENCE = '\u0060\u0060\u0060dsh-reply-summary\n- the reply, compressed to one line\n\u0060\u0060\u0060';

function makeCtx() {
  const hooks = {};
  const ctx = {
    logger: { info(){}, warn(){}, debug(){}, error(){} },
    effect(fn){ try { fn(); } catch {} },
    on(evt, handler){ hooks[evt] = handler; },
    inject(_deps, cb){ try { cb(ctx); } catch {} },
    commands: { register(){} },
    tools: { register(){} },
    systemPrompt: { section(){} },
    _hooks: hooks
  };
  return ctx;
}

/** A session mock whose surface supports the replace op the applier appends. */
function makeSession(id, fenceText) {
  const log = [
    { seq: 0, type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
    { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'go' }] } } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: 'LOG LINE\n'.repeat(400) }] } } },
    { seq: 3, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: fenceText }] } } }
  ];
  const session = {
    id,
    title: 'T',
    turn: 1,
    step: 1,
    surface: { nodes: [0, 1, 2, 3] },
    log,
    snapshotEvents(){ return log; },
    eventAt(seq){ return log.find(e => e.seq === seq); },
    append(type, data, opts){
      const ev = { type, seq: log.length, data, ...(opts || {}) };
      log.push(ev);
      if (opts?.surfaceOp?.op === 'replace') {
        const i = session.surface.nodes.indexOf(opts.surfaceOp.startSeq);
        const j = session.surface.nodes.indexOf(opts.surfaceOp.endSeq);
        if (i >= 0 && j >= i) session.surface.nodes.splice(i, j - i + 1, ev.seq);
      } else {
        session.surface.nodes.push(ev.seq);
      }
      return ev;
    }
  };
  return session;
}

test('turn attribution: a fence written in turn N is booked as turn N, not N+1', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, replySummaryEnabled: true });
  const session = makeSession('test_turn_attr_' + Date.now(), 'answer text\n\n' + FENCE);

  // The observer parks the fence while the assistant message is still being published.
  ctx._hooks['session/event'](session, session.log[3]);

  // The flush happens one turn later — the round the fence belongs to must survive.
  await ctx._hooks['agent/pre-step'](
    { agent: { session }, turn: 2, step: 1, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [] })
  );

  const entries = loadSession(session.id).entries;
  const replyRows = entries.filter((e) => e.mode === 'reply');
  assert.ok(replyRows.length >= 1, 'the reply fence was booked');
  for (const row of replyRows) {
    assert.equal(row.turn, 1, 'row stamped with the writing turn, not the flushing turn');
  }
});

test('turn attribution: the observer trusts the turn stamped on the event', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, replySummaryEnabled: true });
  const session = makeSession('test_turn_event_' + Date.now(), 'answer text\n\n' + FENCE);
  // The host has already advanced the session round; the event still carries the real one.
  session.turn = 9;

  ctx._hooks['session/event'](session, session.log[3]);
  // The kernel dispatches with `{ turn }` and the agent as the scope (`this`).
  await ctx._hooks['agent/turn-stopping'].call({ session }, { turn: 1 });

  const replyRows = loadSession(session.id).entries.filter((e) => e.mode === 'reply');
  assert.ok(replyRows.length >= 1, 'turn close flushed the fence');
  for (const row of replyRows) assert.equal(row.turn, 1);
});

test('turn attribution: turn close flushes the last round, which has no next pre-step', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, replySummaryEnabled: true });
  const session = makeSession('test_turn_close_' + Date.now(), 'answer text\n\n' + FENCE);

  ctx._hooks['session/event'](session, session.log[3]);
  assert.equal(loadSession(session.id).entries.length, 0, 'nothing booked before the boundary');

  await ctx._hooks['agent/turn-stopping'].call({ session }, { turn: 1 });
  assert.ok(loadSession(session.id).entries.length > 0, 'the final round still gets its row');
});

test('deriveEntry: an absent turn stays absent instead of collapsing to 0', () => {
  assert.equal(deriveEntry({ mode: 'truncate', before: 900, after: 90 }).turn, null, 'null is not round 0');
  assert.equal(deriveEntry({ mode: 'truncate', before: 900, after: 90, turn: null }).turn, null);
  assert.equal(deriveEntry({ mode: 'truncate', before: 900, after: 90, turn: '' }).turn, null);
  assert.equal(deriveEntry({ mode: 'truncate', before: 900, after: 90, turn: 3 }).turn, 3, 'a real round is kept');
  assert.equal(deriveEntry({ mode: 'truncate', before: 900, after: 90, turn: 0 }).turn, 0);
});
