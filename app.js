'use strict';
const $ = id => document.getElementById(id);
const featureLabels = {
  heated_front_seats: 'Heated front seats', heated_rear_seats: 'Heated rear seats',
  ventilated_seats: 'Ventilated seats', heated_steering_wheel: 'Heated steering wheel',
  apple_carplay: 'Apple CarPlay', android_auto: 'Android Auto', remote_start: 'Remote start',
  adaptive_cruise: 'Adaptive cruise control', blind_spot: 'Blind-spot monitoring',
  sunroof: 'Sunroof', awd: 'All-wheel drive', wireless_charging: 'Wireless charging'
};
let inventory = null;
const comparison = {a:null, b:null};
let inventoryLoading = true;
const normalize = value => String(value ?? '').trim().toUpperCase();
const node = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
function date(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Not yet available';
  return new Intl.DateTimeFormat('en-CA', {timeZone:'America/Toronto', month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['www.myerscadillacgm.ca', 'myerscadillacgm.ca'].includes(url.hostname) ? url.href : null; } catch { return null; }
}
function readable(value) {
  if (Array.isArray(value)) return value.map(readable).join(' · ');
  if (value && typeof value === 'object') return Object.entries(value).map(([k,v]) => `${k}: ${readable(v)}`).join(' · ');
  return String(value ?? 'Not confirmed');
}
function appendSourceLinks(parent, sources) {
  for(const source of Array.isArray(sources) ? sources : []) {
    try {
      const url=new URL(source.url);
      if(url.protocol!=='https:') continue;
      const link=node('a','evidence-source',source.title || url.hostname);
      link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';parent.append(link);
    } catch { /* Ignore malformed source URLs. */ }
  }
}
function priceText(vehicle) {
  return typeof vehicle.price==='number' ? new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(vehicle.price) : vehicle.price ? readable(vehicle.price) : 'Not confirmed';
}
function paintText(vehicle) {
  const paint=vehicle.paint || {};
  return paint.status==='listed_name' && paint.name ? readable(paint.name) : paint.status==='conflict' ? 'Needs verification · conflicting paint details' : `Not confirmed${paint.generic_color ? ` · general colour: ${readable(paint.generic_color)}` : ''}`;
}
function engineText(vehicle) {
  const engine=vehicle.engine_details || {};
  return engine.status==='conflict' ? 'Needs verification · conflicting engine details' : engine.status==='listed' && engine.summary ? readable(engine.summary) : 'Not confirmed';
}
function horsepowerText(vehicle) {
  const engine=vehicle.engine_details || {};
  return engine.status==='conflict' ? 'Needs verification' : engine.status==='listed' && engine.horsepower ? readable(engine.horsepower) : 'Not confirmed';
}
function vehicleTitle(vehicle) { return vehicle.title || [vehicle.year,vehicle.make,vehicle.model,vehicle.trim].filter(Boolean).join(' ') || 'Vehicle listing'; }
function conditionText(vehicle) {
  const value = normalize(vehicle.sale_class ?? vehicle.specs?.['Sale Class']);
  return value === 'NEW' ? 'New' : value === 'USED' ? 'Used' : 'Not provided';
}
function isDemo(vehicle) { return vehicle.demo_status === 'listed_demo'; }
function odometerText(vehicle) {
  const mileage = vehicle.mileage;
  if(mileage) {
    if(typeof mileage.value !== 'number' || !Number.isFinite(mileage.value) || mileage.value < 0 || mileage.status === 'not_confirmed') return 'Not provided';
    const value = new Intl.NumberFormat('en-CA').format(mileage.value);
    return mileage.status === 'listed' && ['km','mi'].includes(mileage.unit) ? `${value} ${mileage.unit}` : `${value} · unit not confirmed`;
  }
  const text = String(vehicle.specs?.Odometer ?? '').trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:\s*km)?$/i.test(text)) return 'Not provided';
  const value = Number(text.replace(/,/g,'').replace(/\s*km$/i,''));
  return Number.isFinite(value) ? `${new Intl.NumberFormat('en-CA').format(value)}${/km$/i.test(text) ? ' km' : ' · unit not confirmed'}` : 'Not provided';
}
function seatingText(vehicle, field) {
  const seating = vehicle.seating;
  if(seating?.status === 'conflict') return 'Needs verification · conflicting seating details';
  if(seating?.status !== 'listed') return 'Not confirmed';
  if(field === 'capacity') return Number.isInteger(seating.capacity) && seating.capacity > 0 ? `${seating.capacity} seats` : 'Not confirmed';
  return seating[field] || 'Not confirmed';
}
function featureText(vehicle,key) {
  const feature=vehicle.features?.[key];
  if(feature?.status==='absent') return 'Explicitly absent';
  if(feature?.status!=='present') return 'Not confirmed';
  return ['manufacturer_package','dealer_package'].includes(feature.evidence_type) ? 'Package verified' : 'Listed';
}
function sameVehicle(a,b) {
  return a===b || Boolean(a && b && ((a.vin && normalize(a.vin)===normalize(b.vin)) || (a.stock && normalize(a.stock)===normalize(b.stock))));
}
function selectComparison(slot,vehicle) {
  const other=slot==='a' ? 'b' : 'a';
  if(sameVehicle(vehicle,comparison[other])) {
    $('compare-status').textContent=`That vehicle is already selected as ${other.toUpperCase()}. Choose a different vehicle for ${slot.toUpperCase()}.`;
    return;
  }
  comparison[slot]=vehicle;
  $(`compare-${slot}`).value=vehicle.stock || vehicle.vin || '';
  renderComparison();
}
function renderComparison() {
  for(const slot of ['a','b']) {
    const vehicle=comparison[slot];
    $(`selected-${slot}`).textContent=vehicle ? `${vehicleTitle(vehicle)} · Stock ${vehicle.stock || 'not confirmed'}` : 'No vehicle selected';
    $(`remove-${slot}`).hidden=!vehicle;
  }
  const ready=Boolean(comparison.a && comparison.b);
  $('compare-output').hidden=!ready;
  $('comparison-table').replaceChildren();
  $('clear-comparison').disabled=!comparison.a && !comparison.b;
  $('compare-status').textContent=ready ? 'Two vehicles selected. Review their details side by side below.' : comparison.a || comparison.b ? `Choose vehicle ${comparison.a ? 'B' : 'A'} to complete your comparison.` : 'Choose two different vehicles to begin. Exact VIN and stock matches only.';
  if(!ready) return;
  const a=comparison.a,b=comparison.b;
  const table=node('table','comparison-table');
  const caption=node('caption','sr-only','Exact listing comparison: vehicle A and vehicle B');table.append(caption);
  const head=node('thead');const headRow=node('tr');headRow.append(node('th','','Vehicle'));
  for(const [slot,vehicle] of [['A',a],['B',b]]) { const cell=node('th');cell.scope='col';cell.append(node('span','comparison-letter',slot),node('strong','',vehicleTitle(vehicle)),node('small','',`Stock ${vehicle.stock || 'Not confirmed'}`),node('small','',`VIN ${vehicle.vin || 'Not confirmed'}`));headRow.append(cell); }
  head.append(headRow);table.append(head);
  const body=node('tbody');let shown=0;
  const labels={...featureLabels};
  for(const v of [a,b]) for(const [key,f] of Object.entries(v.features || {})) labels[key]=f.label || labels[key] || key.replaceAll('_',' ');
  const rows=[['New / Used',conditionText(a),conditionText(b)],['Demo designation',isDemo(a) ? 'Demo' : 'Not confirmed',isDemo(b) ? 'Demo' : 'Not confirmed'],['Odometer',odometerText(a),odometerText(b)],['Seating capacity',seatingText(a,'capacity'),seatingText(b,'capacity')],['Seating layout',seatingText(a,'layout'),seatingText(b,'layout')],['Second-row seats',seatingText(a,'second_row'),seatingText(b,'second_row')],['Advertised price (CAD)',priceText(a),priceText(b)],['Listed trim',a.trim || 'Not confirmed',b.trim || 'Not confirmed'],['Official exterior paint',paintText(a),paintText(b)],['Exact engine',engineText(a),engineText(b)],['Horsepower',horsepowerText(a),horsepowerText(b)],...Object.entries(labels).map(([key,label])=>[label,featureText(a,key),featureText(b,key)])];
  for(const [label,av,bv] of rows) {
    // Provenance differences alone are not equipment differences.
    const equal=av===bv || (['Listed','Package verified'].includes(av) && ['Listed','Package verified'].includes(bv));
    if($('differences-only').checked && equal) continue;
    const row=node('tr',!equal ? 'different' : '');const heading=node('th','',label);heading.scope='row';row.append(heading);
    for(const value of [av,bv]) row.append(node('td',/Not confirmed|Needs verification/.test(value) ? 'unknown' : '',value));
    body.append(row);shown++;
  }
  if(!shown) { const row=node('tr');const cell=node('td','comparison-empty','No differences in the recorded comparison fields. Unconfirmed equipment still needs verification.');cell.colSpan=3;row.append(cell);body.append(row); }
  const freshness=node('tr');const heading=node('th','','Listing last observed');heading.scope='row';freshness.append(heading,node('td','',date(a.observed_at)),node('td','',date(b.observed_at)));body.append(freshness);
  table.append(body);$('comparison-table').append(table);
}
function initializeComparison() {
  $('query').disabled=false;
  $('search-form').querySelector('button[type="submit"]').disabled=false;
  const options=[];
  for(const vehicle of inventory.vehicles) for(const value of [vehicle.stock,vehicle.vin].filter(Boolean)) {
    const option=node('option');option.value=value;option.label=vehicleTitle(vehicle);options.push(option);
  }
  $('vehicle-options').replaceChildren(...options);
  for(const slot of ['a','b']) {
    $(`compare-${slot}`).disabled=false;
    $(`compare-form-${slot}`).querySelector('button[type="submit"]').disabled=false;
  }
  renderComparison();
}
for(const slot of ['a','b']) {
  $(`compare-form-${slot}`).addEventListener('submit',event=>{
    event.preventDefault();
    if(!inventory) return;
    const query=normalize($(`compare-${slot}`).value);
    if(!query) { $('compare-status').textContent=`Enter a VIN or stock number for vehicle ${slot.toUpperCase()}.`;return; }
    const matches=inventory.vehicles.filter(v=>normalize(v.stock)===query || normalize(v.vin)===query);
    if(matches.length!==1) { $('compare-status').textContent=matches.length ? 'More than one saved record has that identity. Verify the VIN before comparing.' : 'No exact match. Check the full VIN or stock number; your existing selection has not changed.';return; }
    selectComparison(slot,matches[0]);
  });
  $(`remove-${slot}`).addEventListener('click',()=>{comparison[slot]=null;$(`compare-${slot}`).value='';renderComparison();$(`compare-${slot}`).focus();});
}
$('differences-only').addEventListener('change',renderComparison);
$('clear-comparison').addEventListener('click',()=>{comparison.a=null;comparison.b=null;for(const slot of ['a','b']) $(`compare-${slot}`).value='';$('differences-only').checked=false;renderComparison();$('compare-a').focus();});

