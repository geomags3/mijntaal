# Third-party notices

## Application code

Original MijnTaal application code is distributed under the MIT License in `LICENSE`. This does not relicense third-party content or dependencies.

## Sites integration

`scripts/vite/sites-vite-plugin.ts` is vendored from the OpenAI Sites integration. Preserve its MIT notice in `scripts/vite/sites-vite-plugin.LICENSE` when redistributing that code.

## Dictionary

`public/dictionary/v1` contains a processed Dutch dictionary snapshot from [Kaikki](https://kaikki.org/dictionary/Dutch/), derived from English Wiktionary. Its source, snapshot date and entry count are recorded in `manifest.json`. Preserve source links and attribution in the interface and redistributed data. The source identifies CC BY-SA and GFDL terms; consult [Wiktionary copyright and licensing](https://en.wiktionary.org/wiki/Wiktionary:Copyrights) and the source entry histories for applicable terms. Application MIT licensing does not replace dictionary licensing.

`scripts/import-dictionary.py` regenerates the processed representation from a supplied Dutch JSONL dump. The upstream dump is not included. Short non-Latin quotations can occur inside English dictionary definitions; these are source dictionary content, not an additional application language.

## Dependencies

Installed packages retain their own licenses and notices. Their exact resolved versions and integrity values are recorded in `pnpm-lock.yaml`. Do not redistribute dependency binaries without preserving applicable notices.
