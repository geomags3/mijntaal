import { dictionarySnapshot } from './dictionary-snapshot';
import { nounArticle } from './noun-article';
import type { Entry } from './server/dictionary';
export type FormTranslation = {
  found: boolean;
  english: string;
  formLabel: string;
  baseForm: string;
};
export function searchMeaningMaterial(
  entry: Entry,
  sense: Entry['senses'][number],
  translation?: FormTranslation | null,
  context = '',
) {
  const form = entry.queryForm,
    meaning = form ? (translation?.found ? translation.english : '') : sense.meaning;
  return {
    kind: 'phrase' as const,
    title: form ? form.text : (entry.article ? entry.article + ' ' : '') + entry.lemma,
    body: {
      en: meaning,
      dictionarySnapshot: dictionarySnapshot(entry),
      article: form ? nounArticle(form.text, entry, translation?.baseForm || '') : entry.article,
      lemma: translation?.baseForm || entry.lemma,
      selectedForm: form?.text || entry.lemma,
      partOfSpeech: form?.partOfSpeech || entry.partOfSpeech,
      formLabel: translation?.formLabel || form?.label || '',
      meaningSource: form
        ? meaning
          ? 'OpenAI form translation'
          : 'Dictionary form description'
        : entry.source || 'Dictionary',
      example: form ? context : sense.example,
      exampleTranslation: form ? '' : sense.exampleTranslation,
      notes: form ? form.senses.map((s) => s.meaning).join('; ') : sense.usage,
      forms: entry.forms,
      source: entry.source,
      sourceUrl: form
        ? 'https://en.wiktionary.org/wiki/' + encodeURIComponent(form.text) + '#Dutch'
        : entry.sourceUrl,
    },
  };
}
