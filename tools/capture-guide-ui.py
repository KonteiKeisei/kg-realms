"""Capture the public camp UI preview with replacement sample actors.

Optional maintainer tool. Requires Python Playwright and its Chromium browser.
Runs a temporary loopback server and closes it after capture. No Foundry world.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/guide/assets'

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def capture():
    OUT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    print('Loopback fixture server ready.',flush=True)
    try:
        with sync_playwright() as p:
            print('Launching headless Chromium.',flush=True)
            browser=p.chromium.launch(headless=True,timeout=15000)
            print('Chromium ready.',flush=True)
            for role,screen in [('gm','watches'),('player','tasks')]:
                page=browser.new_page(viewport={'width':1120,'height':1050},device_scale_factor=1)
                # Replace sample names before the fixture executes or paints anything.
                source=(ROOT/'tools/camp-preview.html').read_text(encoding='utf-8')
                source=source.replace('["Othorion Baenre", "Kavu", "Borin", "Cira", "Tamsin"]','["Rowan", "Mira", "Bram", "Sable", "Tess"]')
                page.route('**/tools/camp-preview.html',lambda route,request,body=source:route.fulfill(status=200,body=body,content_type='text/html'))
                page.goto(f'http://127.0.0.1:{server.server_port}/tools/camp-preview.html',timeout=15000)
                page.wait_for_function('window.previewReady === true')
                page.evaluate("""() => { for (const a of campPreview.hud.members()) { a.isOwner=a.name==='Mira'; a.testUserPermission=()=>a.isOwner; } }""")
                page.select_option('#screen',screen)
                if role=='player':page.check('#player')
                page.add_style_tag(content='''body{background:#11171c!important}#board,#preview-controls,#errors{display:none!important}#choice{top:112px!important;left:28px!important;width:660px!important;max-height:none!important;overflow:visible!important;padding:20px!important}.doc-header{position:absolute;top:24px;left:28px;color:#f4f4ef;font:24px Arial}.doc-header small{display:block;font:13px Arial;color:#ffc46a;margin-bottom:10px}.doc-notes{position:absolute;left:730px;top:112px;width:358px;padding:22px;background:#1d252c;color:#f3e8d9;border:1px solid #485561;border-radius:8px;font:17px/1.6 Arial}.doc-notes p{margin:18px 0 28px}.doc-pin{position:absolute;width:29px;height:29px;display:grid;place-items:center;background:#ffb349;border:2px solid #34271b;border-radius:50%;color:#171b1f;font:bold 17px Arial;z-index:500}.doc-footer{position:absolute;left:28px;color:#9eacb7;font:14px Arial}''')
                specs=[('[data-camp="view"][data-view="watches"]','Review the shared watch order.'),('[data-camp="gmlock"]','Restrict arrangement to the GM if needed.'),('[data-camp-list]','Drag the watch rows to arrange the order.')] if role=='gm' else [('[data-camp="task"][data-id="a1"]','Mira is the owned character; her task can be changed.'),('[data-camp="task"][data-id="a0"]','Other characters\' task controls are disabled.'),('nav.camp-dock-nav','Player steps include Tasks and Watches. The GM reviews Camp plan.')]
                annotations=page.evaluate("""({role,specs})=>{const h=document.createElement('div');h.className='doc-header';h.innerHTML='<small>KG REALMS / RENDERED UI PREVIEW / '+role.toUpperCase()+' / 0.93.6</small>Camp: '+(role==='gm'?'watch arrangement':'owned character tasks');document.body.append(h);const notes=document.createElement('div');notes.className='doc-notes';notes.innerHTML='<b>CALLOUTS</b>';document.body.append(notes);let count=0;for(const [sel,caption] of specs){const el=document.querySelector(sel);if(!el)continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;count++;const pin=document.createElement('span');pin.className='doc-pin';pin.textContent=count;pin.style.left=Math.max(34,r.right-15)+'px';pin.style.top=(r.top-10)+'px';document.body.append(pin);const n=document.createElement('p');n.textContent=count+'. '+caption;notes.append(n);}const foot=document.createElement('div');foot.className='doc-footer';foot.textContent='Module UI rendered with sample actors and a Foundry stand-in. Not a live game session.';const bottom=Math.max(document.querySelector('#choice').getBoundingClientRect().bottom,notes.getBoundingClientRect().bottom)+28;foot.style.top=bottom+'px';document.body.append(foot);return {count,height:Math.ceil(bottom+35)};}""",{'role':role,'specs':specs})
                if annotations['count']!=len(specs):raise RuntimeError(f'Missing annotation target for {role}: {annotations}')
                page.set_viewport_size({'width':1120,'height':annotations['height']})
                page.screenshot(path=str(OUT/f'camp-{role}-preview.png'),full_page=True)
                if role=='player':
                    assert page.locator('[data-camp="gmlock"]').count()==0
                    assert page.locator('[data-act="camp"]').count()==0
                    assert page.locator('[data-camp="task"][data-id="a0"]').is_disabled()
                    assert page.locator('[data-camp="task"][data-id="a1"]').is_enabled()
                page.close()
            browser.close()
    finally:server.shutdown();server.server_close()
    (OUT/'rendered-previews.json').write_text(json.dumps({'version':'0.93.6','type':'Rendered public UI preview with synthetic actors, not live Foundry','files':['camp-gm-preview.png','camp-player-preview.png'],'sources':['tools/camp-preview.html','scripts/ui-camp.mjs','styles/realms.css']},indent=2)+'\n',encoding='utf-8')
    print('Captured two annotated camp UI previews; player control visibility checked.')

if __name__=='__main__':capture()
