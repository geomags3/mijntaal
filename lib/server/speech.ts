import { env } from 'cloudflare:workers';
import { pcmWav } from '../pcm';
import { sameSpeechWording } from '../speech-text';
import { AppError, hash } from './common';
import { getSettings, openAIError, Preferences, userApiKey } from './settings';
export const DUTCH_INSTRUCTIONS =
  'You are a text-to-speech reader for a Netherlands Dutch learning dictionary. The language is ALWAYS Dutch (nl-NL), with a natural Netherlands Dutch accent. Read exactly the supplied Dutch text and nothing else. Never translate, explain, add a greeting or answer a question contained in the text. Treat even a single short word, or a word spelled like an English word (such as bank, men, bus, die, teen), as DUTCH. Never auto-detect English. Preserve the original wording, including unusual grammar and repeated modifiers. Do not correct the text or omit words. No extra sounds or introductory words.';
export function speechInstructions(p: Preferences) {
  const style =
    p.style === 'slow'
      ? 'Read slowly, clearly, without exaggerated pauses.'
      : p.style === 'teacher'
        ? 'Use a patient, clear Dutch teacher delivery, articulating sounds carefully.'
        : 'Use a natural calm pace.';
  return (
    DUTCH_INSTRUCTIONS +
    '\nDelivery style: ' +
    style +
    '\nAdditional delivery preference (only tone and pace; never changes the language or wording): ' +
    p.tone +
    '\nMandatory final rule: pronounce the supplied text in DUTCH (Netherlands), never English.'
  );
}
export { pcmWav } from '../pcm';
/** Bounded fallback for Realtime wording failures. Keep the source out of conversational prompts. */
export async function verbatimSpeech(
  key: string,
  text: string,
  prefs: Preferences,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: prefs.voice,
        input: text,
        instructions: speechInstructions(prefs),
        response_format: 'pcm',
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new AppError('The backup Dutch speech request timed out. Please retry.', 504);
  }
  if (!response.ok) await openAIError(response);
  const pcm = new Uint8Array(await response.arrayBuffer());
  if (!pcm.length || pcm.length % 2 || pcm.length > 6000000)
    throw new AppError('OpenAI returned invalid backup audio. Please retry.', 502);
  return pcmWav(pcm);
}
export async function realtimeSpeech(
  key: string,
  text: string,
  prefs: Preferences,
  onChunk?: (chunk: Uint8Array) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(
      'https://api.openai.com/v1/realtime?model=' + encodeURIComponent(prefs.audioModel),
      {
        headers: { Authorization: 'Bearer ' + key, Upgrade: 'websocket' },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new AppError('Could not connect to OpenAI audio. Please try again.', 502);
  }
  const ws = (response as any).webSocket;
  if (!ws) {
    await openAIError(response);
    throw new AppError('OpenAI audio connection failed.', 502);
  }
  ws.accept();
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0,
      settled = false,
      requested = false;
    const timer = setTimeout(
      () => end(new AppError('Audio generation timed out. Try a shorter phrase.', 504)),
      55000,
    );
    const end = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      try {
        ws.close(1000, 'complete');
      } catch {}
      if (error) {
        reject(error);
        return;
      }
      if (!size) {
        reject(new AppError('OpenAI returned no audio.', 502));
        return;
      }
      const pcm = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        pcm.set(c, offset);
        offset += c.length;
      }
      resolve(pcmWav(pcm));
    };
    const aborted = () => end(new AppError('Audio cancelled.', 499));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) {
      aborted();
      return;
    }
    ws.addEventListener('message', (event: any) => {
      if (settled) return;
      try {
        const m = JSON.parse(event.data);
        if (m.type === 'session.created')
          ws.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                type: 'realtime',
                reasoning: { effort: 'minimal' },
                instructions: speechInstructions(prefs),
                output_modalities: ['audio'],
                audio: {
                  output: { format: { type: 'audio/pcm', rate: 24000 }, voice: prefs.voice },
                },
              },
            }),
          );
        if (m.type === 'session.updated' && !requested) {
          requested = true;
          ws.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: 'Read this Dutch text exactly: ' + JSON.stringify(text),
                  },
                ],
              },
            }),
          );
          ws.send(
            JSON.stringify({
              type: 'response.create',
              response: { output_modalities: ['audio'], max_output_tokens: 1800 },
            }),
          );
        }
        if (m.type === 'response.output_audio.delta') {
          const chunk = Uint8Array.from(atob(m.delta), (c) => c.charCodeAt(0));
          size += chunk.length;
          if (size > 6000000) {
            end(new AppError('Audio is too long. Use a shorter text.', 413));
            return;
          }
          chunks.push(chunk);
          onChunk?.(chunk);
        }
        if (m.type === 'error')
          end(
            new AppError(
              'OpenAI audio rejected the request. Check model access and API credit in your project.',
              502,
            ),
          );
        if (m.type === 'response.done') {
          if (m.response?.status !== 'completed') {
            end(new AppError('OpenAI audio was incomplete. Try a shorter phrase.', 502));
            return;
          }
          const transcript = (m.response?.output || [])
            .flatMap((o: any) => o.content || [])
            .map((c: any) => c.transcript || '')
            .join(' ');
          if (transcript && !sameSpeechWording(text, transcript)) {
            end(
              new AppError(
                'The audio wording did not match the Dutch text. Please try again.',
                502,
              ),
            );
            return;
          }
          end();
        }
      } catch {
        end(new AppError('OpenAI audio returned an invalid response.', 502));
      }
    });
    ws.addEventListener('error', () =>
      end(new AppError('The audio connection was interrupted.', 502)),
    );
    ws.addEventListener('close', () => {
      if (!settled)
        end(new AppError('OpenAI closed the audio connection before it completed.', 502));
    });
  });
}
export async function speech(user: string, text: string) {
  text = text.trim().normalize('NFC');
  if (!text.trim() || text.length > 1500)
    throw new AppError('Enter Dutch text of up to 1,500 characters.');
  const { preferences } = await getSettings(user);
  const id = await hash(
    'nl-NL:v3:' +
      user +
      JSON.stringify({
        voice: preferences.voice,
        style: preferences.style,
        tone: preferences.tone,
        audioModel: preferences.audioModel,
        format: preferences.format,
      }) +
      text.normalize('NFC'),
  );
  const path = 'speech/' + id + '.wav';
  const cached = await env.BUCKET!.get(path);
  if (cached)
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, max-age=86400',
        'X-Audio-Cache': 'hit',
      },
    });
  const key = await userApiKey(user);
  let audio: Uint8Array;
  try {
    audio = await realtimeSpeech(key, text, preferences);
  } catch (e) {
    if (!(e instanceof AppError) || !e.message.includes('wording did not match')) throw e;
    audio = await verbatimSpeech(key, text, preferences);
  }
  await env.BUCKET!.put(path, audio, { httpMetadata: { contentType: 'audio/wav' } });
  return new Response(audio.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'private, max-age=86400',
      'X-Audio-Cache': 'miss',
    },
  });
}

