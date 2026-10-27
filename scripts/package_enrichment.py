"""Versioned, manually verified OEM rules. Never infer a package from a trim alone."""
import json
import re
from pathlib import Path

def trim_matches(trim, listed):
    if trim.casefold()=='lt' and re.match(r'^LT Trail Boss\b',listed,re.I): return False
    if trim.casefold()=='denali' and re.match(r'^Denali Ultimate\b',listed,re.I): return False
    return bool(re.match(r'^'+re.escape(trim)+r'(?:\b|$)',listed,re.I))

def enrich(vehicle,rules=None):
    if rules is None:
        rules=json.loads(Path(__file__).with_name('package_rules.json').read_text())['rules']
    for feature in vehicle['features'].values():
        if feature.get('evidence'): feature.setdefault('evidence_type','listing')
    matched=[]
    for rule in rules:
        if rule.get('stocks') and vehicle.get('stock') not in rule['stocks']: continue
        if not all(str(vehicle.get(k,'')).casefold()==str(rule[k]).casefold() for k in ('market','year','make','model')): continue
        if not any(trim_matches(trim,vehicle.get('trim','')) for trim in rule['trims']): continue
        installed={p.strip().casefold() for p in vehicle.get('packages',[])}
        names=[n for n in rule['package_names'] if n.casefold() in installed]
        codes=set(vehicle.get('installed_package_codes',[])) & set(rule.get('package_codes',[]))
        if not names and not codes: continue
        if not rule.get('sources') or any(not source['url'].startswith('https://') for source in rule['sources']): raise ValueError('OEM rule requires HTTPS source proof')
        matched.append(rule)
        source_type=rule.get('source_type','manufacturer_package')
        if source_type not in ('manufacturer_package','dealer_package'): raise ValueError('Invalid package evidence type')
        for key,claim in rule.get('features',{}).items():
            feature=vehicle['features'][key]
            # Explicit absence or production/deletion uncertainty must not be overwritten by a generic package rule.
            if feature['status']=='absent' or any(re.search(r'not equipped|without|deleted|removed|retrofit|built (?:prior|on|after|between)',e,re.I) for e in feature.get('evidence',[])): continue
            if feature['status']=='present': continue
            feature.update(status='present',evidence_type=source_type,sources=rule['sources'],package_rule_id=rule['id'])
            feature['evidence'].append(f"Installed package: {', '.join(names or sorted(codes))}. {claim}")
            feature['evidence'].append(f"Verified package evidence: {rule['year']} {rule['make']} {rule['model']}, {rule['market']} market; matching listed trim and installed package, not a trim-only assumption.")
    expand_packages(vehicle,matched)
    return vehicle


