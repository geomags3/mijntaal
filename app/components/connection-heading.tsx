import { KeyRound } from 'lucide-react';

export default function ConnectionHeading({
  title,
  configured,
}: {
  title: string;
  configured: boolean;
}) {
  return (
    <div className="settings-title">
      <KeyRound size={20} aria-hidden="true" />
      <h2>{title}</h2>
      <span className={'connection-badge' + (configured ? ' connected' : '')}>
        {configured ? 'Saved' : 'Not connected'}
      </span>
    </div>
  );
}
