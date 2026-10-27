const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..'),
  modules = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require(name) {
        return name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name);
      },
    },
  );
  return exports;
}
const { cleanForms, structureForms } = load('lib/word-forms'),
  { dictionaryEntry } = load('lib/dictionary-entry'),
  { dictionarySnapshot } = load('lib/dictionary-snapshot');
function entry(word) {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(word)) h = Math.imul(h ^ b, 16777619) >>> 0;
  const rows = JSON.parse(
    fs.readFileSync(
      path.join(root, 'public/dictionary/v1/' + (h % 256).toString(16).padStart(2, '0') + '.json'),
    ),
  )[word];
  return dictionaryEntry(word, rows);
}
function model(word) {
  const e = entry(word);
  return structureForms(e.forms, e.partOfSpeech, e.lemma, e.article);
}
const shine = model('schijnen'),
  table = shine.tables[0];
assert.equal(table.rows[0].present.join(','), 'schijn');
assert.equal(
  table.rows[1].present.join(','),
  'schijnt,schijn',
  'preserve ambiguous variants, do not guess inversion',
);
assert.equal(table.rows[2].present.join(','), 'schijnt');
assert.equal(table.rows[3].past.join(','), 'scheen');
for (const i of [4, 5, 6]) assert.equal(table.rows[i].past.join(','), 'schenen');
assert.equal(shine.groups.find((g) => g.label === 'Past participle').values.join(','), 'geschenen');
assert.ok(shine.other.some((f) => f.label.includes('Flanders')));
assert.ok(!entry('schijnen').forms.some((f) => f.label === 'class'));
const call = entry('opbellen'),
  conjugation = model('opbellen');
assert.equal(conjugation.tables.length, 2);
assert.equal(conjugation.tables[0].rows[0].present.join(','), 'bel op');
assert.equal(conjugation.tables[1].rows[0].present.join(','), 'opbel');
assert.equal(
  conjugation.groups.find((g) => g.label === 'Past participle').values.join(','),
  'opgebeld',
);
const snapshot = dictionarySnapshot(call);
assert.ok(snapshot.forms.length > 24);
assert.ok(
  snapshot.forms.some((f) => f.value === 'opgebeld'),
  'keep forms that used to be truncated',
);
assert.equal(
  model('zijn').tables[0].rows[2].present.join(','),
  'bent,is',
  'formal variants retained',
);
assert.equal(
  model('huis')
    .groups.find((g) => g.label === 'Singular')
    .values.join(','),
  'het huis',
);
assert.equal(
  model('huis')
    .groups.find((g) => g.label === 'Plural')
    .values.join(','),
  'huizen',
);
assert.equal(
  model('goed')
    .groups.find((g) => g.label === 'Comparative')
    .values.join(','),
  'beter',
);
const missing = structureForms(
  [{ label: 'present · first-person · singular', value: 'x' }],
  'verb',
);
assert.equal(missing.tables[0].rows[1].present.length, 0);
assert.equal(missing.tables[0].rows[0].past.length, 0);
assert.equal(missing.groups.length, 0, 'no inferred participle or infinitive');
const messy = [
  { label: 'plural · past', value: 'x' },
  { label: 'past · plural', value: 'x' },
  { label: 'class', value: '1' },
  { label: 'inflection-template', value: 'nl-conj-wk' },
  null,
  { label: 'past', value: '—' },
];
assert.equal(cleanForms(messy).length, 1);
const unknown = structureForms([{ label: 'past tense (informal)', value: 'mystery' }], 'verb');
assert.equal(unknown.tables.length, 0);
assert.equal(unknown.other[0].value, 'mystery');
assert.equal(
  structureForms([{ label: 'present · singular · first-person · unknown-tag', value: 'x' }], 'verb')
    .tables.length,
  0,
  'never silently ignore unknown qualifiers',
);
// Shared component output: valid semantic table, selected form, accessible controls and collapsed variants.
const WordForms = load('app/components/word-forms').default;
let html = renderToStaticMarkup(
  React.createElement(WordForms, {
    forms: entry('schijnen').forms,
    partOfSpeech: 'verb',
    lemma: 'schijnen',
    selectedForm: 'schijnt',
    onSpeak() {},
  }),
);
assert.ok(html.includes('<table'));
assert.ok(html.includes('scope="row"'));
assert.ok(html.includes('word-form-value selected'));
assert.ok(html.includes('aria-label="Listen to schijnt"'));
assert.ok(html.includes('Other forms'));
assert.ok(!html.includes('<details open'));
assert.ok(!html.includes('>class<'));
assert.ok(!html.includes('>Future<'));
html = renderToStaticMarkup(
  React.createElement(WordForms, {
    forms: [{ label: 'present · first-person · singular', value: 'x' }],
    partOfSpeech: 'verb',
  }),
);
assert.ok(html.includes('Not available in dictionary'));
// Exercise the component's per-card switches and pronunciation callback with hook state.
let slots = [],
  cursor = 0,
  spoken = [];
const mockReact = {
  ...React,
  useMemo: (f) => f(),
  useId: () => 'forms-test',
  useState(initial) {
    const n = cursor++;
    if (!(n in slots)) slots[n] = initial;
    return [slots[n], (value) => (slots[n] = value)];
  },
};
const ex = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'app/components/word-forms.tsx'), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: ex,
    require(name) {
      if (name === 'react') return mockReact;
      if (name.startsWith('.')) return load(path.resolve(root, 'app/components', name));
      return require(name);
    },
  },
);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
}
const props = {
    forms: call.forms,
    partOfSpeech: 'verb',
    lemma: 'opbellen',
    onSpeak: (text) => spoken.push(text),
  },
  render = () => {
    cursor = 0;
    return ex.default(props);
  };
let node = render();
find(node, (n) => n.type === 'button' && n.props.children === 'Past').props.onClick();
node = render();
assert.ok(find(node, (n) => n.type === 'table').props.className.includes('tense-past'));
find(node, (n) => n.type === 'button' && n.props.children === 'Subordinate clause').props.onClick();
node = render();
find(node, (n) => n.props?.['aria-label'] === 'Listen to opbel').props.onClick();
assert.deepEqual(spoken, ['opbel']);
cursor = 0;
const loadingNode = ex.default({ ...props, currentAudio: 'opbel', audioState: 'loading' });
assert.ok(
  find(loadingNode, (n) => n.props?.['aria-label'] === 'Cancel loading opbel').props['aria-busy'],
);
console.log(
  'PASS: real dictionary paradigms, separable verbs, formal/ambiguous variants, regional forms, missing evidence, nouns/adjectives, full snapshots, semantic component, tense/clause switches and pronunciation. No network or AI calls.',
);
