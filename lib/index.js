/**
 * DSH-OSWYN (Only See What You Need) — plugin assembly.
 *
 * Thin composition root. All capability lives in focused modules:
 *   - config.js / protocol.js / format.js        (config, prompt text, formatting)
 *   - core/{parse,plan,markers,projection}.js     (pure logic)
 *   - session/{surface,applier,retain}.js         (kernel-facing rewrite + retention)
 *   - store/{ledger,metrics}.js                    (audit ledger + metrics)
 *   - server/{routes,commands}.js                  (web API + slash commands)
 *   - tools/{recall,stats}.js                      (tool_result_recall, oswyn_stats)
 *   - client.js                                    (web display)
 *
 * @module dsh-oswyn
 */
import { Config, CONFIG_DEFAULTS, liveConfig } from './config.js';
import { PROTOCOL_SECTION, protocolText, SUMMARY_OPEN_TAG, REPLY_SUMMARY_OPEN_TAG } from './protocol.js';
import { pruneToolCallArgs } from './core/projection.js';
import { applyFromAssistantMessage, autoCompressToolResult, autoDiscardToolResult, analyze, alreadyProcessed, isCallArgDiscarded, isAutoCompressSkipped } from './session/applier.js';
import { autoCompressPtcSubcalls } from './session/ptc.js';
import { getToolName } from './session/surface.js';
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
 * Scoping to the latest step prevents auto-compression or auto-discard from reaching
 * back across multiple historical assistant steps and invalidating intermediate KV caches.
 */
