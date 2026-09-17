"""Append official page-two halls and insets. Existing page-one geometry stays intact."""
from pathlib import Path
from collections import defaultdict, Counter
import sys, re, json, base64
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.deps/python'))
import pymupdf as fitz
from lxml import etree as ET
ROOT=Path(__file__).resolve().parents[1]
(ROOT/'tmp/maps').mkdir(parents=True,exist_ok=True)
doc=fitz.open(ROOT/'sources/2026TGS_MAP_EN.pdf');page=doc[1];rot=page.rotation_matrix
def text_spans(p):
 return [dict(s,r=fitz.Rect(s['bbox'])*p.rotation_matrix) for b in p.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
spans=text_spans(page);drawings=page.get_drawings()
pattern=re.compile(r'(?:(?:09|10|11)-[A-Z]\d{2,3}|E-\d{2})')
directory=defaultdict(list)
for p in doc:
 ss=text_spans(p)
 cells=[it[1]*p.rotation_matrix for d in p.get_drawings() if d['fill'] for it in d['items'] if it[0]=='re' and 8<(it[1]*p.rotation_matrix).width<18 and 3<=(it[1]*p.rotation_matrix).height<300]
 for s in ss:
  code=s['text'].strip();r=s['r']
  if not pattern.fullmatch(code) or (p.number==0 and r.y0<530) or (p.number==1 and r.x0<660):continue
  rows=sorted([c for c in cells if c.contains((r.tl+r.br)/2)],key=lambda c:c.get_area())
  if not rows:continue
  row=rows[0];names=[t for t in ss if 0<t['r'].x0-r.x1<8 and row.y0<(t['r'].y0+t['r'].y1)/2<row.y1 and t['text'].strip()]
  names.sort(key=lambda t:(t['r'].y0,t['r'].x0));name=' '.join(t['text'].strip() for t in names)
  if name and name not in directory[code]:directory[code].append(name)
# E-xx is printed on two lines inside each actual selected-indie booth.
for s in list(spans):
 if s['text'].strip()!='E-' or not 565<s['r'].x0<590 or not 255<s['r'].y0<498:continue
 candidates=[t for t in spans if re.fullmatch(r'\d{2}',t['text'].strip()) and abs(t['r'].x0-s['r'].x0)<.1 and 1<t['r'].y0-s['r'].y0<3]
 assert len(candidates)==1,(s,candidates)
 spans.append(dict(s,text='E-'+candidates[0]['text'].strip(),r=s['r']|candidates[0]['r']))

regions=[('halls911',[313,85,540,779],'1F·2F · 9–11홀 / 인디·상품판매'),
 ('indie9',[540,499,654,779],'1F · 9홀 인디 확대도'),
 ('selected80',[540,248,654,499],'2F · SELECTED INDIE 80'),
 ('business9',[540,64,654,248],'1F · 9홀 비즈니스 확대도')]
svg_source=page.get_svg_image(text_as_path=True)
def cropped_svg(box):
 root=ET.fromstring(svg_source.encode());root.set('viewBox',' '.join(map(str,[box[0],box[1],box[2]-box[0],box[3]-box[1]])))
 root.set('width',str(box[2]-box[0]));root.set('height',str(box[3]-box[1]))
 href='{http://www.w3.org/1999/xlink}href';ns='{http://www.w3.org/2000/svg}'
 cmyk={}
 for im in page.get_images(full=True):
  if im[5]=='DeviceCMYK':cmyk[im[2:4]]='data:image/png;base64,'+base64.b64encode(fitz.Pixmap(fitz.csRGB,fitz.Pixmap(doc,im[0])).tobytes('png')).decode()
 for element in root.iter(ns+'image'):
  size=(int(element.get('width')),int(element.get('height')))
  if element.get(href,'').startswith('data:image/jpeg;') and size in cmyk:element.set(href,cmyk[size])
 safe=fitz.Rect(box)+(-10,-10,10,10)
 for e in list(root):
  if e.tag==ns+'use':
   trans=re.fullmatch(r'matrix\(([^)]+)\)',e.get('transform',''))
   if trans:
    a=[float(v) for v in re.split(r'[ ,]+',trans[1])]
    if len(a)==6 and not safe.contains(fitz.Point(a[4],a[5])):root.remove(e)
 refs={e.get(href,'').lstrip('#') for e in root.iter()}
 for defs in root.findall(ns+'defs'):
  for e in list(defs):
   if e.get('id','').startswith('font_') and e.get('id') not in refs:defs.remove(e)
 return ET.tostring(root,encoding='utf-8',xml_declaration=True)

booths={};maps=[];report=[]
for map_id,box,floor in regions:
 region=fitz.Rect(box)
 shapes=[dict(d=d,r=d['rect']*rot) for d in drawings if d['fill'] and len(d['items'])==1 and d['items'][0][0]=='re' and region.contains(d['rect']*rot)]
 codes=[s for s in spans if pattern.fullmatch(s['text'].strip()) and region.contains(s['r'])]
 if map_id=='selected80':codes=[s for s in codes if s['r'].x0<590] # right-hand list is the legend, not booth geometry
 used=set()
 for s in codes:
  code=s['text'].strip();r=s['r'];c=(r.tl+r.br)/2
  options=[a for a in shapes if a['r'].width>3 and a['r'].height>3 and (a['r']+(-.2,-.2,.2,.2)).contains(c)]
  options.sort(key=lambda a:a['r'].get_area())
  assert options,(code,map_id,'missing rectangle')
  shape=options[0];rect=shape['r'];key=tuple(rect)
  assert key not in used,(code,map_id,'duplicate rectangle');used.add(key)
  labels=[t for t in spans if t['text'].strip()!=code and rect.contains((t['r'].tl+t['r'].br)/2) and not pattern.fullmatch(t['text'].strip())]
  labels.sort(key=lambda t:(round(t['r'].y0,1),t['r'].x0))
  names=directory.get(code,[])
  if code.startswith('E-'):
   # The adjacent official list gives selected-indie exhibitor names.
   legend=[t for t in spans if t['text'].strip()==code and 590<t['r'].x0<654 and 248<t['r'].y0<499]
   if legend:
    lr=legend[0]['r'];near=[t for t in spans if 0<t['r'].x0-lr.x1<4 and abs(t['r'].y0-lr.y0)<1]
    if near:names=[' '.join(t['text'].strip() for t in near)]
  name=' / '.join(names) or ' '.join(t['text'].strip() for t in labels)
  assert name,(code,map_id,'missing name')
  bounds=[round(v,4) for v in [rect.x0-box[0],rect.y0-box[1],rect.x1-box[0],rect.y1-box[1]]]
  x0,y0,x1,y1=bounds
  fill=tuple(round(v,3) for v in shape['d']['fill'])
  booth=dict(id=code,code=code,hall=9 if code.startswith('E-') else int(code[:2]),map=map_id,name=name,officialName=name,exhibitors=names,bounds=bounds,path=f'M{x0} {y0}H{x1}V{y1}H{x0}Z',sourcePage=2)
  if code.startswith('E-'):booth['locationLabel']='2F · SELECTED INDIE 80'
  if fill==(.788,.733,.739) and map_id=='halls911':booth['area']='merchandise'
  if code in booths:report.append(dict(code=code,old=booths[code]['map'],new=map_id))
  booths[code]=booth
 image=map_id+'-official.svg';(ROOT/'dist'/image).write_bytes(cropped_svg(box))
 maps.append(dict(id=map_id,width=box[2]-box[0],height=box[3]-box[1],image='./'+image,maxScale=34,floor=floor,sourcePage=2,crop=box))
# These rectangles point at the original printed enlargement placeholders.
maps[0]['links']=[dict(bounds=[55,17,130,109],view='indie9',label='9홀 인디 구역 확대도 보기'),dict(bounds=[9,105,26,285],view='selected80',label='SELECTED INDIE 80 확대도 보기'),dict(bounds=[130,116,171,210],view='business9',label='9홀 비즈니스 구역 확대도 보기')]
data=json.loads((ROOT/'dist/map-data.json').read_text(encoding='utf-8-sig'))
old_ids={m['id'] for m in maps}
data['maps']=[m for m in data['maps'] if m['id'] not in old_ids]+maps
data['booths']=[b for b in data['booths'] if b['map'] not in old_ids]+list(booths.values())
data['views']=[v for v in data['views'] if v['map'] not in old_ids]
data['views'][0]['label']='1–8 전체'
data['facilities']=[f for f in data['facilities'] if not f['id'].startswith('h911-')]
for drawing in drawings:
 r=drawing['rect']*rot;f=drawing['fill']
 if not f or not(2<r.width<10 and r.height>0 and .9<r.width/r.height<1.1 and len(drawing['items'])==4 and all(i[0]=='c' for i in drawing['items'])):continue
 female=f[0]>.85 and f[1]<.2;male=f[0]<.05 and .65<f[1]<.72 and f[2]>.9
 if not(female or male):continue
 x,y=(r.x0+r.x1)/2,(r.y0+r.y1)/2
 if not fitz.Rect(regions[0][1]).contains(fitz.Point(x,y)):continue
 floor='2F' if x<353 else '1F'
 data['facilities'].append(dict(id='h911-restroom-'+str(drawing['seqno']),category='restroom',name=f'9–11홀 {floor} {"여성" if female else "남성"} 화장실',map='halls911',floor=floor,x=round(x-313,3),y=round(y-85,3),note='공식 9–11홀 지도에 표시된 화장실입니다.',source='official restroom icon / page 2'))
for mid,box,floor in regions:
 label={'halls911':'9–11홀','indie9':'9홀 인디','selected80':'인디 80','business9':'9홀 비즈'}[mid]
 data['views'].append(dict(id=mid,label=label,map=mid,bounds=[0,0,box[2]-box[0],box[3]-box[1]]))
data['booths'].sort(key=lambda b:(b['hall'],b['code']))
hall_view=next(v for v in data['views'] if v['id']=='halls911')
data['views'].remove(hall_view);data['views'].insert(1,hall_view)
(ROOT/'dist/map-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(ROOT/'tmp/maps/extension-report.json').write_text(json.dumps(dict(total=len(booths),byMap=Counter(b['map'] for b in booths.values()),duplicates=report,merchandise=[(b['id'],b['name']) for b in booths.values() if b.get('area')=='merchandise']),ensure_ascii=False,indent=2),encoding='utf-8')
print((ROOT/'tmp/maps/extension-report.json').read_text(encoding='utf-8'))
