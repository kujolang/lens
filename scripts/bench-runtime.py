#!/usr/bin/env python3
"""Identical fixture-backed flow/crawl/inspect/repeated-loop medians, raw samples.
Usage: python3 scripts/bench-runtime.py 8 /tmp/runtime.json [target root]
"""
import http.server
import importlib.util
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/benchmark-fixture-server.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

class Handler(fixture.FixtureHandler):
    def do_GET(self):
        if self.path.startswith('/flow'):
            self.send(200, 'text/html', fixture.html('<h1>Flow fixture</h1><button id="go" onclick="this.dataset.count=Number(this.dataset.count||0)+1">Advance</button><a id="next" href="/flow?next=1">Next</a><input id="value" type="password">'))
        else:
            super().do_GET()

def main():
    iterations = int(sys.argv[1])
    if iterations < 1: raise ValueError('iterations must be positive')
    target = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 and sys.argv[3] != '--resume' else ROOT
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    samples = {}
    phases = {}
    current_case = ""
    if '--resume' in sys.argv and Path(sys.argv[2]).exists():
        previous=json.loads(Path(sys.argv[2]).read_text())
        if previous['iterations'] != iterations: raise ValueError('resume iterations differ')
        samples=previous['samples']
        phases=previous.get('phase_samples_ms', {})
    try:
        with tempfile.TemporaryDirectory(prefix='lens-runtime-bench-') as tmp:
            work = Path(tmp)
            def run(args):
                start = time.perf_counter()
                with tempfile.TemporaryFile() as output:
                    p = subprocess.run(args, cwd=target, stdout=output, stderr=subprocess.PIPE, timeout=300)
                    output.seek(0)
                    stdout = output.read()
                if p.returncode not in ((0, 1) if Path(args[0]).name == 'lens' else (0,)):
                    raise RuntimeError(f'benchmark failed: {args[0]} exit {p.returncode}')
                elapsed = time.perf_counter() - start
                if any(name in args[1:] for name in ('bridge/flow-bridge.js', 'bridge/inspect-bridge.js')):
                    timing = json.loads(stdout).get('timings', {})
                    phases.setdefault(current_case, []).append({key:value for key,value in timing.items() if key.endswith('_ms') and isinstance(value,(int,float))})
                if 'bridge/flow-bridge.js' in args[1:]:
                    result = json.loads(stdout)
                    if not all(s['status'] == 'pass' for s in result['steps']):
                        raise RuntimeError('flow benchmark step failed')
                return elapsed
            def flow(clicks, record=False, navigation=False):
                steps = [{'type':'visit','url':url+'/flow','index':0}]
                steps += [{'type':'click','selector':'#next' if navigation else '#go','index':i+1} for i in range(clicks)]
                program = work/'program.json'
                program.write_text(json.dumps({'url':url+'/flow','viewport':'desktop','timeout':10000,'record':record,'steps':steps}))
                (work/'video').mkdir(exist_ok=True)
                return run(['node','bridge/flow-bridge.js','--program',str(program),'--video-dir',str(work/'video'),'--screenshot-dir',str(work/'shots')])
            def check(path='/trivial', extra=()):
                elapsed = run([str(target/'lens'),'check',url+path,'--quick','--out',str(work/'run'),*extra])
                if '--crawl' in extra:
                    receipt = json.loads((work/'run/crawl.json').read_text())
                    expected = int(extra[extra.index('--max-pages') + 1])
                    if receipt['visited_count'] != expected:
                        raise RuntimeError('crawl benchmark did not capture the requested pages')
                return elapsed
            cases = {
                'flow_1_click': lambda:flow(1), 'flow_5_click': lambda:flow(5),
                'flow_5_recorded': lambda:flow(5,True), 'flow_navigation': lambda:flow(5,navigation=True),
                'inspect': lambda:run(['node','bridge/inspect-bridge.js','--url',url+'/flow']),
                'crawl_5':lambda:check('/many-links',('--crawl','--max-pages','5')),
                'crawl_10':lambda:check('/many-links',('--crawl','--max-pages','10')),
                'loop_5':lambda:sum(check() for _ in range(5)),
            }
            for name, fn in cases.items():
                current_case = name
                samples.setdefault(name, [])
                while len(samples[name]) < iterations:
                    samples[name].append(fn())
                    Path(sys.argv[2]).write_text(json.dumps({'schema_version':1,'iterations':iterations,'completed':False,'unit':'seconds','medians':{k:statistics.median(v) for k,v in samples.items()},'samples':samples,'phase_samples_ms':phases},indent=2)+'\n')
                print(name, statistics.median(samples[name]), flush=True)
            payload = {'schema_version':1,'iterations':iterations,'completed':True,'unit':'seconds','lower_is_better':True,
                       'environment':{'system':platform.system(),'machine':platform.machine()},
                       'medians':{k:statistics.median(v) for k,v in samples.items()},'samples':samples,'phase_samples_ms':phases}
            Path(sys.argv[2]).write_text(json.dumps(payload,indent=2)+'\n')
    finally:
        server.shutdown()
        server.server_close()
if __name__ == '__main__':
    main()
