'use client';
import {
  Bookmark,
  BookOpen,
  ChevronLeft,
  GraduationCap,
  Library,
  Search,
  Settings,
  Triangle,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { readJson } from '../../lib/client-data';
const sections = [
  { name: 'Search', href: '/?tab=Search', Icon: Search },
  { name: 'Collection', href: '/?tab=Collection', Icon: Bookmark },
  { name: 'Texts', href: '/texts', Icon: BookOpen },
  { name: 'Practice', href: '/?tab=Practice', Icon: GraduationCap },
  { name: 'Lessons', href: '/?tab=Lessons', Icon: Library },
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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationId = useId();
  const navigationRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!navigationOpen) return;
    const media = window.matchMedia('(max-width: 700px)');
    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!navigationRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setNavigationOpen(false);
      }
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavigationOpen(false);
        toggleRef.current?.focus();
      }
    }
    function closeNavigation() {
      setNavigationOpen(false);
    }
    if (media.matches) {
      const current = navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      (current || navigationRef.current?.querySelector<HTMLElement>('a'))?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    window.addEventListener('popstate', closeNavigation);
    media.addEventListener('change', closeNavigation);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
      window.removeEventListener('popstate', closeNavigation);
      media.removeEventListener('change', closeNavigation);
    };
  }, [navigationOpen]);

  return (
    <header className="topbar unified-header">
      <Link
        className="brand"
        href="/?tab=Search"
        aria-label="MijnTaal home"
        onClick={(e) => {
          setNavigationOpen(false);
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
      <button
        ref={toggleRef}
        type="button"
        className={'mobile-navigation-toggle' + (navigationOpen ? ' is-open' : '')}
        aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navigationOpen}
        aria-controls={navigationId}
        onClick={() => setNavigationOpen((open) => !open)}
      >
        {navigationOpen ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <ChevronLeft size={22} aria-hidden="true" />
        )}
      </button>
      <nav
        ref={navigationRef}
        id={navigationId}
        className={'main-navigation' + (navigationOpen ? ' is-open' : '')}
        aria-label="Main navigation"
        onBlur={(event) => {
          if (
            navigationOpen &&
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget) &&
            !toggleRef.current?.contains(event.relatedTarget)
          ) {
            setNavigationOpen(false);
          }
        }}
      >
        <Triangle
          className="mobile-navigation-pointer"
          size={24}
          fill="currentColor"
          aria-hidden="true"
        />
        {sections.map(({ name, href, Icon }) => (
          <Link
            href={href}
            key={name}
            onMouseEnter={() => warm(name)}
            onFocus={() => warm(name)}
            className={'nav-item ' + (active === name ? 'active' : '')}
            aria-current={active === name ? 'page' : undefined}
            onClick={(e) => {
              setNavigationOpen(false);
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
            setNavigationOpen(false);
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
