const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/map-data.json'),'utf8'));
const details=JSON.parse(fs.readFileSync(path.join(root,'sources/booth-details.json'),'utf8'));
const ids=new Set(data.booths.map(b=>b.id));
for(const [id,info] of Object.entries(details.booths)){
 if(!ids.has(id))throw new Error('Unknown booth '+id);
 for(const related of info.relatedBooths||[])if(!ids.has(related))throw new Error('Unknown related booth '+related);
 info.checkedAt=details.checkedAt;
}
for(const b of data.booths)if(b.area==='merchandise'&&!details.booths[b.id])details.booths[b.id]={demo:'unknown',ticket:'unknown',sales:'yes',checkedAt:details.checkedAt,activities:['공식 지도 상품판매 구역 · '+b.name],salesNote:'공식 지도에 상품판매 부스로 표시되어 있습니다. 품목·가격·재고·구매 제한은 미확인입니다.',sources:[{label:'공식 9–11홀 배치도',url:data.source}]};
data.details=details;
fs.writeFileSync(path.join(root,'dist/map-data.json'),JSON.stringify(data));
console.log(`Attached ${Object.keys(details.booths).length} sourced records (${Object.keys(JSON.parse(fs.readFileSync(path.join(root,'sources/booth-details.json'),'utf8')).booths).length} individually researched).`);
