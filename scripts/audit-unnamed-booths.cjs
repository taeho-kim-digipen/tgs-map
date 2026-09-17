'use strict';
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('dist/map-data.json','utf8'));
const norm = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const rows = data.booths.filter(b => {
  const name = String(b.name||'').trim();
  return !name || norm(name) === norm(b.code) || norm(name) === norm(b.id);
}).map(b => ({
  id: b.id,
  code: b.code,
  name: b.name || '',
  officialName: b.officialName || '',
  exhibitors: b.exhibitors || [],
  map: b.map,
  hall: b.hall
}));
fs.writeFileSync('unnamed-booths.json', JSON.stringify(rows,null,2)+'\n');
console.log(`unnamed/code-only booths: ${rows.length}`);
for (const r of rows) console.log(r.id, JSON.stringify(r));
