import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config, name, inject } from '../lib/index.js';
import { protocolText } from '../lib/protocol.js';

function makeCtx() {
  const hooks = {};
  const tools = [];
  const commands = [];
  const sections = [];
  const ctx = {
    logger: { info(){}, warn(){}, debug(){}, error(){} },
    effect(fn){ try { fn(); } catch {} },
    on(evt, handler){ hooks[evt] = handler; },
    inject(_deps, cb){ /* provide sub-context lazily via same ctx */ try { cb(ctx); } catch {} },
    commands: { register(c){ commands.push(c); } },
    tools: { register(t){ tools.push(t); } },
    systemPrompt: { section(s){ sections.push(s); } },
    _hooks: hooks, _tools: tools, _commands: commands, _sections: sections
  };
  return ctx;
}

// A realistic session mock whose events the applier can read; append() records events.
function makeSession() {
  const log = [
    { seq: 0, type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } } },
    { seq: 1, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'please run tests' }] } } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', source: { toolName: 'bash', callId: 'c1' }, content: [{ type: 'text', text: 'LOG LINE\n'.repeat(400) }] } } },
    { seq: 3, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'done\n\u0060\u0060\u0060dsh-result-summary\ntruncate keep 5 lines\n- tests passed\n\u0060\u0060\u0060' }] } } }
  ];
  const session = {
    id: 'test_idx_session_' + Date.now(),
    title: 'T',
    surface: { nodes: [0,1,2,3] },
    log,
    snapshotEvents(){ return log; },
    eventAt(seq){ return log.find(e => e.seq === seq); },
    append(type, data, opts){
      const ev = { type, seq: log.length, data, ...(opts||{}) };
      log.push(ev);
      if (opts?.surfaceOp?.op === 'replace') {
        // splice surface range like kernel
        const i = session.surface.nodes.indexOf(opts.surfaceOp.startSeq);
        if (i >= 0) {
          const j = session.surface.nodes.indexOf(opts.surfaceOp.endSeq);
          session.surface.nodes.splice(i, j - i + 1, ev.seq);
        }
      } else {
        session.surface.nodes.push(ev.seq);
      }
      return ev;
    }
  };
  return session;
}

test('index: registers protocol section, tools, commands', () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true });
  assert.ok(ctx._sections.find(s => s.name === Config && false) || ctx._sections.length >= 1, 'protocol section registered');
  assert.ok(ctx._tools.find(t => t.name === 'tool_result_recall'), 'recall tool registered');
  assert.ok(ctx._tools.find(t => t.name === 'oswyn_stats'), 'stats tool registered');
  assert.ok(ctx._tools.find(t => t.name === 'oswyn_protect_tool'), 'protect tool registered');
  assert.ok(ctx._commands.length >= 2, 'commands registered');
});

test('index: session/event on assistant message compresses tool output (negative delta) + records ledger', async () => {
  const ctx = makeCtx();
  apply(ctx, { enabled: true, replySummaryEnabled: true });
  const session = makeSession();
  const beforeLen = session.log[2].data.message.content[0].text.length;
  // fire the session/event hook like the real runtime
  ctx._hooks['session/event'](session, session.log[3]);
  // a new tool/result replace event should have been appended
  const last = session.log[session.log.length - 1];
  assert.equal(last.type, 'tool/result');
  const newText = last.data.message.content.map(b => b.text).join('');
  assert.ok(newText.length < beforeLen, 'tool result strictly shorter (negative delta)');
  assert.match(newText, /\[oswyn-meta: before=\d+ after=\d+/, 'marker embedded');
});

test('index: Config keeps legacy keys + badgeEnabled', () => {
  const defaults = Config({});
  for (const k of ['enabled','replySummaryEnabled','hideReplySummaryInUi','nudgeEnabled','badgeEnabled']) {
    assert.ok(k in Config.dict, 'Config declares ' + k);
  }
  assert.equal(defaults.hideReplySummaryInUi.get(), true);
  assert.equal(defaults.badgeEnabled.get(), true);
});


test('protocol: PTC mode explains one outer fence / per-subcall facts', () => {
  const ptc = protocolText('ptc');
  const native = protocolText('native');
  assert.match(ptc, /PTC MODE/);
  assert.match(ptc, /NEVER write one fence per subcall/);
  assert.ok(!/PTC MODE/.test(native));
});

test('protocol: reply summary guidance encourages free-form key-detail memo and discourages rigid boilerplate / forced open items', () => {
  const text = protocolText('ptc');
  assert.match(text, /Free-Form Key-Detail Memo/i);
  assert.match(text, /Preserve Critical Answer Details/i);
  assert.match(text, /open items rarely exist/i);
  assert.match(text, /Do NOT force fixed boilerplate headings/i);
});
