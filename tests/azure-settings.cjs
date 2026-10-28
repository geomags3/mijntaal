// Synthetic credentials, local SQLite and mocked Microsoft responses only.
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  sqlite = new DatabaseSync(':memory:'),
  modules = new Map();
for (const file of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
function statement(sql, args = []) {
  return {
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    async run() {
      return sqlite.prepare(sql).run(...args);
    },
  };
}
const env = { DB: { prepare: statement }, CREDENTIAL_ENCRYPTION_KEY: '22'.repeat(32) };
let calls = [],
  mode = 'ok';
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
      TextDecoder,
      Uint8Array,
      btoa,
      atob,
      URL,
      Response,
      Request,
      AbortSignal,
      AbortController,
      DOMException,
      fetch: async (url, options) => {
        calls.push({ url, options });
        assert.equal(
          url,
          'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=nl&to=en',
        );
        if (mode === 'network') throw Error('synthetic transport error');
        if (mode === 'unauthorized')
          return Response.json(
            { error: { message: 'never disclose upstream secrets' } },
            { status: 401 },
          );
        if (mode === 'invalid') return Response.json([{ translations: [] }]);
        return Response.json([{ translations: [{ to: 'en', text: 'Hello' }] }]);
      },
      require(name) {
        if (name === 'cloudflare:workers') return { env };
        if (!name.startsWith('.')) return require(name);
        return load(path.resolve(path.dirname(file), name));
      },
    },
  );
  return exports;
}
const req = (body, user = 'alice', origin) =>
  new Request('https://example.test/api/settings', {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(user ? { 'oai-authenticated-user-id': user } : {}),
      ...(origin ? { origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
(async () => {
  const service = load('lib/server/azure-settings'),
    route = load('app/api/settings/route'),
    key = 'synthetic_azure_key_for_tests_only_1234';
  assert.equal(await service.azureCredentials('alice'), null);
  assert.equal((await route.GET(req(null, null))).status, 401);
  let r = await route.POST(
    req(
      { action: 'saveAzureKey', azureKey: key, azureRegion: 'westeurope' },
      'alice',
      'https://evil.test',
    ),
  );
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
  r = await route.POST(
    req({ action: 'saveAzureKey', azureKey: key, azureRegion: 'https://evil.test' }),
  );
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
  r = await route.POST(req({ action: 'saveAzureKey', azureKey: key, azureRegion: 'westeurope' }));
  assert.equal(r.status, 200);
  let result = await r.json();
  assert.equal(result.azureConfigured, true);
  assert.equal(result.translationReady, true);
  assert.ok(!JSON.stringify(result).includes(key));
  const stored = sqlite
    .prepare("SELECT body FROM lookup_cache WHERE owner=? AND id LIKE 'azure-translator-v1:%'")
    .get('alice').body;
  assert.ok(!stored.includes(key));
  assert.equal((await service.azureCredentials('alice')).key, key);
  assert.equal(await service.azureCredentials('bob'), null);
  const bob = await (await route.GET(req(null, 'bob'))).json();
  assert.equal(bob.azureConfigured, false);
  assert.equal(bob.translationReady, false);
  const alice = await (await route.GET(req(null))).json();
  assert.equal(alice.azureRegion, 'westeurope');
  assert.ok(!JSON.stringify(alice).includes('cipher'));
  assert.ok(!JSON.stringify(alice).includes(key));
  const aborted = new AbortController();
  aborted.abort();
  const beforeCancel = calls.length;
  await assert.rejects(() =>
    service.configureAzure(
      'cancelled',
      { action: 'saveAzureKey', azureKey: key, azureRegion: 'westeurope' },
      aborted.signal,
    ),
  );
  assert.equal(calls.length, beforeCancel);
  assert.equal(await service.azureCredentials('cancelled'), null);
  mode = 'network';
  const network = await route.POST(
    req({ action: 'saveAzureKey', azureKey: key, azureRegion: 'westeurope' }, 'network'),
  );
  assert.equal(network.status, 502);
  assert.equal(await service.azureCredentials('network'), null);
  const oldScope = (await service.getAzureSettings('alice')).scope;
  mode = 'unauthorized';
  r = await route.POST(
    req({
      action: 'saveAzureKey',
      azureKey: 'replacement_key_for_test_12345',
      azureRegion: 'eastus',
    }),
  );
  assert.equal(r.status, 401);
  assert.equal((await service.getAzureSettings('alice')).scope, oldScope);
  mode = 'invalid';
  r = await route.POST(req({ action: 'testAzureKey', azureRegion: 'westeurope' }));
  assert.equal(r.status, 502);
  mode = 'ok';
  r = await route.POST(
    req({ action: 'testAzureKey', azureKey: key, azureRegion: 'eastus' }, 'bob'),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).azureConfigured, false);
  assert.equal(await service.azureCredentials('bob'), null, 'test must not save a credential');
  const parsed = JSON.parse(stored);
  sqlite
    .prepare('INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
    .run(
      'azure-translator-v1:' + (await load('lib/server/common').hash('tampered-owner')),
      'tampered-owner',
      JSON.stringify(parsed),
      new Date().toISOString(),
    );
  await assert.rejects(() => service.azureCredentials('tampered-owner'), /could not be read/);
  r = await route.POST(req({ action: 'removeAzureKey' }, 'bob'));
  assert.equal(r.status, 200);
  assert.equal((await service.getAzureSettings('alice')).configured, true);
  sqlite
    .prepare('INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
    .run(
      'azure-translator-v1:' + (await load('lib/server/common').hash('broken')),
      'broken',
      '{invalid json',
      new Date().toISOString(),
    );
  sqlite
    .prepare('INSERT INTO user_settings(owner,key_cipher,preferences,updated) VALUES(?,?,?,?)')
    .run('broken', 'existing-openai-cipher', '{}', new Date().toISOString());
  const brokenResponse = await route.GET(req(null, 'broken'));
  assert.equal(
    brokenResponse.status,
    200,
    'optional broken Azure must not block existing settings',
  );
  const broken = await brokenResponse.json();
  assert.equal(broken.keyConfigured, true);
  assert.equal(broken.translationReady, true);
  assert.equal(broken.azureConfigured, false);
  assert.match(broken.azureError, /Save the key and region again/);
  await assert.rejects(() => service.azureCredentials('broken'), /could not be read/);
  const before = calls.length;
  r = await route.POST(req({ action: 'removeAzureKey' }));
  assert.equal(r.status, 200);
  assert.equal(calls.length, before);
  assert.equal(await service.azureCredentials('alice'), null);
  assert.equal(JSON.parse(calls[0].options.body)[0].Text, 'Hallo');
  console.log(
    'PASS: encrypted Azure settings, owner isolation, trusted mutations, redacted status, validation, failed-save preservation, unsaved test, owner-bound ciphertext and removal. No provider access tested.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
