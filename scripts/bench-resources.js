#!/usr/bin/env node
'use strict';
// Separate RSS diagnostic so process sampling does not distort latency medians.
const {promisify}=require('node:util');
const exec=promisify(require('node:child_process').execFile);
const fs=require('node:fs');
const {capture,parseArgs}=require('../bridge/browser-bridge');
const {BrowserHost}=require('../bridge/runtime');
(async()=>{
  const samples={};
  for(const limit of [4,8]) {
    samples[limit]=[];
    for(let trial=0;trial<3;trial++) {
      const host=new BrowserHost();
      let done=false, peak=0, processes=0;
      const work=fs.mkdtempSync('/tmp/lens-resource-');
      const job=capture({...parseArgs(),url:process.argv[2]+'/image-heavy',maxConcurrency:limit,screenshotDir:work,viewports:['desktop','mobile','1024x768','800x600','1280x720','768x1024','600x800','1920x1080']},host).finally(()=>{done=true;});
      job.catch(()=>{});
      try {
        while(!done) {
          const measurement=exec('ps',['-axo','pid=,ppid=,rss=']);
          const {stdout}=await measurement;
          const rows=stdout.trim().split('\n').map(row=>row.trim().split(/\s+/).map(Number));
          const ids=new Set([process.pid]);
          let changed=true;
          while(changed) {
            changed=false;
            for(const [pid,ppid] of rows) if(ids.has(ppid)&&!ids.has(pid)) {ids.add(pid);changed=true;}
          }
          const own=rows.filter(([pid])=>ids.has(pid)&&pid!==measurement.child.pid);
          peak=Math.max(peak,own.reduce((sum,row)=>sum+row[2],0));
          processes=Math.max(processes,own.length);
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        const result=await job;
        if(result.provider_errors.length) throw new Error('Resource capture failed');
        samples[limit].push({peak_rss_kib:peak,peak_process_count:processes});
      } finally {await host.close();fs.rmSync(work,{recursive:true,force:true});}
    }
  }
  fs.writeFileSync(process.argv[3],JSON.stringify({schema_version:1,iterations:3,fixture:'image-heavy',viewports:8,sampling_interval_ms:100,samples},null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
