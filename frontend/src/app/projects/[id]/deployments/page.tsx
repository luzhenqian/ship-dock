'use client';
import { use } from 'react';
import Link from 'next/link';
import { useDeployments, useTriggerDeploy } from '@/hooks/use-deployments';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: deployments, isLoading } = useDeployments(projectId);
  const triggerDeploy = useTriggerDeploy(projectId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Deployments</h2>
        <Button onClick={() => triggerDeploy.mutate()} disabled={triggerDeploy.isPending}>
          {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
        </Button>
      </div>
      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {deployments && deployments.length === 0 && (
        <div className="text-center py-16 border rounded-lg">
          <p className="text-muted-foreground mb-4">No deployments yet</p>
          <Button onClick={() => triggerDeploy.mutate()} disabled={triggerDeploy.isPending}>
            {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {deployments?.map((d: any) => (
          <Link key={d.id} href={`/projects/${projectId}/deployments/${d.id}`}
            className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-medium">#{d.version}</span>
              <Badge variant={d.status === 'SUCCESS' ? 'default' : d.status === 'FAILED' ? 'destructive' : 'secondary'}>{d.status}</Badge>
              {d.triggeredBy && <span className="text-sm text-muted-foreground">by {d.triggeredBy.name}</span>}
            </div>
            <span className="text-sm text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
