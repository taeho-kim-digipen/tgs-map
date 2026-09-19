/* Map-independent navigation. Coordinates are local map units: x right, y down. */
(function(root){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), norm=v=>(v%360+360)%360;
const length=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
function validFix(p,now=Date.now()){
  const c=p?.coords;
  return !!c&&Number.isFinite(c.latitude)&&Math.abs(c.latitude)<=90&&Number.isFinite(c.longitude)&&Math.abs(c.longitude)<=180&&Number.isFinite(c.accuracy)&&c.accuracy>=0&&Number.isFinite(p.timestamp)&&p.timestamp<=now+5000&&now-p.timestamp<=30000;
}
function compass(e,angle=0){
  if(Number.isFinite(e.webkitCompassHeading)){
    if(Number.isFinite(e.webkitCompassAccuracy)&&(e.webkitCompassAccuracy<0||e.webkitCompassAccuracy>50))return null;
    return norm(e.webkitCompassHeading+angle);
  }
  return e.absolute===true&&Number.isFinite(e.alpha)?norm(360-e.alpha+angle):null;
}
function proximity(value,{far=150,near=30,arrival=15}={}){
  const close=clamp((far-value)/(far-arrival),0,1);
  return {close,color:value>=far?'#ff3b30':value>near?'#ff9500':'#34c759',fraction:.08+.47*close};
}
function project(fix,origin){
  const k=6371000*Math.PI/180;
  return {x:(fix.longitude-origin.longitude)*k*Math.cos(origin.latitude*Math.PI/180),y:-(fix.latitude-origin.latitude)*k};
}
function calibration(first,second){
  for(const p of [first,second])if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!p.fix||!Number.isFinite(p.fix.latitude)||Math.abs(p.fix.latitude)>90||!Number.isFinite(p.fix.longitude)||Math.abs(p.fix.longitude)>180||!Number.isFinite(p.fix.accuracy)||p.fix.accuracy>20||p.fix.accuracy<0)throw Error('calibration-fix');
  const u=project(second.fix,first.fix),vx=second.x-first.x,vy=second.y-first.y,baseline=Math.hypot(u.x,u.y);
  if(baseline<Math.max(15,(first.fix.accuracy+second.fix.accuracy)*2.5)||Math.hypot(vx,vy)<4)throw Error('calibration-short');
  const n=baseline*baseline,a=(vx*u.x+vy*u.y)/n,b=(vy*u.x-vx*u.y)/n;
  return {origin:first.fix,x:first.x,y:first.y,a,b,unitsPerMeter:Math.hypot(a,b),northAngle:norm(Math.atan2(b,a)*180/Math.PI)};
}
function locate(fix,c){const p=project(fix,c.origin);return {x:c.x+c.a*p.x-c.b*p.y,y:c.y+c.b*p.x+c.a*p.y};}
function headingOnMap(heading,c){return norm(heading+c.northAngle);}
function campusRestricted(now=Date.now()){
  const jst=new Date(now+9*3600000);
  return jst.getUTCFullYear()===2026&&jst.getUTCMonth()===8&&jst.getUTCDate()>=19&&jst.getUTCDate()<=21&&jst.getUTCHours()<10;
}

