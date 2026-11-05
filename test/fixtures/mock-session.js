/**
 * Mock Session for contract tests. Mirrors dsh-session's append + surface
 * semantics by delegating ALL validation to the REAL kernel foldSurface
 * (test/fixtures/kernel-surface.js, copied verbatim from
 * @deepseek-ai/dsh-session/lib/types/surface.js).
 *
 * - append() builds a frozen event at seq=log.length and validates it via
 *   foldSurface over the whole log; a kernel violation throws, exactly like the
 *   real Session.commit -> surfaceManager.validateNext path.
 * - deriveMessages() folds the surface and projects each node via the real
 *   deriveEventMessage, so a compaction replace truly removes shadowed nodes.
 */

import { foldSurface, deriveEventMessage } from './kernel-surface.js';

export class MockSession {
  constructor(projections = []) {
    this.id = 'mock-session';
    this.log = [];
    this.projections = projections;
    this._fold = { nodes: [], replacements: [], projectedMessages: new Map() };
  }

  get seq() {
    return this.log.length;
  }

  get surface() {
    return this._fold;
  }

  snapshotEvents() {
    return this.log.slice();
  }

  eventAt(seq) {
    return Number.isInteger(seq) ? this.log[seq] : undefined;
  }

  append(type, data, opts = {}) {
    const event = {
      type,
      seq: this.log.length,
      time: Date.now(),
      data: JSON.parse(JSON.stringify(data)), // snapshot, like the kernel
      ...(opts.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs }),
      ...(opts.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp })
    };
    // Validate against the real kernel BEFORE committing.
    const candidate = [...this.log, event];
    const folded = foldSurface(candidate, this.projections);
    // commit
    this.log = candidate;
    this._fold = folded;
    return event;
  }

  /** Recompute the fold (used after seeding). */
  _refold() {
    this._fold = foldSurface(this.log, this.projections);
  }

  /** Seed an event without validation (test scaffolding for append-origin log). */
  seed(type, data, opts = {}) {
    const event = {
      type,
      seq: this.log.length,
      time: Date.now(),
      data,
      ...(opts.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: opts.sourceEventSeqs }),
      ...(opts.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp })
    };
    this.log.push(event);
    this._refold();
    return event;
  }

  deriveMessages() {
    this._refold();
    const msgs = [];
    for (const seq of this._fold.nodes) {
      const msg = deriveEventMessage(this.log[seq], this._fold.projectedMessages);
      if (msg) msgs.push(msg);
    }
    return msgs;
  }
}