def expand_packages(vehicle,matched):
    """Expose every named package, including unresolved contents, without silent guesses."""
    candidates=[]
    structured=vehicle.get('specs',{}).get('Package',[])
    if isinstance(structured,str): structured=[structured]
    for text in structured+vehicle.get('packages',[]):
        known=any(text.strip().casefold() in [n.casefold() for n in r['package_names']] for r in matched)
        if text in structured or re.search(r'\b(?:package|edition|group|bundle)\b',text,re.I) or known:
            name=re.split(r'\s+includes\b',text,maxsplit=1,flags=re.I)[0].strip()
            if name and name.casefold() not in {x[0].casefold() for x in candidates}: candidates.append((name,text))
    # Title-only package claims are visible but unresolved; never expand from a trim guess.
    title=vehicle.get('trim','')
    for segment in re.split(r'\s[-|]\s|,',title):
        if re.search(r'\b(?:package|edition|pack)\b',segment,re.I):
            label=segment.strip()
            if not any(name.casefold() in label.casefold() or label.casefold() in name.casefold() for name,_ in candidates):
                candidates.append((label,''))
    for label in ['Deluxe Package','Carbon Flash Package','GT Performance Package','Tech Pack']:
        if label.casefold() in title.casefold() and not any(label.casefold() in name.casefold() for name,_ in candidates): candidates.append((label,''))
    flags_path=Path(__file__).with_name('package_review_flags.json')
    flags=[f for f in json.loads(flags_path.read_text()) if f['stock']==vehicle.get('stock') and f['vin']==vehicle.get('vin')] if flags_path.exists() else []
    for flag in flags:
        name=re.split(r'\s+includes\b',flag['label'],maxsplit=1,flags=re.I)[0].strip()
        if name.casefold() not in {x[0].casefold() for x in candidates}: candidates.append((name,''))
    contents=[]
    used_rule_ids=set()
    for name,text in candidates:
        parts=re.split(r'\s+includes\b',text,maxsplit=1,flags=re.I)
        entry={'name':name,'status':'unresolved','items':[],'sources':[],
               'reason':('Title mentions this package; installed identity and full contents require confirmation.' if not text else 'Contents not yet verified for this exact listed package, model year, trim and Canadian market.')}
        if len(parts)==2 and parts[1].strip():
            entry.update(status='verified_listing',items=[parts[1].strip()],sources=[{'title':'Exact Myers vehicle listing','url':vehicle['source_url']}],source_type='listing',reason='Package contents explicitly stated on this listing.')
        applicable=[r for r in matched if name.casefold() in [n.casefold() for n in r['package_names']]]
        for rule in applicable:
            if rule['id'] in used_rule_ids:
                entry=None;break
            items=rule.get('contents',[])
            if not items: continue
            if entry['status']=='verified_listing': continue
            source_type=rule.get('source_type','manufacturer_package')
            status=('verified_dealer' if source_type=='dealer_package' else 'verified_manufacturer') if rule.get('contents_complete') else 'partial'
            used_rule_ids.add(rule['id'])
            entry.update(status=status,items=items,sources=rule['sources'],source_type=source_type,rule_id=rule['id'],
                         reason=('Full package contents verified against the scoped source.' if rule.get('contents_complete') else 'Only these items have been verified; remaining contents need research.'))
        if entry is not None:
            for flag in flags:
                flag_name=re.split(r'\s+includes\b',flag['label'],maxsplit=1,flags=re.I)[0].strip()
                if flag_name.casefold()==name.casefold():
                    if entry['status']=='unresolved': entry['reason']=flag['reason']
                    elif flag['status']=='partial' and entry['status']=='verified_listing': entry.update(status='partial',reason=flag['reason'])
            contents.append(entry)
    expanded=sum(p['status'].startswith('verified_') for p in contents)
    partial=sum(p['status']=='partial' for p in contents)
    unresolved=sum(p['status']=='unresolved' for p in contents)
    vehicle['package_contents']=contents
    vehicle['package_audit']={'total':len(contents),'expanded':expanded,'partial':partial,'unresolved':unresolved,
                              'status':'complete' if not partial and not unresolved else 'needs_review',
                              'scope':'Named packages on the exact listing; new or unmatched package names remain explicitly unresolved.'}


def inventory_audit(vehicles):
    named=[v for v in vehicles if v.get('package_audit',{}).get('total',0)]
    entries=[p for v in vehicles for p in v.get('package_contents',[])]
    return {'vehicles_audited':len(vehicles),'vehicles_with_no_named_packages':len(vehicles)-len(named),
            'vehicles_with_fully_expanded_packages':sum(v['package_audit']['status']=='complete' for v in named),
            'vehicles_with_unresolved_or_partial_packages':sum(v['package_audit']['status']!='complete' for v in named),
            'named_packages':len(entries),'expanded_packages':sum(p['status'].startswith('verified_') for p in entries),
            'partial_packages':sum(p['status']=='partial' for p in entries),'unresolved_packages':sum(p['status']=='unresolved' for p in entries),
            'vehicles_with_named_paint':sum(v.get('paint',{}).get('status')=='listed_name' for v in vehicles),
            'vehicles_with_listed_engine_displacement':sum(bool(v.get('engine_details',{}).get('displacement')) for v in vehicles),
            'vehicles_with_listed_horsepower':sum(bool(v.get('engine_details',{}).get('horsepower')) for v in vehicles),
            'vehicles_with_engine_conflicts':sum(v.get('engine_details',{}).get('status')=='conflict' for v in vehicles)}