function seenToolResults(session) {
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

/** Resolve the current tool presentation mode for a prompt scope (native vs ptc). */
function resolvePromptMode(ctx, context) {
  try {
    const tools = ctx?.tools || (typeof ctx?.get === 'function' ? ctx.get('tools') : undefined);
    if (tools && typeof tools.modeFor === 'function') {
      const mode = tools.modeFor(context?.scope);
      if (mode === 'ptc') return 'ptc';
    }
  } catch (_) {}
  return 'native';
}

/** Plain text of one message (for fence detection). */
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** Exact tool name or simple trailing-* wildcard match. */
function matchesToolName(pattern, toolName) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  if (p.endsWith('*')) return toolName.startsWith(p.slice(0, -1));
  return toolName === p;
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
  if (!session?.id || !result) { diag('recordResult skip: id=' + (session && session.id) + ' hasResult=' + !!result); return; }
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
    const text = content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n');
    const hasReplyFence = resolved.replySummaryEnabled !== false && text.includes(REPLY_SUMMARY_OPEN_TAG);
    // Prune oversized tool-call arguments in history (keeps context lean, never throws).
    let pruned = msg;
    try {
      const prunedMsg = pruneToolCallArgs(msg, { maxCodeLen: 160, maxSpecLen: 160 });
      if (prunedMsg && prunedMsg !== msg) pruned = prunedMsg;
      // Discarded calls must not leave their call arguments behind either.
      // Support both block.callId (MockSession) and block.id (real @deepseek-ai/dsh-session).
      if (session && Array.isArray(pruned.content)) {
        let changed = false;
        const content = pruned.content.map((block) => {
          const cid = block && (block.callId || block.id);
          if (block && block.type === 'tool-call' && cid && isCallArgDiscarded(session, cid)) {
            changed = true;
            return { ...block, arguments: '{}' };
          }
          return block;
        });
        if (changed) pruned = { ...pruned, content };
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

  // ── 1. System prompt protocol section ──────────────────────────────────────
  ctx.effect?.(() => ctx.systemPrompt?.section?.({
    name: PROTOCOL_SECTION,
    order: 2500,
    text: (context) => protocolText(resolvePromptMode(ctx, context))
  }), 'oswyn: protocol section');

  function runAutoPolicies(session) {
    if (!session) return;
    // Failed calls and the always-discard tool list are handled before the
    // generic size-based fallback: discard is semantically stronger than truncate.
    if (resolved.autoDiscardFailed !== false || (Array.isArray(resolved.autoDiscardTools) && resolved.autoDiscardTools.length > 0)) {
      try {
        for (const latest of seenToolResults(session)) {
          const applied = autoDiscardToolResult(session, latest, {
            forceTools: resolved.autoDiscardTools
          });
          if (applied) recordResult(session, { applied: [applied] });
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] auto-discard skipped: ' + String(err).slice(0, 120));
      }
    }

    // Opt-in automatic mode runs ONLY after the agent's fences. It therefore
    // cannot pre-truncate the content a `truncate keep N` directive refers to.
    // autoCompressToolResult also rejects nodes already replaced or carrying an
    // oswyn marker, so the two layers converge to one rewrite per tool result.
    if (resolved.autoCompress || resolved.autoCompressTiered !== false) {
      try {
        const last = lastAssistantMessage(session);
        for (const latest of seenToolResults(session)) {
          const eligible = !isProtectedTool(session, latest, resolved)
            && (resolved.autoCompress === true
              || (resolved.autoCompressTiered !== false && tieredFallbackEligible(session, latest, last?.message, resolved)));
          const applied = eligible ? autoCompressToolResult(session, latest, {
            minChars: resolved.autoCompressMinChars,
            keepLines: resolved.autoCompressKeepLines
          }) : null;
          if (applied) recordResult(session, { applied: [applied] });
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] auto-compression skipped: ' + String(err).slice(0, 120));
      }
    }

    // PTC-specific envelope compression: run_code stays protected from the
    // generic fallback, but its multi-subcall aggregate can be compressed into
    // one structured summary (one outer tool/result replace, never per dispatch).
    if (resolved.autoCompressPtcSubcalls !== false) {
      try {
        const last = lastAssistantMessage(session);
        const hasFence = messageText(last?.message).indexOf('```' + SUMMARY_OPEN_TAG) >= 0;
        if (!hasFence) {
          for (const latest of seenToolResults(session)) {
            if (isAutoCompressSkipped(session, latest.seq)) continue;
            const applied = autoCompressPtcSubcalls(session, latest, {
              minChars: resolved.autoCompressMinChars,
              protectedTools: protectedToolList(resolved),
              discardTools: resolved.autoDiscardTools,
              discardFailed: resolved.autoDiscardFailed !== false,
              keepLines: resolved.autoCompressKeepLines
            });
            if (applied) recordResult(session, { applied: [applied] });
          }
        }
      } catch (err) {
        ctx.logger?.debug?.('[dsh-oswyn] PTC auto-compression skipped: ' + String(err).slice(0, 120));
      }
    }
  }

  // ── 2. Real-time distillation (agent fences have first priority) ──────────
  // Agent fences run first; auto-discard / auto-compress run immediately after
  // on the same microtask once the assistant message has landed (meaning the
  // model has already seen the prior step's tool result once).
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

  // ── 3. Step-boundary: agent fences first, optional auto-compression second ──
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

    // Single-step & multi-tool batch pressure nudge: scan all trailing tool
    // messages from the latest step so parallel tool batches never hide a huge
    // earlier output behind a short final tool result.
    if (resolved.nudgeEnabled !== false && Array.isArray(outgoing) && outgoing.length > 0) {
      try {
        const trailingToolMsgs = [];
        for (let i = outgoing.length - 1; i >= 0; i -= 1) {
          const m = outgoing[i];
          const isToolMsg = m && (m.role === 'tool' || m.source?.toolName !== undefined);
          if (!isToolMsg) break;
          trailingToolMsgs.unshift(m);
        }
        const candidates = [];
        for (const msg of trailingToolMsgs) {
          const txt = Array.isArray(msg.content)
            ? msg.content.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n')
            : (typeof msg.content === 'string' ? msg.content : '');
          const already = txt.includes('[oswyn:') || txt.includes('[oswyn-meta:');
          if (already) continue;
          const isError = analyze(txt, { isError: msg.isError || msg.source?.isError }).isError;
          const minChars = isError ? (resolved.nudgeErrorThresholdChars ?? 400) : (resolved.nudgeThresholdChars ?? 600);
          const minLines = isError ? (resolved.nudgeErrorThresholdLines ?? 12) : (resolved.nudgeThresholdLines ?? 18);
          const lines = txt.split('\n').length;
          if (txt.length >= minChars || lines >= minLines) {
            candidates.push({ msg, txt, isError, lines, chars: txt.length });
          }
        }
        if (candidates.length > 0) {
          const primary = candidates.find((c) => c.isError) || candidates[candidates.length - 1];
          const isError = primary.isError;
          const lines = primary.lines;
          const chars = primary.chars;
          const promptLines = isError ? [
            '[DSH-OSWYN 失败调用精炼提示]',
            '检测到上一步工具执行失败/报错（约 ' + lines + ' 行 / ' + chars + ' 字符）。',
            '【核心准则】：失败调用常携带冗长内部运行时堆栈，对后续解决问题无语义价值，且严重污染上下文与模型注意力。',
            '强烈建议采用 Mode C (discard) 整段丢弃报错堆栈，仅提炼 1 行核心事实结论：',
            '```' + 'dsh-result-summary',
            'discard',
            '- 失败结论：<用 1 句话记录失败原因，如命令退出码/找不到模块/语法错误>',
            '```',
            '完整报错已持久留底账，随时可用 tool_result_recall 逐字节召回。'
          ] : [
            '[DSH-OSWYN 上下文精炼提示]',
            '上一步工具输出约 ' + lines + ' 行 / ' + chars + ' 字符' + (candidates.length > 1 ? '（本步共 ' + candidates.length + ' 项超阈值工具输出）' : '') + '。',
            '【精炼指引】：',
            '· **当前要用/即将修改的核心代码**：保持完整常驻，确保编辑精准；',
            '· **排查/探索性阅读的代码**：确认机制后，**建议使用 Mode B (replace) 替换为理解后的工作逻辑事实**，无需保留数百行无关代码；',
            '· **一次性输出（日志、长命令、扫描、试错）**：使用 truncate（`truncate keep <N> lines` 保留头部日志）或 discard（丢弃噪音只留结论）；',
            '注意：第一行必须明确写出指令（`replace`、`discard` 或 `truncate keep <N> lines`）。上面的行数是触发提示的门槛，不是建议的保留行数。',
            '探索性代码阅读替换示例：',
            '```' + 'dsh-result-summary',
            'replace',
            '- 已阅读并理解模块逻辑：确认其机制为 X，与当前目标无关，无需后续修改',
            '```',
            '完整原文随时可用 tool_result_recall 逐字节召回。'
          ];
          outgoing = [...outgoing, {
            role: 'user',
            content: [{ type: 'text', text: promptLines.join('\n') }],
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

  ctx.logger?.info?.('[dsh-oswyn] loaded (layered architecture; cache-preserving rewrite + ledger).');
}

export default { name, inject, Config, apply };
