"""Build an offline, geographically registered vector campus and walkable mask.
Requires numpy + shapely. Original PDF diagrams and booth identities are retained.
"""
from pathlib import Path
import xml.etree.ElementTree as ET,json,math,base64,html
import numpy as np
from shapely.geometry import Polygon,LineString,box
from shapely.ops import unary_union
from shapely import contains_xy
ROOT=Path(__file__).resolve().parent.parent
D=json.loads((ROOT/'dist/map-data.json').read_text());REG=json.loads((ROOT/'sources/navigation/registration.json').read_text());G=REG['geography'];W,H,C=G['width'],G['height'],G['cell'];OX,OY=G['offset'];ux,uy=G['axisX'];k=6371000*math.pi/180
raw=ET.parse(ROOT/'sources/navigation/makuhari.osm').getroot()
ns={n.get('id'):(float(n.get('lon')),float(n.get('lat')))for n in raw.findall('node')}
def project(ll):
 e=(ll[0]-G['longitude'])*k*math.cos(G['latitude']*math.pi/180);s=-(ll[1]-G['latitude'])*k
 return [e*ux+s*uy+OX,-e*uy+s*ux+OY]
ways={int(w.get('id')):{'id':int(w.get('id')),'tags':{t.get('k'):t.get('v')for t in w.findall('tag')},'points':[project(ns[n.get('ref')])for n in w.findall('nd') if n.get('ref') in ns]}for w in raw.findall('way')}
def transform(src,dst):
 a=(dst[2]-dst[0])/(src[2]-src[0]);d=(dst[3]-dst[1])/(src[3]-src[1]);return [a,d,dst[0]-a*src[0],dst[1]-d*src[1]]
def xy(t,p):return [p[0]*t[0]+t[2],p[1]*t[1]+t[3]]
def rect(t,r):return xy(t,r[:2])+xy(t,r[2:])
panels={p['id']:{**p,'transform':transform(p['from'],[p['to'][0]+OX,p['to'][1]+OY,p['to'][2]+OX,p['to'][3]+OY])}for p in REG['panels']}
transforms={id:p['transform']for id,p in panels.items()}
def envelope(rects):return [min(r[0] for r in rects),min(r[1] for r in rects),max(r[2] for r in rects),max(r[3] for r in rects)]
main_panels=[p for p in REG['panels'] if p['map']=='main']
main_source=envelope([p['from'] for p in main_panels])
main_target=envelope([rect(transforms[p['id']],p['from']) for p in main_panels])
main_transform=transform(main_source,main_target)
concourse_map=next(m for m in D['maps'] if m['id']=='concourse')
concourse_source=[main_source[0],0,main_source[2],concourse_map['height']]
concourse_target=[main_target[0],OY-87,main_target[2],OY-87+concourse_map['height']*.72]
concourse_transform=transform(concourse_source,concourse_target)
for p in REG['insets']:transforms[p['map']]=transform(p['from'],rect(transforms[p['parent']],p['to']))
def for_booth(b):
 if b['map']=='main':return main_transform
 return transforms[b['map']]
walk=[];blocked=[]
for id,p in panels.items():
 t=main_transform if p['map']=='main' else p['transform'];src=p['from']
 # The 9–11 ground lobby lies west of the exhibition floor, separately from 2F esplanade.
 if id=='halls911':src=[42,14,205,683]
 walk.append(box(*rect(t,src)))
# Three drawn cross passages in each mall, never a free region outside the building.
for left,right in [('main78','main46'),('main46','main13')]:
 lrect=rect(main_transform,panels[left]['from']);rrect=rect(main_transform,panels[right]['from'])
 for a,b in [(47,55),(97,105),(145,153)]:
  y0=xy(main_transform,[0,a])[1];y1=xy(main_transform,[0,b])[1]
  walk.append(box(lrect[2]-.5,y0,rrect[0]+.5,y1))
# Fixed stage footprint from the original TGS drawing; no route through the stage.
blocked.append(box(*rect(main_transform,[803,32,906,73])))
stairs=[];main_stair_xs=[]
for p in REG['mainStairs']:
 q=xy(main_transform,p)
 end=[q[0],OY-77.8];walk.append(LineString([q,end]).buffer(2.3));stairs.append({'x':q[0],'y':(q[1]+end[1])/2,'label':'1F ↔ 2F'});main_stair_xs.append(q[0])
