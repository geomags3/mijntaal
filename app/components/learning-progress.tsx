import type { LearningProgress as Progress } from '../../lib/word-progress';
import { dueLabel } from '../../lib/word-progress';
export default function LearningProgress({
  progress,
  showDue = false,
}: {
  progress?: Progress;
  showDue?: boolean;
}) {
  const value = progress || { level: 0, label: 'New' },
    label =
      `Learning level ${value.level}/5 · ${value.label}` +
      (showDue
        ? (dueLabel(progress) !== value.label ? ' · ' + dueLabel(progress) : '') +
          (progress?.due ? ' · ' + progress.due : '')
        : '');
  return (
    <span
      className={'learning-progress learning-level-' + value.level}
      role="img"
      aria-label={label}
      title={label}
    >
      {showDue && <span className="learning-label learning-due">{dueLabel(progress)}</span>}
      <svg viewBox="0 0 28 28" width="25" height="25" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <circle
            key={i}
            cx="14"
            cy="14"
            r="10"
            fill="none"
            strokeWidth="3.3"
            strokeLinecap="round"
            strokeDasharray="8.7 54.14"
            transform={`rotate(${-90 + i * 72} 14 14)`}
            className={i < value.level ? 'progress-filled' : 'progress-empty'}
          />
        ))}
      </svg>
      <span className="learning-number">{value.level}/5</span>
      {!showDue && <span className="learning-label">{value.label}</span>}
    </span>
  );
}
