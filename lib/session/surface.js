/**
 * dsh-oswyn/session/surface — the ONLY layer allowed to call session.append.
 *
 * Wraps the exact canonical surface operations validated against the real
 * dsh-session kernel (see @deepseek-ai/dsh-session/lib/types/surface.js):
 *
 *   SURFACE_EVENT_TYPES = { system/message, developer/message, user/message,
 *                           assistant/message, tool/result }
 *   - tool/call is NOT surface-eligible → its args cannot carry surfaceOp.
 *   - assistant/message CANNOT carry sourceEventSeqs → its raw replace always
 *     throws. We never attempt it.
 *
 * Negative-delta reality (mirrors dsh-billion-context-native):
 *   1. tool result = a single-node tool/result surfaceOp:replace (content-only).
 *   2. reply compression / whole-discard = a user/message checkpoint event with
 *      surfaceOp:{op:'replace',startSeq,endSeq} + sourceEventSeqs covering the
 *      entire shadowed range. foldSurface splices those nodes out of the
 *      surface, so deriveMessages() returns strictly fewer/shorter messages.
 *
 * Every call degrades gracefully: on any kernel error we return {ok:false,reason}
 * and never throw to the caller/user.
 *
 * Pure aside from the session handle it is handed; no node:fs.
 *
 * @module dsh-oswyn/session/surface
 */

/** Extract the plain-text of a tool/result or message event. */
export function getEventText(event) {
  const blocks = event?.data?.message?.content ?? event?.data?.content;
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('\n');
}

/** Resolve a tool name for an event (direct source, then via sourceEventSeqs across hops). */
export function getToolName(session, event) {
  if (!event) return undefined;
  let cur = event;
  const seen = new Set();
  for (let hop = 0; hop < 8 && cur; hop += 1) {
    const direct = cur.data?.message?.source?.toolName ?? cur.data?.toolName;
    if (direct) return String(direct);
    const srcs = cur.sourceEventSeqs;
    if (!Array.isArray(srcs)) break;
    let next = null;
    for (const srcSeq of srcs) {
      if (seen.has(srcSeq)) continue;
      seen.add(srcSeq);
      let srcEv;
      if (typeof session?.eventAt === 'function') {
        srcEv = session.eventAt(srcSeq);
      } else if (typeof session?.snapshotEvents === 'function') {
        srcEv = session.snapshotEvents().find((e) => e?.seq === srcSeq);
      }
      if (srcEv?.type === 'tool/call' && srcEv.data?.name) {
        return String(srcEv.data.name);
      }
      if (srcEv?.type === 'tool/result' && !next) {
        next = srcEv;
      }
    }
    cur = next;
  }
  const callId = event.data?.message?.source?.callId || event.data?.message?.toolCallId || event.data?.callId;
  if (callId && typeof session?.snapshotEvents === 'function') {
    const callEv = session.snapshotEvents().find((e) => e?.type === 'tool/call' && (e.data?.callId === callId || e.data?.id === callId));
    if (callEv?.data?.name) return String(callEv.data.name);
  }
  const text = getEventText(event).trim();
  if (/^(?:Error:\s*code run failed)/i.test(text)) {
    return 'run_code';
  }
  if (/(?:\[genui-validation\]|^UI validation result:)/i.test(text)) {
    return 'validate_dsh_ui';
  }
  return undefined;
}

/** Measure the character length of tool-call arguments (0 when empty or "{}"). */
export function measureArgsLen(raw) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}' || trimmed === 'null') return 0;
    return raw.length;
  }
  if (raw && typeof raw === 'object') {
    try {
      const s = JSON.stringify(raw);
      if (!s || s === '{}' || s === 'null') return 0;
      return s.length;
    } catch (_) {
      return 0;
    }
  }
  return 0;
}

/**
 * Resolve the character length of the tool-call input arguments corresponding
 * to a tool/result event or callId. Scans both `tool/call` events and
 * `assistant/message` tool-call blocks (`block.callId || block.id`).
 */
export function getCallInputChars(session, event, explicitCallId = '') {
  if (!session || typeof session.snapshotEvents !== 'function') return 0;
  let callId = String(
    explicitCallId
    || event?.data?.message?.source?.callId
    || event?.data?.message?.toolCallId
    || event?.data?.callId
    || ''
  );
  const all = session.snapshotEvents();
  if (!callId && event && Array.isArray(event.sourceEventSeqs)) {
    for (const s of event.sourceEventSeqs) {
      const srcEv = typeof session.eventAt === 'function' ? session.eventAt(s) : all.find((e) => e?.seq === s);
      if (srcEv?.type === 'tool/call' && (srcEv.data?.callId || srcEv.data?.id)) {
        callId = String(srcEv.data.callId || srcEv.data.id);
        break;
      }
    }
  }
  if (!callId) return 0;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const ev = all[i];
    if (!ev) continue;
    if (ev.type === 'tool/call' && (ev.data?.callId === callId || ev.data?.id === callId)) {
      const len = measureArgsLen(ev.data?.arguments ?? ev.data?.input);
      if (len > 0) return len;
    }
    if (ev.type === 'assistant/message') {
      const blocks = ev.data?.message?.content ?? ev.data?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && b.type === 'tool-call' && (b.callId === callId || b.id === callId)) {
            const len = measureArgsLen(b.arguments ?? b.input);
            if (len > 0) return len;
          }
        }
      }
    }
  }
  return 0;
}

