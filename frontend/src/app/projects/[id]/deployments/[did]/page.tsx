'use client';
import { use, useState } from 'react';
import { useDeployment, useCancelDeploy } from '@/hooks/use-deployments';
import { useDeployLogs } from '@/hooks/use-deploy-logs';
import { StageProgress } from '@/components/stage-progress';
import { DeployLogViewer } from '@/components/deploy-log-viewer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id: projectId, did: deploymentId } = use(params);
  const { data: deployment } = useDeployment(deploymentId);
  const { logs, stageStatuses } = useDeployLogs(deploymentId);
  const cancelDeploy = useCancelDeploy();
  const [activeStage, setActiveStage] = useState(0);

  if (!deployment) return <p>Loading...</p>;

  const stages = (deployment.stages as any[]).map((s: any, i: number) => ({
    ...s,
    status: stageStatuses[i] || s.status,
  }));
  const isRunning = deployment.status === 'RUNNING' || deployment.status === 'QUEUED';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Deploy #{deployment.version}</h1>
          <Badge variant={deployment.status === 'SUCCESS' ? 'default' : deployment.status === 'FAILED' ? 'destructive' : 'secondary'}>{deployment.status}</Badge>
        </div>
        {isRunning && <Button variant="destructive" onClick={() => cancelDeploy.mutate(deploymentId)}>Cancel</Button>}
      </div>
      <div className="grid grid-cols-[250px_1fr] gap-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Stages</h3>
          <StageProgress stages={stages} activeIndex={activeStage} onStageClick={setActiveStage} />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Output</h3>
          <DeployLogViewer logs={logs} />
        </div>
      </div>
    </div>
  );
}
