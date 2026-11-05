/**
 * DSH-OSWYN (Only See What You Need) — plugin assembly.
 *
 * Thin composition root. All capability lives in focused modules:
 *   - config.js / format.js                        (config schema, formatting)
 *   - core/{parse,plan,markers,projection,primitives}.js (pure core & atomic primitives)
 *   - modes/{truncate,replace,discard,protect,reply-summary}.js (per-mode strategies)
 *   - presets/{standard,ptc,index}.js              (preset-specific orchestration)
 *   - prompts/{base,preset-standard,preset-ptc,nudge,index}.js (prompts & smart nudges)
 *   - session/{surface,applier,ptc,auto-policy,retain}.js (kernel surface & facades)
 *   - store/{ledger,metrics}.js                    (audit ledger + metrics)
 *   - server/{routes,commands}.js                  (web API + slash commands)
 *   - tools/{recall,stats,protect}.js              (tool_result_recall, oswyn_stats, oswyn_protect_tool)
 *   - client/{shared,settings-panel,fence-fold,tool-badges,state}.js -> client.js
 *
 * @module dsh-oswyn
 */
import { Config, CONFIG_DEFAULTS, liveConfig } from './config.js';
import {
  PROTOCOL_SECTION,
  protocolText,
  SUMMARY_OPEN_TAG,
  REPLY_SUMMARY_OPEN_TAG,
  collectNudgeCandidates,
  buildNudgePromptText
} from './prompts/index.js';
import { pruneToolCallArgs } from './core/projection.js';
import {
  alreadyProcessed,
  isCallArgDiscarded
} from './core/primitives.js';
import {
  applyFromAssistantMessage,
  resolveSessionPreset,
  runAllAutoPolicies
} from './presets/index.js';
import { getToolName } from './session/surface.js';
import { matchesToolName } from './session/auto-policy.js';
import { appendEvent, loadProtectedTools } from './store/ledger.js';
import { registerWebRoutes } from './server/routes.js';
import { registerCommands } from './server/commands.js';
import { registerRecallTool } from './tools/recall.js';
import { registerStatsTool } from './tools/stats.js';
import { registerProtectTool } from './tools/protect.js';

export const name = 'oswyn';
export const inject = ['tools', 'commands', 'systemPrompt', 'sessions'];
export { Config, PROTOCOL_SECTION };

/** Diagnostic: append a line to /tmp/oswyn-diag.log (best-effort, never throws). */
function diag(line) {
  try {
    // eslint-disable-next-line no-undef
    const fs = (globalThis.process && globalThis.process.getBuiltinModule)
      ? globalThis.process.getBuiltinModule('node:fs') : null;
    if (fs) fs.appendFileSync('/tmp/oswyn-diag.log', new Date().toISOString() + ' ' + line + '\n');
  } catch { /* ignore */ }
}

/** Read the last assistant/message from a session snapshot. */
function lastAssistantMessage(session) {
  if (typeof session?.snapshotEvents === 'function') {
    const all = session.snapshotEvents();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const ev = all[i];
      if (ev.type === 'assistant/message') return { message: ev.data?.message, seq: ev.seq };
    }
    return null;
  }
  try {
    const msg = [...session.deriveMessages()].reverse().find((m) => m.role === 'assistant');
    return msg ? { message: msg, seq: undefined } : null;
  } catch {
    return null;
  }
}

/**
 * Tool results from the immediately preceding step (after the prior assistant/user
 * boundary and before the latest assistant message) that the model has now seen once.
 */
export function seenToolResults(session) {
  if (typeof session?.snapshotEvents !== 'function') return [];
  const all = session.snapshotEvents();
  const last = lastAssistantMessage(session);
  if (!last || !Number.isInteger(last.seq)) return [];
  let boundarySeq = -1;
  for (const ev of all) {
    if (!ev || !Number.isInteger(ev.seq) || ev.seq >= last.seq) continue;
    if (ev.type === 'user/message' && ev.data?.source?.kind !== 'oswyn-compaction' && ev.data?.message?.source?.kind !== 'oswyn-compaction') {
      boundarySeq = ev.seq;
    } else if (ev.type === 'assistant/message') {
      boundarySeq = ev.seq;
    }
  }
  return all.filter((ev) => ev?.type === 'tool/result' && ev.seq > boundarySeq && ev.seq < last.seq);
}

