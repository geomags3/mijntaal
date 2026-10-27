import type { Entry } from './server/dictionary';
import { cleanForms } from './word-forms';
export function dictionaryEntry(query: string, rows: any[]): Entry {
  const main = rows.filter((r) => !(r.senses || []).every((s: any) => s.form_of || s.alt_of));
  const row = main[0] || rows[0];
  const senses = (row?.senses || [])
    .slice(0, 6)
    .map((s: any) => {
      const ex = (s.examples || [])[0] || {};
      return {
        meaning: (s.glosses || []).join('; '),
        example: ex.text || '',
        exampleTranslation: ex.english || ex.translation || '',
        usage: (s.tags || []).filter((t: string) => !['form-of'].includes(t)).join(', '),
      };
    })
    .filter((s: any) => s.meaning);
  const forms = cleanForms(
    (row?.forms || [])
      .filter((f: any) => f.form)
      .map((f: any) => ({ label: (f.tags || []).join(' · '), value: f.form })),
  );
  const gender = (row?.senses || []).flatMap((s: any) => s.tags || []);
  const head = (row?.head_templates || []).map((h: any) => h.expansion || '').join(' ');
  const headGender = head.split('(')[0];
  const common =
    gender.some((g: string) => ['masculine', 'feminine', 'common'].includes(g)) ||
    /\b(m|f|c)\b/.test(headGender);
  const neuter = gender.includes('neuter') || /\bn\b/.test(headGender);
  return {
    found: !!row,
    lemma: row?.word || query,
    queryExplanation: '',
    partOfSpeech: row?.pos || '',
    article: row?.pos === 'noun' ? (common ? 'de' : neuter ? 'het' : '') : '',
    ipa: (row?.sounds || []).find((s: any) => s.ipa)?.ipa || '',
    forms,
    senses,
    related: (row?.derived || []).slice(0, 12).map((r: any) => ({ word: r.word, meaning: '' })),
    notes: '',
    source: 'Wiktionary via Kaikki',
    sourceUrl:
      'https://en.wiktionary.org/wiki/' + encodeURIComponent(row?.word || query) + '#Dutch',
  };
}
