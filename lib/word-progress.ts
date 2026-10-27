import type { WordState } from './words';
import { learningDay } from './words';
export type LearningProgress = {
  level: number;
  label: string;
  stage: WordState['stage'];
  due: string | null;
  today?: string;
};
export function learningProgress(
  state?: WordState | null,
  today = learningDay(),
): LearningProgress {
  const stage = state?.stage || 'intro',
    level =
      stage === 'intro'
        ? 0
        : stage === 'recognize'
          ? 1
          : stage === 'build'
            ? 2
            : stage === 'recall'
              ? 3
              : (state?.interval ?? -1) >= 2
                ? 5
                : 4;
  return {
    level,
    label: ['New', 'Recognize', 'Build', 'Recall', 'Review', 'Familiar'][level],
    stage,
    due: stage === 'intro' && !state?.lastSeenDay ? null : state?.due || null,
    today,
  };
}

export function dueLabel(progress?: LearningProgress) {
  if (!progress?.due) return 'New';
  const today = progress.today || learningDay();
  const delta = Math.round(
    (Date.parse(progress.due + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000,
  );
  return delta <= 0 ? 'Today' : delta + 'd';
}
