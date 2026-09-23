'use strict';
const STRING_BYTES = 16 * 1024;
const COLLECTION_BYTES = 1024 * 1024;
const RESULT_BYTES = 16 * 1024 * 1024;
const OMITTED = '[Lens omitted oversized evidence]';

// Self-contained so the same projection can run in the page before transport.
// Omit complete oversized strings: a prefix could expose half of a credential
// that a subsequent exact-value redactor can no longer recognize.
function boundEvidence(value, maxBytes = 1024 * 1024) {
  const stats = { omitted_strings: 0, omitted_items: 0 };
  const marker = '[Lens omitted oversized evidence]';
  function bytes(text) {
    let n = 0;
    for (const c of text) { const p = c.codePointAt(0); n += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4; }
    return n;
  }
  function visit(item, depth = 0) {
    if (typeof item === 'string') {
      if (item === marker || item.length > 16384 || bytes(item) > 16384) { stats.omitted_strings++; return marker; }
      return item;
    }
    if (!item || typeof item !== 'object') return item;
    if (depth > 32) { stats.omitted_items++; return Array.isArray(item) ? [] : {}; }
    const output = Array.isArray(item) ? [] : {};
    let used = 2;
    const keys = Object.keys(item);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i >= 5000) { stats.omitted_items += keys.length - i; break; }
      const result = visit(item[key], depth + 1);
      if (Array.isArray(output) && result && typeof result === 'object' && (result.href === marker || result.selector === marker)) { stats.omitted_items++; continue; }
      const size = bytes(JSON.stringify(result) || 'null') + bytes(key) + 4;
      if (Array.isArray(output) && used + size > maxBytes) { stats.omitted_items += keys.length - i; break; }
      used += size;
      if (Array.isArray(output)) output.push(result); else output[key] = result;
    }
    return output;
  }
  return { value: visit(value), ...stats };
}

const collections = new WeakMap();
function pushBounded(items, value, limit) {
  let state = collections.get(items);
  if (!state) { state = { bytes: 2, omitted_strings: 0, omitted_items: 0 }; collections.set(items, state); }
  if (items.length >= limit) { state.omitted_items++; return false; }
  const bounded = boundEvidence(value);
  state.omitted_strings += bounded.omitted_strings;
  state.omitted_items += bounded.omitted_items;
  const size = Buffer.byteLength(JSON.stringify(bounded.value)) + 1;
  if (state.bytes + size > COLLECTION_BYTES) { state.omitted_items++; return false; }
  state.bytes += size; items.push(bounded.value); return true;
}
function collectionStats(items) { return collections.get(items) || { omitted_strings: 0, omitted_items: 0 }; }
function stringifyResult(result) {
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) > RESULT_BYTES) throw new Error('Lens result exceeds the 16 MiB evidence limit; reduce the capture scope.');
  return json;
}
module.exports = { STRING_BYTES, COLLECTION_BYTES, RESULT_BYTES, OMITTED, boundEvidence, pushBounded, collectionStats, stringifyResult };

async function evaluateBounded(page, collector, argument) {
  // Only repository-owned function source is compiled; page data is passed as
  // Playwright's separate serialized argument, never interpolated as code.
  const projection = new Function('input', `return (async () => {
    const value = await (${collector.toString()})(input);
    return (${boundEvidence.toString()})(value);
  })()`);
  const result = await page.evaluate(projection, argument);
  if (result.omitted_strings || result.omitted_items) page.evidenceLimitReached = true;
  return result.value;
}
function finishEvidence(result, page, arrays = []) {
  const bounded = boundEvidence(result, RESULT_BYTES);
  const reached = !!(page?.evidenceLimitReached || bounded.omitted_strings || bounded.omitted_items || arrays.some(items => {
    const stats = collectionStats(items); return stats.omitted_strings || stats.omitted_items;
  }));
  bounded.value.evidence_limits = { ...bounded.value.evidence_limits, max_string_bytes: STRING_BYTES, max_collection_bytes: COLLECTION_BYTES, byte_limit_reached: reached };
  return bounded.value;
}
module.exports.evaluateBounded = evaluateBounded;
module.exports.finishEvidence = finishEvidence;
