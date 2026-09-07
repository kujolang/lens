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
    def do_GET(self):
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
            run('check',url+'/trivial?token=PRIVATE_SECRET_123','--html','--accessibility','--perf','--baseline','--baseline-dir',str(work/'baselines'),'--out',str(work/'check'))
            for name in ['lens-report.json','lens-report.html','metadata.json','accessibility.json','metrics.json','screenshots/desktop.png','screenshots/mobile.png']:
                assert (work/'check'/name).stat().st_size>0,name
            assert 'session' not in json.loads((work/'check/metadata.json').read_text())['provider']
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
            passed+=1
            run('inspect',url+'/flow','--json','--out',str(work/'inspect'))
            assert (work/'inspect/elements.json').stat().st_size>0
            passed+=1
            flow={'name':'Fixture journey','url':url+'/flow','viewports':['desktop'],'steps':[
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
            run('check','https://example.com','--out',str(work/'external'),allowed=(2,))
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
