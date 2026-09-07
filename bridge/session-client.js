'use strict';
const net = require('node:net');

// A private, session-owned Unix socket; no auth state or job bodies on disk.
function captureInSession(opts) {
  const bootMs = process.uptime() * 1000;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(process.env.LENS_SESSION_SOCKET);
    socket.setEncoding('utf8');
    let data = '', bytes = 0;
    const fail = () => { socket.destroy(); reject(new Error('Browser session unavailable')); };
    socket.setTimeout(180000, fail);
    socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify(opts) + '\n'));
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 64 * 1024 * 1024) return fail();
      data += chunk;
    });
    socket.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.metadata?.timings) result.metadata.timings.process_boot_ms = Math.round(bootMs * 100) / 100;
        resolve(result);
      }
      catch (_) { fail(); }
    });
  });
}
module.exports = { captureInSession };
