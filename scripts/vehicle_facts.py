"""VIN-specific paint and engine facts, with unknowns instead of trim assumptions."""
import re
from html import unescape
try:
    from .condition_facts import demo_assertions,attach_condition
except ImportError:
    from condition_facts import demo_assertions,attach_condition
BROAD={'black','white','grey','gray','silver','red','blue','green','brown','beige','orange','yellow','gold','bronze','purple','other','unknown'}
def text(value): return re.sub(r'\s+',' ',unescape(re.sub(r'<[^>]*>',' ',str(value or '')))).strip()
def source_facts(raw):
    paragraphs=re.split(r'<br\s*/?>',str(raw.get('description','')),flags=re.I)
    clause=next((text(p) for p in paragraphs if re.match(r'^\s*This\b',text(p),re.I) and re.search(r'transmission|powered by',text(p),re.I)), '')
    clause=re.split(r'\b(?:To apply|Apply for financing|Come by)\b|https?://',clause,maxsplit=1,flags=re.I)[0].strip()
    return {'sale_class':text(raw.get('sale_class')), 'odometer':raw.get('odometer'),
            'odometer_unit':raw.get('odometer_unit') or raw.get('odometer_units'), 'odometer_label':raw.get('_odometer_label'),
            'demo_evidence':demo_assertions(raw.get('headline',''),raw.get('trim',''),text(raw.get('description','')), {k:raw[k] for k in ('demo','is_demo','is_demonstrator') if k in raw},raw.get('sale_class','')),
            'vehicle_description_excerpt':clause[:1500],
            'manufacturer_exterior_color':text(raw.get('manu_exterior_color')),
            'exterior_color':text(raw.get('exterior_color')),
            'engine':text(raw.get('engine')),'engine_displacement':raw.get('engine_displacement'),
            'cylinders':raw.get('cylinder'),'fuel':text(raw.get('fuel_type')),
            'window_sticker_url':str(raw.get('window_sticker') or '')}
def paint(vehicle):
    facts=vehicle.get('source_facts',{});generic=facts.get('exterior_color') or vehicle.get('specs',{}).get('Exterior Color') or ''
    manufacturer=facts.get('manufacturer_exterior_color','');candidates=[];evidence=[]
    if manufacturer and manufacturer.casefold() not in BROAD:
        candidates.append(manufacturer);evidence.append('Manufacturer exterior-colour field: '+manufacturer)
    clause=facts.get('vehicle_description_excerpt','')
    match=re.search(r'^This\s+(.+?)\s+(?:pickup|SUV|sedan|hatchback|coupe|convertible|van|wagon|minivan|truck|crossover|vehicle|car)\b',clause,re.I)
    if match:
        name=match.group(1)
        name=re.sub(r'\s+(?:2|4)[- ]Door\b','',name,flags=re.I)
        name=re.sub(r'\s+(?:(?:Crew|Double|Extended|Regular)\s+Cab\s*)?(?:4X4|4WD|AWD|FWD|RWD)?\s*$','',name,flags=re.I).strip()
        name=re.sub(r'\s+(?:sought[- ]after\s+)?diesel$','',name,flags=re.I).strip()
        if name and (re.search(r'\b(?:black|white|grey|gray|silver|red|blue|green|brown|orange|yellow|gold|bronze|purple|metallic|pearl|tintcoat|tricoat|tri-coat|satin|matte)\b',name,re.I)) and name.casefold() not in BROAD and not re.search(r'\b(?:mileage|used|new|loaded|accident|fully|low|clean|one|owner)\b',name,re.I):
            candidates.append(name);evidence.append(clause)
    unique={v.casefold() for v in candidates}
    status='conflict' if len(unique)>1 else ('listed_name' if candidates else ('generic_only' if generic else 'not_confirmed'))
    return {'name':candidates[0] if len(unique)==1 else None,'status':status,'generic_color':generic or None,'evidence':evidence,'source_url':vehicle['source_url']}
def engine(vehicle):
    specs=vehicle.get('specs',{});facts=vehicle.get('source_facts',{})
    raw_engine=str(specs.get('Engine') or facts.get('engine') or '')
    displacement=str(specs.get('Engine Displacement') or facts.get('engine_displacement') or '')
    if displacement in ('0','0.0','None'): displacement=''
    cylinders=str(specs.get('Cylinder') or facts.get('cylinders') or '')
    if cylinders in ('0','None'): cylinders=''
    fuel=str(specs.get('Fuel Type') or facts.get('fuel') or '')
    excerpt=facts.get('vehicle_description_excerpt','')
    evidence=[f'{k}: {v}' for k,v in [('Listed engine',raw_engine),('Displacement (L)',displacement),('Cylinders',cylinders),('Fuel',fuel)] if v]
    direct=[raw_engine]
    if excerpt: direct.append(excerpt);evidence.append(excerpt)
    for value in specs.values():
        for line in (value if isinstance(value,list) else []):
            if re.match(r'^(?:Engine[,: ]|SAE Net Horsepower)',line,re.I) and not re.search(r'control|block heater|requires|available|optional',line,re.I): direct.append(line)
    for key,value in specs.items():
        if re.search(r'SAE Net Horsepower',key,re.I): direct.append(key+': '+str(value))
    combined=' '.join(direct)
    config=re.search(r'\b(V[- ]?[468]|I[- ]?[346]|inline[- ]?[346]|Straight[- ]?[346])\b',combined,re.I)
    horsepower=[];rpms=[];conflict=False
    for line in direct:
        disps=re.findall(r'\b(\d(?:\.\d)?)\s*[lL]\b',line)
        if displacement and any(abs(float(x)-float(displacement))>.05 for x in disps):
            conflict=True;continue
        for m in re.finditer(r'\b(\d{2,4})\s*(?:hp|horsepower)\b',line,re.I): horsepower.append(m.group(1))
        structured=re.search(r'SAE Net Horsepower\s*@\s*RPM\s*[:=]?\s*(\d{2,4})\s*@\s*([\d,]+)',line,re.I)
        if structured: horsepower.append(structured.group(1));rpms.append(structured.group(2).replace(',',''));evidence.append(line)
        for m in re.finditer(r'(?:hp|horsepower)[^.;]{0,45}?(?:@|at)\s*([\d,]+)\s*rpm',line,re.I): rpms.append(m.group(1).replace(',',''))
        if not displacement and len(set(disps))==1: displacement=disps[0]
    if len(set(horsepower))>1: conflict=True
    hp=horsepower[0] if horsepower and not conflict else None
    turbo='Turbocharged' if re.search(r'\bturbo(?:charged)?\b',combined,re.I) and not conflict else None
    pieces=[(displacement+' L') if displacement else '',(cylinders+' cylinders') if cylinders else '',raw_engine if raw_engine and not cylinders else '',fuel,(hp+' hp') if hp else '']
    return {'summary':' · '.join(p for p in pieces if p) or 'Exact engine not confirmed',
            'displacement':(displacement+' L') if displacement else None,'cylinders':cylinders or None,
            'configuration':config.group(1) if config and not conflict else None,'turbo':turbo,'fuel':fuel or None,
            'horsepower':(hp+' hp') if hp else None,'hp_rpm':(rpms[0]+' rpm') if len(set(rpms))==1 and not conflict else None,
            'status':'conflict' if conflict else ('listed' if any(pieces) else 'not_confirmed'),'evidence':evidence}
def attach_facts(vehicle):
    vehicle['paint']=paint(vehicle);vehicle['engine_details']=engine(vehicle);return attach_condition(vehicle)
