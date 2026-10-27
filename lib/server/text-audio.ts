import { env } from 'cloudflare:workers';
import { pcmWav } from '../pcm';
import { audioGroups, sentenceRanges } from '../text-audio';
import { AppError, db, hash, limit } from './common';
import { elevenContext, elevenRequest } from './eleven-speech';
const jobs = new Map<string, Promise<void>>();
export async function textAudioIdentity(scope: string, group: { id: string; nl: string }[]) {
  return hash(
    'text-eleven-v1:' + scope + JSON.stringify(group.map((s) => ({ id: s.id, nl: s.nl }))),
  );
}
export async function textSentenceAudio(
  user: string,
  segments: { id: string; nl: string }[],
  segmentId: string,
  full = false,
) {
  const s = await elevenContext(user),
    group = audioGroups(segments).find((g) => g.some((v) => v.id === segmentId));
  if (!group) throw new AppError('Sentence not found.', 404);
  const id = await textAudioIdentity(s.scope, group),
    index = group.findIndex((x) => x.id === segmentId),
    base = 'eleven-text/' + id,
    clipPath = base + (full ? '/full.wav' : '/' + index + '.wav'),
    complete = base + '/complete';
  let cached = await env.BUCKET!.get(clipPath);
  if (!cached || !(await env.BUCKET!.get(complete))) {
    let job = jobs.get(id);
    if (!job) {
      job = (async () => {
        // A D1 lease also prevents duplicate paid generations across Worker isolates/devices.
        const lease = 'eleven-text-lease:' + id,
          token = crypto.randomUUID(),
          now = new Date().toISOString();
        const claim = await db()
          .prepare(
            'INSERT INTO lookup_cache(id,owner,body,created) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,created=excluded.created WHERE lookup_cache.owner=excluded.owner AND lookup_cache.created<?',
          )
          .bind(lease, user, token, now, new Date(Date.now() - 120000).toISOString())
          .run();
        if (!claim.meta.changes) {
          for (let attempt = 0; attempt < 30; attempt++) {
            if (await env.BUCKET!.get(complete)) return;
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          throw new AppError(
            'This fragment is still being prepared on another page. Retry shortly.',
            409,
          );
        }
        try {
          let pcm: Uint8Array, alignment: any;
          const savedAudio = await env.BUCKET!.get(base + '/full.wav'),
            savedTimings = await env.BUCKET!.get(base + '/timings.json');
          if (savedAudio && savedTimings) {
            const wav = new Uint8Array(await new Response(savedAudio.body).arrayBuffer());
            pcm = wav.slice(44);
            alignment = JSON.parse(await new Response(savedTimings.body).text()).alignment;
          } else {
            await limit(user, 'eleven-text', 30);
            const r = await elevenRequest(
              s.key,
              '/v1/text-to-dialogue/with-timestamps?output_format=pcm_24000',
              {
                inputs: [{ text: group.map((x) => x.nl).join(' '), voice_id: s.voice }],
                model_id: s.model,
                language_code: 'nl',
                apply_text_normalization: 'auto',
              },
            );
            const result: any = await r.json();
            if (typeof result.audio_base64 !== 'string' || result.audio_base64.length > 14000000)
              throw new AppError('ElevenLabs returned invalid text audio.', 502);
            pcm = Uint8Array.from(atob(result.audio_base64), (c) => c.charCodeAt(0));
            alignment = result.alignment;
          }
          if (!pcm.length || pcm.length % 2)
            throw new AppError('ElevenLabs returned empty text audio.', 502);
          let ranges;
          try {
            ranges = sentenceRanges(
              group.map((x) => x.nl),
              alignment,
              pcm.length / 48000,
            );
          } catch (e) {
            throw new AppError((e as Error).message + ' Retry this fragment.', 502);
          }
          const clips = ranges.map((range) => {
            const from = Math.max(0, Math.floor(range.start * 24000) * 2),
              to = Math.min(pcm.length, Math.floor(range.end * 24000) * 2);
            if (to <= from)
              throw new AppError('An audio sentence has no duration. Retry this fragment.', 502);
            return pcmWav(pcm.slice(from, to));
          });
          await env.BUCKET!.put(base + '/full.wav', pcmWav(pcm));
          await env.BUCKET!.put(
            base + '/timings.json',
            JSON.stringify({ sentences: group, ranges, alignment }),
          );
          for (let i = 0; i < clips.length; i++)
            await env.BUCKET!.put(base + '/' + i + '.wav', clips[i]);
          await env.BUCKET!.put(complete, 'ready');
        } finally {
          await db()
            .prepare('UPDATE lookup_cache SET created=? WHERE id=? AND owner=? AND body=?')
            .bind('1970-01-01T00:00:00.000Z', lease, user, token)
            .run();
        }
      })().finally(() => jobs.delete(id));
      jobs.set(id, job);
    }
    await job;
    cached = await env.BUCKET!.get(clipPath);
  }
  if (!cached) throw new AppError('This fragment is not ready. Retry preparation.', 502);
  const headers: Record<string, string> = {
    'Content-Type': 'audio/wav',
    'Cache-Control': 'private, max-age=86400',
  };
  if (full) {
    const saved = await env.BUCKET!.get(base + '/timings.json');
    if (!saved) throw new AppError('Audio timestamps are missing. Retry preparation.', 502);
    const timing: any = JSON.parse(await new Response(saved.body).text());
    const duration = (cached.size - 44) / 48000;
    const ranges = sentenceRanges(
      group.map((x) => x.nl),
      timing.alignment,
      duration,
    );
    headers['X-Audio-Timeline'] = JSON.stringify(group.map((s, i) => ({ id: s.id, ...ranges[i] })));
  }
  return { response: new Response(cached.body, { headers }), group, chunkId: id, scope: s.scope };
}