/** Plain text of one message (for fence detection). */
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** Resolve the effective protected-tool list (config + runtime additions). */
function protectedToolList(resolved) {
  const configured = Array.isArray(resolved.autoCompressTieredProtectedTools)
    ? resolved.autoCompressTieredProtectedTools : CONFIG_DEFAULTS.autoCompressTieredProtectedTools;
  return configured.concat(loadProtectedTools());
}

/** True when this tool must never be auto-compressed. Protection always wins. */
function isProtectedTool(session, event, resolved) {
  if (!event) return true;
  const toolName = String(getToolName(session, event) || '').toLowerCase();
  if (!toolName) return true;
  if (toolName === 'run_code') return true; // hard guard, even if config is edited
  return protectedToolList(resolved).some((p) => matchesToolName(p, toolName));
}

/** A tiered fallback is allowed only for non-protected tools and only when the agent wrote no result fence. */
function tieredFallbackEligible(session, event, lastMessage, resolved) {
  if (!event || isProtectedTool(session, event, resolved)) return false;
  if (messageText(lastMessage).indexOf('```' + SUMMARY_OPEN_TAG) >= 0) return false;
  return true;
}

/** Persist one applyFromAssistantMessage result into the ledger. */
function recordResult(session, result) {
  if (!session?.id || !result) {
    diag('recordResult skip: id=' + (session && session.id) + ' hasResult=' + !!result);
    return;
  }
  const title = session.title || session.header?.title || '';
  for (const item of result.applied || []) {
    const summaryLen = item.fact ? item.fact.length : (item.summary ? item.summary.length : 0);
    const savedEntry = appendEvent(session.id, {
      sessionTitle: title,
      seq: item.seq,
      mode: item.mode,
      toolName: item.toolName || '',
      callId: item.callId || '',
      before: item.before,
      inputChars: item.inputChars || 0,
      after: item.after,
      keepChars: item.keepChars || 0,
      keepLines: item.keepLines ?? null,
      fact: item.fact || '',
      summary: item.summary || '',
      summaryLen,
      trigger: item.trigger || 'agent'
    });
    diag('appendEvent session=' + session.id + ' seq=' + item.seq + ' -> ' + (savedEntry ? 'ok' : 'NULL'));
  }
  if (result.replySummary) {
    appendEvent(session.id, {
      sessionTitle: title,
      seq: result.replySummary.targetSeq,
      mode: 'reply',
      toolName: 'assistant_reply',
      before: result.replySummary.charsBefore ?? 0,
      after: result.replySummary.summary ? result.replySummary.summary.length : 0,
      summary: result.replySummary.summary || '',
      summaryLen: result.replySummary.summary ? result.replySummary.summary.length : 0,
      trigger: 'agent'
    });
  }
}

/** Project historical assistant messages for the outgoing LLM request (dual-track + arg pruning). */
function projectOutgoing(messages, resolved, session) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    const content = msg.content;
    if (!Array.isArray(content)) return msg;
    let pruned = msg;
    try {
      const prunedMsg = pruneToolCallArgs(msg, { maxCodeLen: 160, maxSpecLen: 160 });
      if (prunedMsg && prunedMsg !== msg) pruned = prunedMsg;
      if (session && Array.isArray(pruned.content)) {
        let changed = false;
        const nextContent = pruned.content.map((block) => {
          const cid = block && (block.callId || block.id);
          if (block && block.type === 'tool-call' && cid && isCallArgDiscarded(session, cid)) {
            changed = true;
            return { ...block, arguments: '{}' };
          }
          return block;
        });
        if (changed) pruned = { ...pruned, content: nextContent };
      }
    } catch { /* keep original */ }
    return pruned;
  });
}

