'use client';
import { use } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProject } from '@/hooks/use-projects';
import { Badge } from '@/components/ui/badge';

const statusColors: Record<string, string> = { ACTIVE: 'bg-green-500', STOPPED: 'bg-gray-400', ERROR: 'bg-red-500' };

const tabs = [
  { href: 'deployments', label: 'Deployments' },
  { href: 'pipeline', label: 'Pipeline' },
  { href: 'logs', label: 'Logs' },
  { href: 'database', label: 'Database' },
  { href: 'redis', label: 'Redis' },
  { href: 'storage', label: 'Storage' },
  { href: 'settings', label: 'Settings' },
];

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname();
  const { data: project } = useProject(id);

  return (
    <div className="w-full py-8 px-8">
      {/* Project header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">&larr; Projects</Link>
        </div>
        {project ? (
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[project.status] || 'bg-gray-400'}`} />
            <Badge variant="secondary">{project.status}</Badge>
            {project.domain && <span className="text-sm text-muted-foreground">{project.domain}</span>}
            <span className="text-sm text-muted-foreground font-mono">:{project.port}</span>
          </div>
        ) : (
          <h1 className="text-2xl font-bold">Loading...</h1>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b mb-6">
        {tabs.map((tab) => {
          const fullHref = `/projects/${id}/${tab.href}`;
          const isActive = pathname.startsWith(fullHref);
          return (
            <Link
              key={tab.href}
              href={fullHref}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
