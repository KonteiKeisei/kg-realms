"""Build local HTML guide previews from Markdown and supplied screenshots.

Run from any directory: python tools/build-guide.py
Does not modify runtime files or publish anything.
"""
from pathlib import Path
from html import escape
import json
import re

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / 'docs' / 'guide'
ASSETS = GUIDE / 'assets'
PREVIEW = GUIDE / 'preview'
VERSION = json.loads((ROOT / 'module.json').read_text(encoding='utf-8'))['version']

def inline(value):
    """Small Markdown subset used by this guide. No raw HTML from source pages."""
    tokens=[]
    def stash(html):
        tokens.append(html);return f'\x00{len(tokens)-1}\x00'
    value=re.sub(r'`([^`]+)`',lambda m:stash('<code>'+escape(m[1])+'</code>'),value)
    def link(m):
        image,label,target=m[1],m[2],m[3]
        if target.endswith('.md') or '.md#' in target:target=target.replace('.md','.html')
        if target.startswith('assets/'):target='../'+target
        label=escape(label);target=escape(target,quote=True)
        if image:return stash(f'<figure><a href="{target}" target="_blank"><img src="{target}" alt="{label}" loading="lazy"></a><figcaption>{label}. Click to enlarge.</figcaption></figure>')
        return stash(f'<a href="{target}">{label}</a>')
    value=re.sub(r'(!?)\[([^\]]+)\]\(([^)]+)\)',link,value)
    value=escape(value)
    value=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',value)
    return re.sub(r'\x00(\d+)\x00',lambda m:tokens[int(m[1])],value)

def slug(value):
    return re.sub(r'[^\w\- ]','',value.lower()).replace(' ','-')

def markdown(source):
    out=[];ls=source.splitlines();i=0
    while i<len(ls):
        line=ls[i]
        if not line.strip():i+=1;continue
        if line.startswith('```'):
            i+=1;chunk=[]
            while i<len(ls) and not ls[i].startswith('```'):chunk.append(ls[i]);i+=1
            out.append('<pre><code>'+escape('\n'.join(chunk))+'</code></pre>');i+=1;continue
        m=re.match(r'^(#{1,6}) (.+)$',line)
        if m:
            n=len(m[1]);out.append(f'<h{n} id="{slug(m[2])}">{inline(m[2])}</h{n}>');i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(ls) and ls[i].startswith('|'):
                row=ls[i].strip().strip('|').split('|')
                if not all(re.match(r'^\s*:?-+:?\s*$',c) for c in row):rows.append(row)
                i+=1
            html='<div class="table-scroll"><table><thead><tr>'+''.join('<th>'+inline(c.strip())+'</th>' for c in rows[0])+'</tr></thead><tbody>'
            for row in rows[1:]:html+='<tr>'+''.join('<td>'+inline(c.strip())+'</td>' for c in row)+'</tr>'
            out.append(html+'</tbody></table></div>');continue
        m=re.match(r'^(?:- |\d+\. )(.+)',line)
        if m:
            ordered=not line.startswith('- ');tag='ol' if ordered else 'ul';items=[]
            start=int(re.match(r'^(\d+)\.',line)[1]) if ordered else 1
            while i<len(ls):
                m=re.match(r'^(?:- |\d+\. )(.+)',ls[i])
                if not m or (not ls[i].startswith('- '))!=ordered:break
                items.append('<li>'+inline(m[1])+'</li>');i+=1
            start_attr=f' start="{start}"' if ordered and start!=1 else ''
            out.append('<'+tag+start_attr+'>'+''.join(items)+'</'+tag+'>');continue
        para=[line];i+=1
        while i<len(ls) and ls[i].strip() and not re.match(r'^(#|\||```|!\[|- |\d+\. )',ls[i]):para.append(ls[i]);i+=1
        rendered=inline(' '.join(para));out.append(rendered if rendered.startswith('<figure>') else '<p>'+rendered+'</p>')
    return '\n'.join(out)

