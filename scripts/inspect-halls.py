from pathlib import Path
import sys, re, json
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.deps/python'))
import pymupdf as fitz
ROOT=Path(__file__).resolve().parents[1]
d=fitz.open(ROOT/'sources/2026TGS_MAP_EN.pdf'); p=d[1]; rot=p.rotation_matrix
spans=[dict(s,r=list(fitz.Rect(s['bbox'])*rot)) for b in p.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
pat=re.compile(r'(?:(?:09|10|11)-[A-Z]\d{2,3}|E-\d{2})')
codes=[s for s in spans if pat.fullmatch(s['text'].strip())]
draw=[dict(i=i,rect=list(a['rect']*rot),fill=a['fill'],items=len(a['items']),type=a['items'][0][0] if a['items'] else '') for i,a in enumerate(p.get_drawings()) if a['fill']]
out=ROOT/'tmp/maps';out.mkdir(exist_ok=True,parents=True)
(out/'page2-geometry.json').write_text(json.dumps(dict(spans=spans,draw=draw),ensure_ascii=False),encoding='utf-8')
print('codes by x bands',Counter(int(s['r'][0]//100)*100 for s in codes))
for s in spans:
 if any(t in s['text'] for t in ['Enlarged','HALL','Goods','Entrance','Exit','Coin','SELECTED','Indie Game Area']):print(s['text'],[round(x,1) for x in s['r']])
print('code sample',[(s['text'],[round(x,1) for x in s['r']]) for s in codes[:10]])
for x0,x1 in [(310,540),(540,655)]:
 hits=Counter()
 for s in codes:
  r=fitz.Rect(s['r']);c=(r.tl+r.br)/2
  if not x0<c.x<x1:continue
  shapes=[a for a in draw if (fitz.Rect(a['rect'])+(-.2,-.2,.2,.2)).contains(c)]
  shapes.sort(key=lambda a:fitz.Rect(a['rect']).get_area())
  if shapes:hits[tuple(round(x,3) for x in shapes[0]['fill'])]+=1
 print('code shape colors',x0,hits)
