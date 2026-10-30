/** Short local tones; no assets, recordings or provider requests. */
export class PracticeSounds {
  private context: AudioContext | null = null;
  unlock() {
    if (typeof AudioContext === 'undefined') return;
    try {
      this.context ||= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      /* Sound effects are optional. */
    }
  }
  play(kind: 'tap' | 'correct' | 'wrong') {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    try {
      const notes = kind === 'correct' ? [660, 880] : kind === 'wrong' ? [240] : [520];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const start = context.currentTime + index * 0.075;
        const duration = kind === 'tap' ? 0.035 : 0.12;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(kind === 'tap' ? 0.025 : 0.055, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + duration);
      });
    } catch {
      /* Optional feedback must never interrupt an answer. */
    }
  }
  dispose() {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
