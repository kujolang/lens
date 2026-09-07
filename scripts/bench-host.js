#!/usr/bin/env node
'use strict';
// Prototype comparison only: no cross-command daemon is installed or enabled.
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const exec = promisify(execFile);
const { serve } = require('../bridge/session');
const root = path.resolve(__dirname, '..');
const median = values => { const v = [...values].sort((a,b)=>a-b); return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2; };

async function main() {
  const iterations = Number(process.argv[2] || 8);
  const childTrial = process.argv.includes('--trial');
  const startupMs = process.uptime() * 1000;
  const work = fs.mkdtempSync('/tmp/lens-host-bench-');
  const server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Ready</h1><p>Local deterministic fixture content for repeated captures.</p></main></body></html>'); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const samples = { one_shot_loop_5: [], session_loop_5: [], session_first: [], session_warm: [] };
  const resources = [];
  const idleTrials = [];
  async function job(env) {
    const start = performance.now();
    await exec(path.join(root,'lens'),['check',url,'--quick','--out',path.join(work,'run')],{cwd:root,env:{...process.env,...env},maxBuffer:2*1024*1024});
    return (performance.now()-start)/1000;
  }
  try {
    for(let i=0;i<iterations;i++) {
      if (!childTrial) {
        // Reset the Node module cache as well as Chromium for each cold trial.
        const receipt=path.join(work,`trial-${i}.json`);
        await exec(process.execPath,[__filename,'1',receipt,'--trial'],{cwd:root,env:process.env,maxBuffer:1024*1024});
        const trial=JSON.parse(fs.readFileSync(receipt,'utf8'));
        for (const key of Object.keys(samples)) samples[key].push(...trial.samples[key]);
        resources.push(...trial.resources);
        console.log(`iteration ${i+1}/${iterations}`);
        continue;
      }
      let total=0;
      for(let j=0;j<5;j++) total+=await job({LENS_ONESHOT:'1',LENS_SESSION_SOCKET:''});
      samples.one_shot_loop_5.push(total);
      const start=performance.now();
      const socketPath=path.join(work,'host.sock');
      const service=await serve(socketPath);
      try {
        const first=await job({LENS_SESSION_SOCKET:socketPath});
        const cold=(performance.now()-start+startupMs)/1000;
        samples.session_first.push(cold);
        total=cold;
        for(let j=0;j<4;j++) { const duration=await job({LENS_SESSION_SOCKET:socketPath});total+=duration;samples.session_warm.push(duration); }
        samples.session_loop_5.push(total);
        const measurement=exec('ps',['-axo','pid=,ppid=,rss=']);
        const {stdout}=await measurement;
        const rows=stdout.trim().split('\n').map(x=>x.trim().split(/\s+/).map(Number));
        const ids=new Set([process.pid]);
        let changed=true;
          while(changed) {
            changed=false;
            for(const [pid,ppid] of rows) if(ids.has(ppid)&&!ids.has(pid)) {ids.add(pid);changed=true;}
          }
        const own=rows.filter(([pid])=>ids.has(pid) && pid !== measurement.child.pid);
        resources.push({rss_kib:own.reduce((sum,row)=>sum+row[2],0),process_count:own.length,browser_launches:service.host.launches,remaining_contexts:service.host.browser.contexts().length});
      } finally {await service.close();}
      console.log(`iteration ${i+1}/${iterations}`);
    }
    for (const idleMs of (childTrial ? [] : [30000, 60000])) {
      const socketPath=path.join(work,'idle.sock');
      const service=await serve(socketPath,{idleMs});
      try {
        const previousSocket=process.env.LENS_SESSION_SOCKET;
        process.env.LENS_SESSION_SOCKET=socketPath;
        try {
          await require('../bridge/session-client').captureInSession({...require('../bridge/browser-bridge').parseArgs(),url,viewports:['desktop']});
        } finally {
          if (previousSocket === undefined) delete process.env.LENS_SESSION_SOCKET;
          else process.env.LENS_SESSION_SOCKET=previousSocket;
        }
        const started=performance.now();
        while(service.host.browser && performance.now()-started<idleMs+5000) await new Promise(resolve=>setTimeout(resolve,100));
        await service.host.closing;
        idleTrials.push({configured_ms:idleMs,closed_after_ms:Math.round(performance.now()-started),browser_closed:service.host.browser===null});
      } finally {await service.close();}
    }
    fs.writeFileSync(process.argv[3]||'/tmp/lens-host.json',JSON.stringify({schema_version:1,iterations,unit:'seconds',cold_definition:'fresh Node process and Chromium per trial; session_first includes host process boot',medians:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)])),samples,resources,idle_trials:idleTrials},null,2)+'\n');
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(work,{recursive:true,force:true});}
}
main().catch(err=>{console.error(err.message);process.exitCode=1;});
