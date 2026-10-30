import { nounParts } from './noun-article';
export type CollectionWord = { id: string; nl: string; en: string; lemma: string };
const normalize = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl');
/** Match saved words, not arbitrary inflections or parts of a saved sentence. */
export function collectionFormKey(value: string) {
  return normalize(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
export function collectionDutch(title: string, article = '') {
  const parts = nounParts(title, { article });
  return (parts.article ? parts.article + ' ' : '') + parts.word;
}
export function collectionMeaningKey(value: string) {
  return normalize(value);
}
export function buildCollectionIndex(rows: CollectionWord[]) {
  const forms = new Map<string, Set<string>>(),
    lemmas = new Set<string>(),
    tokens = new Set<string>();
  for (const row of rows) {
    const key = collectionFormKey(row.nl);
    if (!key) continue;
    tokens.add(key);
    const noun = /^(de|het) (\S+)$/u.exec(key);
    if (noun) tokens.add(noun[2]);
    if (!forms.has(key)) forms.set(key, new Set());
    forms.get(key)!.add(collectionMeaningKey(row.en));
    if (row.lemma) lemmas.add(collectionFormKey(row.lemma));
  }
  return {
    has: (nl: string) => tokens.has(collectionFormKey(nl)),
    status(nl: string, en: string, lemma = '') {
      const meanings = forms.get(collectionFormKey(nl));
      if (meanings) return meanings.has(collectionMeaningKey(en)) ? 'saved' : 'meaning';
      return lemma && (lemmas.has(collectionFormKey(lemma)) || forms.has(collectionFormKey(lemma)))
        ? 'form'
        : 'new';
    },
  };
}
export type CollectionIndex = ReturnType<typeof buildCollectionIndex>;
export function collectionBookmark(
  index: CollectionIndex,
  nl: string,
  en: string,
  lemma: string,
  label: string,
  busy: boolean,
  className = 'icon-button',
) {
  const state = index.status(nl, en, lemma);
  const title =
    state === 'saved'
      ? 'Already saved'
      : state === 'meaning'
        ? 'Another meaning saved · add this meaning'
        : state === 'form'
          ? 'Another form saved · add this form'
          : label;
  return {
    className: className + ' collection-bookmark',
    'data-collection-state': state,
    title,
    'aria-label': state === 'new' ? label : title,
    disabled: busy || state === 'saved',
  };
}
