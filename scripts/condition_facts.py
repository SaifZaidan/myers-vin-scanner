"""Explicit listing condition, odometer units, and demonstrator evidence only."""
import re

def demo_assertions(title='',trim='',description='',flags=None,sale_class=''):
    evidence=[]
    word=r'\b(?:demo|demonstrator)\b'
    reject=r'\b(?:not|no|never|may|might|if|whether|ask|available)\b'
    for label,value in [('Listing title',title),('Listed trim',trim),('Sale class',sale_class)]:
        if re.search(word,str(value),re.I) and not re.search(reject,str(value),re.I): evidence.append(f'{label}: {value}')
    for sentence in re.split(r'(?<=[.!?])\s+|<br\s*/?>',str(description),flags=re.I):
        if re.search(r'\bthis\b.{0,60}?\b(?:is|was|has been used as)\s+(?:(?:a|an|our|the|former|previous|dealer|staff|company|manager[’\']s)\s+){0,4}'+word,sentence,re.I) and not re.search(reject,sentence,re.I):
            evidence.append(sentence.strip())
    for key,value in (flags or {}).items():
        if key in ('is_demo','demo','is_demonstrator') and str(value).strip().lower() in ('true','1','yes','demo','demonstrator'):
            evidence.append(f'Explicit listing field {key}: {value}')
    return list(dict.fromkeys(evidence))

def unit(value):
    value=str(value or '').strip()
    if re.search(r'\b(?:km|kms|kilomet(?:re|er)s?)\b',value,re.I): return 'km'
    if re.search(r'\b(?:mi|miles?)\b',value,re.I): return 'mi'
    return None

def attach_condition(vehicle):
    facts=vehicle.get('source_facts',{});specs=vehicle.get('specs',{})
    sale_class=facts.get('sale_class') or specs.get('Sale Class')
    evidence=demo_assertions(vehicle.get('title',''),vehicle.get('trim',''),facts.get('vehicle_description_excerpt',''),sale_class=sale_class)
    evidence=list(dict.fromkeys(evidence+facts.get('demo_evidence',[])))
    vehicle['demo_status']='listed_demo' if evidence else 'not_confirmed'
    vehicle['demo_evidence']=evidence;vehicle['demo_source_url']=vehicle.get('source_url')
    vehicle['condition']={'sale_class':sale_class or None,'evidence':[f'Listing sale class: {sale_class}'] if sale_class else [],'source_url':vehicle.get('source_url')}
    raw=facts.get('odometer')
    if raw in (None,''): raw=specs.get('Odometer')
    value=None
    if raw not in (None,'') and not isinstance(raw,bool):
        match=re.fullmatch(r'\s*([\d,]+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:re|er)s?|mi|miles?)?\s*',str(raw),re.I)
        if match:
            value=float(match.group(1).replace(',',''))
            if value.is_integer(): value=int(value)
    units=unit(facts.get('odometer_unit')) or unit(raw) or unit(facts.get('odometer_label'))
    mileage_evidence=[f'Listing odometer: {raw}'] if value is not None else []
    if units:
        mileage_evidence.append(facts.get('odometer_unit_evidence') or f"Listing odometer unit/label: {facts.get('odometer_unit') or facts.get('odometer_label') or raw}")
    # A per-vehicle explicit unit takes precedence over a site-level label.
    excerpt=facts.get('vehicle_description_excerpt','')
    if value is not None:
        for match in re.finditer(r'\b([\d,]+(?:\.\d+)?)\s*(km|kms|kilomet(?:re|er)s?|mi|miles?)\b',excerpt,re.I):
            if float(match.group(1).replace(',',''))==value:
                units=unit(match.group(2));mileage_evidence.append(match.group(0));break
    vehicle['mileage']={'value':value,'unit':units if value is not None else None,'status':('listed' if units else 'unit_not_confirmed') if value is not None else 'not_confirmed','evidence':mileage_evidence,'source_url':vehicle.get('source_url')}
    return vehicle
