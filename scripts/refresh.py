#!/usr/bin/env python3
"""Public Myers sitemap -> verified per-listing inventory; no dependencies or secrets."""
import argparse, concurrent.futures, datetime as dt, html, json, os, re, sys, tempfile, time, threading
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo
import xml.etree.ElementTree as ET
from collections import Counter
try:
    from .snapshot import read_snapshot, write_compressed
except ImportError:
    from snapshot import read_snapshot, write_compressed
BASE = 'https://www.myerscadillacgm.ca'
TZ = ZoneInfo('America/Toronto')
UA = 'MyersBaselineInventory/1.0'
FEATURES = {
 'heated_front_seats': ('Heated front seats', r'heated (?:front )?seats|seats?,[^.;]*heated[^.;]*(?:front|driver)|seats?,[^.;]*front[^.;]*heated'),
 'heated_rear_seats': ('Heated rear seats', r'heated rear (?:outboard )?seats|rear heated seats|seats?,[^.;]*(?:rear|second.row)[^.;]*heated'),
 'ventilated_seats': ('Ventilated seats', r'(?:ventilated|cooled) (?:front )?seats|seats?,[^.;]*ventilated'),
 'heated_steering_wheel': ('Heated steering wheel', r'heated steering wheel|steering wheel,? heated'),
 'apple_carplay': ('Apple CarPlay', r'apple carplay'),
 'android_auto': ('Android Auto', r'android auto'),
 'remote_start': ('Remote start', r'remote (?:vehicle )?start(?:er)?'),
 'adaptive_cruise': ('Adaptive cruise control', r'adaptive cruise'),
 'blind_spot': ('Blind-spot monitoring', r'blind.?spot|side blind zone|blind zone steering'),
 'sunroof': ('Sunroof', r'sunroof|moonroof'),
 'awd': ('AWD / 4WD', r'\bawd\b|\b4wd\b|\b4x4\b|all.wheel drive|four.wheel drive'),
 'wireless_charging': ('Wireless charging', r'wireless (?:phone )?charg(?:ing|er)')}

def now(): return dt.datetime.now(dt.timezone.utc)
def iso(t): return t.isoformat()
def next_refresh(t):
    local=t.astimezone(TZ); result=local.replace(hour=6,minute=0,second=0,microsecond=0)
    if result <= local: result += dt.timedelta(days=1)
    return iso(result)
def clean(value): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', str(value or '')))).strip()
def safe_url(url):
    p=urlparse(url)
    if p.scheme not in ('http','https') or p.hostname != 'www.myerscadillacgm.ca' or p.username or p.port not in (None,443,80):
        raise ValueError('Non-Myers source URL rejected')
    return 'https://' + p.netloc + p.path + (('?' + p.query) if p.query else '')
def extract_vehicle(page):
    m=re.search(r'\bvar\s+vmsData\s*=\s*', page)
    if not m: raise ValueError('Missing vehicle JSON; source format changed')
    payload,_=json.JSONDecoder().raw_decode(page[m.end():])
    if not isinstance(payload.get('vehicle'),dict): raise ValueError('Not a vehicle detail page')
    return payload['vehicle']
def features(lines):
    output={}
    for key,(label,pattern) in FEATURES.items():
        evidence=[]; states=[]
        for line in lines:
            if not re.search(pattern,line,re.I): continue
            # Generic capability, optional equipment and conditional fitment are not confirmed.
            conditional=bool(re.search(r'\b(?:available|optional|if equipped|requires|when ordered|may|capable|not available with|deleted when)\b',line,re.I))
            match=re.search(pattern,line,re.I)
            before=line[:match.start()]
            after=line[match.end():]
            negative=bool(re.search(r'(?:not equipped with|without|does not have|no)\s*$',before,re.I) or re.match(r'\s*(?:is )?(?:not included|not equipped|deleted|not available)(?:[.;,]|$)',after,re.I))
            # Unscoped negative wording is ambiguous, never a positive assertion.
            if not negative and re.search(r'\b(?:not equipped|without|not included|deleted|does not have|no)\b',line,re.I): conditional=True
            status='not_confirmed' if conditional else ('absent' if negative else 'present')
            # A rear-seat-only assertion cannot confirm front-seat heating.
            if key=='heated_front_seats' and re.search(r'\brear\b',line,re.I) and not re.search(r'\bfront\b|driver',line,re.I): continue
            if key=='heated_front_seats' and not re.search(r'\bfront\b|driver',line,re.I): status='not_confirmed'
            evidence.append(line);states.append(status)
        definitive=set(states)-{'not_confirmed'}
        status=next(iter(definitive)) if len(definitive)==1 else 'not_confirmed'
        output[key]={'label':label,'status':status,'evidence':evidence}
    return output

