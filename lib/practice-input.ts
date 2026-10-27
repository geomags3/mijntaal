export type AnswerMode = 'blocks' | 'typing';
export function assembleBlocks(tokens: string[], picked: number[], separator: string) {
  return picked.map((i) => tokens[i]).join(separator);
}
