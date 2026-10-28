const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (!file.endsWith('.ts')) file += '.ts';
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      TextEncoder,
      fetch: async (url) =>
        Response.json(JSON.parse(fs.readFileSync(path.join(root, 'public', url), 'utf8'))),
      require: (name) => load(path.resolve(path.dirname(file), name)),
    },
  );
  return exports;
}
(async () => {
  const dictionary = load('lib/local-dictionary');
  const save = load('lib/search-form').searchMeaningMaterial;
  const candidates = await dictionary.localCandidates('homework', 'en');
  const huiswerk = candidates.find((candidate) => candidate.lemma === 'huiswerk');
  assert.ok(huiswerk);
  assert.equal(huiswerk.article, 'het');
  assert.equal(huiswerk.senses[0].meaning, 'homework');
  assert.equal(huiswerk.queryForm, undefined);
  assert.ok(huiswerk.provenance.every((origin) => origin.language === 'en'));
  const material = save(huiswerk, huiswerk.senses[0]);
  assert.equal(material.title, 'het huiswerk');
  assert.equal(material.body.en, 'homework');
  assert.equal(material.body.selectedForm, 'huiswerk');
  const ambiguous = await dictionary.localCandidates('bank', 'en');
  assert.ok(new Set(ambiguous.map((candidate) => candidate.lemma)).size > 1);
  assert.ok(
    ambiguous.every((candidate) =>
      candidate.senses.every((sense) => sense.meaning.toLowerCase() === 'bank'),
    ),
  );
  assert.equal((await dictionary.localCandidates('zzzz-nonexistent', 'en')).length, 0);
  const suggestions = await dictionary.suggest('homewor', 'en');
  assert.ok(
    suggestions.some(
      (suggestion) => suggestion.word === 'homework' && suggestion.meaning.includes('huiswerk'),
    ),
  );
  // Dutch-only WikDict words now work without sacrificing Kaikki form behavior.
  assert.equal((await dictionary.localLookup('gebeld')).lemma, 'bellen');
  const dutch = await dictionary.localLookup('huiswerk');
  assert.ok(dutch.senses.some((sense) => sense.meaning.includes('homework')));
  console.log(
    'PASS: bilingual candidates, ambiguity, English suggestions and exact Dutch/English saving with preserved noun articles and inflected-form lookup. Local data only.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
