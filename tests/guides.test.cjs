'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const L=require('../trims.js');
const model={make:'Buick',model:'Envision',year:2026};
test('stock matching never mixes years, models or brands',()=>{const vehicles=[{...model,trim:'Preferred - AWD'}, {...model,year:2025,trim:'Preferred'}, {...model,model:'Envista',trim:'Preferred'}, {...model,make:'Chevrolet',trim:'Preferred'}];assert.equal(L.matches({vehicles},model).length,1);assert.equal(L.matches({vehicles},model,'Preferred').length,1);});
test('trim boundaries reject lookalikes',()=>{assert.equal(L.trimMatches('AT4X','AT4'),false);assert.equal(L.trimMatches('Denali Ultimate','Denali'),false);assert.equal(L.trimMatches('Preferred - AWD','Preferred'),true);assert.equal(L.trimMatches('Unknown',''),false);});
test('stale, absent, failed and late snapshots never appear current',()=>{assert.equal(L.stale(null),true);assert.equal(L.stale({next_refresh:'bad'}),true);assert.equal(L.stale({next_refresh:'2030-01-01',error:'partial'}),true);assert.equal(L.stale({next_refresh:'2020-01-01'}),true);assert.equal(L.stale({next_refresh:'2030-01-01'},Date.parse('2026-11-05')),false);});
test('unsafe source links are rejected',()=>{assert.equal(L.url('javascript:alert(1)'),null);assert.equal(L.url('http://example.com'),null);assert.equal(L.url('https://www.buick.ca/'),'https://www.buick.ca/');});
test('guide page is navigable and uses accessible labeled controls',()=>{const s=fs.readFileSync('trims.html','utf8');for(const id of ['guide-make','guide-year','guide-model'])assert.ok(s.includes(`for="${id}"`));assert.match(s,/aria-current="page"/);assert.match(fs.readFileSync('index.html','utf8'),/trims.html/);});
test('all factual guide entries have year, Canadian manufacturer source, status and provenance',()=>{const files=['guide-buick-cadillac.json','guide-chevrolet-gmc.json'];let n=0;const ids=new Set();for(const file of files){const d=JSON.parse(fs.readFileSync('data/'+file));for(const m of d.models){n++;assert.ok(!ids.has(m.id),'unique id');ids.add(m.id);assert.ok(Number(m.year)>=2025);assert.ok(m.make&&m.model&&m.checked_at&&m.coverage_note);assert.ok(L.url(m.source_url));assert.ok(Array.isArray(m.trims));for(const t of m.trims){assert.ok(t.name);assert.ok(t.price===null||Number.isFinite(t.price));for(const f of t.features){assert.ok(f.label&&f.value);assert.ok(['standard','optional','unavailable','unknown'].includes(f.status));assert.ok(L.url(f.source_url));}}}}assert.ok(n>0);});
const vm=require('node:vm');
class E{constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.value='';this.hidden=false;this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent||'').join(' ');}append(...c){this.children.push(...c);}replaceChildren(...c){this._text='';this.children=[...c];}addEventListener(t,f){this.listeners[t]=f;}setAttribute(k,v){this[k]=v;}focus(){this.focused=true;}querySelector(tag){return this.children.find(c=>c.tagName===tag)||this.children.map(c=>c.querySelector?.(tag)).find(Boolean)||null;}insertBefore(c,target){const i=this.children.indexOf(target);this.children.splice(i<0?this.children.length:i,0,c);}fire(t){return this.listeners[t]?.({preventDefault(){}});}}
async function guideBoot({inventoryError=false,guideError=false,hash=''}={}){const html=fs.readFileSync('trims.html','utf8');const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new E()]));const document={getElementById:id=>{if(!nodes[id]){const find=e=>e.id===id?e:e.children?.map(find).find(Boolean);const e=Object.values(nodes).map(find).find(Boolean);assert.ok(e,id);return e;}return nodes[id];},createElement:tag=>new E(tag),createTextNode:text=>{const e=new E('#text');e.textContent=text;return e;}};const window={location:{hash},listeners:{},addEventListener(t,f){this.listeners[t]=f;}};const ctx=vm.createContext({document,window,URL,Intl,Date,Response,Blob,TextDecoder,Uint8Array,DecompressionStream,Option:function(text,value){const e=new E('option');e.textContent=text;e.value=value;return e;},fetch:async path=>{const isInventory=path.includes('inventory');if(isInventory?inventoryError:guideError)throw Error('test load failure');const bytes=fs.readFileSync(path);return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes};}});vm.runInContext(fs.readFileSync('trims.js','utf8'),ctx);for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,5));if(!nodes['inventory-status'].textContent.includes('Checking')&&nodes['guide-status'].textContent)break;}return {nodes,window};}
test('actual guide renderer opens six sections and returns to catalogue',async()=>{const {nodes:n,window:w}=await guideBoot();assert.match(n['guide-status'].textContent,/model-year guides/);assert.ok(n['model-catalog'].children.length>20);n['model-catalog'].children[0].children.at(-1).fire('click');assert.equal(n['guide-output'].hidden,false);assert.equal(n['model-catalog'].hidden,true);for(const phrase of ['Trim overview','Side-by-side feature comparison','What changes between trims','Common customer questions','Which trim suits','Sales-floor recap'])assert.ok(n['guide-output'].textContent.includes(phrase),phrase);n['guide-output'].children[0].children.at(-1).fire('click');assert.equal(n['guide-output'].hidden,true);assert.equal(n['model-catalog'].hidden,false);assert.equal(w.location.hash,'');});
test('bookmarks, repeated selection and Back route render stable guide',async()=>{const first=JSON.parse(fs.readFileSync('data/guide-buick-cadillac.json')).models[0];const {nodes:n,window:w}=await guideBoot({hash:'#'+first.id});assert.equal(n['guide-output'].hidden,false);const text=n['guide-output'].textContent;w.listeners.hashchange();assert.equal(n['guide-output'].textContent,text);w.location.hash='';w.listeners.hashchange();assert.equal(n['guide-output'].hidden,true);w.location.hash='#'+first.id;w.listeners.hashchange();assert.equal(n['guide-output'].textContent,text);});
test('inventory failure never removes usable model guides or invents stock',async()=>{const {nodes:n}=await guideBoot({inventoryError:true});assert.match(n['inventory-status'].textContent,/unavailable/);assert.ok(n['model-catalog'].children.length>20);assert.match(n['model-catalog'].textContent,/Inventory unavailable/);});
test('guide failure leaves explicit error rather than empty successful catalogue',async()=>{const {nodes:n}=await guideBoot({guideError:true});assert.match(n['guide-status'].textContent,/Could not load/);assert.equal(n['model-catalog'].children.length,0);});
test('every supplied model guide renders without missing text or exceptions',async()=>{const {nodes:n,window:w}=await guideBoot();const all=['guide-buick-cadillac.json','guide-chevrolet-gmc.json'].flatMap(f=>JSON.parse(fs.readFileSync('data/'+f)).models);for(const m of all){w.location.hash='#'+m.id;w.listeners.hashchange();assert.equal(n['guide-output'].hidden,false,m.id);assert.ok(n['guide-output'].textContent.includes(m.model),m.id);assert.ok(!n['guide-output'].textContent.includes('[object Object]'),m.id);}});
test('explicit drivetrain prefixes match without weakening trim boundaries',()=>{for(const v of ['AWD RS','FWD RS','4WD RS - Sunroof'])assert.equal(L.trimMatches(v,'RS'),true);assert.equal(L.trimMatches('AWD AT4X','AT4'),false);assert.equal(L.trimMatches('AWD Denali Ultimate','Denali'),false);});


