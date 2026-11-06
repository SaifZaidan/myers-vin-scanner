'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const audit=JSON.parse(fs.readFileSync('data/customer-truck-audit-2026.json','utf8'));
const expected={
 'gmc-sierra-1500-2026':['Pro','Pro Graphite','SLE','Elevation','SLT','AT4','AT4X','Denali','Denali Ultimate'],
 'chevrolet-colorado-2026':['WT','LT','Trail Boss','Z71','ZR2'],
 'gmc-canyon-2026':['Elevation','AT4','AT4X','Denali']
};
test('exact 2026 Canadian truck models and trims have checked manufacturer features',()=>{
 assert.equal(audit.models.length,3);
 let total=0;
 for(const m of audit.models){
  assert.deepEqual(m.trims.map(t=>t.name),expected[m.id],m.id);
  for(const t of m.trims){
   assert.ok(t.features.length>=5,m.id+' '+t.name);
   const labels=new Set();
   for(const f of t.features){
    total++;assert.ok(!labels.has(f.label),'duplicate label');labels.add(f.label);
    assert.ok(['standard','optional'].includes(f.status));
    assert.match(f.source_url,/^https:\/\/www\.(?:gmccanada|chevrolet)\.ca\//);
    assert.ok(f.value&&f.label);
   }
  }
 }
 assert.ok(total>=130);
});
test('2026 Sierra does not claim Super Cruise standard on ordinary Denali',()=>{
 const s=audit.models.find(m=>m.id==='gmc-sierra-1500-2026');
 assert.equal(s.trims.find(t=>t.name==='Denali').features.find(f=>f.label==='Super Cruise').status,'optional');
 assert.equal(s.trims.find(t=>t.name==='Denali Ultimate').features.find(f=>f.label==='Super Cruise').status,'standard');
});
test('Colorado engine and Canyon factory lifts distinguish the models correctly',()=>{
 const c=audit.models.find(m=>m.id==='chevrolet-colorado-2026');
 for(const t of c.trims)assert.match(t.features.find(f=>f.label==='Engine').value,/310 hp/);
 const canyon=audit.models.find(m=>m.id==='gmc-canyon-2026');
 assert.match(canyon.trims.find(t=>t.name==='Elevation').features.find(f=>f.label==='Factory lift').value,/2-inch/);
 assert.match(canyon.trims.find(t=>t.name==='AT4X').features.find(f=>f.label==='Factory lift').value,/3-inch/);
});
test('dedicated trim reference does not inherit research-only data as a standard claim',()=>{
 const s=fs.readFileSync('trims.js','utf8');
 assert.match(s,/renderCustomerTruckGuide\(m,out\)/);
 assert.match(s,/Not established/);
 assert.match(s,/factory trim guide is not an individual VIN build sheet/i);
});