def normalize(v,url,observed):
    company=v.get('company_data',{})
    if str(company.get('company_id'))!='3040' or clean(company.get('company_address')).lower()!='1200 baseline road' or clean(company.get('company_city')).lower()!='ottawa':
        raise ValueError('Listing dealership is not Myers Baseline Ottawa')
    listing_id=re.search(r'/((?:ad)?[0-9]+)/?$',urlparse(url).path)
    if not listing_id or str(v.get('ad_id',''))!=listing_id.group(1): raise ValueError('Listing identity does not match requested source URL')
    vin=clean(v.get('vin')).upper();stock=clean(v.get('stock_number')).upper()
    if not re.fullmatch('[A-HJ-NPR-Z0-9]{17}',vin) or not stock: raise ValueError('Missing valid VIN or stock number')
    if v.get('date_sold'): raise ValueError('Sitemap contains a sold listing; refresh needs review')
    specs={}
    for key in ['sale_class','body_style','engine','engine_displacement','fuel_type','transmission','drive_train','exterior_color','interior_color','doors','cylinder','passenger','odometer','fuel_economy_city_km','fuel_economy_highway_km','package_code']:
        value=v.get(key)
        if value not in (None,'',0): specs[key.replace('_',' ').title()]=str(value)
    lines=[]; packages=[]
    for item in v.get('tech_specs',[]):
        group=clean(item.get('tech_spec_group'));text=clean(item.get('tech_spec_description'))
        if not text: continue
        specs.setdefault(group,[])
        if not isinstance(specs[group],list): group='Technical '+group;specs.setdefault(group,[])
        specs[group].append(text);lines.append(text)
        if group=='Package': packages.append(text)
    options=[clean(x) for x in v.get('extra_options',[]) if clean(x)]
    lines+=options
    if v.get('drive_train'): lines.append('Drivetrain: '+clean(v['drive_train']))
    packages+=options
    if clean(v.get('package_description')): packages.append(clean(v['package_description']))
    # Generic marketing description is neither parsed nor retained; the original listing remains linked.
    result={k:clean(v.get(k)) for k in ['year','make','model','trim']}
    result.update(vin=vin,stock=stock,title=' '.join(result.values()),source_url=safe_url(url),observed_at=observed,
                  price=v.get('final_price') or v.get('sale_price') or None,specs=specs,packages=packages,
                  features=features(lines),trim_note='Trim is copied from this listing, not inferred from VIN. Equipment is never inferred from trim.')
    return result

class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class Source:
    def __init__(self):
        self.robots=RobotFileParser();self.robots.parse(self.raw(BASE+'/robots.txt').splitlines())
    def raw(self,url):
        url=safe_url(url)
        with build_opener(OfficialRedirect()).open(Request(url,headers={'User-Agent':UA}),timeout=45) as response:
            safe_url(response.url)
            raw=response.read(5_000_001)
            if len(raw)>5_000_000: raise ValueError('Source response too large')
            return raw.decode('utf-8')
    def get(self,url):
        if not self.robots.can_fetch(UA,url): raise ValueError('Source robots policy disallows '+url)
        for attempt in range(3):
            try: return self.raw(url)
            except HTTPError as error:
                if error.code in (401,403,429) or attempt==2: raise
                time.sleep(2**attempt)
            except Exception:
                if attempt==2: raise
                time.sleep(2**attempt)
    def discover(self):
        root=ET.fromstring(self.get(BASE+'/sitemap_index.xml'))
        maps=[e.text for e in root.iter() if e.tag.endswith('loc') and re.search(r'/(?:new|used)-vehicle-\d+-sitemap\.xml$',e.text or '')]
        if not maps: raise ValueError('No inventory sitemaps found')
        urls=set()
        for sitemap in maps:
            for item in ET.fromstring(self.get(sitemap)).iter():
                if item.tag.endswith('loc') and re.search(r'/vehicles/\d{4}/.+/(?:ad)?\d+/(?:\?.*)?$', item.text or ''): urls.add(safe_url(item.text))
        if not urls: raise ValueError('No listings discovered; retaining previous data')
        return sorted(urls)

