export type PracticeMode = 'words' | 'sentences' | 'off';
/** Legacy active cards stay in Words; their content and learning state are unchanged. */
export function practiceMode(item: { practice?: boolean; body?: any }): PracticeMode {
  if (!item.practice || item.body?.practiceMode === 'off') return 'off';
  return item.body?.practiceMode === 'sentences' ? 'sentences' : 'words';
}
export function practiceName(mode: PracticeMode) {
  return mode === 'words' ? 'Words' : mode === 'sentences' ? 'Sentences' : 'Off';
}
