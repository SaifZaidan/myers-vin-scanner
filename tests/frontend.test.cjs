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
  const nodes=Object.fromEntries([...html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)].map(m=>{const element=new Element(m[1]);element.hidden=/\bhidden(?:\s|$)/.test(m[2]);element.disabled=/\bdisabled(?:\s|$)/.test(m[2]);return [m[3],element];}));
  const document={getElementById:id=>{assert.ok(nodes[id],`Known element ${id}`);return nodes[id];},createElement:tag=>new Element(tag)};
  const bytes=options.bytes || (options.plain ? Buffer.from(JSON.stringify(data)) : zlib.gzipSync(JSON.stringify(data)));
  const window={listeners:{},location:{_hash:options.hash || '',get hash(){return this._hash;},set hash(value){this._hash=value.startsWith('#')?value:'#'+value;}},addEventListener(type,fn){this.listeners[type]=fn;}};
  const ctx=vm.createContext({document,window,URL,Intl,Date,Response,Blob,TextDecoder,Uint8Array,DecompressionStream:options.noDecompression ? undefined:DecompressionStream,fetch:async()=>{if(options.pending)return new Promise(()=>{});if(options.error)throw new Error('Network unavailable');return {ok:true,arrayBuffer:async()=>bytes};}});
  vm.runInContext(script,ctx);
  for(let i=0;!options.pending && i<100;i++){if(nodes['health-title'].textContent)break;await new Promise(r=>setTimeout(r,5));}
  return {nodes,window,run:code=>vm.runInContext(code,ctx)};
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

const preferenceVehicle=(i,changes={})=>vehicle(i,{
  make:'GMC',model:'Acadia',price:50000,
  specs:{'Body Style':'SUV','Sale Class':'New','Exterior Color':'Black'},
  paint:{status:'listed_name',name:'Ebony Twilight Metallic',generic_color:'Black'},
  seating:{status:'listed',capacity:7},
  features:{heated_front_seats:{status:'present'},sunroof:{status:'present',evidence_type:'manufacturer_package'}},
  ...changes
});
function findPreferences(n,values={}) {
  for(const [key,value] of Object.entries(values)) n['pref-'+key].value=String(value);
  n['preferences-form'].fire('submit');
}
function preferenceCards(n) {return n['preference-results'].children;}
function cardButton(card,position) {return card.children.find(child=>child.className==='match-actions').children[position];}

