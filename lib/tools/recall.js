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
          description: 'The item to read: its seq number, its call id, a tool name, "latest" (latest tool result), or "latest-reply" (latest assistant message).'
        },
        offset: { type: 'number', description: 'Skip this many characters from the start of the original.' },
        limit: { type: 'number', description: 'Return at most this many characters. Omit for the full original.' }
      },
      required: ['seq']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean' },
          seq: { type: 'number' },
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
