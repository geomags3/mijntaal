import type { Entry } from './server/dictionary';
export type Article = 'de' | 'het' | '';
const normal = (s: string) => s.trim().normalize('NFC').toLocaleLowerCase('nl');
export function nounArticle(selected: string, entry?: Entry | null, contextLemma = ''): Article {
  if (!entry || !/^noun$/i.test(entry.partOfSpeech) || !['de', 'het'].includes(entry.article))
    return '';
  if (contextLemma && normal(contextLemma) !== normal(entry.lemma)) return '';
  const word = normal(selected),
    lemma = normal(entry.lemma);
  if (word === lemma || word === entry.article + ' ' + lemma) return entry.article as Article;
  if (entry.forms.some((f) => /plural/i.test(f.label) && normal(f.value) === word)) return 'de';
  return '';
}
export function nounParts(title: string, body: Record<string, any> = {}) {
  // Explicit articles in an existing title remain authoritative. Never strip articles from sentences.
  const match = /^(de|het)\s+(\S+)$/iu.exec(title.trim());
  if (match) return { article: match[1].toLowerCase() as Article, word: match[2] };
  const article =
    /^\S+$/u.test(title.trim()) && ['de', 'het'].includes(body.article)
      ? (body.article as Article)
      : '';
  return { article, word: title };
}
