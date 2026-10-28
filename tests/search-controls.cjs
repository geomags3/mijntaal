const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  React = require('react'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let slots = [],
  cursor = 0,
  effects = [],
  focus = 0,
  removed = [],
  resolveLookup;
const players = [];
const requests = [];
const candidates = ['bank', 'oever'].map((lemma) => ({
  found: true,
  lemma,
  partOfSpeech: 'noun',
  article: 'de',
  ipa: '',
  forms: [],
  related: [],
  queryExplanation: '',
  notes: '',
  senses: [
    {
      meaning: 'bank',
      usage: lemma === 'oever' ? 'edge of a river' : 'financial institution',
      example: '',
      exampleTranslation: '',
    },
  ],
  source: 'WikDict',
}));
const hooks = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
    return [slots[i], (v) => (slots[i] = typeof v === 'function' ? v(slots[i]) : v)];
  },
  useRef(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: initial };
    return slots[i];
  },
  useEffect(fn) {
    effects.push(fn);
  },
  useMemo: (fn) => fn(),
};
class AudioSequence {
  constructor(audio, changed) {
    this.changed = changed;
    this.calls = [];
    players.push(this);
  }
  start(text) {
    this.calls.push(text[0]);
    this.changed(-1, 'loading');
    return Promise.resolve();
  }
  stop() {
    this.changed(-1, 'idle');
  }
  pause() {
    this.changed(-1, 'paused');
  }
  resume() {
    this.changed(-1, 'playing');
  }
  dispose() {}
  setCacheScope() {}
}
const stubs = new Map(),
  stub = (name) => {
    if (!stubs.has(name)) stubs.set(name, function Component() {});
    return { default: stubs.get(name) };
  },
  exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: exportsObject,
    window: { location: { pathname: '/', search: '' } },
    sessionStorage: { removeItem: (key) => removed.push(key) },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    AbortController,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url === '/api/materials') return { ok: true, json: async () => ({ id: 'saved' }) };
      const reverse = body.sourceLanguage === 'ru';
      return {
        ok: true,
        json: async () => ({
          found: true,
          lemma: reverse ? 'Ik ben moe.' : body.query,
          partOfSpeech: '',
          article: '',
          ipa: '',
          forms: [],
          related: [],
          notes: '',
          queryExplanation: '',
          senses: [
            {
              meaning: reverse ? '' : 'I am tired.',
              usage: '',
              example: '',
              exampleTranslation: '',
            },
          ],
          translationProvider: 'azure',
          englishReferencePending: reverse,
          originalInput: body.query,
          sourceLanguage: body.sourceLanguage,
        }),
      };
    },
    require(name) {
      if (name === 'react') return hooks;
      if (name.includes('client-data'))
        return {
          clientData: { peek() {} },
          dataChanged() {},
          readJson: async (url) =>
            url.startsWith('/api/materials')
              ? []
              : {
                  azureConfigured: true,
                  keyConfigured: false,
                  azureRegion: 'westeurope',
                  audioReady: false,
                  preferences: { aiEnrichment: 'auto' },
                },
        };
      if (name.includes('audio-sequence')) return { AudioSequence };
      if (name.includes('local-dictionary'))
        return {
          localLookup: () => new Promise((r) => (resolveLookup = r)),
          localCandidates: async () => candidates,
        };
      if (name.startsWith('./components/')) return stub(name);
      if (name.includes('search-form'))
        return {
          searchMeaningMaterial: (entry, sense) => ({
            kind: 'phrase',
            title: entry.lemma,
            body: { en: sense.meaning },
          }),
        };
      if (name.startsWith('../lib/')) return {};
      return require(name);
    },
  },
);
function find(node, match) {
  if (!node || typeof node !== 'object') return;
  if (match(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const hit = find(child, match);
    if (hit) return hit;
  }
}
const render = () => {
    cursor = 0;
    effects = [];
    return exportsObject.default();
  },
  label = (n, l) => n.props?.['aria-label'] === l;
(async () => {
  let app = render();
  find(app, (n) => n.type === 'audio').props.ref.current = {};
  const init = effects.find((f) => f.toString().includes('new audio_sequence'));
  assert.ok(init);
  init();
  slots[0] = true; // authenticated settings allow speech
  app = render();
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.onChange({
    target: { value: 'zijn' },
  });
  app = render();
  find(app, (n) => label(n, 'Dutch sentence for context')).props.onChange({
    target: { value: 'Ik ben thuis.' },
  });
  app = render();
  const search = find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search');
  search.props.onSubmit({ preventDefault() {} });
  app = render();
  const clear = find(app, (n) => label(n, 'Clear search'));
  assert.equal(clear.props.type, 'button');
  assert.equal(clear.props.disabled, false);
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.ref.current = {
    focus() {
      focus++;
    },
  };
  clear.props.onClick();
  app = render();
  assert.equal(find(app, (n) => label(n, 'Search Dutch words or phrases')).props.value, '');
  assert.equal(find(app, (n) => label(n, 'Dutch sentence for context')).props.value, '');
  assert.equal(focus, 1);
  assert.ok(removed.includes('dutch-search-view'));
  assert.equal(find(app, (n) => label(n, 'Clear search')).props.disabled, true);
  resolveLookup({
    found: true,
    lemma: 'zijn',
    partOfSpeech: 'verb',
    forms: [{ label: 'present · first-person · singular', value: 'ben' }],
    senses: [],
    related: [],
  });
  await new Promise(setImmediate);
  app = render();
  assert.equal(
    find(app, (n) => n.props?.className === 'dictionary-entry'),
    undefined,
    'clearing invalidates pending lookups',
  );
  // Search again to inspect real form controls and call the root player through WordForms.
  find(app, (n) => label(n, 'Search Dutch words or phrases')).props.onChange({
    target: { value: 'zijn' },
  });
  app = render();
  find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search').props.onSubmit({
    preventDefault() {},
  });
  resolveLookup({
    found: true,
    lemma: 'zijn',
    partOfSpeech: 'verb',
    forms: [{ label: 'present · first-person · singular', value: 'ben' }],
    senses: [],
    related: [],
  });
  await new Promise(setImmediate);
  app = render();
  const formsType = stubs.get('./components/word-forms');
  let forms = find(app, (n) => n.type === formsType);
  assert.ok(forms);
  assert.ok(
    find(app, (n) => n.type === 'details' && n.props.open && find(n, (c) => c.type === formsType)),
    'forms start open',
  );
  forms.props.onSpeak('ben');
  app = render();
  forms = find(app, (n) => n.type === formsType);
  assert.equal(forms.props.currentAudio, 'ben');
  assert.equal(forms.props.audioState, 'loading');
  assert.deepEqual(players[0].calls, ['ben']);
  forms.props.onSpeak('ben');
  app = render();
  assert.equal(
    find(app, (n) => n.type === formsType).props.audioState,
    'idle',
    'second click cancels loading without starting another request',
  );
  assert.equal(players[0].calls.length, 1);
  // English lookup exposes distinct Dutch candidates and preserves selected Dutch on save.
  effects.find(
    (f) => f.toString().includes('setVisibleCount(50)') && f.toString().includes('load(false)'),
  )();
  await new Promise(setImmediate);
  app = render();
  find(app, (n) => label(n, 'Search language')).props.onChange({ target: { value: 'en' } });
  app = render();
  find(app, (n) => label(n, 'Translate English into Dutch')).props.onChange({
    target: { value: 'bank' },
  });
  app = render();
  find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search').props.onSubmit({
    preventDefault() {},
  });
  await new Promise(setImmediate);
  app = render();
  const alternatives = find(app, (n) => label(n, 'Dutch dictionary alternatives'));
  assert.ok(
    alternatives,
    'English lookup shows alternatives rather than treating English as Dutch',
  );
  find(
    alternatives,
    (n) => n.type === 'button' && n.props.children[0].props.children.includes('oever'),
  ).props.onClick();
  app = render();
  await find(app, (n) => label(n, 'Save meaning 1')).props.onClick();
  assert.equal(requests.find((r) => r.url === '/api/materials').body.title, 'oever');
  assert.equal(
    requests.filter((r) => r.url === '/api/lookup').length,
    0,
    'dictionary match needs no provider request',
  );
  // Azure alone enables reverse translation. Russian source is retained and English is deferred until Save.
  app = render();
  find(app, (n) => label(n, 'Search language')).props.onChange({ target: { value: 'ru' } });
  app = render();
  find(app, (n) => label(n, 'Translate Russian into Dutch')).props.onChange({
    target: { value: '\u042f \u0443\u0441\u0442\u0430\u043b.' },
  });
  app = render();
  find(app, (n) => n.type === 'form' && n.props.className === 'dictionary-search').props.onSubmit({
    preventDefault() {},
  });
  await new Promise(setImmediate);
  app = render();
  assert.equal(requests.filter((r) => r.url === '/api/lookup').length, 1);
  assert.equal(requests.at(-1).body.sourceLanguage, 'ru');
  assert.equal(requests.at(-1).body.targetLanguage, 'nl');
  assert.ok(find(app, (n) => n.props?.className === 'translation-provider'));
  await find(app, (n) => label(n, 'Save meaning 1')).props.onClick();
  const savedRussian = requests.filter((r) => r.url === '/api/materials').at(-1).body;
  assert.equal(savedRussian.title, 'Ik ben moe.');
  assert.equal(savedRussian.body.en, 'I am tired.');
  assert.equal(savedRussian.body.originalInput, '\u042f \u0443\u0441\u0442\u0430\u043b.');
  assert.equal(savedRussian.body.sourceLanguage, 'ru');
  assert.equal(
    requests.filter((r) => r.url === '/api/lookup').length,
    2,
    'English reference generated only on save',
  );
  console.log(
    'PASS: actual Search clear control resets query/context/results, focuses input, rejects stale lookups; Forms open by default, root pronunciation state propagated and repeated loading click cancels.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
