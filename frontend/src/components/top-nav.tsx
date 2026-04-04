'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const globalLinks = [
  { href: '/domains', label: 'Domains' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

interface TopNavProps {
  projectName?: string;
  projectId?: string;
}

export function TopNav({ projectName, projectId }: TopNavProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/80 px-5 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="font-semibold text-foreground hover:text-foreground/80 transition-colors"
        >
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
      </nav>
    </header>
  );
}
