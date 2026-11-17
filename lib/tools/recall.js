/**
 * dsh-oswyn/tools/recall — register tool_result_recall.
 *
 * Reads back the complete original output of an earlier tool result or assistant
 * reply (even when distilled out of context), verbatim, with offset/limit paging.
 *
 * ACCOUNTING: every successful execute re-injects original content into context,
 * which is an EXTRA cost. We count the re-injected chars and call
 * ledger.recordRecall(sessionId, chars) so recallTokens accumulate across turns.
 *
 * @module dsh-oswyn/tools/recall
 */

import { recordRecall } from '../store/ledger.js';
import { setRoundRecall } from '../session/surface.js';
import { partitionMessagesIntoTurns } from '../core/projection.js';

function extractMessageText(message) {
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

function getToolName(session, event) {
  if (!event || !session) return undefined;
  const direct = event.data?.message?.source?.toolName ?? event.data?.toolName;
  if (direct) return String(direct);
  const callId = event.data?.message?.source?.callId ?? event.data?.callId;
  if (callId && typeof session.snapshotEvents === 'function') {
    const all = session.snapshotEvents();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const ev = all[i];
      if (ev.type === 'tool/call' && ev.data?.callId === callId && ev.data?.name) return String(ev.data.name);
    }
  }
  return undefined;
}

function renderContent(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => (b.type === 'text' ? b.text : '[' + b.type + ' block]')).join('\n');
}

/**
 * Resolve the ORIGINAL payload of a tool/result event.
 *
 * A distilled tool/result node on the surface is itself a `tool/result` event
 * whose replacement data carries `sourceEventSeqs: [originSeq]`. Reading only
 * `target.event.data` therefore returns the [oswyn-meta: ...] summary instead of
 * the original output. Walk back through sourceEventSeqs to the earliest
 * ancestor that is itself a tool/result, so recall always returns the pristine
 * content.
 */
function resolveOriginal(session, target) {
  let event = target.event;
  const seen = new Set();
  for (let hop = 0; hop < 16; hop += 1) {
    const srcs = event?.sourceEventSeqs;
    if (!Array.isArray(srcs) || srcs.length === 0) break;
    let parent = null;
    for (const s of srcs) {
      if (seen.has(s)) continue;
      seen.add(s);
      const ev = typeof session?.eventAt === 'function' ? session.eventAt(s) : null;
      if (ev && ev.type === 'tool/result') { parent = ev; break; }
    }
    if (!parent || parent === event) break;
    event = parent;
  }
  return event;
}

function findResult(session, selector) {
  const wanted = selector == null ? null : String(selector).replace(/^seq[:=]?/i, '').trim();
  const lower = wanted == null ? '' : wanted.toLowerCase();
  const isLatest = wanted == null || lower === '' || lower === 'latest' || lower === 'last';
  const isLatestReply = lower === 'latest-reply' || lower === 'reply' || lower === 'assistant';

  if (typeof session.snapshotEvents !== 'function') return null;
  const all = session.snapshotEvents();

  if (isLatestReply) {
    for (let seq = all.length - 1; seq >= 0; seq -= 1) {
      if (all[seq]?.type === 'assistant/message') return { seq, event: all[seq] };
    }
    return null;
  }
  if (isLatest) {
    for (let seq = all.length - 1; seq >= 0; seq -= 1) {
      if (all[seq]?.type === 'tool/result') return { seq, event: all[seq] };
    }
    return null;
  }
  if (/^\d+$/.test(wanted)) {
    const seq = Number(wanted);
    const event = session.eventAt?.(seq);
    if (event && (event.type === 'tool/result' || event.type === 'assistant/message')) return { seq, event };
    return null;
  }
  const pred = lower;
  for (let seq = all.length - 1; seq >= 0; seq -= 1) {
    const event = all[seq];
    if (event?.type === 'tool/result') {
      const callId = String(event.data?.message?.source?.callId ?? event.data?.callId ?? '').toLowerCase();
      if (callId && callId === pred) return { seq, event };
      const toolName = getToolName(session, event)?.toLowerCase();
      if (toolName && toolName === pred) return { seq, event };
    }
  }
  return null;
}

