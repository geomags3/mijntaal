'use client';
import type { PracticeMode } from '../../lib/practice-mode';
export default function PracticeModeSelect({
  value,
  onChange,
  hasMeaning = true,
  disabled = false,
}: {
  value: PracticeMode;
  onChange: (value: PracticeMode) => void;
  hasMeaning?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="practice-mode-field">
      Practice in
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PracticeMode)}
      >
        <option value="words" disabled={!hasMeaning}>
          Words
        </option>
        <option value="sentences" disabled={!hasMeaning}>
          Sentences
        </option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}
