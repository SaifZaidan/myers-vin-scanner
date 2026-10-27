#!/usr/bin/env python3
"""Reapply audited feature/rule logic to saved source evidence without changing observation dates."""
import sys
from refresh import features,atomic_write
from snapshot import read_snapshot,write_compressed
from package_enrichment import enrich,inventory_audit
from vehicle_facts import attach_facts

def reclassify(path='data/inventory.json'):
    data=read_snapshot(path)
    if data is None: raise ValueError('No saved snapshot')
    changes=[]
    for vehicle in data['vehicles']:
        old=vehicle['features'];lines=[]
        for value in vehicle['specs'].values(): lines.extend(value if isinstance(value,list) else [str(value)])
        lines+=vehicle['packages']
        vehicle['features']=features(lines,vehicle['packages']);vehicle['market']='CA'
        enrich(attach_facts(vehicle))
        for key,feature in vehicle['features'].items():
            if old[key]['status']!=feature['status']: changes.append((vehicle['stock'],key,old[key]['status'],feature['status']))
    data["audit_summary"]=inventory_audit(data["vehicles"])
    atomic_write(path,data);write_compressed(path,data)
    return changes
if __name__=='__main__':
    changes=reclassify(sys.argv[1] if len(sys.argv)>1 else 'data/inventory.json')
    print(f'Reclassified {len(changes)} feature states using saved evidence; observation times unchanged.')
    for change in changes: print(*change)
