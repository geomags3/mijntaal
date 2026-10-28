// Exercise actual reader controls with synthetic settings/materials and mocked providers.
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react');
const root = path.resolve(__dirname, '..');
const source = ts.transpileModule(
  fs.readFileSync(path.join(root, 'app/components/texts-reader.tsx'), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join('');
}
const flush = () => new Promise(setImmediate);
async function mount({ openAI = false } = {}) {
  const slots = [],
    calls = [],
    cached = new Map(),
    preloads = [];
  let cursor = 0,
    effects = [],
    failure = false;
  const fixture = {
    id: 'lesson',
    title: 'Synthetic lesson',
    source: '',
    scope: 'synthetic-owner-audio',
    keyConfigured: openAI,
    translationReady: true,
    audioConfigured: true,
    segments: [
      { id: 'one', nl: 'Ik ben thuis.', en: '', audioReady: false },
      { id: 'two', nl: 'Het huis is groot.', en: '', audioReady: false },
    ],
  };
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[i],
        (v) => {
          slots[i] = typeof v === 'function' ? v(slots[i]) : v;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn) {
      effects.push(fn);
    },
  };
  class Player {
    configure() {}
    setCacheScope() {}
    stop() {}
    dispose() {}
    setSpeed() {}
    async preload(id) {
      preloads.push(id);
    }
  }
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    AbortController,
    URLSearchParams,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    window: {
      location: { pathname: '/texts', search: '?id=lesson' },
      history: { replaceState() {} },
      addEventListener() {},
      removeEventListener() {},
      getSelection: () => ({ toString: () => '' }),
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      assert.equal(
        url,
        '/api/texts',
        'Azure-only reader must not call AI lookup/grammar endpoints',
      );
      assert.equal(body.action, 'translate');
      if (failure) return { ok: false, json: async () => ({ error: 'Synthetic transient error' }) };
      return {
        ok: true,
        json: async () => ({
          segments: body.segments.map((id) => ({
            id,
            en: id === 'one' ? 'I am at home.' : 'The house is big.',
            translationProvider: 'azure',
            translationFallback: false,
          })),
        }),
      };
    },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name);
      if (name.includes('client-data'))
        return {
          clientData: {
            peek: (url) => cached.get(url),
            put: (url, value) => cached.set(url, value),
            invalidate() {},
          },
          dataChanged() {},
          readJson: async (url) =>
            url === '/api/settings'
              ? {
                  keyConfigured: openAI,
                  translationReady: true,
                  audioReady: true,
                  preferences: { aiEnrichment: 'off' },
                }
              : url.startsWith('/api/text-library')
                ? []
                : structuredClone(fixture),
        };
      if (name.includes('text-player')) return { TextPlayer: Player };
      if (name.includes('audio-sequence')) return { AudioSequence: Player };
      if (name.includes('local-dictionary'))
        return {
          localLookup: async (query) => ({
            found: true,
            lemma: query,
            partOfSpeech: 'verb',
            article: '',
            forms: [],
            related: [],
            senses: [{ meaning: 'to be', usage: '', example: '', exampleTranslation: '' }],
          }),
        };
      if (name.includes('text-audio')) return { audioGroups: (segments) => [segments] };
      if (name.includes('text-preparation'))
        return {
          textPreparation: (segments) => ({
            parts: [
              { id: segments[0].id, first: 1, last: segments.length, weight: 1, state: 'pending' },
            ],
            readyParts: 0,
            percent: 0,
            translated: segments.filter((s) => s.en).length,
            translationErrors: false,
          }),
        };
      if (name.includes('text-segments')) return { segmentText: (value) => [value] };
      if (name.includes('noun-article')) return { nounArticle: () => '' };
      if (name.includes('dictionary-snapshot')) return { dictionarySnapshot: () => undefined };
      if (name === '../data')
        return {
          demoText: { title: 'Sample', source: '', segments: [{ nl: 'Sample.', en: 'Example.' }] },
        };
      if (name.startsWith('./')) return { default: function Child() {} };
      throw Error('Unexpected dependency ' + name);
    },
  });
  const render = () => {
    cursor = 0;
    effects = [];
    return exports.default({ visible: true });
  };
  let tree = render();
  const audio = find(tree, (n) => n.type === 'audio');
  audio.props.ref.current = {};
  const initialize = effects.find((fn) => fn.toString().includes('new text_player'));
  assert.ok(initialize, 'actual reader setup effect');
  initialize();
  await flush();
  await flush();
  tree = render();
  return {
    render,
    calls,
    cached,
    preloads,
    setFailure: (value) => {
      failure = value;
    },
  };
}
const button = (tree, label) => find(tree, (n) => n.type === 'button' && text(n).trim() === label);
(async () => {
  const shown = await mount();
  let tree = shown.render();
  assert.ok(button(tree, 'Show translation'));
  button(tree, 'Show translation').props.onClick();
  await flush();
  tree = shown.render();
  assert.equal(shown.calls.length, 1);
  assert.deepEqual(Array.from(shown.calls[0].body.segments), ['one', 'two']);
  assert.match(text(tree), /I am at home\./);
  assert.match(text(tree), /Azure Translator/);
  const stored = shown.cached.get('/api/texts?id=lesson');
  assert.equal(stored.segments[0].translationProvider, 'azure');
  assert.equal(stored.segments[0].translationFallback, false);
  find(tree, (n) => n.type === 'button' && n.props.className === 'word').props.onClick();
  await flush();
  tree = shown.render();
  assert.match(text(tree), /Connect OpenAI in Settings to translate the selected form/);
  assert.equal(button(tree, 'Translate this form'), undefined);
  assert.equal(button(tree, 'Explain in this sentence'), undefined);
  assert.equal(
    shown.calls.length,
    1,
    'selecting a word must not launch AI with Azure-only settings',
  );
  const individual = await mount();
  individual.setFailure(true);
  tree = individual.render();
  button(tree, 'Show translation').props.onClick();
  await flush();
  tree = individual.render();
  assert.ok(button(tree, 'Translate'), 'failed initial translation exposes individual retry');
  individual.setFailure(false);
  await button(tree, 'Translate').props.onClick();
  tree = individual.render();
  assert.deepEqual(Array.from(individual.calls.at(-1).body.segments), ['one']);
  assert.match(text(tree), /I am at home\./);
  const prepared = await mount();
  tree = prepared.render();
  await button(tree, 'Prepare text').props.onClick();
  tree = prepared.render();
  assert.equal(prepared.calls.length, 1, 'Azure-only prepare includes missing translations');
  assert.deepEqual(Array.from(prepared.calls[0].body.segments), ['one', 'two']);
  assert.deepEqual(prepared.preloads, ['one']);
  const ai = await mount({ openAI: true });
  tree = ai.render();
  find(tree, (n) => n.type === 'button' && n.props.className === 'word').props.onClick();
  await flush();
  tree = ai.render();
  assert.ok(button(tree, 'Translate this form'));
  assert.ok(
    button(tree, 'Explain in this sentence'),
    'OpenAI-specific controls remain available when configured',
  );
  console.log(
    'PASS: Azure-only reader show/individual/prepare translation, provider provenance merge, and separate OpenAI grammar/explanation gates. No browser/provider/audio verification.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
