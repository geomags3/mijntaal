// Synthetic providers and in-memory rows: never contacts Azure or OpenAI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const rows = new Map();
let azureCalls = 0,
  aiCalls = 0,
  mode = 'ok',
  counter = 0,
  onAzure;
let configured = true,
  aiConfigured = true;
let sourceBody = {
  _version: 1,
  segments: [{ nl: 'De bank.' }, { nl: 'Het huis.', en: 'The house.' }],
};
const common = {
  AppError: class extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  },
  hash: async (s) => createHash('sha256').update(s).digest('hex'),
  limit: async () => {},
  db: () => ({
    prepare(sql) {
      let args;
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          if (sql.includes('FROM materials'))
            return args[1] === 'alice'
              ? { id: 'text', title: 'Test', kind: 'text', body: JSON.stringify(sourceBody) }
              : null;
          return rows.get(args.join('|')) || null;
        },
        async all() {
          return {
            results: [...rows.entries()].filter(([k]) => k.endsWith('|alice')).map(([, v]) => v),
          };
        },
        async run() {
          if (sql.includes('INSERT INTO lookup_cache')) {
            const [id, owner, body] = args;
            rows.set([id, owner].join('|'), { id, body });
          }
        },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((s) => s.run()));
    },
  }),
};
const settings = {
  getSettings: async () => ({
    keyConfigured: aiConfigured,
    preferences: { textModel: 'test', translationModel: 'same' },
  }),
  userApiKey: async () => 'synthetic',
  audioCacheScope: async () => 'audio',
  getElevenSettings: async () => ({}),
  textResponse: async (_key, _model, input) => {
    aiCalls++;
    const data = JSON.parse(input[1].content);
    if (data.sentences)
      return JSON.stringify({
        translations: data.sentences.map((s) => ({ id: s.id, en: 'The bank.' })),
      });
    return JSON.stringify({
      found: true,
      dutch: 'Ik ben moe.',
      english: 'I am tired.',
      correction: '',
    });
  },
};
const azureSettings = {
  getAzureSettings: async (user) => ({
    configured,
    region: 'westeurope',
    scope: `${user}-${counter}`,
  }),
  azureCredentials: async (user) =>
    configured ? { key: 'synthetic', region: 'westeurope', scope: `${user}-${counter}` } : null,
};
async function fakeFetch(url, options) {
  azureCalls++;
  assert.ok(url.startsWith('https://api.cognitive.microsofttranslator.com/translate?'));
  assert.equal(options.headers['Ocp-Apim-Subscription-Key'], 'synthetic');
  if (onAzure) await onAzure();
  if (mode === 'abort')
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
    );
  if (mode === 'error') return Response.json({}, { status: 429, headers: { 'Retry-After': '30' } });
  if (mode === 'malformed') return Response.json([]);
  const target = new URL(url).searchParams.get('to');
  return Response.json(
    JSON.parse(options.body).map(() => ({
      translations: [{ to: target, text: target === 'nl' ? 'Ik ben moe.' : 'The bank.' }],
    })),
  );
}
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative.endsWith('.ts') ? relative : relative + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require(name) {
        if (name === './common') return common;
        if (name === './settings') return settings;
        if (name === './azure-settings') return azureSettings;
        if (name === './materials' || name === './speech' || name === './text-audio') return {};
        return name.startsWith('.')
          ? load(path.relative(root, path.resolve(path.dirname(file), name)))
          : require(name);
      },
      fetch: fakeFetch,
      Response,
      Request,
      URL,
      AbortController,
      AbortSignal,
      DOMException,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      console,
    },
    { filename: file },
  );
  return exports;
}
(async () => {
  const { translate } = load('lib/server/translation');
  let result = await translate('alice', 'De bank.');
  assert.equal(result.translationProvider, 'azure');
  assert.equal(result.lemma, 'De bank.');
  assert.equal(result.senses[0].meaning, 'The bank.');
  assert.equal(aiCalls, 0);
  await translate('alice', 'De bank.');
  assert.equal(azureCalls, 1);
  await translate('bob', 'De bank.');
  assert.equal(azureCalls, 2, 'cache isolated by owner');
  counter++;
  await translate('alice', 'De bank.');
  assert.equal(azureCalls, 3, 'configuration changes scope');
  result = await translate('alice', 'I am tired.', '', undefined, 'en', 'nl');
  assert.equal(result.lemma, 'Ik ben moe.');
  assert.equal(result.senses[0].meaning, 'I am tired.');
  result = await translate(
    'alice',
    '\u042f \u0443\u0441\u0442\u0430\u043b.',
    '',
    undefined,
    'ru',
    'nl',
  );
  assert.equal(result.englishReferencePending, true);
  assert.equal(result.senses[0].meaning, '');
  assert.equal(result.originalInput, '\u042f \u0443\u0441\u0442\u0430\u043b.');
  const beforeInvalid = azureCalls;
  await assert.rejects(() => translate('alice', '', '', undefined, 'en', 'nl'));
  await assert.rejects(() => translate('alice', 'Hello', '', undefined, 'xx', 'nl'));
  assert.equal(azureCalls, beforeInvalid);
  mode = 'malformed';
  counter++;
  result = await translate('alice', 'Malformed');
  assert.equal(result.translationProvider, 'openai');
  assert.equal(result.translationFallback, true);
  mode = 'ok';
  result = await translate('alice', 'Malformed');
  assert.equal(result.translationProvider, 'azure', 'AI fallback never poisons Azure cache');
  mode = 'error';
  counter++;
  result = await translate('alice', 'Error');
  assert.equal(result.translationProvider, 'openai');
  const cooldownCalls = azureCalls;
  await translate('alice', 'Another error');
  assert.equal(azureCalls, cooldownCalls, 'throttling cooldown');
  configured = false;
  result = await translate('alice', 'No Azure');
  assert.equal(result.translationProvider, 'openai');
  assert.equal(result.translationFallback, false);
  aiConfigured = false;
  await assert.rejects(() => translate('alice', 'No providers'), /Connect Azure or OpenAI/);
  configured = true;
  aiConfigured = true;
  counter++;
  mode = 'abort';
  const controller = new AbortController();
  const beforeAbort = aiCalls;
  const pending = translate('alice', 'Cancel', '', controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(() => pending);
  assert.equal(aiCalls, beforeAbort);
  counter++;
  const beforeTimeout = aiCalls;
  result = await translate('alice', 'Timeout');
  assert.equal(result.translationProvider, 'openai');
  assert.equal(aiCalls, beforeTimeout + 1, 'bounded Azure timeout triggers fallback');
  mode = 'ok';
  counter++;
  const texts = load('lib/server/texts');
  let text = await texts.readText('alice', 'text');
  assert.equal(text.translationReady, true);
  aiConfigured = false;
  text = await texts.readText('alice', 'text');
  assert.equal(text.translationReady, true);
  assert.equal(text.keyConfigured, false);
  result = await texts.translateText(
    'alice',
    'text',
    text.segments.map((s) => s.id),
  );
  assert.equal(result.translationProvider, 'azure');
  assert.equal(result.segments[1].en, 'The house.', 'preserves existing saved meaning');
  assert.equal(
    result.segments[1].translationProvider,
    undefined,
    'does not invent provenance for saved inline meanings',
  );
  assert.equal(result.segments[0].translationProvider, 'azure');
  const reloaded = await texts.readText('alice', 'text');
  assert.equal(reloaded.segments[0].translationProvider, 'azure', 'provider survives reload');
  await assert.rejects(() => texts.translateText('bob', 'text', ['x']), /Text not found/);
  await assert.rejects(
    () => texts.translateText('alice', 'text', [text.segments[0].id, text.segments[0].id]),
    /four sentences/,
  );
  rows.clear();
  counter++;
  onAzure = () => {
    sourceBody = { ...sourceBody, _version: 2, segments: [{ nl: 'De boot.' }] };
  };
  await assert.rejects(
    () => texts.translateText('alice', 'text', [text.segments[0].id]),
    /text changed/,
  );
  assert.equal(
    [...rows.values()].some((r) => r.id === 'text-translation:' + text.segments[0].id),
    false,
    'stale translation not stored',
  );
  console.log(
    'PASS: Azure-first translations, direction validation, owner/config caches, malformed/error fallback, throttling cooldown, cancellation, Azure-only text batches, saved progress and stale-text safety. Providers mocked.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
