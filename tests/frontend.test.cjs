'use strict';
// Dependency-free DOM contract tests. These do not replace visual browser QA.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'app.js'),'utf8');
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this.value='';this.checked=false;this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>c.textContent || '').join(' ');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=[...children];}
  addEventListener(type,fn){this.listeners[type]=fn;}
  setAttribute(key,value){this[key]=value;}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  querySelector(){return this.submit ||= new Element('button');}
  fire(type){return this.listeners[type]?.({preventDefault(){}});}
}
const vehicle=(i,changes={})=>({mileage:{value:64895,unit:'km',status:'listed'},specs:{'Sale Class':'Used',Odometer:'64895'},stock:`S${i}`,vin:`VIN${i}`,title:`Vehicle ${i}`,trim:'Preferred',price:30000+i,paint:{status:'listed_name',name:'Summit White'},engine_details:{status:'listed',summary:'1.2 L Turbocharged I3',horsepower:'137 hp'},features:{remote_start:{status:'present'}},observed_at:'2026-10-27T20:00:00Z',...changes});
async function boot(data={vehicles:[vehicle(1),vehicle(2)]},options={}) {
  const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const document={getElementById:id=>{assert.ok(nodes[id],`Known element ${id}`);return nodes[id];},createElement:tag=>new Element(tag)};
  const bytes=options.bytes || (options.plain ? Buffer.from(JSON.stringify(data)) : zlib.gzipSync(JSON.stringify(data)));
  const ctx=vm.createContext({document,URL,Intl,Date,Response,Blob,TextDecoder,Uint8Array,DecompressionStream:options.noDecompression ? undefined:DecompressionStream,fetch:async()=>{if(options.pending)return new Promise(()=>{});if(options.error)throw new Error('Network unavailable');return {ok:true,arrayBuffer:async()=>bytes};}});
  vm.runInContext(script,ctx);
  for(let i=0;!options.pending && i<100;i++){if(nodes['health-title'].textContent)break;await new Promise(r=>setTimeout(r,5));}
  return {nodes,run:code=>vm.runInContext(code,ctx)};
}
test('HTML has unique ids, native labeled forms and collapsed coverage',()=>{
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 assert.match(html,/<details id="coverage"/);assert.match(html,/<label for="compare-a">/);assert.match(html,/<label for="compare-b">/);assert.match(html,/id="compare-status"[^>]*role="status"/);
});
function search(n, query='S1') { n.query.value=query;n['search-form'].fire('submit'); }
test('initial load is search-first and reset never restores catalogue',async()=>{
 const {nodes:n}=await boot({vehicles:Array.from({length:25},(_,i)=>vehicle(i))});
 assert.equal(n.results.children.length,0);assert.equal(n['result-panel'].hidden,true);assert.match(n['result-status'].textContent,/Enter a full VIN/);assert.equal(n.pagination,undefined);
 search(n,' s24 ');assert.equal(n.results.children.length,1);assert.match(n['result-status'].textContent,/Vehicle found: Vehicle 24 · Stock S24/);assert.equal(n['view-result'].hidden,false);
 n['view-result'].fire('click');assert.equal(n['results-title'].focused,true);assert.equal(n['results-title'].scrolled,true);
 n.reset.fire('click');assert.equal(n.results.children.length,0);assert.equal(n['result-panel'].hidden,true);assert.equal(n['view-result'].hidden,true);assert.equal(n.query.focused,true);
});
test('search status is visible beside the native form and announced atomically',()=>{
 const searchPanel=html.slice(html.indexOf('<section class="search-panel"'),html.indexOf('<section class="compare-panel"'));
 assert.match(searchPanel,/id="result-status" role="status" aria-live="polite" aria-atomic="true"/);assert.doesNotMatch(searchPanel,/sr-only/);assert.match(searchPanel,/Loading saved inventory/);assert.doesNotMatch(html,/pagination|Show all vehicles/);
});
test('repeat, empty, absent and ambiguous searches clear stale results and report locally',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1),vehicle(2,{stock:'DUP'}),vehicle(3,{stock:'DUP'})]});
 for(const [query,message] of [['VIN1','Vehicle found'],['VIN1','Vehicle found'],['','Enter a full VIN'],['S','No exact match'],['DUP','More than one']]) {
  search(n,query);assert.match(n['result-status'].textContent,new RegExp(message));assert.equal(n['view-result'].hidden,!query.startsWith('VIN'));assert.equal(n.results.children.length,query.startsWith('VIN')?1:0);
 }
});
test('already decompressed hosting responses load without rendering vehicles',async()=>{const {nodes:n}=await boot(undefined,{plain:true});assert.equal(n.results.children.length,0);search(n);assert.equal(n.results.children.length,1);});
test('real inventory stays fully searchable without initial cards',async()=>{const bytes=fs.readFileSync(path.join(root,'data/inventory.json.gz'));const data=JSON.parse(zlib.gunzipSync(bytes));const {nodes:n}=await boot(undefined,{bytes});assert.equal(n.results.children.length,0);search(n,data.vehicles.at(-1).vin);assert.equal(n.results.children.length,1);assert.match(n['result-status'].textContent,/Vehicle found/);assert.doesNotMatch(n['health-title'].textContent,/could not be loaded/);});
test('key facts are visible while secondary specs and evidence are collapsed',async()=>{
 const {nodes:n}=await boot();search(n);const card=n.results.children[0];assert.match(card.textContent,/Official exterior paint Summit White/);assert.match(card.textContent,/Exact engine 1.2 L Turbocharged I3/);assert.match(card.textContent,/Horsepower 137 hp/);
 const details=card.children.find(c=>c.className==='details');assert.equal(details.tagName,'details');assert.equal(details.open,undefined);assert.match(details.textContent,/More details/);
});
test('A/B form submission, duplicate protection, difference filter and remove/reset',async()=>{
 const {nodes:n}=await boot();n['compare-a'].value='s1';n['compare-form-a'].fire('submit');assert.equal(n['compare-output'].hidden,true);
 n['compare-b'].value='VIN1';n['compare-form-b'].fire('submit');assert.match(n['compare-status'].textContent,/already selected/);
 n['compare-b'].value='VIN2';n['compare-form-b'].fire('submit');assert.equal(n['compare-output'].hidden,false);assert.match(n['comparison-table'].textContent,/137 hp/);
 n['differences-only'].checked=true;n['differences-only'].fire('change');assert.doesNotMatch(n['comparison-table'].textContent,/Horsepower/);assert.match(n['comparison-table'].textContent,/Advertised price/);
 n['remove-a'].fire('click');assert.equal(n['compare-output'].hidden,true);assert.equal(n['compare-a'].focused,true);
 n['clear-comparison'].fire('click');assert.equal(n['compare-b'].value,'');assert.equal(n['differences-only'].checked,false);
});
test('empty/ambiguous/not-found search does not replace an existing comparison selection',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1),vehicle(2),vehicle(3,{stock:'DUP'}),vehicle(4,{stock:'DUP'})]});
 n['compare-a'].value='S1';n['compare-form-a'].fire('submit');
 for(const [query,message] of [['','Enter a VIN'],['missing','No exact match'],['DUP','More than one']]){n['compare-a'].value=query;n['compare-form-a'].fire('submit');assert.match(n['compare-status'].textContent,new RegExp(message));assert.match(n['selected-a'].textContent,/Vehicle 1/);}
});
test('listed and package-verified presence are not portrayed as equipment differences',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1),vehicle(2,{features:{remote_start:{status:'present',evidence_type:'manufacturer_package'}}})]});
 for(const slot of ['a','b']){n[`compare-${slot}`].value=slot==='a'?'S1':'S2';n[`compare-form-${slot}`].fire('submit');}
 n['differences-only'].checked=true;n['differences-only'].fire('change');assert.doesNotMatch(n['comparison-table'].textContent,/Remote start/);
});
test('unknown remains unknown; conflicting engine cannot display a confident hp figure',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1),vehicle(2,{engine_details:{status:'conflict',horsepower:'999 hp'},paint:{status:'generic_only',generic_color:'White'},features:{}})]});
 search(n,'S2');assert.doesNotMatch(n.results.textContent,/999 hp/);assert.match(n.results.textContent,/Not confirmed · general colour: White/);
 for(const slot of ['a','b']){n[`compare-${slot}`].value=slot==='a'?'S1':'S2';n[`compare-form-${slot}`].fire('submit');}
 assert.match(n['comparison-table'].textContent,/Not confirmed/);assert.doesNotMatch(n['comparison-table'].textContent,/Explicitly absent/);
});
test('package contents and evidence remain readable expandable panels',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1,{package_contents:[{name:'Comfort Package',status:'partial',items:['Heated front seats'],sources:[{title:'Dealer source',url:'https://www.myerscadillacgm.ca/vehicles/example'}]}]})]});search(n);assert.match(n.results.textContent,/Comfort Package/);assert.match(n.results.textContent,/Some contents verified/);assert.match(n.results.textContent,/Heated front seats/);assert.match(n.results.textContent,/Dealer source/);
});
test('partial refresh provides concise warning and keeps raw errors within coverage',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1)],last_partial_success:'2026-10-27T23:00:00Z',error:'https://example.invalid/long/debug'});assert.match(n['health-title'].textContent,/Partial inventory/);assert.doesNotMatch(n['refresh-warning'].textContent,/https/);assert.match(n['refresh-diagnostic'].textContent,/https/);
});
test('empty inventory and invalid formats are honest',async()=>{
 const empty=await boot({vehicles:[]});assert.match(empty.nodes['result-status'].textContent,/No verified vehicles/);
 const invalid=await boot({wrong:[]});assert.match(invalid.nodes['result-status'].textContent,/Inventory unavailable/);assert.match(invalid.nodes['compare-status'].textContent,/unavailable/);
});
test('network failure, broken gzip and unsupported decompression fail safely',async()=>{
 for(const options of [{error:true},{bytes:Buffer.from([31,139,0])},{noDecompression:true}]){const {nodes:n}=await boot(undefined,options);assert.match(n['result-status'].textContent,/Inventory unavailable/);assert.equal(n['view-result'].hidden,true);assert.match(n['health-title'].textContent,/could not be loaded/);}
});
test('add-from-results controls choose A/B and move keyboard focus to comparison',async()=>{
 const {nodes:n}=await boot();search(n);
 const actions=n.results.children[0].children.find(c=>c.className==='card-actions');actions.children[0].fire('click');assert.match(n['selected-a'].textContent,/Vehicle 1/);assert.equal(n['compare-heading'].focused,true);
 search(n,'S2');const second=n.results.children[0].children.find(c=>c.className==='card-actions');second.children[1].fire('click');assert.equal(n['compare-output'].hidden,false);
});
test('unverified horsepower is not promoted to a confirmed quick fact',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1,{engine_details:{status:'not_confirmed',horsepower:'999 hp'}})]});search(n);assert.doesNotMatch(n.results.children[0].children[0].textContent,/999 hp/);
});

