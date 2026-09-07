'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Timings, BrowserHost } = require('../runtime');
const { capture, captureViewport, parseArgs } = require('../browser-bridge');
const { observeReadiness } = require('../readiness');
const { executeStep, runFlow } = require('../flow-bridge');
const browserTests = { skip: process.env.LENS_SKIP_BROWSER_TESTS === '1' };

test('timings record failures using numeric fields without error content', async () => {
  const t = new Timings();
  await assert.rejects(t.measure('navigation_ms', () => Promise.reject(new Error('token=PRIVATE'))));
  const data = t.finish();
  assert.ok(data.navigation_ms >= 0);
  assert.ok(Object.values(data).every(Number.isFinite));
  assert.ok(!JSON.stringify(data).includes('PRIVATE'));
});

test('context is closed when page creation fails', async () => {
  let closed = 0;
  const browser = { newContext: async () => ({ newPage: async () => { throw new Error('page failed'); }, close: async () => closed++ }) };
  await assert.rejects(captureViewport(browser, 'http://localhost', 'desktop', 1000, '', {}));
  assert.equal(closed, 1);
});

test('structured launch failure is authoritative', async () => {
  const result = await capture({ ...parseArgs(), url: 'http://localhost' }, { acquire: async () => { throw new Error('fixture launch'); } });
  assert.equal(result.viewports.length, 0);
  assert.match(result.provider_errors[0], /launch failed/);
});

test('readiness cap and dispose remove event listeners', async () => {
  const page = new EventEmitter();
  page.addInitScript = async () => {};
  page.evaluate = async () => false;
  page.isClosed = () => false;
  const observer = await observeReadiness(page);
  const result = await observer.wait({ timeoutMs: 60 });
  assert.equal(result.reason, 'max-wait-reached');
  observer.dispose();
  assert.equal(page.listenerCount('request'), 0);
  assert.equal(page.listenerCount('requestfinished'), 0);
});