# The south edge of Halls 1-8 is 1F. The Central Mall immediately outside is 2F.
# Keep a solid floor boundary between them and punch holes ONLY at the official TO-2F stairs.
# This prevents A* from stepping straight from a 1F aisle onto the 2F bridge.
main_edge_y=main_target[3]
transition_barrier=box(main_target[0]-2,main_edge_y-1.5,main_target[2]+2,OY-80.0)
stair_openings=unary_union([box(x-2.8,main_edge_y-3,x+2.8,OY-76.5) for x in main_stair_xs])
blocked.append(transition_barrier.difference(stair_openings))
for id in REG['walkingWayIds']:walk.append(LineString(ways[id]['points']).buffer(2.5))
# 2F esplanade; deliberately separated from the 1F lobby except at the stair link.
walk.append(box(OX-105,OY+116,OX-86.2,OY+318))
stair=[(x+OX,y+OY)for x,y in REG['hall10Stairs']];walk.append(LineString(stair).buffer(2.5));stairs.append({'x':sum(p[0]for p in stair)/2,'y':stair[0][1],'label':'2F ↔ 1F'})
# Enlarged panels are placed within their parent footprint; originals remain available.
for p in REG['insets']:
 if p['map']=='selected80':walk.append(box(*rect(transforms[p['map']],p['from'])))
# Red Bull Gaming Sphere On Tour is in the Hall 9 south outdoor food-court / kitchen-car space.
# Keep a narrow, connected outdoor spur instead of opening the whole exterior plaza to routing.
walk.append(box(426.0,364.0,439.5,371.5))
placements={}
colors={'main':'#cadfeb','school':'#eed2e3','indie9':'#cbdfe5','business9':'#cce7da','selected80':'#acdce9','halls911':'#eedfc9'}
booth_shapes=[];booth_text=[]
for b in D['booths']:
 t=for_booth(b);r=[round(v,5)for v in rect(t,b['bounds'])];placements[b['id']]={'bounds':r,'path':f'M{r[0]} {r[1]}H{r[2]}V{r[3]}H{r[0]}Z','floor':2 if b['map']=='selected80' else 1,'sourceMap':b['map']}
 blocked.append(box(*r))
 color=colors[b['map']];bw=r[2]-r[0];bh=r[3]-r[1]
 booth_shapes.append(f'<rect x="{r[0]}" y="{r[1]}" width="{bw}" height="{bh}" fill="{color}" stroke="#719095" stroke-width=".15"/>')
 size=min(1.7,bw/max(7,len(b['code']))*1.4,bh*.32)
 booth_text.append(f'<text x="{(r[0]+r[2])/2}" y="{r[1]+bh*.40}" text-anchor="middle" font-size="{size}">{html.escape(b["code"])}</text>')
 if bw>7 and bh>6:
  title=b.get('shortName',b['name']);title=title[:26]
  booth_text.append(f'<text x="{(r[0]+r[2])/2}" y="{r[1]+bh*.68}" text-anchor="middle" font-size="{min(2,bw/max(6,len(title)))}">{html.escape(title)}</text>')
# A cell is only free when its entire footprint clears obstacles and corridor edges.
free=unary_union(walk).difference(unary_union(blocked).buffer(.025)).buffer(-C*math.sqrt(2)/2)
w=math.ceil(W/C);h=math.ceil(H/C);xx=(np.arange(w)+.5)*C;mask=np.zeros((h,w),dtype=np.uint8)
for y in range(0,h,128):
 yy=(np.arange(y,min(h,y+128))+.5)*C;mask[y:y+len(yy),:]=contains_xy(free,xx[None,:],yy[:,None])
