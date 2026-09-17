const assert=require('node:assert/strict');
const {boot}=require('./check-interactions.cjs');
(async()=>{
 const original=require('../dist/data.json');assert.equal(original.length,34);
 const item={booth:'07-C04',game:'추가검증게임',goods:'검증굿즈',image:'./images/example.jpg',condition:'시연 후 수령검증'};
 const app=await boot(undefined,false,[...original,item]);
 const content=e=>[e.textContent,...e.children.map(content)].filter(Boolean).join(' ');
 const input=app.ids.get('booth-search');input.value='추가검증게임';input.fire('input');
 assert.match(content(app.ids.get('results-list')),/07-C04/);
 app.ids.get('results-list').children[0].fire('click');
 const detail=app.ids.get('detail');assert.match(content(detail),/검증굿즈.*시연 후 수령검증/s);
 const walk=e=>[e,...e.children.flatMap(walk)];assert(walk(detail).some(e=>e.tagName==='img'&&e.src===item.image));
 input.value='검증굿즈';input.fire('input');assert.match(content(app.ids.get('results-list')),/07-C04/);
 input.value='ACE COMBAT';input.fire('input');assert.match(content(app.ids.get('results-list')),/05-N01/);
 console.log('PASS: existing content retained; five-field item updates search, booth details, condition and image element. Simulated DOM.');
})().catch(e=>{console.error(e);process.exitCode=1;});
