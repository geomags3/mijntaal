# Dictionary data pipeline

MijnTaal uses a combined build-time dictionary and small browser-loaded JSON files. It combines the existing Kaikki Dutch learner entries with WikDict's explicit English → Dutch and Dutch → English translation records. It does not translate arbitrary sentences; those use the translation provider.

## Source and runtime formats

`scripts/dictionary-sources.json` pins each source by snapshot, SHA-256, format, language direction, attribution URL and license. The bundled Kaikki v1 snapshot is itself a pinned input: its checksum covers every JSON file in filename order. WikDict is pinned to its June 2026 SQLite export.

The explicit build command creates a local SQLite database with:

- `sources`: source metadata and license references.
- `entries`: complete imported Kaikki records, indexed by language, normalized spelling and part of speech. Original senses, forms, examples and pronunciation are retained in each record's JSON body.
- `translations`: independent bilingual source records, indexed by direction and normalized spelling. Source lexical-entry/sense IDs, original-language sense labels, targets and ranking scores remain attached.

Records from different extractors are not asserted to describe the same sense. Normalization uses Unicode NFC, lowercasing and trimming for lookup; original spellings are retained. Translation targets are deduplicated only within an individual source record. No reverse translations are invented by swapping directions: each supplied direction is imported independently.

The browser export is a **v2 overlay** over the unchanged Kaikki v1 snapshot. This avoids duplicating approximately 97 MiB of existing data while preserving its exact Dutch form-resolution behavior. Both layers together are one dictionary release; the v2 manifest records the v1 source checksum. Do not deploy v2 with a different v1 snapshot.

`public/dictionary/v2` contains direction-specific hash shards and suggestion indexes. Each exported record retains source references and source-language sense labels. Each word exports up to 32 ranked records; the SQLite database retains all imported records. `manifest.json` records schema version, source-lock fingerprint, source notices, counts and per-file checksums. Source scores rank candidates but do not establish translation correctness or equivalence between senses.

## Acquire the pinned inputs

Download these public files into a local directory of your choosing:

- [WikDict English → Dutch](https://download.wikdict.com/dictionaries/sqlite/2_2026-06/en-nl.sqlite3), saved as `en-nl.sqlite3`.
- [WikDict Dutch → English](https://download.wikdict.com/dictionaries/sqlite/2_2026-06/nl-en.sqlite3), saved as `nl-en.sqlite3`.

Downloaded SQLite files are ignored by Git. No automatic network access occurs during the dictionary build or normal application build. The command verifies both checksums before changing generated output. It requires Python 3 with its standard-library SQLite module; no extra Python packages or browser database engine are needed.

```sh
pnpm dictionary:build --wikdict-dir /path/to/pinned-inputs
```

The default local build database is `.dictionary/dictionary.sqlite3` (ignored by Git). Use `--database` for another location. The command writes generated browser assets to `public/dictionary/v2`; it never touches the application D1 database, saved material or learning data.

To run in an isolated directory:

```sh
python3 scripts/dictionary-build.py \
  --sources scripts/dictionary-sources.json \
  --kaikki-dir public/dictionary/v1 \
  --wikdict-dir /path/to/pinned-inputs \
  --database /tmp/mijntaal-dictionary.sqlite3 \
  --output /tmp/mijntaal-dictionary-v2
```

The output directory must be absent or carry this generator's manifest. Regeneration replaces its generated contents; never point it at an authored or personal-data directory. Failed checksum validation leaves the last valid export untouched. Generated JSON is deterministic for the same source lock and files. The SQLite build file is a working artifact, not a byte-stable publication format.

## Runtime lookup

`lib/local-dictionary.ts` provides:

- `localLookup(query, language = 'nl')`: one entry, preserving the existing Dutch lookup contract. For English, returns the first ranked Dutch candidate.
- `localCandidates(query, language = 'nl')`: English queries return up to 12 distinct Dutch alternatives. Use this in interfaces so users can choose among ambiguous equivalents. Every result is a Dutch entry, with an English meaning, suitable for existing saving and pronunciation flows.
- `suggest(query, language = 'nl')`: Dutch suggestions combine the original and supplemental indexes; English suggestions use English headwords with Dutch previews.

Dutch learner grammar remains from Kaikki where available. WikDict translation meanings supplement the same Dutch part of speech without replacing existing meanings. Form-specific translations are not mixed into parent-lemma senses. Dutch source-language glosses remain source metadata and are never displayed as English meanings.

English candidates retain the actual Dutch target spelling, even if it is inflected, rather than saving the English query or silently replacing the Dutch target with a base form. Kaikki supplies Dutch details when available. An English source part of speech is not assumed to be the Dutch target's part of speech. No noun article or grammatical detail is invented for missing entries.

Known Kaikki Dutch entries and suggestions remain usable if the supplemental source is unavailable. English bilingual candidates remain usable if optional Dutch learner details cannot be fetched; a failed English translation shard still reports a loading error instead of a false missing-word result.

The runtime loads static shards on demand and caches a bounded number in memory. This is not a full offline installation; no service worker or persistent dictionary download is implied.

## Updates and additional sources

Keep source snapshots immutable. To update a source, inspect its format/license, select an explicit snapshot, record its SHA-256 and metadata in the lock, regenerate, and review counts, coverage and output changes. Updating the existing Kaikki snapshot uses `scripts/import-dictionary.py` first, then updates its source lock; it is separate from a normal application build.

To add a source, add an explicit importer adapter that emits source-preserving entries or translation records, plus synthetic regression fixtures. Existing adapters reject unsupported format identifiers and language pairs rather than guessing. Language codes are stored in the build schema, but the current exported/runtime product supports Dutch and English only. Supporting another language requires an intentional adapter, export and UI change.

Run `pnpm test` and all normal repository checks after regenerating. Focused tests are `tests/dictionary-pipeline.cjs` (synthetic deterministic build/provenance/checksum rejection) and `tests/dictionary-bilingual.cjs` (local English candidates, ambiguous alternatives, exact Dutch saving, articles and form resolution), plus `tests/dictionary-resilience.cjs` for independent source outages. Review real-world vocabulary quality separately; passing tests does not prove source translations are always accurate.

## Attribution and licensing

Keep dataset licensing separate from the application's MIT source license:

- Kaikki's snapshot derives from English Wiktionary. The existing v1 source manifest and [third-party notices](../THIRD_PARTY_NOTICES.md) retain its CC BY-SA/GFDL notices and source-page references.
- WikDict derives from Wiktionary via DBnary and publishes its data under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Preserve attribution and share-alike notices for redistributed source-derived data, including generated JSON. See [WikDict's download/provenance documentation](https://www.wikdict.com/page/download).

Every release manifest carries source notices; source records retain lexical-entry identifiers and glosses. Combining data or converting SQLite to JSON does not remove attribution or license obligations. Saved user meanings are not bulk rewritten during source updates.
