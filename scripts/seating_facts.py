"""Installed seating assertions with explicit upgrade precedence; never model-wide guesses."""
import re

def attach_seating(vehicle):
    candidates=[];conditional=[];source={'title':'Exact Myers vehicle listing','url':vehicle.get('source_url','')}
    def add(line,rank,sources,kind="listing"):
        line=str(line)
        cap=None
        patterns=[r'\bSeating\s*[, :]\s*(\d{1,2})[- ]passenger',r'\b(\d{1,2})[- ]passenger\s+(?:seats|seating)\b',r'\bseating capacity\s*[:=]?\s*(\d{1,2})\b']
        for pattern in patterns:
            m=re.search(pattern,line,re.I)
            if m: cap=int(m.group(1));break
        layout=re.search(r'\b([1-4]-[1-4](?:-[1-4])?)\s+seating configuration\b',line,re.I)
        row=re.search(r'\b(?:second|2nd)[ -]row\b(?:(?!\b(?:third|3rd)[ -]row\b)[^,;.]){0,90}?(captain[’\']?s?\s+(?:chairs|seats)|bucket(?:\s+seats)?|(?:split[- ]?)?bench(?:\s+seat)?)',line,re.I)
        second=None
        if row:
            term=row.group(1).lower();second='Captain’s chairs' if 'captain' in term else ('Bucket seats' if 'bucket' in term else 'Bench seat')
        if cap is None and not layout and second is None:return
        fact={'capacity':cap,'layout':layout.group(1) if layout else None,'second_row':second,'rank':rank,'kind':kind,'evidence':line,'sources':sources}
        if re.search(r'\b(?:not available with|if equipped|available with|optional|requires|when ordered|deleted when|replaced with|when.{0,50}ordered|may|depending)\b',line,re.I):conditional.append(fact)
        else:candidates.append(fact)
    specs=vehicle.get('specs',{})
    for key,val in specs.items():
        if key in ('Vehicle-specific upgrades','Listed Equipment'):rank=4
        else:rank=2
        if isinstance(val,list):
            for line in val:add(line,rank,[source])
    passenger=specs.get('Passenger')
    if passenger not in (None,'',0,'0') and str(passenger).isdigit():
        candidates.append({'capacity':int(passenger),'layout':None,'second_row':None,'rank':2,'kind':'listing','evidence':'Listing passenger capacity: '+str(passenger),'sources':[source]})
    for package in vehicle.get('package_contents',[]):
        if package.get('status') in ('verified_manufacturer','verified_dealer'):
            for item in package.get('items',[]):add(item,3,package.get('sources',[]),package.get('source_type','manufacturer_package'))
    standard=None
    if vehicle.get('market')=='CA' and str(vehicle.get('year')) in ('2026','2027') and vehicle.get('make','').casefold()=='gmc' and vehicle.get('model','').casefold()=='terrain':
        year=str(vehicle['year'])
        url='https://www.gmccanada.ca/en/suvs/terrain' if year=='2027' else 'https://www.gmccanada.ca/byo-vc/client/en/CA/gmc/terrain/2026/terrain/summary/payment'
        standard={'capacity':5,'layout':None,'second_row':'60/40 split-folding rear seats' if year=='2027' else None,'rank':1,'kind':'manufacturer_standard',
                  'evidence':f'Official GMC Canada {year} Terrain: passenger capacity 5'+('; two rows, 60/40 split-folding rear seats.' if year=='2027' else '.'),
                  'sources':[{'title':f'GMC Canada {year} Terrain seating specifications','url':url}]}
        candidates.append(standard)
    chosen={};evidence=[];sources=[];kinds=[];conflict=False;capacity_rank=0
    for key in ('capacity','layout','second_row'):
        eligible=[f for f in candidates if f[key] is not None and (key=='capacity' or f['rank']>=capacity_rank)]
        if not eligible:chosen[key]=None;continue
        rank=max(f['rank'] for f in eligible);top=[f for f in eligible if f['rank']==rank];values={f[key] for f in top}
        if key=='capacity':capacity_rank=rank if rank>=3 else 0
        if len(values)>1:chosen[key]=None;conflict=True
        else:chosen[key]=next(iter(values))
        for f in top:evidence.append(f['evidence']);sources+=f['sources'];kinds.append(f.get('kind','listing'))
    if standard and chosen.get('capacity') not in (None,standard['capacity']): conflict=True
    if chosen.get('layout') and chosen.get('capacity') and sum(map(int,chosen['layout'].split('-')))!=chosen['capacity']:conflict=True
    if conflict:chosen={'capacity':None,'layout':None,'second_row':None}
    if not any(chosen.values()):
        evidence.extend(f['evidence'] for f in conditional)
        sources.extend(src for f in conditional for src in f['sources'])
    note='Explicit installed upgrades and verified installed-package contents take precedence over base/conditional seating descriptions.'
    if conditional and not candidates:note='The listing provides only conditional seating information; installed configuration is not confirmed.'
    vehicle['seating']={**chosen,'status':'conflict' if conflict else ('listed' if any(chosen.values()) else 'not_confirmed'),
                        'evidence_type':next(iter(set(kinds))) if len(set(kinds))==1 else ('mixed' if kinds else 'listing'),
                        'conditional_capacity':next(iter({f['capacity'] for f in conditional if f['capacity'] is not None})) if len({f['capacity'] for f in conditional if f['capacity'] is not None})==1 else None,
                        'evidence':list(dict.fromkeys(evidence)),'sources':list({s['url']:s for s in sources}.values()),'note':note}
    return vehicle