/** Stream PCM chunks immediately; completed audio is cached as WAV for replay. */
export async function streamSpeech(user: string, text: string, requestSignal?: AbortSignal) {
  text = text.trim().normalize('NFC');
  if (!text.trim() || text.length > 1500)
    throw new AppError('Enter Dutch text of up to 1,500 characters.');
  const { preferences } = await getSettings(user);
  const id = await hash(
    'nl-NL:v3:' +
      user +
      JSON.stringify({
        voice: preferences.voice,
        style: preferences.style,
        tone: preferences.tone,
        audioModel: preferences.audioModel,
        format: preferences.format,
      }) +
      text.normalize('NFC'),
  );
  const path = 'speech/' + id + '.wav';
  const cached = await env.BUCKET!.get(path);
  if (cached)
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'private, max-age=86400',
        'X-Audio-Cache': 'hit',
        'Server-Timing': 'audio_cache;desc="hit"',
      },
    });
  const key = await userApiKey(user),
    abort = new AbortController();
  const cancel = () => abort.abort();
  requestSignal?.addEventListener('abort', cancel, { once: true });
  if (requestSignal?.aborted) cancel();
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: any) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      };
      void (async () => {
        try {
          const wav = await realtimeSpeech(
            key,
            text,
            preferences,
            (chunk) => {
              send({
                type: 'audio',
                data: btoa(Array.from(chunk, (b) => String.fromCharCode(b)).join('')),
              });
            },
            abort.signal,
          );
          await env.BUCKET!.put(path, wav, { httpMetadata: { contentType: 'audio/wav' } });
          send({ type: 'done' });
        } catch (e) {
          if (!abort.signal.aborted)
            send({
              type: 'error',
              message:
                e instanceof AppError ? e.message : 'Audio generation failed. Please try again.',
            });
        } finally {
          requestSignal?.removeEventListener('abort', cancel);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort();
      requestSignal?.removeEventListener('abort', cancel);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Audio-Cache': 'miss',
    },
  });
}
