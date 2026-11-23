/**
 * dsh-oswyn/tools/history-recall — register history_recall tool.
 *
 * Recall reasoning traces (<think> / reasoning blocks) or tool executions from
 * historical conversation rounds. Supports round selection, step-level granularity
 * within a round, and modality filtering (defaults to thinking only).
 *
 * By default (`original: false`), recalls the post-intra-step-compression surface
 * content (bypassing turn-level `oswyn/distill` placeholders so distilled rounds
 * remain 100% recallable, while still returning the intra-step compressed tool
 * output rather than raw uncompressed logs). Pass `original: true` (or `raw: true`)
 * to walk `sourceEventSeqs` back to the raw uncompressed output.
 *
 * @module dsh-oswyn/tools/history-recall
 */

import { recordRecall } from '../store/ledger.js';
import {
  setRoundRecall,
  collectUnprojectedSurfaceMessages,
  getToolName
} from '../session/surface.js';
import { partitionMessagesIntoTurns, discardToolCallArgs } from '../core/projection.js';
import { isCallArgDiscarded } from '../core/primitives.js';
// Native surface-replace turn distillation stores shadowed seqs in sourceEventSeqs.

export function extractMessageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string')
        && b.type !== 'reasoning' && b.type !== 'thinking' && b.type !== 'thought')
      .map((b) => b.text || '')
      .join('\n');
  }
  return '';
}

function extractThinkingTraces(assistantMsg) {
  if (!assistantMsg) return [];
  const traces = [];
  const seen = new Set();
  const pushTrace = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    const formatted = /^<(?:think|thinking)\b/i.test(trimmed)
      ? trimmed
      : `<think>\n${trimmed}\n</think>`;
    if (!seen.has(formatted)) {
      seen.add(formatted);
      traces.push(formatted);
    }
  };

  if (Array.isArray(assistantMsg.content)) {
    for (const block of assistantMsg.content) {
      if (!block) continue;
      if (block.type === 'reasoning' || block.type === 'thinking' || block.type === 'thought') {
        pushTrace(block.text ?? block.thinking ?? block.content ?? '');
      }
    }
  }

  const text = extractMessageText(assistantMsg);
  const thinkMatches = text.match(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi);
  if (thinkMatches) {
    for (const m of thinkMatches) pushTrace(m);
  }

  if (typeof assistantMsg.reasoning_content === 'string' && assistantMsg.reasoning_content.trim()) {
    pushTrace(assistantMsg.reasoning_content);
  }

  return traces;
}

function extractToolCalls(assistantMsg) {
  if (!assistantMsg) return [];
  const out = [];
  const seenIds = new Set();

  if (Array.isArray(assistantMsg.tool_calls)) {
    for (const c of assistantMsg.tool_calls) {
      if (!c) continue;
      const id = c.id || c.callId || '';
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      out.push({
        id,
        name: c.function?.name || c.name || 'tool',
        arguments: c.function?.arguments ?? c.arguments ?? ''
      });
    }
  }

  if (Array.isArray(assistantMsg.content)) {
    for (const b of assistantMsg.content) {
      if (!b || (b.type !== 'tool-call' && b.type !== 'tool_call' && b.type !== 'tool_use')) continue;
      const id = b.callId || b.id || '';
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      out.push({
        id,
        name: b.name || b.function?.name || 'tool',
        arguments: b.arguments ?? b.input ?? ''
      });
    }
  }

  return out;
}

function formatCallArgs(rawArgs) {
  if (rawArgs === undefined || rawArgs === null) return '';
  if (typeof rawArgs === 'string') return rawArgs;
  try { return JSON.stringify(rawArgs); } catch { return String(rawArgs); }
}

