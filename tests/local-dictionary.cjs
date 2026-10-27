const fs = require('fs'),
  path = require('path'),
  vm = require('vm'),
  ts = require('typescript'),
  assert = require('assert/strict');
const root = path.resolve(__dirname, '..'),
  modules = new Map();
let calls = 0;
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
      crypto,
      TextEncoder,
      fetch: async (url) => {
        calls++;
        return Response.json(JSON.parse(fs.readFileSync(path.join(root, 'public', url), 'utf8')));
      },
      require: (p) => load(path.resolve(path.dirname(file), p)),
    },
  );
  return exports;
}
(async () => {
  const d = load('lib/local-dictionary');
  assert.ok((await d.suggest('ingewikk')).some((x) => x.word === 'ingewikkeld'));
  assert.equal((await d.localLookup('ingewikkeld')).found, true);
  assert.equal((await d.localLookup('gebeld')).lemma, 'bellen');
  assert.equal((await d.localLookup('bellen')).partOfSpeech, 'verb');
  assert.equal((await d.localLookup('huis')).article, 'het');
  assert.equal((await d.localLookup('ochtend')).article, 'de');
  assert.ok((await d.suggest('ingewikeld')).some((x) => x.word === 'ingewikkeld'));
  assert.equal((await d.localLookup('zzzz-nonexistent')).found, false);
  let before = calls;
  await d.localLookup('ingewikkeld');
  assert.equal(calls, before);
  console.log(
    'PASS: snapshot lookup, prefix and typo suggestions, lemma resolution, article, missing words and cached shards. No external requests.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
