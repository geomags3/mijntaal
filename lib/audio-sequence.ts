import { pcmWav } from './pcm';
import { getAudio, putAudio } from './persistent-audio';
/** Keep audio and phrase highlighting in one cancellable sequence. */
export class AudioSequence {
  private generation = 0;
  private cacheScope = '';
  setCacheScope(scope: string) {
    if (scope !== this.cacheScope) {
      this.clearCache();
      this.cacheScope = scope;
    }
  }
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private release: (() => void) | null = null;
  private urls = new Map<string, string>();
  private blobs = new Map<string, Blob>();
  private remember(text: string, blob: Blob) {
    this.blobs.set(text, blob);
    if (!this.urls.has(text)) this.urls.set(text, URL.createObjectURL(blob));
  }
  private controller: AbortController | null = null;
  constructor(
    private audio: HTMLAudioElement,
    private changed: (index: number, state: 'idle' | 'loading' | 'playing' | 'paused') => void,
    private failed: (message: string) => void,
  ) {}
  private pending = new Map<string, Promise<void>>();
  private pendingSignals = new Map<string, AbortSignal | undefined>();
  loadAudio?: (text: string, signal?: AbortSignal) => Promise<Blob>;
  async preload(text: string, signal?: AbortSignal, loader?: () => Promise<Blob>) {
    text = text.trim().normalize('NFC');
    if (this.urls.has(text)) return;
    const scope = this.cacheScope,
      key = scope + '|' + text;
    const existing = this.pending.get(key);
    if (existing && !this.pendingSignals.get(key)?.aborted) return existing;
    const job = (async () => {
      let blob = await getAudio(scope, text);
      if (!blob) {
        if (loader) blob = await loader();
        else if (this.loadAudio) blob = await this.loadAudio(text, signal);
        else {
          const r = await fetch('/api/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal,
          });
          if (!r.ok) {
            const b: any = await r.json();
            throw Error(b.error || 'Could not load audio.');
          }
          blob = await r.blob();
        }
        await putAudio(scope, text, blob);
      }
      if (scope === this.cacheScope && !signal?.aborted && !this.urls.has(text))
        this.remember(text, blob);
    })();
    this.pending.set(key, job);
    this.pendingSignals.set(key, signal);
    try {
      await job;
    } finally {
      if (this.pending.get(key) === job) {
        this.pending.delete(key);
        this.pendingSignals.delete(key);
      }
    }
  }
  speed = 1;
  private index = -1;
  private running = false;
  private usingContext = false;
  private unlock(context: AudioContext) {
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 4000);
      context.resume().then(
        () => {
          clearTimeout(timeout);
          resolve(context.state === 'running');
        },
        () => {
          clearTimeout(timeout);
          resolve(false);
        },
      );
    });
  }
  stop() {
    this.generation++;
    this.controller?.abort();
    this.audio.pause();
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    this.sources.clear();
    this.release?.();
    this.release = null;
    this.running = false;
    this.index = -1;
    this.changed(-1, 'idle');
  }
  pause() {
    if (this.running) {
      if (this.usingContext && this.context)
        void this.context.suspend().catch(() => {
          this.stop();
          this.failed('Could not pause audio. Press Play again.');
        });
      this.audio.pause();
      this.changed(this.index, 'paused');
    }
  }
  resume() {
    if (!this.running) return;
    const generation = this.generation;
    if (this.usingContext && this.context) {
      void this.unlock(this.context).then((ok) => {
        if (generation !== this.generation) return;
        if (ok) this.changed(this.index, 'playing');
        else {
          this.stop();
          this.failed('Your browser blocked audio. Press Play again.');
        }
      });
      return;
    }
    this.audio
      .play()
      .then(() => {
        if (generation === this.generation) this.changed(this.index, 'playing');
      })
      .catch(() => {
        if (generation === this.generation) {
          this.stop();
          this.failed('Press Play again to continue.');
        }
      });
  }
  setSpeed(value: number) {
    this.speed = value;
    this.audio.playbackRate = value;
  }
  async start(texts: string[], firstIndex = 0) {
    this.stop();
    const startedAt = performance.now();
    const generation = this.generation;
    this.running = true;
    this.controller = new AbortController();
    let streaming = firstIndex < 0 && this.speed === 1 && typeof AudioContext !== 'undefined';
    let unlocked: Promise<boolean> = Promise.resolve(false);
    if (streaming) {
      try {
        if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
        unlocked = this.unlock(this.context);
      } catch {
        streaming = false;
      }
    }
    this.usingContext = streaming;
    const ahead = new Map<number, Promise<void>>();
    const prefetch = (n: number) => {
      if (n >= texts.length || ahead.has(n)) return;
      const p = this.preload(texts[n], this.controller!.signal);
      ahead.set(n, p);
      void p.catch(() => {});
    };
    try {
      for (let n = 0; n < texts.length; n++) {
        if (generation !== this.generation) return;
        const text = texts[n].trim().normalize('NFC');
        this.changed(firstIndex < 0 ? -1 : firstIndex + n, 'loading');
        if (!streaming) {
          for (let k = n; k < n + (this.loadAudio ? 1 : 3); k++) prefetch(k);
          await ahead.get(n);
          if (this.loadAudio) prefetch(n + 1);
        }
        if (!this.urls.has(text)) {
          const stored = await getAudio(this.cacheScope, text);
          if (generation !== this.generation) return;
          if (stored) this.remember(text, stored);
        }
        if (!this.urls.has(text)) {
          const response = await fetch('/api/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, stream: streaming }),
            signal: this.controller.signal,
          });
          if (!response.ok) {
            const result: any = await response.json();
            throw Error(result.error || 'Could not load the audio.');
          }
          if (response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
            if (!(await unlocked)) throw Error('Your browser blocked audio. Press Play again.');
            if (generation !== this.generation) return;
            await this.playStream(response, text, generation, startedAt);
            continue;
          }
          const blob = await response.blob();
          if (generation !== this.generation) return;
          this.remember(text, blob);
          await putAudio(this.cacheScope, text, blob);
        }
        if (generation !== this.generation) return;
        if (streaming && this.context) {
          if (!(await unlocked)) throw Error('Your browser blocked audio. Press Play again.');
          if (generation !== this.generation) return;
          const context = this.context;
          const blob = this.blobs.get(text);
          if (!blob) throw Error('The saved audio is unavailable. Please try again.');
          const bytes = await blob.arrayBuffer();
          const buffer = await context.decodeAudioData(bytes);
          if (generation !== this.generation) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          this.sources.add(source);
          this.index = firstIndex < 0 ? -1 : firstIndex + n;
          const done = new Promise<void>((resolve) => {
            this.release = resolve;
            source.onended = () => {
              this.sources.delete(source);
              source.disconnect();
              resolve();
            };
          });
          source.start();
          this.changed(this.index, 'playing');
          await done;
          continue;
        }
        this.audio.src = this.urls.get(text)!;
        this.audio.playbackRate = this.speed;
        this.index = firstIndex < 0 ? -1 : firstIndex + n;
        const done = new Promise<void>((resolve, reject) => {
          this.release = resolve;
          this.audio.onended = () => resolve();
          this.audio.onerror = () => reject(Error('Could not play the audio.'));
        });
        await this.audio.play();
        if (generation !== this.generation) return;
        this.changed(this.index, 'playing');
        await done;
      }
    } catch (e) {
      if (generation === this.generation && !(e instanceof DOMException && e.name === 'AbortError'))
        this.failed(e instanceof Error ? e.message : 'Playback failed.');
    } finally {
      if (generation === this.generation) {
        this.running = false;
        this.index = -1;
        this.changed(-1, 'idle');
      }
    }
  }
  private async playStream(response: Response, text: string, generation: number, started: number) {
    const context = this.context!,
      reader = response.body!.getReader(),
      decoder = new TextDecoder(),
      chunks: Uint8Array[] = [];
    let pending = '',
      nextTime = context.currentTime + 0.06,
      total = 0,
      complete = false,
      first = true,
      last: AudioBufferSourceNode | null = null;
    const accept = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw Error(event.message || 'Audio generation failed.');
      if (event.type === 'done') {
        complete = true;
        return;
      }
      if (event.type !== 'audio') return;
      const pcm = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
      if (pcm.length % 2) throw Error('Invalid audio chunk.');
      total += pcm.length;
      if (total > 6000000) throw Error('Audio is too long.');
      chunks.push(pcm);
      const buffer = context.createBuffer(1, pcm.length / 2, 24000),
        channel = buffer.getChannelData(0),
        view = new DataView(pcm.buffer);
      for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
      };
      source.start(Math.max(nextTime, context.currentTime + 0.02));
      nextTime = Math.max(nextTime, context.currentTime + 0.02) + buffer.duration;
      last = source;
      if (first) {
        first = false;
        this.index = -1;
        this.changed(-1, 'playing');
        performance.measure('dutch:audio:first-chunk', { start: started, end: performance.now() });
      }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (generation !== this.generation) return;
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let at;
        while ((at = pending.indexOf('\n')) >= 0) {
          accept(pending.slice(0, at));
          pending = pending.slice(at + 1);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) accept(pending);
      if (!complete || !total) throw Error('Audio was interrupted. Please try again.');
      const wavPcm = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        wavPcm.set(c, offset);
        offset += c.length;
      }
      const blob = new Blob([pcmWav(wavPcm).buffer as ArrayBuffer], { type: 'audio/wav' });
      this.remember(text, blob);
      await putAudio(this.cacheScope, text, blob);
      if (generation !== this.generation) return;
      if (last && this.sources.has(last))
        await new Promise<void>((resolve) => {
          this.release = resolve;
          const source = last!;
          source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
            resolve();
          };
        });
    } catch (e) {
      if (generation !== this.generation) return;
      this.controller?.abort();
      void reader.cancel().catch(() => {});
      this.sources.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      this.sources.clear();
      throw e;
    } finally {
      reader.releaseLock();
    }
  }
  clearCache() {
    this.stop();
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
    this.blobs.clear();
  }
  dispose() {
    this.clearCache();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
