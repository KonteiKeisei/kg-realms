"""Check guide links, images, fragments, punctuation and preview navigation."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote,urlsplit
import json
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
GUIDE=ROOT/'docs/guide'

def slug(s):return re.sub(r'[^\w\- ]','',s.lower()).replace(' ','-')

class Document(HTMLParser):
    def __init__(self):super().__init__();self.ids=[];self.links=[];self.images=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id'in a:self.ids.append(a['id'])
        if tag=='a' and 'href'in a:self.links.append(a['href'])
        if tag=='img':self.images.append(a)

def check():
    errors=[];checked=0;images=set();html_docs={}
    for p in (GUIDE/'preview').glob('*.html'):
        d=Document();d.feed(p.read_text(encoding='utf-8'));html_docs[p.resolve()]=d
        if len(d.ids)!=len(set(d.ids)):errors.append(f'{p.name}: duplicate HTML ids')
    def target(p,url,html=False):
        nonlocal checked
        u=urlsplit(url)
        if u.scheme or u.netloc:return
        q=(p.parent/unquote(u.path)).resolve() if u.path else p.resolve()
        checked+=1
        if not q.is_file():errors.append(f'{p.name}: missing {url}');return
        if u.fragment:
            ids=html_docs[q].ids if q in html_docs else [slug(x) for x in re.findall(r'^#{1,6} (.+)$',q.read_text(encoding='utf-8'),re.M)]
            if unquote(u.fragment)not in ids:errors.append(f'{p.name}: missing anchor {url}')
    for p in GUIDE.glob('*.md'):
        body=p.read_text(encoding='utf-8')
        if not body.isascii():errors.append(f'{p.name}: non-ASCII prose/punctuation')
        for m in re.finditer(r'(!?)\[([^\]]*)\]\(([^)]+)\)',body):
            target(p,m[3])
            if m[1]:
                images.add(m[3])
                if not m[2]:errors.append(f'{p.name}: image has no alt text')
        if '-player' in p.stem:
            gm_imgs=[x for x in re.findall(r'!\[[^\]]*\]\(assets/([^)]+)\)',body) if '-gm' in x]
            if gm_imgs:errors.append(f'{p.name}: GM image on player page: {gm_imgs}')
    for p,d in html_docs.items():
        for url in d.links:target(p,url,True)
        for im in d.images:
            target(p,im.get('src',''),True)
            if not im.get('alt'):errors.append(f'{p.name}: image missing alt text')
    for p in (GUIDE/'assets').glob('*.svg'):
        ET.parse(p)
        if '<image' in p.read_text(encoding='utf-8'):errors.append(f'{p.name}: embedded external artwork')
    for row in json.loads((GUIDE/'assets/manifest.json').read_text(encoding='utf-8')):
        for src in row['sources']:
            if not (ROOT/src).is_file():errors.append(f'Unknown illustration source: {src}')
    result={'pages':len(list(GUIDE.glob('*.md'))),'illustrations_used':len(images),'local_targets_checked':checked,'errors':errors}
    (ROOT/'.cache').mkdir(exist_ok=True)
    (ROOT/'.cache/guide-check.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
    if errors:raise SystemExit(1)

if __name__=='__main__':check()
