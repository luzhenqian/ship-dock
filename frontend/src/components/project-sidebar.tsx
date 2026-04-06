'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ProjectSidebarProps {
  projectId: string;
  projectName: string;
  status: string;
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  STOPPED: 'bg-foreground-muted',
  ERROR: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
};

const groups = [
  {
    label: 'Project',
    items: [
      { href: 'deployments', label: 'Deployments' },
      { href: 'pipeline', label: 'Pipeline' },
      { href: 'logs', label: 'Logs' },
      { href: 'analytics', label: 'Analytics' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: 'database', label: 'Database' },
      { href: 'redis', label: 'Redis' },
      { href: 'storage', label: 'Storage' },
    ],
  },
  {
    label: 'Config',
    items: [
      { href: 'nginx', label: 'Nginx' },
      { href: 'pm2', label: 'PM2' },
      { href: 'webhooks', label: 'Webhooks' },
      { href: 'settings', label: 'Settings' },
    ],
  },
];

export function ProjectSidebar({ projectId, projectName, status }: ProjectSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-[200px] shrink-0 border-r py-5 px-3">
      <div className="mb-5 px-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${statusColors[status] || 'bg-foreground-muted'}`}
          />
          <span className="text-sm font-medium text-foreground truncate">
            {projectName}
          </span>
        </div>
      </div>
      <nav className="space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const fullHref = `/projects/${projectId}/${item.href}`;
                const isActive = pathname.startsWith(fullHref);
                return (
                  <Link
                    key={item.href}
                    href={fullHref}
                    className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? 'bg-foreground/[0.06] text-foreground font-medium'
                        : 'text-foreground-secondary hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
