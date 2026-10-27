// Playback regression tests: connected audio is never split at sentence boundaries.
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  ts = require('typescript');
const contexts = [];
class MockContext {
  constructor() {
    this.sources = [];
    this.destination = {};
    this.closed = false;
    contexts.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    this.suspended = true;
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 10 });
  }
  createBufferSource() {
    const s = {
      playbackRate: { value: 1 },
      connect() {},
      disconnect() {},
      start(...args) {
        this.args = args;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.sources.push(s);
    return s;
  }
}
const root = path.resolve(__dirname, '..'),
  stored = new Map(),
  modules = new Map();
let created = 0,
  revoked = 0;
function load(name) {
  const file = path.join(root, name + '.ts');
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require(p) {
        if (p === './persistent-audio')
          return {
            getAudio: async (s, k) => stored.get(s + '|' + k) || null,
            putAudio: async (s, k, b) => stored.set(s + '|' + k, b),
          };
        return load(path.relative(root, path.resolve(path.dirname(file), p)));
      },
      Blob,
      AudioContext: MockContext,
      AbortController,
      DOMException,
      URL: {
        createObjectURL() {
          return 'blob:test-' + ++created;
        },
        revokeObjectURL() {
          revoked++;
        },
      },
      console,
    },
  );
  return exports;
}
const { TextPlayer } = load('lib/text-player');
class Audio {
  _src = '';
  sources = [];
  seeks = [];
  plays = 0;
  pauses = 0;
  _time = 0;
  playbackRate = 1;
  set src(v) {
    this._src = v;
    this.sources.push(v);
    this._time = 0;
  }
  get src() {
    return this._src;
  }
  set currentTime(t) {
    this._time = t;
    this.seeks.push(t);
  }
  get currentTime() {
    return this._time;
  }
  play() {
    this.plays++;
    return Promise.resolve();
  }
  pause() {
    this.pauses++;
  }
  tick(t) {
    this._time = t;
    this.ontimeupdate?.();
  }
  end() {
    this.onended?.();
  }
}
const flush = () => new Promise((r) => setImmediate(r));
(async () => {
  const audio = new Audio(),
    events = [],
    errors = [],
    player = new TextPlayer(
      audio,
      (i, s) => events.push([i, s]),
      (e) => errors.push(e),
    );
  const segments = [
    { id: 'a', nl: 'De school is groot.' },
    { id: 'b', nl: 'De school is groot.' },
    { id: 'c', nl: 'Het is acht uur.' },
  ];
  let calls = 0;
  const fragment = {
    blob: new Blob([new Uint8Array(100)]),
    cues: segments.map((s, i) => ({ id: s.id, start: i, end: i + 1 })),
  };
  player.configure(segments, 'scope-1');
  player.loadFragment = async (id) => {
    calls++;
    assert.equal(id, 'a');
    return fragment;
  };
  await Promise.all([player.preload('a'), player.preload('b')]);
  assert.equal(calls, 1);
  const run = player.start();
  await flush();
  assert.equal(audio.plays, 1);
  assert.equal(audio.sources.length, 1);
  assert.equal(audio.currentTime, 0);
  const seeks = audio.seeks.length;
  audio.tick(1.1);
  audio.tick(2.2);
  assert.ok(events.some(([i, s]) => i === 1 && s === 'playing'));
  assert.ok(events.some(([i, s]) => i === 2 && s === 'playing'));
  assert.equal(audio.sources.length, 1);
  assert.equal(audio.plays, 1);
  assert.equal(audio.seeks.length, seeks);
  assert.equal(calls, 1); // no request, file switch or seek between sentences
  player.pause();
  assert.equal(events.at(-1)[1], 'paused');
  player.resume();
  await flush();
  assert.equal(audio.currentTime, 2.2);
  assert.equal(audio.sources.length, 1);
  player.setSpeed(0.8);
  assert.equal(audio.playbackRate, 0.8);
  audio.end();
  await run;
  const jump = player.start(1);
  await flush();
  assert.equal(audio.currentTime, 1);
  assert.equal(events.at(-1)[0], 1);
  player.stop();
  await jump;
  // One-sentence playback schedules exactly one cue from the original full recording.
  const fullPlays = audio.plays;
  await player.playOnce(1);
  const single = contexts.at(-1),
    source = single.sources[0];
  assert.deepEqual(source.args, [0, 1, 1]);
  assert.equal(audio.plays, fullPlays);
  assert.equal(calls, 1);
  player.pause();
  assert.equal(single.suspended, true);
  player.resume();
  await flush();
  player.setSpeed(1.2);
  assert.equal(source.playbackRate.value, 1.2);
  source.onended();
  assert.equal(events.at(-1)[1], 'idle');
  assert.equal(single.closed, true);
  assert.equal(audio.sources.length, 2); // no continuation into the next sentence
  await player.playOnce(0);
  const cancelledSource = contexts.at(-1).sources[0];
  player.stop();
  assert.equal(cancelledSource.stopped, true);
  // A new reader instance restores the connected recording and timestamps from device storage.
  player.dispose();
  const restored = new TextPlayer(
    new Audio(),
    () => {},
    (e) => errors.push(e),
  );
  restored.configure(segments, 'scope-1');
  restored.loadFragment = () => {
    throw Error('Cache missed');
  };
  await restored.preload('c');
  restored.dispose();
  // Prefetch the next fragment while the current one plays; do not load once per sentence.
  const many = [
      { id: 'long-a', nl: 'a'.repeat(1000) },
      { id: 'long-b', nl: 'b'.repeat(1000) },
      { id: 'tail', nl: 'Kort.' },
    ],
    secondAudio = new Audio(),
    second = new TextPlayer(
      secondAudio,
      () => {},
      (e) => errors.push(e),
    );
  second.configure(many, 'scope-2');
  let secondCalls = [];
  second.loadFragment = async (id) => {
    secondCalls.push(id);
    const group = id === 'long-a' ? many.slice(0, 1) : many.slice(1);
    return {
      blob: new Blob(['audio']),
      cues: group.map((s, i) => ({ id: s.id, start: i, end: i + 1 })),
    };
  };
  const continuous = second.start();
  await flush();
  assert.deepEqual(secondCalls, ['long-a', 'long-b']);
  assert.equal(secondAudio.sources.length, 1);
  secondAudio.end();
  await flush();
  assert.equal(secondAudio.sources.length, 2);
  secondAudio.tick(1.1);
  assert.equal(secondAudio.sources.length, 2);
  secondAudio.end();
  await continuous;
  second.dispose();
  // Cancelling an in-flight load must not start playback later or poison retry.
  const cancelAudio = new Audio(),
    cancel = new TextPlayer(
      cancelAudio,
      () => {},
      (e) => errors.push(e),
    );
  cancel.configure(segments, 'scope-3');
  let finish;
  cancel.loadFragment = () => new Promise((r) => (finish = r));
  const cancelled = cancel.start();
  await flush();
  cancel.stop();
  finish(fragment);
  await cancelled;
  assert.equal(cancelAudio.plays, 0);
  cancel.loadFragment = async () => fragment;
  const retry = cancel.start();
  await flush();
  assert.equal(cancelAudio.plays, 1);
  cancel.stop();
  await retry;
  cancel.dispose();
  // Provider/model scope changes must never reuse a recording from another scope.
  const scoped = new TextPlayer(
    new Audio(),
    () => {},
    (e) => errors.push(e),
  );
  scoped.configure(segments, 'scope-4');
  let scopedCalls = 0;
  scoped.loadFragment = async () => {
    scopedCalls++;
    return fragment;
  };
  await scoped.preload('a');
  scoped.configure(segments, 'scope-5');
  await scoped.preload('a');
  assert.equal(scopedCalls, 2);
  scoped.dispose();
  assert.equal(errors.length, 0, errors.join(';'));
  assert.ok(revoked > 0);
  const { textPreparation } = load('lib/text-preparation'),
    { sentenceRanges } = load('lib/text-audio');
  const prepSegments = [
    { id: 'x', nl: 'x'.repeat(1200), audioReady: true, en: 'X' },
    { id: 'y', nl: 'y'.repeat(800), audioReady: false, en: '' },
  ];
  let prep = textPreparation(prepSegments, { y: { audio: 'loading', translation: 'pending' } });
  assert.equal(prep.parts.length, 2);
  assert.equal(prep.percent, 60);
  assert.equal(prep.readyParts, 1);
  assert.equal(prep.parts[1].state, 'loading');
  assert.equal(prep.translated, 1);
  prep = textPreparation(prepSegments, {
    x: { audio: 'error', translation: 'ready', error: 'Failed' },
    y: { audio: 'ready', translation: 'error' },
  });
  assert.equal(prep.parts[0].state, 'error');
  assert.equal(prep.percent, 40);
  assert.equal(prep.translationErrors, true);
  const oneGroup = textPreparation(
    [
      { id: 'one', nl: 'Short.' },
      { id: 'two', nl: 'Another.' },
    ],
    {
      one: { audio: 'loading', translation: 'ready' },
      two: { audio: 'pending', translation: 'pending' },
    },
  );
  assert.equal(oneGroup.parts.length, 1);
  assert.equal(oneGroup.parts[0].first, 1);
  assert.equal(oneGroup.parts[0].last, 2);
  assert.equal(oneGroup.percent, 0);
  assert.equal(oneGroup.parts[0].state, 'loading');
  const ranges = sentenceRanges(
    ['A.', 'B.'],
    {
      characters: ['A', '.', ' ', 'B', '.'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.5, 0.6],
    },
    0.7,
  );
  assert.ok(Math.abs(ranges[0].end - 0.3) < 0.00001);
  assert.equal(ranges[1].start, ranges[0].end);
  console.log(
    'PASS: single-sentence scheduled boundary stop, no continuation/regeneration, pause/resume, speed and cancellation; weighted fragment preparation, separate translation state and pause-midpoint boundaries.',
  );
  console.log(
    'PASS: connected playback has no request, seek or file switch at sentence boundaries; duplicate sentences, pause/resume, seeking, speed, fragment prefetch, persistent cache, cancellation/retry and voice scope isolation.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
