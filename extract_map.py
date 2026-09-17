"""Extract original booth geometry and map images from the official TGS PDF.

Source: https://service.tgs.cesa.or.jp/2026/venue_pdf_en/
No booth positions are estimated. The 160 main-plan and 67 school-inset booth
rectangles are matched one-to-one to printed official booth codes.
"""
from pathlib import Path
from collections import defaultdict
import json, re, hashlib, base64
import fitz
from lxml import etree as ET

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'sources/2026TGS_MAP_EN.pdf'
doc=fitz.open(SOURCE)
page=doc[0]
rotation=page.rotation_matrix
spans=[dict(s,r=fitz.Rect(s['bbox'])*rotation) for b in page.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
drawings=page.get_drawings()
code_pattern=re.compile(r'0[1-8]-[A-Z]\d{2}')
regions=[('main',[180,60,1118,246],(.805,.884,.959)),('school',[850,334,1108,516],(.95,.788,.874))]
directory=defaultdict(list)
grouped_codes=set()
for dp in doc:
    ds=[dict(s,r=fitz.Rect(s['bbox'])*dp.rotation_matrix) for b in dp.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans']]
    row_cells=[it[1]*dp.rotation_matrix for d in dp.get_drawings() if d['fill'] for it in d['items'] if it[0]=='re' and 8<(it[1]*dp.rotation_matrix).width<18 and 3<=(it[1]*dp.rotation_matrix).height<300]
    for s in ds:
        text=s['text'].strip()
        if (dp.number==0 and s['r'].y0<530) or not code_pattern.fullmatch(text):continue
        r=s['r']
        cells=sorted([c for c in row_cells if c.contains((r.tl+r.br)/2)],key=lambda c:c.get_area())
        assert cells,(text,'missing directory cell')
        row=cells[0]
        if row.height>12:grouped_codes.add(text)
        choices=[t for t in ds if 0<t['r'].x0-r.x1<8 and row.y0<(t['r'].y0+t['r'].y1)/2<row.y1 and t['text'].strip()]
        choices.sort(key=lambda t:(t['r'].y0,t['r'].x0))
        if choices:
            name=' '.join(t['text'].strip() for t in choices)
            if name not in directory[text]:directory[text].append(name)

original_svg=page.get_svg_image(text_as_path=True)
# MuPDF's SVG exporter embeds the original CMYK JPEG stream, whose channel
# convention differs from a standalone web image. Resolve it through the PDF
# image resource, then encode those same decoded pixels as a browser-safe PNG.
web_cmyk_images={}
for resource in page.get_images(full=True):
    if resource[5]=='DeviceCMYK':
        size=resource[2:4]
        assert size not in web_cmyk_images, 'CMYK image size must identify one PDF resource'
        rgb=fitz.Pixmap(fitz.csRGB,fitz.Pixmap(doc,resource[0]))
        web_cmyk_images[size]='data:image/png;base64,'+base64.b64encode(rgb.tobytes('png')).decode()
def cropped_svg(box,clip=None):
    root=ET.fromstring(original_svg.encode())
    root.set('viewBox',' '.join(map(str,[box[0],box[1],box[2]-box[0],box[3]-box[1]])))
    root.set('width',str(box[2]-box[0]));root.set('height',str(box[3]-box[1]))
    href='{http://www.w3.org/1999/xlink}href'
    for element in root.iter('{http://www.w3.org/2000/svg}image'):
        uri=element.get(href,'')
        if uri.startswith('data:image/jpeg;'):
            size=(int(element.get('width')),int(element.get('height')))
            if size in web_cmyk_images:element.set(href,web_cmyk_images[size])
    # Omit only glyph instances well outside the visible crop. Preserve every
    # path/image, transformation, clip and in-view glyph exactly as exported.
    safe=fitz.Rect(box)+(-25,-25,25,25)
    for element in list(root):
        if element.tag.endswith('}use'):
            trans=re.fullmatch(r'matrix\(([^)]+)\)',element.get('transform',''))
            if trans:
                values=[float(v) for v in re.split(r'[ ,]+',trans[1])]
                if len(values)==6 and not safe.contains(fitz.Point(values[4],values[5])):root.remove(element)
    refs={e.get('{http://www.w3.org/1999/xlink}href','').lstrip('#') for e in root.iter()}
    for defs in root.findall('{http://www.w3.org/2000/svg}defs'):
        for element in list(defs):
            if element.get('id','').startswith('font_') and element.get('id') not in refs:defs.remove(element)
    if clip:
        ns='{http://www.w3.org/2000/svg}'
        defs=root.find(ns+'defs');cp=ET.SubElement(defs,ns+'clipPath',id='visible_concourse');ET.SubElement(cp,ns+'path',d=clip)
        group=ET.Element(ns+'g',{'clip-path':'url(#visible_concourse)'})
        for child in list(root):
            if child is not defs:root.remove(child);group.append(child)
        root.append(group)
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)

booths=[];maps=[]
for map_id,box,color in regions:
    region=fitz.Rect(box)
    shapes=[dict(r=d['rect']*rotation,d=d) for d in drawings if d['fill'] and tuple(round(v,3) for v in d['fill'])==color and region.contains(d['rect']*rotation)]
    codes=[s for s in spans if region.contains(s['r']) and code_pattern.fullmatch(s['text'].strip())]
    assert len(shapes)==len(codes)==(160 if map_id=='main' else 67)
    used=set()
    for s in codes:
        code=s['text'].strip();center=(s['r'].tl+s['r'].br)/2
        found=[(i,a) for i,a in enumerate(shapes) if (a['r']+(-.3,-.3,.3,.3)).contains(center)]
        assert len(found)==1,(code,found)
        index,shape=found[0];assert index not in used;used.add(index)
        rect=shape['r'];assert len(shape['d']['items'])==1 and shape['d']['items'][0][0]=='re'
        labels=[t for t in spans if t['text'].strip()!=code and rect.contains((t['r'].tl+t['r'].br)/2)]
        labels.sort(key=lambda t:(round(t['r'].y0,1),t['r'].x0))
        if labels:
            max_size=max(t['size'] for t in labels)
            labels=[t for t in labels if t['size']>=max_size*.96]
        name=' '.join(t['text'].strip() for t in labels).strip()
        names=directory.get(code,[])
        # The alphabetical official directory supplies the complete exhibitor
        # name where the tiny plan only prints its booth code.
        if len(names)==1 and code not in grouped_codes:name=names[0]
        elif not name:name=' / '.join(names)
        assert name,(code,'missing exhibitor name')
        bounds=[round(v,4) for v in [rect.x0-box[0],rect.y0-box[1],rect.x1-box[0],rect.y1-box[1]]]
        x0,y0,x1,y1=bounds
        booths.append(dict(id=code,code=code,hall=int(code[:2]),map=map_id,name=name,officialName=name,bounds=bounds,path=f'M{x0} {y0}H{x1}V{y1}H{x0}Z',exhibitors=names))
    assert len(used)==len(shapes)
    asset=f'{map_id}-official.svg'
    (ROOT/'dist'/asset).write_bytes(cropped_svg(box))
    maps.append(dict(id=map_id,width=box[2]-box[0],height=box[3]-box[1],image='./'+asset,maxScale=24 if map_id=='main' else 28))

overrides={
 '01-C04':dict(name='DIP · Daegu Digital Innovation Promotion Agency',shortName='DIP · 대구 공동관'),
 '01-N04':dict(name='SCAD · Savannah College of Art and Design'),
 '01-N47':dict(name='SHINAGAWA GAKUGEI HIGH SCHOOL'),
 '02-C06':dict(name='Games From Portugal'),
 '02-C19':dict(name='Jeonbuk Global Game Center'),
 '03-N02':dict(name='Defios'),
 '05-N01':dict(name='반다이남코 엔터테인먼트',shortName='반다이남코',note='이전 관심작: 건담 로그 오빗 · 에이스 컴뱃. 표시는 반다이남코 공식 부스 전체입니다.'),
 '07-C04':dict(name='NEXON · 넥슨',shortName='넥슨'),
 '07-C03':dict(name='Astrae Oratio · 아스트라에 오라티오',shortName='아스트라에 오라티오',note='이전에 방문하려던 NC 부스입니다.'),
 '07-S01':dict(name='CAPCOM · 캡콤',shortName='캡콤',note='이전에 슈팅레인지를 알아봤던 캡콤 부스입니다. 전체 지도에는 부스 내부 구역이 나뉘어 있지 않습니다.'),
}
for b in booths:
    if b['id'] in overrides:b.update(overrides[b['id']])
booths.sort(key=lambda b:(b['hall'],b['code']))
# The official plan uses a separate enlarged inset for the Hall 1 academy area.
maps[0]['links']=[dict(bounds=[(985-180),(180-60),(1084-180),(226-60)],view='school',label='1홀 학교 구역 확대도 보기')]
maps[0]['floor']='1F · 메인 전시관'
maps[1]['floor']='1F · 학교 구역 확대도'
concourse_box=[180,246,1118,380]
concourse_clip='M180 246H1118V334H675V380H550V334H374V296H225V334H180Z'
(ROOT/'dist/concourse-official.svg').write_bytes(cropped_svg(concourse_box,concourse_clip))
maps.append(dict(id='concourse',width=938,height=134,image='./concourse-official.svg',maxScale=24,floor='2F · 센트럴몰 / 중앙 출입구'))

# Facilities are taken from repeated official icon geometry and printed labels.
def signature(d):
    r=d['rect'];v=[];k=[]
    for item in d['items']:
        k.append(item[0])
        for q in item[1:]:
            if isinstance(q,fitz.Point):v.extend([(q.x-r.x0)/r.width,(q.y-r.y0)/r.height])
            elif isinstance(q,fitz.Rect):v.extend([(q.x0-r.x0)/r.width,(q.y0-r.y0)/r.height,(q.x1-r.x0)/r.width,(q.y1-r.y0)/r.height])
    return k,v
def matching_icons(seqno):
    k,v=signature(next(d for d in drawings if d['seqno']==seqno));out=[]
    for d in drawings:
        if min(d['rect'].width,d['rect'].height)<.01:continue
        dk,dv=signature(d)
        if dk==k and len(dv)==len(v) and max(abs(a-b) for a,b in zip(v,dv))<.025:
            r=d['rect']*rotation
            if max(r.width,r.height)<12:out.append(((r.x0+r.x1)/2,(r.y0+r.y1)/2))
    return out
facilities=[]
def add_facility(id,category,name,x,y,note,source_kind='official map icon',map_id=None):
    if map_id is None:map_id='main' if y<246 else 'concourse'
    bx,by=(180,60) if map_id=='main' else (180,246)
    facilities.append(dict(id=id,category=category,name=name,map=map_id,floor='1F' if map_id=='main' else '2F',x=round(x-bx,3),y=round(y-by,3),note=note,source=source_kind))
add_facility('entrance-h8','entrance','8홀 일반공개일 입구',209,151.5,'1F · 공식 지도에 일반공개일 9:30–10:00로 표시된 입구입니다.','official Entrance on Public Day 9:30–10:00 label')
add_facility('entrance-h1','entrance','1홀 전일 입구',1086.2,156.5,'1F · 공식 지도에 행사 5일 동안의 입구로 표시되어 있습니다.','official Entrance on 5Days label')
add_facility('entrance-connection','entrance','9–11홀에서 오는 연결 통로',586,359.5,'2F · 일반공개일 9–11홀에서 메인 1–8홀로 오는 방향입니다. 이 지점은 메인홀 연결 통로입니다.','official From Hall 9–11 on Public Day arrow')
add_facility('central-exit','entrance','중앙 출입구 · 퇴장 방향',570,337,'2F · 공식 지도에서 중앙 출입구 왼쪽 통로는 Exit로 표시되어 있습니다.','official Exit arrow')
locks=sorted((x,y) for x,y in matching_icons(1862) if 180<x<1118 and 280<y<297)
assert len(locks)==5
for i,(x,y) in enumerate(locks):
    name=['동측 입구 보관함','센트럴몰 동측 보관함 1','센트럴몰 동측 보관함 2','센트럴몰 서측 보관함 1','센트럴몰 서측 보관함 2'][i]
    add_facility('locker-'+str(i+1),'locker',name,x,y,'2F 센트럴몰 · 공식 지도 코인락커 위치. 크기와 잔여 수량은 표시되어 있지 않습니다.')
for x,y in matching_icons(1869):
    if 550<x<580 and y<80:add_facility('food-outdoor','food','4–6홀 남측 야외 푸드코트',x,y,'1F · 4–6홀 남쪽 야외 구역입니다.','official restaurant icon / Hall 4–6 South Outdoor Food Court label')
    elif 460<x<490 and 300<y<320:add_facility('food-world','food','World Kitchens',x,y,'2F 센트럴몰 · 공식 지도 레스토랑·카페 표기입니다.')
    elif 970<x<1000 and 300<y<320:add_facility('food-royal','food','Royal Kitchens!',x,y,'2F 센트럴몰 · 일반공개일 Royal Kitchens! 구역. 비즈니스데이에는 Black Suite LOUNGE로 표시됩니다.')
for x,y in matching_icons(1855):
    if 620<x<650 and 290<y<320:add_facility('info-central','info','중앙 안내소',x,y,'2F 중앙 출입구 · Information Desk입니다.')
for img in page.get_image_info():
    r=fitz.Rect(img['bbox'])*rotation
    if img['width']==29 and img['height']==29 and 660<r.x0<680 and 310<r.y0<340:
        add_facility('charge-central','charge','Charge SPOT · 보조배터리', (r.x0+r.x1)/2,(r.y0+r.y1)/2,'2F 지도상 중앙 출입구 오른쪽의 Charge SPOT 표기. 대여 가능 수량은 현장에서 확인해야 합니다.','official Charge SPOT image instance')
for d in drawings:
    r=d['rect']*rotation;f=d['fill']
    if not f or not (2<r.width<10 and r.height>0 and .9<r.width/r.height<1.1 and len(d['items'])==4 and all(it[0]=='c' for it in d['items'])):continue
    female=f[0]>.85 and f[1]<.2
    male=f[0]<.05 and .65<f[1]<.72 and f[2]>.9
    if not(female or male):continue
    x,y=(r.x0+r.x1)/2,(r.y0+r.y1)/2
    if 180<x<1118 and 60<y<246:
        hall=min([(8,264),(7,370),(6,488),(5,594),(4,699),(3,827),(2,932),(1,1037)],key=lambda h:abs(h[1]-x))[0]
        label=f'{hall}홀 {"남측" if y<150 else "북측"} {"여성" if female else "남성"} 화장실'
    elif (520<x<675 or 1000<x<1118) and 295<y<330:label=f'센트럴몰 {"중앙" if x<675 else "서측"} {"여성" if female else "남성"} 화장실'
    else:continue
    add_facility('restroom-'+str(len(facilities)),'restroom',label,x,y,'공식 지도의 해당 성별 화장실 아이콘 위치입니다.')
for category,count in [('entrance',4),('locker',5),('food',3),('info',1),('charge',1)]:assert sum(f['category']==category for f in facilities)==count
data=dict(
 source='https://service.tgs.cesa.or.jp/2026/venue_pdf_en/',
 sourcePage='https://tgs.cesa.or.jp/2026/en/map',
 sourceSHA256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
 maps=maps,
 views=[
  dict(id='all',label='전체',map='main',bounds=[0,0,938,186]),
  dict(id='h78',label='7–8홀',map='main',bounds=[0,0,237,186]),
  dict(id='h46',label='4–6홀',map='main',bounds=[250,0,576,186]),
  dict(id='h13',label='1–3홀',map='main',bounds=[588,0,938,186]),
  dict(id='school',label='1홀 학교',map='school',bounds=[0,0,258,182]),
  dict(id='concourse',label='2F 편의',map='concourse',bounds=[0,0,938,134]),
 ],
 defaults=['05-N01','07-C04','07-C03'],booths=booths,facilities=facilities)
(ROOT/'dist/map-data.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps(dict(booths=len(booths),by_hall={h:sum(b['hall']==h for b in booths) for h in range(1,9)},maps=[dict(id=m['id'],size=(ROOT/'dist'/m['image'][2:]).stat().st_size) for m in maps]),ensure_ascii=False))
