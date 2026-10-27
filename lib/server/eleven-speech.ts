import { env } from 'cloudflare:workers';
import { pcmWav } from '../pcm';
import { AppError, hash, limit } from './common';
import {
  decryptKey,
  elevenAudioScope,
  encryptKey,
  getElevenSettings,
  putElevenSettings,
} from './settings';
export async function elevenRequest(key: string, path: string, input?: any) {
  let r: Response;
  try {
    r = await fetch('https://api.elevenlabs.io' + path, {
      method: input ? 'POST' : 'GET',
      headers: { 'xi-api-key': key, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      body: input ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new AppError('ElevenLabs timed out. Retry this recording.', 504);
  }
  if (!r.ok)
    throw new AppError(
      r.status === 401
        ? 'ElevenLabs rejected this key.'
        : r.status === 429
          ? 'ElevenLabs credit or rate limit reached.'
          : 'ElevenLabs denied this request. Check key permissions, voice and model access.',
      r.status === 401 ? 401 : r.status === 429 ? 429 : 502,
    );
  return r;
}
async function myVoices(key: string) {
  const r: any = await (await elevenRequest(key, '/v2/voices?page_size=100')).json();
  if (!Array.isArray(r.voices)) throw new AppError('ElevenLabs returned no voice list.', 502);
  return r.voices.map((v: any) => ({
    id: String(v.voice_id),
    name: String(v.name),
    accent: String(v.labels?.accent || ''),
    language: String(v.labels?.language || ''),
  }));
}
export async function elevenStatus(user: string) {
  const s = await getElevenSettings(user);
  return {
    keyConfigured: !!s.cipher,
    voice: s.voice,
    model: s.model,
    voices: s.voices || [],
    audioReady: !!s.cipher && !!s.voice,
    scope: await elevenAudioScope(user, s),
  };
}
export async function manageEleven(user: string, b: any) {
  const s = await getElevenSettings(user);
  if (b.action === 'forget') {
    await putElevenSettings(user, { ...s, cipher: null, voices: [] });
    return elevenStatus(user);
  }
  if (b.action === 'key' || b.action === 'voices') {
    const key =
      b.action === 'key'
        ? String(b.key || '').trim()
        : s.cipher
          ? await decryptKey(s.cipher, user)
          : '';
    if (key.length < 10 || key.length > 500) throw new AppError('Enter an ElevenLabs API key.');
    const voices = await myVoices(key);
    await putElevenSettings(user, {
      ...s,
      cipher: b.action === 'key' ? await encryptKey(key, user) : s.cipher,
      voices,
    });
    return elevenStatus(user);
  }
  if (b.action === 'preferences') {
    if (
      !['eleven_v4', 'eleven_v3'].includes(b.model) ||
      typeof b.voice !== 'string' ||
      !b.voice ||
      b.voice.length > 150
    )
      throw new AppError('Choose a voice and model.');
    const voices = s.cipher ? await myVoices(await decryptKey(s.cipher, user)) : [];
    if (!voices.some((v: any) => v.id === b.voice))
      throw new AppError('Add this voice to My Voices in ElevenLabs, then refresh.');
    await putElevenSettings(user, { ...s, voice: b.voice, model: b.model, voices });
    return elevenStatus(user);
  }
  throw new AppError('Unknown audio settings action.');
}
export async function elevenContext(user: string) {
  const s = await getElevenSettings(user);
  if (!s.cipher || !s.voice)
    throw new AppError('Connect ElevenLabs and choose a voice in Settings.', 428);
  return { ...s, key: await decryptKey(s.cipher, user), scope: await elevenAudioScope(user, s) };
}
const jobs = new Map<string, Promise<Uint8Array>>();
export async function elevenSpeech(user: string, text: string) {
  text = text.trim().normalize('NFC');
  if (!text || text.length > 1500)
    throw new AppError('Enter Dutch text of up to 1,500 characters.');
  const s = await elevenContext(user),
    id = await hash(s.scope + text),
    path = 'eleven-speech/' + id + '.wav';
  const cached = await env.BUCKET!.get(path);
  if (cached)
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'X-Audio-Cache': 'hit',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  let job = jobs.get(id);
  if (!job) {
    job = (async () => {
      await limit(user, 'eleven-audio', 60);
      const r = await elevenRequest(s.key, '/v1/text-to-dialogue?output_format=pcm_24000', {
        inputs: [{ text, voice_id: s.voice }],
        model_id: s.model,
        language_code: 'nl',
        apply_text_normalization: 'auto',
      });
      const pcm = new Uint8Array(await r.arrayBuffer());
      if (
        !pcm.length ||
        pcm.length % 2 ||
        pcm.length > 10000000 ||
        !(r.headers.get('Content-Type') || '').match(/audio|octet-stream/i)
      )
        throw new AppError('ElevenLabs returned invalid audio.', 502);
      const wav = pcmWav(pcm);
      await env.BUCKET!.put(path, wav);
      return wav;
    })().finally(() => jobs.delete(id));
    jobs.set(id, job);
  }
  const wav = await job;
  return new Response(wav.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'audio/wav',
      'X-Audio-Cache': 'miss',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
