/** Device-local completed WAVs. Namespace is supplied by the authenticated server. */
const CACHE = 'ultimately-dutch-audio-v1';
function request(scope: string, text: string) {
  return new Request(
    new URL(
      '/__local_audio/' + scope + '/' + encodeURIComponent(text.trim().normalize('NFC')),
      location.origin,
    ),
  );
}
export async function getAudio(scope: string, text: string): Promise<Blob | null> {
  if (!scope || typeof caches === 'undefined') return null;
  try {
    const response = await (await caches.open(CACHE)).match(request(scope, text));
    return response ? await response.blob() : null;
  } catch {
    return null;
  }
}
export async function putAudio(scope: string, text: string, blob: Blob) {
  if (!scope || typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(
      request(scope, text),
      new Response(blob, { headers: { 'Content-Type': 'audio/wav' } }),
    );
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) await cache.delete(key);
  } catch {
    /* Storage may be unavailable or full. Server storage remains authoritative. */
  }
}
