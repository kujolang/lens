# Run from the Lens root with KUJO_BIN set. Controlled fixture-only experiment.
import http.server,importlib.util,json,os,statistics,subprocess,tempfile,threading,time
from pathlib import Path
root=Path.cwd();spec=importlib.util.spec_from_file_location('fixture',root/'scripts/benchmark-fixture-server.py');fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),fixture.FixtureHandler);threading.Thread(target=server.serve_forever,daemon=True).start()
samples={'current':[],'metadata_only':[]}
try:
 with tempfile.TemporaryDirectory() as tmp:
  p=Path(tmp);preload=p/'strip.cjs';preload.write_text("""const write=process.stdout.write.bind(process.stdout);process.stdout.write=function(chunk,...args){try{const d=JSON.parse(String(chunk));if(d.viewports&&d.metadata){if(process.env.LENS_DIAGNOSTIC_PRUNE==='1')for(const v of d.viewports){delete v.timings;delete v.readiness;}chunk=JSON.stringify(d);}}catch(_){}return write(chunk,...args);};""")
  for trial in range(8):
   order=list(samples)
   if trial%2:order.reverse()
   for mode in order:
    start=time.perf_counter()
    with tempfile.TemporaryFile() as log:
     subprocess.run([str(root/'lens'),'check',f'http://127.0.0.1:{server.server_port}/image-heavy','--quick','--out',str(p/'out')],env={**os.environ,'NODE_OPTIONS':'--require '+str(preload),'LENS_DIAGNOSTIC_PRUNE':'1' if mode=='metadata_only' else '0'},stdout=log,stderr=log,timeout=90,check=True)
    samples[mode].append(time.perf_counter()-start)
  data={'iterations':8,'method':'alternating candidate quick image-heavy CLI; identical stdout instrumentation, with/without duplicate per-viewport timings/readiness','unit':'seconds','samples':samples,'medians':{k:statistics.median(v) for k,v in samples.items()}}
  data['median_paired_delta']=statistics.median(b-a for a,b in zip(samples['current'],samples['metadata_only']))
  Path('/tmp/lens-diagnostic-overhead.json').write_text(json.dumps(data,indent=2)+'\n');print(json.dumps(data['medians']))
finally:server.shutdown();server.server_close()
