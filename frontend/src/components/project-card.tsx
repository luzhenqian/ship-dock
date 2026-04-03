'use client';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const statusColors: Record<string, string> = { ACTIVE: 'bg-green-500', STOPPED: 'bg-gray-400', ERROR: 'bg-red-500' };

export function ProjectCard({ project }: { project: any }) {
  const lastDeploy = project.deployments?.[0];
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-medium">{project.name}</CardTitle>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusColors[project.status] || 'bg-gray-400'}`} />
            <span className="text-sm text-muted-foreground">{project.status}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-muted-foreground">
            {project.domain && <p>{project.domain}</p>}
            {lastDeploy ? (
              <p>Deploy #{lastDeploy.version} <Badge variant={lastDeploy.status === 'SUCCESS' ? 'default' : 'destructive'} className="text-xs">{lastDeploy.status}</Badge> {new Date(lastDeploy.createdAt).toLocaleDateString()}</p>
            ) : <p>No deployments yet</p>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
