// Run with: node tests/core.cjs. Uses a local SQLite database and mock OpenAI replies.
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..'),
  sqlite = new DatabaseSync(':memory:');
for (const file of fs
  .readdirSync(path.join(root, 'drizzle'))
  .filter((x) => x.endsWith('.sql'))
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
      if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...args) };
      const r = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  };
}
const env = {
  DB: {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  },
  CREDENTIAL_ENCRYPTION_KEY: '11'.repeat(32),
  BUCKET: {
    store: new Map(),
    async get(k) {
      const v = this.store.get(k);
      return v
        ? { body: v, size: typeof v === 'string' ? Buffer.byteLength(v) : v.byteLength }
        : null;
    },
    async put(k, v) {
      this.store.set(k, v);
    },
  },
};
const requests = [];
let audioBackground = null;
let responseMode = 'ok';
let sent = [];
let finishAudio;
let mismatchOnce = false;
class Socket {
  listeners = {};
  accept() {
    queueMicrotask(() => this.emit({ type: 'session.created' }));
  }
  addEventListener(t, f) {
    (this.listeners[t] ??= []).push(f);
  }
  emit(data) {
    for (const f of this.listeners.message || []) f({ data: JSON.stringify(data) });
  }
  send(raw) {
    const m = JSON.parse(raw);
    sent.push(m);
    if (m.type === 'session.update') queueMicrotask(() => this.emit({ type: 'session.updated' }));
    if (m.type === 'response.create')
      queueMicrotask(() => {
        this.emit({
          type: 'response.output_audio.delta',
          delta: Buffer.from([0, 0, 0, 0]).toString('base64'),
        });
        const finish = () =>
          this.emit({
            type: 'response.done',
            response: {
              status: 'completed',
              output: [
                {
                  content: [
                    {
                      transcript: mismatchOnce ? ((mismatchOnce = false), 'De boot.') : 'De bank.',
                    },
                  ],
                },
              ],
            },
          });
        if (responseMode === 'audio_hold') finishAudio = finish;
        else finish();
      });
  }
  close() {}
}
const dictionaryRows = {
  bellen: [
    {
      word: 'bellen',
      lang_code: 'nl',
      pos: 'noun',
      senses: [{ form_of: [{ word: 'bel' }], glosses: ['plural of bel'] }],
    },
    {
      word: 'bellen',
      lang_code: 'nl',
      pos: 'verb',
      senses: [{ glosses: ['to call by telephone'] }],
      forms: [{ form: 'gebeld', tags: ['past', 'participle'] }],
    },
  ],
  gebeld: [
    {
      word: 'gebeld',
      lang_code: 'nl',
      pos: 'verb',
      senses: [{ glosses: ['past participle of bellen'], form_of: [{ word: 'bellen' }] }],
    },
  ],
};
const fakeFetch = async (url, options = {}) => {
  if (String(url).startsWith('/dictionary/v1/'))
    return Response.json(
      JSON.parse(fs.readFileSync(path.join(root, 'public', String(url)), 'utf8')),
    );
  if (String(url).includes('kaikki.org')) {
    const word = decodeURIComponent(String(url).split('/').at(-1).replace('.jsonl', ''));
    return new Response((dictionaryRows[word] || []).map((r) => JSON.stringify(r)).join('\n'));
  }
  requests.push({ url: String(url), options });
  if (String(url).includes('api.elevenlabs.io')) {
    if (options.headers['xi-api-key'] === 'invalid-eleven-key')
      return Response.json({ error: 'bad key' }, { status: 401 });
    if (String(url).includes('/with-timestamps')) {
      const input = JSON.parse(options.body).inputs[0].text,
        chars = Array.from(input),
        times = chars.map((_, i) => i * 0.01),
        ends = chars.map((_, i) => (i + 1) * 0.01);
      return Response.json({
        audio_base64: Buffer.alloc(Math.ceil(chars.length * 0.01 * 24000) * 2).toString('base64'),
        alignment: {
          characters: chars,
          character_start_times_seconds: times,
          character_end_times_seconds: ends,
        },
      });
    }
    if (String(url).includes('/v2/voices'))
      return Response.json({
        voices: [
          {
            voice_id: 'dutch-test',
            name: 'Dutch test',
            labels: { accent: 'Dutch', language: 'nl' },
          },
          {
            voice_id: 'english-test',
            name: 'English test',
            labels: { accent: 'British', language: 'en' },
            verified_languages: [{ language: 'nl' }],
          },
        ],
      });
    if (String(url).includes('/v1/shared-voices'))
      return Response.json({
        voices: [
          { voice_id: 'shared-dutch', name: 'Shared Dutch', language: 'nl', accent: 'Netherlands' },
          { voice_id: 'shared-english', name: 'English only', language: 'en', accent: 'American' },
        ],
      });
    return new Response(new Uint8Array([73, 68, 51, 0]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  }
  if (String(url).includes('/realtime')) return { webSocket: new Socket() };
  if (String(url).includes('/audio/speech')) {
    if (responseMode === 'tts_rejected')
      return Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 });
    if (responseMode === 'tts_empty') return new Response(new Uint8Array());
    return new Response(new Uint8Array([0, 0, 0, 0]));
  }
  if (responseMode === 'rejected')
    return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
  return Response.json({
    status: 'completed',
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: responseMode.startsWith('selected')
              ? JSON.stringify({
                  found: responseMode !== 'selected_ambiguous',
                  english:
                    responseMode === 'selected_invalid' || responseMode === 'selected_ambiguous'
                      ? ''
                      : 'walked',
                  formLabel: responseMode === 'selected_ambiguous' ? '' : 'past participle',
                  baseForm: responseMode === 'selected_ambiguous' ? '' : 'lopen',
                })
              : responseMode === 'text_batch'
                ? JSON.stringify({
                    translations: JSON.parse(options.body)
                      .input.filter((x) => x.role === 'user')
                      .map((x) => JSON.parse(x.content))[0]
                      .sentences.map((x) => ({ id: x.id, en: 'The bank.' })),
                  })
                : responseMode === 'translation'
                  ? JSON.stringify({
                      found: true,
                      dutch: 'Ik ben een beetje moe',
                      english: 'I am a little tired',
                      correction: 'Corrected en to een.',
                    })
                  : 'OK',
          },
        ],
      },
    ],
  });
};
const cache = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!file.endsWith('.ts')) file += '.ts';
  if (cache.has(file)) return cache.get(file);
  const output = {};
  cache.set(file, output);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      exports: output,
      require(name) {
        if (name === 'cloudflare:workers')
          return {
            env,
            get waitUntil() {
              return audioBackground ? (task) => audioBackground.push(task) : undefined;
            },
          };
        if (name.startsWith('.'))
          return load(path.relative(root, path.resolve(path.dirname(file), name)));
        return require(name);
      },
      fetch: fakeFetch,
      Request,
      Response,
      ReadableStream,
      crypto,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      DataView,
      AbortController,
      AbortSignal,
      DOMException,
      URL,
      Error,
      structuredClone,
      setTimeout,
      clearTimeout,
      atob,
      btoa,
      console,
      queueMicrotask,
    },
    { filename: file },
  );
  return output;
}
function req(url, data, user = 'alice', method) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['oai-authenticated-user-id'] = user;
  return new Request('https://example.test' + url, {
    method: method || (data ? 'POST' : 'GET'),
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
}
const { nounArticle, nounParts } = load('lib/noun-article');
const noun = {
  partOfSpeech: 'noun',
  article: 'het',
  lemma: 'verschijnsel',
  forms: [{ label: 'plural', value: 'verschijnselen' }],
};
assert.equal(nounArticle('verschijnsel', noun), 'het');
assert.equal(nounArticle('verschijnselen', noun), 'de');
assert.equal(nounArticle('verschijnsel', noun, 'verschijnen'), '');
assert.equal(nounArticle('verschijn', noun), '');
assert.equal(nounArticle('loop', { ...noun, partOfSpeech: 'verb' }), '');
assert.equal(nounParts('het verschijnsel').word, 'verschijnsel');
assert.equal(nounParts('het verschijnsel').article, 'het');
assert.equal(nounParts('Het is mooi').article, '');
assert.equal(nounParts('verschijnsel', { article: 'het' }).article, 'het');
assert.equal(nounParts('ik zie dat', { article: 'het' }).article, '');
console.log(
  'PASS: separate noun articles, selected singular/plural, context mismatch, legacy title and whole-phrase preservation.',
);
(async () => {
  const settings = load('lib/server/settings'),
    route = load('app/api/settings/route'),
    common = load('lib/server/common'),
    materials = load('lib/server/materials'),
    practice = load('app/api/practice/route'),
    ranks = load('lib/practice'),
    speech = load('lib/server/speech');
  const localDictionary = load('lib/local-dictionary'),
    searchForms = load('lib/search-form');
  const searchedForm = await localDictionary.localLookup('opgebeld');
  assert.equal(searchedForm.lemma, 'opbellen');
  assert.equal(searchedForm.queryForm.text, 'opgebeld');
  assert.match(searchedForm.queryForm.senses[0].meaning, /past participle/);
  assert.equal(searchedForm.queryForm.ipa, '');
  assert.equal((await localDictionary.localLookup('opbellen')).queryForm, undefined);
  const exactForm = searchForms.searchMeaningMaterial(
    searchedForm,
    searchedForm.queryForm.senses[0],
    { found: true, english: 'called', formLabel: 'past participle', baseForm: 'opbellen' },
  );
  assert.equal(exactForm.title, 'opgebeld');
  assert.equal(exactForm.body.en, 'called');
  assert.equal(exactForm.body.lemma, 'opbellen');
  assert.equal(exactForm.body.selectedForm, 'opgebeld');
  assert.equal(exactForm.body.article, '');
  const rawForm = searchForms.searchMeaningMaterial(searchedForm, searchedForm.queryForm.senses[0]);
  assert.equal(rawForm.title, 'opgebeld');
  assert.equal(rawForm.body.en, '');
  assert.match(rawForm.body.notes, /past participle/);
  const formSaved = await materials.addMaterial('search-form-test', {
      ...exactForm,
      practice: true,
    }),
    baseSaved = await materials.addMaterial('search-form-test', {
      kind: 'phrase',
      title: 'opbellen',
      body: { en: 'to call' },
      practice: true,
    });
  assert.notEqual(formSaved.id, baseSaved.id);
  const formStored = (await materials.listMaterials('search-form-test')).find(
    (x) => x.id === formSaved.id,
  );
  assert.equal(formStored.title, 'opgebeld');
  assert.equal(formStored.body.en, 'called');
  assert.equal(formStored.body.lemma, 'opbellen');
  const plural = await localDictionary.localLookup('verschijnselen');
  assert.equal(plural.queryForm.text, 'verschijnselen');
  assert.equal(
    searchForms.searchMeaningMaterial(plural, plural.queryForm.senses[0]).body.article,
    'de',
  );
  console.log(
    'PASS: actual dictionary form lookup, original form/IPA, base-form navigation data, exact saved title/translation/lemma, no infinitive translation substitution, plural article.',
  );
  assert.equal((await route.GET(req('/api/settings', null, null))).status, 401);
  const testKey = 'sk-test-not-a-real-key-1234567890';
  let r = await route.POST(
    req('/api/settings', { action: 'saveKey', apiKey: testKey, preferences: {} }),
  );
  assert.equal(r.status, 200);
  let stored = sqlite
    .prepare('SELECT key_cipher FROM user_settings WHERE owner=?')
    .get('alice').key_cipher;
  assert.ok(!stored.includes(testKey));
  assert.equal(await settings.decryptKey(stored, 'alice'), testKey);
  await assert.rejects(() => settings.decryptKey(stored, 'bob'));
  const publicSettings = await (await route.GET(req('/api/settings'))).json();
  assert.equal(publicSettings.keyConfigured, true);
  assert.ok(!JSON.stringify(publicSettings).includes(testKey));
  assert.equal(publicSettings.language, 'nl-NL');
  responseMode = 'rejected';
  r = await route.POST(
    req('/api/settings', {
      action: 'saveKey',
      apiKey: 'sk-invalid-test-value-123456789',
      preferences: {},
    }),
  );
  assert.equal(r.status, 401);
  assert.equal(
    sqlite.prepare('SELECT key_cipher FROM user_settings WHERE owner=?').get('alice').key_cipher,
    stored,
  );
  responseMode = 'ok';
  const a = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'de bank',
    body: { en: 'the sofa' },
    practice: true,
  });
  const duplicate = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'de bank',
    body: { en: 'the sofa' },
  });
  assert.equal(duplicate.id, a.id);
  assert.equal(duplicate.duplicate, true);
  const sense2 = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'de bank',
    body: { en: 'the bank' },
    practice: true,
  });
  assert.notEqual(sense2.id, a.id);
  assert.equal((await materials.listMaterials('bob')).length, 0);
  await assert.rejects(() =>
    materials.updateMaterial('alice', { id: a.id, version: 0, title: 'oops' }),
  );
  await materials.updateMaterial('alice', { id: a.id, version: 1, body: { notes: 'my note' } });
  assert.equal(
    (await materials.listMaterials('alice')).find((x) => x.id === a.id).body.notes,
    'my note',
  );
  for (let i = 0; i < 2; i++) {
    r = await practice.POST(
      req('/api/practice', { id: a.id, attemptId: 'same-attempt', rating: 'know' }),
    );
    assert.equal(r.status, 200);
  }
  assert.equal(
    sqlite.prepare('SELECT rank FROM review_state WHERE material_id=?').get(a.id).rank,
    1,
  );
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM review_attempts').get().n, 1);
  r = await practice.POST(
    req('/api/practice', { id: a.id, attemptId: 'another', rating: 'not_yet' }),
  );
  assert.equal((await r.json()).rank, 0);
  r = await practice.POST(
    req('/api/practice', { id: a.id, attemptId: 'foreign', rating: 'know' }, 'bob'),
  );
  assert.equal(r.status, 409);
  await materials.updateMaterial('alice', { id: a.id, version: 2, archived: true });
  assert.equal((await materials.listMaterials('alice')).length, 1);
  assert.equal((await materials.listMaterials('alice', '', true)).length, 1);
  assert.equal((await (await practice.GET(req('/api/practice'))).json()).items.length, 1);
  assert.equal(ranks.nextRank(5, 'know'), 5);
  assert.equal(ranks.nextRank(0, 'not_yet'), 0);
  assert.equal(ranks.practiceQueue([]).length, 0);
  const dictionary = load('lib/server/dictionary');
  const verb = await dictionary.lookup('charlie', 'bellen');
  assert.equal(verb.partOfSpeech, 'verb');
  assert.equal(verb.lemma, 'bellen');
  const inflected = await dictionary.lookup('charlie', 'gebeld');
  assert.equal(inflected.lemma, 'bellen');
  assert.ok(inflected.queryExplanation.includes('gebeld'));
  const translations = load('lib/server/translation');
  responseMode = 'translation';
  const before = requests.length;
  const translated = await translations.translate('alice', 'ik ben en beetje moe');
  assert.equal(translated.senses[0].meaning, 'I am a little tired');
  assert.equal(translated.lemma, 'Ik ben een beetje moe');
  assert.ok(translated.queryExplanation.includes('een'));
  assert.equal(translated.source, 'OpenAI translation');
  assert.equal(JSON.parse(requests.at(-1).options.body).max_output_tokens, 512);
  await translations.translate('alice', 'ik ben en beetje moe');
  assert.equal(requests.length, before + 1);
  assert.ok(translations.TRANSLATION_INSTRUCTIONS.includes('minor typo'));
  responseMode = 'ok';
  responseMode = 'selected';
  const formRequests = requests.length;
  const formMeaning = await translations.translateSelectedForm(
    'alice',
    'gelopen',
    'Ik heb naar huis gelopen.',
    'lopen',
  );
  assert.equal(formMeaning.english, 'walked');
  assert.equal(formMeaning.formLabel, 'past participle');
  const formInput = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(JSON.parse(formInput.input[1].content), {
    selected: 'gelopen',
    context: 'Ik heb naar huis gelopen.',
    baseForm: 'lopen',
  });
  assert.equal(formInput.max_output_tokens, 400);
  assert.ok(formInput.input[0].content.includes('Do not correct, replace'));
  await translations.translateSelectedForm(
    'alice',
    'gelopen',
    'Ik heb naar huis gelopen.',
    'lopen',
  );
  assert.equal(requests.length, formRequests + 1);
  await translations.translateSelectedForm('alice', 'gelopen', 'We hebben veel gelopen.', 'lopen');
  assert.equal(requests.length, formRequests + 2);
  await assert.rejects(
    () =>
      translations.translateSelectedForm('bob', 'gelopen', 'Ik heb naar huis gelopen.', 'lopen'),
    /API key/,
  );
  await assert.rejects(
    () => translations.translateSelectedForm('alice', 'gelopen', '', 'lopen'),
    /context/,
  );
  responseMode = 'selected_invalid';
  await assert.rejects(
    () => translations.translateSelectedForm('alice', 'liep', 'Hij liep naar huis.', 'lopen'),
    /incomplete/,
  );
  responseMode = 'selected';
  await translations.translateSelectedForm('alice', 'liep', 'Hij liep naar huis.', 'lopen');
  responseMode = 'selected_ambiguous';
  assert.equal(
    (await translations.translateSelectedForm('alice', 'xyzabc', 'xyzabc?', '')).found,
    false,
  );
  responseMode = 'ok';
  const savedForm = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'gelopen',
    body: {
      en: 'walked',
      selectedForm: 'gelopen',
      lemma: 'lopen',
      formLabel: 'past participle',
      example: 'Ik heb naar huis gelopen.',
      source: 'My text',
      textId: 'source-id',
      segmentId: 'sentence-id',
    },
    practice: true,
  });
  const savedInfinitive = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'lopen',
    body: { en: 'to walk' },
    practice: true,
  });
  assert.notEqual(savedForm.id, savedInfinitive.id);
  const storedForm = (await materials.listMaterials('alice')).find((x) => x.id === savedForm.id);
  assert.equal(storedForm.title, 'gelopen');
  assert.equal(storedForm.body.lemma, 'lopen');
  assert.equal(storedForm.body.selectedForm, 'gelopen');
  assert.equal(storedForm.body.example, 'Ik heb naar huis gelopen.');
  assert.equal(storedForm.practice, true);
  const lookupRoute = load('app/api/lookup/route');
  assert.equal(
    (
      await lookupRoute.POST(
        req(
          '/api/lookup',
          {
            mode: 'selected-form',
            query: 'gelopen',
            context: 'Ik heb naar huis gelopen.',
            lemma: 'lopen',
          },
          null,
        ),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await lookupRoute.POST(
        req('/api/lookup', {
          mode: 'selected-form',
          query: 'gelopen',
          context: 'Ik heb naar huis gelopen.',
          lemma: 'lopen',
        }),
      )
    ).status,
    200,
  );
  responseMode = 'selected';
  const standalone = await lookupRoute.POST(
    req('/api/lookup', { mode: 'search-form', query: 'gelopen', context: '', lemma: 'lopen' }),
  );
  assert.equal(standalone.status, 200);
  assert.equal((await standalone.json()).english, 'walked');
  assert.equal(JSON.parse(JSON.parse(requests.at(-1).options.body).input[1].content).context, '');
  assert.match(
    JSON.parse(requests.at(-1).options.body).input[0].content,
    /without inventing a subject/,
  );
  assert.equal(
    (
      await lookupRoute.POST(
        req(
          '/api/lookup',
          { mode: 'search-form', query: 'gelopen', context: '', lemma: 'lopen' },
          null,
        ),
      )
    ).status,
    401,
  );
  responseMode = 'ok';
  console.log(
    'PASS: selected-form contextual translation, exact input, scoped/context cache, invalid output retry, ambiguous selection, authenticated route and distinct saved form/base form with source metadata.',
  );
  const prefs = settings.defaults;
  assert.ok(
    speech.speechInstructions({ ...prefs, tone: 'Cheerful' }).includes('ALWAYS Dutch (nl-NL)'),
  );
  assert.ok(speech.speechInstructions(prefs).includes('Never auto-detect English'));
  const wav = await speech.realtimeSpeech(testKey, 'De bank.', prefs);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString(), 'RIFF');
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 24000);
  assert.equal(sent.find((x) => x.type === 'session.update').session.audio.output.voice, 'marin');
  assert.ok(
    sent
      .find((x) => x.type === 'conversation.item.create')
      .item.content[0].text.includes('De bank.'),
  );
  responseMode = 'audio_hold';
  const streamResponse = await speech.streamSpeech('alice', 'De bank.');
  assert.equal(streamResponse.headers.get('Content-Type'), 'application/x-ndjson');
  const reader = streamResponse.body.getReader();
  const first = await reader.read();
  assert.ok(new TextDecoder().decode(first.value).includes('audio'));
  assert.equal(typeof finishAudio, 'function');
  finishAudio();
  let tail = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    tail += new TextDecoder().decode(next.value);
  }
  assert.ok(tail.includes('done'));
  assert.equal(
    (await speech.streamSpeech('alice', 'De bank.')).headers.get('Content-Type'),
    'audio/wav',
  );
  assert.equal(
    (await speech.streamSpeech('alice', 'De bank.')).headers.get('X-Audio-Cache'),
    'hit',
  );
  assert.equal(
    await settings.audioCacheScope('alice', settings.defaults),
    await settings.audioCacheScope('alice', { ...settings.defaults, textModel: 'gpt-6-luna' }),
  );
  assert.notEqual(
    await settings.audioCacheScope('alice', settings.defaults),
    await settings.audioCacheScope('alice', { ...settings.defaults, voice: 'cedar' }),
  );
  await assert.rejects(() => speech.streamSpeech('bob', 'De bank.'));
  assert.equal(sent.find((x) => x.type === 'session.update').session.reasoning.effort, 'minimal');
  responseMode = 'ok';
  await settings.textResponse(testKey, 'gpt-6-luna', [{ role: 'user', content: 'OK' }]);
  assert.equal(JSON.parse(requests.at(-1).options.body).reasoning.effort, 'none');
  const textService = load('lib/server/texts');
  const textMaterial = await materials.addMaterial('alice', {
    kind: 'text',
    title: 'Real text regression',
    body: {
      source: 'Test',
      segments: [
        { nl: 'De bank.', en: '' },
        { nl: 'De bank!', en: 'The bank!' },
      ],
    },
  });
  let reading = await textService.readText('alice', textMaterial.id);
  assert.equal(reading.segments.length, 2);
  const segmentId = reading.segments[0].id;
  responseMode = 'text_batch';
  const requestCount = requests.length;
  await textService.translateText('alice', textMaterial.id, [segmentId]);
  assert.equal(requests.length, requestCount + 1);
  reading = await textService.readText('alice', textMaterial.id);
  assert.equal(reading.segments[0].en, 'The bank.');
  await textService.translateText('alice', textMaterial.id, [segmentId]);
  assert.equal(requests.length, requestCount + 1);
  await assert.rejects(() => textService.readText('bob', textMaterial.id));
  await assert.rejects(() => textService.translateText('alice', textMaterial.id, ['wrong-id']));
  responseMode = 'ok';
  await textService.legacyPrepareTextAudio('alice', textMaterial.id, segmentId);
  assert.equal((await textService.readText('alice', textMaterial.id)).segments[0].audioReady, true);
  const originalBody = JSON.parse(
    sqlite.prepare('SELECT body FROM materials WHERE id=?').get(textMaterial.id).body,
  );
  assert.equal(originalBody.segments[0].en, '');
  await materials.updateMaterial('alice', {
    id: textMaterial.id,
    version: 1,
    body: { segments: [{ nl: 'De boot.' }] },
  });
  reading = await textService.readText('alice', textMaterial.id);
  assert.notEqual(reading.segments[0].id, segmentId);
  assert.equal(reading.segments[0].en, '');
  assert.equal(reading.segments[0].audioReady, false);
  const split = load('lib/text-segments');
  assert.ok(split.segmentText('word '.repeat(500)).every((x) => x.length <= 1000));
  console.log(
    'PASS: text translation batches, owner isolation, persisted partial progress, cache reuse, source preservation and edit invalidation.',
  );
  // Existing v1 progress must survive the first edit, insertion, reordering and duplicates.
  const legacyText = await materials.addMaterial('alice', {
    kind: 'text',
    title: 'Editor regression',
    body: {
      source: 'Original source',
      original: 'De bank. De boot. De boom.',
      segments: [
        { nl: 'De bank.', en: '' },
        { nl: 'De boot.', en: '' },
        { nl: 'De boom.', en: '' },
      ],
    },
  });
  const scope = await settings.audioCacheScope('alice', settings.defaults);
  for (const [i, nl] of ['De bank.', 'De boot.', 'De boom.'].entries()) {
    const oldId = await common.hash('text-segment-v1:' + legacyText.id + ':' + i + ':0:' + nl);
    for (const [id, value] of [
      ['text-translation:' + oldId, { en: 'English ' + nl }],
      ['text-audio:' + oldId + ':' + scope, { ready: true }],
    ])
      sqlite
        .prepare('INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
        .run(id, 'alice', JSON.stringify(value), new Date().toISOString());
  }
  const prior = await textService.readText('alice', legacyText.id);
  assert.ok(prior.segments.every((s) => s.audioReady && s.en));
  const editRequests = requests.length;
  const edited = await textService.editText('alice', legacyText.id, {
    version: 1,
    title: 'Edited title',
    source: 'Updated source',
    original: 'Nieuw. De boom. De bank. De boot is groot. De bank.',
  });
  assert.equal(edited.needsPreparation, 3);
  assert.equal(edited.text.segments[1].id, prior.segments[2].id);
  assert.equal(edited.text.segments[2].id, prior.segments[0].id);
  assert.equal(edited.text.segments[1].audioReady, true);
  assert.equal(edited.text.segments[2].en, 'English De bank.');
  assert.equal(edited.text.segments[3].en, '');
  assert.equal(edited.text.segments[3].audioReady, false);
  assert.equal(new Set(edited.text.segments.map((s) => s.id)).size, 5);
  assert.equal(edited.text.original, 'Nieuw. De boom. De bank. De boot is groot. De bank.');
  assert.equal(
    JSON.parse(sqlite.prepare('SELECT body FROM materials WHERE id=?').get(legacyText.id).body)
      .original,
    'De bank. De boot. De boom.',
  );
  assert.equal(requests.length, editRequests);
  await assert.rejects(
    () =>
      textService.editText('alice', legacyText.id, {
        version: 1,
        title: 'Stale',
        source: '',
        original: 'Oops.',
      }),
    /another device/,
  );
  await assert.rejects(
    () =>
      textService.editText('bob', legacyText.id, {
        version: 2,
        title: 'Wrong owner',
        source: '',
        original: 'Oops.',
      }),
    /not found/,
  );
  await assert.rejects(
    () =>
      textService.editText('alice', legacyText.id, {
        version: 2,
        title: 'Empty',
        source: '',
        original: '  ',
      }),
    /between 1 and 400/,
  );
  const meta = await textService.editText('alice', legacyText.id, {
    version: 2,
    title: 'Renamed',
    source: '',
    original: edited.text.original,
  });
  assert.deepEqual(meta.text.segments, edited.text.segments);
  const textsRoute = load('app/api/texts/route');
  assert.equal(
    (
      await textsRoute.POST(
        req('/api/texts', {
          action: 'edit',
          id: legacyText.id,
          version: 1,
          title: 'Stale',
          source: '',
          original: 'Oops.',
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await textsRoute.POST(
        req(
          '/api/texts',
          {
            action: 'edit',
            id: legacyText.id,
            version: 3,
            title: 'Missing auth',
            source: '',
            original: 'Oops.',
          },
          null,
        ),
      )
    ).status,
    401,
  );
  console.log(
    'PASS: editor preserves legacy preparation, insertion/reordering, changed-only invalidation, unique duplicates, original import, metadata-only edits, owner isolation, conflict checks and zero OpenAI requests.',
  );
  const wording = load('lib/speech-text');
  assert.equal(
    wording.sameSpeechWording(
      'Maar Zuid-Limburg ziet erg heel anders uit.',
      'Maar Zuidlimburg ziet erg heel anders uit.',
    ),
    true,
  );
  assert.equal(
    wording.sameSpeechWording(
      'Maar Zuid-Limburg ziet erg heel anders uit.',
      'Maar Zuid Limburg ziet heel anders uit.',
    ),
    false,
  );
  assert.equal(
    wording.sameSpeechWording('De boot is 50 meter lang.', 'De boot is 15 meter lang.'),
    false,
  );
  assert.equal(wording.sameSpeechWording('Weer stand.', 'Weerstand.'), false);
  mismatchOnce = true;
  const retryStart = requests.length;
  await speech.speech('alice', 'De bank?');
  assert.equal(requests.length, retryStart + 2);
  const fallback = JSON.parse(requests.at(-1).options.body);
  assert.ok(requests.at(-1).url.endsWith('/audio/speech'));
  assert.equal(fallback.model, 'gpt-4o-mini-tts');
  assert.equal(fallback.input, 'De bank?');
  assert.equal(fallback.voice, 'marin');
  assert.equal(fallback.response_format, 'pcm');
  assert.ok(fallback.instructions.includes('ALWAYS Dutch'));
  await speech.speech('alice', 'De bank?');
  assert.equal(requests.length, retryStart + 2);
  await speech.speech('alice', 'Maar Zuid-Limburg ziet erg heel anders uit.');
  assert.equal(
    JSON.parse(requests.at(-1).options.body).input,
    'Maar Zuid-Limburg ziet erg heel anders uit.',
  );
  const objectsBefore = env.BUCKET.store.size;
  responseMode = 'tts_rejected';
  await assert.rejects(() => speech.speech('alice', 'De boot?'), /credit/);
  assert.equal(env.BUCKET.store.size, objectsBefore);
  responseMode = 'tts_empty';
  await assert.rejects(() => speech.speech('alice', 'De boot!'), /invalid backup audio/);
  assert.equal(env.BUCKET.store.size, objectsBefore);
  responseMode = 'ok';
  console.log(
    'PASS: wording failures use exact-input Dutch TTS, one fallback only, saved audio reused, provider failures and empty audio never cached.',
  );
  const foreign = req('/api/settings', { action: 'savePreferences', preferences: {} });
  foreign.headers.set('origin', 'https://evil.test');
  assert.equal((await route.POST(foreign)).status, 403);
  const backupService = load('lib/server/backup'),
    backupRoute = load('app/api/backup/route');
  const backupCalls = requests.length,
    bucketCount = env.BUCKET.store.size;
  const note = await materials.addMaterial('alice', {
    kind: 'note',
    title: 'Teacher notes',
    body: { notes: 'Remember the exact form.', custom: { keep: ['all', 'fields'] } },
  });
  const linkedText = await materials.addMaterial('alice', {
    kind: 'text',
    title: 'Backup source',
    body: { original: 'De bank.', segments: [{ nl: 'De bank.', en: '' }] },
  });
  const linkedRead = await textService.readText('alice', linkedText.id);
  responseMode = 'text_batch';
  await textService.translateText('alice', linkedText.id, [linkedRead.segments[0].id]);
  responseMode = 'ok';
  const link = await materials.addMaterial('alice', {
    kind: 'phrase',
    title: 'bank',
    body: {
      en: 'bank',
      selectedForm: 'bank',
      lemma: 'bank',
      textId: linkedText.id,
      segmentId: linkedRead.segments[0].id,
      example: 'De bank.',
    },
  });
  // Words uses real SQLite transactions and the same request handlers as the app.
  const wordsCore = load('lib/words'),
    wordsService = load('lib/server/words'),
    wordsRoute = load('app/api/words/route');
  assert.equal((await wordsRoute.GET(req('/api/words', null, null))).status, 401);
  assert.equal(
    (
      await wordsRoute.POST(
        new Request('https://example.test/api/words', {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: '{}',
        }),
      )
    ).status,
    403,
  );
  for (const [nl, en] of [
    ['de kat', 'cat'],
    ['de hond', 'dog'],
    ['het huis', 'house'],
    ['de fiets', 'bicycle'],
    ['de tafel', 'table'],
  ])
    await materials.addMaterial('words-user', {
      kind: 'phrase',
      title: nl,
      body: { en, partOfSpeech: 'noun' },
      practice: true,
    });
  // Retained v1 sessions must still replay and sync byte-for-byte after the scheduler upgrade.
  function legacyFixture(result, owner, limit) {
    delete result.session.algorithm;
    delete result.session.preferences;
    delete result.session.choicePool;
    result.session.cardLimit = 15;
    if (limit) result.session.units = result.session.units.slice(0, limit);
    sqlite
      .prepare('UPDATE words_sessions SET body=? WHERE owner=?')
      .run(JSON.stringify(result.session), owner);
    return result;
  }
  let ws = legacyFixture(
    await wordsService.startWords('words-user', 'Europe/Amsterdam'),
    'words-user',
    4,
  );
  assert.equal(ws.session.units.length, 4);
  assert.equal(
    (await wordsService.startWords('words-user', 'Europe/Amsterdam')).session.id,
    ws.session.id,
  );
  assert.equal((await wordsService.getWords('other-user')).session, null);
  let wordEvent = 0;
  async function wordSend(action, answer = '', overrides = {}) {
    const payload = {
      action,
      answer,
      sessionId: ws.session.id,
      revision: ws.revision,
      questionId: ws.session.question?.id,
      attemptId: 'word-test-' + ++wordEvent,
      elapsed: wordEvent,
      ...overrides,
    };
    const result = await wordsService.answerWords('words-user', payload);
    ws = result;
    return payload;
  }
  const firstPayload = await wordSend('continue');
  const firstRevision = ws.revision;
  const wordsAgain = await wordsService.answerWords('words-user', firstPayload);
  assert.equal(wordsAgain.duplicate, true);
  assert.equal(wordsAgain.revision, firstRevision);
  assert.equal(ws.session.units[0].state.stage, 'recognize');
  assert.equal(ws.session.units[0].state.interval, -1);
  assert.equal(ws.session.feedback, null);
  assert.notEqual(ws.session.question.unitId, firstPayload.questionId.split(':').at(-1));
  assert.notEqual(ws.session.question.id, firstPayload.questionId);
  // Exercise the full legacy lifecycle independently of the new 15-card round boundary.
  delete ws.session.cardLimit;
  sqlite
    .prepare('UPDATE words_sessions SET body=? WHERE owner=?')
    .run(JSON.stringify(ws.session), 'words-user');
  let guard = 0;
  while (ws.session.question && guard++ < 100) {
    const q = ws.session.question,
      u = ws.session.units.find((u) => u.id === q.unitId);
    if (ws.session.feedback) {
      await wordSend('next');
      continue;
    }
    if (q.kind === 'intro') await wordSend('continue');
    else if (q.kind === 'self') {
      await wordSend('hint');
      await wordSend('answer', 'yes');
    } else await wordSend('answer', q.direction === 'nl-en' ? u.en : u.nl);
  }
  assert.ok(guard < 100);
  assert.equal(ws.session.units.filter((u) => u.state.stage === 'review').length, 4);
  const learned = await wordsService.getWords('words-user');
  assert.equal(learned.due, 0);
  assert.equal(learned.newCount, 1);
  for (const u of ws.session.units) {
    assert.equal(u.state.interval, 0);
    assert.equal(u.state.due, wordsCore.addDays(ws.session.day, 1));
  }
  // Local journal stays interactive while a batch is in flight; ack rebases only its exact prefix.
  const journalCore = load('lib/words-journal');
  // Empty journals are persisted on first open and must survive reload or switching modes.
  const emptyWords = {
    base: { session: null, revision: 0, scope: 'empty-owner', total: 4, due: 2, newCount: 2 },
    events: [],
  };
  for (let reload = 0; reload < 3; reload++)
    assert.equal(
      JSON.stringify(journalCore.restoreJournal(JSON.stringify(emptyWords))),
      JSON.stringify(emptyWords),
    );
  assert.throws(
    () =>
      journalCore.restoreJournal(JSON.stringify({ ...emptyWords, events: [{ action: 'next' }] })),
    /recovery/,
  );
  assert.throws(() => journalCore.restoreJournal('null'), /Invalid/);
  assert.throws(
    () =>
      journalCore.restoreJournal(
        JSON.stringify({ ...emptyWords, base: { ...emptyWords.base, session: {} } }),
      ),
    /recovery/,
  );

  const batchUser = 'batch-user';
  for (const [nl, en] of [
    ['kat', 'cat'],
    ['hond', 'dog'],
    ['huis', 'house'],
    ['fiets', 'bicycle'],
    ['tafel', 'table'],
  ])
    await materials.addMaterial(batchUser, {
      kind: 'phrase',
      title: nl,
      body: { en },
      practice: true,
    });
  const started = legacyFixture(await wordsService.startWords(batchUser), batchUser, 4);
  assert.equal(started.session.cardLimit, 15);
  let j = { base: started, events: [] };
  for (let i = 0; i < 4; i++) j = journalCore.journalAppend(j, 'continue', '', i);
  const sentBatch = structuredClone(j);
  let view = journalCore.journalView(j);
  assert.equal(view.session.question.kind, 'choice');
  const answerFor = (v) => {
    const q = v.session.question,
      u = v.session.units.find((u) => u.id === q.unitId);
    return q.direction === 'nl-en' ? u.en : u.nl;
  };
  j = journalCore.journalAppend(j, 'answer', answerFor(view), 5);
  j = journalCore.journalAppend(j, 'next', '', 6);
  assert.equal(j.events.length, 6);
  assert.equal(journalCore.journalView(j).session.turn, 5);
  const committed = await wordsService.commitWords(batchUser, journalCore.journalBatch(sentBatch));
  j = journalCore.journalAck(j, sentBatch, committed);
  assert.equal(j.events.length, 2);
  assert.equal(journalCore.journalView(j).session.turn, 5);
  const restoredJournal = journalCore.restoreJournal(JSON.stringify(j));
  assert.equal(JSON.stringify(restoredJournal), JSON.stringify(j));
  const remaining = journalCore.journalBatch(j),
    savedBatch = await wordsService.commitWords(batchUser, remaining);
  assert.equal((await wordsService.commitWords(batchUser, remaining)).duplicate, true);
  j = journalCore.journalAck(j, j, savedBatch);
  assert.equal(j.events.length, 0);
  // Response lost after commit: retain an immutable in-flight prefix while more local answers arrive.
  let lost = journalCore.journalAppend(j, 'answer', answerFor(journalCore.journalView(j)), 7);
  lost = { ...lost, flight: lost.events.length };
  const lostSent = structuredClone({ base: lost.base, events: lost.events.slice(0, lost.flight) });
  await wordsService.commitWords(batchUser, journalCore.journalBatch(lostSent));
  lost = journalCore.journalAppend(lost, 'next', '', 8);
  assert.equal(lost.flight, 1);
  const lostRestored = journalCore.restoreJournal(JSON.stringify(lost));
  const replayLost = await wordsService.commitWords(batchUser, journalCore.journalBatch(lostSent));
  assert.equal(replayLost.duplicate, true);
  j = journalCore.journalAck(lostRestored, lostSent, replayLost);
  assert.equal(j.events.length, 1);
  const suffixSaved = await wordsService.commitWords(batchUser, journalCore.journalBatch(j));
  j = journalCore.journalAck(j, j, suffixSaved);
  // Invalid last action leaves no prefix committed.
  let invalid = journalCore.journalAppend(j, 'answer', answerFor(journalCore.journalView(j)), 7);
  const bad = journalCore.journalBatch(invalid);
  bad.events.push({
    ...bad.events[0],
    attemptId: 'bad-next',
    revision: bad.revision + 1,
    action: 'continue',
  });
  const beforeInvalid = sqlite
    .prepare('SELECT body,revision FROM words_sessions WHERE owner=?')
    .get(batchUser);
  await assert.rejects(() => wordsService.commitWords(batchUser, bad));
  assert.deepEqual(
    sqlite.prepare('SELECT body,revision FROM words_sessions WHERE owner=?').get(batchUser),
    beforeInvalid,
  );
  assert.equal(
    sqlite
      .prepare('SELECT count(*) AS n FROM words_attempts WHERE id=?')
      .get(batchUser + ':words:' + bad.events[0].attemptId).n,
    0,
  );
  // Complete exactly 15 exercises, not 15 unique words. Hints and Next do not count.
  let rounds = 0;
  while (!journalCore.journalView(j).session.closed && rounds++ < 80) {
    const v = journalCore.journalView(j),
      q = v.session.question;
    if (!q) {
      j = journalCore.journalAppend(j, 'finish', '', 8);
      break;
    }
    if (v.session.feedback) j = journalCore.journalAppend(j, 'next', '', 8);
    else if (q.kind === 'intro') j = journalCore.journalAppend(j, 'continue', '', 8);
    else if (q.kind === 'self') {
      if (!q.hinted) j = journalCore.journalAppend(j, 'hint', '', 8);
      else j = journalCore.journalAppend(j, 'answer', 'yes', 8);
    } else j = journalCore.journalAppend(j, 'answer', answerFor(v), 8);
  }
  assert.equal(journalCore.journalView(j).session.turn, 15);
  assert.equal(journalCore.journalView(j).session.closed, true);
  const end = await wordsService.commitWords(batchUser, journalCore.journalBatch(j));
  assert.equal(JSON.stringify(end.session), JSON.stringify(journalCore.journalView(j).session));
  const changedResult = { ...end, revision: end.revision + 1 };
  assert.throws(() => journalCore.journalAck(j, j, changedResult), /changed/);
  console.log(
    'PASS: 15-exercise rounds, instant local journal, delayed prefix ack with new answers, reload recovery, batch replay, idempotent retry, invalid batch rollback and conflict preservation.',
  );
  const pureBase = structuredClone(ws.session),
    u = pureBase.units[0];
  pureBase.units = [u];
  pureBase.closed = false;
  pureBase.feedback = null;
  u.done = false;
  u.attempts = 0;
  u.availableAt = 0;
  u.state.stage = 'review';
  u.state.interval = 3;
  u.state.lastSuccessDay = wordsCore.addDays(pureBase.day, -14);
  u.state.failedDay = null;
  wordsCore.nextWordQuestion(pureBase);
  const wrong = wordsCore.applyWordAction(pureBase, 'answer', 'wrong');
  assert.equal(wrong.units[0].state.interval, 2);
  assert.equal(wrong.units[0].state.recovering, true);
  assert.equal(wrong.units[0].state.due, wordsCore.addDays(pureBase.day, 1));
  const accepted = wordsCore.applyWordAction(wrong, 'accept');
  assert.equal(accepted.units[0].state.interval, 3);
  assert.equal(accepted.wrong, 0);
  assert.equal(accepted.feedback.outcome, 'self');
  const nextDay = structuredClone(wrong);
  nextDay.day = wordsCore.addDays(nextDay.day, 1);
  nextDay.feedback = null;
  nextDay.units[0].state.stage = 'recall';
  nextDay.question.hinted = false;
  const recovered = wordsCore.applyWordAction(nextDay, 'answer', u.nl);
  assert.equal(recovered.units[0].state.interval, 2);
  assert.equal(recovered.units[0].state.due, wordsCore.addDays(nextDay.day, 7));
  const hinted = wordsCore.applyWordAction(pureBase, 'hint');
  const assisted = wordsCore.applyWordAction(hinted, 'answer', u.nl);
  assert.equal(assisted.units[0].state.interval, 3);
  assert.equal(assisted.feedback.outcome, 'supported');
  assert.equal(assisted.units[0].state.lastSuccessDay, u.state.lastSuccessDay);
  assert.equal(wordsCore.normalAnswer('  HET   HUIS. '), 'het huis');
  assert.notEqual(wordsCore.normalAnswer('de huis'), wordsCore.normalAnswer('het huis'));
  assert.notEqual(wordsCore.normalAnswer('opbellen'), wordsCore.normalAnswer('opgebeld'));
  assert.notEqual(
    wordsCore.learningDay('Europe/Amsterdam', new Date('2026-10-24T23:30:00Z')),
    wordsCore.learningDay('UTC', new Date('2026-10-24T23:30:00Z')),
  );
  await wordSend('finish');
  ws = await wordsService.startWords('words-user');
  const stale = {
    action: 'continue',
    sessionId: ws.session.id,
    revision: ws.revision,
    questionId: ws.session.question.id,
    attemptId: 'race-event',
    answer: '',
    elapsed: 0,
  };
  const wordBatch = env.DB.batch;
  env.DB.batch = async (statements) => {
    if (statements.length === 3) return wordBatch(statements);
    sqlite.prepare('UPDATE words_sessions SET revision=revision+1 WHERE owner=?').run('words-user');
    env.DB.batch = wordBatch;
    return wordBatch(statements);
  };
  await assert.rejects(() => wordsService.answerWords('words-user', stale), /changed/);
  assert.equal(
    sqlite
      .prepare('SELECT count(*) AS n FROM words_attempts WHERE id=?')
      .get('words-user:words:race-event').n,
    0,
  );
  // A separate owner proves Words backup restore, active-session resume and repeated/cross-owner import.
  const wordsBackup = await backupService.exportBackup('words-user');
  assert.equal(wordsBackup.wordsState.length, 4);
  assert.ok(wordsBackup.wordsAttempts.length);
  assert.ok(wordsBackup.wordsSession);
  for (const table of [
    'materials',
    'review_state',
    'review_attempts',
    'words_state',
    'words_attempts',
    'words_sessions',
  ])
    sqlite.prepare('DELETE FROM ' + table + ' WHERE owner=?').run('words-user');
  const wp = await backupService.previewBackup('words-user', wordsBackup);
  await backupService.importBackup('words-user', wordsBackup, wp.token);
  const restoredWords = await backupService.exportBackup('words-user');
  for (const key of ['wordsState', 'wordsAttempts', 'wordsSession'])
    assert.deepEqual(restoredWords[key], wordsBackup[key]);
  const wp2 = await backupService.previewBackup('words-user', wordsBackup);
  await backupService.importBackup('words-user', wordsBackup, wp2.token);
  assert.equal(
    (await backupService.exportBackup('words-user')).wordsAttempts.length,
    wordsBackup.wordsAttempts.length,
  );
  const otherPlan = await backupService.previewBackup('words-copy', wordsBackup);
  await backupService.importBackup('words-copy', wordsBackup, otherPlan.token);
  const otherBackup = await backupService.exportBackup('words-copy');
  assert.equal(otherBackup.wordsState.length, 4);
  assert.ok(
    otherBackup.wordsSession.body.units.every((u) =>
      otherBackup.materials.some((m) => m.id === u.id),
    ),
  );
  const otherPlan2 = await backupService.previewBackup('words-copy', wordsBackup);
  await backupService.importBackup('words-copy', wordsBackup, otherPlan2.token);
  assert.equal(
    (await backupService.exportBackup('words-copy')).wordsAttempts.length,
    otherBackup.wordsAttempts.length,
  );
  const solo = structuredClone(pureBase);
  solo.units[0].state = wordsCore.initialWordState('solo-key', solo.day);
  solo.units[0].attempts = 0;
  solo.units[0].misses = 0;
  solo.units[0].availableAt = 0;
  solo.units[0].done = false;
  solo.turn = 0;
  solo.question = null;
  solo.feedback = null;
  wordsCore.nextWordQuestion(solo);
  const soloRead = wordsCore.applyWordAction(solo, 'continue');
  const soloNext = soloRead;
  assert.ok(soloNext.question);
  assert.equal(soloNext.question.kind, 'self');
  assert.equal(wrong.units[0].availableAt, wrong.turn + 3);
  const spelling = structuredClone(solo);
  spelling.units[0].nl = 'opgebeld';
  spelling.units[0].state.stage = 'build';
  spelling.question = null;
  wordsCore.nextWordQuestion(spelling);
  assert.equal(spelling.question.kind, 'build');
  assert.equal(spelling.question.tokens.filter((x) => x === 'e').length, 2);
  assert.equal(spelling.question.tokens.length, 8);
  const practiceInput = load('lib/practice-input');
  for (const nl of ['ingewikkeld', 'de polder', 'als ik me niet vergis']) {
    const bank = wordsCore.wordBuildTokens(nl, 'assemble-regression'),
      used = new Set(),
      indices = Array.from(nl).map((c) => {
        const i = bank.findIndex((t, i) => t === c && !used.has(i));
        assert.ok(i >= 0);
        used.add(i);
        return i;
      });
    const actual = practiceInput.assembleBlocks(bank, indices, '');
    assert.equal(actual, nl);
    const fixture = structuredClone(spelling);
    fixture.units[0].nl = nl;
    fixture.question = null;
    wordsCore.nextWordQuestion(fixture);
    assert.equal(wordsCore.applyWordAction(fixture, 'answer', actual).feedback.outcome, 'correct');
    assert.equal(wordsCore.applyWordAction(fixture, 'answer', 'wrong').feedback.outcome, 'wrong');
    if (nl.includes(' '))
      assert.equal(
        wordsCore.applyWordAction(fixture, 'answer', Array.from(nl).join(' ')).feedback.outcome,
        'wrong',
      );
  }
  assert.equal(
    practiceInput.assembleBlocks(['de', 'kat', 'de', 'ziet'], [0, 1, 3, 2], ' '),
    'de kat ziet de',
  );

  for (const nl of ['de polder', 'het huis', 'ik bel je op']) {
    const letters = wordsCore.wordBuildTokens(nl, 'letters-test');
    assert.equal(letters.length, Array.from(nl).length);
    assert.ok(letters.every((t) => Array.from(t).length === 1));
    assert.equal(letters.filter((t) => t === ' ').length, nl.split(' ').length - 1);
    const original = structuredClone(spelling);
    original.units[0].nl = nl;
    original.question = null;
    wordsCore.nextWordQuestion(original);
    assert.ok(original.question.tokens.every((t) => Array.from(t).length === 1));
    const checked = wordsCore.applyWordAction(original, 'answer', nl);
    assert.equal(checked.feedback.outcome, 'correct');
  }

  const itemContent = { title: 'opgebeld', body: { en: 'called', notes: 'before' } };
  assert.equal(
    wordsCore.wordContent(itemContent),
    wordsCore.wordContent({ ...itemContent, body: { ...itemContent.body, notes: 'after' } }),
  );
  assert.notEqual(
    wordsCore.wordContent(itemContent),
    wordsCore.wordContent({ ...itemContent, body: { en: 'phoned yesterday' } }),
  );
  {
    const progress = load('lib/word-progress'),
      today = wordsCore.learningDay(),
      stateKey = await common.hash(
        wordsCore.wordContent({ title: 'opgebeld', body: { en: 'called' } }),
      );
    for (const [stage, level] of [
      ['intro', 0],
      ['recognize', 1],
      ['build', 2],
      ['recall', 3],
      ['review', 4],
    ])
      assert.equal(
        progress.learningProgress({ ...wordsCore.initialWordState(stateKey, today), stage }).level,
        level,
      );
    assert.equal(
      progress.learningProgress({
        ...wordsCore.initialWordState(stateKey, today),
        stage: 'review',
        interval: 3,
      }).level,
      5,
    );
    const user = 'progress-reset-test',
      item = await materials.addMaterial(user, {
        kind: 'phrase',
        title: 'opgebeld',
        body: { en: 'called' },
        practice: true,
      }),
      seed = {
        ...wordsCore.initialWordState(stateKey, today),
        stage: 'review',
        interval: 3,
        lastSuccessDay: wordsCore.addDays(today, -14),
      };
    sqlite
      .prepare('INSERT INTO words_state(material_id,owner,body,updated) VALUES(?,?,?,?)')
      .run(item.id, user, JSON.stringify(seed), new Date().toISOString());
    let current = await wordsService.startWords(user);
    const answerPayload = {
      action: 'answer',
      sessionId: current.session.id,
      revision: current.revision,
      questionId: current.session.question.id,
      attemptId: 'before-reset',
      answer: 'opgebeld',
      elapsed: 10,
    };
    current = await wordsService.answerWords(user, answerPayload);
    assert.equal((await materials.listMaterials(user, '', false, true))[0].learning.level, 5);
    const request = { action: 'reset', id: item.id, version: 1, attemptId: 'reset-once' },
      beforeAttempts = sqlite
        .prepare('SELECT COUNT(*) n FROM words_attempts WHERE owner=?')
        .get(user).n;
    assert.equal((await wordsService.resetWords(user, request)).ok, true);
    const resetItem = (await materials.listMaterials(user, '', false, true))[0];
    assert.equal(resetItem.learning.level, 0);
    assert.equal(resetItem.rank, 0);
    assert.equal(resetItem.last_seen, null);
    assert.equal(resetItem.practice, true);
    assert.equal(resetItem.title, 'opgebeld');
    assert.equal(resetItem.body.en, 'called');
    assert.equal(resetItem.version, 1);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) n FROM words_attempts WHERE owner=?').get(user).n,
      beforeAttempts + 1,
    );
    assert.equal((await wordsService.getWords(user)).session, null);
    const restarted = await wordsService.startWords(user);
    assert.equal(restarted.session.question.kind, 'intro');
    assert.equal((await wordsService.resetWords(user, request)).duplicate, true);
    assert.equal((await wordsService.getWords(user)).session.id, restarted.session.id);
    await assert.rejects(
      () => wordsService.answerWords(user, { ...answerPayload, attemptId: 'stale-before-reset' }),
      /changed/,
    );
    assert.equal((await wordsService.answerWords(user, answerPayload)).duplicate, true);
    assert.equal((await materials.listMaterials(user, '', false, true))[0].learning.level, 0);
    await assert.rejects(
      () => wordsService.resetWords('other-owner', { ...request, attemptId: 'foreign-reset' }),
      /not found/,
    );
    await assert.rejects(
      () => wordsService.resetWords(user, { ...request, attemptId: 'wrong-version', version: 99 }),
      /changed/,
    );
    assert.equal((await wordsRoute.POST(req('/api/words', request, null))).status, 401);
    const originalBatch = env.DB.batch;
    env.DB.batch = async (statements) => {
      if (statements.length === 4) return originalBatch(statements);
      env.DB.batch = originalBatch;
      sqlite
        .prepare('UPDATE words_state SET body=? WHERE material_id=?')
        .run(
          JSON.stringify({ ...wordsCore.initialWordState(stateKey, today), stage: 'build' }),
          item.id,
        );
      return originalBatch(statements);
    };
    await assert.rejects(
      () => wordsService.resetWords(user, { ...request, attemptId: 'raced-reset' }),
      /changed/,
    );
    assert.equal(
      sqlite
        .prepare('SELECT COUNT(*) n FROM words_attempts WHERE id=?')
        .get(user + ':words-reset:raced-reset').n,
      0,
    );
    assert.equal((await materials.listMaterials(user, '', false, true))[0].learning.level, 2);
    const owner = 'start-reset-race',
      entry = await materials.addMaterial(owner, {
        kind: 'phrase',
        title: 'opgebeld',
        body: { en: 'called' },
        practice: true,
      });
    sqlite
      .prepare('INSERT INTO words_state(material_id,owner,body,updated) VALUES(?,?,?,?)')
      .run(entry.id, owner, JSON.stringify(seed), new Date().toISOString());
    env.DB.batch = async (statements) => {
      env.DB.batch = originalBatch;
      await wordsService.resetWords(owner, {
        action: 'reset',
        id: entry.id,
        version: 1,
        attemptId: 'race-start',
      });
      return originalBatch(statements);
    };
    await assert.rejects(() => wordsService.startWords(owner), /session started/);
    assert.equal((await materials.listMaterials(owner, '', false, true))[0].learning.level, 0);
    assert.equal((await wordsService.getWords(owner)).session, null);
    const materialsRoute = load('app/api/materials/route');
    const visibleProgress = await (
      await materialsRoute.GET(req('/api/materials', null, user))
    ).json();
    assert.equal(visibleProgress[0].learning.level, 2);
    const resetBackup = await backupService.exportBackup(owner),
      restoreReset = await backupService.previewBackup('reset-copy', resetBackup);
    await backupService.importBackup('reset-copy', resetBackup, restoreReset.token);
    assert.equal(
      (await materials.listMaterials('reset-copy', '', false, true))[0].learning.level,
      0,
    );
    assert.ok(
      (await backupService.exportBackup('reset-copy')).wordsAttempts.some(
        (a) => a.body.action === 'reset',
      ),
    );
    console.log(
      'PASS: displayed levels 0–5, owner/version-safe reset, preserved content/practice/history, idempotent reset, closed stale sessions, concurrent answer/reset and start/reset guards.',
    );
  }
  console.log(
    'PASS: Words stages in both directions, exact spelling/article, independent recall schedule, hint limits, error recovery/self-check, four-new selection, persisted resume, owner isolation, duplicate attempts, concurrent rollback, timezone, v2 backup roundtrip and cross-owner remapping.',
  );
  const backup = await backupService.exportBackup('alice');
  assert.equal(backup.schemaVersion, 2);
  assert.ok(backup.materials.some((m) => m.body._archived));
  assert.ok(backup.materials.some((m) => m.kind === 'note'));
  assert.ok(backup.textTranslations.length);
  assert.ok(!JSON.stringify(backup).includes(testKey));
  assert.ok(!JSON.stringify(backup).includes(stored));
  assert.ok(!JSON.stringify(backup).includes('key_cipher'));
  const networkBeforeRestore = requests.length;
  for (const table of [
    'materials',
    'review_state',
    'review_attempts',
    'words_state',
    'words_attempts',
    'words_sessions',
  ])
    sqlite.prepare('DELETE FROM ' + table + ' WHERE owner=?').run('alice');
  sqlite
    .prepare("DELETE FROM lookup_cache WHERE owner=? AND id LIKE 'text-translation:%'")
    .run('alice');
  let preview = await backupService.previewBackup('alice', backup);
  assert.equal(preview.summary.new, backup.materials.length);
  await backupService.importBackup('alice', backup, preview.token);
  const restored = await backupService.exportBackup('alice');
  const content = (b) =>
    JSON.stringify({
      materials: b.materials,
      reviewState: b.reviewState,
      reviewAttempts: b.reviewAttempts,
      textTranslations: b.textTranslations,
    });
  assert.equal(content(restored), content(backup));
  preview = await backupService.previewBackup('alice', backup);
  assert.equal(preview.summary.new, 0);
  assert.equal(preview.summary.conflicts, 0);
  await backupService.importBackup('alice', backup, preview.token);
  assert.equal(content(await backupService.exportBackup('alice')), content(backup));
  const beforeConflict = await backupService.previewBackup('alice', backup);
  const edit = backup.materials.find((m) => m.id === note.id);
  await materials.updateMaterial('alice', {
    id: note.id,
    version: edit.body._version,
    title: 'Newer teacher notes',
  });
  await assert.rejects(
    () => backupService.importBackup('alice', backup, beforeConflict.token),
    /changed/,
  );
  preview = await backupService.previewBackup('alice', backup);
  assert.equal(preview.summary.conflicts, 1);
  await backupService.importBackup('alice', backup, preview.token);
  assert.equal(
    (await materials.listMaterials('alice')).find((m) => m.id === note.id).title,
    'Newer teacher notes',
  );
  const cross = await backupService.previewBackup('restore-user', backup);
  await backupService.importBackup('restore-user', backup, cross.token);
  const restoredForeign = await materials.listMaterials('restore-user');
  const foreignText = restoredForeign.find((m) => m.title === 'Backup source'),
    foreignPhrase = restoredForeign.find((m) => m.id !== link.id && m.title === 'bank');
  assert.notEqual(foreignText.id, linkedText.id);
  assert.equal(foreignPhrase.body.textId, foreignText.id);
  const foreignReading = await textService.readText('restore-user', foreignText.id);
  assert.equal(foreignReading.segments[0].en, 'The bank.');
  assert.equal(foreignPhrase.body.segmentId, foreignReading.segments[0].id);
  const again = await backupService.previewBackup('restore-user', backup);
  assert.equal(again.summary.new, 0);
  assert.equal(again.summary.conflicts, 0);
  const attemptsBefore = sqlite
    .prepare('SELECT COUNT(*) n FROM review_attempts WHERE owner=?')
    .get('restore-user').n;
  await backupService.importBackup('restore-user', backup, again.token);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM review_attempts WHERE owner=?').get('restore-user').n,
    attemptsBefore,
  );
  await assert.rejects(
    () => backupService.previewBackup('alice', { ...backup, schemaVersion: 99 }),
    /supported/,
  );
  await assert.rejects(
    () =>
      backupService.previewBackup('alice', {
        ...backup,
        reviewState: [{ ...backup.reviewState[0], rank: 99 }],
      }),
    /supported/,
  );
  await assert.rejects(
    () =>
      backupService.previewBackup('alice', {
        ...backup,
        textTranslations: [
          { materialId: linkedText.id, nl: 'Wrong sentence.', occurrence: 0, en: 'Wrong.' },
        ],
      }),
    /does not match/,
  );
  const large = {
    format: backup.format,
    schemaVersion: 1,
    exportedAt: backup.exportedAt,
    materials: Array.from({ length: 1000 }, (_, i) => ({
      id: 'bulk-' + i,
      kind: 'phrase',
      title: 'Woord ' + i,
      body: { en: 'Meaning ' + i, _version: 1, _archived: false },
      created: backup.exportedAt,
    })),
    reviewState: [],
    reviewAttempts: [],
    textTranslations: [],
  };
  const largePlan = await backupService.previewBackup('large-user', large);
  assert.equal(largePlan.summary.new, 1000);
  await backupService.importBackup('large-user', large, largePlan.token);
  assert.equal((await materials.listMaterials('large-user')).length, 1000);
  assert.equal((await backupService.previewBackup('large-user', large)).summary.new, 0);
  // A concurrent write during the final transaction must preserve that write and roll back the import.
  const race = {
    ...large,
    materials: [large.materials[0], { ...large.materials[1], id: 'race-new', title: 'Race new' }],
  };
  const racePlan = await backupService.previewBackup('large-user', race),
    originalBatch = env.DB.batch;
  env.DB.batch = async (statements) => {
    env.DB.batch = originalBatch;
    sqlite.prepare('UPDATE materials SET title=? WHERE id=?').run('Concurrent edit', 'bulk-0');
    return originalBatch(statements);
  };
  await assert.rejects(
    () => backupService.importBackup('large-user', race, racePlan.token),
    /Nothing was imported/,
  );
  assert.equal(sqlite.prepare('SELECT id FROM materials WHERE id=?').get('race-new'), undefined);
  assert.equal(
    sqlite.prepare('SELECT title FROM materials WHERE id=?').get('bulk-0').title,
    'Concurrent edit',
  );
  assert.equal((await backupRoute.GET(req('/api/backup', null, null))).status, 401);
  const forbidden = req('/api/backup', { action: 'preview', backup });
  forbidden.headers.set('origin', 'https://evil.test');
  assert.equal((await backupRoute.POST(forbidden)).status, 403);
  const previewResponse = await backupRoute.POST(req('/api/backup', { action: 'preview', backup }));
  assert.equal(previewResponse.status, 200);
  assert.equal(typeof (await previewResponse.json()).token, 'string');
  const badJson = new Request('https://example.test/api/backup', {
    method: 'POST',
    headers: { 'oai-authenticated-user-id': 'alice' },
    body: '{',
  });
  assert.equal((await backupRoute.POST(badJson)).status, 400);
  const tooLarge = req('/api/backup', { action: 'preview', backup });
  tooLarge.headers.set('content-length', '12000001');
  assert.equal((await backupRoute.POST(tooLarge)).status, 413);
  assert.equal(requests.length, networkBeforeRestore);
  assert.equal(env.BUCKET.store.size, bucketCount);
  const sentencesCore = load('lib/sentences'),
    sentencesService = load('lib/server/sentences'),
    sentencesRoute = load('app/api/sentences/route'),
    snUser = 'sentences-owner',
    snNetwork = requests.length;
  const emptySentences = { base: { session: null, revision: 0 }, events: [] };
  for (let reload = 0; reload < 3; reload++)
    assert.equal(
      JSON.stringify(sentencesCore.restoreSentences(JSON.stringify(emptySentences))),
      JSON.stringify(emptySentences),
    );
  assert.throws(
    () =>
      sentencesCore.restoreSentences(
        JSON.stringify({
          ...emptySentences,
          events: [{ id: 'bad', action: 'next', index: 0, answer: '' }],
        }),
      ),
    /recovery/,
  );
  assert.throws(() => sentencesCore.restoreSentences('null'), /recovery/);
  console.log(
    'PASS: empty Words and Sentences journals survive reload/mode switching; malformed and impossible pending journals remain rejected.',
  );
  const snText = await materials.addMaterial(snUser, {
    kind: 'text',
    title: 'A day at home',
    body: {
      segments: [
        { nl: 'Ik ben thuis.', en: 'I am at home.' },
        { nl: 'Ik bel mijn moeder.', en: 'I call my mother.' },
        { nl: 'Ik zie de kat en de hond.', en: 'I see the cat and the dog.' },
        { nl: 'Ik weet het niet.', en: '' },
      ],
    },
  });
  await materials.addMaterial(snUser, {
    kind: 'phrase',
    title: 'Geen tekst',
    body: { en: 'Not a text' },
  });
  const snOther = await materials.addMaterial('sentences-other', {
    kind: 'text',
    title: 'Private other',
    body: { segments: [{ nl: 'Dat is geheim.', en: 'That is secret.' }] },
  });
  const snSources = await sentencesService.getSentences(snUser);
  assert.equal(snSources.sources.length, 1);
  assert.equal(snSources.sources[0].ready, 3);
  assert.equal(snSources.sources[0].total, 4);
  assert.equal((await sentencesRoute.GET(req('/api/sentences', null, null))).status, 401);
  const snForbidden = req(
    '/api/sentences',
    { action: 'start', source: 'all', mode: 'typing' },
    snUser,
  );
  snForbidden.headers.set('origin', 'https://evil.test');
  assert.equal((await sentencesRoute.POST(snForbidden)).status, 403);
  await assert.rejects(
    () =>
      sentencesService.startSentences(snUser, {
        action: 'start',
        source: snOther.id,
        mode: 'typing',
      }),
    /not found/,
  );
  let sn = await sentencesService.startSentences(snUser, {
    action: 'start',
    source: snText.id,
    mode: 'blocks',
  });
  assert.equal(sn.session.items.length, 3);
  assert.ok(sn.session.items.every((i) => i.textId === snText.id));
  assert.equal(
    (
      await sentencesService.startSentences(snUser, {
        action: 'start',
        source: 'all',
        mode: 'typing',
      })
    ).session.id,
    sn.session.id,
  );
  assert.equal((await sentencesService.getSentences('sentences-other')).session, null);
  assert.equal(sentencesCore.normalizeSentence(' IK  BEN thuis! '), 'ik ben thuis');
  assert.notEqual(
    sentencesCore.normalizeSentence('Ik ben thuis.'),
    sentencesCore.normalizeSentence('Ben ik thuis?'),
  );
  const repeated = sn.session.items.find((i) => i.nl.includes('de kat'));
  assert.equal(repeated.tokens.filter((t) => t === 'de').length, 2);
  let snJournal = { base: sn, events: [] },
    snCount = 0;
  const snEvent = (action, answer = '') => ({
    id: 'sn-' + ++snCount,
    action,
    index: sentencesCore.sentenceView(snJournal).session.index,
    answer,
  });
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('check', 'incorrect'));
  assert.equal(sentencesCore.sentenceView(snJournal).session.feedback.outcome, 'wrong');
  const snSent = structuredClone(snJournal);
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('next'));
  const snAck = await sentencesService.syncSentences(snUser, {
    action: 'batch',
    sessionId: sn.session.id,
    revision: snSent.base.revision,
    events: snSent.events,
  });
  assert.equal(
    (
      await sentencesService.syncSentences(snUser, {
        action: 'batch',
        sessionId: sn.session.id,
        revision: snSent.base.revision,
        events: snSent.events,
      })
    ).duplicate,
    true,
  );
  snJournal = sentencesCore.ackSentences(snJournal, snSent, snAck);
  assert.equal(snJournal.events.length, 1);
  assert.equal(sentencesCore.sentenceView(snJournal).session.index, 1);
  snJournal = sentencesCore.restoreSentences(JSON.stringify(snJournal));
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('hint'));
  const snExpected = sentencesCore.sentenceView(snJournal).session.items[1].nl;
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('check', snExpected));
  assert.equal(sentencesCore.sentenceView(snJournal).session.feedback.outcome, 'supported');
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('next'));
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('check', 'a valid alternative'));
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('accept'));
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('next'));
  assert.equal(sentencesCore.sentenceView(snJournal).session.closed, true);
  const snDone = await sentencesService.syncSentences(snUser, {
    action: 'batch',
    sessionId: sn.session.id,
    revision: snJournal.base.revision,
    events: snJournal.events,
  });
  assert.equal(sentencesCore.sentenceScores(snDone.session).wrong, 1);
  assert.equal(sentencesCore.sentenceScores(snDone.session).supported, 2);
  assert.equal((await sentencesService.getSentences(snUser)).session.closed, true);
  // New typing round; source edits reject all pending actions, preserving the local journal.
  sn = await sentencesService.startSentences(snUser, {
    action: 'start',
    source: 'all',
    mode: 'typing',
  });
  assert.equal(sn.session.mode, 'typing');
  snJournal = { base: sn, events: [] };
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('check', sn.session.items[0].nl));
  snJournal = sentencesCore.appendSentence(snJournal, snEvent('finish'));
  assert.equal(
    sentencesCore.sentenceScores(sentencesCore.sentenceView(snJournal).session).correct,
    1,
  );
  const snMaterial = (await materials.listMaterials(snUser)).find((i) => i.id === snText.id);
  await materials.updateMaterial(snUser, {
    id: snText.id,
    version: snMaterial.version,
    body: { segments: [{ nl: 'Dit is veranderd.', en: 'This has changed.' }] },
  });
  await assert.rejects(
    () =>
      sentencesService.syncSentences(snUser, {
        action: 'batch',
        sessionId: sn.session.id,
        revision: sn.revision,
        events: snJournal.events,
      }),
    /source sentence changed/,
  );
  assert.equal((await sentencesService.getSentences(snUser)).revision, sn.revision);
  assert.equal(snJournal.events.length, 2);
  const finishRecovery = await sentencesService.syncSentences(snUser, {
    action: 'batch',
    sessionId: sn.session.id,
    revision: sn.revision,
    events: [{ id: 'finish-stale', action: 'finish', index: 0, answer: '' }],
  });
  assert.equal(finishRecovery.session.closed, true);
  const capUser = 'sentences-cap';
  await materials.addMaterial(capUser, {
    kind: 'text',
    title: 'Long text',
    body: {
      segments: Array.from({ length: 20 }, (_, i) => ({
        nl: 'Dit is zin ' + i + '.',
        en: 'This is sentence ' + i + '.',
      })),
    },
  });
  const capped = await sentencesService.startSentences(capUser, {
    action: 'start',
    source: 'all',
    mode: 'typing',
  });
  assert.equal(capped.session.items.length, 5);
  assert.equal(new Set(capped.session.items.map((i) => i.id)).size, 5);
  assert.equal(requests.length, snNetwork);
  console.log(
    'PASS: Sentences text-only sources, ready/missing translations, owner/origin isolation, Blocks/Typing, repeated tokens, punctuation/case, instant local answers, delayed batch ack, lost-response retry, reload recovery, hint/self-check scores, finish and edited-source rejection without provider calls.',
  );
  const eleven = load('lib/server/eleven-speech'),
    audioRoute = load('app/api/audio-settings/route'),
    speechRoute = load('app/api/speech/route'),
    textAudio = load('lib/text-audio');
  const eu = 'eleven-owner';
  const oldCipher = await settings.encryptKey('test-eleven-secret', eu);
  sqlite
    .prepare('INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
    .run(
      'audio-comparison-v1:' + (await common.hash(eu + ':key')),
      eu,
      JSON.stringify({ cipher: oldCipher }),
      new Date().toISOString(),
    );
  sqlite
    .prepare('INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?)')
    .run(
      'audio-comparison-v1:' + (await common.hash(eu + ':run')),
      eu,
      JSON.stringify({ voice: 'dutch-test', model: 'eleven_v3' }),
      new Date().toISOString(),
    );
  const migrated = await eleven.elevenStatus(eu);
  assert.equal(migrated.audioReady, true);
  assert.equal(migrated.voice, 'dutch-test');
  assert.equal(migrated.model, 'eleven_v3');
  assert.ok(!JSON.stringify(migrated).includes('test-eleven-secret'));
  assert.equal((await eleven.elevenStatus('not-owner')).audioReady, false);
  await eleven.manageEleven(eu, { action: 'voices' });
  await eleven.manageEleven(eu, { action: 'preferences', voice: 'dutch-test', model: 'eleven_v4' });
  const beforeE = requests.length;
  const e1 = await eleven.elevenSpeech(eu, 'gelden');
  assert.equal(e1.headers.get('X-Audio-Cache'), 'miss');
  assert.equal((await eleven.elevenSpeech(eu, 'gelden')).headers.get('X-Audio-Cache'), 'hit');
  assert.equal(requests.length, beforeE + 1);
  assert.ok(requests.at(-1).url.includes('api.elevenlabs.io'));
  assert.equal(JSON.parse(requests.at(-1).options.body).language_code, 'nl');
  await assert.rejects(() => eleven.elevenSpeech('not-owner', 'gelden'), /Connect ElevenLabs/);
  assert.equal((await audioRoute.GET(req('/api/audio-settings', null, null))).status, 401);
  assert.equal((await speechRoute.POST(req('/api/speech', { text: 'gelden' }, null))).status, 401);
  await assert.rejects(
    () => eleven.manageEleven(eu, { action: 'key', key: 'invalid-eleven-key' }),
    /rejected/,
  );
  assert.equal((await eleven.elevenStatus(eu)).audioReady, true);
  audioBackground = [];
  const savedAudio = await materials.addMaterial(eu, {
    kind: 'phrase',
    title: 'fiets',
    body: { article: 'de', en: 'bicycle', partOfSpeech: 'noun' },
  });
  assert.equal(audioBackground.length, 1, 'collection save schedules recording');
  await Promise.all(audioBackground);
  const beforeSavedPlay = requests.length;
  assert.equal((await eleven.elevenSpeech(eu, 'de fiets')).headers.get('X-Audio-Cache'), 'hit');
  assert.equal(
    requests.length,
    beforeSavedPlay,
    'saved noun includes article and already has audio',
  );
  audioBackground = [];
  await materials.updateMaterial(eu, {
    id: savedAudio.id,
    version: 1,
    title: 'het huis',
    body: { article: 'het', en: 'house' },
  });
  await Promise.all(audioBackground);
  assert.equal((await eleven.elevenSpeech(eu, 'het huis')).headers.get('X-Audio-Cache'), 'hit');
  audioBackground = [];
  await materials.addMaterial('no-audio-account', {
    kind: 'phrase',
    title: 'Ik fiets.',
    body: { en: 'I cycle.' },
  });
  await Promise.all(audioBackground);
  assert.equal(
    (await materials.listMaterials('no-audio-account')).length,
    1,
    'missing credentials never prevent a save',
  );
  audioBackground = [];
  const savedSentence = await materials.addMaterial(eu, {
    kind: 'phrase',
    title: 'Ik fiets naar huis.',
    practiceMode: 'sentences',
    body: { en: 'I cycle home.' },
  });
  await Promise.all(audioBackground);
  assert.equal(
    (await eleven.elevenSpeech(eu, 'Ik fiets naar huis.')).headers.get('X-Audio-Cache'),
    'hit',
  );
  audioBackground = [];
  await materials.updateMaterial(eu, { id: savedSentence.id, version: 1, archived: true });
  await materials.addMaterial(eu, { kind: 'note', title: 'No audio note', body: {} });
  assert.equal(audioBackground.length, 0, 'notes and archived entries do not schedule recordings');
  audioBackground = null;
  const et = await materials.addMaterial(eu, {
    kind: 'text',
    title: 'Connected audio',
    body: {
      segments: [
        { nl: 'Om 8.00 uur begint de les.', en: 'The lesson starts at eight.' },
        { nl: 'Ik ga naar school.', en: 'I go to school.' },
      ],
    },
  });
  let er = await textService.readText(eu, et.id);
  assert.equal(er.keyConfigured, false);
  assert.equal(er.audioConfigured, true);
  const beforeChunk = requests.length;
  const responses = await Promise.all(
    er.segments.map((seg) => textService.prepareTextAudio(eu, et.id, seg.id)),
  );
  assert.equal(requests.length, beforeChunk + 1);
  assert.ok(requests.at(-1).url.includes('with-timestamps'));
  assert.equal(
    JSON.parse(requests.at(-1).options.body).inputs[0].text,
    'Om 8.00 uur begint de les. Ik ga naar school.',
  );
  assert.ok(responses.every((r) => r.headers.get('Content-Type') === 'audio/wav'));
  er = await textService.readText(eu, et.id);
  assert.ok(er.segments.every((s) => s.audioReady));
  await textService.prepareTextAudio(eu, et.id, er.segments[1].id);
  assert.equal(requests.length, beforeChunk + 1);
  await assert.rejects(
    () => textService.prepareTextAudio('not-owner', et.id, er.segments[0].id),
    /not found/,
  );
  // The reader receives the original full recording, not a second generated or sliced version.
  const fullBefore = requests.length,
    fullResponse = await textService.prepareTextAudio(eu, et.id, er.segments[1].id, true),
    timeline = JSON.parse(fullResponse.headers.get('X-Audio-Timeline'));
  assert.equal(timeline.length, er.segments.length);
  assert.equal(
    JSON.stringify(timeline.map((c) => c.id)),
    JSON.stringify(er.segments.map((s) => s.id)),
  );
  const fullPath = [...env.BUCKET.store.keys()]
    .filter((k) => k.startsWith('eleven-text/') && k.endsWith('/full.wav'))
    .at(-1);
  assert.deepEqual(
    Buffer.from(await fullResponse.arrayBuffer()),
    Buffer.from(env.BUCKET.store.get(fullPath)),
  );
  assert.equal(requests.length, fullBefore);
  assert.ok(timeline[1].start > timeline[0].start);
  assert.equal(timeline.at(-1).end, (env.BUCKET.store.get(fullPath).byteLength - 44) / 48000);
  assert.equal(
    (
      await textsRoute.POST(
        req(
          '/api/texts',
          { id: et.id, action: 'audio-fragment', segment: er.segments[0].id },
          null,
        ),
      )
    ).status,
    401,
  );
  const fullRoute = await textsRoute.POST(
    req('/api/texts', { id: et.id, action: 'audio-fragment', segment: er.segments[0].id }, eu),
  );
  assert.equal(fullRoute.status, 200);
  assert.equal(JSON.parse(fullRoute.headers.get('X-Audio-Timeline')).length, 2);
  assert.equal(requests.length, fullBefore);
  const groups = textAudio.audioGroups([
    { id: '1', nl: 'a'.repeat(950) },
    { id: '2', nl: 'b'.repeat(950) },
    { id: '3', nl: 'short' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 1);
  assert.equal(groups[1].length, 2);
  assert.throws(
    () =>
      textAudio.sentenceRanges(
        ['8.00'],
        {
          characters: ['a', 'c', 'h', 't'],
          character_start_times_seconds: [0, 0.1, 0.2, 0.3],
          character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
        },
        1,
      ),
    /match/,
  );
  assert.throws(() => textAudio.sentenceRanges(['x'], null, 1), /Missing/);
  // Lost derived file recovers from the saved full recording without paying again.
  const r2Paths = [...env.BUCKET.store.keys()].filter(
    (k) => k.startsWith('eleven-text/') && k.endsWith('/complete'),
  );
  assert.ok(r2Paths.length);
  env.BUCKET.store.delete(r2Paths.at(-1));
  const beforeRepair = requests.length;
  await textService.prepareTextAudio(eu, et.id, er.segments[0].id);
  assert.equal(requests.length, beforeRepair);
  const multi = await materials.addMaterial(eu, {
    kind: 'text',
    title: 'Multiple chunks',
    body: {
      segments: [
        { nl: 'a'.repeat(950), en: 'first' },
        { nl: 'b'.repeat(950), en: 'second' },
        { nl: 'Kort.', en: 'short' },
      ],
    },
  });
  let multiRead = await textService.readText(eu, multi.id);
  await textService.prepareTextAudio(eu, multi.id, multiRead.segments[0].id);
  await textService.prepareTextAudio(eu, multi.id, multiRead.segments[1].id);
  assert.ok((await textService.readText(eu, multi.id)).segments.every((s) => s.audioReady));
  await textService.editText(eu, multi.id, {
    version: 1,
    title: 'Multiple chunks',
    source: '',
    original: 'c'.repeat(950) + '\n' + 'b'.repeat(950) + '\nKort.',
  });
  multiRead = await textService.readText(eu, multi.id);
  assert.equal(multiRead.segments[0].audioReady, false);
  assert.equal(multiRead.segments[1].audioReady, true);
  assert.equal(multiRead.segments[2].audioReady, true);
  const oldScope = (await eleven.elevenStatus(eu)).scope;
  await eleven.manageEleven(eu, { action: 'preferences', voice: 'dutch-test', model: 'eleven_v3' });
  assert.notEqual((await eleven.elevenStatus(eu)).scope, oldScope);
  assert.ok((await textService.readText(eu, et.id)).segments.every((s) => !s.audioReady));
  await eleven.manageEleven(eu, { action: 'forget' });
  assert.equal((await eleven.elevenStatus(eu)).audioReady, false);
  console.log(
    'PASS: ElevenLabs production migration, owner-bound credentials, My Voices, audio-only operation without OpenAI, persisted word cache, timestamps and source-preserving connected chunks, sentence extraction, concurrent single-flight, provider-scope invalidation and strict timing validation.',
  );
  console.log(
    'PASS: complete backup restores content/archive/text translations/history exactly into empty storage; repeat import; preserved current edits; cross-owner ID/reference remap; 1,000-entry import; atomic rollback; file validation; no keys/audio/OpenAI calls.',
  );
  const detailCalls = requests.length,
    detailBucket = env.BUCKET.store.size,
    detailOwner = 'detail-fixture',
    snapshotTool = load('lib/dictionary-snapshot');
  const detailEntry = {
    found: true,
    lemma: 'opbellen',
    partOfSpeech: 'verb',
    article: '',
    ipa: '/test/',
    forms: [{ label: 'past', value: 'belde op' }],
    senses: [
      {
        meaning: 'to call',
        example: 'Ik bel je op.',
        exampleTranslation: 'I will call you.',
        usage: '',
      },
      { meaning: 'to telephone', example: '', exampleTranslation: '', usage: '' },
    ],
    related: [{ word: 'bellen', meaning: 'to ring' }],
    source: 'Wiktionary',
    sourceUrl: 'https://en.wiktionary.org/wiki/opbellen',
    notes: 'Separable verb.',
    queryExplanation: '',
  };
  const detailSnapshot = snapshotTool.dictionarySnapshot(detailEntry);
  assert.equal(detailSnapshot.forms[0].value, 'belde op');
  assert.equal(detailSnapshot.senses.length, 2);
  assert.equal(snapshotTool.dictionarySnapshot(detailEntry, 'lopen'), undefined);
  const bounded = snapshotTool.dictionarySnapshot({
    ...detailEntry,
    forms: Array(100).fill({ label: 'past', value: 'x'.repeat(1000) }),
  });
  assert.equal(bounded.forms.length, 1);
  assert.equal(bounded.forms[0].value.length, 240);
  const detailText = await materials.addMaterial(detailOwner, {
      kind: 'text',
      title: 'Delete and restore',
      body: {
        source: 'Lesson',
        original: 'Ik bel je op.',
        segments: [{ nl: 'Ik bel je op.', en: 'I will call you.' }],
      },
    }),
    detailWord = await materials.addMaterial(detailOwner, {
      kind: 'phrase',
      title: 'opgebeld',
      practice: true,
      body: {
        en: 'called',
        selectedForm: 'opgebeld',
        lemma: 'opbellen',
        textId: detailText.id,
        dictionarySnapshot: detailSnapshot,
      },
    });
  const summaryDetails = await materials.listMaterials(
    detailOwner,
    '',
    false,
    true,
    'phrase',
    true,
  );
  assert.equal(summaryDetails[0].body.dictionarySnapshot, undefined);
  assert.equal(summaryDetails[0].body.forms, undefined);
  assert.equal(summaryDetails[0].body.en, 'called');
  const fullDetails = await materials.getMaterial(detailOwner, detailWord.id);
  assert.equal(fullDetails.body.dictionarySnapshot.senses.length, 2);
  await assert.rejects(
    () => materials.getMaterial('other-detail-owner', detailWord.id),
    /not found/,
  );
  const materialDetailRoute = load('app/api/materials/route');
  assert.equal(
    (await materialDetailRoute.GET(req('/api/materials?id=' + detailWord.id, null, null))).status,
    401,
  );
  assert.equal(
    (
      await materialDetailRoute.GET(
        req('/api/materials?id=' + detailWord.id, null, 'other-detail-owner'),
      )
    ).status,
    404,
  );
  const routeSummary = await (
    await materialDetailRoute.GET(req('/api/materials?kind=phrase&summary=true', null, detailOwner))
  ).json();
  assert.equal(routeSummary[0].body.dictionarySnapshot, undefined);
  const beforeDetail = await load('lib/server/words').getWords(detailOwner),
    beforeWord = (await materials.listMaterials(detailOwner)).find((x) => x.id === detailWord.id);
  await materials.updateMaterial(detailOwner, {
    id: detailWord.id,
    version: 1,
    body: { dictionarySnapshot: { ...detailSnapshot, notes: 'Saved details.' } },
  });
  const afterDetail = await load('lib/server/words').getWords(detailOwner),
    afterWord = (await materials.listMaterials(detailOwner)).find((x) => x.id === detailWord.id);
  assert.equal(afterWord.title, 'opgebeld');
  assert.equal(afterWord.body.en, 'called');
  assert.equal(afterWord.body.lemma, 'opbellen');
  assert.equal(beforeDetail.total, afterDetail.total);
  assert.equal(beforeWord.rank, afterWord.rank);
  await materials.updateMaterial(detailOwner, { id: detailText.id, version: 1, archived: true });
  assert.equal((await materials.listTextLibrary(detailOwner)).length, 0);
  const archivedTexts = await materials.listTextLibrary(detailOwner, true);
  assert.equal(archivedTexts[0].version, 2);
  await assert.rejects(() => textService.readText(detailOwner, detailText.id), /archived/);
  assert.ok(
    (await materials.listMaterials(detailOwner)).some((x) => x.id === detailWord.id && x.practice),
  );
  await assert.rejects(
    () =>
      materials.updateMaterial('different-owner', {
        id: detailText.id,
        version: 2,
        archived: false,
      }),
    /not found/,
  );
  await assert.rejects(
    () => materials.updateMaterial(detailOwner, { id: detailText.id, version: 1, archived: false }),
    /changed/,
  );
  await materials.updateMaterial(detailOwner, { id: detailText.id, version: 2, archived: false });
  const restoredDetail = await textService.readText(detailOwner, detailText.id);
  assert.equal(restoredDetail.original, 'Ik bel je op.');
  assert.equal(restoredDetail.segments[0].en, 'I will call you.');
  assert.equal((await materials.listTextLibrary(detailOwner, true)).length, 0);
  const detailBackup = await backupService.exportBackup(detailOwner);
  assert.equal(
    detailBackup.materials.find((x) => x.id === detailWord.id).body.dictionarySnapshot.senses
      .length,
    2,
  );
  assert.equal(requests.length, detailCalls);
  assert.equal(env.BUCKET.store.size, detailBucket);
  console.log(
    'PASS: bounded dictionary snapshots preserve selected form/meaning and learning; text deletion/archive and restore are owner/version safe, preserve saved words/text/translations/audio, and snapshots survive export without provider calls.',
  );
  const perfOwner = 'performance-fixture',
    perfOther = 'performance-other';
  sqlite.exec('BEGIN');
  for (let i = 0; i < 1000; i++)
    sqlite
      .prepare('INSERT INTO materials(id,owner,kind,title,body,created) VALUES(?,?,?,?,?,?)')
      .run(
        'perf-word-' + i,
        perfOwner,
        'phrase',
        'woord ' + i,
        JSON.stringify({ en: 'meaning ' + i, example: 'A short example.', _version: 1 }),
        '2026-10-25',
      );
  for (let i = 0; i < 20; i++)
    sqlite
      .prepare('INSERT INTO materials(id,owner,kind,title,body,created) VALUES(?,?,?,?,?,?)')
      .run(
        'perf-text-' + i,
        perfOwner,
        'text',
        'Les ' + i,
        JSON.stringify({
          source: 'Delftse Methode 2',
          segments: [{ nl: 'Een zin. '.repeat(1000), en: '' }],
          original: 'Een zin. '.repeat(1000),
          _version: 1,
        }),
        '2026-10-25',
      );
  sqlite
    .prepare('INSERT INTO materials(id,owner,kind,title,body,created) VALUES(?,?,?,?,?,?)')
    .run(
      'perf-archived',
      perfOwner,
      'text',
      'Archive',
      JSON.stringify({ _archived: true, segments: [] }),
      '2026-10-25',
    );
  sqlite.exec('COMMIT');
  const oldLibrary = await materials.listMaterials(perfOwner, '', false, true),
    lightLibrary = await materials.listTextLibrary(perfOwner),
    phraseOnly = await materials.listMaterials(perfOwner, '', false, true, 'phrase');
  assert.equal(lightLibrary.length, 20);
  assert.equal(phraseOnly.length, 1000);
  assert.ok(phraseOnly.every((i) => i.kind === 'phrase'));
  assert.ok(
    lightLibrary.every((i) => !('body' in i) && !('learning' in i) && i.sentenceCount === 1),
  );
  assert.equal((await materials.listTextLibrary(perfOther)).length, 0);
  const libraryRoute = load('app/api/text-library/route');
  assert.equal((await libraryRoute.GET(req('/api/text-library', null, null))).status, 401);
  const listing = await (await libraryRoute.GET(req('/api/text-library', null, perfOwner))).json();
  assert.equal(listing.length, 20);
  const oldBytes = Buffer.byteLength(JSON.stringify(oldLibrary)),
    newBytes = Buffer.byteLength(JSON.stringify(lightLibrary));
  assert.ok(newBytes < oldBytes / 100);
  console.log(
    `PASS: 1,000-word/20-text fixture; text list ${oldBytes} -> ${newBytes} JSON bytes (${(100 * (1 - newBytes / oldBytes)).toFixed(1)}% smaller), no text bodies or word progress, archived/owner filtering and auth; collection route can exclude texts before serialization.`,
  );
  // Daily scheduler v2 integration: real owner-scoped SQL, settings, batch persistence and backup.
  const dailyOwner = 'daily-v2-owner',
    dailyDate = wordsCore.learningDay(),
    dailyRequests = requests.length;
  const dailyPairs = [
    ['kat', 'cat'],
    ['hond', 'dog'],
    ['huis', 'house'],
    ['fiets', 'bicycle'],
    ['tafel', 'table'],
    ['stoel', 'chair'],
  ];
  for (let i = 0; i < 20; i++) {
    const [nl, en] = dailyPairs[i] || ['woord' + i, 'meaning' + i];
    await materials.addMaterial(dailyOwner, {
      kind: 'phrase',
      title: nl,
      body: { en },
      practice: true,
    });
  }
  sqlite
    .prepare('INSERT INTO user_settings(owner,preferences,updated) VALUES(?,?,?)')
    .run(
      dailyOwner,
      JSON.stringify({ ...settings.defaults, tone: 'Keep this tone.' }),
      new Date().toISOString(),
    );
  assert.equal(
    (
      await route.POST(
        req(
          '/api/settings',
          {
            action: 'saveWordsPreferences',
            words: { newWordsPerDay: 3, answerMode: 'auto', repeatMistakes: false },
          },
          dailyOwner,
        ),
      )
    ).status,
    200,
  );
  assert.equal((await settings.getSettings(dailyOwner)).preferences.tone, 'Keep this tone.');
  assert.equal((await settings.getSettings('daily-other')).preferences.words.newWordsPerDay, 10);
  assert.equal(
    (
      await route.POST(
        req(
          '/api/settings',
          { action: 'saveWordsPreferences', words: { newWordsPerDay: -1 } },
          dailyOwner,
        ),
      )
    ).status,
    400,
  );
  assert.equal((await settings.getSettings(dailyOwner)).preferences.words.newWordsPerDay, 3);
  let daily = await wordsService.startWords(dailyOwner);
  assert.equal(daily.session.algorithm, 2);
  assert.equal(daily.session.units.length, 3);
  let dj = { base: daily, events: [] };
  for (let i = 0; i < 3; i++) dj = journalCore.journalAppend(dj, 'continue', '', 0);
  assert.equal(journalCore.journalView(dj).session.closed, false);
  assert.equal(journalCore.journalView(dj).session.turn, 0);
  assert.equal(daily.session.introPractice, true);
  const introBatch = journalCore.journalBatch(dj);
  daily = await wordsService.commitWords(dailyOwner, introBatch);
  const introStatus = await wordsService.getWords(dailyOwner);
  assert.equal(introStatus.newCount, 0);
  assert.equal(introStatus.waitingNew, 17);
  assert.equal(introStatus.due, 3);
  assert.equal((await wordsService.startWords(dailyOwner)).session.id, daily.session.id);
  assert.ok(
    daily.session.units.every(
      (u) =>
        u.state.due === dailyDate &&
        u.state.lastSeenDay === undefined &&
        u.state.interval === -1 &&
        u.state.introducedDay === dailyDate,
    ),
  );
  assert.equal((await wordsService.commitWords(dailyOwner, introBatch)).duplicate, true);
  assert.equal((await wordsService.getWords(dailyOwner)).newCount, 0);
  const introBackup = await backupService.exportBackup(dailyOwner);
  const introPlan = await backupService.previewBackup('intro-import', introBackup);
  await backupService.importBackup('intro-import', introBackup, introPlan.token);
  const restoredIntro = await wordsService.getWords('intro-import');
  assert.equal(restoredIntro.session.introPractice, true);
  assert.equal(restoredIntro.session.turn, 0);
  assert.equal(restoredIntro.session.units.filter((u) => u.introDelay !== undefined).length, 3);
  let restoredIntroJournal = { base: restoredIntro, events: [] };
  while (!journalCore.journalView(restoredIntroJournal).session.closed) {
    const current = journalCore.journalView(restoredIntroJournal).session,
      question = current.question,
      unit = current.units.find((u) => u.id === question.unitId);
    restoredIntroJournal = journalCore.journalAppend(
      restoredIntroJournal,
      current.feedback ? 'next' : 'answer',
      question.kind === 'self' ? 'yes' : question.direction === 'nl-en' ? unit.en : unit.nl,
      0,
    );
  }
  const assessedIntro = await wordsService.commitWords(
    'intro-import',
    journalCore.journalBatch(restoredIntroJournal),
  );
  assert.equal(assessedIntro.session.turn, 3);
  assert.ok(
    assessedIntro.session.units.every(
      (u) =>
        u.attempts === 1 &&
        u.done &&
        u.state.stage === 'build' &&
        u.state.lastSeenDay === dailyDate &&
        u.state.introducedDay === dailyDate &&
        u.state.due === wordsCore.addDays(dailyDate, 3),
    ),
  );
  // Ending after introductions keeps these cards available today, even with no new allowance.
  dj = journalCore.journalAppend({ base: daily, events: [] }, 'finish', '', 0);
  daily = await wordsService.commitWords(dailyOwner, journalCore.journalBatch(dj));
  assert.equal(daily.newCount, 0);
  assert.equal(daily.due, 3);
  daily = await wordsService.startWords(dailyOwner);
  assert.equal(daily.session.units.length, 3);
  assert.notEqual(daily.session.question.kind, 'intro');
  dj = journalCore.journalAppend({ base: daily, events: [] }, 'finish', '', 0);
  await wordsService.commitWords(dailyOwner, journalCore.journalBatch(dj));
  const dailyRows = await materials.listMaterials(dailyOwner, '', false, true, 'phrase', true);
  assert.equal(dailyRows.filter((m) => m.learning.due === dailyDate).length, 3);
  assert.equal(dailyRows.filter((m) => m.learning.label === 'Recognize').length, 3);
  // Simulate the next date for these cards without altering the process clock or real user data.
  for (const row of sqlite
    .prepare('SELECT material_id,body FROM words_state WHERE owner=?')
    .all(dailyOwner)) {
    const state = JSON.parse(row.body);
    state.due = dailyDate;
    state.lastSeenDay = wordsCore.addDays(dailyDate, -1);
    state.introducedDay = state.lastSeenDay;
    sqlite
      .prepare('UPDATE words_state SET body=? WHERE material_id=?')
      .run(JSON.stringify(state), row.material_id);
  }
  await route.POST(
    req(
      '/api/settings',
      {
        action: 'saveWordsPreferences',
        words: { newWordsPerDay: 0, answerMode: 'auto', repeatMistakes: false },
      },
      dailyOwner,
    ),
  );
  daily = await wordsService.startWords(dailyOwner);
  assert.equal(daily.session.units.length, 3);
  assert.ok(daily.session.units.every((u) => u.state.stage === 'recognize'));
  assert.equal(daily.session.question.kind, 'choice');
  const dailyBackup = await backupService.exportBackup(dailyOwner);
  const dailyPlan = await backupService.previewBackup('daily-import', dailyBackup);
  await backupService.importBackup('daily-import', dailyBackup, dailyPlan.token);
  const dailyImported = await backupService.exportBackup('daily-import');
  assert.equal(dailyImported.wordsSession.body.algorithm, 2);
  assert.ok(
    dailyImported.wordsSession.body.choicePool.every((u) =>
      dailyImported.materials.some((m) => m.id === u.id),
    ),
  );
  dj = { base: daily, events: [] };
  while (!journalCore.journalView(dj).session.closed) {
    const v = journalCore.journalView(dj),
      q = v.session.question,
      u = v.session.units.find((u) => u.id === q.unitId);
    dj = journalCore.journalAppend(
      dj,
      v.session.feedback ? 'next' : 'answer',
      q.direction === 'nl-en' ? u.en : u.nl,
      0,
    );
  }
  daily = await wordsService.commitWords(dailyOwner, journalCore.journalBatch(dj));
  assert.ok(
    daily.session.units.every(
      (u) => u.state.stage === 'build' && u.state.due === wordsCore.addDays(dailyDate, 3),
    ),
  );
  assert.equal(daily.newCount, 0);
  assert.equal(daily.due, 0);
  assert.equal((await wordsService.getWords(dailyOwner)).newCount, 0);
  assert.equal(requests.length, dailyRequests);
  console.log(
    'PASS: v2 settings validation/isolation, daily cap across rounds, one encounter per day, review priority, stage dates, persistent batch progress and cross-owner backup with distractor remapping; no provider calls.',
  );
  // Configurable round sizes are owner scoped and never rewrite an active round.
  assert.equal(settings.defaults.words.sessionSize, 10);
  assert.equal(settings.defaults.sentences.sessionSize, 5);
  const sizesNetwork = requests.length;
  assert.equal(
    (
      await route.POST(
        req(
          '/api/settings',
          { action: 'saveSentencesPreferences', sentences: { sessionSize: 7 } },
          capUser,
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await sentencesService.startSentences(capUser, {
        action: 'start',
        source: 'all',
        mode: 'typing',
      })
    ).session.items.length,
    5,
    'retain the active five-sentence round',
  );
  await sentencesService.syncSentences(capUser, {
    action: 'batch',
    sessionId: capped.session.id,
    revision: capped.revision,
    events: [{ id: 'size-finish', action: 'finish', index: 0, answer: '' }],
  });
  let sizedSentences = await sentencesService.startSentences(capUser, {
    action: 'start',
    source: 'all',
    mode: 'typing',
  });
  assert.equal(sizedSentences.session.items.length, 7);
  assert.equal((await sentencesService.getSentences(capUser)).sessionSize, 7);
  await route.POST(
    req(
      '/api/settings',
      { action: 'saveWordsPreferences', words: { ...settings.defaults.words, sessionSize: 4 } },
      capUser,
    ),
  );
  assert.equal((await settings.getSettings(capUser)).preferences.sentences.sessionSize, 7);
  for (const size of [0, 31, 1.5]) {
    assert.equal(
      (
        await route.POST(
          req(
            '/api/settings',
            { action: 'saveSentencesPreferences', sentences: { sessionSize: size } },
            capUser,
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await route.POST(
          req(
            '/api/settings',
            { action: 'saveWordsPreferences', words: { sessionSize: size } },
            capUser,
          ),
        )
      ).status,
      400,
    );
  }
  assert.equal((await settings.getSettings(capUser)).preferences.words.sessionSize, 4);
  await sentencesService.syncSentences(capUser, {
    action: 'batch',
    sessionId: sizedSentences.session.id,
    revision: sizedSentences.revision,
    events: [{ id: 'size-finish-2', action: 'finish', index: 0, answer: '' }],
  });
  await route.POST(
    req(
      '/api/settings',
      { action: 'saveSentencesPreferences', sentences: { sessionSize: 30 } },
      capUser,
    ),
  );
  sizedSentences = await sentencesService.startSentences(capUser, {
    action: 'start',
    source: 'all',
    mode: 'typing',
  });
  assert.equal(
    sizedSentences.session.items.length,
    20,
    'use all available sentences when fewer than requested',
  );
  let largeJournal = { base: sizedSentences, events: [] };
  for (let i = 0; i < 20; i++)
    largeJournal = sentencesCore.appendSentence(largeJournal, {
      id: 'size-skip-' + i,
      action: 'skip',
      index: i,
      answer: '',
    });
  assert.equal(sentencesCore.restoreSentences(JSON.stringify(largeJournal)).events.length, 20);
  const largeSaved = await sentencesService.syncSentences(capUser, {
    action: 'batch',
    sessionId: sizedSentences.session.id,
    revision: sizedSentences.revision,
    events: largeJournal.events,
  });
  assert.equal(largeSaved.session.closed, true);
  assert.equal(largeSaved.session.index, 20);
  const wordSizes = 'word-sizes';
  for (let i = 0; i < 20; i++)
    await materials.addMaterial(wordSizes, {
      kind: 'phrase',
      title: 'testwoord' + i,
      body: { en: 'meaning ' + i },
      practice: true,
    });
  const sizeDefault = await wordsService.startWords(wordSizes);
  assert.equal(sizeDefault.session.cardLimit, 10);
  assert.equal(sizeDefault.session.units.length, 10);
  await route.POST(
    req(
      '/api/settings',
      { action: 'saveWordsPreferences', words: { ...settings.defaults.words, sessionSize: 4 } },
      wordSizes,
    ),
  );
  assert.equal((await wordsService.startWords(wordSizes)).session.cardLimit, 10);
  await wordsService.answerWords(wordSizes, {
    action: 'finish',
    sessionId: sizeDefault.session.id,
    revision: sizeDefault.revision,
    attemptId: 'finish-size',
    answer: '',
    elapsed: 0,
  });
  const sizeFour = await wordsService.startWords(wordSizes);
  assert.equal(sizeFour.session.cardLimit, 4);
  assert.equal(sizeFour.session.units.length, 4);
  let fourJournal = { base: sizeFour, events: [] };
  for (let guard = 0; !journalCore.journalView(fourJournal).session.closed && guard < 30; guard++) {
    const current = journalCore.journalView(fourJournal).session,
      question = current.question,
      unit = current.units.find((u) => u.id === question.unitId);
    fourJournal = journalCore.journalAppend(
      fourJournal,
      current.feedback ? 'next' : question.kind === 'intro' ? 'continue' : 'answer',
      question.kind === 'self' ? 'yes' : question.direction === 'nl-en' ? unit.en : unit.nl,
      0,
    );
  }
  assert.equal(journalCore.journalView(fourJournal).session.turn, 4);
  assert.equal(journalCore.journalView(fourJournal).session.closed, true);
  assert.equal(wordsCore.wordSessionSchema.safeParse(sizeDefault.session).success, true);
  assert.equal(
    (await settings.getSettings('unrelated-size-owner')).preferences.sentences.sessionSize,
    5,
  );
  assert.equal(requests.length, sizesNetwork);
  console.log(
    'PASS: Words 10 / Sentences 5 defaults, saved round sizes, active-round preservation, validation, independent preferences, source-shortfall and 20-sentence journal sync.',
  );
  {
    // Saved standalone phrases share the collection and feed Sentences, without entering Words.
    const phraseOwner = 'saved-phrases-owner',
      phraseNetwork = requests.length,
      modeHelper = load('lib/practice-mode');
    const standalone = await materials.addMaterial(phraseOwner, {
      kind: 'phrase',
      title: 'een deel van het spel',
      body: { en: 'part of the game', source: 'Teacher', example: 'Dat is een deel van het spel.' },
      practiceMode: 'sentences',
    });
    const legacyWord = await materials.addMaterial(phraseOwner, {
      kind: 'phrase',
      title: 'helpen',
      body: { en: 'to help' },
      practice: true,
    });
    const inactivePhrase = await materials.addMaterial(phraseOwner, {
      kind: 'phrase',
      title: 'ik heb me ziek gemeld',
      body: { en: 'I called in sick' },
      practiceMode: 'off',
    });
    await materials.addMaterial('phrase-other-owner', {
      kind: 'phrase',
      title: 'een spoor van vernieling',
      body: { en: 'a trail of destruction' },
      practiceMode: 'sentences',
    });
    const phraseText = await materials.addMaterial(phraseOwner, {
      kind: 'text',
      title: 'A real text',
      body: { segments: [{ nl: 'Dit is een zin.', en: 'This is a sentence.' }] },
    });
    const standaloneFull = await materials.getMaterial(phraseOwner, standalone.id);
    assert.equal(modeHelper.practiceMode(standaloneFull), 'sentences');
    assert.equal(standaloneFull.body.source, 'Teacher');
    assert.equal(
      modeHelper.practiceMode(await materials.getMaterial(phraseOwner, legacyWord.id)),
      'words',
    );
    assert.equal((await wordsService.getWords(phraseOwner)).total, 1);
    let standaloneSources = await sentencesService.getSentences(phraseOwner);
    assert.equal(standaloneSources.sources.find((s) => s.id === 'saved-phrases').ready, 1);
    let phraseRound = await sentencesService.startSentences(phraseOwner, {
      action: 'start',
      source: 'saved-phrases',
      mode: 'blocks',
    });
    assert.equal(phraseRound.session.items.length, 1);
    const standaloneItem = phraseRound.session.items[0];
    assert.equal(standaloneItem.origin, 'phrase');
    assert.equal(standaloneItem.nl, 'een deel van het spel');
    assert.equal(standaloneItem.en, 'part of the game');
    assert.equal(standaloneItem.materialId, standalone.id);
    assert.equal(standaloneItem.title, 'Teacher');
    assert.equal(standaloneItem.tokens.length, 5);
    let pj = { base: phraseRound, events: [] };
    pj = sentencesCore.appendSentence(pj, {
      id: 'phrase-check',
      action: 'check',
      index: 0,
      answer: standaloneItem.nl,
    });
    pj = sentencesCore.appendSentence(pj, {
      id: 'phrase-next',
      action: 'next',
      index: 0,
      answer: '',
    });
    const phraseSaved = await sentencesService.syncSentences(phraseOwner, {
      action: 'batch',
      sessionId: phraseRound.session.id,
      revision: phraseRound.revision,
      events: pj.events,
    });
    assert.equal(phraseSaved.session.closed, true);
    assert.equal(
      (
        await sentencesService.syncSentences(phraseOwner, {
          action: 'batch',
          sessionId: phraseRound.session.id,
          revision: phraseRound.revision,
          events: pj.events,
        })
      ).duplicate,
      true,
    );
    phraseRound = await sentencesService.startSentences(phraseOwner, {
      action: 'start',
      source: 'texts',
      mode: 'typing',
    });
    assert.ok(phraseRound.session.items.every((i) => i.textId === phraseText.id));
    await sentencesService.syncSentences(phraseOwner, {
      action: 'batch',
      sessionId: phraseRound.session.id,
      revision: phraseRound.revision,
      events: [{ id: 'phrase-finish-text', action: 'finish', index: 0, answer: '' }],
    });
    phraseRound = await sentencesService.startSentences(phraseOwner, {
      action: 'start',
      source: 'all',
      mode: 'typing',
    });
    assert.equal(phraseRound.session.items.length, 2);
    assert.ok(phraseRound.session.items.some((i) => i.origin === 'phrase'));
    await sentencesService.syncSentences(phraseOwner, {
      action: 'batch',
      sessionId: phraseRound.session.id,
      revision: phraseRound.revision,
      events: [{ id: 'phrase-finish-all', action: 'finish', index: 0, answer: '' }],
    });
    // A mode change retains Words state, translations, examples and the material identity.
    const wordKey = await common.hash(
      wordsCore.wordContent(await materials.getMaterial(phraseOwner, legacyWord.id)),
    );
    const wordState = {
      ...wordsCore.initialWordState(wordKey, wordsCore.learningDay()),
      stage: 'review',
      interval: 3,
    };
    sqlite
      .prepare('INSERT INTO words_state(material_id,owner,body,updated) VALUES(?,?,?,?)')
      .run(legacyWord.id, phraseOwner, JSON.stringify(wordState), new Date().toISOString());
    await materials.updateMaterial(phraseOwner, {
      id: legacyWord.id,
      version: 1,
      practiceMode: 'sentences',
    });
    assert.equal((await wordsService.getWords(phraseOwner)).total, 0);
    assert.equal(
      (await sentencesService.getSentences(phraseOwner)).sources.find(
        (s) => s.id === 'saved-phrases',
      ).ready,
      2,
    );
    assert.deepEqual(
      JSON.parse(
        sqlite.prepare('SELECT body FROM words_state WHERE material_id=?').get(legacyWord.id).body,
      ),
      wordState,
    );
    await materials.updateMaterial(phraseOwner, {
      id: legacyWord.id,
      version: 2,
      practiceMode: 'words',
    });
    assert.equal(
      (await materials.listMaterials(phraseOwner, '', false, true)).find(
        (m) => m.id === legacyWord.id,
      ).learning.level,
      5,
    );
    // Edited/disabled/archived phrase sources reject stale answers, retaining the client journal.
    phraseRound = await sentencesService.startSentences(phraseOwner, {
      action: 'start',
      source: 'saved-phrases',
      mode: 'typing',
    });
    assert.equal(phraseRound.session.items.length, 1);
    await materials.updateMaterial(phraseOwner, {
      id: standalone.id,
      version: 1,
      body: { en: 'a part of the game' },
    });
    await assert.rejects(
      () =>
        sentencesService.syncSentences(phraseOwner, {
          action: 'batch',
          sessionId: phraseRound.session.id,
          revision: phraseRound.revision,
          events: [{ id: 'phrase-stale', action: 'check', index: 0, answer: standaloneItem.nl }],
        }),
      /saved phrase changed/,
    );
    assert.equal((await sentencesService.getSentences(phraseOwner)).revision, phraseRound.revision);
    await sentencesService.syncSentences(phraseOwner, {
      action: 'batch',
      sessionId: phraseRound.session.id,
      revision: phraseRound.revision,
      events: [{ id: 'phrase-finish-stale', action: 'finish', index: 0, answer: '' }],
    });
    await materials.updateMaterial(phraseOwner, {
      id: standalone.id,
      version: 2,
      practiceMode: 'off',
    });
    assert.ok(
      !(await sentencesService.getSentences(phraseOwner)).sources.some(
        (s) => s.id === 'saved-phrases',
      ),
    );
    await materials.updateMaterial(phraseOwner, {
      id: standalone.id,
      version: 3,
      practiceMode: 'sentences',
      archived: true,
    });
    assert.ok(
      !(await sentencesService.getSentences(phraseOwner)).sources.some(
        (s) => s.id === 'saved-phrases',
      ),
    );
    await materials.updateMaterial(phraseOwner, { id: standalone.id, version: 4, archived: false });
    assert.equal(
      (await sentencesService.getSentences(phraseOwner)).sources.find(
        (s) => s.id === 'saved-phrases',
      ).ready,
      1,
    );
    await assert.rejects(
      () =>
        materials.addMaterial(phraseOwner, {
          kind: 'phrase',
          title: 'missing meaning',
          body: {},
          practiceMode: 'sentences',
        }),
      /English meaning/,
    );
    await assert.rejects(
      () =>
        materials.updateMaterial(phraseOwner, {
          id: standalone.id,
          version: 5,
          practiceMode: 'invalid',
        }),
      /Check the entry/,
    );
    assert.equal((await materials.getMaterial(phraseOwner, standalone.id)).version, 5);
    await assert.rejects(
      () =>
        materials.updateMaterial('phrase-other-owner', {
          id: standalone.id,
          version: 5,
          practiceMode: 'off',
        }),
      /not found/,
    );
    const phraseBackup = await backupService.exportBackup(phraseOwner),
      phrasePlan = await backupService.previewBackup('phrase-backup-owner', phraseBackup);
    await backupService.importBackup('phrase-backup-owner', phraseBackup, phrasePlan.token);
    assert.equal(
      (await sentencesService.getSentences('phrase-backup-owner')).sources.find(
        (s) => s.id === 'saved-phrases',
      ).ready,
      1,
    );
    assert.equal(requests.length, phraseNetwork);
    console.log(
      'PASS: standalone phrase sources, Words/Sentences/Off isolation, text-only/all-source selection, local answer batches, stale-source guards, mode/archive/restore, retained Words progress and backup. No provider calls.',
    );
  }
  console.log(
    'PASS: encrypted credentials, owner isolation, no key disclosure, failed verification preserves key, Dutch voice instructions, Realtime event flow/WAV, saved senses/deduplication, optimistic edits, archive, idempotent practice and rank bounds. External OpenAI calls are mocked.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
