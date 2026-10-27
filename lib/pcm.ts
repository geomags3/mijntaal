export function pcmWav(pcm: Uint8Array) {
  const b = new Uint8Array(44 + pcm.length),
    v = new DataView(b.buffer);
  const put = (offset: number, s: string) =>
    [...s].forEach((c, i) => (b[offset + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, pcm.length, true);
  b.set(pcm, 44);
  return b;
}
