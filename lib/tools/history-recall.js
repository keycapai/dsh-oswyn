/**
 * dsh-oswyn/tools/history-recall — register history_recall tool.
 *
 * Recall reasoning traces (<think>) or tool executions from historical
 * conversation rounds. Supports round selection, step-level granularity within
 * a round, and modality filtering (defaults to thinking only).
 *
 * @module dsh-oswyn/tools/history-recall
 */

import { recordRecall } from '../store/ledger.js';
import { setRoundRecall } from '../session/surface.js';
import { partitionMessagesIntoTurns } from '../core/projection.js';

export function extractMessageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && (b.type === 'text' || typeof b.text === 'string'))
      .map((b) => b.text || '')
      .join('\n');
  }
  return '';
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

      const messages = typeof session.deriveMessages === 'function'
        ? session.deriveMessages()
        : (Array.isArray(session.messages) ? session.messages : []);

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

      for (const { stepIndex, step } of targetSteps) {
        const stepHeader = targetSteps.length > 1 ? `### Round ${roundNumber} · Step ${stepIndex}` : `### Round ${roundNumber}${specifiedStep ? ` · Step ${specifiedStep}` : ''}`;
        const parts = [];

        if (step.assistant) {
          if (mode === 'think' || mode === 'both') {
            const text = extractMessageText(step.assistant);
            const thinkMatches = text.match(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi);
            if (thinkMatches) {
              parts.push(`**Assistant Thinking:**\n` + thinkMatches.join('\n\n'));
            } else if (step.assistant.reasoning_content) {
              parts.push(`**Assistant Thinking:**\n<think>\n${step.assistant.reasoning_content}\n</think>`);
            }
          }

          if (mode === 'tool' || mode === 'both') {
            if (Array.isArray(step.assistant.tool_calls) && step.assistant.tool_calls.length > 0) {
              let calls = step.assistant.tool_calls;
              if (toolFilter) {
                calls = calls.filter((c) => (c.function?.name || '').toLowerCase() === toolFilter);
              }
              if (calls.length > 0) {
                const callsText = calls.map((c) => `- Call ${c.id}: ${c.function?.name}(${c.function?.arguments || ''})`).join('\n');
                parts.push(`**Tool Calls:**\n${callsText}`);
              }
            }
          }
        }

        if (mode === 'tool' || mode === 'both') {
          if (Array.isArray(step.tools) && step.tools.length > 0) {
            for (const t of step.tools) {
              const callId = t.toolCallId || t.tool_call_id || t.callId || t.source?.callId || '';
              let toolName = t.toolName || t.name || t.source?.toolName;
              if (!toolName && callId && Array.isArray(step.assistant?.tool_calls)) {
                const matchingCall = step.assistant.tool_calls.find((c) => c.id === callId);
                if (matchingCall?.function?.name) toolName = matchingCall.function.name;
              }
              if (!toolName) toolName = 'tool';
              if (toolFilter && toolName.toLowerCase() !== toolFilter) continue;
              let txt = extractMessageText(t);
              if (useOriginal && typeof session.snapshotEvents === 'function') {
                const all = session.snapshotEvents();
                for (let i = all.length - 1; i >= 0; i -= 1) {
                  const ev = all[i];
                  if (ev?.type === 'tool/result') {
                    const evCallId = ev.data?.message?.source?.callId ?? ev.data?.callId ?? '';
                    if (callId && evCallId === callId) {
                      let cur = ev;
                      const seen = new Set();
                      for (let hop = 0; hop < 16; hop += 1) {
                        const srcs = cur?.sourceEventSeqs;
                        if (!Array.isArray(srcs) || srcs.length === 0) break;
                        let parent = null;
                        for (const s of srcs) {
                          if (seen.has(s)) continue;
                          seen.add(s);
                          const p = typeof session.eventAt === 'function' ? session.eventAt(s) : all.find((e) => e?.seq === s);
                          if (p && p.type === 'tool/result') { parent = p; break; }
                        }
                        if (!parent || parent === cur) break;
                        cur = parent;
                      }
                      txt = extractMessageText(cur.data?.message ?? cur.data ?? cur);
                      break;
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
        step: specifiedStep,
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
