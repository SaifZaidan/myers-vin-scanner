#!/usr/bin/env python3
"""Offline publication guard. Partial snapshots are allowed only when honestly labeled."""
import json
import sys
from datetime import datetime
from pathlib import Path
from refresh import FEATURES, safe_url
from snapshot import read_snapshot, write_compressed

def validate(data):
    assert isinstance(data.get('vehicles'),list), 'vehicles must be a list'
    assert data.get('timezone')=='America/Toronto', 'Wrong timezone'
    assert data.get('schedule')=='06:00', 'Wrong target refresh time'
    if not data.get('stale'):
        assert data.get('last_success'), 'Fresh snapshot needs complete-success timestamp'
    if data.get('failures'):
        assert data.get('stale') and data.get('error'), 'Partial snapshot must disclose failure'
    vins=set();stocks=set()
    for v in data['vehicles']:
        assert v['vin'] not in vins and v['stock'] not in stocks, 'Ambiguous identity'
        vins.add(v['vin']);stocks.add(v['stock'])
        safe_url(v['source_url']);datetime.fromisoformat(v['observed_at'])
        assert set(FEATURES)<=set(v['features']), 'Missing checklist fields'
        for f in v['features'].values():
            assert f['status'] in ('present','absent','not_confirmed'), 'Invalid feature state'
            if f['status'] in ('present','absent'): assert f.get('evidence'), 'Definitive claim needs evidence'
            if f.get('evidence_type') in ('manufacturer_package','dealer_package'):
                assert f.get('package_rule_id') and f.get('sources'), 'Manufacturer claim needs scoped rule and sources'
                assert all(source['url'].startswith('https://') for source in f['sources']), 'Invalid manufacturer source URL'
        assert isinstance(v['specs'],dict) and isinstance(v['packages'],list), 'Invalid source fields'
    return len(vins)

if __name__=='__main__':
    path=sys.argv[1] if len(sys.argv)>1 else 'data/inventory.json'
    data=read_snapshot(path)
    assert data is not None, 'No local or compressed snapshot found'
    count=validate(data)
    write_compressed(path,data)
    print(f'Valid snapshot: {count} unique vehicle records; stale={data.get("stale")}; source failures={len(data.get("failures",[]))}')
