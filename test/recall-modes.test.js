import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { registerRecallTool } from '../lib/tools/recall.js';
import { registerHistoryRecallTool } from '../lib/tools/history-recall.js';

test('tool_result_recall: classic recall by seq, callId, toolName, latest, latest-reply', () => {
  const tools = {};
  const mockCtx = { tools: { register: (t) => { tools[t.name] = t; } } };
  registerRecallTool(mockCtx);
  const recallTool = tools['tool_result_recall'];

  const session = new MockSession();
  // seed assistant message (seq 0)
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Assistant initial reply text' }] }
  }, { surfaceOp: 'append' });
  // seed tool call 1 (seq 1)
  session.seed('tool/call', { callId: 'call_bash_1', name: 'bash' });
  // seed tool result 1 (seq 2)
  session.seed('tool/result', {
    message: { source: { toolName: 'bash', callId: 'call_bash_1' }, content: [{ type: 'text', text: 'bash command output details' }] }
  }, { surfaceOp: 'append' });
  // seed tool call 2 (seq 3)
  session.seed('tool/call', { callId: 'call_read_2', name: 'read' });
  // seed tool result 2 (seq 4)
  session.seed('tool/result', {
    message: { source: { toolName: 'read', callId: 'call_read_2' }, content: [{ type: 'text', text: 'read file output line 1\nread file output line 2' }] }
  }, { surfaceOp: 'append' });
  // seed assistant follow-up reply (seq 5)
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Assistant final conclusion' }] }
  }, { surfaceOp: 'append' });

  const exec = { agent: { session } };

  // 1. By callId
  const byCallId = recallTool.execute({ seq: 'call_bash_1' }, exec);
  assert.equal(byCallId.found, true);
  assert.equal(byCallId.callId, 'call_bash_1');
  assert.equal(byCallId.toolName, 'bash');
  assert.ok(byCallId.text.includes('bash command output details'));

  // 2. By seq number
  const bySeq = recallTool.execute({ seq: '2' }, exec);
  assert.equal(bySeq.found, true);
  assert.equal(bySeq.seq, 2);
  assert.ok(bySeq.text.includes('bash command output details'));

  // 3. By toolName
  const byTool = recallTool.execute({ seq: 'read' }, exec);
  assert.equal(byTool.found, true);
  assert.equal(byTool.toolName, 'read');
  assert.ok(byTool.text.includes('read file output'));

  // 4. By latest
  const byLatest = recallTool.execute({ seq: 'latest' }, exec);
  assert.equal(byLatest.found, true);
  assert.equal(byLatest.seq, 4, 'latest tool result is seq 4');
  assert.equal(byLatest.toolName, 'read');

  // 5. By latest-reply
  const byLatestReply = recallTool.execute({ seq: 'latest-reply' }, exec);
  assert.equal(byLatestReply.found, true);
  assert.equal(byLatestReply.itemType, 'assistant/message');
  assert.ok(byLatestReply.text.includes('Assistant final conclusion'));

  // 6. With offset & limit
  const paged = recallTool.execute({ seq: 'call_bash_1', offset: 0, limit: 12 }, exec);
  assert.equal(paged.found, true);
  assert.equal(paged.returnedChars, 12);
  assert.equal(paged.text, 'bash command');
});

