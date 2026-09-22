'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { destination, createNetworkPolicy, createContext } = require('../network-policy');
const { launchBrowser } = require('../runtime');
const { boundEvidence, pushBounded, collectionStats, stringifyResult, OMITTED, COLLECTION_BYTES } = require('../evidence');

async function listen(server, host = '127.0.0.1') {
  await new Promise(resolve => server.listen(0, host, resolve));
  return server.address().port;
}
test('destination admission normalizes authorities, pins loopback, and rejects alternate destinations', () => {
  for (const url of ['http://localhost:80/a', 'http://127.0.0.1/a', 'http://[::1]:99/', 'http://2130706433/']) assert.ok(destination(url), url);
  for (const url of ['http://localhost.evil/', 'http://localhost@evil/', 'http://127.0.0.2/', 'http://localhost./', 'file:///etc/passwd', 'http://localhost\\@evil/', '/origin-form']) assert.equal(destination(url), null, url);
  assert.equal(destination('localhost:443', true).host, 'localhost');
  assert.equal(destination('example.com:443', true), null);
});
test('proxy rejects an external CONNECT before any socket and cleans up idle connections', async () => {
  const policy = await createNetworkPolicy();
  const socket = net.connect(Number(new URL(policy.proxy.server).port), '127.0.0.1');
  try {
    const data = await new Promise((resolve, reject) => {
      socket.once('error', reject); socket.once('data', b => resolve(b.toString()));
      socket.write('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n');
    });
    assert.match(data, /403/); assert.equal(policy.stats.blocked_requests, 1);
  } finally { socket.destroy(); await policy.close(); }
});
test('evidence bounds omit whole Unicode credentials, reject oversized links, and cap collection bytes', () => {
  const secret = '🔑'.repeat(5000);
  const bound = boundEvidence({ value: secret, normal: 'hello', links: [{href:secret,text:'x'}] });
  assert.equal(bound.value.value, OMITTED); assert.equal(bound.value.normal, 'hello'); assert.deepEqual(bound.value.links, []);
  const items=[];
  for(let i=0;i<1000;i++) pushBounded(items,{text:'x'.repeat(15000)},1000);
  assert.ok(Buffer.byteLength(JSON.stringify(items)) <= COLLECTION_BYTES);
  assert.ok(collectionStats(items).omitted_items > 0);
  assert.throws(()=>stringifyResult({text:'x'.repeat(17*1024*1024)}), /16 MiB/);
});

