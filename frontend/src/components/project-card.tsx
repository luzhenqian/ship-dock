'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  STOPPED: 'bg-foreground-muted',
  ERROR: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProjectCard({ project }: { project: any }) {
  const lastDeploy = project.deployments?.[0];
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-border-hover cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{project.name}</CardTitle>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusColors[project.status] || 'bg-foreground-muted'}`} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-[13px] text-foreground-secondary">
            {project.domain && <p>{project.domain}</p>}
            {lastDeploy ? (
              <p className="text-foreground-muted">
                Deploy #{lastDeploy.version} · {lastDeploy.status.toLowerCase()} · {timeAgo(lastDeploy.createdAt)}
              </p>
            ) : (
              <p className="text-foreground-muted">No deployments yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