function walkToOriginalToolEvent(session, startEvent, allEvents) {
  let cur = startEvent;
  const seen = new Set();
  for (let hop = 0; hop < 16 && cur; hop += 1) {
    const srcs = cur.sourceEventSeqs;
    if (!Array.isArray(srcs) || srcs.length === 0) break;
    let parent = null;
    for (const s of srcs) {
      if (seen.has(s)) continue;
      seen.add(s);
      const p = typeof session?.eventAt === 'function'
        ? session.eventAt(s)
        : (Array.isArray(allEvents) ? allEvents.find((e) => e?.seq === s) : null);
      if (p && p.type === 'tool/result') {
        parent = p;
        break;
      }
    }
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return cur;
}

/**
 * Partition messages of a single turn into execution steps.
 * A step begins with an assistant message (which may contain thinking and tool_calls)
 * followed by any tool result messages corresponding to those tool calls.
 *
 * @param {Array<object>} turnMsgs
 * @returns {Array<{ assistant: object|null, tools: Array<object> }>}
 */
export function partitionTurnIntoSteps(turnMsgs) {
  if (!Array.isArray(turnMsgs)) return [];
  const steps = [];
  let currentStep = null;

  for (const m of turnMsgs) {
    if (!m) continue;
    if (m.role === 'user') continue;
    if (m.role === 'assistant') {
      if (currentStep) {
        steps.push(currentStep);
      }
      currentStep = {
        assistant: m,
        tools: []
      };
    } else if (m.role === 'tool' || m.role === 'tool/result') {
      if (currentStep) {
        currentStep.tools.push(m);
      } else {
        currentStep = { assistant: null, tools: [m] };
      }
    }
  }
  if (currentStep) {
    steps.push(currentStep);
  }
  return steps;
}

export function registerHistoryRecallTool(ctx) {
  ctx.tools.register({
    name: 'history_recall',
    description: [
      'Recall distilled reasoning traces (<think>) or tool executions from historical conversation rounds.',
      'Supports round selection, step-level granularity within a round, and modality filtering (defaults to thinking only).'
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        round: {
          type: 'number',
          description: '1-based conversation turn/round number to recall (e.g. 1, 2, 3).'
        },
        step: {
          type: 'number',
          description: '1-based execution step within the specified round (e.g. 1, 2). If omitted, retrieves all steps in the round.'
        },
        mode: {
          type: 'string',
          enum: ['think', 'tool', 'both'],
          description: 'Modality to recall: "think" (restore <think> reasoning traces only; default), "tool" (restore tool calls and tool results only), or "both" (restore both thinking and tools).'
        },
        tool_name: {
          type: 'string',
          description: 'Optional tool name filter (e.g. "read", "bash") when mode is "tool" or "both".'
        },
        original: {
          type: 'boolean',
          description: 'Whether to recall the full uncompressed original content for tools. Default is false (returns the already compressed content if summarized).'
        },
        raw: {
          type: 'boolean',
          description: 'Alias for original. Set true to recall raw uncompressed output.'
        },
        reinstate: {
          type: 'boolean',
          description: 'Whether to un-distill this round in subsequent active model context requests (default: true).'
        },
        offset: { type: 'number', description: 'Skip this many characters from the start of the output.' },
        limit: { type: 'number', description: 'Return at most this many characters. Omit for the full output.' }
      },
      required: ['round']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean' },
          round: { type: 'number' },
          step: { type: 'number' },
          totalSteps: { type: 'number' },
          mode: { type: 'string' },
          reinstated: { type: 'boolean' },
          isOriginal: { type: 'boolean' },
          totalChars: { type: 'number' },
          returnedChars: { type: 'number' },
          recallTokens: { type: 'number' },
          text: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['found']
      },
      render: (_args, value) => {
        if (!value.found) return [{ type: 'text', text: 'No history matches: ' + value.reason }];
        const stepInfo = value.step ? ` · Step ${value.step}/${value.totalSteps}` : ` · All ${value.totalSteps} Steps`;
        const modeLabel = value.isOriginal ? 'original (uncompressed)' : 'compressed default';
        const header = [
          `[Round ${value.round}${stepInfo} History Recall | mode: ${value.mode || 'think'} | tool-content: ${modeLabel} | reinstated: ${value.reinstated ? 'yes' : 'no'}]`,
          `Length: ${value.totalChars} chars (this recall cost ~${value.recallTokens || 0} tok)`
        ].join('\n');
        return [{ type: 'text', text: header + '\n\n' + value.text }];
      }
    },
    execute(args, exec) {
      const session = exec.agent?.session;
      if (session === undefined) throw new Error('history_recall requires an agent session');

      const rawRound = args.round !== undefined ? Number(args.round) : null;
      if (rawRound === null || !Number.isInteger(rawRound) || rawRound <= 0) {
        return { found: false, reason: `Invalid or missing round number: ${args.round} (must be an integer >= 1)` };
      }
      const roundNumber = rawRound;

      // Default mode is strictly 'think' as required ("默认只召回思考")
      let mode = 'think';
      if (args.mode) {
        const m = String(args.mode).toLowerCase();
        if (m === 'think' || m === 'tool' || m === 'both') {
          mode = m;
        }
      }

      const useOriginal = args.original === true || args.raw === true;

      // Prefer the unprojected surface (session.surface.nodes -> event.data.message):
      // this bypasses turn-level `oswyn/distill` placeholders so distilled rounds are
      // always recallable, while preserving intra-step compression (`surfaceOp: replace`).
      const unprojectedPairs = collectUnprojectedSurfaceMessages(session);
      const pairByMsg = new WeakMap();
      // Expand native `oswyn-compaction` turn-distill checkpoints via their exact
      // `sourceEventSeqs` so shadowed assistant messages (with reasoning + tool-calls)
      // and post-intra-step-compression tool/result nodes remain 100% recallable.
      const expandSurfacePairs = (pairs) => {
        const expanded = [];
        const visitedSeqs = new Set();
        const pushEvent = (ev) => {
          if (!ev || !Number.isInteger(ev.seq) || visitedSeqs.has(ev.seq)) return;
          visitedSeqs.add(ev.seq);
          const msg = ev.type === 'user/message'
            ? ev.data
            : (ev.data?.message ?? ev.data);
          if (!msg) return;
          if (ev.type === 'user/message'
            && msg.source?.kind === 'oswyn-compaction'
            && Array.isArray(ev.sourceEventSeqs)
            && ev.sourceEventSeqs.length > 0
            && typeof session.eventAt === 'function') {
            let expandedAny = false;
            for (const srcSeq of ev.sourceEventSeqs) {
              const srcEv = session.eventAt(srcSeq);
              if (srcEv && (srcEv.type === 'assistant/message' || srcEv.type === 'tool/result' || srcEv.type === 'user/message')) {
                expandedAny = true;
                pushEvent(srcEv);
              }
            }
            if (expandedAny) return;
          }
          expanded.push({ seq: ev.seq, type: ev.type, message: msg, event: ev });
        };
        for (const pair of pairs) {
          if (pair?.event) pushEvent(pair.event);
          else if (pair?.message) expanded.push(pair);
        }
        return expanded;
      };
      let messages;
      if (unprojectedPairs.length > 0) {
        const resolvedPairs = expandSurfacePairs(unprojectedPairs);
        messages = resolvedPairs.map((pair) => {
          let msg = pair.message;
          if (!msg.role) {
            const inferredRole = pair.type === 'tool/result'
              ? 'tool'
              : (pair.type === 'assistant/message'
                ? 'assistant'
                : (pair.type === 'user/message' ? 'user' : undefined));
            if (inferredRole) msg = { ...msg, role: inferredRole };
          }
          pairByMsg.set(msg, pair);
          return msg;
        });
      } else {
        messages = typeof session.deriveMessages === 'function'
          ? session.deriveMessages()
          : (Array.isArray(session.messages) ? session.messages : []);
      }

      const { turns } = partitionMessagesIntoTurns(messages);
      if (roundNumber > turns.length) {
        return {
          found: false,
          reason: `Round ${roundNumber} does not exist (session currently has ${turns.length} turns)`
        };
      }

      const turnMsgs = turns[roundNumber - 1] || [];
      const steps = partitionTurnIntoSteps(turnMsgs);

      let targetSteps = [];
      let specifiedStep = null;

      if (args.step !== undefined && args.step !== null) {
        const stepNum = Number(args.step);
        if (!Number.isInteger(stepNum) || stepNum <= 0 || stepNum > steps.length) {
          return {
            found: false,
            reason: `Step ${args.step} does not exist in Round ${roundNumber} (round has ${steps.length} steps)`
          };
        }
        specifiedStep = stepNum;
        targetSteps = [{ stepIndex: stepNum, step: steps[stepNum - 1] }];
      } else {
        targetSteps = steps.map((s, idx) => ({ stepIndex: idx + 1, step: s }));
      }

      const extractedSections = [];
      const toolFilter = args.tool_name ? String(args.tool_name).trim().toLowerCase() : null;
      let allEventsCache = null;
      const getAllEvents = () => {
        if (allEventsCache === null) {
          allEventsCache = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
        }
        return allEventsCache;
      };

      for (const { stepIndex, step } of targetSteps) {
        const stepHeader = targetSteps.length > 1
          ? `### Round ${roundNumber} · Step ${stepIndex}`
          : `### Round ${roundNumber}${specifiedStep ? ` · Step ${specifiedStep}` : ''}`;
        const parts = [];
        const stepCalls = extractToolCalls(step.assistant);

        if (step.assistant) {
          if (mode === 'think' || mode === 'both') {
            const traces = extractThinkingTraces(step.assistant);
            if (traces.length > 0) {
              parts.push(`**Assistant Thinking:**\n` + traces.join('\n\n'));
            }
          }

          if (mode === 'tool' || mode === 'both') {
            let calls = stepCalls;
            if (toolFilter) {
              calls = calls.filter((c) => (c.name || '').toLowerCase() === toolFilter);
            }
            if (calls.length > 0) {
              const callsText = calls.map((c) => {
                const effectiveArgs = (!useOriginal && c.id && isCallArgDiscarded(session, c.id))
                  ? discardToolCallArgs(c.arguments)
                  : c.arguments;
                return `- Call ${c.id}: ${c.name}(${formatCallArgs(effectiveArgs)})`;
              }).join('\n');
              parts.push(`**Tool Calls:**\n${callsText}`);
            }
          }
        }

        if (mode === 'tool' || mode === 'both') {
          if (Array.isArray(step.tools) && step.tools.length > 0) {
            for (const t of step.tools) {
              const pair = pairByMsg.get(t);
              const callId = t.toolCallId || t.tool_call_id || t.callId || t.source?.callId || pair?.event?.data?.callId || '';
              let toolName = t.toolName || t.name || t.source?.toolName;
              if (!toolName && callId && stepCalls.length > 0) {
                const matchingCall = stepCalls.find((c) => c.id === callId);
                if (matchingCall?.name) toolName = matchingCall.name;
              }
              if (!toolName && pair?.event) {
                toolName = getToolName(session, pair.event);
              }
              if (!toolName) toolName = 'tool';
              if (toolFilter && toolName.toLowerCase() !== toolFilter) continue;

              // Default: intra-step compressed content from the unprojected surface node.
              let txt = extractMessageText(t);
              if (useOriginal) {
                if (pair?.event) {
                  const orig = walkToOriginalToolEvent(session, pair.event, getAllEvents());
                  txt = extractMessageText(orig?.data?.message ?? orig?.data ?? orig);
                } else if (callId && typeof session.snapshotEvents === 'function') {
                  const all = getAllEvents();
                  for (let i = all.length - 1; i >= 0; i -= 1) {
                    const ev = all[i];
                    if (ev?.type === 'tool/result') {
                      const evCallId = ev.data?.message?.source?.callId ?? ev.data?.callId ?? '';
                      if (evCallId === callId) {
                        const orig = walkToOriginalToolEvent(session, ev, all);
                        txt = extractMessageText(orig?.data?.message ?? orig?.data ?? orig);
                        break;
                      }
                    }
                  }
                }
              }
              parts.push(`**Tool Result [${toolName}${callId ? ' ' + callId : ''}]:**\n${txt}`);
            }
          }
        }

        if (parts.length > 0) {
          extractedSections.push(`${stepHeader}\n` + parts.join('\n\n'));
        }
      }

      const full = extractedSections.length > 0
        ? extractedSections.join('\n\n')
        : `[Round ${roundNumber}${specifiedStep ? ` Step ${specifiedStep}` : ''} contains no matching ${mode === 'think' ? 'thinking traces' : (mode === 'tool' ? 'tool executions' : 'thinking or tool executions')}]`;

      const offset = Math.max(0, Math.trunc(args.offset ?? 0));
      const limit = args.limit === undefined ? undefined : Math.max(0, Math.trunc(args.limit));
      const text = limit === undefined ? full.slice(offset) : full.slice(offset, offset + limit);

      const shouldReinstate = args.reinstate !== false;
      if (shouldReinstate) {
        setRoundRecall(session, roundNumber, mode);
      }

      let cumulative = 0;
      if (session.id) {
        try { cumulative = recordRecall(session.id, text.length); } catch (_) {}
      }
      const recallTokens = Math.round(text.length / 3.5);

      return {
        found: true,
        round: roundNumber,
        ...(specifiedStep !== null ? { step: specifiedStep } : {}),
        totalSteps: steps.length,
        mode,
        reinstated: shouldReinstate,
        isOriginal: useOriginal,
        totalChars: full.length,
        returnedChars: text.length,
        recallTokens,
        text
      };
    }
  });
}