// The trailing-dot localhost spelling is deliberately outside Lens's
// allowlist but resolves locally: a controlled sink with a positive control.
for (const engine of (process.env.LENS_POLICY_ENGINES || 'chromium').split(',')) {
  test(`${engine}: redirects, resources, popups, workers and sockets cannot reach disallowed sink; opt-in can`, { skip: process.env.LENS_SKIP_BROWSER_TESTS === '1', timeout: 30000 }, async () => {
    let hits=0; const hitPaths=[];
    const sink=http.createServer((req,res)=>{hits++; hitPaths.push(req.url); res.end('external sink');});
    let source, browser, restricted, permitted;
    try {
      const sinkPort=await listen(sink,'0.0.0.0');
      const external=`http://localhost.:${sinkPort}`;
      source=http.createServer((req,res)=>{
        if(req.url==='/redirect'){res.writeHead(302,{location:external});return res.end();}
        if(req.url==='/local'){res.writeHead(302,{location:'/'});return res.end();}
        if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(`self.addEventListener('install',e=>e.waitUntil(fetch('${external}/worker').catch(()=>{})));`);}
        res.setHeader('Content-Type','text/html');
        res.end(`<h1>local</h1><a id="leave" href="${external}/click">Leave</a>`);
      });
      source.on('upgrade',(req,socket)=>{
        const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        socket.write(Buffer.from([0x81,2,111,107]));
        socket.on('error',()=>{});
        socket.on('data',()=>socket.end(Buffer.from([0x88,0])));
      });
      const sourcePort=await listen(source); const local=`http://127.0.0.1:${sourcePort}`;
      browser=await launchBrowser(engine);
      if(engine === 'webkit') {
        await assert.rejects(createContext(browser), /WebKit cannot enforce/);
        assert.equal(hits, 0);
        permitted=await createContext(browser,{},true);
        const allowed=await permitted.newPage(); await allowed.goto(external);
        assert.ok(hits>0); await permitted.close();
        return;
      }
      restricted=await createContext(browser);
      const page=await restricted.newPage();
      await page.goto(local+'/local'); assert.match(await page.title(), /^$/);
      const messages=await page.evaluate(async ({local, workerSupported})=>{
        const wsURL=local.replace('http:','ws:')+'/allowed-ws';
        const pageMessage=await new Promise((resolve,reject)=>{
          const ws=new WebSocket(wsURL);ws.onmessage=e=>{ws.close();resolve(e.data);};ws.onerror=reject;
        });
        if (!workerSupported) return [pageMessage];
        const workerMessage=await new Promise((resolve,reject)=>{
          const source=`const ws=new WebSocket(${JSON.stringify(wsURL)});ws.onmessage=e=>{ws.close();postMessage(e.data);};`;
          const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
          worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.onerror=reject;
        });
        return [pageMessage,workerMessage];
      },{local,workerSupported:engine==='chromium'});
      // Playwright 1.61.1 Firefox crashes on a successful worker WebSocket even
      // without Lens (audit reproduction). Page sockets remain supported.
      assert.deepEqual(messages,engine==='chromium'?['ok','ok']:['ok']);
      await page.goto(local+'/redirect').catch(()=>{}); assert.equal(hits,0);
      await page.goto(local);
      await page.evaluate(async external=>{
        await Promise.all([
          fetch(external+'/fetch').catch(()=>{}),
          new Promise(resolve=>{const image=new Image();image.onload=image.onerror=resolve;image.src=external+'/image';}),
          new Promise(resolve=>{const script=document.createElement('script');script.onload=script.onerror=resolve;script.src=external+'/script';document.body.append(script);}),
          new Promise(resolve=>{const socket=new WebSocket(external.replace('http:','ws:')+'/ws');socket.onopen=socket.onerror=socket.onclose=()=>{socket.close();resolve();};})
        ]);
        await new Promise(resolve => {
          const source = `const ws = new WebSocket(${JSON.stringify(external.replace('http:','ws:')+'/worker-ws')}); ws.onopen=ws.onerror=ws.onclose=()=>postMessage('done');`;
          const worker = new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
          worker.onmessage=()=>{worker.terminate();resolve();};
        });
        navigator.sendBeacon(external+'/beacon','probe');
        void navigator.serviceWorker?.register('/worker.js').catch(()=>{});
        window.open(external+'/popup');
      }, external);
      await page.click('#leave');
      await page.goto(local);
      await page.evaluate(external=>{location.href=external+'/script-navigation';},external);
      // Closing drains/cancels all outstanding work; no arbitrary sleep.
      await restricted.close();
      assert.equal(hits,0,JSON.stringify(hitPaths)); assert.ok(restricted.networkPolicy.blocked_requests >= 5);
      permitted=await createContext(browser,{},true);
      const allowed=await permitted.newPage(); await allowed.goto(external);
      assert.ok(hits>0); await permitted.close();
    } finally {
      if(browser) await browser.close();
      if(source) await new Promise(resolve=>source.close(resolve));
      await new Promise(resolve=>sink.close(resolve));
    }
  });
}

for (const host of ['127.0.0.1', '::1']) {
  test(`proxy preserves localhost access to ${host}-only servers and CONNECT tunnels`, async () => {
    const source=http.createServer((req,res)=>res.end('loopback control'));
    const port=await listen(source,host);
    const policy=await createNetworkPolicy();
    const proxyPort=Number(new URL(policy.proxy.server).port);
    try {
      const body=await new Promise((resolve,reject)=>{
        http.get({host:'127.0.0.1',port:proxyPort,path:`http://localhost:${port}/`},res=>{
          assert.equal(res.statusCode,200);let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve(body));
        }).on('error',reject);
      });
      assert.equal(body,'loopback control');
      const response=await new Promise((resolve,reject)=>{
        const socket=net.connect(proxyPort,'127.0.0.1');let body='',connected=false;
        socket.on('error',reject);
        socket.on('data',chunk=>{
          body+=chunk.toString();
          if(!connected && body.includes('\r\n\r\n')) {
            assert.match(body,/200 Connection Established/); connected=true;
            socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
          }
        });
        socket.on('end',()=>resolve(body));
        socket.write(`CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`);
      });
      assert.match(response,/loopback control/);
      assert.equal(policy.stats.blocked_requests,0);
    } finally { await policy.close(); await new Promise(resolve=>source.close(resolve)); }
  });
}