def atomic_write(path,payload):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.inventory-')
    try:
        with os.fdopen(fd,'w') as out: json.dump(payload,out,ensure_ascii=False,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def refresh(path,source=None):
    start=now();old=read_snapshot(path) or {'vehicles':[], 'last_success':None}
    meta=dict(old,last_attempt=iso(start),timezone='America/Toronto',schedule='06:00',next_refresh=next_refresh(start),source_url=BASE+'/vehicles/')
    try:
        source=source or Source();urls=source.discover();observed=iso(start)
        failed=[]
        config=Path(__file__).with_name('source_access_exclusions.json')
        blocked_ids=set(json.loads(config.read_text()).get('listing_ids',[])) if config.exists() else set()
        blocked_urls={f['source_url'] for f in old.get('failures',[]) if '403' in f.get('reason','') or '401' in f.get('reason','')}
        prior={v['source_url']:v for v in old['vehicles']}
        checkpoint=Path(path).with_name('.refresh-progress.json')
        progress={'started':observed,'records':{},'failures':{}}
        if checkpoint.exists():
            saved=json.loads(checkpoint.read_text())
            if start-dt.datetime.fromisoformat(saved['started']) < dt.timedelta(hours=4): progress=saved
        lock=threading.Lock()
        def save_progress(url,record=None,error=None):
            with lock:
                progress['records' if record else 'failures'][url]=record or str(error)
                atomic_write(checkpoint,progress)
        def read(url):
            if url in progress['records']: return progress['records'][url]
            if url in progress['failures']:
                failed.append({'source_url':url,'reason':progress['failures'][url]})
                return prior.get(url)
            time.sleep(.2)
            try:
                if url in blocked_urls or any('/'+item+'/' in url for item in blocked_ids): raise ValueError('Previously HTTP 403; awaiting source access permission')
                record=normalize(extract_vehicle(source.get(url)),url,observed)
                print(f'Verified {record["stock"]}',flush=True)
                save_progress(url,record=record)
                return record
            except Exception as error:
                failed.append({'source_url':url,'reason':str(error)})
                save_progress(url,error=error)
                print(f'Unverified: {url}: {error}',file=sys.stderr,flush=True)
                return prior.get(url)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: vehicles=[v for v in pool.map(read,urls) if v]
        if not vehicles: raise ValueError('No listing could be verified')
        # Incomplete run cannot establish that an older vehicle has disappeared.
        if failed:
            seen={v['source_url'] for v in vehicles}
            vehicles.extend(v for v in old['vehicles'] if v['source_url'] not in seen)
        # URL query aliases may refer to exactly the same ad. Dedupe only identical facts.
        deduped=[]
        signatures=set()
        for vehicle in vehicles:
            signature=json.dumps({k:v for k,v in vehicle.items() if k not in ('source_url','observed_at')},sort_keys=True)
            signature=urlparse(vehicle['source_url']).path+'|'+signature
            if signature not in signatures: deduped.append(vehicle);signatures.add(signature)
        vehicles=deduped
        vin_counts=Counter(v['vin'] for v in vehicles);stock_counts=Counter(v['stock'] for v in vehicles)
        ambiguous=[v for v in vehicles if vin_counts[v['vin']]>1 or stock_counts[v['stock']]>1]
        if ambiguous:
            ambiguous_urls={v['source_url'] for v in ambiguous}
            for url in sorted(ambiguous_urls): failed.append({'source_url':url,'reason':'Duplicate VIN or stock; ambiguous listings quarantined'})
            vehicles=[v for v in vehicles if v['source_url'] not in ambiguous_urls]
        if not failed and old['vehicles'] and len(vehicles)<len(old['vehicles'])*.6: raise ValueError('Inventory unexpectedly shrank over 40%; manual source review required')
        meta.update(vehicles=sorted(vehicles,key=lambda v:(v['make'],v['model'],v['stock'])),last_success=(old.get('last_success') if failed else iso(now())),last_partial_success=(iso(now()) if failed else None),error=(f'{len(failed)} listings could not be refreshed; coverage is incomplete.' if failed else None),stale=bool(failed),refresh_stats={'discovered':len(urls),'verified':len(urls)-len(failed),'failed':len(failed),'quarantined':len(ambiguous),'retained':sum(1 for v in vehicles if v.get('observed_at')!=observed)},failures=failed,coverage='Coverage is based on official new and used vehicle sitemaps; see verification counts. Sitemap changes may lag live dealer inventory.')
        atomic_write(path,meta);write_compressed(path,meta)
        checkpoint.unlink(missing_ok=True)
        print(f'Updated {len(vehicles)} Myers Baseline records; {len(failed)} source failures');return not failed
    except Exception as error:
        meta.update(error=f'Refresh failed: {type(error).__name__}: {error}',stale=True)
        if 'failed' in locals(): meta['failures']=failed
        atomic_write(path,meta);write_compressed(path,meta);print(meta['error'],file=sys.stderr);return False
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='data/inventory.json');parser.add_argument('--scheduled',action='store_true');args=parser.parse_args()
    # Two UTC cron triggers cover DST; only the trigger in Toronto's 06:00 hour runs.
    if args.scheduled and now().astimezone(TZ).hour!=6: print('Skipped: not 06:00 Toronto');sys.exit(0)
    sys.exit(0 if refresh(args.output) else 1)
