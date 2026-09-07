#!/usr/bin/env python3
"""Alternate baseline/candidate checks; checkpoint successful pairs and failures."""
import http.server
import argparse
import importlib.util
import json
from pathlib import Path
import random
import statistics
import subprocess
import sys
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/benchmark-fixture-server.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def main():
    cases=['loop-5','spa','image-heavy','late-network','many-links']
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('iterations',type=int,nargs='?',default=8)
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--case',choices=cases)
    args=parser.parse_args()
    before=args.baseline.resolve()
    output=args.output
    iterations=args.iterations
    if args.case: cases=[args.case]
    if iterations < 1: raise ValueError('iterations must be positive')
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),fixture.FixtureHandler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    results={};failures=[]
    if args.resume and output.exists():
        saved=json.loads(output.read_text())
        if saved['iterations']!=iterations: raise ValueError('Resume iterations differ')
        results=saved['results'];failures=saved.get('rejected_trials',[])
    def save():
        complete=all(len(results.get(case,{}).get('samples',{}).get('before',[]))==iterations for case in cases)
        output.write_text(json.dumps({'schema_version':1,'iterations':iterations,'completed':complete,'unit':'seconds','method':'alternating order, paired median delta, fixed-seed bootstrap diagnostic only','results':results,'rejected_trials':failures},indent=2)+'\n')
    try:
        with tempfile.TemporaryDirectory(prefix='lens-paired-') as work:
            for case in cases:
                samples=results.get(case,{}).get('samples',{'before':[],'after':[]})
                rejected=0
                while len(samples['before'])<iterations:
                    i=len(samples['before']);pair={}
                    for name,root in ([('before',before),('after',ROOT)] if i%2==0 else [('after',ROOT),('before',before)]):
                        started=time.perf_counter()
                        for _ in range(5 if case=='loop-5' else 1):
                            route='trivial' if case=='loop-5' else case
                            with tempfile.TemporaryFile() as log:
                                try:
                                    p=subprocess.run([str(root/'lens'),'check',f'http://127.0.0.1:{server.server_port}/{route}','--quick','--out',str(Path(work)/name)],cwd=root,stdout=log,stderr=log,timeout=180)
                                except (OSError,subprocess.TimeoutExpired):
                                    failures.append({'case':case,'side':name,'failure_kind':'process-unavailable-or-timeout'})
                                    save()
                                    raise RuntimeError('Benchmark process unavailable or timed out; successful pairs were retained') from None
                                if p.returncode not in (0,1):
                                    log.seek(0);diagnostic=log.read().decode('utf8',errors='replace')
                                    # These are controlled local fixtures without auth/typed values.
                                    output.with_suffix('.failure.log').write_text(diagnostic)
                                    failures.append({'case':case,'side':name,'exit_code':p.returncode})
                                    print(f'Rejected {case} {name} trial, exit {p.returncode}',flush=True)
                                    break
                        if p.returncode not in (0,1): break
                        pair[name]=time.perf_counter()-started
                    if len(pair)!=2:
                        rejected+=1;save()
                        if rejected>=3: raise RuntimeError('Three pairs failed; inspect the retained fixture diagnostic')
                        continue
                    for name in samples: samples[name].append(pair[name])
                    deltas=[b-a for a,b in zip(samples['before'],samples['after'])]
                    rng=random.Random(0)
                    boot=sorted(statistics.median(rng.choices(deltas,k=len(deltas))) for _ in range(4000))
                    results[case]={'samples':samples,'before':statistics.median(samples['before']),'after':statistics.median(samples['after']),'paired_delta_median_s':statistics.median(deltas),'paired_delta_bootstrap_95_percent_interval_s':[boot[100],boot[3899]]}
                    save()
                print(case,json.dumps({k:v for k,v in results[case].items() if k!='samples'}),flush=True)
    finally: server.shutdown();server.server_close()
if __name__=='__main__':main()
