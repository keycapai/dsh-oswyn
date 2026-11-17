import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadClientModule() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let entry = null;
  const win = {
    __ModuleLoader__: {
      load(e) { entry = e; }
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}
  };
  const sandbox = {
    window: win,
    document: {
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: { setAttribute() {} },
      getElementById: () => null,
      querySelectorAll: () => []
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: {} }) }),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(entry, 'bundle loaded into __ModuleLoader__');
  const requireMock = (id) => {
    if (id === 'react') return { createElement: () => null, memo: (fn) => fn };
    return {};
  };
  return entry.factory(requireMock);
}

test('Projection: isPureResultSummaryText recognizes pure compression directive fences', () => {
  const mod = loadClientModule();
  const { isPureResultSummaryText } = mod;
  assert.equal(typeof isPureResultSummaryText, 'function', 'isPureResultSummaryText is exported');

  // Pure summary block
  const pureFence = '```dsh-result-summary\ntruncate keep 15 lines\nFINDINGS:\n- Found 12 items\n```';
  assert.equal(isPureResultSummaryText(pureFence), true, 'pure dsh-result-summary fence is recognized');

  // Pure discard directive with seq
  const discardFence = '```dsh-result-summary: seq 42\ndiscard\n- command failed\n```';
  assert.equal(isPureResultSummaryText(discardFence), true, 'pure discard fence is recognized');

  // Mixed block with human text
  const mixed = '```dsh-result-summary\ntruncate keep 10 lines\n```\n已排查出问题原因，正在执行下一步测试。';
  assert.equal(isPureResultSummaryText(mixed), false, 'mixed block with human prose is NOT pure');

  // Ordinary user prose
  const prose = '这里是普通的答复内容，没有任何围栏。';
  assert.equal(isPureResultSummaryText(prose), false, 'regular prose is NOT pure');

  // Empty or non-string
  assert.equal(isPureResultSummaryText(''), false);
  assert.equal(isPureResultSummaryText(null), false);
});

test('Projection: cleanAssistantBlocksForUi strips pure result-summary text only when tool-call is present', () => {
  const mod = loadClientModule();
  const { cleanAssistantBlocksForUi } = mod;

  // Case 1: Assistant step has a tool call and a pure dsh-result-summary text
  const blocksWithTool = [
    { kind: 'reasoning', text: 'Analyzing search results' },
    { kind: 'text', text: '```dsh-result-summary\ntruncate keep 15 lines\n```' },
    { kind: 'tool-call', callId: 'call_1', name: 'run_code', arguments: '{}' }
  ];
  const cleaned = cleanAssistantBlocksForUi(blocksWithTool);
  assert.equal(cleaned.length, 2, 'pure text fence removed when tool call is present');
  assert.equal(cleaned[0].kind, 'reasoning');
  assert.equal(cleaned[1].kind, 'tool-call');

  // Case 2: Mixed text alongside tool call preserves human text but strips fence
  const blocksMixed = [
    { kind: 'text', text: '```dsh-result-summary\ntruncate keep 15 lines\n```\n正在运行验证脚本...' },
    { kind: 'tool-call', callId: 'call_2', name: 'bash', arguments: '{}' }
  ];
  const cleanedMixed = cleanAssistantBlocksForUi(blocksMixed);
  assert.equal(cleanedMixed.length, 2);
  assert.equal(cleanedMixed[0].kind, 'text');
  assert.equal(cleanedMixed[0].text, '正在运行验证脚本...', 'human prose preserved');
  assert.equal(cleanedMixed[1].kind, 'tool-call');

  // Case 3: Step with NO tool calls leaves text blocks untouched (final reply turn)
  const finalReplyBlocks = [
    { kind: 'text', text: '```dsh-result-summary\nreplace\n```\n最终分析结果：任务完成。' }
  ];
  const untouched = cleanAssistantBlocksForUi(finalReplyBlocks);
  assert.equal(untouched, finalReplyBlocks, 'no tool call in step leaves blocks untouched');
});

test('Projection: patchUiConversationEvents patches assistantDefinition lifecycle and triggers refresh', () => {
  const mod = loadClientModule();
  const { patchUiConversationEvents } = mod;

  let refreshed = false;
  const defs = new Map();
  const subscribers = new Set();

  const assistantDef = {
    kind: 'assistant-step',
    buildLocationData(context, scope) {
      return {
        kind: 'step',
        value: {
          blocks: [
            { kind: 'text', text: '```dsh-result-summary\ntruncate keep 10 lines\n```' },
            { kind: 'tool-call', callId: 'c1' }
          ]
        }
      };
    },
    buildViewNode(context) {
      return {
        key: 'assistant:1',
        data: {
          blocks: [
            { kind: 'text', text: '```dsh-result-summary\ntruncate keep 10 lines\n```' },
            { kind: 'tool-call', callId: 'c1' }
          ]
        }
      };
    },
    update(context, match) {
      return {
        blocks: [
          { kind: 'text', text: '```dsh-result-summary\ntruncate keep 10 lines\n```' },
          { kind: 'tool-call', callId: 'c1' }
        ]
      };
    }
  };

  defs.set('assistant-step', assistantDef);

  const mockUiConversation = {
    events: {
      definitions: defs,
      subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
      refresh() { refreshed = true; }
    }
  };

  patchUiConversationEvents(mockUiConversation);

  assert.equal(refreshed, true, 'registry.refresh() called on install');
  assert.equal(assistantDef.__oswynPatched, true, '__oswynPatched flag set');

  // Verify buildLocationData cleans the blocks
  const loc = assistantDef.buildLocationData({}, 'step');
  assert.equal(loc.value.blocks.length, 1);
  assert.equal(loc.value.blocks[0].kind, 'tool-call');

  // Verify buildViewNode cleans the blocks
  const node = assistantDef.buildViewNode({});
  assert.equal(node.data.blocks.length, 1);
  assert.equal(node.data.blocks[0].kind, 'tool-call');

  // Verify update cleans the blocks
  const state = assistantDef.update({}, {});
  assert.equal(state.blocks.length, 1);
  assert.equal(state.blocks[0].kind, 'tool-call');
});
