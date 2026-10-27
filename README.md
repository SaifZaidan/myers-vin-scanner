# Myers Baseline vehicle database

A static, no-login inventory dashboard for **Myers Cadillac Chevrolet Buick GMC, 1200 Baseline Road, Ottawa only**. Replaces the old camera/VIN scanner. No customer data, third-party database, API keys, or paid services.

## Run / test

```sh
python scripts/refresh.py              # refresh data/inventory.json from official sources
python -m http.server 8080            # open http://localhost:8080
python scripts/validate_snapshot.py     # validate and deterministically repack gzip
python -m unittest discover -s tests -v
node --check app.js
```

Existing static hosting can publish repository root unchanged. `data/inventory.json.gz` is the compressed read-only database served to browsers. Raw `data/inventory.json` stays local and gitignored. All browser assets are local; no analytics, camera permissions or external fonts.

## Accuracy and source policy

- Discover candidate URLs from official new/used vehicle sitemaps linked by the dealership sitemap index. Fetch only robots-permitted public pages, never the disallowed AJAX endpoint. This is **sitemap coverage**, not an independent guarantee of all live dealer inventory or availability.
- Extract structured `vmsData.vehicle` from each exact listing. Check dealership ID 3040, address and city, valid VIN and stock. Quarantine ambiguous duplicate identities and sold listings, with source links and incomplete-coverage status. A listed vehicle may already be sold; confirm availability with Myers.
- Keep all technical specification groups, advertised packages/options and direct source links. Generic listing description is not used to classify equipment. No VIN/trim equipment guessing.
- Checklist means **present in explicit listing data**, **explicitly absent**, or **not confirmed**. Omission never means absent. Conditional, optional and conflicting descriptions remain unconfirmed. Automated language matching is deliberately conservative, not a substitute for a window sticker/dealer confirmation.
- Successful complete runs replace the snapshot atomically. On partial runs, retain old records for failed URLs and label incomplete coverage. On fatal failures, keep the entire prior snapshot and update only failure metadata. `observed_at` is per-record; `last_success` is the last complete run, not the last attempt. Initial partial data has no complete-success date.
- HTTP 401/403/429 are not retried. Two URLs previously observed returning403 are skipped pending legitimate source access (IDs70163424 and70495962). Other transient errors get at most two retries. Three request workers; no credentials or access-control bypass. Future runs write a gitignored atomic per-record checkpoint and can resume it within4hours after interruption without refetching recorded denials.

## Daily refresh

Daily refresh is intended to be managed by an external task scheduled for **06:00 America/Toronto**, which runs the exporter, validates the snapshot, publishes only `data/inventory.json.gz`, and checks the existing static deployment. The timezone follows daylight saving automatically. This repository does not independently schedule refreshes or require a new hosting service. Until that external task is created and verified, automatic refresh is not enabled. Scheduling and hosting can be delayed;06:00 is the target start, not an exact publication guarantee.

The included GitHub workflow only runs safety tests; it cannot publish or refresh inventory. No duplicate recurring job is installed.
The interface calculates staleness locally one hour after the next expected06:00 refresh even if an outage prevents writing failure metadata. No refresh has been deployed or scheduled merely by having these local files.

## Fixture

`tests/fixtures/official-silverado.json` is a reduced, real public listing extract fetched2026-10-27, VIN1GCPKBEK3TZ504797 / stock26-1416. Used only in tests, never loaded as demo/live inventory. No customer data or internal pricing retained.

## Compressed delivery

The browser loads `data/inventory.json.gz` (~251 KB for the initial283-vehicle snapshot), using native `DecompressionStream`. Unsupported older browsers receive a clear upgrade message and the official Myers inventory link, never invented results. Hosts that already decode gzip are also supported. No third-party decompression library is required.

Both refresh and successful validation write deterministic gzip (mtime0, compact UTF-8 JSON) atomically. On a fresh checkout with no raw working file, the exporter automatically reads/decompresses the committed gzip snapshot before refreshing, preserving previous good records on failures. Only commit the `.gz` artifact; do not stage the raw JSON or hidden recovery checkpoints. The daily automation should run refresh, then `python scripts/validate_snapshot.py`, and publish `data/inventory.json.gz` even when a partial refresh honestly returns exit1.
