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
- Keep all technical specification groups, advertised packages/options and direct source links. Only the explicit “This vehicle has been upgraded…” assertion is parsed from description; generic trim marketing is not used. The separate structured `equipment` section is also retained and parsed. No VIN/trim equipment guessing.
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

## Package verification and completeness

`package_rules.json` contains reviewed Canadian model-year/make/model/trim/package definitions, with exact installed-name/code matching, source URLs, source type, contents-completeness flags and verification dates. Some rules are additionally limited to audited stocks. Manufacturer-hosted evidence and authorized-dealer factory-options evidence are labeled separately. Neither a trim alone nor a vague “Premium Package” establishes a differently named package. Explicit absence and production/deletion uncertainty are never overwritten by a general package rule.

Every saved vehicle has a package audit. Full source-listing definitions are shown verbatim; researched package items are expanded with links. Partial, unresolved and title-only claims remain visible, including new names encountered on future refreshes. “No named packages” is different from “all packages verified.” `package_review_flags.json` records VIN-scoped unresolved research findings. `python scripts/reclassify.py` reapplies current rules to saved evidence without altering observation dates or accessing the network.

## Exact paint and installed engine

Each record preserves a sanitized, VIN-specific vehicle-description excerpt, manufacturer/general colour fields, installed engine/displacement/cylinders/fuel fields and any supplied window-sticker URL in `source_facts`. Financing links and generic trim marketing are not needed. Paint names come from the exact colour field or vehicle-specific description; broad shades remain clearly labeled as generic. Engine displacement, configuration, cylinders, fuel, horsepower and RPM are shown only when supported by installed-vehicle evidence. Conflicts and missing fields stay explicit; available engines for a trim are not treated as installed engines.

The dashboard supports two-vehicle exact VIN/stock comparison with differences-only mode. It uses no photos, external fonts, analytics, customer data or new paid services. Tests include `node --test tests/frontend.test.cjs` in addition to Python safety tests and gzip validation.

## Find by preferences (reverse lookup)

The top navigation separates exact **Vehicle lookup** from **Find by preferences**. Both use the same saved inventory and share the existing two-vehicle comparison. Neither view renders the catalogue on initial load or reset; preference search requires at least one selected filter and reveals compact results 12 at a time, ordered by advertised price (unknown prices last). Details open without losing the shortlist, and returning to it restores keyboard focus. Navigation preserves searches and supports the `#lookup` / `#preferences` browser history destinations.

Filters support inclusive minimum/maximum advertised CAD prices, vehicle type, New/Used/Demo, exact confirmed seating capacity, listed exterior colour family, make/model and all required checklist features. Every selected criterion is ANDed. Unknown, absent, conflicting and malformed facts never satisfy their corresponding requirement:

- Prices must be finite positive numeric listing prices; missing, string or zero prices do not satisfy a budget. Inputs accept whole CAD dollars, including a zero bound. Prices are not finance payments; confirm taxes, fees and availability.
- Vehicle types come only from explicit `specs["Body Style"]`: Truck; SUV; Car (including Sedan/Coupe/Convertible/Hatchback/Wagon); Van/Minivan; or an explicit Other. Unknown styles are not inferred from model names.
- Exterior colour uses the saved general exterior colour family, with Gray normalized to Grey; official paint names remain on cards and in details. No colour is inferred from paint names or interior trim. Paint conflicts do not match colour requirements.
- Seating requires `seating.status == "listed"` and an exact positive integer capacity; neither conditional nor conflicting values qualify. Feature requirements require `status == "present"`, including previously verified installed-package evidence. Every selected feature is required.
- Demo requires `demo_status == "listed_demo"` and can overlap the listing’s New/Used designation. Make/model options come from saved listing fields, not free-text matching.

Changing a preference clears stale matches until the form is submitted again. Reset clears preferences/results but leaves comparison selections intact. No matches does not prove the dealership has no suitable vehicle: incomplete saved facts are deliberately excluded. Result cards retain per-listing observation timestamps and the existing inventory-freshness disclosure; this is not real-time availability.

Run `node --test tests/frontend.test.cjs` for dependency-free DOM-contract and matching regression tests (including real compressed data, repeated navigation, details/back, resets, comparison and failure states). These tests do not replace visual browser/device QA.