export function apply(ctx, config = {}) {
  const resolved = liveConfig(config);
  if (!resolved.enabled) {
    ctx.logger?.info?.('[dsh-oswyn] disabled in configuration.');
    return;
  }

  // ── 1. System prompt protocol section (Preset-aware: standard vs ptc) ──────
  ctx.effect?.(() => ctx.systemPrompt?.section?.({
    name: PROTOCOL_SECTION,
    order: 2500,
    text: (context) => protocolText(resolveSessionPreset(ctx, context))
  }), 'oswyn: protocol section');

  function runAutoPolicies(session) {
    if (!session) return;
    const seen = seenToolResults(session);
    if (seen.length === 0) return;
    const last = lastAssistantMessage(session);
    const hasFence = messageText(last?.message).indexOf('```' + SUMMARY_OPEN_TAG) >= 0;
    const applied = runAllAutoPolicies(session, seen, resolved, {
      isProtectedTool,
      tieredFallbackEligible,
      lastMessage: last?.message,
      hasFence,
      protectedTools: protectedToolList(resolved),
      logger: ctx.logger
    });
    if (applied.length > 0) {
      recordResult(session, { applied });
    }
  }

  // ── 2. Real-time distillation (agent fences have first priority) ──────────
  ctx.effect?.(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message' || event?.ignorable || !event?.data?.message) return;
    const run = () => {
      try {
        if (!alreadyProcessed(session, event.seq)) {
          const result = applyFromAssistantMessage(session, event.data.message, event.seq, resolved);
          recordResult(session, result);
          if (result.error || (Array.isArray(result.rejected) && result.rejected.length > 0)) {
            diag('reject seq=' + event.seq + ' ' + String(result.error || result.rejected.join(' | ')).slice(0, 300));
          }
        }
        runAutoPolicies(session);
      } catch (err) {
        diag('throw seq=' + event.seq + ' ' + String(err).slice(0, 300));
        ctx.logger?.debug?.('[dsh-oswyn] event distillation skipped: ' + String(err).slice(0, 200));
      }
    };
    run();
    queueMicrotask(run);
  }), 'oswyn: session-event distillation');

  // ── 3. Step-boundary: agent fences first, auto policies second, smart nudge third ──
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const session = agent?.session;
    if (resolved.autoApply && !signal?.aborted) {
      try {
        const last = session ? lastAssistantMessage(session) : null;
        if (last?.message) {
          const result = applyFromAssistantMessage(session, last.message, last.seq, resolved);
          recordResult(session, result);
        }
      } catch (err) {
        ctx.logger?.warn?.('[dsh-oswyn] step distillation failed: ' + String(err).slice(0, 200));
      }
    }

    if (session && !signal?.aborted) {
      runAutoPolicies(session);
    }

    const decision = await next();
    if (!decision || decision.kind === 'reject' || signal?.aborted) return decision;

    let outgoing = projectOutgoing(decision.messages, resolved, session);

    if (resolved.nudgeEnabled !== false && Array.isArray(outgoing) && outgoing.length > 0) {
      try {
        const candidates = collectNudgeCandidates(outgoing, resolved, session);
        const nudgeText = buildNudgePromptText(candidates);
        if (nudgeText) {
          outgoing = [...outgoing, {
            role: 'user',
            content: [{ type: 'text', text: nudgeText }],
            source: { kind: 'oswyn-nudge', time: Date.now() }
          }];
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] nudge skipped: ' + String(err).slice(0, 120));
      }
    }

    return { ...decision, messages: outgoing };
  });

  // ── 4. Slash commands ──────────────────────────────────────────────────────
  if (typeof ctx.commands?.register === 'function') {
    try { registerCommands(ctx, resolved); } catch { /* ignore */ }
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (sub) => { try { registerCommands(sub, resolved); } catch { /* ignore */ } });
  }

  // ── 5. Web routes ──────────────────────────────────────────────────────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer', 'sessions'], (sub) => {
      ctx.effect?.(() => registerWebRoutes(sub, resolved), 'oswyn: web routes');
    });
  } else if (ctx.webServer) {
    ctx.effect?.(() => registerWebRoutes(ctx, resolved), 'oswyn: web routes');
  }

  // ── 6. Tools ───────────────────────────────────────────────────────────────
  try { registerRecallTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] recall tool skipped: ' + String(err)); }
  try { registerStatsTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] stats tool skipped: ' + String(err)); }
  try { registerProtectTool(ctx); } catch (err) { ctx.logger?.warn?.('[dsh-oswyn] protect tool skipped: ' + String(err)); }

  ctx.logger?.info?.('[dsh-oswyn] loaded (modular architecture: core + modes + presets + prompts + client).');
}

export default { name, inject, Config, apply };
