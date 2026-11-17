/**
 * test/post-cache-distill.test.js
 *
 * Comprehensive unit tests for OSWYN v2.3 Post-Cache Deep Distillation:
 * 1. Cache TTL & idle expiration detection (isCacheExpired)
 * 2. Deep distillation projection (stripping thinking & tool calls on cache miss)
 * 3. Round-based multimodal recall primitives (think-only, tool-only, both)
 * 4. Surface mask re-instatement and turn boundary integrity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCacheExpired,
  recordSessionActivity,
  getSessionLastActiveTime,
  setRoundRecall,
  clearRoundRecall,
  initSessionRecallState
} from '../lib/session/surface.js';
import {
  stripThinkingTags,
  partitionMessagesIntoTurns,
  projectDistilledHistory
} from '../lib/core/projection.js';
import { registerRecallTool } from '../lib/tools/recall.js';

// ============================================================================
// Suite 1: Cache Expiration Dynamics (TTL & Idle Detection)
// ============================================================================

test('Suite 1 [1.1]: isCacheExpired returns false for fresh sessions with recent activity', () => {
  const session = { id: 'sess_fresh' };
  const now = 1700000000000;
  recordSessionActivity(session, now - 60000); // 60s ago

  const expired = isCacheExpired(session, { now, cacheTtlSeconds: 300 });
  assert.equal(expired, false, '60s idle must not trigger 300s TTL expiration');
});

test('Suite 1 [1.2]: isCacheExpired returns true when idle time breaches TTL threshold', () => {
  const session = { id: 'sess_stale' };
  const now = 1700000000000;
  recordSessionActivity(session, now - 301000); // 301s ago

  const expired = isCacheExpired(session, { now, cacheTtlSeconds: 300 });
  assert.equal(expired, true, '301s idle must trigger 300s TTL expiration');
});

test('Suite 1 [1.2b]: isCacheExpired evaluates cacheTtlHours defaulting to 24 hours', () => {
  const session = { id: 'sess_hours' };
  const now = 1700000000000;
  const ONE_HOUR = 3600 * 1000;

  // 23 hours idle -> not expired under 24h default
  recordSessionActivity(session, now - 23 * ONE_HOUR);
  assert.equal(isCacheExpired(session, { now }), false, '23h idle must not expire under 24h default');

  // 25 hours idle -> expired under 24h default
  recordSessionActivity(session, now - 25 * ONE_HOUR);
  assert.equal(isCacheExpired(session, { now }), true, '25h idle must expire under 24h default');

  // Custom cacheTtlHours: 12
  recordSessionActivity(session, now - 13 * ONE_HOUR);
  assert.equal(isCacheExpired(session, { now, cacheTtlHours: 12 }), true, '13h idle must expire under 12h TTL');
});

test('Suite 1 [1.3]: forceCacheExpired override takes immediate precedence', () => {
  const session = { id: 'sess_force', forceCacheExpired: true };
  const now = 1700000000000;
  recordSessionActivity(session, now); // 0s idle

  assert.equal(isCacheExpired(session, { now }), true, 'forceCacheExpired on session must trigger');
  assert.equal(isCacheExpired({}, { forceCacheExpired: true }), true, 'forceCacheExpired on options must trigger');
  assert.equal(isCacheExpired(session, { forceCacheExpired: false }), false, 'forceCacheExpired false on options must suppress');
});

// ============================================================================
// Suite 2: stripThinkingTags Primitives
// ============================================================================

test('Suite 2 [2.1]: stripThinkingTags cleans <think> and <thinking> blocks from text', () => {
  const raw = '<think>Internal chain of thought\nAnalyzing syntax...</think>Final concise answer to user.';
  const cleaned = stripThinkingTags(raw);
  assert.equal(cleaned, 'Final concise answer to user.');
});

test('Suite 2 [2.2]: stripThinkingTags cleans content blocks and preserves non-thinking blocks', () => {
  const blocks = [
    { type: 'thinking', thinking: 'Secret reasoning' },
    { type: 'text', text: '<think>Step 1... Step 2...</think>Result: 42' }
  ];
  const cleaned = stripThinkingTags(blocks);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text, 'Result: 42');
});

// ============================================================================
// Suite 3: Turn Partitioning & Post-Cache Deep Distillation
// ============================================================================

function makeMultiTurnHistory() {
  return [
    { role: 'system', content: 'You are an AI assistant.' },
    // Turn 1
    { role: 'user', content: 'Search for recent files' },
    {
      role: 'assistant',
      content: '<think>Let me run bash to find files.</think>Running find command.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'file1.ts\nfile2.ts\nfile3.ts' },
    {
      role: 'assistant',
      content: '<think>Found 3 files.</think>Here are the 3 files: file1.ts, file2.ts, file3.ts'
    },
    // Turn 2 (Current turn)
    { role: 'user', content: 'Now inspect file1.ts' },
    {
      role: 'assistant',
      content: '<think>Active reasoning for turn 2.</think>',
      tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read', arguments: '{"file":"file1.ts"}' } }]
    }
  ];
}

test('Suite 3 [1.1]: projectDistilledHistory preserves messages untouched when cache is active (hit)', () => {
  const history = makeMultiTurnHistory();
  const session = { id: 'sess_active', lastActiveTime: Date.now() - 5000 };

  const projected = projectDistilledHistory(history, { session, cacheTtlSeconds: 300, now: Date.now() });
  assert.deepEqual(projected, history, 'Active cache must keep byte-for-byte history untouched');
});

test('Suite 3 [1.2]: projectDistilledHistory strips historical thinking and tool calls on cache expiration (miss)', () => {
  const history = makeMultiTurnHistory();
  const session = { id: 'sess_expired', forceCacheExpired: true };

  const projected = projectDistilledHistory(history, { session });

  // System prompt intact
  assert.equal(projected[0].role, 'system');

  // Turn 1 User prompt intact
  assert.equal(projected[1].role, 'user');
  assert.equal(projected[1].content, 'Search for recent files');

  // Turn 1 intermediate tool calls and tool results STRIPPED!
  const hasToolMsg = projected.some((m) => m.role === 'tool');
  assert.equal(hasToolMsg, false, 'All historical tool/result messages must be stripped');

  // Turn 1 Assistant responses stripped of thinking and tool_calls
  const turn1Assistant = projected.find((m) => m.role === 'assistant' && m.content.includes('Here are the 3 files'));
  assert.ok(turn1Assistant, 'Must retain compact assistant answer');
  assert.equal(turn1Assistant.content.includes('<think>'), false, '<think> tags must be stripped');
  assert.equal('tool_calls' in turn1Assistant, false, 'tool_calls property must be stripped');

  // Current turn (Turn 2) must remain completely untouched!
  const turn2User = projected.find((m) => m.role === 'user' && m.content === 'Now inspect file1.ts');
  assert.ok(turn2User);
  const turn2Assistant = projected[projected.length - 1];
  assert.ok(turn2Assistant.content.includes('<think>Active reasoning for turn 2.</think>'), 'Active turn reasoning must be preserved');
  assert.ok(Array.isArray(turn2Assistant.tool_calls) && turn2Assistant.tool_calls.length === 1, 'Active turn tool calls must be preserved');
});

// ============================================================================
// Suite 4: Fine-Grained Multimodal Round-Based Recall
// ============================================================================

test('Suite 4 [4.1]: setRoundRecall with mode="think" restores thinking only while tools stay stripped', () => {
  const history = makeMultiTurnHistory();
  const session = { id: 'sess_recall_think', forceCacheExpired: true };
  setRoundRecall(session, 1, 'think');

  const projected = projectDistilledHistory(history, { session, activeRecalls: session.activeRecalls });

  // Thinking restored in Turn 1
  const t1Assistants = projected.filter((m, idx) => idx > 0 && idx < projected.length - 2 && m.role === 'assistant');
  const hasThinking = t1Assistants.some((m) => m.content && m.content.includes('<think>'));
  assert.equal(hasThinking, true, 'Thinking tags must be restored for Round 1 under mode="think"');

  // Tools still stripped
  const hasTool = projected.some((m) => m.role === 'tool');
  assert.equal(hasTool, false, 'Tools must remain stripped for Round 1 under mode="think"');
});

test('Suite 4 [4.2]: setRoundRecall with mode="tool" restores tool calls while thinking stays stripped', () => {
  const history = makeMultiTurnHistory();
  const session = { id: 'sess_recall_tool', forceCacheExpired: true };
  setRoundRecall(session, 1, 'tool');

  const projected = projectDistilledHistory(history, { session, activeRecalls: session.activeRecalls });

  // Tools restored in Turn 1
  const hasTool = projected.some((m) => m.role === 'tool' && m.content.includes('file1.ts'));
  assert.equal(hasTool, true, 'Tool results must be restored for Round 1 under mode="tool"');

  // Thinking still stripped
  const t1Final = projected.find((m) => m.role === 'assistant' && m.content && m.content.includes('Here are the 3 files'));
  assert.ok(t1Final);
  assert.equal(t1Final.content.includes('<think>'), false, 'Thinking must remain stripped under mode="tool"');
});

test('Suite 4 [4.3]: setRoundRecall with mode="both" restores both thinking and tools', () => {
  const history = makeMultiTurnHistory();
  const session = { id: 'sess_recall_both', forceCacheExpired: true };
  setRoundRecall(session, 1, 'both');

  const projected = projectDistilledHistory(history, { session, activeRecalls: session.activeRecalls });

  // Both restored
  const hasTool = projected.some((m) => m.role === 'tool');
  const hasThink = projected.some((m) => m.role === 'assistant' && m.content && m.content.includes('<think>Found 3 files.'));
  assert.equal(hasTool, true, 'Tools must be restored under mode="both"');
  assert.equal(hasThink, true, 'Thinking must be restored under mode="both"');
});

// ============================================================================
// Suite 5: tool_result_recall Tool Execution with Round-Based Selectors
// ============================================================================

test('Suite 5 [5.1]: tool_result_recall executes round-based recall for thinking', async () => {
  const registeredTools = {};
  const mockCtx = {
    tools: {
      register: (t) => { registeredTools[t.name] = t; }
    }
  };
  registerRecallTool(mockCtx);
  const recallTool = registeredTools['tool_result_recall'];
  assert.ok(recallTool, 'tool_result_recall must be registered');

  const history = makeMultiTurnHistory();
  const session = {
    id: 'sess_tool_test_1',
    deriveMessages: () => history,
    activeRecalls: new Map()
  };

  const res = recallTool.execute({ round: 1, mode: 'think' }, { agent: { session } });
  assert.equal(res.found, true);
  assert.equal(res.round, 1);
  assert.equal(res.mode, 'think');
  assert.ok(res.text.includes('Assistant Thinking'));
  assert.ok(res.text.includes('Let me run bash to find files'));
  assert.equal(session.activeRecalls.get(1), 'think', 'Must reinstate activeRecall on session');
});

test('Suite 5 [5.2]: tool_result_recall handles invalid round out-of-bounds gracefully', async () => {
  const registeredTools = {};
  const mockCtx = { tools: { register: (t) => { registeredTools[t.name] = t; } } };
  registerRecallTool(mockCtx);
  const recallTool = registeredTools['tool_result_recall'];

  const history = makeMultiTurnHistory(); // 2 turns
  const session = { id: 'sess_oob', deriveMessages: () => history };

  const res = recallTool.execute({ round: 99 }, { agent: { session } });
  assert.equal(res.found, false);
  assert.ok(res.reason.includes('does not exist'));
});
