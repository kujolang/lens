#!/usr/bin/env python3
"""Real CLI contracts: crawl lifecycle, artifacts/redaction, flow safety and watch cleanup."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bench',ROOT/'scripts/bench-runtime.py')
bench=importlib.util.module_from_spec(spec);spec.loader.exec_module(bench)

class Handler(bench.Handler):
    cookies=[]
    policy_hits=0
    def do_GET(self):
        if self.path == '/policy-sink':
            Handler.policy_hits += 1
            return self.send(200, 'text/html', bench.fixture.html('<h1>Sink</h1>'))
        if self.path == '/policy-redirect':
            self.send_response(302)
            self.send_header('Location', f'http://localhost.:{self.server.server_port}/policy-sink')
            self.end_headers()
            return
        if self.path == '/oversized':
            return self.send(200, 'text/html', bench.fixture.html('<h1>Bounded evidence</h1><button>Button</button>',
                "<script>document.title='🔑'.repeat(5000);console.error('🔑'.repeat(5000));</script>"))
        if self.path.startswith('/privacy'):
            self.send_response(500, 'token=PRIVATE_SECRET_123')
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<h1>Privacy</h1><div id="token=PRIVATE_SECRET_123" style="width:4000px">Evidence</div>')
            return
        if self.path == '/a11y-failure':
            return self.send(200, 'text/html', bench.fixture.html('<main><h1>Fixture</h1><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></main>'))
        tree={
            '/tree': '<a href="/tree/a/">A</a><a href="/broken">Broken</a><a href="/tree/b">B</a><a href="https://example.com">External</a><a href="/delete-user">Delete</a>',
            '/tree/a/':'<a href="child">Child</a>', '/tree/b':'B',
            '/tree/a/child':'<a href="/tree/grandchild">Grandchild</a>',
            '/tree/grandchild':'Grandchild', '/broken':'Broken',
        }
        if self.path in tree:
            return self.send(503 if self.path=='/broken' else 200,'text/html',bench.fixture.html('<h1>Tree</h1>'+tree[self.path]))
        if self.path=='/state':
            self.cookies.append(self.headers.get('Cookie'))
            return self.send(200,'text/html',bench.fixture.html('<h1>Isolated state</h1>',"<script>if(document.cookie||localStorage.getItem('fixture'))console.error('state leaked');document.cookie='fixture=present';localStorage.setItem('fixture','present')</script>"))
        super().do_GET()

def main():
    dependencies=subprocess.run(['python3','-c','import PIL, numpy'],capture_output=True)
    if dependencies.returncode:
        raise SystemExit('Full visual E2E requires Pillow and numpy; install .github/visual-test-requirements.txt in a Python environment.')
    server=bench.fixture.FixtureServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}'
    passed=0
    try:
        with tempfile.TemporaryDirectory(prefix='lens-cli-e2e-') as tmp:
            work=Path(tmp)
            def run(*args,allowed=(0,)):
                p=subprocess.run([str(ROOT/'lens'),*args],cwd=ROOT,capture_output=True,text=True,timeout=120)
                assert p.returncode in allowed, (args[0],p.returncode,p.stdout,p.stderr)
                assert 'PRIVATE_SECRET_123' not in p.stdout+p.stderr
                return p
            for command in ['check', 'inspect']:
                run(command, url+'/policy-redirect', '--out', str(work/('policy-'+command)), allowed=(1,3))
                assert Handler.policy_hits == 0
            policy_flow=work/'policy-flow.json'
            policy_flow.write_text(json.dumps({'name':'Policy', 'url':url+'/policy-redirect', 'steps':[{'visit':url+'/policy-redirect'}]}))
            run('flow', str(policy_flow), '--execute', '--out', str(work/'policy-flow'), allowed=(3,))
            assert Handler.policy_hits == 0
            run('check', url+'/policy-redirect', '--allow-external', '--quick', '--out', str(work/'policy-opt-in'))
            assert Handler.policy_hits > 0
            passed+=1
            run('check', url+'/oversized', '--quick', '--fail-on', 'warning', '--out', str(work/'oversized'), allowed=(1,))
            bounded=json.loads((work/'oversized/lens-report.json').read_text())
            assert any('byte' in f['description'].lower() for f in bounded['findings'])
            assert (work/'oversized/console.json').stat().st_size < 2000
            run('inspect', url+'/oversized', '--out', str(work/'oversized-inspect'), allowed=(1,))
            assert json.loads((work/'oversized-inspect/elements.json').read_text())['evidence_limits']['byte_limit_reached']
            passed+=1
            run('check',url+'/trivial?token=PRIVATE_SECRET_123','--html','--accessibility','--perf','--baseline','--baseline-dir',str(work/'baselines'),'--out',str(work/'check'))
            for name in ['lens-report.json','lens-report.html','metadata.json','accessibility.json','metrics.json','screenshots/desktop.png','screenshots/mobile.png']:
                assert (work/'check'/name).stat().st_size>0,name
            assert 'session' not in json.loads((work/'check/metadata.json').read_text())['provider']
            passed+=1
            run('check',url+'/trivial?token=PRIVATE_SECRET_123','--baseline','--update-baseline','--baseline-dir',str(work/'baselines'),'--out',str(work/'check'))
            passed+=1
            run('check',url+'/trivial?token=PRIVATE_SECRET_123','--compare-baseline','--baseline-dir',str(work/'baselines'),'--out',str(work/'compare'))
            passed+=1
            run('check',url+'/many-links','--quick','--crawl','--max-pages','10','--out',str(work/'crawl'))
            crawl=json.loads((work/'crawl/crawl.json').read_text())
            assert crawl['visited_count']==10
            assert [p['url'].split('/')[-1] for p in crawl['pages']]==['many-links',*map(str,range(9))]
            assert crawl['runtime']['session']['browser_launches']==1,crawl['runtime']
            assert crawl['runtime']['session']['contexts_created']==10
            passed+=1
            config=work/'crawl.toml'
            config.write_text('crawl = true\nmax_pages = 3\nmax_depth = 1\n')
            run('check',url+'/many-links','--quick','--config',str(config),'--out',str(work/'configured-crawl'))
            configured=json.loads((work/'configured-crawl/crawl.json').read_text())
            assert configured['visited_count']==3
            assert configured['runtime']['session']['browser_launches']==1
            passed+=1
            run('check',url+'/tree','--quick','--crawl','--max-depth','2','--max-pages','10','--out',str(work/'tree'),allowed=(1,))
            tree=json.loads((work/'tree/crawl.json').read_text())
            assert [p['url'].removeprefix(url) for p in tree['pages']]==['/tree','/tree/a/','/broken','/tree/b','/tree/a/child']
            assert tree['pages'][2]['error']>0
            assert tree['runtime']['session']['browser_launches']==1
            assert json.loads((work/'tree/lens-report.json').read_text())['status']=='FAIL'
            passed+=1
            run('check',url+'/a11y-failure','--accessibility','--html','--eval-out',str(work/'a11y-eval.json'),'--out',str(work/'a11y-failure'),allowed=(1,))
            for artifact in ['lens-report.json','metadata.json']:
                assert json.loads((work/'a11y-failure'/artifact).read_text())['status']=='FAIL',artifact
            assert json.loads((work/'a11y-eval.json').read_text())['status']=='FAIL'
            assert 'Status: FAIL' in (work/'a11y-failure/lens-report.md').read_text()
            assert '<div class="verdict">FAIL</div>' in (work/'a11y-failure/lens-report.html').read_text()
            passed+=1
            run('check',url+'/privacy?%74oken=PRIVATE_SECRET_123#access_token=PRIVATE_SECRET_123','--quick','--html','--out',str(work/'privacy'),allowed=(1,))
            for artifact in (work/'privacy').glob('*'):
                if artifact.is_file():
                    assert 'PRIVATE_SECRET_123' not in artifact.read_text(),artifact.name
                    if artifact.suffix=='.json': json.loads(artifact.read_text())
            passed+=1
            specfile=work/'spec.json'
            specfile.write_text(json.dumps({'title':{'contains':'Not present'}}))
            run('check',url+'/trivial','--quick','--spec',str(specfile),'--eval-out',str(work/'spec-eval.json'),'--out',str(work/'spec'),allowed=(1,))
            report=json.loads((work/'spec/lens-report.json').read_text())
            evaluated=json.loads((work/'spec-eval.json').read_text())
            assert len(evaluated['results'])==len(report['findings'])
            passed+=1
            run('inspect',url+'/flow','--json','--out',str(work/'inspect'))
            assert (work/'inspect/elements.json').stat().st_size>0
            passed+=1
            flow={'name':'Fixture journey','description':'password="PRIVATE_SECRET_123"','url':url+'/flow','viewports':['desktop'],'steps':[
                {'visit':url+'/flow'},{'click':{'selector':'#go','safe':True}},
                {'type':{'selector':'#value','value':'PRIVATE_SECRET_123','secret':True}},
                {'wait':{'ms':50}},{'wait_for_selector':'#go'}, {'screenshot':{'name':'proof'}},
                {'click':{'selector':'#next','safe':True}},{'assert_text':'Flow fixture'},
                {'assert_no_console_errors':True},
            ]}
            program=work/'flow.json';program.write_text(json.dumps(flow))
            run('flow',str(program),'--execute','--record','--walkthrough','--out',str(work/'flow'))
            assert (work/'flow/video/walkthrough.webm').stat().st_size>0
            if shutil.which('ffmpeg'):
                assert (work/'flow/video/walkthrough.mp4').stat().st_size>0
            assert (work/'flow/walkthrough.html').stat().st_size>0
            assert not (work/'flow/flow-program.json').exists()
            passed+=1
            flow['steps'][1]={'click':{'selector':'#go'}}
            program.write_text(json.dumps(flow))
            run('flow',str(program),'--validate','--out',str(work/'blocked'),allowed=(1,2))
            run('flow',str(program),'--execute','--walkthrough','--fail-on','warning','--out',str(work/'blocked-executed'),allowed=(1,))
            assert '<div class="verdict">FAIL</div>' in (work/'blocked-executed/walkthrough.html').read_text()
            assert json.loads((work/'blocked-executed/lens-report.json').read_text())['status']=='FAIL'
            run('check','https://example.com','--out',str(work/'external'),allowed=(2,))
            for command in ['check','inspect']:
                run(command,'http://localhost:password@example.invalid/','--out',str(work/'authority'),allowed=(2,))
            passed+=1
            for directory in ['check','compare','crawl','inspect','flow']:
                for file in (work/directory).rglob('*'):
                    if file.is_file() and file.suffix in ('.json','.md','.html'):
                        assert 'PRIVATE_SECRET_123' not in file.read_text(),file.name
            passed+=1
            with (work/'watch.log').open('w') as log:
                watch=subprocess.Popen([str(ROOT/'lens'),'check',url+'/state','--quick','--watch','--watch-interval','1','--out',str(work/'watch')],cwd=ROOT,stdout=log,stderr=log,start_new_session=True)
                try:
                    deadline=time.monotonic()+40
                    while time.monotonic()<deadline:
                        meta=work/'watch/metadata.json'
                        if meta.exists():
                            try:
                                state=json.loads(meta.read_text())['provider']['session']
                                if state['contexts_created']>=2:
                                    assert state['browser_launches']==1
                                    break
                            except (ValueError,KeyError): pass
                        time.sleep(.1)
                    else: raise AssertionError('watch did not complete two isolated runs')
                finally:
                    watch.terminate()
                    watch.wait(timeout=10)
            assert len(Handler.cookies)>=2 and all(cookie is None for cookie in Handler.cookies)
            assert not json.loads((work/'watch/console.json').read_text())
            passed+=1
            print(json.dumps({'passed':passed,'failed':0,'scope':'real CLI Chromium E2E'}))
    finally:
        server.shutdown();server.server_close()
if __name__=='__main__':main()
