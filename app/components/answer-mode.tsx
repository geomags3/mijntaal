'use client';
import type { AnswerMode } from '../../lib/practice-input';
export default function AnswerModeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: AnswerMode;
  onChange: (mode: AnswerMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="practice-switch answer-mode" role="group" aria-label="Answer with">
      {(['blocks', 'typing'] as const).map((mode) => (
        <button
          type="button"
          key={mode}
          disabled={disabled}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode === 'blocks' ? 'Blocks' : 'Typing'}
        </button>
      ))}
    </div>
  );
}
