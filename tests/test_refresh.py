import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from scripts.refresh import features,normalize,next_refresh,refresh,extract_vehicle,safe_url,Source,explicit_upgrades
from scripts.snapshot import read_snapshot,write_compressed
from scripts.package_enrichment import enrich
from scripts.vehicle_facts import source_facts,attach_facts
from scripts.condition_facts import demo_assertions,attach_condition
from scripts.seating_facts import attach_seating
FIXTURE=json.loads((Path(__file__).parent/'fixtures/official-silverado.json').read_text())
URL='https://www.myerscadillacgm.ca/vehicles/2026/chevrolet/silverado-1500/ottawa/on/71424620/'
class Tests(unittest.TestCase):
 def test_real_listing(self):
  v=normalize(FIXTURE,URL,'2026-10-27T22:00:00+00:00')
  self.assertEqual(v['stock'],'26-1416');self.assertEqual(v['features']['remote_start']['status'],'present')
  self.assertEqual(v['features']['apple_carplay']['status'],'present')
  self.assertEqual(v['features']['heated_front_seats']['status'],'not_confirmed')
  self.assertEqual(len(v['packages']),6)
 def test_not_inferred(self):
  f=features(['Optional heated front seats','Remote start available','Rear heated seats'])
  self.assertEqual(f['heated_front_seats']['status'],'not_confirmed')
  self.assertEqual(f['remote_start']['status'],'not_confirmed')
 def test_negative_and_conflict(self):
  self.assertEqual(features(['Without heated front seats'])['heated_front_seats']['status'],'absent')
  self.assertEqual(features(['Heated front seats','Without heated front seats'])['heated_front_seats']['status'],'not_confirmed')
 def test_unrelated_negative_is_not_absent(self):
  self.assertEqual(features(['Heated front seats at no charge'])['heated_front_seats']['status'],'not_confirmed')
  self.assertEqual(features(['Heated front seats without sunroof'])['heated_front_seats']['status'],'not_confirmed')
 def test_location(self):
  bad=dict(FIXTURE,company_data={'company_id':'999'})
  with self.assertRaises(ValueError): normalize(bad,URL,'now')
 def test_listing_id_mismatch(self):
  with self.assertRaises(ValueError): normalize(dict(FIXTURE,ad_id='other'),URL,'now')
 def test_vin(self):
  with self.assertRaises(ValueError): normalize(dict(FIXTURE,vin='INVALID'),URL,'now')
 def test_safe_url(self):
  for url in ['https://evil.example/test','https://www.myerscadillacgm.ca.evil.com/','file:///etc/passwd']:
   with self.assertRaises(ValueError): safe_url(url)
 def test_dst(self):
  self.assertTrue(next_refresh(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc)).endswith('06:00:00-04:00'))
  self.assertTrue(next_refresh(dt.datetime(2026,12,1,tzinfo=dt.timezone.utc)).endswith('06:00:00-05:00'))
 def test_failed_refresh_retains_data(self):
  class Broken:
   def discover(self): raise RuntimeError('source down')
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json';old={'vehicles':[{'vin':'kept'}],'last_success':'2026-01-01'};path.write_text(json.dumps(old))
   self.assertFalse(refresh(path,Broken()));out=json.loads(path.read_text())
   self.assertEqual(out['vehicles'],old['vehicles']);self.assertEqual(out['last_success'],old['last_success']);self.assertTrue(out['stale'])
 def test_partial_keeps_previous_and_marks_incomplete(self):
  other=URL.replace('71424620','99999999')
  class Partial:
   def discover(self): return [URL,other]
   def get(self,url):
    if url==other: raise RuntimeError('HTTP Error 403')
    return 'var vmsData = '+json.dumps({'vehicle':FIXTURE})+';'
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json'
   old=normalize(dict(FIXTURE,ad_id='99999999'),other,'2026-01-01');old.update(vin='1GCPKBEK3TZ504798',stock='OLD')
   path.write_text(json.dumps({'vehicles':[old],'last_success':'2026-01-01'}))
   self.assertFalse(refresh(path,Partial()));out=json.loads(path.read_text())
   self.assertEqual(len(out['vehicles']),2);self.assertEqual(out['last_success'],'2026-01-01')
   self.assertEqual(out['refresh_stats']['failed'],1);self.assertTrue(out['stale'])
 def test_duplicate_identity_rejects_snapshot(self):
  class Duplicate:
   def discover(self): return [URL,URL+'?test=1']
   def get(self,url): return 'var vmsData = '+json.dumps({'vehicle':dict(FIXTURE,trim=('Different' if '?' in url else FIXTURE['trim']))})+';'
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json'
   self.assertFalse(refresh(path,Duplicate()));out=json.loads(path.read_text())
   self.assertEqual(out['vehicles'],[]);self.assertEqual(out['refresh_stats']['quarantined'],2);self.assertTrue(any('Duplicate' in f['reason'] for f in out['failures']))
 def test_identical_url_alias_deduplication(self):
  class Aliases:
   def discover(self): return [URL,URL+'?sale_class=used']
   def get(self,url): return 'var vmsData = '+json.dumps({'vehicle':FIXTURE})+';'
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json'
   self.assertTrue(refresh(path,Aliases()));out=json.loads(path.read_text())
   self.assertEqual(len(out['vehicles']),1);self.assertFalse(out['stale'])
 def test_ad_prefixed_listing_id(self):
  v=normalize(dict(FIXTURE,ad_id='ad71424620'),URL.replace('/71424620/','/ad71424620/'),'2026-01-01')
  self.assertEqual(v['vin'],FIXTURE['vin'])
 def test_discovery_includes_ad_prefixed_models(self):
  source=Source.__new__(Source)
  index='<sitemapindex><sitemap><loc>https://www.myerscadillacgm.ca/new-vehicle-1-sitemap.xml</loc></sitemap></sitemapindex>'
  prefixed=URL.replace('/71424620/','/ad71424620/')
  listing='<urlset>'+''.join('<url><loc>'+u+'</loc></url>' for u in [URL,prefixed,'https://www.myerscadillacgm.ca/vehicles/'])+'</urlset>'
  source.get=lambda url: index if url.endswith('sitemap_index.xml') else listing
  self.assertEqual(set(source.discover()),{URL,prefixed})
 def test_compressed_snapshot_deterministic_restore(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json';data={'vehicles':[],'test':'é'}
   packed=write_compressed(path,data);first=packed.read_bytes();write_compressed(path,data)
   self.assertEqual(first,packed.read_bytes());self.assertEqual(read_snapshot(path),data)
 def test_failed_refresh_retains_compressed_checkout(self):
  class Broken:
   def discover(self): raise RuntimeError('source down')
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'inventory.json';old={'vehicles':[{'vin':'kept'}],'last_success':'2026-01-01'}
   write_compressed(path,old)
   self.assertFalse(path.exists());self.assertFalse(refresh(path,Broken()))
   path.unlink();out=read_snapshot(path)
   self.assertEqual(out['vehicles'],old['vehicles']);self.assertTrue(out['stale'])
 def test_equipment_and_specific_upgrades(self):
  v=json.loads((Path(__file__).parent/'fixtures/official-canyon.json').read_text())
  result=normalize(v,'https://www.myerscadillacgm.ca/vehicles/2026/gmc/canyon/ottawa/on/71317535/','2026-10-27')
  self.assertEqual(result['features']['sunroof']['status'],'present')
  self.assertEqual(result['features']['heated_front_seats']['status'],'not_confirmed')
  self.assertEqual(explicit_upgrades('Our trim features heated seats.'),[])
 def test_equipment_synonyms(self):
  f=features(['Heated Front Seat(s)','Cooled Front Seats','Remote Engine Start','Wireless Device Charging'])
  for key in ['heated_front_seats','ventilated_seats','remote_start','wireless_charging']: self.assertEqual(f[key]['status'],'present')
 def test_conditional_package_requires_explicit_listing(self):
  row='Seats, heated and ventilated driver and front passenger seat cushions and seatbacks (Included and only available with (WPL) Luxury Package.)'
  self.assertEqual(features([row])['ventilated_seats']['status'],'not_confirmed')
  f=features([row],['Luxury Package includes heated rear outboard seats'])
  self.assertEqual(f['ventilated_seats']['status'],'present')
  self.assertTrue(any('Required package explicitly listed' in e for e in f['ventilated_seats']['evidence']))
 def test_manufacturer_package_scoping(self):
  def vehicle(**changes):
   v={'market':'CA','year':'2026','make':'GMC','model':'Canyon','trim':'Elevation - Sunroof','packages':['Convenience Package'],'features':features([])}
   v.update(changes);return v
  self.assertEqual(enrich(vehicle())['features']['remote_start']['evidence_type'],'manufacturer_package')
  for v in [vehicle(year='2025'),vehicle(market='US'),vehicle(trim='AT4'),vehicle(packages=['Premium Package']),vehicle(packages=[])]:
   self.assertEqual(enrich(v)['features']['remote_start']['status'],'not_confirmed')
  v=vehicle();v['features']=features(['Without remote start'])
  self.assertEqual(enrich(v)['features']['remote_start']['status'],'absent')
 def test_exact_paint_and_engine(self):
  raw={'description':'This Sterling Metallic Crew Cab 4X4 pickup has an Automatic transmission and is powered by a 310HP 2.7L 4 Cylinder Engine.<br>Apply for financing','exterior_color':'Grey','engine_displacement':2.7,'engine':'4 Cylinder Engine','cylinder':4,'fuel_type':'Gas'}
  v={'source_url':URL,'specs':{},'source_facts':source_facts(raw)};attach_facts(v)
  self.assertEqual(v['paint']['name'],'Sterling Metallic');self.assertEqual(v['engine_details']['horsepower'],'310 hp')
  self.assertEqual(v['engine_details']['displacement'],'2.7 L');self.assertNotIn('financing',v['source_facts']['vehicle_description_excerpt'])
 def test_generic_colour_is_not_official_name(self):
  v={'source_url':URL,'specs':{'Exterior Color':'Grey'}};attach_facts(v)
  self.assertEqual(v['paint']['status'],'generic_only');self.assertIsNone(v['paint']['name']);self.assertIsNone(v['engine_details']['horsepower'])
 def test_structured_horsepower_and_conflicts(self):
  v={'source_url':URL,'specs':{'Engine Displacement':'2.7','SAE Net Horsepower @ RPM':'310 @ 5600'}};attach_facts(v)
  self.assertEqual(v['engine_details']['horsepower'],'310 hp');self.assertEqual(v['engine_details']['hp_rpm'],'5600 rpm')
  v['source_facts']={'vehicle_description_excerpt':'This Black pickup is powered by a 420HP 6.2L V8 Engine.'};attach_facts(v)
  self.assertEqual(v['engine_details']['status'],'conflict');self.assertIsNone(v['engine_details']['horsepower'])
 def test_all_packages_audited_including_unresolved_title(self):
  v={'source_url':URL,'market':'CA','year':'2026','make':'GMC','model':'Canyon','trim':'Elevation - Mystery Package','packages':['Convenience Package','Unresearched Package'],'specs':{},'features':features([])}
  enrich(v)
  self.assertEqual(v['package_audit']['total'],3);self.assertEqual(v['package_audit']['unresolved'],2)
  self.assertEqual(v['package_audit']['status'],'needs_review')
 def test_diesel_adjectives_are_not_paint(self):
  v={'source_url':URL,'specs':{},'source_facts':{'manufacturer_exterior_color':'Summit White','exterior_color':'White','vehicle_description_excerpt':'This Summit White sought after diesel Crew Cab 4X4 pickup has an Automatic transmission.'}}
  attach_facts(v);self.assertEqual(v['paint']['status'],'listed_name');self.assertEqual(v['paint']['name'],'Summit White')
  v['source_facts'].update(manufacturer_exterior_color='Black',exterior_color='Black',vehicle_description_excerpt='This Black sought after diesel Crew Cab 4X4 pickup has an Automatic transmission.')
  attach_facts(v);self.assertEqual(v['paint']['status'],'generic_only')
 def test_demo_requires_explicit_vehicle_evidence(self):
  self.assertTrue(demo_assertions(description='This is a demonstrator vehicle driven by a member of our staff.'))
  self.assertTrue(demo_assertions(title='2026 GMC Canyon - DEMO'))
  self.assertTrue(demo_assertions(flags={'is_demo':True}))
  for phrase in ['Demo vehicles may have additional kilometres.','This is not a demo vehicle.','Ask about our demo vehicles.','This is a new model unlike the demo.']:
   self.assertEqual(demo_assertions(description=phrase),[])
  vehicle={'source_url':URL,'specs':{'Sale Class':'New','Odometer':'9000'},'source_facts':{}}
  attach_condition(vehicle);self.assertEqual(vehicle['demo_status'],'not_confirmed');self.assertEqual(vehicle['condition']['sale_class'],'New')
 def test_mileage_zero_and_explicit_miles(self):
  vehicle={'source_url':URL,'specs':{'Sale Class':'Used','Odometer':'0'},'source_facts':{'odometer_label':'Kilometres'}}
  attach_condition(vehicle);self.assertEqual(vehicle['mileage']['value'],0);self.assertEqual(vehicle['mileage']['unit'],'km')
  vehicle['source_facts'].update(odometer='1,000 miles',odometer_unit='miles')
  attach_condition(vehicle);self.assertEqual(vehicle['mileage']['value'],1000);self.assertEqual(vehicle['mileage']['unit'],'mi')
 def test_legacy_mileage_without_unit_is_unknown(self):
  vehicle={'source_url':URL,'specs':{'Odometer':'12345'},'source_facts':{}}
  attach_condition(vehicle);self.assertEqual(vehicle['mileage']['status'],'unit_not_confirmed');self.assertIsNone(vehicle['mileage']['unit'])
 def test_import_preserves_zero_and_source_metadata(self):
  raw=dict(FIXTURE,odometer=0,sale_class='New',description='This is a demonstrator vehicle. Demo vehicles may have more kilometres.')
  page='var vmsData = '+json.dumps({'vehicle':raw,'translation':{'attributes':{'odometer':'Kilometres'}}})+';'
  record=normalize(extract_vehicle(page),URL,'2026-10-28')
  self.assertEqual(record['specs']['Odometer'],'0');self.assertEqual(record['mileage']['value'],0)
  self.assertEqual(record['mileage']['unit'],'km');self.assertEqual(record['demo_status'],'listed_demo')
  self.assertEqual(record['condition']['sale_class'],'New')
 def test_seating_upgrades_override_conditional_base(self):
  v={'source_url':URL,'specs':{'Interior':['Seating, 8-passenger (Not available with (GHI) Elevation Premium Package.)'],'Vehicle-specific upgrades':['7-passenger seats (2-2-3 seating configuration)']}}
  attach_seating(v);self.assertEqual(v['seating']['capacity'],7);self.assertEqual(v['seating']['layout'],'2-2-3');self.assertIsNone(v['seating']['second_row'])
  del v['specs']['Vehicle-specific upgrades'];attach_seating(v)
  self.assertIsNone(v['seating']['capacity']);self.assertEqual(v['seating']['conditional_capacity'],8);self.assertEqual(v['seating']['status'],'not_confirmed')
 def test_seating_captains_explicit_and_conflicts(self):
  v={'source_url':URL,'specs':{'Interior':["Seating, 7-passenger (2-2-3 seating configuration) with 2nd row flat-folding captain's chairs"]}}
  attach_seating(v);self.assertEqual(v['seating']['second_row'],'Captain’s chairs')
  v['specs']['Interior'].append('Seating, 8-passenger');attach_seating(v)
  self.assertEqual(v['seating']['status'],'conflict');self.assertIsNone(v['seating']['capacity'])
 def test_manufacturer_standard_seating_scope(self):
  v={'source_url':URL,'market':'CA','year':'2027','make':'GMC','model':'Terrain','specs':{}}
  attach_seating(v);self.assertEqual(v['seating']['capacity'],5);self.assertEqual(v['seating']['evidence_type'],'manufacturer_standard')
  for changes in [{'year':'2025'},{'market':'US'},{'model':'Acadia'}]:
   changed=dict(v,**changes);attach_seating(changed);self.assertIsNone(changed['seating']['capacity'])
 def test_installed_package_seating_override(self):
  v={'source_url':URL,'specs':{'Passenger':'8'},'package_contents':[{'status':'verified_manufacturer','source_type':'manufacturer_package','items':['7-passenger seating (2-2-3 seating configuration)'],'sources':[{'title':'Verified installed package','url':'https://www.gmccanada.ca/'}]}]}
  attach_seating(v);self.assertEqual(v['seating']['capacity'],7);self.assertEqual(v['seating']['evidence_type'],'manufacturer_package')
 def test_rear_bench_count_is_not_total_capacity(self):
  v={'source_url':URL,'specs':{'Interior':['Seat, rear 60/40 folding bench, 3-passenger','Seats, front bucket']}}
  attach_seating(v);self.assertIsNone(v['seating']['capacity'])
 def test_seating_does_not_read_third_row_as_second(self):
  v={'source_url':URL,'specs':{'Interior':["Seating, 7-passenger (2-2-3 seating configuration), includes 2nd row 40/40 Captains chairs",'Power Package includes second row seats, 60/40 split folding third row bench seat']}}
  attach_seating(v);self.assertEqual(v['seating']['status'],'listed');self.assertEqual(v['seating']['second_row'],'Captain’s chairs')
 def test_optional_console_reference_does_not_override_bucket(self):
  v={'source_url':URL,'specs':{'Interior':['Console with cup holders for second row; (Deleted when (ATT) second row power 60/40 split-folding bench seats are ordered.)','Seats, second row bucket, power release']}}
  attach_seating(v);self.assertEqual(v['seating']['status'],'listed');self.assertEqual(v['seating']['second_row'],'Bucket seats')
 def test_extract(self):
  self.assertEqual(extract_vehicle('var vmsData = '+json.dumps({'vehicle':FIXTURE})+';')['vin'],FIXTURE['vin'])
if __name__=='__main__': unittest.main()
