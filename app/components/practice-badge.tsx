import { CircleSlash, MessageSquareText, WholeWord } from 'lucide-react';
import { PracticeMode, practiceName } from '../../lib/practice-mode';
export default function PracticeBadge({ mode }: { mode: PracticeMode }) {
  const Icon =
      mode === 'words' ? WholeWord : mode === 'sentences' ? MessageSquareText : CircleSlash,
    label = 'Practice: ' + practiceName(mode);
  return (
    <span
      className={'practice-badge practice-badge-' + mode}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}
