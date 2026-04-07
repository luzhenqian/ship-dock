'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useImport, useStartImport, useCancelImport } from '@/hooks/use-imports';
import { useImportProgress } from '@/hooks/use-import-progress';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react';

export default function ExecutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: importData, refetch } = useImport(id);
  const startImport = useStartImport(id);
  const cancelImport = useCancelImport(id);
  const { logs, progress, onComplete } = useImportProgress(id);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-start import
  useEffect(() => {
    if (importData && importData.status === 'CONFIGURING' && !started) {
      setStarted(true);
      startImport.mutateAsync().catch(() => {});
    }
  }, [importData, started]);

  // Listen for completion
  onComplete(() => {
    setDone(true);
    refetch();
  });

  // Check if already done
  useEffect(() => {
    if (importData && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(importData.status)) {
      setDone(true);
    }
  }, [importData]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function getStageIcon(status: string) {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle2 className="size-3.5 text-green-500" />;
      case 'FAILED':
        return <XCircle className="size-3.5 text-destructive" />;
      case 'RUNNING':
        return <Loader2 className="size-3.5 animate-spin text-foreground" />;
      default:
        return <Circle className="size-3.5 text-muted-foreground" />;
    }
  }

  function getItemStatus(item: { id: string; status: string; stages: any[] }) {
    // Prefer real-time progress data
    const wsStages = progress.get(item.id);
    if (wsStages && wsStages.length > 0) {
      const hasRunning = wsStages.some((s) => s.status === 'RUNNING');
      const hasFailed = wsStages.some((s) => s.status === 'FAILED');
      if (hasFailed) return 'FAILED';
      if (hasRunning) return 'RUNNING';
      const allComplete = wsStages.every((s) => s.status === 'COMPLETED');
      if (allComplete) return 'COMPLETED';
    }
    return item.status;
  }

  const items = importData?.items ?? [];
  const overallStatus = importData?.status ?? 'PENDING';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Importing Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {done
              ? overallStatus === 'COMPLETED'
                ? 'Import completed successfully.'
                : overallStatus === 'FAILED'
                  ? 'Import finished with errors.'
                  : 'Import was cancelled.'
              : 'Import in progress...'}
          </p>
        </div>
        <div className="flex gap-2">
          {!done && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancelImport.mutateAsync()}
              disabled={cancelImport.isPending}
            >
              Cancel
            </Button>
          )}
          {done && (
            <Link href="/dashboard">
              <Button>Go to Dashboard</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-4 max-w-3xl">
        {/* Project progress cards */}
        {items.map((item) => {
          const itemStatus = getItemStatus(item);
          const wsStages = progress.get(item.id);
          const stages = wsStages && wsStages.length > 0
            ? wsStages
            : (item.stages || []).map((s: any) => ({
                itemId: item.id,
                stage: s.name,
                status: s.status,
                error: s.error,
              }));

          return (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {getStageIcon(itemStatus)}
                    {item.sourceName}
                  </CardTitle>
                  <Badge
                    variant={
                      itemStatus === 'COMPLETED'
                        ? 'secondary'
                        : itemStatus === 'FAILED'
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {itemStatus}
                  </Badge>
                </div>
              </CardHeader>
              {stages.length > 0 && (
                <CardContent>
                  <div className="space-y-2">
                    {stages.map((stage: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        {getStageIcon(stage.status)}
                        <span className={stage.status === 'RUNNING' ? 'font-medium' : 'text-muted-foreground'}>
                          {stage.stage || stage.name}
                        </span>
                        {stage.error && (
                          <span className="text-xs text-destructive ml-2">{stage.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
              {item.errorMessage && (
                <CardContent>
                  <p className="text-xs text-destructive">{item.errorMessage}</p>
                </CardContent>
              )}
            </Card>
          );
        })}

        {/* Logs panel */}
        {logs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-0.5 font-mono text-xs">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`py-0.5 ${
                        log.level === 'error'
                          ? 'text-destructive'
                          : log.level === 'warn'
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      <span className="opacity-50">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>{' '}
                      {log.message}
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