/** Whether the surface currently shows this seq (i.e. it was not already replaced). */
export function isOnSurface(session, seq) {
  const nodes = session?.surface?.nodes;
  if (!Array.isArray(nodes)) return true; // cannot tell → optimistically allow
  return nodes.includes(seq);
}

/**
 * Replace a single tool/result node with new content (content-only rewrite).
 * The kernel requires exactly one shadowed node and that ONLY content changes,
 * so we copy the original data and swap message.content.
 *
 * @param {object} session
 * @param {number} seq  target tool/result seq
 * @param {Array<{type:'text',text:string}>} content  new content blocks
 * @returns {{ok:boolean, seq?:number, event?:object, reason?:string}}
 */
export function appendToolResultReplace(session, seq, content) {
  try {
    if (!session || typeof session.append !== 'function') {
      return { ok: false, reason: 'no session.append' };
    }
    const orig = typeof session.eventAt === 'function' ? session.eventAt(seq) : undefined;
    if (!orig) return { ok: false, reason: `no event at seq ${seq}` };
    if (orig.type !== 'tool/result') {
      return { ok: false, reason: `seq ${seq} is ${orig.type}, not tool/result` };
    }
    if (!isOnSurface(session, seq)) {
      return { ok: false, reason: `seq ${seq} already replaced (not on surface)` };
    }
    const origData = orig.data;
    const replacementData = {
      ...origData,
      message: { ...origData.message, content }
    };
    const event = session.append('tool/result', replacementData, {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
      sourceEventSeqs: [seq]
    });
    return { ok: true, seq, event };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error) };
  }
}

/** Build the inclusive integer range [start..end]. */
function denseRange(startSeq, endSeq) {
  const first = Math.min(startSeq, endSeq);
  const last = Math.max(startSeq, endSeq);
  const out = [];
  for (let s = first; s <= last; s += 1) out.push(s);
  return out;
}

/**
 * Replace an entire surface range [startSeq..endSeq] with a single user/message
 * checkpoint carrying `text`. This is the ONLY correct negative-delta path for
 * reply compression and whole-discard: the kernel splices every shadowed node
 * out of the surface, so deriveMessages() gets one short memo where N messages
 * used to be.
 *
 * The checkpoint data IS the message (user/message derives as event.data), and
 * sourceEventSeqs must cover EVERY shadowed surface node plus any of their
 * source refs, hence we pass the dense range.
 *
 * @param {object} session
 * @param {number} startSeq
 * @param {number} endSeq
 * @param {string} text
 * @param {{seqs?:number[], source?:object}} [opts] extra explicit source seqs
 * @returns {{ok:boolean, seq?:number, event?:object, reason?:string}}
 */
export function appendCheckpointReplace(session, startSeq, endSeq, text, opts = {}) {
  try {
    if (!session || typeof session.append !== 'function') {
      return { ok: false, reason: 'no session.append' };
    }
    const first = Math.min(startSeq, endSeq);
    const last = Math.max(startSeq, endSeq);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0) {
      return { ok: false, reason: `invalid range ${startSeq}..${endSeq}` };
    }
    const nextSeq = typeof session.seq === 'number'
      ? session.seq
      : (session.log ? session.log.length : undefined);
    if (typeof nextSeq === 'number' && last >= nextSeq) {
      return { ok: false, reason: `range end ${last} >= next seq ${nextSeq} (must reference earlier events)` };
    }
    if (!isOnSurface(session, first) || !isOnSurface(session, last)) {
      return { ok: false, reason: `range ${first}..${last} not fully on current surface` };
    }
    // Dense source coverage of the shadowed range; union any extra explicit seqs.
    const srcSet = new Set(denseRange(first, last));
    if (Array.isArray(opts.seqs)) {
      for (const s of opts.seqs) if (Number.isInteger(s) && s < first) srcSet.add(s);
    }
    const sourceEventSeqs = [...srcSet].sort((a, b) => a - b);
    // user/message: the event DATA *is* the message (kernel derives it directly),
    // and the kernel REQUIRES a non-empty string id ("lacks an identified message"
    // otherwise). assistant/system/developer/tool events instead nest it under
    // data.message — user/message is the exception.
    const data = {
      id: 'oswyn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      role: 'user',
      source: opts.source ?? { kind: 'oswyn-compaction' },
      content: [{ type: 'text', text: String(text) }]
    };
    const event = session.append('user/message', data, {
      surfaceOp: { op: 'replace', startSeq: first, endSeq: last },
      sourceEventSeqs
    });
    return { ok: true, seq: event.seq, event };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error) };
  }
}
