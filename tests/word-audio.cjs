const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  React = require('react');
const root = path.resolve(__dirname, '..'),
  cache = new Map(),
  modules = new Map(),
  contexts = [];
let requests = 0,
  decodeCalls = 0;
class Context {
  constructor(options) {
    assert.equal(options, undefined, 'use device-supported output rate');
    this.state = 'running';
    contexts.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(buffer) {
    decodeCalls++;
    assert.equal(Buffer.from(buffer).subarray(0, 4).toString(), 'RIFF');
    return Promise.resolve({ duration: 0.05 });
  }
  createBufferSource() {
    return {
      connect() {},
      disconnect() {},
      start() {
        queueMicrotask(() => this.onended?.());
      },
      stop() {
        this.onended?.();
      },
    };
  }
}
function load(relative) {
  const file = path.join(root, relative + '.ts');
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      setTimeout,
      clearTimeout,
      require(name) {
        if (name === './persistent-audio')
          return {
            getAudio: async (s, t) => cache.get(s + '|' + t) || null,
            putAudio: async (s, t, b) => cache.set(s + '|' + t, b),
          };
        return load(path.relative(root, path.resolve(path.dirname(file), name)));
      },
      AudioContext: Context,
      Blob,
      Response,
      AbortController,
      DOMException,
      performance,
      Uint8Array,
      DataView,
      URL: { createObjectURL: () => 'blob:must-not-fetch', revokeObjectURL() {} },
      fetch: async (url, options) => {
        assert.equal(url, '/api/speech', 'decoding must not fetch blob URLs');
        requests++;
        assert.equal(JSON.parse(options.body).text, 'Tot voor kort');
        return new Response(load('lib/pcm').pcmWav(new Uint8Array(2400)), {
          headers: { 'Content-Type': 'audio/wav' },
        });
      },
      queueMicrotask,
      atob,
      TextDecoder,
    },
  );
  return exports;
}
const watchdog = setTimeout(() => {
  console.error('FAIL: word audio stalled');
  process.exit(1);
}, 5000);
(async () => {
  const { AudioSequence } = load('lib/audio-sequence'),
    events = [],
    errors = [],
    audio = {
      pause() {},
      play() {
        throw Error('buffered speech should use the unlocked context');
      },
    };
  const player = new AudioSequence(
    audio,
    (_, s) => events.push(s),
    (e) => errors.push(e),
  );
  player.setCacheScope('owner-voice');
  await player.start(['Tot voor kort'], -1);
  assert.ok(events.includes('loading'));
  assert.ok(events.includes('playing'));
  assert.equal(events.at(-1), 'idle');
  assert.equal(requests, 1);
  assert.equal(decodeCalls, 1);
  await player.start(['Tot voor kort'], -1);
  assert.equal(requests, 1);
  assert.equal(contexts.length, 1, 'reuse the unlocked context between words');
  player.dispose();
  assert.equal(contexts[0].state, 'closed', 'dispose releases context');
  const restored = new AudioSequence(
    audio,
    () => {},
    (e) => errors.push(e),
  );
  restored.setCacheScope('owner-voice');
  await restored.start(['Tot voor kort'], -1);
  assert.equal(requests, 1);
  restored.dispose();
  assert.equal(errors.length, 0);
  // Browser permission failure must be reported, not silently marked as playing.
  const blockedEvents = [],
    blockedErrors = [],
    blocked = new AudioSequence(
      audio,
      (_, s) => blockedEvents.push(s),
      (e) => blockedErrors.push(e),
    );
  blocked.setCacheScope('owner-voice');
  const oldResume = Context.prototype.resume;
  Context.prototype.resume = function () {
    this.state = 'suspended';
    return Promise.reject(Error('NotAllowedError'));
  };
  await blocked.start(['Tot voor kort'], -1);
  assert.equal(blockedEvents.includes('playing'), false);
  assert.match(blockedErrors[0], /browser blocked audio/);
  Context.prototype.resume = oldResume;
  await blocked.start(['Tot voor kort'], -1);
  assert.equal(blockedEvents.at(-1), 'idle');
  assert.ok(blockedEvents.includes('playing'));
  assert.equal(requests, 1, 'retry reuses the generated recording');
  blocked.dispose();
  // Rapid switching while the first source decodes must not start stale audio.
  const decode = Context.prototype.decodeAudioData;
  let resolveDecode, decoding;
  const began = new Promise((r) => (decoding = r));
  Context.prototype.decodeAudioData = function (bytes) {
    Context.prototype.decodeAudioData = decode;
    decoding();
    return new Promise((r) => (resolveDecode = r));
  };
  const raceEvents = [],
    race = new AudioSequence(
      audio,
      (_, s) => raceEvents.push(s),
      (e) => errors.push(e),
    );
  race.setCacheScope('owner-voice');
  const firstRun = race.start(['Tot voor kort'], -1);
  await began;
  await race.start(['Tot voor kort'], -1);
  const before = raceEvents.length;
  resolveDecode({ duration: 0.05 });
  await firstRun;
  assert.equal(raceEvents.length, before, 'cancelled decoder must not update the new playback');
  race.dispose();
  // Click the actual introductory-card button: no progress mutation or shared parent player is required.
  const fixture = {
    session: {
      id: 'session',
      turn: 0,
      cardLimit: 15,
      units: [
        {
          id: 'u',
          nl: 'Tot voor kort',
          en: 'Until recently',
          state: { stage: 'intro', interval: 0 },
        },
      ],
      question: { id: 'q', unitId: 'u', kind: 'intro', direction: 'nl-en' },
      feedback: null,
      closed: false,
    },
    revision: 1,
  };
  let cursor = 0,
    spoken = [],
    slots = [];
  const hookReact = {
    useState(initial) {
      const n = cursor++;
      let value = typeof initial === 'function' ? initial() : initial;
      if (n === 0) value = false;
      if (n === 1) value = fixture;
      if (n === 2) value = true;
      if (n === 4) value = false;
      if (!(n in slots)) slots[n] = value;
      return [slots[n], (next) => (slots[n] = next)];
    },
    useRef(initial) {
      const n = cursor++;
      if (!(n in slots)) slots[n] = { current: initial };
      return slots[n];
    },
    useEffect() {},
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(root, 'app/components/words-practice.tsx'), 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      setTimeout,
      clearTimeout,
      require(name) {
        if (name === 'react') return hookReact;
        if (name.includes('use-word-audio'))
          return { default: () => ({ state: 'idle', play: (text) => spoken.push(text) }) };
        if (name.includes('client-data')) return { clientData: { peek() {} } };
        if (name.endsWith('/word-progress')) return { learningProgress: () => ({ level: 0 }) };
        if (name.startsWith('.')) return { default: () => null };
        return require(name);
      },
    },
  );
  const node = exports.default({
    onCollection() {},
    onChanged() {},
    onSpeak() {
      throw Error('must not delegate to the shared root player');
    },
    audioReady: true,
    audioScope: 'owner-voice',
  });
  function find(n) {
    if (!n || typeof n !== 'object') return;
    if (n.props?.['aria-label'] === 'Listen to Dutch') return n;
    for (const c of React.Children.toArray(n.props?.children)) {
      const hit = find(c);
      if (hit) return hit;
    }
  }
  const button = find(node);
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(spoken, ['Tot voor kort']);
  console.log(
    'PASS: new Words card invokes isolated pronunciation immediately; WAV load/decode/play, loading state, replay, persistent voice-scoped reuse and no blob-URL fetch.',
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
