const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict');
function load(file) {
  const output = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file + '.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: output, require: (name) => load(path.join(path.dirname(file), name)) },
  );
  return output;
}
const { buildCollectionIndex, collectionBookmark, collectionDutch } = load('lib/collection-index');
const index = buildCollectionIndex([
  { id: '1', nl: 'de fiets', en: 'the bicycle', lemma: 'fiets' },
  { id: '2', nl: 'gaan', en: 'to go', lemma: 'gaan' },
  { id: '3', nl: 'café', en: 'cafe', lemma: 'café' },
  { id: '4', nl: 'dat valt mee', en: 'that is not so bad', lemma: '' },
]);
assert.equal(index.has('Fiets,'), true);
assert.equal(index.has('fietsen'), false, 'do not invent learned inflections');
assert.equal(index.has('cafe\u0301!'), true);
assert.equal(index.has('dat'), false, 'a saved phrase does not mark its individual words');
assert.equal(index.status('de fiets', 'The Bicycle'), 'saved');
assert.equal(index.status(collectionDutch('fiets', 'de'), 'the bicycle'), 'saved');
assert.equal(index.status('de fiets', 'bike'), 'meaning');
assert.equal(index.status('ging', 'went', 'gaan'), 'form');
assert.equal(index.status('liep', 'walked', 'lopen'), 'new');
assert.equal(
  index.status('het fiets', 'the bicycle', 'fiets'),
  'form',
  'different noun articles are not an exact duplicate',
);
assert.equal(collectionDutch('de fiets', 'de'), 'de fiets');
assert.equal(
  collectionBookmark(index, 'de fiets', 'the bicycle', 'fiets', 'Save', false).disabled,
  true,
);
assert.equal(collectionBookmark(index, 'de fiets', 'bike', 'fiets', 'Save', false).disabled, false);
assert.equal(
  collectionBookmark(index, 'ging', 'went', 'gaan', 'Save', false)['data-collection-state'],
  'form',
);
console.log(
  'PASS: saved meaning, other meaning/form, noun articles, Unicode, punctuation and conservative reader underlines.',
);

// The real hook refreshes after saves and rejects stale reads/unmounted responses.
(async () => {
  let rows = [],
    effect;
  const listeners = new Map(),
    pending = [];
  const hook = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('app/components/use-collection-index.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports: hook,
      require(name) {
        if (name === 'react')
          return {
            useState: () => [rows, (value) => (rows = value)],
            useMemo: (fn) => fn(),
            useEffect: (fn) => (effect = fn),
          };
        if (name.includes('client-data'))
          return {
            readJson: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
          };
        return load('lib/collection-index');
      },
      window: {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
      },
      document: { visibilityState: 'visible' },
      setInterval: () => 1,
      clearInterval() {},
    },
  );
  hook.default();
  const cleanup = effect();
  pending[0].resolve([{ id: '1', nl: 'de fiets', en: 'bicycle', lemma: 'fiets' }]);
  await new Promise(setImmediate);
  assert.equal(hook.default().has('fiets'), true);
  listeners.get('focus')();
  listeners.get('dutch-external-data')();
  pending[2].resolve([]);
  await new Promise(setImmediate);
  pending[1].resolve([{ id: '1', nl: 'de fiets', en: 'bicycle', lemma: 'fiets' }]);
  await new Promise(setImmediate);
  assert.equal(
    hook.default().has('fiets'),
    false,
    'old response cannot resurrect an archived word',
  );
  listeners.get('focus')();
  cleanup();
  pending[3].resolve([{ id: '2', nl: 'huis', en: 'house', lemma: 'huis' }]);
  await new Promise(setImmediate);
  assert.equal(hook.default().has('huis'), false, 'cleanup ignores late account data');
  assert.equal(listeners.size, 0);
  hook.default(false);
  effect();
  assert.equal(pending.length, 4, 'hidden views do not poll');
  console.log(
    'PASS: collection hints refresh after saves, ignore stale responses and clean up hidden views.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