test('history_recall: recalls by round and step, defaults to thinking only', () => {
  const tools = {};
  const mockCtx = { tools: { register: (t) => { tools[t.name] = t; } } };
  registerHistoryRecallTool(mockCtx);
  const historyRecall = tools['history_recall'];

  const messages = [
    // Turn 1
    { role: 'user', content: 'Turn 1 user prompt' },
    // Step 1: think + tool call
    {
      role: 'assistant',
      content: '<think>Step 1 thinking: inspecting workspace</think>',
      tool_calls: [{ id: 'call_t1_1', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }]
    },
    { role: 'tool', tool_call_id: 'call_t1_1', name: 'bash', content: 'file1.txt\nfile2.txt' },
    // Step 2: think + final answer
    {
      role: 'assistant',
      content: '<think>Step 2 thinking: found 2 files</think>\nHere are your files.',
      tool_calls: []
    },
    // Turn 2
    { role: 'user', content: 'Turn 2 user prompt' },
    {
      role: 'assistant',
      content: '<think>Turn 2 thinking</think>\nAll done.'
    }
  ];

  const session = {
    id: 'test_hist_recall_sess',
    deriveMessages: () => messages,
    activeRecalls: new Map()
  };
  const exec = { agent: { session } };

  // 1. Round 1 default mode -> MUST be 'think'
  const r1Default = historyRecall.execute({ round: 1 }, exec);
  assert.equal(r1Default.found, true);
  assert.equal(r1Default.mode, 'think', 'Default mode must be think');
  assert.equal(r1Default.totalSteps, 2);
  assert.ok(r1Default.text.includes('Step 1 thinking: inspecting workspace'));
  assert.ok(r1Default.text.includes('Step 2 thinking: found 2 files'));
  assert.ok(!r1Default.text.includes('file1.txt'), 'Thinking mode must not include tool results');
  assert.equal(session.activeRecalls.get(1), 'think', 'Must reinstate round with think mode');

  // 2. Fine-grained step recall: Round 1, Step 1 only
  const r1s1 = historyRecall.execute({ round: 1, step: 1 }, exec);
  assert.equal(r1s1.found, true);
  assert.equal(r1s1.step, 1);
  assert.ok(r1s1.text.includes('Step 1 thinking'));
  assert.ok(!r1s1.text.includes('Step 2 thinking'), 'Step 1 recall must not include Step 2');

  // 3. Round 1, Step 1 with mode='tool'
  const r1s1Tool = historyRecall.execute({ round: 1, step: 1, mode: 'tool' }, exec);
  assert.equal(r1s1Tool.found, true);
  assert.equal(r1s1Tool.mode, 'tool');
  assert.ok(r1s1Tool.text.includes('Call call_t1_1: bash'));
  assert.ok(r1s1Tool.text.includes('file1.txt'));
  assert.ok(!r1s1Tool.text.includes('Step 1 thinking'), 'Tool mode must not include thinking');

  // 4. Round 1 with mode='both'
  const r1Both = historyRecall.execute({ round: 1, mode: 'both' }, exec);
  assert.equal(r1Both.found, true);
  assert.equal(r1Both.mode, 'both');
  assert.ok(r1Both.text.includes('Step 1 thinking'));
  assert.ok(r1Both.text.includes('file1.txt'));
});

test('tool_result_recall & history_recall: default returns compressed content, optional original: true returns raw', () => {
  const tools = {};
  const mockCtx = { tools: { register: (t) => { tools[t.name] = t; } } };
  registerRecallTool(mockCtx);
  registerHistoryRecallTool(mockCtx);
  const recallTool = tools['tool_result_recall'];
  const historyRecall = tools['history_recall'];

  const session = new MockSession();
  const rawLongOutput = Array.from({ length: 50 }, (_, i) => `LOG_ENTRY_${i + 1}: detailed raw trace data`).join('\n');

  // Seed user prompt
  session.seed('user/message', { role: 'user', content: [{ type: 'text', text: 'Run the analysis' }] }, { surfaceOp: 'append' });
  // Seed assistant tool call
  session.seed('tool/call', { callId: 'call_ana_1', name: 'analyze' });
  // Seed tool result origin
  const origin = session.seed('tool/result', {
    message: { role: 'tool', source: { toolName: 'analyze', callId: 'call_ana_1' }, content: [{ type: 'text', text: rawLongOutput }] }
  }, { surfaceOp: 'append' });

  // Simulate compression: replace origin on surface with a compressed summary
  const compressedContent = [{ type: 'text', text: '[oswyn-meta: before=2000 after=100 keep=0 mode=replace seq=' + origin.seq + ']\n- Analysis completed successfully' }];
  const replaceEvent = session.append('tool/result', {
    message: { role: 'tool', source: { toolName: 'analyze', callId: 'call_ana_1' }, content: compressedContent }
  }, {
    surfaceOp: { op: 'replace', startSeq: origin.seq, endSeq: origin.seq },
    sourceEventSeqs: [origin.seq]
  });

  // Seed assistant final reply
  session.seed('assistant/message', {
    message: { role: 'assistant', content: [{ type: 'text', text: 'Analysis is complete. All metrics green.' }] }
  }, { surfaceOp: 'append' });

  const exec = { agent: { session } };

  // 1. tool_result_recall default: returns the compressed content
  const recalledDefault = recallTool.execute({ seq: 'call_ana_1' }, exec);
  assert.equal(recalledDefault.found, true);
  assert.equal(recalledDefault.isOriginal, false, 'Default must not be original');
  assert.equal(recalledDefault.summarized, true, 'Item is summarized');
  assert.ok(recalledDefault.text.includes('[oswyn-meta:'), 'Default recall must contain compressed summary marker');
  assert.ok(!recalledDefault.text.includes('LOG_ENTRY_50'), 'Default recall must NOT contain raw uncompressed tail');

  // 2. tool_result_recall with original: true -> returns the raw pristine content
  const recalledOriginal = recallTool.execute({ seq: 'call_ana_1', original: true }, exec);
  assert.equal(recalledOriginal.found, true);
  assert.equal(recalledOriginal.isOriginal, true, 'original: true must set isOriginal to true');
  assert.ok(recalledOriginal.text.includes('LOG_ENTRY_50'), 'original: true must return pristine uncompressed output');
  assert.ok(!recalledOriginal.text.includes('[oswyn-meta:'), 'original: true must NOT return summary marker');

  // 3. tool_result_recall with raw: true -> alias for original: true
  const recalledRaw = recallTool.execute({ seq: 'call_ana_1', raw: true }, exec);
  assert.equal(recalledRaw.found, true);
  assert.equal(recalledRaw.isOriginal, true);
  assert.ok(recalledRaw.text.includes('LOG_ENTRY_50'));

  // 4. history_recall with mode='tool': default returns compressed content
  const histDefault = historyRecall.execute({ round: 1, mode: 'tool' }, exec);
  assert.equal(histDefault.found, true);
  assert.equal(histDefault.isOriginal, false);
  assert.ok(histDefault.text.includes('[oswyn-meta:'), 'Default history_recall tool mode must return compressed summary');
  assert.ok(!histDefault.text.includes('LOG_ENTRY_50'));

  // 5. history_recall with mode='tool', original: true: returns raw uncompressed content
  const histOriginal = historyRecall.execute({ round: 1, mode: 'tool', original: true }, exec);
  assert.equal(histOriginal.found, true);
  assert.equal(histOriginal.isOriginal, true);
  assert.ok(histOriginal.text.includes('LOG_ENTRY_50'), 'history_recall with original: true must return uncompressed raw output');
});

