"""Build versioned static dictionary shards from Kaikki/wiktextract JSONL.
Usage: python scripts/import-dictionary.py /path/to/snapshot.jsonl
Accepts raw multilingual dumps (filters lang_code=nl) and Dutch-only snapshots.
"""

import collections
import hashlib
import json
import pathlib
import sys
import unicodedata

out = pathlib.Path("public/dictionary/v1")
out.mkdir(parents=True, exist_ok=True)


def norm(w):
    return unicodedata.normalize("NFC", w).lower().strip()


def bucket(w):
    h = 2166136261
    for b in norm(w).encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return format(h % 256, "02x")


rows = collections.defaultdict(list)
for line in open(sys.argv[1]):
    r = json.loads(line)
    if r.get("lang_code") != "nl":
        continue
    w = norm(r.get("word", ""))
    if not w:
        continue
    s = []
    for x in r.get("senses", [])[:8]:
        s.append(
            {k: x[k] for k in ["glosses", "tags", "form_of", "alt_of"] if k in x}
            | {
                "examples": [
                    {k: e[k] for k in ["text", "english", "translation"] if k in e} for e in x.get("examples", [])[:2]
                ]
            }
        )
    rows[w].append(
        {
            "word": r["word"],
            "pos": r.get("pos", ""),
            "senses": s,
            "forms": r.get("forms", []),
            "sounds": [{"ipa": x["ipa"]} for x in r.get("sounds", []) if "ipa" in x],
            "head_templates": [{"expansion": x.get("expansion", "")} for x in r.get("head_templates", [])],
            "derived": r.get("derived", [])[:10],
        }
    )
shards = collections.defaultdict(dict)
index = collections.defaultdict(list)
for w, rr in sorted(rows.items()):
    shards[bucket(w)][w] = rr
    main = [r for r in rr if any(not (s.get("form_of") or s.get("alt_of")) for s in r["senses"])]
    r = (main or rr)[0]
    gloss = next((g for s in r["senses"] for g in s.get("glosses", [])), "")[:180]
    index[w[0]].append([w, gloss, r["pos"]])
manifest = {
    "version": "v1",
    "source": "https://kaikki.org/dictionary/Dutch/",
    "licence": "CC BY-SA / GFDL; see Wiktionary source pages",
    "words": len(rows),
    "letters": {},
    "snapshot": "2026-10-21",
}
for b, v in shards.items():
    (out / (b + ".json")).write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")))
for letter, v in index.items():
    name = "index-" + letter.encode().hex() + ".json"
    (out / name).write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")))
    manifest["letters"][letter] = name
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
print(
    json.dumps({"words": len(rows), "shards": len(shards), "bytes": sum(p.stat().st_size for p in out.glob("*.json"))})
)
