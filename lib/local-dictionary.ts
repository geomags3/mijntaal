import { dictionaryEntry } from './dictionary-entry';
import type { Entry } from './server/dictionary';
export type DictionaryLanguage = 'nl' | 'en';
type Suggestion = { word: string; meaning: string; pos: string };
type TranslationRecord = {
  word: string;
  pos: string;
  sense: string;
  targets: string[];
  source: string;
  lexentry: string;
  senseNumber: string;
  score: number;
};
export type LocalEntry = Entry & {
  provenance?: { source: string; lexentry: string; sense: string; language: DictionaryLanguage }[];
};
const cache = new Map<string, Promise<any>>();
async function data(path: string) {
  if (!cache.has(path)) {
    const p = fetch('/dictionary/' + path)
      .then((r) => {
        if (!r.ok) throw Error('The dictionary could not load. Please try again.');
        return r.json();
      })
      .catch((e) => {
        cache.delete(path);
        throw e;
      });
    cache.set(path, p);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return cache.get(path)!;
}
const normal = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase('nl');
function bucket(word: string) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(word)) h = Math.imul(h ^ b, 16777619) >>> 0;
  return (h % 256).toString(16).padStart(2, '0');
}
async function rows(word: string) {
  return (await data('v1/' + bucket(word) + '.json'))[word] || [];
}
async function translations(
  word: string,
  language: DictionaryLanguage,
): Promise<TranslationRecord[]> {
  return (await data('v2/' + language + '-' + bucket(word) + '.json'))[word] || [];
}
async function dutchLookup(query: string): Promise<LocalEntry> {
  const word = normal(query);
  const [rr, supplement] = await Promise.all([
    rows(word),
    translations(word, 'nl').then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: [] as TranslationRecord[], error }),
    ),
  ]);
  if (supplement.error && !rr.length) throw supplement.error;
  const additional = supplement.value;
  let entry: LocalEntry = dictionaryEntry(query, rr);
  const onlyForms =
    rr.length && rr.every((r: any) => (r.senses || []).every((s: any) => s.form_of || s.alt_of));
  if (onlyForms) {
    const parent = rr
      .flatMap((r: any) =>
        r.senses.flatMap((s: any) => (s.form_of || s.alt_of || []).map((v: any) => v.word)),
      )
      .find((w: string) => w && normal(w) !== word);
    if (parent) {
      const pp = await rows(normal(parent));
      if (pp.length) {
        const original = dictionaryEntry(query, rr);
        entry = dictionaryEntry(query, pp);
        entry.queryForm = {
          text: query.trim().normalize('NFC'),
          label:
            original.senses[0]?.usage?.includes('participle') &&
            original.senses[0]?.usage?.includes('past')
              ? 'past participle'
              : original.senses[0]?.usage || 'word form',
          ipa: original.ipa,
          partOfSpeech: original.partOfSpeech,
          senses: original.senses,
        };
        entry.queryExplanation = query + ' is a form of ' + parent + '.';
      }
    }
  }
  // Form-specific meanings must remain distinct from the parent lemma's meanings.
  // Keep existing Kaikki senses/grammar first and never equate independently extracted senses.
  if (additional.length && !entry.queryForm) {
    const relevant = entry.found
      ? additional.filter((record) => !record.pos || record.pos === entry.partOfSpeech)
      : additional.filter((record) => record.pos === additional[0].pos);
    const known = new Set(entry.senses.map((sense) => normal(sense.meaning)));
    for (const record of relevant) {
      const meaning = record.targets.join('; ');
      if (!known.has(normal(meaning))) {
        entry.senses.push({ meaning, example: '', exampleTranslation: '', usage: '' });
        known.add(normal(meaning));
      }
    }
    if (!entry.found) {
      entry.found = true;
      entry.lemma = additional[0].word;
      entry.partOfSpeech = additional[0].pos;
      entry.source = 'Wiktionary via WikDict';
      entry.sourceUrl = 'https://www.wikdict.com/nl-en/';
    } else if (relevant.length) entry.source = 'Wiktionary via Kaikki + WikDict';
    entry.provenance = relevant.map((record) => ({
      source: record.source,
      lexentry: record.lexentry,
      sense: record.sense,
      language: 'nl',
    }));
  }
  return entry;
}
/** English candidates remain Dutch entries: callers can use existing save and audio flows. */
export async function localCandidates(
  query: string,
  language: DictionaryLanguage = 'nl',
): Promise<LocalEntry[]> {
  if (language === 'nl') {
    const entry = await dutchLookup(query);
    return entry.found ? [entry] : [];
  }
  const records = await translations(normal(query), 'en');
  const candidates = new Map<string, { word: string; records: TranslationRecord[] }>();
  for (const record of records) {
    for (const target of record.targets) {
      const key = normal(target);
      if (!candidates.has(key) && candidates.size < 12)
        candidates.set(key, { word: target, records: [] });
      candidates.get(key)?.records.push(record);
    }
  }
  return Promise.all(
    Array.from(candidates.values()).map(async ({ word, records: matches }) => {
      // The English bilingual record is sufficient for a valid candidate. Dutch learner
      // details are optional and may be temporarily unavailable independently.
      const entry = await dutchLookup(word).catch(() => dictionaryEntry(word, []));
      const seen = new Set<string>();
      const senses = matches
        .filter((record) => {
          const key = record.word + '\0' + record.sense;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 6)
        .map((record) => ({
          meaning: record.word,
          usage: record.sense,
          example: '',
          exampleTranslation: '',
        }));
      return {
        ...entry,
        found: true,
        // A target can itself be inflected. Never save the English query or substitute its lemma.
        lemma: word,
        queryForm: undefined,
        queryExplanation: '',
        senses,
        source: entry.found
          ? 'WikDict translations + Kaikki/WikDict Dutch details'
          : 'Wiktionary via WikDict',
        sourceUrl: 'https://www.wikdict.com/en-nl/',
        provenance: matches.map((record) => ({
          source: record.source,
          lexentry: record.lexentry,
          sense: record.sense,
          language: 'en' as const,
        })),
      };
    }),
  );
}
export async function localLookup(
  query: string,
  language: DictionaryLanguage = 'nl',
): Promise<LocalEntry> {
  if (language === 'nl') return dutchLookup(query);
  return (await localCandidates(query, language))[0] || dictionaryEntry(query, []);
}
function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, prev[j + 1] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
    prev = next;
  }
  return prev[b.length];
}
export async function suggest(
  query: string,
  language: DictionaryLanguage = 'nl',
): Promise<Suggestion[]> {
  const q = normal(query);
  if (!q || q.length > 64) return [];
  const letter = Array.from(q)[0];
  const combined = await data('v2/manifest.json').catch((error) => {
    if (language === 'en') throw error;
    return null;
  });
  const lists: string[][][] = [];
  if (language === 'nl') {
    const manifest = await data('v1/manifest.json');
    if (manifest.letters[letter]) lists.push(await data('v1/' + manifest.letters[letter]));
  }
  const file = combined?.languages[language].letters[letter];
  if (file) {
    try {
      lists.push(await data('v2/' + file));
    } catch (error) {
      if (language === 'en' || !lists.length) throw error;
    }
  }
  // Prefer the existing Dutch display data for duplicate spellings.
  const unique = new Map<string, string[]>();
  for (const row of lists.flat()) if (!unique.has(normal(row[0]))) unique.set(normal(row[0]), row);
  const list = Array.from(unique.values());
  let choices = list.filter((r) => normal(r[0]).startsWith(q));
  choices.sort(
    (a, b) =>
      (normal(a[0]) === q ? -1 : normal(b[0]) === q ? 1 : 0) ||
      a[0].length - b[0].length ||
      a[0].localeCompare(b[0]),
  );
  if (!choices.length && q.length >= 3 && q.length <= 35 && !q.includes(' ')) {
    choices = list
      .filter((r) => Math.abs(r[0].length - q.length) <= 2)
      .map((r) => ({ r, d: distance(q, normal(r[0])) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map((x) => x.r);
  }
  return choices.slice(0, 7).map((r) => ({ word: r[0], meaning: r[1], pos: r[2] }));
}
