// Synthetic route adapter check: no provider or deployed runtime access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const background = [];
const calls = [];
let release;
const heldWrite = new Promise((resolve) => {
  release = resolve;
});
const exportsObject = {};
const common = {
  body: (request) => request.json(),
  json: (result) => Response.json(result),
  mutation(request) {
    if (request.headers.get('Origin') !== new URL(request.url).origin) throw Error('origin');
  },
  owner(request) {
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) throw Error('auth');
    return owner;
  },
  fail: () => Response.json({ error: 'Rejected' }, { status: 403 }),
};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/lookup/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: exportsObject,
    Response,
    require(name) {
      if (name === 'cloudflare:workers') return { waitUntil: (task) => background.push(task) };
      if (name.endsWith('/common')) return common;
      if (name.endsWith('/dictionary')) return {};
      if (name.endsWith('/translation'))
        return {
          translate: async (...args) => {
            calls.push(args);
            const options = args.at(-1);
            options.timing.setup = 7;
            options.timing.azure = 11;
            options.defer(heldWrite);
            return { found: true, lemma: 'Hallo', translationProvider: 'azure' };
          },
        };
      throw Error('Unexpected module');
    },
  },
);
(async () => {
  const request = (origin = 'https://example.invalid', authenticated = true, live = true) =>
    new Request('https://example.invalid/api/lookup', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(authenticated ? { 'oai-authenticated-user-id': 'synthetic-owner' } : {}),
      },
      body: JSON.stringify({
        mode: 'translate',
        query: 'Hello',
        sourceLanguage: 'en',
        targetLanguage: 'nl',
        owner: 'untrusted',
        live,
      }),
    });
  const response = await exportsObject.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).translationProvider, 'azure');
  assert.equal(calls[0][0], 'synthetic-owner', 'never trusts owner from request body');
  assert.equal(calls[0].at(-1).live, true);
  assert.equal(background.length, 1, 'cache persistence registered with Worker lifecycle');
  assert.match(response.headers.get('Server-Timing'), /setup;dur=7/);
  assert.match(response.headers.get('Server-Timing'), /azure;dur=11/);
  assert.match(response.headers.get('Server-Timing'), /total;dur=\d+/);
  assert.doesNotMatch(response.headers.get('Server-Timing'), /Hello|synthetic-owner/);
  await exportsObject.POST(request('https://example.invalid', true, false));
  assert.equal(calls[1].at(-1).live, false, 'manual Search keeps the fallback mode');
  assert.equal((await exportsObject.POST(request('https://elsewhere.invalid'))).status, 403);
  assert.equal((await exportsObject.POST(request('https://example.invalid', false))).status, 403);
  assert.equal(calls.length, 2, 'unauthorized requests never reach translation');
  release();
  await Promise.all(background);
  console.log(
    'PASS: live/manual route dispatch, Worker cache lifecycle, anonymous timing metrics and trusted request identity. No provider calls.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