class Heap{
  constructor(){this.items=[];}
  push(v){const a=this.items;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.items,r=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=v.f)break;a[i]=a[c];i=c;}a[i]=v;}return r;}
}
function makeGrid({width,height,cell=.5,walkable=[],obstacles=[],clearance=.15,bits}){
  const w=Math.ceil(width/cell),h=Math.ceil(height/cell),allowed=new Uint8Array(w*h);
  if(w*h>8000000)throw Error('grid-too-large');
  if(bits){const raw=typeof atob==='function'?atob(bits):Buffer.from(bits,'base64').toString('binary');if(raw.length!==Math.ceil(w*h/8))throw Error('invalid-mask');for(let i=0;i<allowed.length;i++)allowed[i]=(raw.charCodeAt(i>>3)>>(i&7))&1;return {w,h,cell,allowed,clearance,width,height};}
  function fill(r,value,inside){
    const margin=inside?0:clearance;
    const x0=Math.max(0,inside?Math.ceil(r[0]/cell):Math.floor((r[0]-margin)/cell));
    const y0=Math.max(0,inside?Math.ceil(r[1]/cell):Math.floor((r[1]-margin)/cell));
    const x1=Math.min(w,inside?Math.floor(r[2]/cell):Math.ceil((r[2]+margin)/cell));
    const y1=Math.min(h,inside?Math.floor(r[3]/cell):Math.ceil((r[3]+margin)/cell));
    for(let y=y0;y<y1;y++)allowed.fill(value,y*w+x0,y*w+x1);
  }
  walkable.forEach(r=>fill(r,1,true));obstacles.forEach(r=>fill(r,0,false));
  return {w,h,cell,allowed,clearance,width,height};
}
const point=(g,id)=>({x:(id%g.w+.5)*g.cell,y:(Math.floor(id/g.w)+.5)*g.cell});
function cellAt(g,p){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=g.width||p.y>=g.height)return -1;return Math.floor(p.y/g.cell)*g.w+Math.floor(p.x/g.cell);}
function snap(g,p,radius=0){
  const id=cellAt(g,p);if(id<0)throw Error('outside');if(g.allowed[id])return id;
  let best=-1,bestDistance=radius;const r=Math.ceil(radius/g.cell),x=id%g.w,y=Math.floor(id/g.w);
  for(let yy=Math.max(0,y-r);yy<=Math.min(g.h-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(g.w-1,x+r);xx++){
    const i=yy*g.w+xx;if(!g.allowed[i])continue;const q=point(g,i),d=Math.hypot(p.x-q.x,p.y-q.y);if(d<=bestDistance){best=i;bestDistance=d;}
  }
  if(best<0)throw Error('off-path');return best;
}
function visible(g,first,last){
  const free=(x,y)=>x>=0&&y>=0&&x<g.w&&y<g.h&&g.allowed[y*g.w+x];
  let x=first%g.w,y=Math.floor(first/g.w);const ex=last%g.w,ey=Math.floor(last/g.w),dx=ex-x,dy=ey-y,sx=Math.sign(dx),sy=Math.sign(dy),stepX=dx?1/Math.abs(dx):Infinity,stepY=dy?1/Math.abs(dy):Infinity;
  let nextX=stepX/2,nextY=stepY/2;if(!free(x,y))return false;
  while(x!==ex||y!==ey){if(Math.abs(nextX-nextY)<1e-10){if(!free(x+sx,y)||!free(x,y+sy))return false;x+=sx;y+=sy;nextX+=stepX;nextY+=stepY;}else if(nextX<nextY){x+=sx;nextX+=stepX;}else{y+=sy;nextY+=stepY;}if(!free(x,y))return false;}return true;
}
function routeToBooth(g,from,bounds,startSnapRadius=g.cell*1.5){
  // The destination is a set of free cells OUTSIDE the booth, never its centre.
  const [x0,y0,x1,y1]=bounds,margin=g.clearance+g.cell*2,goals=new Set();
  const rectDistance=p=>Math.hypot(Math.max(x0-p.x,0,p.x-x1),Math.max(y0-p.y,0,p.y-y1));
  for(let y=Math.max(0,Math.floor((y0-margin)/g.cell));y<Math.min(g.h,Math.ceil((y1+margin)/g.cell));y++)for(let x=Math.max(0,Math.floor((x0-margin)/g.cell));x<Math.min(g.w,Math.ceil((x1+margin)/g.cell));x++){
    const id=y*g.w+x,p=point(g,id);if(g.allowed[id]&&rectDistance(p)>0&&rectDistance(p)<=margin)goals.add(id);
  }
  if(!goals.size)throw Error('no-entrance');
  const start=snap(g,from,Math.max(g.cell*1.5,startSnapRadius||0)),startPoint=point(g,start),startSnapDistance=Math.hypot(from.x-startPoint.x,from.y-startPoint.y),n=g.w*g.h,closed=new Uint8Array(n),cost=new Float64Array(n),parent=new Int32Array(n);cost.fill(Infinity);parent.fill(-1);
  const heuristic=id=>Math.max(0,rectDistance(point(g,id))-margin)/g.cell;
  const heap=new Heap();cost[start]=0;heap.push({id:start,f:heuristic(start)});
  const free=(x,y)=>x>=0&&y>=0&&x<g.w&&y<g.h&&g.allowed[y*g.w+x];
  while(heap.items.length){
    const id=heap.pop().id;if(closed[id])continue;closed[id]=1;
    if(goals.has(id)){
      const chain=[];for(let i=id;i!==-1;i=parent[i])chain.push(i);chain.reverse();const reduced=[start];
      for(let i=0;i<chain.length-1;){let j=Math.min(chain.length-1,i+120);while(j>i+1&&!visible(g,chain[i],chain[j]))j--;reduced.push(chain[j]);i=j;}
      const line=reduced.map(i=>point(g,i));return {line,length:length(line),cellPath:reduced,startSnapDistance};
    }
    const x=id%g.w,y=Math.floor(id/g.w);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;
      if(!free(xx,yy)||(dx&&dy&&(!free(xx,y)||!free(x,yy))))continue;
      const next=yy*g.w+xx,v=cost[id]+(dx&&dy?Math.SQRT2:1);if(closed[next]||v>=cost[next])continue;
      cost[next]=v;parent[next]=id;heap.push({id:next,f:v+heuristic(next)});
    }
  }
  throw Error('no-path');
}
const api={clamp,norm,length,validFix,compass,proximity,project,calibration,locate,headingOnMap,campusRestricted,makeGrid,point,cellAt,snap,visible,routeToBooth};
if(typeof module!=='undefined')module.exports=api;root.TGSNavigation=api;
})(typeof window==='undefined'?globalThis:window);
