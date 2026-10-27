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
const pageSize = 20;
let currentPage = 0;
let activeQuery = '';
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
function empty(title, message) {
  const box = node('div', 'empty');
  box.append(node('div','empty-symbol','⌕'),node('h3','',title),node('p','',message));
  $('results').replaceChildren(box);
  $('result-status').textContent = `${title}. ${message}`;
}
function vehicleCard(vehicle) {
  const card = node('article','vehicle');
  const header = node('div','vehicle-header');
  const identity = node('div');
  identity.append(node('p','eyebrow','EXACT MYERS LISTING'));
  const fallback = [vehicle.year,vehicle.make,vehicle.model].filter(Boolean).join(' ');
  identity.append(node('h3','',vehicle.title || fallback || 'Vehicle listing'));
  const ids = node('div','identifiers');
  for (const [label,value] of [['Stock',vehicle.stock],['VIN',vehicle.vin],['Listed trim',vehicle.trim]]) {
    const item = node('span','',`${label} `); item.append(node('b','',value || 'Not confirmed')); ids.append(item);
  }
  identity.append(ids);
  if (vehicle.price) {
    const price=typeof vehicle.price==='number' ? new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(vehicle.price) : readable(vehicle.price);
    identity.append(node('p','price',`${price} · Advertised price`));
  }
  header.append(identity);
  const source = safeSource(vehicle.source_url);
  if (source) { const link = node('a','source-link','View Myers listing ↗'); link.href=source;link.target='_blank';link.rel='noopener noreferrer';header.append(link); }
  card.append(header);
  const section = node('section','feature-section');
  section.append(node('h4','section-label','Feature checklist'));
  const grid = node('div','feature-grid');
  const labels = {...featureLabels};
  for (const [key,value] of Object.entries(vehicle.features || {})) labels[key]=value.label || labels[key] || key.replaceAll('_',' ');
  for (const [key,label] of Object.entries(labels)) {
    const feature = vehicle.features?.[key] || {};
    const status = ['present','absent'].includes(feature.status) ? feature.status : 'not_confirmed';
    const row = node('div','feature');
    row.append(node('span','',label),node('span',`badge ${status}`,{present:'Listed',absent:'Explicitly absent',not_confirmed:'Not confirmed'}[status]));
    const evidence = Array.isArray(feature.evidence) ? feature.evidence.map(readable).join(' | ') : readable(feature.evidence || '');
    if(evidence) row.title=evidence;
    grid.append(row);
  }
  section.append(grid); card.append(section);
  const details = node('details','details');
  details.append(node('summary','','Specifications & packages from the listing'));
  const specs = Object.entries(vehicle.specs || {});
  if(specs.length) { const dl=node('dl','specs'); for(const [key,value] of specs){const pair=node('div','spec');pair.append(node('dt','',key.replaceAll('_',' ')),node('dd','',readable(value)));dl.append(pair);} details.append(dl); }
  else details.append(node('p','hint','No structured specifications have been confirmed from this listing.'));
  details.append(node('h4','section-label','Packages explicitly listed'));
  if(Array.isArray(vehicle.packages) && vehicle.packages.length) {const list=node('ul','packages');vehicle.packages.forEach(value=>list.append(node('li','',readable(value))));details.append(list);}
  else details.append(node('p','hint','No package information confirmed. This does not mean no packages are equipped.'));
  const evidenceItems = Object.entries(vehicle.features || {}).filter(([,f]) => Array.isArray(f.evidence) && f.evidence.length);
  if(evidenceItems.length){details.append(node('h4','section-label','Listing evidence'));const list=node('ul','packages');for(const [key,f] of evidenceItems)list.append(node('li','',`${labels[key] || key}: ${f.evidence.map(readable).join(' · ')}`));details.append(list);}
  card.append(details,node('p','observed',`Listing last observed: ${date(vehicle.observed_at)}. Equipment is never inferred from the trim name.`));
  return card;
}
function render(query = '', page = 0) {
  const normalized = normalize(query);
  activeQuery = normalized;
  currentPage = Math.max(0, page);
  $('pagination').hidden = true;
  $('reset').hidden = !normalized;
  $('results-title').textContent = normalized ? 'Exact-match results' : 'Saved inventory';
  if(!inventory){empty('Inventory unavailable','The saved inventory could not be loaded. Try reloading this page or use the official Myers inventory link below.');return;}
  if(!inventory.vehicles.length){empty('No verified vehicles saved yet','The first successful refresh will populate this database. No sample vehicles or guessed equipment are shown.');return;}
  const matches = normalized ? inventory.vehicles.filter(v => normalize(v.vin) === normalized || normalize(v.stock) === normalized) : inventory.vehicles;
  if(!matches.length){empty('No exact match in saved inventory',`Check the full VIN or stock number. A missing match does not establish that a vehicle is sold or unavailable.`);return;}
  currentPage = Math.min(currentPage, Math.ceil(matches.length / pageSize) - 1);
  const start = currentPage * pageSize;
  const visible = matches.slice(start, start + pageSize);
  $('results').replaceChildren(...visible.map(vehicleCard));
  const summary = `Showing ${start + 1}–${start + visible.length} of ${matches.length} ${matches.length===1?'vehicle':'vehicles'}`;
  $('result-status').textContent = `${summary}${normalized?' with an exact VIN or stock match':''}.`;
  $('pagination').hidden = matches.length <= pageSize;
  $('page-summary').textContent = summary;
  $('previous-page').disabled = currentPage === 0;
  $('next-page').disabled = start + pageSize >= matches.length;
  $('next-page').textContent = `Next ${Math.min(pageSize, Math.max(0, matches.length - start - pageSize)) || pageSize} →`;
}
function updateHealth(data) {
  const successTime = new Date(data.last_success || '').getTime();
  const nextRefresh = new Date(data.next_refresh || '').getTime();
  const missedRefresh = Number.isFinite(nextRefresh) && Date.now()>nextRefresh+60*60*1000;
  const old = !Number.isFinite(successTime) || missedRefresh || Date.now()-successTime>27*60*60*1000;
  const stale = Boolean(data.stale || data.error || old);
  $('health-dot').className = `dot${stale?' stale':''}`;
  $('health-title').textContent = !data.last_success ? (data.last_partial_success ? 'Partial inventory · verification incomplete' : 'Awaiting first successful refresh') : stale ? 'Saved inventory may be out of date' : 'Latest refresh successful';
  $('health-detail').textContent = data.last_success ? `Last success: ${date(data.last_success)}` : (data.last_partial_success ? 'No complete inventory refresh has succeeded yet.' : 'No live inventory has been verified yet.');
  if(data.error){$('refresh-error').hidden=false;$('refresh-error').textContent=`Refresh issue: ${readable(data.error)}${data.last_success?' The last successful inventory is still shown.':''}`;}
  if(data.coverage || data.refresh_stats || data.last_partial_success) {
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
function changePage(offset) {
  render(activeQuery, currentPage + offset);
  $('results-title').setAttribute('tabindex', '-1');
  $('results-title').focus();
  $('results-title').scrollIntoView({block:'start'});
}
$('previous-page').addEventListener('click',()=>changePage(-1));
$('next-page').addEventListener('click',()=>changePage(1));
$('search-form').addEventListener('submit',event=>{event.preventDefault();render($('query').value);});
$('reset').addEventListener('click',()=>{$('query').value='';render();$('query').focus();});
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
    inventory=data;updateHealth(data);render();
  } catch(error) {
    $('health-dot').className='dot error';$('health-title').textContent='Inventory could not be loaded';$('health-detail').textContent='No data is being represented as current.';
    $('vehicle-count').textContent='Unavailable';$('refresh-error').hidden=false;$('refresh-error').textContent=error.message;render();
  }
})();
