'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { SunIcon, MoonIcon } from 'lucide-react';

const globalLinks = [
  { href: '/domains', label: 'Domains' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
  { href: '/docs', label: 'Docs' },
];

interface TopNavProps {
  projectName?: string;
  projectId?: string;
}

export function TopNav({ projectName, projectId }: TopNavProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/80 px-5 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold text-foreground hover:text-foreground/80 transition-colors"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-foreground">
              <path d="M12 22L2 4.5h20L12 22Z" fill="currentColor" />
            </svg>
          </span>
          Ship Dock
        </Link>
        {projectName && projectId && (
          <>
            <span className="text-foreground-muted">／</span>
            <Link
              href={`/projects/${projectId}/deployments`}
              className="text-foreground-secondary hover:text-foreground transition-colors"
            >
              {projectName}
            </Link>
          </>
        )}
      </div>
      <nav className="flex items-center gap-5">
        {globalLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm transition-colors ${
              pathname.startsWith(link.href)
                ? 'text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {link.label}
          </Link>
        ))}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
          aria-label="Toggle theme"
        >
          <SunIcon className="size-4 dark:hidden" />
          <MoonIcon className="hidden size-4 dark:block" />
        </button>
      </nav>
    </header>
  );
}
