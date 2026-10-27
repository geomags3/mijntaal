import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MijnTaal · Your personal Dutch learning studio',
  description:
    'Your personal Dutch learning studio. Collect words and texts, listen, and practise with English translations.',
  icons: {
    icon: [{ url: '/brand/mijntaal-icon.png', type: 'image/png' }],
    shortcut: '/brand/mijntaal-icon.png',
    apple: [{ url: '/brand/mijntaal-icon.png' }],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
