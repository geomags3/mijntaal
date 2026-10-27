export function audioGroups<T extends { id: string; nl: string }>(segments: T[], max = 1800) {
  const groups: T[][] = [];
  let group: T[] = [],
    size = 0;
  for (const s of segments) {
    if (group.length && size + 1 + s.nl.length > max) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(s);
    size += s.nl.length + 1;
  }
  if (group.length) groups.push(group);
  return groups;
}
/** Use original-text alignment only. Never guess timings from normalized numbers. */
export function sentenceRanges(sentences: string[], a: any, duration: number) {
  if (
    !a ||
    !Array.isArray(a.characters) ||
    !Array.isArray(a.character_start_times_seconds) ||
    !Array.isArray(a.character_end_times_seconds) ||
    a.characters.length !== a.character_start_times_seconds.length ||
    a.characters.length !== a.character_end_times_seconds.length
  )
    throw Error('Missing sentence timestamps.');
  const positions: { c: string; start: number; end: number }[] = [];
  let previous = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const start = a.character_start_times_seconds[i],
      end = a.character_end_times_seconds[i];
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previous ||
      end < start ||
      end > duration + 0.15
    )
      throw Error('Invalid sentence timestamps.');
    previous = start;
    for (const c of Array.from(String(a.characters[i])))
      if (!/\s/u.test(c)) positions.push({ c, start, end });
  }
  const wanted = sentences.map((s) => Array.from(s).filter((c) => !/\s/u.test(c)));
  if (!Number.isFinite(duration) || duration <= 0) throw Error('Invalid audio duration.');
  if (positions.map((p) => p.c).join('') !== wanted.flat().join(''))
    throw Error('Audio timestamps do not match the original text.');
  let at = 0;
  const starts = wanted.map((chars, i) => {
    const start = positions[at]?.start,
      previousEnd = i ? positions[at - 1]?.end : 0;
    at += chars.length;
    return i && previousEnd <= start ? (previousEnd + start) / 2 : start;
  });
  return starts.map((start, i) => ({
    start: i === 0 ? 0 : start,
    end: i + 1 < starts.length ? starts[i + 1] : duration,
  }));
}
