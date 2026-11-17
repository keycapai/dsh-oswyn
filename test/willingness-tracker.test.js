/**
 * dsh-oswyn/test/willingness-tracker.test.js
 * Comprehensive unit test suite for WillingnessTracker, Adaptive Nudge Generator,
 * Zero-False-Positive Guards, and pre-step / session-event hook integration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WillingnessTracker,
  isStep0ExemptTarget,
  extractMessageText
} from '../lib/session/willingness-tracker.js';

import {
  buildAdaptiveNudgeNotice,
  collectNudgeCandidates,
  buildNudgePromptText
} from '../lib/prompts/nudge.js';

import {
  apply,
  getSessionTracker
} from '../lib/index.js';

function makeMockCtx() {
  const hooks = {};
  const effectCleanups = [];
  return {
    _hooks: hooks,
    on(event, handler) {
      hooks[event] = handler;
      return () => { delete hooks[event]; };
    },
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') effectCleanups.push(cleanup);
    },
    logger: {
      info() {},
      debug() {},
      warn() {},
      error() {}
    }
  };
}

// ============================================================================
// Suite 1: Tracker Instantiation, State & Lifecycle
// ============================================================================

test('Suite 1 [1.1]: WillingnessTracker initializes with contract defaults', () => {
  const tracker = new WillingnessTracker();
  assert.equal(tracker.uncompressedStepThreshold, 2);
  assert.equal(tracker.accumulatedPayloadThreshold, 2000);
  assert.equal(tracker.cooldownSteps, 2);
  assert.equal(tracker.minChars, 600);
  assert.equal(tracker.coldStartSteps, 2);
  assert.equal(tracker.deepHorizonTurns, 8);

  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);
  assert.equal(tracker.lastCompressStep, null);
  assert.equal(tracker.lastNudgeStep, null);
  assert.equal(tracker.totalStepsRecorded, 0);
});

test('Suite 1 [1.2]: WillingnessTracker accepts custom options', () => {
  const tracker = new WillingnessTracker({
    uncompressedStepThreshold: 4,
    accumulatedPayloadThreshold: 5000,
    cooldownSteps: 3,
    minChars: 800,
    coldStartSteps: 1,
    deepHorizonTurns: 6
  });

  assert.equal(tracker.uncompressedStepThreshold, 4);
  assert.equal(tracker.accumulatedPayloadThreshold, 5000);
  assert.equal(tracker.cooldownSteps, 3);
  assert.equal(tracker.minChars, 800);
  assert.equal(tracker.coldStartSteps, 1);
  assert.equal(tracker.deepHorizonTurns, 6);
});

test('Suite 1 [1.3]: Non-numeric, negative, boolean, and null options fall back to safe defaults', () => {
  const tracker = new WillingnessTracker({
    uncompressedStepThreshold: -10,
    accumulatedPayloadThreshold: 'invalid_number',
    cooldownSteps: true,
    minChars: null,
    coldStartSteps: -2,
    deepHorizonTurns: undefined
  });

  assert.equal(tracker.uncompressedStepThreshold, 2);
  assert.equal(tracker.accumulatedPayloadThreshold, 2000);
  assert.equal(tracker.cooldownSteps, 2);
  assert.equal(tracker.minChars, 600);
  assert.equal(tracker.coldStartSteps, 2);
  assert.equal(tracker.deepHorizonTurns, 8);
});

test('Suite 1 [1.4]: reset() restores pristine state and is idempotent', () => {
  const tracker = new WillingnessTracker();
  tracker.consecutiveUncompressedSteps = 5;
  tracker.accumulatedUncompressedChars = 8400;
  tracker.lastCompressStep = 4;
  tracker.recordNudgeEmitted(7);
  tracker.totalStepsRecorded = 9;

  tracker.reset();
  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);
  assert.equal(tracker.lastCompressStep, null);
  assert.equal(tracker.lastNudgeStep, null);
  assert.equal(tracker.totalStepsRecorded, 0);

  // Consecutive calls to reset() do not throw or alter clean state
  tracker.reset();
  tracker.reset();
  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.totalStepsRecorded, 0);
});

// ============================================================================
// Suite 2: State Updates & Distillation Detection
// ============================================================================

test('Suite 2 [2.1]: updateStep increments counters on uncompressed noisy tools', () => {
  const tracker = new WillingnessTracker({ minChars: 600 });
  const noisyMessages = [
    { role: 'tool', toolName: 'bash', content: 'x'.repeat(1200) }
  ];

  tracker.updateStep({
    turn: 3,
    step: 3,
    outgoingMessages: noisyMessages,
    incomingDecision: { role: 'assistant', content: 'Normal response without fence' }
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 1);
  assert.equal(tracker.accumulatedUncompressedChars, 1200);
  assert.equal(tracker.totalStepsRecorded, 1);
});

test('Suite 2 [2.2]: Sub-threshold and empty tools do not increment counters', () => {
  const tracker = new WillingnessTracker({ minChars: 600 });
  const smallOutput = [{ role: 'tool', toolName: 'status', content: 'OK' }];

  tracker.updateStep({
    turn: 1,
    step: 1,
    outgoingMessages: smallOutput,
    incomingDecision: { role: 'assistant', content: 'Status check done' }
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);

  const emptyOutput = [{ role: 'tool', toolName: 'exec', content: '' }];
  tracker.updateStep({
    turn: 2,
    step: 2,
    outgoingMessages: emptyOutput,
    incomingDecision: { role: 'assistant', content: 'Empty output' }
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);
});

test('Suite 2 [2.3]: Tool error outputs count as candidates even when below minChars', () => {
  const tracker = new WillingnessTracker({ minChars: 600 });
  const errorOutput = [{ role: 'tool', toolName: 'bash', content: 'Error: exit 1', isError: true }];

  tracker.updateStep({
    turn: 2,
    step: 2,
    outgoingMessages: errorOutput,
    incomingDecision: { role: 'assistant', content: 'Acknowledged failure' }
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 1);
  assert.equal(tracker.accumulatedUncompressedChars, 'Error: exit 1'.length);
});

test('Suite 2 [2.4]: Valid summary fence immediately resets uncompressed counters', () => {
  const tracker = new WillingnessTracker();
  tracker.consecutiveUncompressedSteps = 4;
  tracker.accumulatedUncompressedChars = 9500;

  const summaryDecision = {
    role: 'assistant',
    content: '```dsh-result-summary\ntruncate keep 10 lines\n- Handled error output\n```'
  };

  tracker.updateStep({
    turn: 5,
    step: 5,
    outgoingMessages: [],
    incomingDecision: summaryDecision
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);
  assert.equal(tracker.lastCompressStep, 5);
});

test('Suite 2 [2.5]: XML-style summary tags and reply summaries reset counters', () => {
  const tracker = new WillingnessTracker();
  tracker.consecutiveUncompressedSteps = 3;
  tracker.accumulatedUncompressedChars = 6000;

  const xmlDecision = {
    role: 'assistant',
    content: '<dsh-result-summary mode="discard">\n- Cleaned up build errors\n</dsh-result-summary>'
  };

  tracker.updateStep({
    turn: 6,
    step: 6,
    outgoingMessages: [],
    incomingDecision: xmlDecision
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 0);
  assert.equal(tracker.accumulatedUncompressedChars, 0);
  assert.equal(tracker.lastCompressStep, 6);
});

// ============================================================================
// Suite 3: All 5 Zero-False-Positive Guards
// ============================================================================

test('Suite 3 [3.1]: Guard 1 — Step 0 Exemption strictly suppresses nudge on config, env, and secrets', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0 });
  tracker.consecutiveUncompressedSteps = 10; // Severe deficit
  tracker.accumulatedUncompressedChars = 30000;

  const targets = [
    '.env',
    '.env.production',
    'config/database.yaml',
    'settings.json',
    'auth.ini',
    'credentials.toml',
    'secret_token.txt'
  ];

  for (const target of targets) {
    const exemptTool = [{
      role: 'tool',
      toolName: 'read_file',
      content: 'SECRET_CONFIG_DATA=value\n'.repeat(40),
      callArgs: { file_path: target }
    }];

    const dec = tracker.evaluateNudgeNeeded({
      turn: 8,
      step: 8,
      outgoingMessages: exemptTool,
      session: { totalTokens: 10000 }
    });

    assert.equal(dec.shouldNudge, false, `Target ${target} must be exempt`);
    assert.equal(dec.reason, 'STEP_0_EXEMPTION');
    assert.deepEqual(dec.candidateTargets, []);
  }
});

test('Suite 3 [3.2]: Guard 1 — Mixed tools step targets only non-exempt candidate', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0, uncompressedStepThreshold: 1 });
  tracker.consecutiveUncompressedSteps = 1;

  const mixed = [
    { role: 'tool', toolName: 'read_env', content: 'DB_PORT=5432', callArgs: { file_path: '.env' } },
    { role: 'tool', toolName: 'bash_logs', content: 'x'.repeat(2500), callArgs: { command: 'cat logs.txt' } }
  ];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 4,
    step: 4,
    outgoingMessages: mixed,
    session: { totalTokens: 8000 }
  });

  assert.equal(dec.shouldNudge, true);
  assert.equal(dec.candidateTargets.length, 1);
  assert.equal(dec.candidateTargets[0].toolName, 'bash_logs');
});

test('Suite 3 [3.3]: Guard 2 — Cold-Start Silence suppresses nudge during initial turns', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 2 });
  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(3000) }];

  // Turn 1, tokens < 4000
  const dec1 = tracker.evaluateNudgeNeeded({
    turn: 1,
    step: 1,
    outgoingMessages: noisy,
    session: { totalTokens: 1500 }
  });
  assert.equal(dec1.shouldNudge, false);
  assert.equal(dec1.reason, 'COLD_START_SILENCE');

  // Turn 2, tokens < 4000
  const dec2 = tracker.evaluateNudgeNeeded({
    turn: 2,
    step: 2,
    outgoingMessages: noisy,
    session: { totalTokens: 3200 }
  });
  assert.equal(dec2.shouldNudge, false);
  assert.equal(dec2.reason, 'COLD_START_SILENCE');

  // Turn 3, cold start expired -> allows trigger
  tracker.consecutiveUncompressedSteps = 2;
  const dec3 = tracker.evaluateNudgeNeeded({
    turn: 3,
    step: 3,
    outgoingMessages: noisy,
    session: { totalTokens: 5000 }
  });
  assert.equal(dec3.shouldNudge, true);
});

test('Suite 3 [3.4]: Guard 3 — Active-Compliance Silence suppresses nudge if prior step compressed', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0 });
  tracker.lastCompressStep = 7;

  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(2500) }];
  const dec = tracker.evaluateNudgeNeeded({
    turn: 8,
    step: 8,
    outgoingMessages: noisy,
    session: { totalTokens: 9000 }
  });

  assert.equal(dec.shouldNudge, false);
  assert.equal(dec.reason, 'ALREADY_COMPRESSED');
});

test('Suite 3 [3.5]: Guard 4 — Cooldown window suppresses consecutive nudges', () => {
  const tracker = new WillingnessTracker({ cooldownSteps: 2, coldStartSteps: 0 });
  tracker.recordNudgeEmitted(10);
  tracker.consecutiveUncompressedSteps = 3;

  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(2500) }];

  // Step 11: delta = 1 < 2 -> COOLDOWN_ACTIVE
  const dec11 = tracker.evaluateNudgeNeeded({
    turn: 11,
    step: 11,
    outgoingMessages: noisy,
    session: { totalTokens: 8000 }
  });
  assert.equal(dec11.shouldNudge, false);
  assert.equal(dec11.reason, 'COOLDOWN_ACTIVE');

  // Step 12: delta = 2 >= 2 -> Cooldown expired
  const dec12 = tracker.evaluateNudgeNeeded({
    turn: 12,
    step: 12,
    outgoingMessages: noisy,
    session: { totalTokens: 8000 }
  });
  assert.equal(dec12.shouldNudge, true);
});

test('Suite 3 [3.6]: Guard 5 — Final-turn reasoning-first exemption silences nudges', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0 });
  tracker.consecutiveUncompressedSteps = 5;

  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(2500) }];
  const dec = tracker.evaluateNudgeNeeded({
    turn: 15,
    step: 15,
    outgoingMessages: noisy,
    session: { totalTokens: 12000, isFinalSynthesis: true }
  });

  assert.equal(dec.shouldNudge, false);
  assert.equal(dec.reason, 'FINAL_TURN_EXEMPTION');
});

// ============================================================================
// Suite 4: Deficit Detection & Tier Selection
// ============================================================================

test('Suite 4 [4.1]: Critical error triggers immediate contractual discard recommendation', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0 });
  const errorTool = [
    { role: 'tool', toolName: 'bash', content: 'FATAL: database connection refused\n'.repeat(15), isError: true }
  ];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 4,
    step: 4,
    outgoingMessages: errorTool,
    session: { totalTokens: 6000 }
  });

  assert.equal(dec.shouldNudge, true);
  assert.equal(dec.tier, 'contractual');
  assert.equal(dec.reason, 'CRITICAL_ERROR_STACK');
  assert.equal(dec.candidateTargets.length, 1);
});

test('Suite 4 [4.2]: Consecutive uncompressed steps trigger contractual inertia nudge', () => {
  const tracker = new WillingnessTracker({ uncompressedStepThreshold: 2, coldStartSteps: 0 });
  tracker.consecutiveUncompressedSteps = 2;
  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(1500) }];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 5,
    step: 5,
    outgoingMessages: noisy,
    session: { totalTokens: 6000 }
  });

  assert.equal(dec.shouldNudge, true);
  assert.equal(dec.tier, 'contractual');
  assert.equal(dec.reason, 'CONSECUTIVE_UNCOMPRESSED_INERTIA');
});

test('Suite 4 [4.3]: Accumulated payload bloat triggers budget alert', () => {
  const tracker = new WillingnessTracker({ accumulatedPayloadThreshold: 2000, coldStartSteps: 0 });
  tracker.accumulatedUncompressedChars = 1500;
  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(800) }];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 6,
    step: 6,
    outgoingMessages: noisy,
    session: { totalTokens: 7000 }
  });

  assert.equal(dec.shouldNudge, true);
  assert.equal(dec.tier, 'budget');
  assert.equal(dec.reason, 'CUMULATIVE_PAYLOAD_BLOAT');
});

test('Suite 4 [4.4]: Deep turn horizon triggers attention dilution budget alert', () => {
  const tracker = new WillingnessTracker({ deepHorizonTurns: 8, coldStartSteps: 0 });
  const noisy = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(1000) }];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 8,
    step: 8,
    outgoingMessages: noisy,
    session: { totalTokens: 10000 }
  });

  assert.equal(dec.shouldNudge, true);
  assert.equal(dec.tier, 'budget');
  assert.equal(dec.reason, 'DEEP_TURN_ATTENTION_DILUTION');
});

test('Suite 4 [4.5]: Returns healthy bounds when no thresholds are breached', () => {
  const tracker = new WillingnessTracker({ coldStartSteps: 0, minChars: 600 });
  const smallOutput = [{ role: 'tool', toolName: 'bash', content: 'x'.repeat(200) }];

  const dec = tracker.evaluateNudgeNeeded({
    turn: 3,
    step: 3,
    outgoingMessages: smallOutput,
    session: { totalTokens: 5000 }
  });

  assert.equal(dec.shouldNudge, false);
  assert.equal(dec.reason, 'HEALTHY_BOUNDS');
});

// ============================================================================
// Suite 5: Adaptive Prompt Notice Generation (buildAdaptiveNudgeNotice)
// ============================================================================

test('Suite 5 [5.1]: buildAdaptiveNudgeNotice returns null for null/none tier', () => {
  assert.equal(buildAdaptiveNudgeNotice(null), null);
  assert.equal(buildAdaptiveNudgeNotice('none'), null);
  assert.equal(buildAdaptiveNudgeNotice(''), null);
});

test('Suite 5 [5.2]: buildAdaptiveNudgeNotice formats Tier 2 Contractual notice correctly', () => {
  const candidates = [{ toolName: 'bash_test', chars: 3200 }];
  const notice = buildAdaptiveNudgeNotice('contractual', candidates);

  assert.ok(notice.includes('DSH-OSWYN 双通道共发契约唤醒'));
  assert.ok(notice.includes('bash_test'));
  assert.ok(notice.includes('3200'));
  assert.ok(notice.includes('truncate 或 discard'));
  assert.ok(notice.includes('Step 0 豁免'));
  // The nudge now advertises the fenced form only: XML tags used to be suggested
  // but were never parsed, so models emitted fences that compressed nothing.
  assert.match(notice, /\u0060\u0060\u0060(?:dsh-)?result-summary/);
  assert.ok(!notice.includes('mode="..."'));
});

test('Suite 5 [5.3]: buildAdaptiveNudgeNotice formats Tier 3 Budget notice correctly', () => {
  const candidates = [{ toolName: 'grep_search', chars: 5400 }];
  const notice = buildAdaptiveNudgeNotice('budget', candidates);

  assert.ok(notice.includes('DSH-OSWYN 载荷膨胀预算预警'));
  assert.ok(notice.includes('5400'));
  assert.ok(notice.includes('KV-Cache 注意力正在严重稀释'));
  assert.ok(notice.includes('Step 0 豁免'));
});

test('Suite 5 [5.4]: buildAdaptiveNudgeNotice formats Tier 1 Advisory notice correctly', () => {
  const candidates = [{ toolName: 'read_logs', chars: 1800 }];
  const notice = buildAdaptiveNudgeNotice('advisory', candidates);

  assert.ok(notice.includes('DSH-OSWYN 上下文精炼建议'));
  assert.ok(notice.includes('1800'));
  assert.ok(notice.includes('Step 0 豁免'));
});

// ============================================================================
// Suite 6: Hook Integration & Session Isolation
// ============================================================================

test('Suite 6 [6.1]: getSessionTracker provides session-scoped isolation', () => {
  const tracker1 = getSessionTracker({ id: 'sess_alpha' });
  const tracker2 = getSessionTracker({ id: 'sess_beta' });

  tracker1.consecutiveUncompressedSteps = 4;
  tracker1.accumulatedUncompressedChars = 8000;

  assert.equal(tracker2.consecutiveUncompressedSteps, 0);
  assert.equal(tracker2.accumulatedUncompressedChars, 0);
});

test('Suite 6 [6.2]: agent/pre-step hook evaluates adaptive nudge and appends ephemeral message', async () => {
  const ctx = makeMockCtx();
  apply(ctx, {
    enabled: true,
    adaptiveNudgeEnabled: true,
    uncompressedStepThreshold: 1,
    coldStartSteps: 0
  });

  const hook = ctx._hooks['agent/pre-step'];
  assert.equal(typeof hook, 'function');

  const session = { id: 'sess_hook_test_1', totalTokens: 6000 };
  const tracker = getSessionTracker(session);
  tracker.consecutiveUncompressedSteps = 2; // trigger inertia

  const baseMessages = [
    { role: 'user', content: [{ type: 'text', text: 'Run diagnostics' }] },
    { role: 'tool', toolName: 'bash', content: [{ type: 'text', text: 'x'.repeat(1500) }] }
  ];

  const decision = await hook(
    { agent: { session }, turn: 4, step: 4, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: baseMessages })
  );

  assert.equal(decision.messages.length, baseMessages.length + 1, 'Ephemeral nudge must be appended');
  const nudge = decision.messages[decision.messages.length - 1];
  assert.equal(nudge.role, 'user');
  assert.equal(nudge.source?.kind, 'oswyn-nudge');
  assert.ok(nudge.content[0].text.includes('DSH-OSWYN 双通道共发契约唤醒'));
  assert.equal(tracker.lastNudgeStep, 4);

  // Invariant: Prefix is strictly identical (100% KV cache hit)
  assert.deepEqual(decision.messages.slice(0, baseMessages.length), baseMessages);
});

test('Suite 6 [6.3]: agent/pre-step hook respects Step 0 Exemption in multi-turn mode', async () => {
  const ctx = makeMockCtx();
  apply(ctx, {
    enabled: true,
    adaptiveNudgeEnabled: true,
    coldStartSteps: 0
  });

  const hook = ctx._hooks['agent/pre-step'];
  const session = { id: 'sess_hook_test_exempt', totalTokens: 8000 };
  const tracker = getSessionTracker(session);
  tracker.consecutiveUncompressedSteps = 5;

  const baseMessages = [
    { role: 'user', content: [{ type: 'text', text: 'Read secret' }] },
    {
      role: 'tool',
      toolName: 'read',
      content: [{ type: 'text', text: 'SECRET_API_KEY=sk_live_123456\n'.repeat(20) }],
      callArgs: { file_path: '.env.local' }
    }
  ];

  const decision = await hook(
    { agent: { session }, turn: 6, step: 6, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: baseMessages })
  );

  assert.equal(decision.messages.length, baseMessages.length, 'Must NOT append nudge on exempt target');
});

test('Suite 6 [6.4]: agent/pre-step hook injects ephemeral nudge during autonomous tool execution with empty decision.messages', async () => {
  const ctx = makeMockCtx();
  apply(ctx, {
    enabled: true,
    adaptiveNudgeEnabled: true,
    uncompressedStepThreshold: 1,
    coldStartSteps: 0
  });

  const hook = ctx._hooks['agent/pre-step'];
  assert.equal(typeof hook, 'function');

  const derived = [
    { role: 'user', content: [{ type: 'text', text: '有什么新闻' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Searching web...' }] },
    { role: 'tool', toolName: 'web_search', content: [{ type: 'text', text: 'Headlines:\n' + 'breaking news '.repeat(100) }] }
  ];

  const session = {
    id: 'sess_autonomous_loop_1',
    deriveMessages() { return derived; },
    tokenMeasurement: { anchor: { usage: { totalTokens: 6500 } } }
  };

  const tracker = getSessionTracker(session);
  tracker.consecutiveUncompressedSteps = 2; // Inertia threshold breached

  // Autonomous continuation: incoming decision.messages is empty!
  const decision = await hook(
    { agent: { session }, turn: 1, step: 3, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [] })
  );

  assert.equal(decision.messages.length, 1, 'Ephemeral nudge must be appended even when incoming decision.messages is empty');
  const nudge = decision.messages[0];
  assert.equal(nudge.role, 'user');
  assert.equal(nudge.source?.kind, 'oswyn-nudge');
  assert.ok(nudge.content[0].text.includes('DSH-OSWYN 双通道共发契约唤醒') || nudge.content[0].text.includes('DSH-OSWYN'));
  assert.equal(tracker.lastNudgeStep, 3);
});

test('Suite 6 [6.5]: session/event updates tracker step via deriveMessages when session.messages is undefined', async () => {
  const ctx = makeMockCtx();
  apply(ctx, {
    enabled: true,
    adaptiveNudgeEnabled: true
  });

  const derived = [
    { role: 'user', content: [{ type: 'text', text: 'Run query' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Querying...' }] },
    { role: 'tool', toolName: 'sql_query', content: [{ type: 'text', text: 'RESULT ROW '.repeat(120) }] }
  ];

  const session = {
    id: 'sess_event_derive_test',
    deriveMessages() { return derived; }
    // Note: session.messages is intentionally undefined, mirroring real DSH Session
  };

  const tracker = getSessionTracker(session);
  assert.equal(tracker.consecutiveUncompressedSteps, 0);

  // Trigger session/event with assistant message lacking distillation fence
  const handler = ctx._hooks['session/event'];
  assert.equal(typeof handler, 'function');

  handler(session, {
    seq: 10,
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Here are the results.' }] } }
  });

  assert.equal(tracker.consecutiveUncompressedSteps, 1, 'Tracker must inspect derived messages and increment uncompressed steps');
  assert.ok(tracker.accumulatedUncompressedChars > 600, 'Accumulated uncompressed chars must be counted from derived messages');
});
