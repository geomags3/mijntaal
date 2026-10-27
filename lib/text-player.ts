import { getAudio, putAudio } from './persistent-audio';
import { audioGroups } from './text-audio';
type Segment = { id: string; nl: string };
export type AudioCue = { id: string; start: number; end: number };
export type AudioFragment = { blob: Blob; cues: AudioCue[] };
type State = 'idle' | 'loading' | 'playing' | 'paused';
type Loaded = AudioFragment & { url: string };
/** Play the original connected recording. Sentence boundaries only drive highlighting/seeking. */
export class TextPlayer {
  private scope = '';
  private groups: Segment[][] = [];
  private segments: Segment[] = [];
  private loaded = new Map<string, Loaded>();
  private pending = new Map<string, { signal?: AbortSignal; job: Promise<Loaded> }>();
  private generation = 0;
  private controller: AbortController | null = null;
  private release: (() => void) | null = null;
  private running = false;
  private paused = false;
  private index = -1;
  private active: Loaded | null = null;
  private raf = 0;
  private speed = 1;
  private singleContext: AudioContext | null = null;
  private singleSource: AudioBufferSourceNode | null = null;
  loadFragment?: (segmentId: string, signal?: AbortSignal) => Promise<AudioFragment>;
  constructor(
    private audio: HTMLAudioElement,
    private changed: (index: number, state: State) => void,
    private failed: (message: string) => void,
  ) {}
  configure(segments: Segment[], scope: string) {
    this.stop();
    if (scope !== this.scope) {
      this.loaded.forEach((x) => URL.revokeObjectURL(x.url));
      this.loaded.clear();
    }
    this.scope = scope;
    this.segments = segments;
    this.groups = audioGroups(segments);
  }
  private key(group: Segment[]) {
    return 'connected-recording-v2:' + group.map((s) => s.id).join(',');
  }
  private groupFor(id: string) {
    const group = this.groups.find((g) => g.some((s) => s.id === id));
    if (!group) throw Error('Sentence not found. Reopen the text.');
    return group;
  }
  async preload(segmentId: string, signal?: AbortSignal): Promise<Loaded> {
    const group = this.groupFor(segmentId),
      key = this.key(group),
      scope = this.scope,
      hit = this.loaded.get(key);
    if (hit) return hit;
    const pendingKey = scope + '|' + key,
      existing = this.pending.get(pendingKey);
    if (existing && !existing.signal?.aborted) return existing.job;
    const job = (async () => {
      const [blob, timing] = await Promise.all([
        getAudio(scope, key),
        getAudio(scope, key + ':timing'),
      ]);
      let value: AudioFragment;
      if (blob && timing) {
        try {
          value = { blob, cues: JSON.parse(await timing.text()) };
          this.validate(group, value);
        } catch {
          value = await this.fetch(group, signal);
        }
      } else value = await this.fetch(group, signal);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      await putAudio(scope, key, value.blob);
      await putAudio(
        scope,
        key + ':timing',
        new Blob([JSON.stringify(value.cues)], { type: 'application/json' }),
      );
      if (signal?.aborted || scope !== this.scope)
        throw new DOMException('Cancelled', 'AbortError');
      const loaded = { ...value, url: URL.createObjectURL(value.blob) };
      const other = this.loaded.get(key);
      if (other) {
        URL.revokeObjectURL(loaded.url);
        return other;
      }
      this.loaded.set(key, loaded);
      return loaded;
    })();
    this.pending.set(pendingKey, { signal, job });
    try {
      return await job;
    } finally {
      if (this.pending.get(pendingKey)?.job === job) this.pending.delete(pendingKey);
    }
  }
  private async fetch(group: Segment[], signal?: AbortSignal) {
    if (!this.loadFragment) throw Error('Reopen this text to load its recording.');
    const value = await this.loadFragment(group[0].id, signal);
    this.validate(group, value);
    return value;
  }
  private validate(group: Segment[], value: AudioFragment) {
    if (!value.blob?.size || !Array.isArray(value.cues) || value.cues.length !== group.length)
      throw Error('Invalid text recording. Retry preparation.');
    let end = 0;
    for (let i = 0; i < group.length; i++) {
      const c = value.cues[i];
      if (
        c.id !== group[i].id ||
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < end - 0.001 ||
        c.end <= c.start
      )
        throw Error('Invalid sentence timestamps. Retry preparation.');
      end = c.end;
    }
  }
  private highlight() {
    if (!this.active) return;
    const time = this.audio.currentTime;
    let cue = this.active.cues[0];
    for (const c of this.active.cues) {
      if (c.start > time) break;
      cue = c;
    }
    const index = this.segments.findIndex((s) => s.id === cue.id);
    if (index !== this.index) {
      this.index = index;
      this.changed(index, this.paused ? 'paused' : 'playing');
    }
  }
  private watch() {
    if (!this.running || this.paused) return;
    this.highlight();
    if (typeof requestAnimationFrame !== 'undefined')
      this.raf = requestAnimationFrame(() => this.watch());
  }
  private cancelWatch() {
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  stop() {
    this.singleSource?.stop();
    this.singleSource = null;
    void this.singleContext?.close().catch(() => {});
    this.singleContext = null;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.running = false;
    this.paused = false;
    this.cancelWatch();
    this.audio.pause();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.ontimeupdate = null;
    this.release?.();
    this.release = null;
    this.active = null;
    this.index = -1;
    this.changed(-1, 'idle');
  }
  pause() {
    if (!this.running) return;
    this.paused = true;
    void this.singleContext?.suspend();
    this.audio.pause();
    this.cancelWatch();
    this.changed(this.index, 'paused');
  }
  resume() {
    if (!this.running) return;
    const generation = this.generation;
    if (this.singleContext) {
      void this.singleContext
        .resume()
        .then(() => {
          if (generation !== this.generation) return;
          this.paused = false;
          this.changed(this.index, 'playing');
        })
        .catch(() => this.failed('Press Resume to continue playback.'));
      return;
    }
    this.paused = false;
    void this.audio
      .play()
      .then(() => {
        if (generation !== this.generation) return;
        this.changed(this.index, 'playing');
        this.watch();
      })
      .catch(() => {
        if (generation !== this.generation) return;
        this.paused = true;
        this.changed(this.index, 'paused');
        this.failed('Press Resume to continue playback.');
      });
  }
  setSpeed(value: number) {
    this.speed = value;
    this.audio.playbackRate = value;
    if (this.singleSource) this.singleSource.playbackRate.value = value;
  }
  async playOnce(index: number) {
    this.stop();
    const segment = this.segments[index];
    if (!segment) return;
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    this.running = true;
    this.index = index;
    // Unlock on the user gesture, before fetching/decoding. A scheduled buffer stops at the cue boundary.
    const context = new AudioContext();
    this.singleContext = context;
    void context.resume().catch(() => {});
    this.changed(index, 'loading');
    try {
      const fragment = await this.preload(segment.id, controller.signal);
      if (generation !== this.generation) return;
      const cue = fragment.cues.find((c) => c.id === segment.id)!;
      const buffer = await context.decodeAudioData(await fragment.blob.arrayBuffer());
      if (generation !== this.generation) return;
      const source = context.createBufferSource();
      this.singleSource = source;
      source.buffer = buffer;
      source.playbackRate.value = this.speed;
      source.connect(context.destination);
      source.onended = () => {
        if (this.singleSource === source) this.singleSource = null;
        source.disconnect();
        if (generation === this.generation) {
          this.running = false;
          this.singleContext = null;
          void context.close().catch(() => {});
          this.changed(-1, 'idle');
        }
      };
      source.start(0, cue.start, Math.min(cue.end, buffer.duration) - cue.start);
      this.changed(index, 'playing');
    } catch (e) {
      if (generation === this.generation && !controller.signal.aborted) {
        this.failed(e instanceof Error ? e.message : 'Sentence playback failed.');
        this.stop();
      }
    }
  }
  async start(from = 0) {
    this.stop();
    if (!this.segments.length) return;
    from = Math.max(0, Math.min(this.segments.length - 1, from));
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    this.running = true;
    this.index = from;
    const firstGroup = this.groups.findIndex((g) => g.some((s) => s.id === this.segments[from].id));
    const ahead = new Map<number, Promise<Loaded>>();
    const prefetch = (i: number) => {
      if (i >= this.groups.length || ahead.has(i)) return;
      const job = this.preload(this.groups[i][0].id, controller.signal);
      ahead.set(i, job);
      void job.catch(() => {});
    };
    try {
      for (let i = firstGroup; i < this.groups.length; i++) {
        if (generation !== this.generation) return;
        this.changed(this.index, 'loading');
        prefetch(i);
        prefetch(i + 1);
        const fragment = await ahead.get(i)!;
        if (generation !== this.generation) return;
        prefetch(i + 2);
        this.active = fragment;
        this.audio.src = fragment.url;
        this.audio.playbackRate = this.speed;
        const cue =
          i === firstGroup
            ? fragment.cues.find((c) => c.id === this.segments[from].id)!
            : fragment.cues[0];
        this.index = this.segments.findIndex((s) => s.id === cue.id);
        // Full fragments run through all sentence boundaries without a seek or new network request.
        this.audio.currentTime = cue.start;
        const ended = new Promise<void>((resolve, reject) => {
          this.release = resolve;
          this.audio.onended = () => resolve();
          this.audio.onerror = () => reject(Error('Could not play the text recording.'));
          this.audio.ontimeupdate = () => this.highlight();
        });
        await this.audio.play();
        if (generation !== this.generation) return;
        this.changed(this.index, 'playing');
        this.watch();
        await ended;
        this.cancelWatch();
        if (i + 1 < this.groups.length)
          this.index = this.segments.findIndex((s) => s.id === this.groups[i + 1][0].id);
      }
    } catch (e) {
      if (generation === this.generation && !controller.signal.aborted)
        this.failed(e instanceof Error ? e.message : 'Text playback failed.');
    } finally {
      if (generation === this.generation) {
        controller.abort();
        this.running = false;
        this.audio.pause();
        this.audio.onended = null;
        this.audio.onerror = null;
        this.audio.ontimeupdate = null;
        this.release = null;
        this.active = null;
        this.cancelWatch();
        this.changed(-1, 'idle');
      }
    }
  }
  dispose() {
    this.stop();
    this.loaded.forEach((x) => URL.revokeObjectURL(x.url));
    this.loaded.clear();
  }
}