test('failed typing never echoes Playwright call logs', async () => {
  const page = { locator: () => ({ first: () => ({ fill: async () => { throw new Error('fill("PRIVATE")'); } }) }) };
  const result = await executeStep(page, { type: 'type', selector: '#field', value: 'PRIVATE' }, {}, 10);
  assert.equal(result.status, 'fail');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('real browser runtime evidence, flows, and isolation', browserTests, async t => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-runtime-test-'));
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/pending') return;
    if (req.url === '/xhr') return setTimeout(() => { res.end('ready'); }, 650);
    const scripts = {
      '/late-dom': "setTimeout(()=>document.querySelector('h1').textContent='Late ready',300)",
      '/late-console': "setTimeout(()=>console.error('Late fixture error'),650)",
      '/xhr-page': "fetch('/xhr').then(r=>r.text()).then(()=>document.querySelector('h1').textContent='XHR ready')",
      '/never-idle': "fetch('/pending')",
      '/polling': "setInterval(()=>fetch('/xhr'),100)",
      '/never-settles': "setInterval(()=>document.body.dataset.tick=String(Date.now()),50)",
      '/spa': "setTimeout(()=>document.querySelector('h1').textContent='SPA ready',150)",
    };
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>Fixture</title></head><body><main><h1>Ready</h1><button id="go" onclick="this.dataset.count=String(Number(this.dataset.count||0)+1)">Advance</button><a id="next" target="_blank" href="/next">Next</a><input id="secret" type="password"></main><script>${scripts[req.url] || ''}</script></body></html>`);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const host = new BrowserHost();
  try {
    for (const [route, text, reason] of [
      ['/', 'Ready', 'quiet-window'], ['/late-dom', 'Late ready', 'quiet-window'],
      ['/late-console', 'Ready', 'quiet-window'], ['/xhr-page', 'XHR ready', 'quiet-window'],
      ['/spa', 'SPA ready', 'quiet-window'], ['/never-idle', 'Ready', 'max-wait-reached'],
      ['/polling', 'Ready', 'max-wait-reached'], ['/never-settles', 'Ready', 'max-wait-reached'],
    ]) {
      await t.test(`readiness ${route}`, async () => {
        const result = await capture({ ...parseArgs(), url: url + route, viewports: ['desktop'], timeout: 4 }, host);
        assert.deepEqual(result.provider_errors, [], 'Readiness fixture capture must succeed');
        const vp = result.viewports[0];
        assert.equal(vp.readiness.reason, reason);
        assert.ok(vp.dom_summary.visible_text_sample.includes(text));
        if (route === '/late-console') assert.ok(vp.console_messages.some(x => x.text === 'Late fixture error'));
        assert.ok(vp.readiness.duration_ms < 2700);
        assert.equal(host.browser.contexts().length, 0);
      });
    }
    await t.test('explicit readiness selector', async () => {
      const result = await capture({ ...parseArgs(), url, viewports: ['desktop'], readySelector: 'h1' }, host);
      assert.equal(result.viewports[0].readiness.reason, 'explicit-selector');
    });
    await t.test('isolated context state and ordered viewports', async () => {
      const instance = await host.acquire();
      const context = await instance.newContext();
      await context.addCookies([{ name: 'private', value: 'PRIVATE', url }]);
      await context.close();
      const result = await capture({ ...parseArgs(), url, viewports: ['mobile', 'desktop', '800x600'], maxConcurrency: 2 }, host);
      assert.deepEqual(result.viewports.map(v => v.name), ['mobile', 'desktop', '800x600']);
      const clean = await instance.newContext();
      assert.deepEqual(await clean.cookies(), []);
      await clean.close();
      assert.equal(host.launches, 1);
    });
    await t.test('partial viewport failure preserves successful evidence', async () => {
      const instance = await host.acquire();
      const original = instance.newContext.bind(instance);
      let n = 0;
      instance.newContext = async options => { if (n++ === 0) throw new Error('fixture context failure'); return original(options); };
      try {
        const result = await capture({ ...parseArgs(), url }, host);
        assert.equal(result.viewports.length, 2);
        assert.equal(result.viewports[0].dom_summary, null);
        assert.ok(result.viewports[1].dom_summary);
        assert.equal(instance.contexts().length, 0);
      } finally { instance.newContext = original; }
    });
    await t.test('unrecorded clicks/type/scroll never call recording waits', async () => {
      const context = await (await host.acquire()).newContext();
      const page = await context.newPage();
      await page.goto(url);
      page.waitForTimeout = async () => { throw new Error('unexpected recording delay'); };
      for (const step of [ {type:'click',selector:'#go'}, {type:'type',selector:'#secret',value:'PRIVATE',secret:true}, {type:'scroll',y:50}, {type:'wait_for_selector',selector:'#go'}, {type:'wait_for_text',text:'Advance'}, {type:'screenshot',name:'test'} ]) {
        assert.equal((await executeStep(page, step, { screenshotDir: work }, 1000)).status, 'pass', step.type);
      }
      assert.equal(await page.locator('#go').getAttribute('data-count'), '1');
      assert.equal(await page.locator('#__lens_cursor').count(), 0);
      let wait = 0;
      page.waitForTimeout = async ms => { wait = ms; };
      assert.equal((await executeStep(page, {type:'wait',ms:75}, {},1000)).status,'pass');
      assert.equal(wait,75);
      assert.equal((await executeStep(page,{type:'click',selector:'#missing'},{},50)).status,'fail');
      assert.equal((await executeStep(page,{type:'click',selector:'#next'},{},1000)).status,'pass');
      assert.equal(page.url(),url+'/next');
      assert.equal(context.pages().length,1);
      await context.close();
    });
    await t.test('assertions wait for expected asynchronous click state', async () => {
      const context = await (await host.acquire()).newContext();
      try {
        const page = await context.newPage();
        await page.setContent(`<button id="go" onclick="setTimeout(()=>{document.body.innerHTML='<p id=ready>Saved asynchronously</p>'},150)">Save</button>`);
        assert.equal((await executeStep(page,{type:'click',selector:'#go'},{},1000)).status,'pass');
        assert.equal((await executeStep(page,{type:'assert_text',text:'Saved asynchronously'},{},1000)).status,'pass');
        assert.equal((await executeStep(page,{type:'assert_selector',selector:'#ready'},{},1000)).status,'pass');
        assert.equal((await executeStep(page,{type:'assert_not_selector',selector:'#go'},{},1000)).status,'pass');
      } finally { await context.close(); }
    });
    await t.test('native recording, stable path, typed secrets, step ordering', async () => {
      const result = await runFlow({ url, viewport:'desktop', record:true, timeout:2000, steps:[
        {index:1,type:'visit',url}, {index:2,type:'click',selector:'#go'},
        {index:3,type:'type',selector:'#secret',value:'PRIVATE',secret:true},
        {index:4,type:'screenshot',name:'recorded'},
      ] }, {videoDir:work,screenshotDir:work});
      assert.equal(result.video,'video/walkthrough.webm');
      assert.ok(fs.statSync(path.join(work,'walkthrough.webm')).size>1000);
      assert.ok(result.steps.every(s=>s.status==='pass'));
      assert.ok(!JSON.stringify(result).includes('PRIVATE'));
      assert.ok(result.steps[1].start_offset_ms >= result.steps[0].end_offset_ms);
    });
    await t.test('inspect excludes prefilled form values from text and selectors', async () => {
      const context = await (await host.acquire()).newContext();
      try {
        const page = await context.newPage();
        await page.setContent('<input type="password" value="PRIVATE_PASSWORD"><input value="PRIVATE_TOKEN"><textarea>PRIVATE_TEXT</textarea><input type="submit" value="Continue">');
        const elements = await page.evaluate(require('../inspect-bridge').COLLECT, 250);
        assert.ok(!JSON.stringify(elements).includes('PRIVATE_'));
        assert.ok(elements.some(element => element.text === 'Continue'));
      } finally { await context.close(); }
    });
    await t.test('crashed browser replaced for next job without replay', async () => {
      const previousLaunches = host.launches;
      const cdp = await host.browser.newBrowserCDPSession();
      const disconnected = new Promise(resolve => host.browser.once('disconnected', resolve));
      void cdp.send('Browser.crash').catch(() => {});
      await require('../runtime').withDeadline(() => disconnected, 10000);
      assert.equal(host.browser.isConnected(), false);
      const result = await capture({...parseArgs(),url,viewports:['desktop']},host);
      assert.ok(result.viewports[0].dom_summary);
      assert.equal(host.launches,previousLaunches+1);
    });
  } finally {
    await host.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(work,{recursive:true,force:true});
  }
});

test('typed secret is scrubbed from nested runtime evidence', () => {
  const { redactTypedValues } = require('../flow-bridge');
  const result = redactTypedValues({ console_messages:[{text:'hello PRIVATE'}],final_url:'http://localhost/?x=PRIVATE',timings:{total_bridge_ms:42} }, {steps:[{type:'type',secret:true,value:'PRIVATE'}]});
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.timings.total_bridge_ms,42);
});

test('private session IPC, busy rejection, idle shutdown, stale path recovery', browserTests, async () => {
  const { serve } = require('../session');
  const net = require('node:net');
  const dir = fs.mkdtempSync('/tmp/lens-ipc-test-');
  fs.chmodSync(dir,0o700);
  const socketPath = path.join(dir,'runtime.sock');
  const service = await serve(socketPath,{idleMs:80});
  const request = opts => new Promise((resolve,reject) => {
    let data='';
    const socket=net.createConnection(socketPath);
    socket.setEncoding('utf8');
    socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify(opts)+'\n'));
    socket.on('data',chunk=>{data+=chunk;});
    socket.on('end',()=>{try{resolve(JSON.parse(data));}catch(err){reject(err);}});
  });
  try {
    assert.equal(fs.statSync(socketPath).mode & 0o777,0o600);
    const opts={...parseArgs(),url:'data:text/html,<h1>Fixture</h1>',viewports:['desktop']};
    const results=await Promise.all([request(opts),request(opts)]);
    assert.equal(results.filter(x=>x.provider_errors.includes('Browser session busy')).length,1);
    const complete=results.find(x=>x.viewports.length);
    assert.equal(complete.metadata.session.browser_launches,1);
    assert.equal(complete.metadata.session.contexts_created,1);
    const deadline=Date.now()+4000;
    while(service.host.browser && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(service.host.browser,null);
    const next=await request(opts);
    assert.equal(next.metadata.session.browser_launches,2);
  } finally {await service.close();}
  assert.equal(fs.existsSync(socketPath),false);
  const nextService=await serve(socketPath);
  await nextService.close();
  fs.rmSync(dir,{recursive:true,force:true});
});

test('readiness deadline survives an unresponsive page evaluation', async () => {
  const page = new EventEmitter();
  page.addInitScript=async()=>{};
  page.evaluate=()=>new Promise(()=>{});
  page.isClosed=()=>false;
  const observer=await observeReadiness(page);
  const start=Date.now();
  assert.equal((await observer.wait({timeoutMs:50})).reason,'max-wait-reached');
  assert.ok(Date.now()-start<1000);
  observer.dispose();
});


test('malformed private flow input never appears in fatal diagnostics', () => {
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '../flow-bridge.js'), '--program', '-'], {input:'PRIVATE_MALFORMED_SECRET',encoding:'utf8'});
  assert.equal(result.status, 1);
  assert.ok(!String(result.stdout + result.stderr).includes('PRIVATE_MALFORMED_SECRET'));
  assert.match(result.stderr, /before structured completion/);
});


test('unavailable owned session returns authoritative structured failure', () => {
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '../browser-bridge.js'), '--url', 'http://localhost/'], {
    env: {...process.env, LENS_SESSION_SOCKET:'/tmp/lens-nonexistent-test-socket/runtime.sock'}, encoding:'utf8',
  });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.metadata.failure_kind, 'browser-session');
  assert.deepEqual(parsed.viewports, []);
  assert.deepEqual(parsed.provider_errors, ['Browser session unavailable']);
});


test('disconnected client retires its active browser job', browserTests, async () => {
  const {serve} = require('../session');
  const net = require('node:net');
  const dir=fs.mkdtempSync('/tmp/lens-abandon-test-');
  const service=await serve(path.join(dir,'runtime.sock'));
  const socket=net.createConnection(path.join(dir,'runtime.sock'));
  socket.on('error',()=>{});
  try {
    await new Promise(resolve=>socket.once('connect',resolve));
    socket.write(JSON.stringify({...parseArgs(),url:'data:text/html,<h1>Fixture</h1>',viewports:['desktop']})+'\n');
    const deadline=Date.now()+5000;
    while(!service.host.browser && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(service.host.browser);
    socket.destroy();
    while(service.host.browser && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(service.host.browser,null);
    await service.host.closing;
  } finally {socket.destroy();await service.close();fs.rmSync(dir,{recursive:true,force:true});}
});


test('closing a host during launch closes the late browser', async () => {
  const {BrowserHost} = require('../runtime');
  const engine=require('playwright-core').chromium;
  const original=engine.launch;
  let begin, finish, closed=false;
  const started=new Promise(resolve=>{begin=resolve;});
  const pending=new Promise(resolve=>{finish=resolve;});
  engine.launch=async()=>{begin();await pending;return {close:async()=>{closed=true;}};};
  const host=new BrowserHost();
  try {
    const launch=host.acquire();
    await started;
    await host.close();
    finish();
    await assert.rejects(launch,/cancelled during launch/);
    assert.equal(closed,true);
    assert.equal(host.browser,null);
  } finally {engine.launch=original;await host.close();}
});


test('context creation and close operations have deadlines', async () => {
  const {closeContext} = require('../runtime');
  assert.equal(await closeContext({close:()=>new Promise(()=>{})},30),false);
  await assert.rejects(captureViewport({newContext:()=>new Promise(()=>{})},'http://localhost/','desktop',30,'',{}),/deadline/);
});

test('cleanup deadline preserves evidence and retires the browser', browserTests, async () => {
  const host=new BrowserHost();
  try {
    const browser=await host.acquire();
    const original=browser.newContext.bind(browser);
    browser.newContext=async options=>{
      const context=await original(options);
      context.close=()=>new Promise(()=>{});
      return context;
    };
    const result=await capture({...parseArgs(),timeout:1,url:'data:text/html,<h1>Useful evidence</h1>',viewports:['desktop']},host);
    assert.ok(result.viewports[0].dom_summary.body_text_length>0);
    assert.equal(result.metadata.context_cleanup_failed,true);
    assert.equal(host.browser,null);
  } finally {await host.close();}
});

test('recording teardown failure preserves steps and removes incomplete video', async () => {
  const engine = require('playwright-core').chromium;
  const original = engine.launch;
  const work = fs.mkdtempSync('/tmp/lens-recording-failure-');
  const video = path.join(work, 'walkthrough.webm');
  const page = new EventEmitter();
  page.addInitScript = async () => {};
  page.screenshot = async () => {};
  page.evaluate = async () => ({title:'Fixture'});
  page.url = () => 'http://localhost/';
  page.waitForTimeout = async () => { throw new Error('page closed PRIVATE'); };
  page.screencast = {
    start: async () => fs.writeFileSync(video, 'incomplete'),
    stop: async () => { throw new Error('recording closed PRIVATE'); },
  };
  let closed = false;
  engine.launch = async () => ({
    newContext: async () => ({newPage: async () => page, close: async () => {}}),
    close: async () => {closed = true;},
  });
  try {
    const result = await runFlow({url:'http://localhost/',record:true,steps:[{index:0,type:'screenshot',name:'completed'}]}, {videoDir:work,screenshotDir:work});
    assert.equal(result.steps[0].status,'pass');
    assert.equal(result.video,'');
    assert.equal(fs.existsSync(video),false);
    assert.match(result.artifact_warnings[0],/finalization did not complete/);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.equal(closed,true);
  } finally {engine.launch=original;fs.rmSync(work,{recursive:true,force:true});}
});

test('readiness observes its minimum horizon without premature browser round trips', async () => {
  const page = new EventEmitter();
  let evaluations = 0;
  page.addInitScript = async () => {};
  page.evaluate = async () => { evaluations++; return true; };
  page.isClosed = () => false;
  const observer = await observeReadiness(page);
  try {
    const result = await observer.wait({timeoutMs:1500});
    assert.equal(result.reason,'quiet-window');
    assert.ok(result.duration_ms>=500);
    assert.equal(evaluations,1);
  } finally {observer.dispose();}
});
