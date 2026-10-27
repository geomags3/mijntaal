const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript');
const exportsObject = {};
let network = 0,
  reply = { ok: true },
  status = 200;
const events = [];
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/client-data.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
  {
    exports: exportsObject,
    Date,
    Map,
    Set,
    Promise,
    Error,
    AbortSignal,
    performance,
    fetch: async () => {
      network++;
      return { ok: status === 200, status, json: async () => reply };
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    window: { dispatchEvent: (e) => events.push(e), location: { reload() {} } },
  },
);
const { JsonCache, clientData, readJson, dataChanged } = exportsObject;
const watchdog = setTimeout(() => {
  console.error('FAIL: cache test stalled');
  process.exit(1);
}, 5000);
(async () => {
  const cache = new JsonCache();
  let calls = 0,
    finish;
  const loader = () => {
    calls++;
    return new Promise((resolve) => (finish = resolve));
  };
  const a = cache.read('library', loader),
    b = cache.read('library', loader);
  assert.equal(calls, 1);
  finish(['one']);
  assert.equal(await a, await b);
  assert.equal(cache.peek('library')[0], 'one');
  await cache.read('library', loader);
  assert.equal(calls, 1);
  // A response that began before a save cannot overwrite the new data.
  const old = cache.read('library', loader, true);
  cache.invalidate(['library']);
  const newer = cache.read('library', async () => ['two'], true);
  await newer;
  finish(['stale']);
  assert.equal((await old)[0], 'two');
  assert.equal(cache.peek('library')[0], 'two');
  cache.invalidate(['library']);
  assert.equal(cache.peek('library')[0], 'two');
  await assert.rejects(
    cache.read('library', async () => {
      throw Error('offline');
    }),
    /offline/,
  );
  assert.equal(cache.peek('library')[0], 'two');
  await cache.read('library', async () => ['three']);
  assert.equal(cache.peek('library')[0], 'three');
  await readJson('/api/text-library');
  await readJson('/api/text-library');
  assert.equal(network, 1);
  clientData.put('/api/materials?kind=phrase&archived=false', [{ id: 'word' }]);
  dataChanged('/api/texts');
  await readJson('/api/text-library');
  assert.equal(network, 2);
  assert.ok(events.some((e) => e.type === 'dutch-external-data'));
  assert.equal(clientData.peek('/api/materials?kind=phrase&archived=false')[0].id, 'word');
  events.length = 0;
  dataChanged('/api/words');
  assert.ok(!events.some((e) => e.type === 'dutch-external-data'));
  status = 401;
  reply = { error: 'Sign in' };
  await assert.rejects(readJson('/api/text-library', true), /Sign in/);
  assert.equal(clientData.peek('/api/materials?kind=phrase&archived=false'), undefined);
  console.log(
    'PASS: shared reads coalesce; warm navigation reuses data without a second request; saves invalidate stale responses; offline refresh retains the view; auth failure clears private cache; own practice sync does not trigger an external reload.',
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
