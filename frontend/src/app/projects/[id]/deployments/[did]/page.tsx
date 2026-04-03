'use client';
import { use, useMemo, useState } from 'react';
import { useDeployment, useCancelDeploy } from '@/hooks/use-deployments';
import { useDeployLogs } from '@/hooks/use-deploy-logs';
import { StageProgress } from '@/components/stage-progress';
import { DeployLogViewer } from '@/components/deploy-log-viewer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id: projectId, did: deploymentId } = use(params);
  const { data: deployment } = useDeployment(deploymentId);
  const { logs: realtimeLogs, stageStatuses } = useDeployLogs(deploymentId);
  const cancelDeploy = useCancelDeploy();
  const [activeStage, setActiveStage] = useState(0);

  // Merge persisted logs from DB with realtime logs from WebSocket
  const persistedLogs = useMemo(() => {
    if (!deployment?.stages) return [];
    const logs: Array<{ stage: string; line: string }> = [];
    for (const stage of deployment.stages as any[]) {
      if (stage.logs && Array.isArray(stage.logs)) {
        for (const line of stage.logs) {
          logs.push({ stage: stage.name, line });
        }
      }
    }
    return logs;
  }, [deployment?.stages]);

  // Realtime logs append after persisted ones; deduplicate by only showing
  // realtime logs that arrived after the persisted count
  const allLogs = useMemo(() => {
    if (realtimeLogs.length === 0) return persistedLogs;
    if (persistedLogs.length === 0) return realtimeLogs;
    // If we have both, persisted logs are the source of truth for history,
    // realtime logs may overlap — show persisted + any realtime beyond that count
    return [...persistedLogs, ...realtimeLogs.slice(persistedLogs.length)];
  }, [persistedLogs, realtimeLogs]);

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
      <div className="grid grid-cols-[220px_1fr] gap-6 min-w-0">
        <div className="min-w-0">
          <h3 className="text-sm font-medium mb-2">Stages</h3>
          <StageProgress stages={stages} activeIndex={activeStage} onStageClick={setActiveStage} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium mb-2">Output</h3>
          <DeployLogViewer logs={allLogs} />
        </div>
      </div>
    </div>
  );
}
