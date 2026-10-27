'use client';
import { Bookmark, BookOpen, GraduationCap, Search, Settings } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { readJson } from '../../lib/client-data';
const sections = [
  { name: 'Search', href: '/?tab=Search', Icon: Search },
  { name: 'Collection', href: '/?tab=Collection', Icon: Bookmark },
  { name: 'Texts', href: '/texts', Icon: BookOpen },
  { name: 'Practice', href: '/?tab=Practice', Icon: GraduationCap },
];
function warm(name: string) {
  const path =
    name === 'Texts'
      ? '/api/text-library'
      : name === 'Collection'
        ? '/api/materials?kind=phrase&summary=true&archived=false'
        : name === 'Settings'
          ? '/api/settings'
          : '';
  if (path) void readJson(path).catch(() => {});
}
export default function AppHeader({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate?: (tab: string) => void;
}) {
  return (
    <header className="topbar unified-header">
      <Link
        className="brand"
        href="/?tab=Search"
        aria-label="MijnTaal home"
        onClick={(e) => {
          if (onNavigate && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            onNavigate('Search');
          }
        }}
      >
        <Image
          unoptimized
          className="brand-logo"
          src="/brand/mijntaal-logo.png"
          width="192"
          height="64"
          alt="MijnTaal"
        />
      </Link>
      <nav className="main-navigation" aria-label="Main navigation">
        {sections.map(({ name, href, Icon }) => (
          <Link
            href={href}
            key={name}
            onMouseEnter={() => warm(name)}
            onFocus={() => warm(name)}
            className={'nav-item ' + (active === name ? 'active' : '')}
            aria-current={active === name ? 'page' : undefined}
            onClick={(e) => {
              if (onNavigate && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                onNavigate(name);
              }
            }}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{name}</span>
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <Link
          className={'icon-button ' + (active === 'Settings' ? 'settings-active' : '')}
          href="/?tab=Settings"
          aria-label="Settings"
          aria-current={active === 'Settings' ? 'page' : undefined}
          onClick={(e) => {
            if (onNavigate && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onNavigate('Settings');
            }
          }}
        >
          <Settings size={20} />
        </Link>
      </div>
    </header>
  );
}