test('projectDistilledHistory: if turn has NO reply summary, strips result-summary and retains ONLY the clean final reply', async () => {
  const { projectDistilledHistory } = await import('../lib/core/projection.js');

  const messages = [
    // Turn 1 (historical)
    { role: 'user', content: 'Inspect the system status' },
    // Step 1: Intermediate assistant preamble + machine directive fence + tool call
    {
      role: 'assistant',
      content: '```result-summary: seq 1\nreplace\n- pre-check ok\n```\nI will check the logs now.',
      tool_calls: [{ id: 'c1', function: { name: 'bash', arguments: '{"cmd":"tail"}' } }]
    },
    { role: 'tool', tool_call_id: 'c1', content: 'log line 1\nlog line 2' },
    // Step 2: Final reply to the user, with machine result-summary fence that should be stripped
    {
      role: 'assistant',
      content: '```result-summary: seq 2\nreplace\n- analyzed logs\n```\nAll systems are fully operational.'
    },

    // Turn 2 (current active turn)
    { role: 'user', content: 'What about CPU usage?' },
    { role: 'assistant', content: 'CPU is at 12%.' }
  ];

  const projected = projectDistilledHistory(messages, { forceCacheExpired: true });

  // Turn 1 should now have:
  // 1. User message
  // 2. ONLY the final assistant reply, with the result-summary fence stripped!
  // Intermediate Step 1 (preamble + tool calls) should be omitted!
  assert.equal(projected[0].role, 'user');
  assert.equal(projected[0].content, 'Inspect the system status');

  assert.equal(projected[1].role, 'assistant');
  // Must NOT contain the result-summary fence
  assert.ok(!projected[1].content.includes('result-summary'), 'result-summary fence must be stripped');
  assert.ok(!projected[1].content.includes('pre-check ok'));
  // Must contain only the clean reply
  assert.equal(projected[1].content.trim(), 'All systems are fully operational.');

  // Intermediate Step 1 preamble ("I will check the logs now.") must NOT be present
  assert.ok(!projected.some((m) => typeof m.content === 'string' && m.content.includes('I will check the logs now')), 'Intermediate tool preamble must be dropped');

  // Turn 2 (current turn) is preserved intact
  assert.equal(projected[2].role, 'user');
  assert.equal(projected[2].content, 'What about CPU usage?');
  assert.equal(projected[3].role, 'assistant');
  assert.equal(projected[3].content, 'CPU is at 12%.');

  assert.equal(projected.length, 4, 'Must have exactly 4 messages (2 for turn 1, 2 for turn 2)');
});
