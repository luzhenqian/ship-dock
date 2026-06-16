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
  FolderOpen,
  Code2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ProjectSidebarProps {
  projectId: string;
  projectName: string;
  project?: any;
}

const statusColors: Record<string, string> = {
  ready: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  failed: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
  idle: 'bg-foreground-muted',
  stopped: 'bg-foreground-muted',
};

function getStatusKey(project: any): string {
  if (!project) return 'idle';
  if (project.status === 'STOPPED') return 'stopped';
  if (project.status === 'ERROR') return 'failed';
  const lastDeploy = project.deployments?.[0];
  if (!lastDeploy) return 'idle';
  if (lastDeploy.status === 'FAILED') return 'failed';
  return 'ready';
}

export function ProjectSidebar({ projectId, projectName, project }: ProjectSidebarProps) {
  const pathname = usePathname();
  const statusKey = getStatusKey(project);
  const isStatic = project?.sourceType === 'STATIC';

  const groups: { label: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
    {
      label: 'Project',
      items: [
        { href: 'deployments', label: 'Deployments', icon: Shield },
        ...(isStatic ? [{ href: 'editor', label: 'Editor', icon: Code2 }] : []),
        { href: 'pipeline', label: 'Pipeline', icon: GitBranch },
        { href: 'tasks', label: 'Tasks', icon: Play },
        { href: 'logs', label: 'Logs', icon: ScrollText },
        { href: 'analytics', label: 'Analytics', icon: BarChart3 },
        { href: 'files', label: 'Files', icon: FolderOpen },
      ],
    },
    ...(!isStatic ? [{
      label: 'Data',
      items: [
        { href: 'database', label: 'Database', icon: Database },
        { href: 'redis', label: 'Redis', icon: Server },
        { href: 'storage', label: 'Storage', icon: HardDrive },
      ],
    }] : []),
    {
      label: 'Config',
      items: [
        { href: 'nginx', label: 'Nginx', icon: Globe },
        ...(!isStatic ? [{ href: 'pm2', label: 'PM2', icon: Cpu }] : []),
        { href: 'webhooks', label: 'Webhooks', icon: Webhook },
        { href: 'settings', label: 'Settings', icon: Settings },
      ],
    },
  ];

  return (
    <aside className="w-[200px] shrink-0 border-r py-5 px-3">
      <div className="mb-5 px-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${statusColors[statusKey]}`}
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
