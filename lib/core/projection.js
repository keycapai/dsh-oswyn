/**
 * dsh-oswyn/core/projection — pure tool-call argument projection.
 *
 * Pure module: no node:fs, no node:path, no ctx, no side effects.
 * Shrinks oversized `code` / `spec` arguments inside an assistant message's
 * tool-call blocks to a short pseudocode placeholder, leaving every other
 * block and field byte-for-byte intact. Idempotent and strictly non-growing.
 *
 * @module dsh-oswyn/core/projection
 */

const DEFAULT_MAX_CODE_LEN = 150;
const DEFAULT_MAX_SPEC_LEN = 150;

function placeholder(field, originalLen) {
  if (field === 'spec') {
    return `// [oswyn: spec 已折叠，原 ${originalLen} 字符 · 伪代码占位；完整内容见历史]`;
  }
  return `// [oswyn: code 已折叠，原 ${originalLen} 字符 · 伪代码占位；完整内容见历史]`;
}

function shrinkField(value, maxLen) {
  if (typeof value !== 'string' || value.length <= maxLen) return { value, changed: false };
  return { value: placeholder(value.length > 0 ? 'code' : 'code', value.length), changed: true };
}

/**
 * Project one parsed-arguments object: replace oversized code/spec leaves.
 * Returns a NEW object; never mutates input.
 */
function projectArgsObject(args, { maxCodeLen, maxSpecLen }) {
  if (!args || typeof args !== 'object') return { args, changed: false };
  const out = Array.isArray(args) ? args.slice() : { ...args };
  let changed = false;

  if (typeof out.code === 'string' && out.code.length > maxCodeLen) {
    out.code = placeholder('code', out.code.length);
    changed = true;
  }
  if (typeof out.spec === 'string' && out.spec.length > maxSpecLen) {
    out.spec = placeholder('spec', out.spec.length);
    changed = true;
  }
  return { args: out, changed };
}

function projectBlock(block, limits) {
  if (!block || block.type !== 'tool-call') return { block, changed: false };
  const raw = block.arguments;
  if (raw === undefined || raw === null) return { block, changed: false };

  // arguments may be a JSON string or an object
  if (typeof raw === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { block, changed: false };
    }
    const { args, changed } = projectArgsObject(parsed, limits);
    if (!changed) return { block, changed: false };
    return { block: { ...block, arguments: JSON.stringify(args) }, changed: true };
  }

  const { args, changed } = projectArgsObject(raw, limits);
  if (!changed) return { block, changed: false };
  return { block: { ...block, arguments: args }, changed: true };
}

/**
 * Prune oversized tool-call arguments in a single assistant message.
 * Accepts either a Message ({content:[...]}) or a raw content-blocks array.
 * Returns a NEW value of the same shape; whatever does not change is reused.
 *
 * @param {object|Array} message
 * @param {{maxCodeLen?:number, maxSpecLen?:number}} [opts]
 * @returns {object|Array}
 */
export function pruneToolCallArgs(message, opts = {}) {
  const limits = {
    maxCodeLen: Number.isFinite(opts.maxCodeLen) ? opts.maxCodeLen : DEFAULT_MAX_CODE_LEN,
    maxSpecLen: Number.isFinite(opts.maxSpecLen) ? opts.maxSpecLen : DEFAULT_MAX_SPEC_LEN
  };

  const asBlocks = Array.isArray(message) ? message : message?.content;
  if (!Array.isArray(asBlocks)) return message;

  let touched = false;
  const nextBlocks = asBlocks.map((b) => {
    const { block, changed } = projectBlock(b, limits);
    if (changed) touched = true;
    return block;
  });

  if (!touched) return message;
  if (Array.isArray(message)) return nextBlocks;
  return { ...message, content: nextBlocks };
}