test('guide facts are not customer-verified without auditable exact evidence',()=>{
 for(const file of ['guide-buick-cadillac.json','guide-chevrolet-gmc.json']){
  const data=JSON.parse(fs.readFileSync('data/'+file,'utf8'));
  for(const m of data.models)for(const t of m.trims)for(const f of t.features){
   assert.equal(L.auditedFact(f),false,m.id+' '+t.name+' '+f.label+' should not be certified by a generic URL');
  }
 }
 assert.equal(L.auditedFact({status:'standard',verification:{status:'audited',model_year:2026,trim:'ST',evidence_excerpt:'Factory option code ABC',evidence_url:'https://example.com'}}),false);
});
test('customer page clearly separates factory audit from research-only claims',()=>{
 const source=fs.readFileSync('trims.js','utf8');
 assert.match(source,/Unverified claim/);
 assert.match(source,/exact Myers listing/);
 assert.match(source,/factory build sheet/);
});

test('Canadian factory details show available CT5 AWD with manufacturer evidence',async()=>{
 const {nodes:n}=await guideBoot({hash:'#cadillac-ct5-2026'});
 const output=n['guide-output'];
 assert.match(output.textContent,/All-wheel drive option/);
 assert.match(output.textContent,/AWD \(optional\)/);
 assert.match(output.textContent,/Source/);
 assert.match(output.textContent,/factory build sheet/);
});