function vehicleCard(vehicle) {
  const card = node('article','vehicle');
  const header = node('div','vehicle-header');
  const identity = node('div');
  identity.append(node('p','eyebrow','EXACT MYERS LISTING'));
  const fallback = [vehicle.year,vehicle.make,vehicle.model].filter(Boolean).join(' ');
  identity.append(node('h3','',vehicle.title || fallback || 'Vehicle listing'));
  const badges = node('div','vehicle-designations');
  badges.append(node('span','badge condition',conditionText(vehicle) === 'Not provided' ? 'New / Used: Not provided' : conditionText(vehicle)));
  if(isDemo(vehicle)) badges.append(node('span','badge demo','Demo'));
  identity.append(badges);
  const ids = node('div','identifiers');
  for (const [label,value] of [['Stock',vehicle.stock],['VIN',vehicle.vin],['Listed trim',vehicle.trim]]) {
    const item = node('span','',`${label} `); item.append(node('b','',value || 'Not confirmed')); ids.append(item);
  }
  identity.append(ids);
  const paint=vehicle.paint || {};
  const engine=vehicle.engine_details || {};
  const facts=node('dl','quick-facts');
  for(const [label,value] of [['Advertised price',priceText(vehicle)],['Official exterior paint',paintText(vehicle)],['Exact engine',engineText(vehicle)],['Horsepower',horsepowerText(vehicle)]]) {
    const pair=node('div');pair.append(node('dt','',label),node('dd','',value));facts.append(pair);
  }
  if(conditionText(vehicle) === 'Used' || isDemo(vehicle)) {
    const mileage = node('div','odometer-fact');
    mileage.append(node('dt','','Odometer'),node('dd','',odometerText(vehicle)));facts.append(mileage);
  }
  identity.append(facts);
  header.append(identity);
  const source = safeSource(vehicle.source_url);
  if (source) { const link = node('a','source-link','View Myers listing ↗'); link.href=source;link.target='_blank';link.rel='noopener noreferrer';header.append(link); }
  card.append(header);
  const compareActions=node('div','card-actions');
  for(const slot of ['a','b']) {
    const button=node('button','secondary-button',`Compare as ${slot.toUpperCase()}`);button.type='button';
    button.addEventListener('click',()=>{selectComparison(slot,vehicle);$('compare-heading').setAttribute('tabindex','-1');$('compare-heading').focus();$('compare-heading').scrollIntoView({block:'start'});});compareActions.append(button);
  }
  card.append(compareActions);
  const section = node('section','feature-section');
  section.append(node('h4','section-label','Feature checklist'));
  const grid = node('div','feature-grid');
  const labels = {...featureLabels};
  for (const [key,value] of Object.entries(vehicle.features || {})) labels[key]=value.label || labels[key] || key.replaceAll('_',' ');
  for (const [key,label] of Object.entries(labels)) {
    const feature = vehicle.features?.[key] || {};
    const status = ['present','absent'].includes(feature.status) ? feature.status : 'not_confirmed';
    const row = node('div','feature');
    const packageVerified = status === 'present' && ['manufacturer_package','dealer_package'].includes(feature.evidence_type);
    row.append(node('span','',label),node('span',`badge ${packageVerified ? 'package_verified' : status}`,packageVerified ? 'Package verified' : {present:'Listed',absent:'Explicitly absent',not_confirmed:'Not confirmed'}[status]));
    const evidence = Array.isArray(feature.evidence) ? feature.evidence.map(readable).join(' | ') : readable(feature.evidence || '');
    if(evidence) row.title=evidence;
    grid.append(row);
  }
  section.append(grid); card.append(section);
  const details = node('details','details');
  details.append(node('summary','','More details · specifications & source evidence'));
  const seatingPanel = node('section','seating-details');
  seatingPanel.append(node('h4','section-label','Seating'));
  const seatingFacts = node('dl','quick-facts');
  for(const [label,field] of [['Seating capacity','capacity'],['Seating layout','layout'],['Second-row seats','second_row']]) {
    const pair=node('div');pair.append(node('dt','',label),node('dd','',seatingText(vehicle,field)));seatingFacts.append(pair);
  }
  seatingPanel.append(seatingFacts);
  if(vehicle.seating?.note) seatingPanel.append(node('p','hint',vehicle.seating.note));
  if(vehicle.seating?.evidence?.length) seatingPanel.append(node('p','hint',readable(vehicle.seating.evidence)));
  appendSourceLinks(seatingPanel,vehicle.seating?.sources);
  details.append(seatingPanel);
  const secondary=node('dl','specs');
  for(const [key,label] of [['displacement','Displacement'],['cylinders','Cylinders'],['configuration','Engine configuration'],['turbo','Turbo'],['fuel','Engine fuel'],['hp_rpm','Horsepower RPM']]) {
    const pair=node('div','spec');pair.append(node('dt','',label),node('dd','',engine.status==='conflict' ? 'Needs verification' : engine[key]===true ? 'Listed' : engine[key]===false ? 'Explicitly not equipped' : readable(engine[key])));secondary.append(pair);
  }
  details.append(secondary,node('h4','section-label','Engine evidence'));
  if(Array.isArray(engine.evidence) && engine.evidence.length) {
    const engineEvidence=node('ul','packages');engine.evidence.forEach(value=>engineEvidence.append(node('li','',readable(value))));details.append(engineEvidence);
  } else details.append(node('p','paint-evidence','No explicit engine evidence recorded. Displacement, cylinder count, configuration, turbo, fuel and horsepower are not inferred from model or trim.'));
  details.append(node('h4','section-label','Paint evidence'));
  if(paint.evidence && (!Array.isArray(paint.evidence) || paint.evidence.length)) details.append(node('p','paint-evidence',readable(paint.evidence)));
  else details.append(node('p','paint-evidence','No explicit paint-name evidence recorded. A general colour is not a verified official paint name.'));
  if(paint.status==='conflict') details.append(node('p','package-reason','Paint sources conflict. Confirm the exact paint name against this VIN before relying on it.'));
  const paintSource=safeSource(paint.source_url);
  if(paintSource) appendSourceLinks(details,[{title:'Paint listing source ↗',url:paintSource}]);

  const specs = Object.entries(vehicle.specs || {});
  if(specs.length) { const dl=node('dl','specs'); for(const [key,value] of specs){const pair=node('div','spec');pair.append(node('dt','',key.replaceAll('_',' ')),node('dd','',readable(value)));dl.append(pair);} details.append(dl); }
  else details.append(node('p','hint','No structured specifications have been confirmed from this listing.'));
  const packagePanel=node('section','package-panel');
  packagePanel.append(node('h4','section-label','Packages & their contents'));
  const audit=vehicle.package_audit;
  if(audit) {
    const review=audit.status!=='complete' || Number(audit.unresolved)>0 || Number(audit.partial)>0;
    packagePanel.append(node('p',`package-audit ${review ? 'needs-review' : ''}`,`${audit.total ?? 0} packages recorded · ${audit.expanded ?? 0} expanded · ${audit.partial ?? 0} partial · ${audit.unresolved ?? 0} unresolved. ${review ? 'Package contents need review.' : 'Recorded package-content audit complete.'}`));
  }
  const packageContents=Array.isArray(vehicle.package_contents) ? vehicle.package_contents : [];
  if(packageContents.length) {
    const statusLabels={verified_listing:'Contents verified on listing',verified_manufacturer:'Contents verified · manufacturer',verified_dealer:'Contents verified · dealer factory options',partial:'Some contents verified',unresolved:'Contents not yet verified'};
    for(const pkg of packageContents) {
      const box=node('details','package-content');
      const summary=node('summary');summary.append(node('span','package-name',pkg.name || 'Unnamed package'));
      const confirmed=['verified_listing','verified_manufacturer','verified_dealer'].includes(pkg.status);
      summary.append(node('span',`badge ${confirmed ? 'package_verified' : 'not_confirmed'}`,statusLabels[pkg.status] || statusLabels.unresolved));box.append(summary);
      if(Array.isArray(pkg.items) && pkg.items.length) {
        const items=node('ul','packages package-items');
        pkg.items.forEach(item=>{
          const row=node('li');
          if(typeof item==='string') row.append(node('span','',item));
          else {
            row.append(node('span','package-item-name',item.name || item.label || item.text || 'Package item'));
            const verified=['present','listed','verified','verified_listing','verified_manufacturer','verified_dealer'].includes(item.status);
            row.append(node('span',`badge ${verified ? 'package_verified':'not_confirmed'}`,verified ? 'Verified' : item.status==='absent' ? 'Explicitly absent' : 'Not confirmed'));
            if(item.evidence?.length || item.sources?.length) {
              const proof=node('details','item-evidence');proof.append(node('summary','','Item evidence'));
              if(item.evidence?.length) proof.append(node('p','',readable(item.evidence)));
              appendSourceLinks(proof,item.sources);row.append(proof);
            }
          }
          items.append(row);
        });box.append(items);
      } else box.append(node('p','hint','Actual package contents have not yet been verified. No equipment is assumed from the package name.'));
      if(pkg.reason) box.append(node('p','package-reason',readable(pkg.reason)));
      if(pkg.source_type) box.append(node('p','evidence-provenance',`Evidence type: ${String(pkg.source_type).replaceAll('_',' ')}`));
      appendSourceLinks(box,pkg.sources);
      packagePanel.append(box);
    }
  } else if(Array.isArray(vehicle.packages) && vehicle.packages.length) {
    packagePanel.append(node('p','hint','Package names/text recorded; individual contents are not yet expanded or verified.'));
    const list=node('ul','packages');vehicle.packages.forEach(value=>list.append(node('li','',readable(value))));packagePanel.append(list);
  } else packagePanel.append(node('p','hint','No package information confirmed. This does not mean no packages are equipped.'));
  card.append(packagePanel);
  const evidenceItems = Object.entries(vehicle.features || {}).filter(([,f]) => (Array.isArray(f.evidence) && f.evidence.length) || (Array.isArray(f.sources) && f.sources.length));
  if(evidenceItems.length){
    details.append(node('h4','section-label','Feature evidence & sources'));
    const list=node('ul','packages');
    for(const [key,f] of evidenceItems){
      const evidence=Array.isArray(f.evidence) ? f.evidence.map(readable).join(' · ') : '';
      const item=node('li','',`${labels[key] || key}: ${evidence}`);
      if(f.evidence_type==='manufacturer_package') item.append(node('span','evidence-provenance',' Verified from the listed package and official manufacturer package information.'));
      if(f.evidence_type==='dealer_package') item.append(node('span','evidence-provenance',' Verified from the listed package and dealer factory-options information, not manufacturer documentation.'));
      appendSourceLinks(item,f.sources);
      list.append(item);
    }
    details.append(list);
  }
  card.append(details,node('p','observed',`Listing last observed: ${date(vehicle.observed_at)}. Equipment is never inferred from the trim name.`));
  return card;
}
function searchStatus(message, state = 'ready') {
  $('result-status').textContent = message;
  $('search-feedback').className = `search-feedback ${state}`;
  $('view-result').hidden = state !== 'success';
}
function render(query = '') {
  const normalized = normalize(query);
  $('results').replaceChildren();
  $('result-panel').hidden = true;
  $('reset').hidden = !normalized;
  if(inventoryLoading) { searchStatus('Loading saved inventory. Search will be available shortly.', 'loading');return; }
  if(!inventory){searchStatus('Inventory unavailable. The saved inventory could not be loaded. Reload this page or use the official Myers inventory link below.', 'error');return;}
  if(!inventory.vehicles.length){searchStatus('No verified vehicles saved yet. The first successful refresh will populate this database.', 'notice');return;}
  if(!normalized) { searchStatus('Enter a full VIN or stock number to find a vehicle.');return; }
  const matches = inventory.vehicles.filter(v => normalize(v.vin) === normalized || normalize(v.stock) === normalized);
  if(!matches.length){searchStatus('No exact match in saved inventory. Check the full VIN or stock number. A missing match does not establish that a vehicle is sold or unavailable.', 'notice');return;}
  if(matches.length !== 1){searchStatus('More than one saved record has that identity. Check the full VIN to identify the correct vehicle; no vehicle has been selected.', 'notice');return;}
  const vehicle = matches[0];
  $('results').replaceChildren(vehicleCard(vehicle));
  $('result-panel').hidden = false;
  searchStatus(`Vehicle found: ${vehicleTitle(vehicle)} · Stock ${vehicle.stock || 'not confirmed'}.`, 'success');
}
function updateHealth(data) {
  const successTime = new Date(data.last_success || '').getTime();
  const nextRefresh = new Date(data.next_refresh || '').getTime();
  const missedRefresh = Number.isFinite(nextRefresh) && Date.now()>nextRefresh+60*60*1000;
  const old = !Number.isFinite(successTime) || missedRefresh || Date.now()-successTime>27*60*60*1000;
  const partial = Boolean(data.last_partial_success && (!data.last_success || new Date(data.last_partial_success)>new Date(data.last_success)));
  const stale = Boolean(data.stale || data.error || old || partial);
  $('health-dot').className = `dot${stale?' stale':''}`;
  $('health-title').textContent = !data.last_success ? (data.last_partial_success ? 'Partial inventory · verification incomplete' : 'Awaiting first successful refresh') : partial ? 'Partial refresh · some listings need verification' : stale ? 'Saved inventory may be out of date' : 'Latest refresh successful';
  $('health-detail').textContent = data.last_success ? `Last success: ${date(data.last_success)}` : (data.last_partial_success ? 'No complete inventory refresh has succeeded yet.' : 'No live inventory has been verified yet.');
  if(data.error){
    $('refresh-warning').hidden=false;
    $('refresh-warning').textContent=data.last_success ? 'The latest refresh is incomplete. Previously verified information is still available.' : 'Inventory coverage is incomplete. Confirm availability and unverified details with Myers.';
    $('refresh-diagnostic').hidden=false;$('refresh-diagnostic').textContent=readable(data.error);
  }
  if(data.coverage || data.refresh_stats || data.last_partial_success || data.error || data.failures?.length) {
    $('coverage').hidden=false;
    const stats=data.refresh_stats;
    const counts=stats ? `${stats.discovered ?? '—'} listings discovered · ${stats.verified ?? 0} verified this run · ${stats.failed ?? 0} could not be verified · ${stats.retained ?? 0} retained from earlier` : '';
    $('coverage-summary').textContent=[data.coverage,counts].filter(Boolean).join(' ');
    $('partial-time').textContent=data.last_partial_success ? `Last partial refresh: ${date(data.last_partial_success)}. Check each vehicle’s observation time; this is not a guarantee of full lot coverage.` : '';
  }
  if(Array.isArray(data.failures) && data.failures.length) {
    $('failures').hidden=false;
    for(const failure of data.failures) {
      const item=node('li','',`${failure.reason || 'Listing not verified'} `);const url=safeSource(failure.source_url);
      if(url){const link=node('a','','Open source ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';item.append(link);}
      $('failure-list').append(item);
    }
  }
  $('vehicle-count').textContent = `${data.vehicles.length} ${data.vehicles.length===1?'vehicle':'vehicles'}`;
}
$('view-result').addEventListener('click',()=>{
  if($('result-panel').hidden) return;
  $('results-title').focus({preventScroll:true});
  $('results-title').scrollIntoView({block:'start'});
});
$('search-form').addEventListener('submit',event=>{event.preventDefault();render($('query').value);});
$('reset').addEventListener('click',()=>{$('query').value='';render();$('query').focus();});
render();
(async()=>{
  try {
    const response=await fetch('./data/inventory.json.gz',{cache:'no-store'});
    if(!response.ok) throw new Error(`Saved inventory request failed (${response.status}).`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    let text;
    if(bytes[0]===0x1f && bytes[1]===0x8b) {
      if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot open the compressed inventory. Please use a current version of Safari, Chrome, Edge or Firefox, or open the official Myers inventory below.');
      text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      // Some hosts apply Content-Encoding and the browser has already decoded gzip.
      text=new TextDecoder().decode(bytes);
    }
    const data=JSON.parse(text);
    if(!data || !Array.isArray(data.vehicles) || data.vehicles.some(v=>!v || typeof v!=='object')) throw new Error('The inventory file has an unexpected format.');
    inventoryLoading=false;inventory=data;updateHealth(data);initializeComparison();render();
  } catch(error) {
    inventoryLoading=false;
    $('health-dot').className='dot error';$('health-title').textContent='Inventory could not be loaded';$('health-detail').textContent='No data is being represented as current.';
    $('compare-status').textContent='Comparison is unavailable until inventory can be loaded.';$('vehicle-count').textContent='Unavailable';$('coverage').hidden=false;$('refresh-warning').hidden=false;$('refresh-warning').textContent='Saved inventory is unavailable. Please reload or open the official Myers inventory below.';
    $('coverage').hidden=false;$('refresh-diagnostic').hidden=false;$('refresh-diagnostic').textContent=error.message;render();
  }
})();