export function registerRecallTool(ctx) {
  ctx.tools.register({
    name: 'tool_result_recall',
    description: [
      'Read back the complete original output of an earlier tool result or assistant reply, including those summarized or truncated out of the context history.',
      'Use this when a summary did not keep a detail you now need. Content is returned verbatim.'
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        seq: {
          type: 'string',
          description: 'The item to read: its seq number, its call id, a tool name, "latest", "latest-reply", or "round:<N>" (e.g. "round:2", "round:2:think", "round:2:tool"). Optional if round is provided.'
        },
        round: {
          type: 'number',
          description: '1-based turn/round number to recall (e.g. 1, 2, 3). Retrieves distilled thinking or tool calls from this specific round.'
        },
        mode: {
          type: 'string',
          enum: ['think', 'tool', 'both'],
          description: 'Modality to recall for the specified round: "think" (restore <think> reasoning only), "tool" (restore tool calls and results only), or "both" (restore both). Defaults to "both".'
        },
        reinstate: {
          type: 'boolean',
          description: 'Whether to un-distill this round in subsequent active model context requests (default: true).'
        },
        offset: { type: 'number', description: 'Skip this many characters from the start of the original.' },
        limit: { type: 'number', description: 'Return at most this many characters. Omit for the full original.' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean' },
          seq: { type: 'number' },
          round: { type: 'number' },
          mode: { type: 'string' },
          reinstated: { type: 'boolean' },
          itemType: { type: 'string' },
          toolName: { type: 'string' },
          callId: { type: 'string' },
          summarized: { type: 'boolean' },
          totalChars: { type: 'number' },
          returnedChars: { type: 'number' },
          recallTokens: { type: 'number' },
          text: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['found']
      },
      render: (_args, value) => {
        if (!value.found) return [{ type: 'text', text: 'No item matches: ' + value.reason }];
        if (value.round) {
          const header = [
            `[Round ${value.round} Recall | mode: ${value.mode || 'both'} | reinstated: ${value.reinstated ? 'yes' : 'no'}]`,
            `Full original: ${value.totalChars} chars (this recall cost ~${value.recallTokens || 0} tok)`
          ].join('\n');
          return [{ type: 'text', text: header + '\n\n' + value.text }];
        }
        const header = [
          'seq ' + value.seq + ' | ' + (value.toolName ?? value.itemType) + (value.callId ? ' | call ' + value.callId : ''),
          (value.summarized === true ? 'This item is currently distilled in model context. ' : '') +
            'Full original: ' + value.totalChars + ' chars. (this recall cost ~' + (value.recallTokens || 0) + ' tok)'
        ].join('\n');
        return [{ type: 'text', text: header + '\n\n' + value.text }];
      }
    },
    execute(args, exec) {
      const session = exec.agent?.session;
      if (session === undefined) throw new Error('tool_result_recall requires an agent session');

      // ── 1. Round-based multimodal recall ──
      const rawRound = args.round !== undefined
        ? Number(args.round)
        : (typeof args.seq === 'string' && /^round:(\d+)/i.test(args.seq) ? Number(args.seq.match(/^round:(\d+)/i)[1]) : null);

      if (rawRound !== null && Number.isInteger(rawRound)) {
        const roundNumber = rawRound;
        if (roundNumber <= 0) {
          return { found: false, reason: `Invalid round number: ${roundNumber} (must be >= 1)` };
        }
        let mode = args.mode;
        if (!mode && typeof args.seq === 'string') {
          const m = args.seq.match(/^round:\d+:(think|tool|both)/i);
          if (m) mode = m[1].toLowerCase();
        }
        mode = (mode === 'think' || mode === 'tool') ? mode : 'both';

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

        const turnMsgs = turns[roundNumber - 1];
        const extractedSections = [];

        for (const m of turnMsgs) {
          if (!m) continue;
          if (m.role === 'assistant') {
            if (mode === 'think' || mode === 'both') {
              const text = extractMessageText(m);
              const thinkMatches = text.match(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi);
              if (thinkMatches) {
                extractedSections.push(`### Round ${roundNumber} Assistant Thinking:\n` + thinkMatches.join('\n\n'));
              } else if (m.reasoning_content) {
                extractedSections.push(`### Round ${roundNumber} Assistant Thinking:\n<think>\n${m.reasoning_content}\n</think>`);
              }
            }
            if (mode === 'tool' || mode === 'both') {
              if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                const callsText = m.tool_calls.map((c) => `- Call ${c.id}: ${c.function?.name}(${c.function?.arguments || ''})`).join('\n');
                extractedSections.push(`### Round ${roundNumber} Tool Calls:\n${callsText}`);
              }
            }
          } else if (m.role === 'tool' || m.role === 'tool/result') {
            if (mode === 'tool' || mode === 'both') {
              const txt = extractMessageText(m);
              const toolName = m.toolName || m.name || m.source?.toolName || 'tool';
              const callId = m.toolCallId || m.tool_call_id || m.callId || m.source?.callId || '';
              extractedSections.push(`### Round ${roundNumber} Tool Result [${toolName}${callId ? ' ' + callId : ''}]:\n${txt}`);
            }
          }
        }

        const full = extractedSections.length > 0
          ? extractedSections.join('\n\n')
          : `[Round ${roundNumber} contains no ${mode === 'think' ? 'thinking traces' : (mode === 'tool' ? 'tool executions' : 'thinking or tool executions')}]`;

        const offset = Math.max(0, Math.trunc(args.offset ?? 0));
        const limit = args.limit === undefined ? undefined : Math.max(0, Math.trunc(args.limit));
        const text = limit === undefined ? full.slice(offset) : full.slice(offset, offset + limit);

        if (args.reinstate !== false) {
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
          mode,
          reinstated: args.reinstate !== false,
          itemType: `round_${roundNumber}_${mode}`,
          totalChars: full.length,
          returnedChars: text.length,
          recallTokens,
          text
        };
      }

      // ── 2. Classic item/seq recall ──
      const selector = args.seq ?? 'latest';
      const target = findResult(session, selector);
      if (target === null) return { found: false, reason: String(selector) };
      const original = resolveOriginal(session, target);
      const full = renderContent(original.data.message?.content);
      const offset = Math.max(0, Math.trunc(args.offset ?? 0));
      const limit = args.limit === undefined ? undefined : Math.max(0, Math.trunc(args.limit));
      const text = limit === undefined ? full.slice(offset) : full.slice(offset, offset + limit);
      const isTool = target.event.type === 'tool/result';

      // Accounting: recall re-injects content => EXTRA cost. Accumulate per session.
      let cumulative = 0;
      if (session.id) {
        try { cumulative = recordRecall(session.id, text.length); } catch (_) {}
      }
      const recallTokens = Math.round(text.length / 3.5);

      return {
        found: true,
        // Report the ORIGIN seq: the payload returned IS the origin payload, so a
        // follow-up recall(seq) must land on the same bytes, not on the summary node.
        seq: original.seq,
        itemType: original.type,
        toolName: isTool ? (getToolName(session, original) ?? String(original.data.message?.source?.toolName ?? 'unknown')) : 'assistant_reply',
        callId: isTool ? String(original.data.message?.source?.callId ?? '') : '',
        summarized: isTool
          ? (original !== target.event || !(session.surface?.nodes?.includes?.(original.seq) ?? false))
          : false,
        totalChars: full.length,
        returnedChars: text.length,
        recallTokens,
        text
      };
    }
  });
}
