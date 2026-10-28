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
async function mount({ openAI = false, dictionary, lookup, translationAvailable = true } = {}) {
  const slots = [],
    calls = [],
    cached = new Map(),
    preloads = [];
  let cursor = 0,
    effects = [],
    failure = false,
    selection = '';
  const parent = { nodeType: 1, closest: () => parent };
  const dictionaryEntry = (query) => ({
    found: true,
    lemma: query,
    partOfSpeech: 'verb',
    article: '',
    forms: [],
    related: [],
    senses: [{ meaning: 'to be', usage: '', example: '', exampleTranslation: '' }],
  });
  const fixture = {
    id: 'lesson',
    title: 'Synthetic lesson',
    source: '',
    scope: 'synthetic-owner-audio',
    keyConfigured: openAI,
    translationReady: translationAvailable,
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
      innerWidth: 850,
      innerHeight: 900,
      getSelection: () => ({
        toString: () => selection,
        rangeCount: selection ? 1 : 0,
        anchorNode: { parentElement: parent },
        focusNode: { parentElement: parent },
        getRangeAt: () => ({
          commonAncestorContainer: parent,
          getClientRects: () => [{ width: 100, height: 20, top: 100, bottom: 120, left: 50 }],
        }),
        removeAllRanges: () => {
          selection = '';
        },
      }),
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
      calls.push({ url, body, signal: options.signal });
      if (url === '/api/materials') return { ok: true, json: async () => ({ id: 'saved' }) };
      if (url === '/api/lookup') {
        const value = lookup
          ? await lookup(body, options.signal)
          : {
              ...dictionaryEntry(body.query),
              translationProvider: 'azure',
              senses: [
                { meaning: 'translated selection', usage: '', example: '', exampleTranslation: '' },
              ],
            };
        return { ok: true, json: async () => value };
      }
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
                  translationReady: translationAvailable,
                  audioReady: true,
                  preferences: { aiEnrichment: openAI ? 'auto' : 'off' },
                }
              : url.startsWith('/api/text-library')
                ? []
                : structuredClone(fixture),
        };
      if (name.includes('text-player')) return { TextPlayer: Player };
      if (name.includes('audio-sequence')) return { AudioSequence: Player };
      if (name.includes('local-dictionary'))
        return {
          localLookup: async (query) =>
            dictionary ? dictionary(query, dictionaryEntry) : dictionaryEntry(query),
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
    select: (value) => {
      selection = value;
    },
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
  assert.equal(
    find(tree, (n) => n.props?.className === 'sentence-provider'),
    undefined,
  );
  const stored = shown.cached.get('/api/texts?id=lesson');
  assert.equal(stored.segments[0].translationProvider, 'azure');
  assert.equal(stored.segments[0].translationFallback, false);
  find(tree, (n) => n.type === 'button' && n.props.className === 'word').props.onClick();
  await flush();
  tree = shown.render();
  assert.doesNotMatch(
    text(tree),
    /MEANING IN THIS SENTENCE|Connect OpenAI in Settings to translate the selected form/,
  );
  assert.match(text(tree), /to be/);
  assert.ok(find(tree, (n) => n.props?.['aria-label'] === 'Save meaning 1'));
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
  assert.equal(button(tree, 'Translate this form'), undefined);
  assert.equal(ai.calls.length, 0, 'dictionary hits never request contextual AI automatically');
  assert.ok(
    button(tree, 'Explain in this sentence'),
    'OpenAI-specific controls remain available when configured',
  );
  // Explicit explanations remain separate and cannot replace the instant dictionary meaning.
  await button(tree, 'Explain in this sentence').props.onClick();
  tree = ai.render();
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].body.mode, undefined);
  assert.match(text(tree), /to be/);
  assert.ok(find(tree, (n) => n.props?.['aria-label'] === 'AI explanation'));

  const form = await mount({
    openAI: true,
    dictionary: (query, make) => ({
      ...make(query),
      lemma: 'zijn',
      queryForm: {
        text: query,
        label: 'present singular',
        senses: [],
        ipa: '',
        partOfSpeech: 'verb',
      },
    }),
  });
  tree = form.render();
  find(
    tree,
    (n) => n.type === 'button' && n.props.className === 'word' && text(n) === 'ben',
  ).props.onClick();
  await flush();
  tree = form.render();
  assert.equal(form.calls.length, 0);
  assert.ok(button(tree, 'zijn ↗'));
  await find(tree, (n) => n.props?.['aria-label'] === 'Save meaning 1').props.onClick();
  assert.equal(form.calls.at(-1).body.title, 'ben');
  assert.equal(form.calls.at(-1).body.body.selectedForm, 'ben');
  assert.equal(form.calls.at(-1).body.body.lemma, 'zijn');
  assert.equal(form.calls.at(-1).body.body.en, 'to be');
  assert.equal(form.calls.at(-1).body.body.meaningSource, 'Dictionary meaning');

  const missing = (query, make) => ({ ...make(query), found: false, senses: [] });
  const phrase = await mount({ dictionary: missing });
  tree = phrase.render();
  phrase.select('Ik ben thuis.');
  find(tree, (n) => n.props?.['data-reading-text'] !== undefined).props.onMouseUp();
  tree = phrase.render();
  button(tree, 'Look up selection').props.onClick();
  await flush();
  tree = phrase.render();
  assert.equal(phrase.calls.length, 1);
  assert.equal(
    phrase.calls[0].body.mode,
    'translate',
    'whole selected sentence uses normal Azure-first translation',
  );
  assert.equal(phrase.calls[0].body.query, 'Ik ben thuis.');
  assert.equal(phrase.calls[0].body.context, 'Ik ben thuis.');
  assert.match(text(tree), /translated selection/);
  assert.doesNotMatch(text(tree), /MEANING IN THIS SENTENCE/);
  await find(tree, (n) => n.props?.['aria-label'] === 'Save meaning 1').props.onClick();
  assert.equal(phrase.calls.at(-1).body.title, 'Ik ben thuis.');
  assert.equal(phrase.calls.at(-1).body.body.meaningSource, 'Translator');

  let resolveOld;
  const stale = await mount({
    dictionary: (query, make) => (query === 'Ik' ? missing(query, make) : make(query)),
    lookup: () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  });
  tree = stale.render();
  find(tree, (n) => n.props?.className === 'word' && text(n) === 'Ik').props.onClick();
  await flush();
  tree = stale.render();
  const old = stale.calls[0];
  find(tree, (n) => n.props?.className === 'word' && text(n) === 'huis').props.onClick();
  await flush();
  tree = stale.render();
  assert.equal(old.signal.aborted, true);
  resolveOld({
    found: true,
    lemma: 'obsolete',
    senses: [{ meaning: 'obsolete meaning' }],
    forms: [],
    related: [],
  });
  await flush();
  tree = stale.render();
  assert.doesNotMatch(
    text(tree),
    /obsolete meaning/,
    'late translator response cannot replace a newer selection',
  );
  console.log(
    'PASS: Reader sentence preparation, dictionary-first selections, Azure-first misses, exact form saving, explicit separate AI explanations and stale-response protection. No browser/provider/audio verification.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
