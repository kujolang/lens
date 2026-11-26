'use strict';
const fs = require('node:fs');

const AUTH_BYTES = 8 * 1024 * 1024;
const PROGRAM_BYTES = 8 * 1024 * 1024;

function readBounded(fd, limit) {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit - total + 1));
    const read = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (!read) return Buffer.concat(chunks, total);
    total += read;
    if (total > limit) throw Error('Input exceeds its byte limit');
    chunks.push(chunk.subarray(0, read));
  }
}

function readJson(source, limit, fromStdin = false) {
  if (fromStdin && source === '-') return parse(readBounded(0, limit));
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  if (!noFollow && !fs.lstatSync(source).isFile()) throw Error('Input must be a regular file');
  const fd = fs.openSync(source, fs.constants.O_RDONLY | noFollow | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw Error('Input must be a regular file within its byte limit');
    return parse(readBounded(fd, limit));
  } finally { fs.closeSync(fd); }
}

function parse(bytes) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function readAuthState(path) {
  try {
    const value = readJson(path, AUTH_BYTES);
    if (!value || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) throw Error('Invalid storage state');
    return value;
  } catch (_) {
    throw Error('Authentication state must be a regular Playwright storage-state JSON file of at most 8 MiB');
  }
}

function readFlowProgram(source) {
  return readJson(source, PROGRAM_BYTES, true);
}

module.exports = { readAuthState, readFlowProgram };