test('top navigation has two labeled destinations and preference form has accessible controls',()=>{
  assert.match(html,/<nav[^>]*aria-label="Vehicle tools"/);
  assert.match(html,/id="nav-lookup" href="#lookup"/);assert.match(html,/id="nav-preferences" href="#preferences"/);
  for(const id of ['type','condition','seats','colour','price-min','price-max','make','model']) assert.ok(html.includes(`for="pref-${id}"`));
  assert.match(html,/id="preference-controls" disabled/);assert.match(html,/id="preference-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/Unknown, conflicting or explicitly absent values never satisfy a requirement/);
});
test('preferences never show a catalogue on load, navigation, empty submit or reset',async()=>{
  const {nodes:n}=await boot({vehicles:Array.from({length:25},(_,i)=>preferenceVehicle(i))});
  assert.equal(n['preferences-view'].hidden,true);assert.equal(n['lookup-view'].hidden,false);
  n['nav-preferences'].fire('click');assert.equal(n['preferences-view'].hidden,false);assert.equal(n['lookup-view'].hidden,true);
  assert.equal(n['nav-preferences']['aria-current'],'page');assert.equal(preferenceCards(n).length,0);
  findPreferences(n);assert.equal(preferenceCards(n).length,0);assert.match(n['preference-status'].textContent,/Choose at least one/);
  findPreferences(n,{'price-min':0});assert.equal(preferenceCards(n).length,12);
  n['reset-preferences'].fire('click');assert.equal(preferenceCards(n).length,0);assert.equal(n['preference-matches'].hidden,true);assert.equal(n['pref-type'].focused,true);
});
test('every preference is ANDed, price bounds inclusive, selected features require present status',async()=>{
  const vehicles=[preferenceVehicle(1),preferenceVehicle(2,{price:50001}),preferenceVehicle(3,{seating:{status:'listed',capacity:8}}),preferenceVehicle(4,{features:{heated_front_seats:{status:'present'},sunroof:{status:'not_confirmed',evidence:['Available sunroof']}}}),preferenceVehicle(5,{make:'Chevrolet'}),preferenceVehicle(6,{paint:{status:'listed_name',generic_color:'White'}})];
  const {nodes:n,run}=await boot({vehicles});
  run("preferenceFeatureInputs.heated_front_seats.checked=true;preferenceFeatureInputs.sunroof.checked=true");
  findPreferences(n,{type:'suv',condition:'new',seats:7,colour:'Black','price-min':50000,'price-max':50000,make:'GMC',model:'Acadia'});
  assert.equal(preferenceCards(n).length,1);assert.match(preferenceCards(n)[0].textContent,/Stock S1/);assert.match(n['preference-status'].textContent,/1 vehicle matches every/);assert.match(n['applied-preferences'].textContent,/Sunroof/);
  assert.match(preferenceCards(n)[0].textContent,/All 2 required features confirmed/);assert.match(preferenceCards(n)[0].textContent,/Ebony Twilight Metallic/);
});
test('missing, nonnumeric, zero and invalid prices cannot satisfy either budget bound',async()=>{
  const vehicles=[preferenceVehicle(1),...([null,undefined,'50000',NaN,Infinity,-1,0].map((price,i)=>preferenceVehicle(i+2,{price})))];
  const {nodes:n,run}=await boot({vehicles});
  for(const bounds of [{'price-min':0,'price-max':''},{'price-min':'','price-max':60000},{'price-min':50000,'price-max':50000}]) {findPreferences(n,bounds);assert.equal(preferenceCards(n).length,1);assert.match(preferenceCards(n)[0].textContent,/Stock S1/);}
  assert.equal(run('confirmedPrice({price:NaN})'),null);assert.equal(run('confirmedPrice({price:Infinity})'),null);
  findPreferences(n,{'price-min':'','price-max':'',type:'suv'});assert.equal(preferenceCards(n).length,8);assert.match(preferenceCards(n)[1].textContent,/Price not confirmed/);
});
test('price validation clears prior results, rejects negatives/decimals/inversion and permits zero bounds',async()=>{
  const {nodes:n}=await boot({vehicles:[preferenceVehicle(1)]});
  findPreferences(n,{type:'suv'});assert.equal(preferenceCards(n).length,1);
  for(const [values,message] of [[{'price-min':60000,'price-max':50000},/Minimum price/],[{'price-min':-1,'price-max':''},/valid whole-dollar/],[{'price-min':'oops','price-max':''},/valid whole-dollar/],[{'price-min':2.5,'price-max':''},/valid whole-dollar/]]) {
    findPreferences(n,values);assert.match(n['preference-status'].textContent,message);assert.equal(preferenceCards(n).length,0);assert.equal(n['preference-matches'].hidden,true);
  }
  findPreferences(n,{'price-min':0,'price-max':0});assert.match(n['preference-status'].textContent,/No confirmed matches/);
});
test('exact listed seats only; unknown, conditional and conflicting capacities fail',async()=>{
  const vehicles=[preferenceVehicle(1),...([{status:'not_confirmed',capacity:7},{status:'conflict',capacity:7},{status:'listed',capacity:null,conditional_capacity:7},{status:'listed',capacity:'7'},{status:'listed',capacity:8},null].map((seating,i)=>preferenceVehicle(i+2,{seating})))];
  const {nodes:n}=await boot({vehicles});findPreferences(n,{seats:7});assert.equal(preferenceCards(n).length,1);assert.match(preferenceCards(n)[0].textContent,/Stock S1/);
});
test('only explicit body styles classify as Truck/Car/SUV/Van/Other; model and title do not classify',async()=>{
  const bodies=['SUV','Truck','Convertible','Coupe','Sedan','Minivan','Other','Unknown','',null];
  const {nodes:n}=await boot({vehicles:bodies.map((body,i)=>preferenceVehicle(i,{title:'Truck SUV sports car',specs:{'Body Style':body}}))});
  for(const [type,count] of [['suv',1],['truck',1],['car',3],['van',1],['other',1]]) {findPreferences(n,{type});assert.equal(preferenceCards(n).length,count);}
});
test('colour uses listed exterior family and never guesses from paint name, title or missing/conflicting data',async()=>{
  const {nodes:n}=await boot({vehicles:[preferenceVehicle(1),preferenceVehicle(2,{paint:{status:'conflict',generic_color:'Black'}}),preferenceVehicle(3,{paint:{status:'listed_name',name:'Black Raven'},specs:{}}),preferenceVehicle(4,{paint:null,specs:{'Exterior Color':'Black'}}),preferenceVehicle(5,{paint:{status:'generic_only',generic_color:'Grey'}})]});
  findPreferences(n,{colour:'Black'});assert.equal(preferenceCards(n).length,2);assert.match(preferenceCards(n)[0].textContent,/Stock S1/);assert.match(preferenceCards(n)[1].textContent,/Stock S4/);
  findPreferences(n,{colour:'Grey'});assert.equal(preferenceCards(n).length,1);assert.match(preferenceCards(n)[0].textContent,/Stock S5/);
  assert.deepEqual(n['pref-colour'].children.map(option=>option.value),['','Black','Grey']);
});
test('New/Used follow listing facts; Demo requires explicit designation and may overlap',async()=>{
  const {nodes:n}=await boot({vehicles:[preferenceVehicle(1),preferenceVehicle(2,{demo_status:'listed_demo'}),preferenceVehicle(3,{specs:{'Sale Class':'Used'}}),preferenceVehicle(4,{title:'Demo New',specs:{},demo_status:'not_confirmed',mileage:{value:5,unit:'km',status:'listed'}})]});
  for(const [condition,count] of [['new',2],['used',1],['demo',1]]) {findPreferences(n,{condition});assert.equal(preferenceCards(n).length,count);}
  assert.match(preferenceCards(n)[0].textContent,/Stock S2/);
});
test('unknown and absent features never satisfy requirements; listing and verified package presence do',async()=>{
  const statuses=['present','not_confirmed','absent','conflict',null];
  const {nodes:n,run}=await boot({vehicles:statuses.map((status,i)=>preferenceVehicle(i,{features:{sunroof:{status,evidence:['Sunroof']}}})).concat(preferenceVehicle(6,{features:{sunroof:{status:'present',evidence_type:'dealer_package'}}}),preferenceVehicle(7,{features:{}}))});
  run('preferenceFeatureInputs.sunroof.checked=true');findPreferences(n);assert.equal(preferenceCards(n).length,2);
});
test('make changes reset dependent model, unknown names are excluded from options',async()=>{
  const {nodes:n}=await boot({vehicles:[preferenceVehicle(1),preferenceVehicle(2,{make:'Chevrolet',model:'Tahoe'}),preferenceVehicle(3,{make:null,model:'Not confirmed'})]});
  assert.deepEqual(n['pref-make'].children.map(option=>option.value),['','Chevrolet','GMC']);
  n['pref-model'].value='Tahoe';n['pref-make'].value='GMC';n['pref-make'].fire('change');assert.equal(n['pref-model'].value,'');assert.deepEqual(n['pref-model'].children.map(option=>option.value),['','Acadia']);
  findPreferences(n,{make:'GMC',model:'Acadia'});assert.equal(preferenceCards(n).length,1);
});
test('no results and changing inputs clear old matches, while reset clears all preferences but keeps comparison',async()=>{
  const {nodes:n,run}=await boot({vehicles:[preferenceVehicle(1)]});
  findPreferences(n,{type:'suv'});cardButton(preferenceCards(n)[0],1).fire('click');assert.match(n['selected-a'].textContent,/Vehicle 1/);
  n['pref-price-max'].value='100';n['pref-price-max'].fire('input');assert.equal(preferenceCards(n).length,0);assert.match(n['preference-status'].textContent,/Preferences changed/);
  findPreferences(n);assert.match(n['preference-status'].textContent,/No confirmed matches/);assert.match(n['preference-status'].textContent,/Unconfirmed details are excluded/);
  run('preferenceFeatureInputs.sunroof.checked=true');n['reset-preferences'].fire('click');
  for(const id of ['type','condition','seats','colour','price-min','price-max','make','model']) assert.equal(n['pref-'+id].value,'');
  assert.equal(run('Object.values(preferenceFeatureInputs).some(input=>input.checked)'),false);assert.match(n['selected-a'].textContent,/Vehicle 1/);
});
test('repeated navigation and hash Back/Forward retain each search and shared comparison without duplicate cards',async()=>{
  const {nodes:n,window}=await boot({vehicles:[preferenceVehicle(1),preferenceVehicle(2)]});
  search(n,'S1');n['nav-preferences'].fire('click');findPreferences(n,{seats:7});cardButton(preferenceCards(n)[0],1).fire('click');
  for(let i=0;i<3;i++) {
    n['nav-lookup'].fire('click');assert.equal(n['lookup-view'].hidden,false);assert.equal(n.results.children.length,1);assert.equal(n.query.value,'S1');
    n['nav-preferences'].fire('click');assert.equal(n['preferences-view'].hidden,false);assert.equal(preferenceCards(n).length,2);assert.equal(n['pref-seats'].value,'7');
  }
  window.location.hash='#lookup';window.listeners.hashchange();assert.equal(n['preferences-view'].hidden,true);
  window.location.hash='#preferences';window.listeners.hashchange();assert.equal(n['preferences-view'].hidden,false);assert.equal(preferenceCards(n).length,2);assert.match(n['selected-a'].textContent,/Vehicle 1/);
});
test('compact details/back preserve match list and restore focus; cards can compare across modes',async()=>{
  const {nodes:n}=await boot({vehicles:[preferenceVehicle(1),preferenceVehicle(2)]});
  n['nav-preferences'].fire('click');findPreferences(n,{type:'suv'});const first=preferenceCards(n)[0];const open=cardButton(first,0);
  for(let i=0;i<2;i++) {open.fire('click');assert.equal(n['preferences-discovery'].hidden,true);assert.equal(n['preference-detail-panel'].hidden,false);assert.match(n['preference-detail'].textContent,/Feature checklist/);assert.equal(n['preference-detail-title'].focused,true);n['back-to-preferences'].fire('click');assert.equal(n['preferences-discovery'].hidden,false);assert.equal(n['preference-detail-panel'].hidden,true);assert.equal(preferenceCards(n)[0],first);assert.equal(open.focused,true);}
  cardButton(first,1).fire('click');assert.match(n['selected-a'].textContent,/Vehicle 1/);assert.equal(n['compare-heading'].focused,true);
  n['nav-lookup'].fire('click');search(n,'S2');const actions=n.results.children[0].children.find(child=>child.className==='card-actions');actions.children[1].fire('click');assert.equal(n['compare-output'].hidden,false);
  n['nav-preferences'].fire('click');cardButton(first,2).fire('click');assert.match(n['compare-status'].textContent,/already selected/);assert.match(n['selected-b'].textContent,/Vehicle 2/);
});
test('shortlist is price-ordered and progressively revealed without duplicates; resetting never dumps catalogue',async()=>{
  const {nodes:n}=await boot({vehicles:Array.from({length:26},(_,i)=>preferenceVehicle(i,{price:i===25?null:100000-i*1000}))});
  findPreferences(n,{type:'suv'});assert.equal(preferenceCards(n).length,12);assert.match(preferenceCards(n)[0].textContent,/Stock S24/);assert.match(n['preference-shown'].textContent,/12 of 26/);assert.equal(n['more-preferences'].hidden,false);
  n['more-preferences'].fire('click');assert.equal(preferenceCards(n).length,24);assert.equal(preferenceCards(n)[12].focused,true);
  n['more-preferences'].fire('click');assert.equal(preferenceCards(n).length,26);assert.match(preferenceCards(n)[25].textContent,/Price not confirmed/);assert.equal(n['more-preferences'].hidden,true);
  assert.equal(new Set(preferenceCards(n)).size,26);n['reset-preferences'].fire('click');assert.equal(preferenceCards(n).length,0);
});
test('preference deep link, loading, empty data and failed loading all remain honest',async()=>{
  const deep=await boot({vehicles:[preferenceVehicle(1)]},{hash:'#preferences'});assert.equal(deep.nodes['preferences-view'].hidden,false);assert.equal(preferenceCards(deep.nodes).length,0);
  const loading=await boot(undefined,{pending:true});assert.match(loading.nodes['preference-status'].textContent,/Loading saved inventory/);assert.equal(loading.nodes['preference-controls'].disabled,true);findPreferences(loading.nodes);assert.equal(preferenceCards(loading.nodes).length,0);
  const empty=await boot({vehicles:[]});assert.match(empty.nodes['preference-status'].textContent,/No verified vehicles/);
  for(const options of [{error:true},{noDecompression:true},{bytes:Buffer.from('bad JSON')}]) {const {nodes:n}=await boot(undefined,options);assert.match(n['preference-status'].textContent,/Inventory unavailable/);assert.equal(n['preference-controls'].disabled,true);findPreferences(n);assert.equal(preferenceCards(n).length,0);}
});
test('real snapshot preference results equal source-backed exact filters and preserve timestamp disclosure',async()=>{
  const bytes=fs.readFileSync(path.join(root,'data/inventory.json.gz'));const data=JSON.parse(zlib.gunzipSync(bytes));
  const {nodes:n,run}=await boot(undefined,{bytes});
  const expected=data.vehicles.filter(v=>v.specs?.['Body Style']==='SUV' && typeof v.price==='number' && v.price>0 && v.price<=80000 && v.seating?.status==='listed' && v.seating.capacity===7 && v.paint?.status!=='conflict' && v.paint?.generic_color==='Black' && v.features?.sunroof?.status==='present');
  run('preferenceFeatureInputs.sunroof.checked=true');findPreferences(n,{type:'suv','price-max':80000,seats:7,colour:'Black'});
  assert.equal(run('preferenceMatches.length'),expected.length);assert.equal(preferenceCards(n).length,Math.min(12,expected.length));
  assert.ok(expected.length>0,'Fixture has real exact matches');assert.match(preferenceCards(n)[0].textContent,/Listing observed/);
});