test('New/Used and explicit Demo badges are independent; Used/Demo mileage is prominent',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1),vehicle(2,{specs:{'Sale Class':'New',Odometer:0},mileage:{value:0,unit:'km',status:'listed'},demo_status:'listed_demo'}),vehicle(3,{specs:{'Sale Class':'New',Odometer:'10'}})]});
 search(n);assert.match(n.results.children[0].children[0].textContent,/Used/);assert.match(n.results.children[0].children[0].textContent,/64,895 km/);
 search(n,'S2');assert.match(n.results.children[0].children[0].textContent,/New Demo/);assert.match(n.results.children[0].children[0].textContent,/0 km/);
 search(n,'S3');assert.doesNotMatch(n.results.children[0].children[0].textContent,/Demo|Odometer/);
 for(const slot of ['a','b']){n[`compare-${slot}`].value=slot==='a'?'S1':'S2';n[`compare-form-${slot}`].fire('submit');}
 assert.match(n['comparison-table'].textContent,/New \/ Used Used New/);assert.match(n['comparison-table'].textContent,/Odometer 64,895 km 0 km/);
});
test('missing or malformed mileage is never zero and condition is not inferred from URLs',async()=>{
 for(const specs of [{},{'Sale Class':'Used'},{'Sale Class':'Used',Odometer:''},{'Sale Class':'Used',Odometer:'unknown'},{'Sale Class':'Used',Odometer:'20 miles'}]) {
  const {nodes:n}=await boot({vehicles:[vehicle(1,{specs,mileage:null,source_url:'https://www.myerscadillacgm.ca/vehicles/used/'})]});search(n);const header=n.results.children[0].children[0].textContent;assert.match(header,/Not provided/);assert.doesNotMatch(header,/0 km/);
 }
});
test('Demo requires a confirmed designation, never mileage or generic title wording',async()=>{
 for(const changes of [{demo_status:'not_confirmed',title:'Vehicle 1 not a demo'},{mileage:{value:10,unit:'km',status:'listed'}}]) {const {nodes:n}=await boot({vehicles:[vehicle(1,changes)]});search(n);assert.doesNotMatch(n.results.children[0].children[0].children[0].textContent,/Demo/);}
});
test('mileage units stay explicit and miles are never relabeled as kilometers',async()=>{
 for(const [mileage,message] of [[{value:5,unit:'mi',status:'listed'},'5 mi'],[{value:5,unit:null,status:'unit_not_confirmed'},'5 · unit not confirmed'],[{value:null,unit:null,status:'not_confirmed'},'Not provided']]) {
 const {nodes:n}=await boot({vehicles:[vehicle(1,{mileage})]});search(n);assert.ok(n.results.children[0].children[0].textContent.includes(message));
 }
});

