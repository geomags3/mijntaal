import { dictionaryEntry } from './dictionary-entry';
import type { Entry } from './server/dictionary';
type Suggestion = { word: string; meaning: string; pos: string };
const base = '/dictionary/v1/';
const cache = new Map<string, Promise<any>>();
async function data(name: string) {
  if (!cache.has(name)) {
    const p = fetch(base + name)
      .then((r) => {
        if (!r.ok) throw Error('The dictionary could not load. Please try again.');
        return r.json();
      })
      .catch((e) => {
        cache.delete(name);
        throw e;
      });
    cache.set(name, p);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return cache.get(name)!;
}
const normal = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase('nl');
async function rows(word: string) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(word)) h = Math.imul(h ^ b, 16777619) >>> 0;
  const hash = (h % 256).toString(16).padStart(2, '0');
  return (await data(hash + '.json'))[word] || [];
}
export async function localLookup(query: string): Promise<Entry> {
  const word = normal(query);
  const rr = await rows(word);
  let entry = dictionaryEntry(query, rr);
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
  return entry;
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
export async function suggest(query: string): Promise<Suggestion[]> {
  const q = normal(query);
  if (!q || q.length > 64) return [];
  const manifest = await data('manifest.json');
  const file = manifest.letters[Array.from(q)[0]];
  if (!file) return [];
  const list: string[][] = await data(file);
  let choices = list.filter((r) => r[0].startsWith(q));
  choices.sort(
    (a, b) =>
      (a[0] === q ? -1 : b[0] === q ? 1 : 0) ||
      a[0].length - b[0].length ||
      a[0].localeCompare(b[0]),
  );
  if (!choices.length && q.length >= 3 && q.length <= 35 && !q.includes(' ')) {
    choices = list
      .filter((r) => Math.abs(r[0].length - q.length) <= 2)
      .map((r) => ({ r, d: distance(q, r[0]) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map((x) => x.r);
  }
  return choices.slice(0, 7).map((r) => ({ word: r[0], meaning: r[1], pos: r[2] }));
}
