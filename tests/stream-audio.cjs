const fs = require('fs'),
  path = require('path'),
  vm = require('vm'),
  ts = require('typescript'),
  assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
let active,
  firstResolve,
  streamController,
  fetches = 0;
const first = new Promise((r) => (firstResolve = r));
const contexts = [];
const durable = new Map();
const storage = {
  async open() {
    return {
      async match(r) {
        return durable.get(r.url)?.clone();
      },
      async put(r, v) {
        durable.set(r.url, v.clone());
      },
      async keys() {
        return [...durable.keys()].map((u) => new Request(u));
      },
      async delete(r) {
        return durable.delete(r.url);
      },
    };
  },
};
class Context {
  currentTime = 0;
  state = 'running';
  constructor() {
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
  createBuffer(n, length, rate) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  decodeAudioData(bytes) {
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), 'RIFF');
    return Promise.resolve({ duration: 0.01 });
  }
  createBufferSource() {
    return {
      connect() {},
      disconnect() {},
      start() {
        active = this;
        setTimeout(() => this.onended?.(), 5);
      },
      stop() {
        this.onended?.();
      },
    };
  }
}
const modules = new Map();
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
      setTimeout,
      clearTimeout,
      require: (p) => load(path.resolve(path.dirname(file), p)),
      caches: storage,
      location: { origin: 'https://example.test' },
      Request,
      Response,
      AudioContext: Context,
      AbortController,
      DOMException,
      Uint8Array,
      Float32Array,
      DataView,
      TextDecoder,
      Blob,
      URL,
      atob,
      performance,
      fetch: async () => {
        fetches++;
        return new Response(
          new ReadableStream({
            start(c) {
              streamController = c;
              c.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    type: 'audio',
                    data: Buffer.from([0, 0, 0, 0]).toString('base64'),
                  }) + '\n',
                ),
              );
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      },
    },
  );
  return exports;
}
(async () => {
  const { AudioSequence } = load('lib/audio-sequence');
  const errors = [];
  const audio = {
    pause() {},
    play() {
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    },
  };
  const player = new AudioSequence(
    audio,
    (_, state) => {
      if (state === 'playing') firstResolve();
    },
    (e) => errors.push(e),
  );
  player.setCacheScope('alice-voice-a');
  let finished = false;
  const running = player.start(['De bank.'], -1).then(() => (finished = true));
  await first;
  assert.equal(finished, false, 'audio must start before response completes');
  assert.ok(active);
  player.pause();
  assert.equal(contexts[0].state, 'suspended');
  player.resume();
  await Promise.resolve();
  assert.equal(contexts[0].state, 'running');
  streamController.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
  streamController.close();
  await running;
  assert.equal(errors.length, 0);
  await player.start(['De bank.'], -1);
  assert.equal(fetches, 1, 'replay should use the completed audio');
  player.dispose();
  const reloaded = new AudioSequence(
    audio,
    () => {},
    (e) => errors.push(e),
  );
  reloaded.setCacheScope('alice-voice-a');
  await reloaded.start(['De bank.'], -1);
  assert.equal(fetches, 1, 'new player/page must reuse persistent audio without a network request');
  const storageAPI = load('lib/persistent-audio');
  assert.equal(await storageAPI.getAudio('bob-voice-a', 'De bank.'), null);
  assert.equal(await storageAPI.getAudio('alice-voice-b', 'De bank.'), null);
  reloaded.dispose();
  const loaded = [],
    indices = [];
  let firstPlayResolve,
    nextPrefetchedResolve,
    autoEnd = false;
  const nextPrefetched = new Promise((r) => (nextPrefetchedResolve = r));
  const firstPlay = new Promise((r) => (firstPlayResolve = r));
  const readingAudio = {
    pause() {},
    play() {
      firstPlayResolve();
      if (autoEnd) queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    },
  };
  const reading = new AudioSequence(
    readingAudio,
    (i, state) => {
      if (state === 'playing') indices.push(i);
    },
    (e) => errors.push(e),
  );
  reading.loadAudio = async (text) => {
    loaded.push(text);
    if (text === 'two') nextPrefetchedResolve();
    return new Blob(['audio'], { type: 'audio/wav' });
  };
  const readingRun = reading.start(['one', 'two', 'three', 'four']);
  await firstPlay;
  await nextPrefetched;
  assert.deepEqual(
    loaded,
    ['one', 'two'],
    'custom loaders prefetch the next sentence without a burst of requests',
  );
  autoEnd = true;
  readingAudio.onended();
  await readingRun;
  assert.deepEqual(indices, [0, 1, 2, 3]);
  reading.dispose();
  assert.equal(errors.length, 0, errors.join(';'));
  console.log('PASS: bounded custom-loader lookahead and correct sentence highlight indices.');
  console.log(
    'PASS: first chunk plays before completion, pause/resume, completed WAV replay, persistent reuse after a new player/page, owner/voice isolation and cleanup. Synthetic audio, no OpenAI requests.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
