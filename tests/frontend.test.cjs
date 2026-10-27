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
  scrollIntoView(){}
  querySelector(){return this.submit ||= new Element('button');}
  fire(type){return this.listeners[type]?.({preventDefault(){}});}
}
const vehicle=(i,changes={})=>({stock:`S${i}`,vin:`VIN${i}`,title:`Vehicle ${i}`,trim:'Preferred',price:30000+i,paint:{status:'listed_name',name:'Summit White'},engine_details:{status:'listed',summary:'1.2 L Turbocharged I3',horsepower:'137 hp'},features:{remote_start:{status:'present'}},observed_at:'2026-10-27T20:00:00Z',...changes});
async function boot(data={vehicles:[vehicle(1),vehicle(2)]},options={}) {
  const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const document={getElementById:id=>{assert.ok(nodes[id],`Known element ${id}`);return nodes[id];},createElement:tag=>new Element(tag)};
  const bytes=options.bytes || (options.plain ? Buffer.from(JSON.stringify(data)) : zlib.gzipSync(JSON.stringify(data)));
  const ctx=vm.createContext({document,URL,Intl,Date,Response,Blob,TextDecoder,Uint8Array,DecompressionStream:options.noDecompression ? undefined:DecompressionStream,fetch:async()=>{if(options.error)throw new Error('Network unavailable');return {ok:true,arrayBuffer:async()=>bytes};}});
  vm.runInContext(script,ctx);
  for(let i=0;i<100;i++){if(nodes['health-title'].textContent)break;await new Promise(r=>setTimeout(r,5));}
  return {nodes,run:code=>vm.runInContext(code,ctx)};
}
test('HTML has unique ids, native labeled forms and collapsed coverage',()=>{
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 assert.match(html,/<details id="coverage"/);assert.match(html,/<label for="compare-a">/);assert.match(html,/<label for="compare-b">/);assert.match(html,/id="compare-status"[^>]*role="status"/);
});
test('gzip loads, exact normalized search works and reset restores 20-row pagination',async()=>{
 const {nodes:n}=await boot({vehicles:Array.from({length:25},(_,i)=>vehicle(i))});assert.equal(n.results.children.length,20);assert.equal(n.pagination.hidden,false);
 n['next-page'].fire('click');assert.equal(n.results.children.length,5);assert.equal(n['results-title'].focused,true);
 n.query.value=' s4 ';n['search-form'].fire('submit');assert.equal(n.results.children.length,1);assert.match(n.results.textContent,/Vehicle 4/);
 n.query.value='S';n['search-form'].fire('submit');assert.match(n.results.textContent,/No exact match/);
 n.reset.fire('click');assert.equal(n.results.children.length,20);assert.equal(n.query.focused,true);
});
test('already decompressed hosting responses load',async()=>{const {nodes:n}=await boot(undefined,{plain:true});assert.equal(n.results.children.length,2);});
test('real inventory gzip transport and rendering',async()=>{const bytes=fs.readFileSync(path.join(root,'data/inventory.json.gz'));const {nodes:n}=await boot(undefined,{bytes});assert.equal(n.results.children.length,20);assert.doesNotMatch(n['health-title'].textContent,/could not be loaded/);});
test('key facts are visible while secondary specs and evidence are collapsed',async()=>{
 const {nodes:n}=await boot();const card=n.results.children[0];assert.match(card.textContent,/Official exterior paint Summit White/);assert.match(card.textContent,/Exact engine 1.2 L Turbocharged I3/);assert.match(card.textContent,/Horsepower 137 hp/);
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
 assert.doesNotMatch(n.results.textContent,/999 hp/);assert.match(n.results.textContent,/Not confirmed · general colour: White/);
 for(const slot of ['a','b']){n[`compare-${slot}`].value=slot==='a'?'S1':'S2';n[`compare-form-${slot}`].fire('submit');}
 assert.match(n['comparison-table'].textContent,/Not confirmed/);assert.doesNotMatch(n['comparison-table'].textContent,/Explicitly absent/);
});
test('package contents and evidence remain readable expandable panels',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1,{package_contents:[{name:'Comfort Package',status:'partial',items:['Heated front seats'],sources:[{title:'Dealer source',url:'https://www.myerscadillacgm.ca/vehicles/example'}]}]})]});assert.match(n.results.textContent,/Comfort Package/);assert.match(n.results.textContent,/Some contents verified/);assert.match(n.results.textContent,/Heated front seats/);assert.match(n.results.textContent,/Dealer source/);
});
test('partial refresh provides concise warning and keeps raw errors within coverage',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1)],last_partial_success:'2026-10-27T23:00:00Z',error:'https://example.invalid/long/debug'});assert.match(n['health-title'].textContent,/Partial inventory/);assert.doesNotMatch(n['refresh-warning'].textContent,/https/);assert.match(n['refresh-diagnostic'].textContent,/https/);
});
test('empty inventory and invalid formats are honest',async()=>{
 const empty=await boot({vehicles:[]});assert.match(empty.nodes.results.textContent,/No verified vehicles/);
 const invalid=await boot({wrong:[]});assert.match(invalid.nodes.results.textContent,/Inventory unavailable/);assert.match(invalid.nodes['compare-status'].textContent,/unavailable/);
});
test('network failure, broken gzip and unsupported decompression fail safely',async()=>{
 for(const options of [{error:true},{bytes:Buffer.from([31,139,0])},{noDecompression:true}]){const {nodes:n}=await boot(undefined,options);assert.match(n.results.textContent,/Inventory unavailable/);assert.match(n['health-title'].textContent,/could not be loaded/);}
});
test('add-from-results controls choose A/B and move keyboard focus to comparison',async()=>{
 const {nodes:n}=await boot();
 const actions=n.results.children[0].children.find(c=>c.className==='card-actions');actions.children[0].fire('click');assert.match(n['selected-a'].textContent,/Vehicle 1/);assert.equal(n['compare-heading'].focused,true);
 const second=n.results.children[1].children.find(c=>c.className==='card-actions');second.children[1].fire('click');assert.equal(n['compare-output'].hidden,false);
});
test('unverified horsepower is not promoted to a confirmed quick fact',async()=>{
 const {nodes:n}=await boot({vehicles:[vehicle(1,{engine_details:{status:'not_confirmed',horsepower:'999 hp'}})]});assert.doesNotMatch(n.results.children[0].children[0].textContent,/999 hp/);
});
