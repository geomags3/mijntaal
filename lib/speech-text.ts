/** Tolerate punctuation and the spelling of explicit hyphenated compounds only. */
export function sameSpeechWording(expected: string, transcript: string) {
  const normalize = (s: string) =>
    s
      .toLocaleLowerCase('nl')
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  let a = normalize(expected),
    b = normalize(transcript);
  for (const match of expected.matchAll(/[\p{L}\p{N}]+(?:[-‐‑–—][\p{L}\p{N}]+)+/gu)) {
    const spaced = normalize(match[0]),
      joined = spaced.replace(/ /g, '');
    a = (' ' + a + ' ').replaceAll(' ' + spaced + ' ', ' ' + joined + ' ').trim();
    b = (' ' + b + ' ').replaceAll(' ' + spaced + ' ', ' ' + joined + ' ').trim();
  }
  return a === b;
}
