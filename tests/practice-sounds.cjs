const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict');
const nodes = [],
  contexts = [];
class Context {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    contexts.push(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createOscillator() {
    const node = {
      frequency: {},
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
      start(time) {
        this.startAt = time;
      },
      stop(time) {
        this.stopAt = time;
      },
    };
    nodes.push(node);
    return node;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime(value) {
          assert.ok(value <= 0.055);
        },
        exponentialRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }
}
const output = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/practice-sounds.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports: output,
    AudioContext: Context,
    fetch() {
      throw Error('sound effects must be local');
    },
  },
);
const sounds = new output.PracticeSounds();
sounds.play('correct');
assert.equal(nodes.length, 0, 'no implicit autoplay context');
sounds.unlock();
sounds.play('tap');
sounds.play('correct');
sounds.play('wrong');
assert.equal(contexts.length, 1);
assert.equal(nodes.length, 4);
for (const node of nodes) {
  assert.ok(node.stopAt - node.startAt < 0.13, 'short, bounded tones');
  node.onended();
  assert.equal(node.disconnected, true);
}
Context.prototype.createOscillator = () => {
  throw Error('device unavailable');
};
assert.doesNotThrow(() => sounds.play('correct'), 'device failure cannot interrupt grading');
sounds.dispose();
assert.equal(contexts[0].state, 'closed');
sounds.play('correct');
assert.equal(nodes.length, 4);
console.log(
  'PASS: brief, low-volume device-only effects share one gesture-unlocked context and release audio nodes.',
);
