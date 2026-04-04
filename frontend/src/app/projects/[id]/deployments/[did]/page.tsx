'use client';

import { use, useMemo, useState } from 'react';
import { useDeployment, useCancelDeploy } from '@/hooks/use-deployments';
import { useDeployLogs } from '@/hooks/use-deploy-logs';
import { StageProgress } from '@/components/stage-progress';
import { DeployLogViewer } from '@/components/deploy-log-viewer';
import { Button } from '@/components/ui/button';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  FAILED: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
  RUNNING: 'bg-status-building shadow-[0_0_6px_rgba(245,166,35,0.4)]',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
};

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id: projectId, did: deploymentId } = use(params);
  const { data: deployment } = useDeployment(deploymentId);
  const { logs: realtimeLogs, stageStatuses } = useDeployLogs(deploymentId);
  const cancelDeploy = useCancelDeploy();
  const [activeStage, setActiveStage] = useState(0);

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

  const allLogs = useMemo(() => {
    if (realtimeLogs.length === 0) return persistedLogs;
    if (persistedLogs.length === 0) return realtimeLogs;
    return [...persistedLogs, ...realtimeLogs.slice(persistedLogs.length)];
  }, [persistedLogs, realtimeLogs]);

  if (!deployment) return <p className="text-foreground-secondary">Loading...</p>;

  const stages = (deployment.stages as any[]).map((s: any, i: number) => ({
    ...s,
    status: stageStatuses[i] || s.status,
  }));
  const isRunning = deployment.status === 'RUNNING' || deployment.status === 'QUEUED';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium tracking-tight">Deploy #{deployment.version}</h1>
          <span className={`h-2 w-2 rounded-full ${statusDot[deployment.status] || 'bg-foreground-muted'}`} />
          <span className="text-[13px] text-foreground-secondary">{deployment.status.toLowerCase()}</span>
        </div>
        {isRunning && (
          <Button variant="destructive" onClick={() => cancelDeploy.mutate(deploymentId)}>
            Cancel
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[200px_1fr] gap-6 min-w-0">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground-secondary mb-3">Stages</h3>
          <StageProgress stages={stages} activeIndex={activeStage} onStageClick={setActiveStage} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground-secondary mb-3">Output</h3>
          <DeployLogViewer logs={allLogs} />
        </div>
      </div>
    </div>
  );
}