test('inventory loading is reported beside search before any results can be shown',async()=>{
 const {nodes:n}=await boot(undefined,{pending:true});assert.match(n['result-status'].textContent,/Loading saved inventory/);assert.equal(n.results.children.length,0);assert.equal(n['view-result'].hidden,true);search(n);assert.match(n['result-status'].textContent,/Loading saved inventory/);
});

test('source-backed seating appears first in More details and in comparison without model guesses',async()=>{
 const seating={capacity:7,layout:'2-2-3',second_row:'Captain’s chairs',status:'listed',evidence:['Exact listing seating statement'],sources:[{title:'Seating listing',url:'https://www.myerscadillacgm.ca/vehicles/example'}]};
 const {nodes:n}=await boot({vehicles:[vehicle(1,{seating}),vehicle(2,{title:'GMC Terrain'})]});search(n);
 const details=n.results.children[0].children.find(c=>c.className==='details');assert.equal(details.children[1].className,'seating-details');assert.match(details.textContent,/7 seats/);assert.match(details.textContent,/2-2-3/);assert.match(details.textContent,/Captain’s chairs/);assert.match(details.textContent,/Exact listing seating statement/);
 for(const slot of ['a','b']){n[`compare-${slot}`].value=slot==='a'?'S1':'S2';n[`compare-form-${slot}`].fire('submit');}
 assert.match(n['comparison-table'].textContent,/Seating capacity 7 seats Not confirmed/);assert.match(n['comparison-table'].textContent,/Second-row seats Captain’s chairs Not confirmed/);
});
test('conflicting seating never promotes a capacity or layout, and capacity alone does not imply chairs',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1,{seating:{status:'conflict',capacity:7,layout:'2-2-3'}}),vehicle(2,{seating:{status:'listed',capacity:7,layout:'2-2-3'}})]});search(n);
 let details=n.results.children[0].children.find(c=>c.className==='details');assert.match(details.textContent,/conflicting seating details/);assert.doesNotMatch(details.textContent,/7 seats|2-2-3/);
 search(n,'S2');details=n.results.children[0].children.find(c=>c.className==='details');assert.match(details.textContent,/Second-row seats Not confirmed/);
});
