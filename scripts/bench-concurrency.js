#!/usr/bin/env node
'use strict';
// Run against scripts/benchmark-fixture-server.py. Three samples is suitable for
// a CI diagnostic; use eight for a release receipt. Results never affect verdicts.
const { capture, parseArgs } = require('../bridge/browser-bridge');
const { BrowserHost } = require('../bridge/runtime');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const median = v => {v=[...v].sort((a,b)=>a-b);return(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;};
(async()=>{
  const base=process.argv[2];const output=process.argv[3];const iterations=Number(process.argv[4]||3);
  const work=fs.mkdtempSync('/tmp/lens-concurrency-');const host=new BrowserHost();const samples={};const phases={};const lifecycle={};
  try {
    for(const fixture of ['trivial','spa','image-heavy']) for(const limit of [1,2,4,8]) {
      const key=fixture+'_concurrency_'+limit;samples[key]=[];lifecycle[key]={cleanup_failures:0};
      for(let i=0;i<iterations;i++) {
        const start=performance.now();
        const result=await capture({...parseArgs(),url:base+'/'+fixture,screenshotDir:work,viewports:['desktop','mobile','1024x768','800x600','1280x720','768x1024','600x800','1920x1080'],maxConcurrency:limit},host);
        if(result.provider_errors.length) throw new Error('Concurrency capture failed');
        samples[key].push((performance.now()-start)/1000);
        phases[key]=result.metadata.viewport_timings;
        lifecycle[key].browser_launches=host.launches;
        if(result.metadata.context_cleanup_failed) lifecycle[key].cleanup_failures++;
      }
      console.log(`${key}: ${median(samples[key]).toFixed(3)}s`);
    }
    fs.writeFileSync(output,JSON.stringify({schema_version:1,iterations,unit:'seconds',medians:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)])),samples,phases,lifecycle},null,2)+'\n');
  } finally {await host.close();fs.rmSync(work,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1});
