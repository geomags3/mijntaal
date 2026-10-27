import { audioGroups } from './text-audio';
type State = 'pending' | 'loading' | 'ready' | 'error';
type Segment = { id: string; nl: string; en?: string; audioReady?: boolean };
export function textPreparation(
  segments: Segment[],
  progress: Record<string, { audio: State; translation: State; error?: string }>,
) {
  let offset = 0;
  const parts = audioGroups(segments).map((group) => {
    const first = offset + 1;
    offset += group.length;
    const states = group.map((s) => progress[s.id]?.audio || (s.audioReady ? 'ready' : 'pending'));
    const state: State = states.includes('error')
      ? 'error'
      : states.includes('loading')
        ? 'loading'
        : states.every((s) => s === 'ready')
          ? 'ready'
          : 'pending';
    return {
      id: group[0].id,
      first,
      last: offset,
      weight: group.reduce((n, s) => n + s.nl.length, 0),
      state,
      error: group.find((s) => progress[s.id]?.audio === 'error')?.id,
    };
  });
  const weight = parts.reduce((n, p) => n + p.weight, 0),
    readyWeight = parts.filter((p) => p.state === 'ready').reduce((n, p) => n + p.weight, 0);
  const translated = segments.filter(
    (s) => (progress[s.id]?.translation || (s.en ? 'ready' : 'pending')) === 'ready',
  ).length;
  return {
    parts,
    readyParts: parts.filter((p) => p.state === 'ready').length,
    percent: weight ? Math.floor((readyWeight / weight) * 100) : 0,
    translated,
    translationErrors: segments.some((s) => progress[s.id]?.translation === 'error'),
  };
}