CSS='''
:root{color-scheme:light;--ink:#202b35;--muted:#586574;--line:#dae0e5;--accent:#9e540d}
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:var(--ink);font:16px/1.65 system-ui,Arial,sans-serif}a{color:#87500e;text-underline-offset:3px}a:hover{color:#482708}header{height:70px;background:#17232d;color:#fff;position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:3px solid #d79749}header b{font-size:20px}header span{color:#dfc29c;font-size:14px}header button{background:#30414e;color:#fff;border:1px solid #5b6b77;border-radius:5px;padding:8px 13px;cursor:pointer}aside{position:fixed;inset:70px auto 0 0;width:292px;overflow:auto;background:#fff;border-right:1px solid var(--line);padding:22px 16px}aside input{width:100%;padding:10px 12px;margin-bottom:18px;border:1px solid #b9c5ce;border-radius:5px;font:inherit}aside a{display:block;color:#334350;text-decoration:none;padding:8px 10px;font-size:14px;line-height:1.45;border-radius:4px;margin-bottom:3px}aside a.current{background:#fff0dc;color:#78410a;font-weight:650;border-left:3px solid #ce8b34}aside small{display:block;font-size:11px;color:#667782;text-transform:uppercase;letter-spacing:.05em}main{max-width:1140px;margin-left:292px;padding:34px 48px 80px}article{background:#fff;border:1px solid var(--line);border-radius:8px;padding:34px 42px;max-width:980px;margin:auto}h1{font-size:32px;line-height:1.2;margin:0 0 23px;letter-spacing:-.025em}h2{font-size:22px;margin:36px 0 12px;border-top:1px solid #e0e5e8;padding-top:22px}h3{font-size:19px}p{margin:12px 0 18px}li{margin:7px 0}figure{margin:25px 0 18px;background:#11171c;border-radius:6px;overflow:hidden}figure img{display:block;width:100%;height:auto}figcaption{font-size:12px;line-height:1.5;color:#cfdae1;padding:10px 14px}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.5}th{text-align:left;background:#edf1f3}td,th{padding:11px 12px;border:1px solid #dce3e8;vertical-align:top}tr:nth-child(even){background:#fafbfc}.table-scroll{overflow:auto;margin:18px 0 24px}code{background:#eef1f3;padding:2px 4px;border-radius:3px;overflow-wrap:anywhere}pre{padding:15px;background:#eef1f3;overflow:auto;white-space:pre-wrap;font-size:13px}.note{font-size:13px;color:#596977;margin:0 auto 20px;max-width:980px}.bottom{display:flex;justify-content:space-between;gap:20px;padding-top:30px;margin-top:25px;border-top:1px solid var(--line);font-size:14px}.bottom a{max-width:45%}.mobile-label{display:none}@media(min-width:1001px){header button{display:none}}@media(max-width:1000px){aside{display:none;z-index:4;width:292px;box-shadow:4px 4px 18px #0003}body.nav-open aside{display:block}main{margin-left:0;padding:24px}article{padding:28px}.mobile-label{display:inline}}@media(max-width:600px){header{padding:0 16px}header span{font-size:11px;max-width:120px;text-align:right}header b{font-size:17px;line-height:1.2}header b span{display:block;font-size:11px;margin-top:4px;white-space:nowrap;text-align:left}main{padding:16px 8px}article{padding:22px 17px}h1{font-size:27px}td,th{padding:8px;font-size:13px}.note{padding:0 10px}}@media print{header,aside,.note,.bottom{display:none}main{margin:0;padding:0;max-width:none}article{border:0}h2{break-after:avoid}figure,tr{break-inside:avoid}a{color:inherit}}
'''

def build():
    ASSETS.mkdir(parents=True,exist_ok=True);PREVIEW.mkdir(parents=True,exist_ok=True)
    pages=sorted(GUIDE.glob('*.md'),key=lambda p:(p.name!='README.md',p.name))
    (PREVIEW/'guide.css').write_text(CSS,encoding='utf-8')
    for i,p in enumerate(pages):
        title=p.read_text(encoding='utf-8').splitlines()[0].removeprefix('# ')
        nav=[]
        for q in pages:
            qt=q.read_text(encoding='utf-8').splitlines()[0].removeprefix('# ')
            cls=' class="current" aria-current="page"' if q==p else ''
            audience='Player' if '-player' in q.stem else 'GM' if q.stem not in ('README','15-settings','15-files','16-troubleshooting','17-reference') else 'Start / reference'
            nav.append(f'<a href="{q.stem}.html"{cls}><small>{audience}</small>{escape(qt)}</a>')
        # Player page footers stay on the player reading path.
        shared={'README','15-settings','15-files','16-troubleshooting','17-reference'}
        path=[q for q in pages if '-player' in q.stem or q.stem in shared] if '-player' in p.stem else [q for q in pages if '-player' not in q.stem]
        at=path.index(p)
        prev=f'<a href="{path[at-1].stem}.html">Previous: {escape(path[at-1].read_text(encoding="utf-8").splitlines()[0][2:])}</a>' if at else '<span></span>'
        nxt=f'<a href="{path[at+1].stem}.html">Next: {escape(path[at+1].read_text(encoding="utf-8").splitlines()[0][2:])}</a>' if at+1<len(path) else '<span></span>'
        html=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} | KG Realms guide</title><link rel="stylesheet" href="guide.css"></head><body><header><b>KG Realms <span>User guide</span></b><button id="menu" aria-expanded="false" aria-controls="navigation">Contents</button><span>LOCAL REVIEW DRAFT / {VERSION}</span></header><aside id="navigation"><input type="search" id="find" aria-label="Filter guide pages" placeholder="Find a page">{''.join(nav)}</aside><main><article>{markdown(p.read_text(encoding='utf-8'))}<nav class="bottom" aria-label="Page navigation">{prev}{nxt}</nav></article></main><script>document.getElementById('find').addEventListener('input',e=>{{for(const a of document.querySelectorAll('aside a'))a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase())}});document.getElementById('menu').onclick=e=>{{const on=document.body.classList.toggle('nav-open');e.currentTarget.setAttribute('aria-expanded',on)}};</script></body></html>'''
        (PREVIEW/(p.stem+'.html')).write_text(html,encoding='utf-8')
    (PREVIEW/'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=README.html"><title>KG Realms guide</title><a href="README.html">Open the guide</a></html>',encoding='utf-8')
    print(f'Built {len(pages)} guide pages and local preview using supplied images.')

if __name__=='__main__':build()
