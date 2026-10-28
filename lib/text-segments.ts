export type ReadingSegment = {
  id: string;
  nl: string;
  en: string;
  audioReady: boolean;
  translationProvider?: 'azure' | 'openai';
  translationFallback?: boolean;
};
/** Keep imported sentence boundaries; split unusually long fragments at word boundaries. */
export function segmentText(text: string, max = 1000): string[] {
  const result: string[] = [];
  for (const sentence of text
    .trim()
    .split(/(?<=[.!?])\s+|\n+/u)
    .filter(Boolean)) {
    let rest = sentence.trim();
    while (rest.length > max) {
      let at = rest.lastIndexOf(' ', max);
      if (at < max / 2) at = max;
      result.push(rest.slice(0, at));
      rest = rest.slice(at).trim();
    }
    if (rest) result.push(rest);
  }
  return result;
}
