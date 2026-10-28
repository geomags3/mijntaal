const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function makeDictionary(fetch) {
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
        fetch,
        require: (name) => load(path.resolve(path.dirname(file), name)),
      },
    );
    return exports;
  }
  return load('lib/local-dictionary');
}
const fileResponse = (url) =>
  Response.json(JSON.parse(fs.readFileSync(path.join(root, 'public', url), 'utf8')));
(async () => {
  const noSupplement = makeDictionary(async (url) => {
    if (url.startsWith('/dictionary/v2/')) throw Error('supplement unavailable');
    return fileResponse(url);
  });
  const huis = await noSupplement.localLookup('huis');
  assert.equal(huis.found, true);
  assert.equal(huis.article, 'het');
  assert.ok((await noSupplement.suggest('huiswer')).some((item) => item.word === 'huiswerk'));
  assert.equal((await noSupplement.localLookup('gebeld')).lemma, 'bellen');
  await assert.rejects(noSupplement.localLookup('zzzz-nonexistent'), /supplement unavailable/);
  const noDetails = makeDictionary(async (url) => {
    if (url.startsWith('/dictionary/v1/') || /\/v2\/nl-/.test(url))
      throw Error('learner details unavailable');
    return fileResponse(url);
  });
  const candidates = await noDetails.localCandidates('homework', 'en');
  const huiswerk = candidates.find((candidate) => candidate.lemma === 'huiswerk');
  assert.ok(huiswerk?.found);
  assert.equal(huiswerk.senses[0].meaning, 'homework');
  assert.equal(huiswerk.article, '');
  assert.equal(huiswerk.forms.length, 0);
  assert.ok(huiswerk.provenance.length);
  const noEnglish = makeDictionary(async (url) => {
    if (/\/v2\/en-/.test(url)) throw Error('English dictionary unavailable');
    return fileResponse(url);
  });
  await assert.rejects(
    noEnglish.localCandidates('homework', 'en'),
    /English dictionary unavailable/,
  );
  console.log(
    'PASS: supplementary outages preserve known Dutch entries, unavailable optional Dutch details preserve verified English translations, and failed English lookup shards remain errors.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
