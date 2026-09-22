'use strict';
// Per-context HTTP(S)/WebSocket destination enforcement. Redirects are checked
// at the next proxy request/CONNECT, before any outbound socket is opened.
const http = require('node:http');
const net = require('node:net');

function destination(raw, connect = false) {
  if (typeof raw !== 'string' || /[\s\\]/.test(raw)) return null;
  try {
    if (!connect && !/^http:\/\//i.test(raw)) return null;
    const url = new URL(connect ? `http://${raw}` : raw);
    if (url.username || url.password || (connect && (url.pathname !== '/' || url.search || url.hash))) return null;
    const host = url.hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return null;
    return { host: host === '[::1]' ? '::1' : host, port: Number(url.port || (connect ? 443 : 80)), path: url.pathname + url.search, authority: url.host };
  } catch (_) { return null; }
}

// Resolve localhost only to literal loopback addresses. Node's dual-stack
// connection selection preserves IPv4-only and IPv6-only development servers.
function connectionOptions(target) {
  return { host: target.host, port: target.port, autoSelectFamily: true,
    lookup(_hostname, options, callback) {
      const addresses = [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }];
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
  };
}

async function createNetworkPolicy() {
  const sockets = new Set();
  const stats = { mode: 'loopback-http', service_workers: 'blocked', blocked_requests: 0 };
  let port, closed = false;
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    return socket;
  };
  function admit(req, connect = false) {
    const target = destination(req.url, connect);
    if (!target || target.port === port) { stats.blocked_requests++; return null; }
    return target;
  }
  const server = http.createServer({ maxHeaderSize: 16384 }, (req, res) => {
    const target = admit(req);
    if (!target) { req.resume(); res.writeHead(403); return res.end('Lens blocked a non-loopback browser destination.'); }
    // Strip proxy credentials/hop options; never forward them to the app.
    const headers = { ...req.headers, host: target.authority };
    delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const upstream = http.request({ ...connectionOptions(target), path: target.path, method: req.method, headers, agent: false }, response => {
      res.writeHead(response.statusCode, response.statusMessage, response.headers);
      response.pipe(res);
    });
    upstream.on('socket', track);
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connect', (req, socket, head) => {
    const target = admit(req, true);
    if (!target) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.pause();
    const upstream = track(net.connect(connectionOptions(target)));
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.once('close', () => socket.destroy());
  });
  server.on('upgrade', (req, socket, head) => {
    const target = admit(req);
    if (!target) return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const headers = { ...req.headers, host: target.authority };
    delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const upstream = http.request({ ...connectionOptions(target), path: target.path, method: req.method, headers, agent: false });
    upstream.on('socket', track);
    upstream.once('upgrade', (response, peer, initial) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (initial.length) socket.write(initial);
      if (head.length) peer.write(head);
      socket.pipe(peer); peer.pipe(socket);
      socket.once('close', () => peer.destroy());
      peer.once('close', () => socket.destroy());
    });
    upstream.once('response', response => { response.resume(); socket.destroy(); });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });
  server.on('connection', track);
  server.on('clientError', (_, socket) => socket.destroy());
  server.maxConnections = 256;
  server.on('drop', () => { stats.blocked_requests++; });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  return {
    proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
    stats,
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      for (const socket of sockets) socket.destroy();
      return new Promise(resolve => server.close(resolve));
    },
  };
}

async function createContext(browser, options = {}, allowExternal = false, timeoutMs = 30000) {
  if (allowExternal === true) {
    const context = await browser.newContext(options);
    context.networkPolicy = { mode: 'external-opt-in', blocked_requests: 0 };
    return context;
  }
  // WebKit's native dedicated-worker WebSockets bypass its HTTP proxy on
  // macOS. Refuse restricted contexts before opening any page. Opt-in keeps
  // the engine available for trusted applications without a false boundary.
  if (browser.browserType?.().name() === 'webkit') {
    throw new Error('WebKit cannot enforce Lens loopback destinations. Use Chromium/Firefox, or explicitly allow external access for a trusted application.');
  }
  const policy = await createNetworkPolicy();
  let timer;
  const proxy = policy.proxy;
  const pending = Promise.resolve().then(() => browser.newContext({ ...options, proxy, serviceWorkers: 'block' }));
  try {
    const context = await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser context creation deadline reached')), timeoutMs);
    })]);
    context.networkPolicy = policy.stats;
    context.once('close', () => { void policy.close(); });
    return context;
  } catch (error) {
    void pending.then(context => context.close().catch(() => {}), () => {});
    await policy.close(); throw error;
  } finally { clearTimeout(timer); }
}
module.exports = { destination, createNetworkPolicy, createContext };
