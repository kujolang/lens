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
  function measureString(text, rawLimit = Infinity) {
    let raw = 0;
    let quoted = 2;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code < 128) {
        raw += 1;
        if (code >= 32) quoted += code === 34 || code === 92 ? 2 : 1;
        else quoted += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
      } else if (code < 2048) {
        raw += 2; quoted += 2;
      } else if (code >= 0xd800 && code <= 0xdfff) {
        const next = text.charCodeAt(index + 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          raw += 4; quoted += 4; index += 1;
        } else {
          raw += 3; quoted += 6;
        }
      } else {
        raw += 3; quoted += 3;
      }
      if (raw > rawLimit) break;
    }
    return { raw, quoted };
  }
  function visit(item, depth, budget) {
    if (typeof item === 'string') {
      const size = item.length > 16384 ? null : measureString(item, 16384);
      if (item === marker || !size || size.raw > 16384) {
        stats.omitted_strings++;
        return { value: marker, bytes: marker.length + 2 };
      }
      return { value: item, bytes: size.quoted };
    }
    if (!item || typeof item !== 'object') return { value: item, bytes: (JSON.stringify(item) || 'null').length };
    const array = Array.isArray(item);
    const output = array ? [] : {};
    if (depth > 32) {
      stats.omitted_items++;
      return { value: output, bytes: 2 };
    }
    let used = 2;
    let entries = 0;
    let exhausted = false;
    const keys = Object.keys(item);
    for (let index = 0; index < keys.length; index++) {
      if (index >= 5000) { stats.omitted_items += keys.length - index; break; }
      const key = keys[index];
      const keySize = array ? null : measureString(key, 16384);
      if (keySize && keySize.raw > 16384) { stats.omitted_items++; continue; }
      const overhead = (entries > 0 ? 1 : 0) + (keySize ? keySize.quoted + 1 : 0);
      const available = budget - used - overhead;
      if (available < 1) {
        stats.omitted_items += keys.length - index;
        return { value: output, bytes: used, exhausted: true };
      }
      const projected = visit(item[key], depth + 1, available);
      const value = projected.value;
      if (array && value && typeof value === 'object' && (value.href === marker || value.selector === marker)) {
        stats.omitted_items++; continue;
      }
      if (projected.bytes > available || (array && projected.exhausted)) {
        stats.omitted_items += keys.length - index;
        return { value: output, bytes: used, exhausted: true };
      }
      if (array) output.push(value);
      else if (key === '__proto__') Object.defineProperty(output, key, { value, enumerable: true, configurable: true, writable: true });
      else output[key] = value;
      used += overhead + projected.bytes;
      entries += 1;
      exhausted ||= !!projected.exhausted;
    }
    return { value: output, bytes: used, exhausted };
  }
  const projected = visit(value, 0, maxBytes);
  return { value: projected.value, bytes: projected.bytes, ...stats };
}

const collections = new WeakMap();
function pushBounded(items, value, limit) {
  let state = collections.get(items);
  if (!state) { state = { bytes: 2, omitted_strings: 0, omitted_items: 0 }; collections.set(items, state); }
  if (items.length >= limit) { state.omitted_items++; return false; }
  const bounded = boundEvidence(value);
  state.omitted_strings += bounded.omitted_strings;
  state.omitted_items += bounded.omitted_items;
  const size = bounded.bytes + 1;
  if (state.bytes + size > COLLECTION_BYTES) { state.omitted_items++; return false; }
  state.bytes += size; items.push(bounded.value); return true;
}
function collectionStats(items) { return collections.get(items) || { omitted_strings: 0, omitted_items: 0 }; }
function serializeResult(result) {
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) <= RESULT_BYTES) return { json, exceeded: false };
  const message = 'Lens result exceeds the 16 MiB evidence limit; reduce the capture scope.';
  return {
    json: JSON.stringify({ error: message, message, viewports: [], provider_errors: [message] }),
    exceeded: true,
  };
}
module.exports = { STRING_BYTES, COLLECTION_BYTES, RESULT_BYTES, OMITTED, boundEvidence, pushBounded, collectionStats, serializeResult };

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
