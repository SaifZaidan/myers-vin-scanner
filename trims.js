'use strict';
/* Pure matching helpers are also exercised by node's dependency-free tests. */
const GuideLogic = (() => {
 const norm=x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' ');
 function sameModel(v,m){return norm(v.make)===norm(m.make)&&(m.listing_model_names||[m.model]).some(name=>norm(v.model)===norm(name))&&String(v.year)===String(m.year);}
 function trimMatches(value,trim){const v=norm(value).replace(/^(?:awd|4wd|fwd|rwd)\s+/,''),t=norm(trim);return !!t&&(v===t||v.startsWith(t+' - ')||v.startsWith(t+' | '));}
 function matches(data,m,trim){return (data?.vehicles||[]).filter(v=>sameModel(v,m)&&(!trim||trimMatches(v.trim,trim)));}
 function stale(data,now=Date.now()){if(!data)return true;const due=Date.parse(data.next_refresh);return !!(data.stale||data.error||!Number.isFinite(due)||now>due+3600000);}
 function url(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
 function auditedFact(f){return !!(f&&f.verification?.status==='audited'&&f.verification?.model_year&&f.verification?.trim===f.trim_name&&typeof f.verification?.evidence_excerpt==='string'&&f.verification.evidence_excerpt.trim().length>=12&&url(f.verification?.evidence_url));}
 return {norm,sameModel,trimMatches,matches,stale,url,auditedFact};
})();
if(typeof module!=='undefined')module.exports=GuideLogic;
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id), el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 let models=[],inventory=null,inventoryDone=false;
 const factoryStatus={standard:'Standard',optional:'Optional',unavailable:'Unavailable',highlight:'Manufacturer highlight'};
 function link(text,url){const a=el('a',text);const safe=GuideLogic.url(url);if(safe){a.href=safe;a.target='_blank';a.rel='noopener noreferrer';}return a;}
 function cad(value){return Number.isFinite(value)&&value>0?new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(value):'Price not confirmed';}
 function stamp(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'date unavailable':date.toLocaleString('en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'})+' Toronto';}
 function stockLabel(list){if(!inventoryDone)return 'Checking listings…';if(!inventory)return 'Inventory unavailable';return list.length?`${list.length} saved ${list.length===1?'listing':'listings'}${GuideLogic.stale(inventory)?' · recheck availability':' · listed at Myers'}`:'No match in saved inventory';}
 function stockBadge(list){return el('span',stockLabel(list),'badge '+(list.length&&!GuideLogic.stale(inventory)?'present':'not_confirmed'));}
 function options(select,values,first){const prev=select.value;select.replaceChildren(new Option(first,''));for(const [value,label] of values)select.append(new Option(label,value));if(values.some(x=>x[0]===prev))select.value=prev;select.disabled=false;}
 function filteredModels(){return models.filter(m=>(!$('guide-make').value||m.make===$('guide-make').value)&&(!$('guide-year').value||String(m.year)===$('guide-year').value));}
 function refreshSelectors(){const make=$('guide-make').value;options($('guide-year'),[...new Set(models.filter(m=>!make||m.make===make).map(m=>String(m.year)))].sort().reverse().map(x=>[x,x]),'All guide years');options($('guide-model'),filteredModels().map(m=>[m.id,`${m.year} ${m.make} ${m.model}`]),'Choose a model');renderCatalog();}
 function selectModel(id,history=true){const m=models.find(x=>x.id===id);if(!m)return;options($('guide-make'),[...new Set(models.map(x=>x.make))].sort().map(x=>[x,x]),'All brands');$('guide-make').value=m.make;refreshSelectors();$('guide-year').value=String(m.year);refreshSelectors();$('guide-model').value=m.id;if(history)window.location.hash=encodeURIComponent(m.id);renderGuide(m);$('guide-output').hidden=false;$('model-catalog').hidden=true;if(history){$('guide-title').focus({preventScroll:true});$('guide-title').scrollIntoView?.({block:'start'});}}
 function renderCatalog(){const catalog=$('model-catalog');catalog.replaceChildren();for(const m of filteredModels()){const card=el('section',undefined,'model-card');card.append(el('span',`${m.year} · ${m.make}`,'eyebrow'),el('h3',m.model),stockBadge(GuideLogic.matches(inventory,m)),el('p',`${m.trims.length} trim grades · ${m.customer_audit||m.factory_reference?'Canadian manufacturer details':'research reference'}`,'hint'));const b=el('button','Compare trims');b.type='button';b.addEventListener('click',()=>selectModel(m.id));card.append(b);catalog.append(card);}catalog.hidden=false;}
 function section(title){const s=el('section',undefined,'guide-section');s.append(el('h3',title));return s;}
 function textItem(item){return typeof item==='string'?item:item.text||item.answer||item.description||item.value||'';}
 function sourcedText(item){const p=el('p','Research note (not customer-verified): '+textItem(item));if(item?.source_url){p.append(document.createTextNode(' '),link('Source ↗',item.source_url));}return p;}

 function renderCustomerTruckGuide(m,out){
  const audit=m.customer_audit;
  const banner=el('section',undefined,'truck-audit-banner');
  banner.append(el('h3','2026 Canadian manufacturer-checked trim comparison'),el('p',audit.note),el('p','Standard/optional means the manufacturer lists the feature for that trim. The factory trim guide is not an individual VIN build sheet. Check Myers stock and installed options before quoting.','guide-legend'));
  banner.append(el('p',audit.trims.reduce((n,t)=>n+t.features.length,0)+' manufacturer-linked claims · reviewed '+audit.date,'audit-meta'));out.append(banner);
  const overview=section('1. Trim overview — factory highlights'),cards=el('div',undefined,'trim-cards');
  for(const t of audit.trims){const c=el('div',undefined,'trim-card');c.append(el('span','MANUFACTURER TRIM REFERENCE','trim-kicker'),el('h4',t.name),stockBadge(GuideLogic.matches(inventory,m,t.name)));
   c.append(el('p',Number.isFinite(t.price)?cad(t.price)+' Canadian manufacturer starting price · not Myers selling price':'Price must be checked on stock listing','guide-price'));
   const ul=el('ul');for(const f of t.features.slice(0,6))ul.append(el('li',f.label+': '+f.value+(f.status==='optional'?' (optional)':'')));c.append(ul);cards.append(c);
  }overview.append(cards);out.append(overview);
  const comparison=section('2. Side-by-side feature comparison');
  comparison.append(el('p','✓ Manufacturer-listed standard · ◇ Manufacturer-listed optional · Not established means the source does not verify that trim/feature. It does NOT mean unavailable. Every ✓ and ◇ has a direct Canadian manufacturer link.','guide-legend'));
  const labels=[...new Set(audit.trims.flatMap(t=>t.features.map(f=>f.label)))];
  function category(x){const l=x.toLowerCase();if(/engine|transmission|drivetrain|drive mode|factory lift|dampers|differential|transfer case|skid|off-road|suspension|tyres|tire|trailering|hill descent|rock|tow|aev/.test(l))return 'Engine, towing & off-road';if(/seat|interior|steering wheel|lumbar|massage|charging/.test(l))return 'Seats & comfort';if(/screen|display|audio|carplay|android|camera|cruise|safety|hud|head-up/.test(l))return 'Technology & safety';return 'Exterior & convenience';}
  const wrap=el('div',undefined,'guide-matrix');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Canadian factory-trim sourced features');const table=el('table',undefined,'trim-comparison'),thead=el('thead'),hr=el('tr');hr.append(el('th','Feature'));for(const t of audit.trims)hr.append(el('th',t.name));thead.append(hr);table.append(thead);const body=el('tbody');
  for(const group of ['Engine, towing & off-road','Seats & comfort','Technology & safety','Exterior & convenience']){const names=labels.filter(l=>category(l)===group);if(!names.length)continue;const gr=el('tr',undefined,'group-row'),gh=el('th',group);gh.colSpan=audit.trims.length+1;gr.append(gh);body.append(gr);
   for(const name of names){const line=el('tr'),th=el('th',name);th.scope='row';line.append(th);
    for(const t of audit.trims){const td=el('td'),f=t.features.find(x=>x.label===name);if(f){const mark=el('span',f.status==='optional'?'◇':'✓','feature-mark '+f.status);td.append(mark,el('span',f.value,'feature-value'),link('Official source',f.source_url));}else td.append(el('span','Not established','feature-value muted'));line.append(td);}body.append(line);
   }
  }table.append(body);wrap.append(table);comparison.append(wrap);out.append(comparison);
  const details=section('3. Exact manufacturer statements by trim'),panels=el('div',undefined,'verified-trim-grid');
  for(const t of audit.trims){const d=el('details',undefined,'verified-trim-panel');d.append(el('summary',t.name+' · '+t.features.length+' manufacturer-referenced features'));const dl=el('dl',undefined,'verified-feature-list');
   for(const f of t.features){dl.append(el('dt',f.label));const dd=el('dd');dd.append(el('span',f.status==='optional'?'Optional':'Standard','verified-status '+f.status),document.createTextNode(' '+f.value+' · '),link('Check GMC/Chevrolet Canada',f.source_url));dl.append(dd);}d.append(dl);panels.append(d);
  }details.append(panels);out.append(details);
  const stock=section('4. Matching Myers 1200 Baseline stock — confirm VIN'),vehicles=GuideLogic.matches(inventory,m),stockCards=el('div',undefined,'guide-stock-cards');
  stock.append(el('p',stockLabel(vehicles)+'. These saved listings are not real-time availability or a build-sheet guarantee.','guide-stock'));
  for(const v of vehicles){const card=el('div',undefined,'guide-stock-card');card.append(el('h4',v.year+' '+v.make+' '+v.model+' '+(v.trim||'')),el('p','Stock '+v.stock+' · '+cad(v.price)),el('p','Observed '+stamp(v.observed_at)),link('Exact Myers listing',v.source_url));const a=el('a','Inspect recorded VIN features →');a.href='index.html?stock='+encodeURIComponent(v.stock)+'#lookup';card.append(a);stockCards.append(card);}stock.append(stockCards);out.append(stock);
 }

 function renderGuide(m){const out=$('guide-output');out.replaceChildren();const heading=el('div',undefined,'guide-heading');heading.id='guide-title';heading.tabIndex=-1;heading.append(el('p',`${m.year} · CANADIAN MODEL GUIDE`,'eyebrow'),el('h2',`${m.make} ${m.model}`));const back=el('button','← All models','secondary-button');back.type='button';back.addEventListener('click',()=>{$('guide-make').value='';$('guide-year').value='';$('guide-model').value='';refreshSelectors();window.location.hash='';out.hidden=true;renderCatalog();$('guide-make').focus();});heading.append(back);out.append(heading);
 const reference=m.factory_reference;
 const reviewed=reference?.checked_at||m.customer_audit?.date;
 const provenance=el('p',reviewed?`Canadian manufacturer sources reviewed ${reviewed}. `:'Manufacturer trim details are still being checked. ','guide-source');
 provenance.append(link('Manufacturer model page ↗',m.source_url));
 out.append(provenance,el('p','Factory equipment varies by configuration. Use the Myers listing and factory build sheet to confirm the equipment on a specific VIN.','notice'));

 if(m.customer_audit){renderCustomerTruckGuide(m,out);return;}

 if(!m.trims.length){
  const special=section('Model overview — no comparable factory trims');
  special.append(el('p','This model does not have independently verified Canadian trim grades in this guide. A side-by-side trim matrix would be misleading. Choose a specific vehicle from the saved Myers listings, then confirm its factory equipment and packages.','notice'));
  if(m.source_url)special.append(link('View manufacturer specifications ↗',m.source_url));
  const vehicles=GuideLogic.matches(inventory,m);
  const stockSection=section('Matching Myers Baseline listings');
  stockSection.append(el('p',stockLabel(vehicles)+'. Availability, pricing and individual equipment must be confirmed.','guide-stock'));
  for(const v of vehicles){const c=el('div',undefined,'guide-stock-card');c.append(el('h4',(v.year+' '+v.make+' '+v.model+' '+(v.trim||'')).trim()),el('p','Stock '+v.stock+' · '+cad(v.price)),link('Official vehicle listing ↗',v.source_url));stockSection.append(c);}
  out.append(special,stockSection);return;
 }

 const factoryTrims=new Map((reference?.trims||[]).map(t=>[t.name,t]));
 const factoryFeatures=t=>factoryTrims.get(t.name)?.features||[];
 const featureSource=t=>factoryTrims.get(t.name)?.source_url;
 const overview=section('1. Trim overview — what makes each trim different?'),cards=el('div',undefined,'trim-cards');for(const t of m.trims){const c=el('div',undefined,'trim-card');c.append(el('span',m.trims.indexOf(t)===0?'ESSENTIALS':m.trims.indexOf(t)===m.trims.length-1?'TOP TRIM':'STYLE & FEATURES','trim-kicker'),el('h4',t.name),stockBadge(GuideLogic.matches(inventory,m,t.name)),el('p',t.positioning||'Review the sourced features below.'),el('p','Manufacturer starting price not independently audited. See exact Myers listing for advertised price.','guide-price'));const ul=el('ul');
 const facts=factoryFeatures(t);
 const standout=facts.filter(f=>m.trims.some(other=>other!==t&&!factoryFeatures(other).some(x=>x.label===f.label&&x.value===f.value&&x.status===f.status)));
 for(const f of [...standout,...facts.filter(f=>!standout.includes(f))].slice(0,5))ul.append(el('li',f.label+': '+f.value+(f.status==='optional'?' (optional)':'')));
 if(!facts.length)c.append(el('p','Manufacturer details are still being checked for this trim.','trim-warning'));
 else c.append(ul,link('Manufacturer trim source ↗',featureSource(t)));
 cards.append(c);}overview.append(cards);out.append(overview);


 const comparison=section('2. Side-by-side feature comparison');
 comparison.append(el('p','✓ Standard · ◇ Optional · • Manufacturer highlight with fitment unspecified · — Explicitly unavailable. Blank source coverage is shown as “Check order guide”.','guide-legend'));
 const labels=[...new Set(m.trims.flatMap(t=>factoryFeatures(t).map(f=>f.label)))];
 const knownCount=m.trims.reduce((sum,t)=>sum+factoryFeatures(t).length,0);
 if(knownCount)comparison.append(el('p',knownCount+' manufacturer-sourced details across '+factoryTrims.size+' trims.','coverage-note'));
 function category(label){const l=label.toLowerCase();if(/engine|transmission|awd|drivetrain|suspension|powertrain|fuel|towing|differential|drive modes|torque|battery/.test(l))return 'Engine & driving';if(/seat|upholstery|steering wheel|memory|massage|climate|lumbar|interior|pedal/.test(l))return 'Seats & comfort';if(/wheel|grille|exterior|roof|liftgate|rail|tailgate|tyres/.test(l))return 'Exterior & convenience';if(/display|audio|bose|head.up|charging|carplay|android|google|camera|mirror|cruise|remote|noise|safety|touchscreen/.test(l))return 'Technology & safety';return 'Other equipment';}
 if(labels.length){
  const controls=el('div',undefined,'compare-controls'),toggle=el('button','Show complete rows only','secondary-button compare-toggle');toggle.type='button';
  const count=el('span','Trim-specific equipment highlights','compare-count');controls.append(toggle,count);comparison.append(controls);
  const wrap=el('div',undefined,'guide-matrix');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Documented trim features, incomplete where sources do not specify');
  const table=el('table',undefined,'trim-comparison'),thead=el('thead'),head=el('tr');head.append(el('th','Feature'));for(const t of m.trims)head.append(el('th',t.name));thead.append(head);table.append(thead);
  const body=el('tbody');
  for(const group of ['Engine & driving','Seats & comfort','Technology & safety','Exterior & convenience','Other equipment']){
   const groupLabels=labels.filter(label=>category(label)===group);if(!groupLabels.length)continue;
   const groupRow=el('tr',undefined,'group-row'),groupHead=el('th',group);groupHead.colSpan=m.trims.length+1;groupRow.append(groupHead);body.append(groupRow);
   for(const label of groupLabels){const tr=el('tr'),th=el('th',label);th.scope='row';tr.append(th);
    for(const t of m.trims){const f=factoryFeatures(t).find(f=>f.label===label),td=el('td');
     if(!f){td.append(el('span','Check order guide','feature-value muted'));}
     else{const symbol={standard:'✓',optional:'◇',unavailable:'—',highlight:'•'}[f.status];
      const mark=el('span',symbol,'feature-mark '+f.status);mark.title=factoryStatus[f.status];mark.setAttribute('aria-label',factoryStatus[f.status]);td.append(mark);
      td.append(el('span',f.value,'feature-value'),link('Source',featureSource(t)));
     }tr.append(td);
    }body.append(tr);
   }
  }
  table.append(body);wrap.append(table);comparison.append(wrap);
  let completeOnly=false;
  function updateRows(){let visible=0;for(const row of body.querySelectorAll('tr:not(.group-row)')){const cells=[...row.querySelectorAll('td')];const complete=cells.every(cell=>!!cell.querySelector('.feature-mark'));row.hidden=completeOnly&&!complete;if(!row.hidden)visible++;}
   for(const group of body.querySelectorAll('.group-row')){let next=group.nextElementSibling,seen=false;while(next&&!next.classList.contains('group-row')){if(!next.hidden)seen=true;next=next.nextElementSibling;}group.hidden=!seen;}
   toggle.textContent=completeOnly?'Show all sourced rows':'Show complete rows only';count.textContent=completeOnly?visible+' fully documented rows':labels.length+' sourced rows';
  }
  toggle.addEventListener('click',()=>{completeOnly=!completeOnly;updateRows();});
 }else comparison.append(el('p','The available sources do not establish trim-specific contrasts for this model. Review the individual equipment listings below and confirm the VIN.','notice'));
 const summary=el('div',undefined,'model-quick-compare');
 summary.append(el('h4','Manufacturer highlights by trim'));
 const mini=el('div',undefined,'guide-matrix');mini.tabIndex=0;mini.setAttribute('role','region');mini.setAttribute('aria-label','Sourced highlights for every trim');
 const miniTable=el('table',undefined,'trim-snapshot'),mh=el('thead'),mhr=el('tr');
 for(const h of ['Trim','Powertrain / drive','Cabin & comfort','Technology & safety','Style & capability'])mhr.append(el('th',h));mh.append(mhr);miniTable.append(mh);
 const mb=el('tbody');
 const bucket=l=>{const c=category(l);return c==='Engine & driving'?0:c==='Seats & comfort'?1:c==='Technology & safety'?2:3;};
 for(const t of m.trims){const tr=el('tr');tr.append(el('th',t.name));const buckets=[[],[],[],[]];for(const f of factoryFeatures(t)){if(f.status==='unavailable')continue;const k=bucket(f.label);buckets[k].push(f);}
 for(const facts of buckets){const td=el('td');if(!facts.length)td.append(el('span','Check VIN / order guide','snapshot-empty'));else{const ul=el('ul',undefined,'snapshot-points');const standout=facts.filter(f=>m.trims.some(other=>other!==t&&!factoryFeatures(other).some(x=>x.label===f.label&&x.value===f.value&&x.status===f.status)));const others=facts.filter(f=>!standout.includes(f));for(const f of [...standout,...others].slice(0,4)){const li=el('li');li.append(el('strong',f.label+': '),document.createTextNode(f.value));if(f.status==='optional')li.append(el('span',' (optional)','snapshot-optional'));ul.append(li);}td.append(ul);}tr.append(td);}mb.append(tr);}
 miniTable.append(mb);mini.append(miniTable);summary.append(mini);comparison.append(summary);
 out.append(comparison);

 const highlights=section('Trim-by-trim research notes — NOT verified for a customer');
 highlights.append(el('p','Legacy research is retained for investigation only. None of these rows should be presented to a customer as confirmed equipment until validated against an exact model-year factory order guide or VIN build sheet.','guide-legend'));
 const details=el('div',undefined,'verified-trim-grid');
 for(const t of m.trims){const panel=el('details',undefined,'verified-trim-panel');const summary=el('summary',t.name+' · '+(t.features||[]).length+' research claims (not audited)');panel.append(summary);
 const items=(t.features||[]);if(!items.length)panel.append(el('p','Detailed trim equipment has not been independently verified.'));
 else{const dl=el('dl',undefined,'verified-feature-list');for(const f of items){const dt=el('dt',f.label),dd=el('dd');dd.append(el('span','Unverified claim','verified-status unknown'),document.createTextNode(' '+(f.value||'')));if(f.source_url)dd.append(document.createTextNode(' · '),link('Research link (check claim)',f.source_url));dl.append(dt,dd);}panel.append(dl);}details.append(panel);}
 highlights.append(details);out.append(highlights);


 for(const [title,key,empty] of [['3. What changes between trims','upgrade_notes','Upgrade explanations are not yet verified. Compare the sourced rows above; trim order alone does not establish an upgrade.'],['5. Which trim suits your customer?','buyer_notes','Start with the customer’s required equipment, then check exact vehicle options.'],['6. Sales-floor recap','sales_notes','Confirm year, trim, installed packages and current availability before quoting equipment.']]){const s=section(title);if(m[key]?.length){const notes=el('div',undefined,key==='upgrade_notes'?'upgrade-grid':'notes-grid');for(const n of m[key]){const card=el('div',undefined,'note-card');card.append(sourcedText(n));notes.append(card);}s.append(notes);}else s.append(el('p',empty));out.append(s);}
 const faq=section('4. Common customer questions (historical research, not audited)'),dl=el('dl',undefined,'guide-faq');for(const q of m.faq||[]){dl.append(el('dt',q.question||q.q||''));const dd=el('dd',q.answer||q.a||'Not confirmed');if(q.source_url)dd.append(document.createTextNode(' '),link('Source ↗',q.source_url));dl.append(dd);}if(!(m.faq||[]).length){dl.append(el('dt','Does the trim guide confirm the equipment on a vehicle?'),el('dd','No. Check the exact VIN/stock listing and installed options. Optional equipment and production changes can differ.'));}faq.append(dl);out.insertBefore(faq,[...out.children].find(x=>x.querySelector('h3')?.textContent.startsWith('5.')));
 const stock=section('Matching Myers Baseline listings — exact VIN evidence'),vehicles=GuideLogic.matches(inventory,m);stock.append(el('p',stockLabel(vehicles)+'. Prices are advertised CAD amounts; confirm fees, equipment and availability.','guide-stock'));const stockCards=el('div',undefined,'guide-stock-cards');for(const v of vehicles){
 const c=el('div',undefined,'guide-stock-card');c.append(el('h4',`${v.year} ${v.make} ${v.model} ${v.trim||''}`),el('p',`${v.condition?.sale_class||'Condition not confirmed'} · Stock ${v.stock} · ${cad(v.price)}`),el('p',`Listing captured ${stamp(v.observed_at)}; this is not a live inventory check.`));
 const knownFeatures=Object.entries(v.features||{}).filter(([name,feat])=>feat?.status==='present').slice(0,18);
 const info=el('details',undefined,'stock-evidence');info.append(el('summary','View '+knownFeatures.length+' explicitly listed features'));
 const list=el('ul');
 for(const [key,feat] of knownFeatures){const row=el('li',key.replace(/_/g,' ')+' — '+(['manufacturer_package','dealer_package'].includes(feat.evidence_type)?'Documented installed-package evidence':'Stated on listing'));list.append(row);}if(!knownFeatures.length)list.append(el('li','No explicit feature assertions in the saved snapshot.'));
 info.append(list);c.append(info);
 c.append(link('Open exact Myers listing to confirm ↗',v.source_url));
 const a=el('a','View saved VIN/stock evidence →');a.href='index.html?stock='+encodeURIComponent(v.stock)+'#lookup';c.append(a);stockCards.append(c);
 }stock.append(el('p','Only features explicitly present in Myers saved listing data are shown. A feature not listed is unknown, not absent. Confirm packages against the factory build sheet and physically inspect the vehicle before sale.','guide-legend'),stockCards);out.append(stock);
 }
 $('guide-make').addEventListener('change',()=>{refreshSelectors();$('guide-output').hidden=true;window.location.hash='';});$('guide-year').addEventListener('change',()=>{refreshSelectors();$('guide-output').hidden=true;window.location.hash='';});$('guide-model').addEventListener('change',()=>{if($('guide-model').value)selectModel($('guide-model').value);});
 function route(){if(!models.length)return;let id;try{id=decodeURIComponent(window.location.hash.slice(1));}catch{id='';}if(models.some(x=>x.id===id))selectModel(id,false);else{$('guide-output').hidden=true;renderCatalog();}}
 window.addEventListener('hashchange',route);
 Promise.all(['data/guide-buick-cadillac.json','data/guide-chevrolet-gmc.json','data/customer-truck-audit-2026.json','data/guide-factory-reference.json'].map(async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Guide data unavailable');const data=await r.json();if(!Array.isArray(data.models))throw new Error('Guide format invalid');return data.models;})).then(groups=>{const factory=groups.pop(),verified=groups.pop();models=groups.flat().sort((a,b)=>a.make.localeCompare(b.make)||a.model.localeCompare(b.model)||b.year-a.year);for(const v of verified){const target=models.find(m=>m.id===v.id);if(target)target.customer_audit=v;}for(const v of factory){const target=models.find(m=>m.id===v.id);if(target)target.factory_reference=v;}options($('guide-make'),[...new Set(models.map(m=>m.make))].sort().map(x=>[x,x]),'All brands');refreshSelectors();$('guide-status').textContent=`${models.length} model-year guides · ${verified.length+factory.length} with Canadian manufacturer trim details`;route();}).catch(()=>{$('guide-status').textContent='Could not load model guides. Reload this page or use vehicle lookup; no trim facts have been assumed.';});
 (async()=>{try{const r=await fetch('data/inventory.json.gz',{cache:'no-store'});if(!r.ok)throw new Error();let b=new Uint8Array(await r.arrayBuffer());if(b[0]===31&&b[1]===139){if(typeof DecompressionStream==='undefined')throw new Error();b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}const data=JSON.parse(new TextDecoder().decode(b));if(!Array.isArray(data.vehicles))throw new Error();inventory=data;$('inventory-status').textContent=`${GuideLogic.stale(data)?'Saved inventory is out of date or incomplete.':'Saved inventory, not real-time availability.'} Last refresh attempt: ${stamp(data.last_attempt)}. Stock highlights require confirmation with Myers.`;}catch{$('inventory-status').textContent='Saved inventory unavailable. Model guides still work, but no stock availability can be confirmed.';}finally{inventoryDone=true;if(models.length)route();}})();
}
