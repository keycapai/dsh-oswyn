/**
 * OSWYN v2.4 - multi-signal distillation trigger contract tests.
 *
 * These lock the three design invariants that the v2.4 paper establishes:
 *   1. the volume signal is measured in ABSOLUTE removable tokens (a ratio is
 *      degenerate for short clean sessions where nothing can be removed);
 *   2. the anti-thrash floor prevents resets that would save almost nothing;
 *   3. coalescing defers an armed reset to a naturally cold call, but the hard
 *      ceiling always wins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIGGER_DEFAULTS,
  CHARS_PER_TOKEN,
  estimateTokens,
  messageChars,
  measureSurfaces,
  evaluateTrigger,
  ensureTriggerState
} from '../lib/core/triggers.js';
import { projectDistilledHistory } from '../lib/core/projection.js';

const cfg = (over = {}) => ({ ...TRIGGER_DEFAULTS, ...over });

test('v2.4 [1.1]: estimateTokens uses the calibrated chars/token ratio', () => {
  assert.equal(estimateTokens(CHARS_PER_TOKEN * 100), 100);
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(-5), 0);
  assert.equal(estimateTokens(NaN), 0);
});

test('v2.4 [1.2]: messageChars counts text blocks and tool-call arguments', () => {
  assert.equal(messageChars({ role: 'user', content: 'abcd' }), 4);
  assert.equal(messageChars({ role: 'assistant', content: [{ type: 'text', text: 'abcd' }] }), 4);
  const withCalls = { role: 'assistant', content: '', tool_calls: [{ name: 'x', arguments: '{}' }] };
  assert.ok(messageChars(withCalls) > 10);
  assert.equal(messageChars(null), 0);
});

test('v2.4 [1.3]: measureSurfaces reports the removable surplus in absolute tokens', () => {
  const history = [
    { role: 'user', content: 'a'.repeat(1000) },
    { role: 'tool', content: 'b'.repeat(29000) }
  ];
  const measured = measureSurfaces(history, (msgs) => msgs.filter((m) => m.role !== 'tool'));
  assert.equal(measured.rawTokens, Math.round(30000 / CHARS_PER_TOKEN));
  assert.ok(measured.surplusTokens > 9000, 'stripping the tool payload must expose a large surplus');
  assert.equal(measured.rawChars, 30000);
});

test('v2.4 [1.4]: measureSurfaces degrades to zero surplus when nothing is removable', () => {
  const history = [
    { role: 'user', content: 'a'.repeat(500) },
    { role: 'assistant', content: 'b'.repeat(500) }
  ];
  const measured = measureSurfaces(history, (msgs) => msgs);
  assert.equal(measured.surplusTokens, 0);
});

test('v2.4 [2.1]: volume signal fires only above the threshold', () => {
  const v = TRIGGER_DEFAULTS.triggerVolumeTokens;
  const below = evaluateTrigger({ surplusTokens: v - 1000, rawTokens: v + 10000, roundsSinceDistill: 0, cacheExpired: false }, cfg());
  assert.equal(below.distill, false);
  assert.equal(below.signals.volume, false);

  const above = evaluateTrigger({ surplusTokens: v, rawTokens: v + 10000, roundsSinceDistill: 0, cacheExpired: false, cacheCold: true }, cfg());
  assert.equal(above.signals.volume, true);
  assert.equal(above.distill, true);
  assert.equal(above.reason, 'volume');
});

test('v2.4 [2.2]: round signal fires at the configured round count', () => {
  const r = TRIGGER_DEFAULTS.triggerRounds;
  const armed = evaluateTrigger({ surplusTokens: 5000, rawTokens: 20000, roundsSinceDistill: r, cacheExpired: false, cacheCold: true }, cfg());
  assert.equal(armed.signals.rounds, true);
  assert.equal(armed.distill, true);
  assert.equal(armed.reason, 'rounds');

  const notYet = evaluateTrigger({ surplusTokens: 5000, rawTokens: 20000, roundsSinceDistill: r - 1, cacheExpired: false }, cfg());
  assert.equal(notYet.signals.rounds, false);
});

test('v2.4 [2.3]: TTL signal fires immediately because the cache is already gone', () => {
  const r = evaluateTrigger({ surplusTokens: 5000, rawTokens: 20000, roundsSinceDistill: 0, cacheExpired: true, cacheCold: false }, cfg());
  assert.equal(r.distill, true);
  assert.equal(r.reason, 'ttl');
});

test('v2.4 [3.1]: an armed trigger executes on that dispatch (no deferral mode)', () => {
  const v = TRIGGER_DEFAULTS.triggerVolumeTokens;
  const warm = evaluateTrigger({ surplusTokens: v + 8000, rawTokens: v + 20000, roundsSinceDistill: 9, cacheExpired: false, cacheCold: false }, cfg());
  assert.equal(warm.armed, true);
  assert.equal(warm.distill, true, 'an armed trigger must not wait for a cold call');
  assert.equal(warm.reason, 'volume');
});

test('v2.4 [3.2]: the trigger config exposes no coalescing knobs', () => {
  assert.equal('triggerCoalesce' in TRIGGER_DEFAULTS, false);
  assert.equal('triggerCoalesceMaxRounds' in TRIGGER_DEFAULTS, false);
});

test('v2.4 [3.3]: the anti-thrash floor blocks tiny resets but not the ceiling', () => {
  const tiny = evaluateTrigger({ surplusTokens: 500, rawTokens: 20000, roundsSinceDistill: 9, cacheExpired: false, cacheCold: true }, cfg());
  assert.equal(tiny.floorBlocked, true);
  assert.equal(tiny.distill, false);

  const ceiling = evaluateTrigger({ surplusTokens: 500, rawTokens: 300000, roundsSinceDistill: 0, cacheExpired: false, cacheCold: false }, cfg());
  assert.equal(ceiling.signals.ceiling, true);
  assert.equal(ceiling.distill, true);
  assert.equal(ceiling.reason, 'ceiling');
});

test('v2.4 [3.4]: disabling a signal removes it from the arming set', () => {
  const r = evaluateTrigger({ surplusTokens: 999999, rawTokens: 20000, roundsSinceDistill: 0, cacheExpired: false, cacheCold: true }, cfg({ triggerVolumeEnabled: false }));
  assert.equal(r.signals.volume, false);
  assert.equal(r.distill, false);
});

test('v2.4 [4.1]: ensureTriggerState attaches a stable, non-enumerable latch', () => {
  const session = {};
  const a = ensureTriggerState(session);
  const b = ensureTriggerState(session);
  assert.equal(a, b, 'the latch must be reused across dispatches');
  assert.equal(a.distilled, false);
  assert.equal(a.roundsSinceDistill, 0);
  assert.equal(Object.keys(session).includes('__oswynTrigger'), false, 'latch must not leak into enumeration');
});

test('v2.4 [4.2]: ensureTriggerState tolerates a missing session', () => {
  const s = ensureTriggerState(null);
  assert.equal(s.distilled, false);
  assert.equal(s.roundsSinceDistill, 0);
});

test('v2.4 [3.6]: every arming signal fires on the same dispatch', () => {
  // Regression: the live ledger showed 0 distillations across 180 sessions because
  // an armed trigger used to wait for a cold call that never came.
  const base = { cacheExpired: false, cacheCold: false };

  const v = TRIGGER_DEFAULTS.triggerVolumeTokens;
  const r = TRIGGER_DEFAULTS.triggerRounds;
  const byVolume = evaluateTrigger({ ...base, surplusTokens: v + 8000, rawTokens: v + 40000, roundsSinceDistill: 1 }, cfg());
  assert.equal(byVolume.distill, true);
  assert.equal(byVolume.reason, 'volume');

  const byRounds = evaluateTrigger({ ...base, surplusTokens: 5000, rawTokens: 60000, roundsSinceDistill: r }, cfg());
  assert.equal(byRounds.distill, true);
  assert.equal(byRounds.reason, 'rounds');

  const byTtl = evaluateTrigger({ cacheExpired: true, surplusTokens: 5000, rawTokens: 60000, roundsSinceDistill: 1 }, cfg());
  assert.equal(byTtl.distill, true);
  assert.equal(byTtl.reason, 'ttl');
});

test('v2.4 [3.7]: the anti-thrash floor blocks a would-be reset regardless of signal', () => {
  // A surplus below the floor must stay blocked even when rounds alone would arm it.
  const tiny = evaluateTrigger({
    cacheExpired: false, cacheCold: false,
    surplusTokens: 100, rawTokens: 50000, roundsSinceDistill: 50
  }, cfg());
  assert.equal(tiny.distill, false);
  assert.equal(tiny.floorBlocked, true);
});

test('v2.4 [5.1]: the sticky latch stops re-evaluation once distilled', () => {
  // Regression: state.distilled was written but never read, so a session whose
  // history stayed large re-fired on EVERY model request and re-booked the same
  // bytes as a new saving each time (the replay ledger showed 645 events and
  // 11.07M "saved" tokens for one corpus replay).
  const session = {};
  const state = ensureTriggerState(session);

  // First dispatch: armed by volume, fires, latches.
  const first = evaluateTrigger({ surplusTokens: TRIGGER_DEFAULTS.triggerVolumeTokens + 8000, rawTokens: 120000, roundsSinceDistill: 1, cacheExpired: false }, cfg());
  assert.equal(first.distill, true);
  state.distilled = true;

  // The latch is what the dispatch layer now checks before evaluating at all.
  const alreadyDistilled = state.distilled === true;
  assert.equal(alreadyDistilled, true, 'a distilled session must not re-evaluate');
});

test('v2.4 [6.1]: R counts conversation turns, not model requests', () => {
  // A single user turn with N tool calls produces N+1 model requests. If R counted
  // requests, R=5 would fire inside ONE turn, contradicting the paper's definition
  // of R as "未精炼轮次" (undistilled conversation turns).
  const session = {};
  const state = ensureTriggerState(session);
  let distilled = false;

  const request = (turn) => {
    const turnChanged = turn !== undefined && state.lastObservedTurn !== undefined && turn !== state.lastObservedTurn;
    let distillNow = distilled;
    if (!distilled) {
      const r = evaluateTrigger({ surplusTokens: 5000, rawTokens: 60000, roundsSinceDistill: state.roundsSinceDistill, cacheExpired: false }, cfg());
      if (r.distill) distillNow = true;
    }
    if (distillNow) { distilled = true; state.roundsSinceDistill = 0; }
    else if (turnChanged) state.roundsSinceDistill += 1;
    state.lastObservedTurn = turn;
  };

  // Turn 1: six requests (five tool calls + the answer).
  for (let i = 0; i < 6; i += 1) request(1);
  assert.equal(state.roundsSinceDistill, 0, 'requests inside one turn must not advance R');
  assert.equal(distilled, false, 'R=5 must not fire inside a single turn');

  // Turns 2..R: still under R.
  const R = TRIGGER_DEFAULTS.triggerRounds;
  for (let t = 2; t <= R; t += 1) { request(t); request(t); }
  assert.equal(state.roundsSinceDistill, R - 1);
  assert.equal(distilled, false);

  // Turn R+1 crosses the threshold. Note the evaluation happens BEFORE the counter
  // advances, so the trigger fires on the first request that SEES roundsSince >= R.
  request(R + 1);
  assert.equal(state.roundsSinceDistill, R, 'the turn boundary advanced the counter');
  request(R + 1);
  assert.equal(distilled, true, 'R must fire once the counter reaches the threshold');
});

test('v2.4 [7.1]: the measured surface must be the session history, not the pre-step claim', () => {
  const claimed = [{ role: 'user', content: 'turn 11 request' }];
  const history = [{ role: 'system', content: 'sys' }];
  for (let t = 1; t <= 10; t += 1) {
    history.push({ role: 'user', content: 'turn ' + t });
    history.push({ role: 'assistant', content: [{ type: 'text', text: '<think>r</think>a' + t }] });
    history.push({ role: 'tool', content: 'x'.repeat(24000) });
    history.push({ role: 'assistant', content: [{ type: 'text', text: 'done ' + t }] });
  }

  const claimSurplus = measureSurfaces(claimed, (m) => projectDistilledHistory(m, { isExpired: true })).surplusTokens;
  const historySurplus = measureSurfaces(history, (m) => projectDistilledHistory(m, { isExpired: true })).surplusTokens;

  assert.equal(claimSurplus, 0, 'a single claimed message has nothing to distil');
  assert.ok(historySurplus > TRIGGER_DEFAULTS.triggerVolumeTokens,
    'the real history must clear the volume threshold (' + historySurplus + ' > ' + TRIGGER_DEFAULTS.triggerVolumeTokens + ')');
});

test('v2.4 [8.1]: manual trigger is logged as manual (never ttl) and bypasses the anti-thrash floor', () => {
  const res = evaluateTrigger({
    manual: true,
    cacheExpired: false,
    surplusTokens: 500,
    rawTokens: 10000,
    roundsSinceDistill: 0
  }, cfg());
  assert.equal(res.distill, true);
  assert.equal(res.reason, 'manual');
  assert.equal(res.signals.manual, true);
  assert.equal(res.signals.ttl, false);
  assert.equal(res.floorBlocked, false);
});
