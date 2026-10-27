/** Presentation of existing dictionary evidence only; never conjugates or completes a form. */
export type WordForm = { label: string; value: string };
export type FormGroup = { label: string; values: string[] };
export const pronouns = [
  'ik',
  'jij / je',
  'u',
  'hij / zij / het',
  'wij / we',
  'jullie',
  'zij / ze',
];
const technical = new Set(['class', 'table-tags', 'inflection-template']);
const unusual = new Set([
  'archaic',
  'subjunctive',
  'flanders',
  'colloquial',
  'dialectal',
  'obsolete',
  'dated',
  'rare',
  'majestic',
  'alternative',
]);
const canonical = (s: string) => s.normalize('NFC').trim().toLocaleLowerCase('nl');
export const formTags = (label: string) =>
  label
    .split(/\s*[·,;|]\s*/)
    .map(canonical)
    .filter(Boolean);
export function cleanForms(input: unknown): WordForm[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>(),
    result: WordForm[] = [];
  for (const f of input) {
    if (typeof f?.label !== 'string' || typeof f?.value !== 'string') continue;
    const label = f.label.trim().slice(0, 240),
      value = f.value.trim().normalize('NFC').slice(0, 240),
      tags = formTags(label);
    if (!value || ['-', '—'].includes(value) || tags.some((t) => technical.has(t))) continue;
    const key = canonical(value) + '|' + [...new Set(tags)].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ label, value });
  }
  return result;
}
export function structureForms(input: unknown, pos: string, lemma = '', article = '') {
  const forms = cleanForms(input),
    groups: FormGroup[] = [],
    other: WordForm[] = [],
    tables: { label: string; rows: { pronoun: string; present: string[]; past: string[] }[] }[] =
      [];
  const add = (label: string, value: string) => {
    let g = groups.find((g) => g.label === label);
    if (!g) {
      g = { label, values: [] };
      groups.push(g);
    }
    if (!g.values.includes(value)) g.values.push(value);
  };
  const part = canonical(pos);
  const verb = ['verb', 'v'].includes(part),
    noun = ['noun', 'n'].includes(part),
    adj = ['adj', 'adjective'].includes(part);
  if (noun && lemma) add('Singular', article ? article + ' ' + lemma : lemma);
  const standard = new Set([
    'present',
    'past',
    'singular',
    'plural',
    'first-person',
    'second-person',
    'third-person',
    'formal',
    'main-clause',
    'subordinate-clause',
    'indicative',
  ]);
  for (const f of forms) {
    const tags = formTags(f.label),
      has = (t: string) => tags.includes(t);
    if (tags.some((t) => unusual.has(t))) {
      other.push(f);
      continue;
    }
    if (verb) {
      const simple = tags.every((t) => standard.has(t)),
        tense =
          has('present') && !has('past')
            ? 'present'
            : has('past') && !has('present')
              ? 'past'
              : null;
      const persons = ['first-person', 'second-person', 'third-person'].filter(has),
        number = has('singular') !== has('plural');
      if (
        simple &&
        tense &&
        number &&
        persons.length <= 1 &&
        !(has('main-clause') && has('subordinate-clause')) &&
        (!has('formal') || (has('second-person') && has('singular')))
      ) {
        const rows = has('singular')
          ? has('first-person')
            ? [0]
            : has('second-person')
              ? [has('formal') ? 2 : 1]
              : has('third-person')
                ? [3]
                : []
          : has('first-person')
            ? [4]
            : has('second-person')
              ? [5]
              : has('third-person')
                ? [6]
                : [4, 5, 6];
        if (rows.length) {
          const label = has('subordinate-clause') ? 'Subordinate clause' : 'Main clause';
          let table = tables.find((t) => t.label === label);
          if (!table) {
            table = {
              label,
              rows: pronouns.map((pronoun) => ({ pronoun, present: [], past: [] })),
            };
            tables.push(table);
          }
          for (const i of rows) {
            const cell = table.rows[i][tense];
            if (!cell.includes(f.value)) cell.push(f.value);
          }
          continue;
        }
      }
      if (tags.length === 1 && has('infinitive')) {
        add('Infinitive', f.value);
        continue;
      }
      if (
        has('participle') &&
        tags.every((t) => ['participle', 'past', 'present', 'main-clause'].includes(t)) &&
        has('past') !== has('present')
      ) {
        add(has('past') ? 'Past participle' : 'Present participle', f.value);
        continue;
      }
      if (
        has('imperative') &&
        tags.every((t) => ['imperative', 'present', 'singular', 'main-clause'].includes(t))
      ) {
        add('Imperative', f.value);
        continue;
      }
    }
    if (noun) {
      if (
        tags.every((t) =>
          [
            'plural',
            'singular',
            'diminutive',
            'neuter',
            'common',
            'masculine',
            'feminine',
          ].includes(t),
        )
      ) {
        if (has('diminutive')) {
          add(has('plural') ? 'Diminutive plural' : 'Diminutive', f.value);
          continue;
        }
        if (has('plural') !== has('singular')) {
          add(has('plural') ? 'Plural' : 'Singular', f.value);
          continue;
        }
      }
    }
    if (adj) {
      if (tags.length === 1 && ['positive', 'comparative', 'superlative'].includes(tags[0])) {
        add(tags[0][0].toUpperCase() + tags[0].slice(1), f.value);
        continue;
      }
      if (
        has('positive') &&
        tags.every((t) => ['adverbial', 'positive', 'predicative'].includes(t))
      ) {
        add('Positive', f.value);
        continue;
      }
    }
    other.push(f);
  }
  tables.sort((a, b) => (a.label === 'Main clause' ? -1 : b.label === 'Main clause' ? 1 : 0));
  const order = verb
    ? ['Infinitive', 'Past participle', 'Present participle', 'Imperative']
    : noun
      ? ['Singular', 'Plural', 'Diminutive', 'Diminutive plural']
      : ['Positive', 'Comparative', 'Superlative'];
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return { tables, groups, other };
}