bits=base64.b64encode(np.packbits(mask.reshape(-1),bitorder='little').tobytes()).decode()
nav={'width':W,'height':H,'w':w,'h':h,'cell':C,'clearance':.025,'bits':bits}
(ROOT/'dist/navigation/campus-grid.json').write_text(json.dumps(nav,separators=(',',':')))
# OSM backdrop: roads, building outlines, water/parks and footways; no test map or tiles.
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="#e8eee8"/>']
def path(points,close=False):return ' '.join(('M' if i==0 else 'L')+f'{p[0]:.2f} {p[1]:.2f}'for i,p in enumerate(points))+('Z'if close else '')
for w0 in ways.values():
 pts=w0['points'];t=w0['tags'];
 if len(pts)<2 or not any(-50<x<W+50 and -50<y<H+50 for x,y in pts):continue
 if 'building'in t:svg.append(f'<path d="{path(pts,True)}" fill="#d0d9d2" stroke="#a3b1a8" stroke-width=".6"/>')
 elif t.get('highway')in['primary','secondary','tertiary','residential','unclassified','service']:svg.append(f'<path d="{path(pts)}" fill="none" stroke="#fafbf7" stroke-width="{8 if t["highway"] in ["primary","secondary"] else 5}" stroke-linecap="round"/>')
 elif t.get('highway')in['footway','pedestrian','steps']:svg.append(f'<path d="{path(pts,t.get("area")=="yes")}" fill="{"#f4f4ec"if t.get("area")=="yes"else "none"}" stroke="#c4cfbd" stroke-width="2"/>')
for geom in walk:svg.append(f'<path d="{path(list(geom.exterior.coords),True)}" fill="#fffefa" stroke="#a1b3a4" stroke-width=".3"/>')
# Booth hitboxes/placements are emitted to campus.json and app.js. The visible booth artwork comes from the official PDF overlay, so do not duplicate hundreds of synthetic SVG booth nodes here.
labels=[(OX-290,OY-216,'HALL 7–8'),(OX-126,OY-216,'HALL 4–6'),(OX+75,OY-216,'HALL 1–3'),(OX+48,OY+180,'HALL 9'),(OX+48,OY+258,'HALL 10'),(OX+48,OY+300,'HALL 11'),(OX-86,OY+55,'2F 연결교'),(OX-260,OY+1,'국제회의장'),(OX-52,OY-6,'이벤트홀')]
for x,y,label in labels:svg.append(f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="7" font-weight="700" text-anchor="middle" fill="#3d5e52">{label}</text>')
svg.append('<g id="redbull-outdoor-callout" pointer-events="none"><path d="M432.7 366.2V361.4" fill="none" stroke="#d71920" stroke-width="1.5" stroke-linecap="round"/><circle cx="432.7" cy="366.2" r="3" fill="#d71920" stroke="#fff" stroke-width="1.1"/><rect x="401.5" y="344.5" width="62.4" height="17" rx="3.2" fill="#fff" fill-opacity=".97" stroke="#d71920" stroke-width="1.1"/><text x="432.7" y="351.3" font-family="Arial,sans-serif" font-size="5.6" font-weight="800" text-anchor="middle" fill="#b51219">RED BULL GAMING SPHERE</text><text x="432.7" y="357.8" font-family="Arial,sans-serif" font-size="5.1" font-weight="700" text-anchor="middle" fill="#263d40">9홀 남측 야외 푸드코트 · 키친카</text></g>')
for p in stairs:svg.append(f'<g transform="translate({p["x"]} {p["y"]})"><rect x="-3" y="-3" width="6" height="6" rx="1" fill="#34675d"/><path d="M-2 2H-.6V.6H.7V-.7H2V-2" fill="none" stroke="white" stroke-width=".8"/></g>')
svg.append('</svg>');(ROOT/'dist/campus.svg').write_text(''.join(svg))
geo={'origin':{'latitude':G['latitude'],'longitude':G['longitude']},'x':OX,'y':OY,'a':ux,'b':-uy,'unitsPerMeter':1,'northAngle':math.degrees(math.atan2(-uy,ux))%360}
campus={'id':'campus','width':W,'height':H,'image':'./campus.svg','maxScale':42,'floor':'마쿠하리 멧세 · 1–11홀 연결 지도','geo':geo,'registration':'approximate','sources':REG['sources'],'placements':placements,'stairs':stairs,'bridgeBounds':[OX-115,OY+24,OX-100,OY+114]}
facility_placements={}
for f in D['facilities']:
 if f['map']=='main':p=xy(main_transform,[f['x'],f['y']])
 elif f['map']=='concourse':p=xy(concourse_transform,[f['x'],f['y']])
 elif f['map'] in transforms:p=xy(transforms[f['map']],[f['x'],f['y']])
 else:continue
 facility_placements[f['id']]={'x':round(p[0],3),'y':round(p[1],3)}
campus['facilityPlacements']=facility_placements
(ROOT/'dist/navigation/campus.json').write_text(json.dumps(campus,ensure_ascii=False,separators=(',',':')))
print('campus',W,H,'free cells',int(mask.sum()),'booths',len(placements),'grid bytes',len(bits))
