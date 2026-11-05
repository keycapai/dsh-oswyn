/**
 * Regression: tool_result_recall must return the PRISTINE original payload even
 * after the surface node was rewritten by an oswyn distillation.
 *
 * Bug: recall read target.event.data directly. A distilled tool/result node is
 * itself a tool/result event carrying sourceEventSeqs:[origin], so recall used to
 * echo the [oswyn-meta:] summary back instead of the original output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSession } from './fixtures/mock-session.js';
import { appendToolResultReplace } from '../lib/session/surface.js';
import { plan } from '../lib/core/plan.js';
import { parseSummaryBody } from '../lib/core/parse.js';

const ORIGINAL = Array.from({ length: 120 }, (_, i) => 'ORIG_LINE_' + (i + 1) + ' ' + 'z'.repeat(30)).join('\n');

function seedToolResult(session, text) {
  // The kernel requires every surface-eligible event to carry a surfaceOp;
  // the first landing of a tool/result is an 'append'.
  return session.seed('tool/result', {
    message: { source: { toolName: 'bash', callId: 'call-1' }, content: [{ type: 'text', text }] }
  }, { surfaceOp: 'append' });
}

/** Minimal reproduction of recall's resolveOriginal walk. */
function resolveOriginal(session, event) {
  let cur = event;
  const seen = new Set();
  for (let hop = 0; hop < 16; hop += 1) {
    const srcs = cur?.sourceEventSeqs;
    if (!Array.isArray(srcs) || srcs.length === 0) break;
    let parent = null;
    for (const s of srcs) {
      if (seen.has(s)) continue;
      seen.add(s);
      const ev = session.eventAt(s);
      if (ev && ev.type === 'tool/result') { parent = ev; break; }
    }
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return cur;
}

function contentText(event) {
  const blocks = event?.data?.message?.content;
  return Array.isArray(blocks) ? blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n') : '';
}

test('recall: distilled surface node still resolves to the pristine original', () => {
  const session = new MockSession();
  const origin = seedToolResult(session, ORIGINAL);

  const parsed = parseSummaryBody('', 'truncate keep 10 lines\n- kept facts');
  const p = plan({ seq: origin.seq, event: origin }, parsed, 'bash');
  assert.ok(p.content, 'plan must produce a rewrite for this fixture');

  const write = appendToolResultReplace(session, origin.seq, p.content);
  assert.equal(write.ok, true, write.reason);

  // The replacement is APPENDED at a new seq and shadows origin.seq via
  // surfaceOp:{op:'replace',startSeq:origin,seq}, so the distilled node is
  // write.event — not eventAt(origin.seq), which stays pristine.
  const rewritten = write.event;
  assert.notEqual(rewritten.seq, origin.seq);
  assert.deepEqual(rewritten.sourceEventSeqs, [origin.seq]);
  assert.equal(rewritten.surfaceOp.op, 'replace');
  assert.equal(rewritten.surfaceOp.startSeq, origin.seq);
  const shallow = contentText(rewritten);
  assert.match(shallow, /\[oswyn-meta: before=/, 'surface node now carries the summary banner');
  assert.equal(shallow.includes('ORIG_LINE_120'), false, 'tail was pruned from the surface node');

  const resolved = resolveOriginal(session, rewritten);
  assert.equal(resolved.seq, origin.seq, 'must walk back to the origin seq');
  const full = contentText(resolved);
  assert.equal(full, ORIGINAL, 'recall payload must be byte-identical to the original');
  assert.equal(full.includes('ORIG_LINE_120'), true, 'the pruned tail is recoverable');
});

test('recall: an untouched tool/result resolves to itself', () => {
  const session = new MockSession();
  const origin = seedToolResult(session, ORIGINAL);
  const resolved = resolveOriginal(session, session.eventAt(origin.seq));
  assert.equal(resolved.seq, origin.seq);
  assert.equal(contentText(resolved), ORIGINAL);
});
