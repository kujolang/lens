#!/usr/bin/env node
'use strict';
// Session supervisor: Kujo retains the queue, policy and reporting. This host
// accepts only observation jobs and owns at most one browser process. No daemon
// discovery, persistent auth files, shared profiles, TCP listener or flow replay.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserHost } = require('./runtime');

async function serve(socketPath, { idleMs = 60000 } = {}) {
  const host = new BrowserHost();
  const sockets = new Set();
  let busy = false, stopped = false, timer, contexts = 0, pages = 0;
  function idle() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(() => host.close(), idleMs);
    timer.unref();
  }
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let ownsJob = false;
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      // An abandoned request must not retain a busy browser/auth context.
      if (ownsJob) void host.close();
    });
    socket.on('error', () => {});
    socket.setTimeout(180000, () => socket.destroy());
    let input = '', accepted = false;
    socket.on('data', async chunk => {
      if (accepted) return socket.destroy();
      input += chunk.toString();
      if (Buffer.byteLength(input) > 1024 * 1024) return socket.destroy();
      if (!input.includes('\n')) return;
      accepted = true;
      if (busy) return socket.end(JSON.stringify({ viewports: [], provider_errors: ['Browser session busy'] }));
      busy = true;
      ownsJob = true;
      clearTimeout(timer);
      try {
        const opts = JSON.parse(input);
        input = '';
        if (!opts || typeof opts.url !== 'string' || !Array.isArray(opts.viewports)) throw new Error('Invalid job');
        const result = await require('./browser-bridge').capture(opts, host);
        contexts += result.metadata.contexts_created || 0;
        pages += result.metadata.pages_captured || 0;
        result.metadata.session = { browser_launches: host.launches, contexts_created: contexts, pages_captured: pages };
        socket.end(JSON.stringify(result));
      } catch (_) {
        socket.end(JSON.stringify({ viewports: [], provider_errors: ['Browser session capture failed'] }));
      } finally { ownsJob = false; busy = false; idle(); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  fs.chmodSync(socketPath, 0o600);
  return {
    host,
    async close() {
      stopped = true;
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      await host.close();
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) throw new Error('Session child is required');
  // /tmp keeps Unix socket paths below macOS's short path limit. mkdtemp uses
  // an unpredictable name and the directory is accessible only to this user.
  const directory = fs.mkdtempSync('/tmp/lens-session-');
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, 'runtime.sock');
  let service;
  try { service = await serve(socketPath); }
  catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit', detached: true,
    env: { ...process.env, LENS_SESSION_SOCKET: socketPath, LENS_SESSION_OWNER: String(process.pid) },
  });
  let stopping = false;
  async function stop(code, signal) {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
      fs.rmSync(directory, { recursive: true, force: true });
      process.exit(code);
    }, 3000);
    if (signal) { try { process.kill(-child.pid, signal); } catch (_) {} }
    await service.close();
    if (signal && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true });
    clearTimeout(force);
    process.exitCode = code;
  }
  child.once('error', () => stop(3));
  child.once('exit', (code, signal) => stop(code ?? (signal === 'SIGINT' ? 130 : 143)));
  process.once('SIGINT', () => stop(130, 'SIGINT'));
  process.once('SIGTERM', () => stop(143, 'SIGTERM'));
}
if (require.main === module) main().catch(() => { console.error('Browser session failed'); process.exitCode = 3; });
module.exports = { serve };
