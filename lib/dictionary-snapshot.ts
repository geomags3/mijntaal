import type { Entry } from './server/dictionary';
import { cleanForms } from './word-forms';
const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
/** A bounded record of information already obtained; never changes the selected form or meaning. */
export function dictionarySnapshot(entry?: Entry | null, expectedLemma = '') {
  if (!entry?.found) return undefined;
  if (
    expectedLemma &&
    expectedLemma.normalize('NFC').toLocaleLowerCase('nl') !==
      entry.lemma.normalize('NFC').toLocaleLowerCase('nl')
  )
    return undefined;
  return {
    version: 1,
    queryForm: entry.queryForm
      ? {
          text: text(entry.queryForm.text, 240),
          ipa: text(entry.queryForm.ipa, 150),
          label: text(entry.queryForm.label, 120),
        }
      : undefined,
    lemma: text(entry.lemma, 240),
    partOfSpeech: text(entry.partOfSpeech, 80),
    article: text(entry.article, 3),
    ipa: text(entry.ipa, 150),
    source: text(entry.source, 200),
    sourceUrl: text(entry.sourceUrl, 1000),
    notes: text(entry.notes, 800),
    forms: cleanForms(entry.forms).slice(0, 256),
    senses: entry.senses.slice(0, 6).map((s) => ({
      meaning: text(s.meaning, 500),
      example: text(s.example, 600),
      exampleTranslation: text(s.exampleTranslation, 600),
      usage: text(s.usage, 200),
    })),
    related: entry.related
      .slice(0, 6)
      .map((r) => ({ word: text(r.word, 240), meaning: text(r.meaning, 400) })),
  };
}
export type DictionarySnapshot = NonNullable<ReturnType<typeof dictionarySnapshot>>;
