'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Shield,
  GitBranch,
  ScrollText,
  BarChart3,
  Database,
  Server,
  HardDrive,
  Globe,
  Cpu,
  Webhook,
  Settings,
  Play,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

const groups: { label: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'Project',
    items: [
      { href: 'deployments', label: 'Deployments', icon: Shield },
      { href: 'pipeline', label: 'Pipeline', icon: GitBranch },
      { href: 'tasks', label: 'Tasks', icon: Play },
      { href: 'logs', label: 'Logs', icon: ScrollText },
      { href: 'analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: 'database', label: 'Database', icon: Database },
      { href: 'redis', label: 'Redis', icon: Server },
      { href: 'storage', label: 'Storage', icon: HardDrive },
    ],
  },
  {
    label: 'Config',
    items: [
      { href: 'nginx', label: 'Nginx', icon: Globe },
      { href: 'pm2', label: 'PM2', icon: Cpu },
      { href: 'webhooks', label: 'Webhooks', icon: Webhook },
      { href: 'settings', label: 'Settings', icon: Settings },
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
      <nav>
        {groups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-2 pt-2 border-t border-border/50' : ''}>
            <div className="mb-1 px-2 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const fullHref = `/projects/${projectId}/${item.href}`;
                const isActive = pathname.startsWith(fullHref);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={fullHref}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? 'bg-foreground/[0.06] text-foreground font-medium'
                        : 'text-foreground-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
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
