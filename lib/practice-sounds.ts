/** Short local tones; no assets, recordings or provider requests. */
export class PracticeSounds {
  private context: AudioContext | null = null;
  async unlock() {
    if (typeof AudioContext === 'undefined') return;
    try {
      this.context ||= new AudioContext();
      await this.context.resume().catch(() => {});
    } catch {
      /* Sound effects are optional. */
    }
  }
  play() {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    try {
      const notes = [660, 880];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const start = context.currentTime + index * 0.075;
        const duration = 0.12;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.055, start + 0.008);
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
