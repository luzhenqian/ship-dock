'use client';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  useWebhookConfig, useCreateWebhook, useUpdateWebhook, useDeleteWebhook,
  useRegenerateSecret, useWebhookEvents, useReplayWebhookEvent,
} from '@/hooks/use-webhooks';
import { useProject } from '@/hooks/use-projects';
import { GitBranch } from 'lucide-react';

const EVENT_OPTIONS = ['push', 'pull_request', 'release', 'create', 'delete'];

const statusBadgeColor: Record<string, string> = {
  TRIGGERED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  FILTERED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  RECEIVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  REPLAYED: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
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

export default function WebhooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const isAppConnected = !!(project as any)?.githubInstallationId;
  const { data: config, isLoading, error } = useWebhookConfig(projectId);
  const createWebhook = useCreateWebhook(projectId);
  const updateWebhook = useUpdateWebhook(projectId);
  const deleteWebhook = useDeleteWebhook(projectId);
  const regenerateSecret = useRegenerateSecret(projectId);
  const replayEvent = useReplayWebhookEvent(projectId);

  const [showSetup, setShowSetup] = useState(false);
  const [showSecret, setShowSecret] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [eventsPage, setEventsPage] = useState(1);

  const { data: eventsData } = useWebhookEvents(projectId, statusFilter || undefined, eventsPage);

  const [form, setForm] = useState({
    githubToken: '',
    events: ['push'] as string[],
    branchFilters: '',
    pathFilters: '',
    secret: '',
  });

  const hasConfig = !!config && !error;

  function handleToggleEvent(event: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter((e) => e !== event)
        : [...f.events, event],
    }));
  }

  async function handleCreate() {
    try {
      const result = await createWebhook.mutateAsync({
        githubToken: form.githubToken,
        events: form.events,
        branchFilters: form.branchFilters ? form.branchFilters.split(',').map((s) => s.trim()) : undefined,
        pathFilters: form.pathFilters ? form.pathFilters.split(',').map((s) => s.trim()) : undefined,
        secret: form.secret || undefined,
      });
      setShowSetup(false);
      setShowSecret(result.secret);
      toast.success('Webhook configured');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete webhook? This will also unregister it from GitHub.')) return;
    try {
      await deleteWebhook.mutateAsync();
      toast.success('Webhook deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleRegenerateSecret() {
    if (!confirm('Regenerate secret? The old secret will stop working immediately.')) return;
    try {
      const result = await regenerateSecret.mutateAsync();
      setShowSecret(result.secret);
      toast.success('Secret regenerated');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleToggleEnabled() {
    if (!config) return;
    try {
      await updateWebhook.mutateAsync({ enabled: !config.enabled });
      toast.success(config.enabled ? 'Webhook disabled' : 'Webhook enabled');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (isLoading) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      {/* Configuration */}
      {!hasConfig ? (
        isAppConnected ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-6">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Webhooks automatically configured via GitHub App</p>
                <p className="text-sm text-muted-foreground">
                  Push events from your repository will automatically trigger deployments.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-foreground-secondary mb-4">No webhook configured for this project.</p>
              <p className="text-sm text-muted-foreground mb-6">
                Configure a GitHub webhook to automatically deploy when you push code.
              </p>
              <Button onClick={() => setShowSetup(true)}>Configure Webhook</Button>
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Webhook Configuration</CardTitle>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleEnabled}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    config.enabled ? 'bg-green-500' : 'bg-foreground-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      config.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
                <span className="text-sm text-foreground-secondary">
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input value={config.webhookUrl} disabled className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { navigator.clipboard.writeText(config.webhookUrl); toast.success('Copied'); }}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <Label>Events</Label>
              <div className="flex gap-1.5 mt-1">
                {(config.events as string[]).map((e) => (
                  <span key={e} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground-secondary">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            {(config.branchFilters as string[]).length > 0 && (
              <div>
                <Label>Branch Filters</Label>
                <p className="text-sm text-foreground-secondary font-mono">{(config.branchFilters as string[]).join(', ')}</p>
              </div>
            )}
            {(config.pathFilters as string[]).length > 0 && (
              <div>
                <Label>Path Filters</Label>
                <p className="text-sm text-foreground-secondary font-mono">{(config.pathFilters as string[]).join(', ')}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleRegenerateSecret}>Regenerate Secret</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>Delete Webhook</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Dialog */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configure Webhook</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>GitHub Personal Access Token</Label>
              <Input
                type="password"
                value={form.githubToken}
                onChange={(e) => setForm({ ...form, githubToken: e.target.value })}
                placeholder="ghp_..."
              />
              <p className="text-xs text-muted-foreground mt-1">Needs repo/admin:repo_hook permissions.</p>
            </div>
            <div>
              <Label>Events</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {EVENT_OPTIONS.map((event) => (
                  <label key={event} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.events.includes(event)}
                      onChange={() => handleToggleEvent(event)}
                      className="rounded"
                    />
                    {event}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Branch Filters (comma-separated, glob patterns)</Label>
              <Input
                value={form.branchFilters}
                onChange={(e) => setForm({ ...form, branchFilters: e.target.value })}
                placeholder="main, release/*"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Path Filters (comma-separated, glob patterns)</Label>
              <Input
                value={form.pathFilters}
                onChange={(e) => setForm({ ...form, pathFilters: e.target.value })}
                placeholder="src/**, package.json"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Secret (optional, auto-generated if empty)</Label>
              <Input
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="Leave empty to auto-generate"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetup(false)}>Cancel</Button>
            <Button
              disabled={!form.githubToken || form.events.length === 0 || createWebhook.isPending}
              onClick={handleCreate}
            >
              {createWebhook.isPending ? 'Configuring...' : 'Configure'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret Display Dialog */}
      <Dialog open={!!showSecret} onOpenChange={() => setShowSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Webhook Secret</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-foreground-secondary">
              Save this secret now. It will not be shown again.
            </p>
            <div className="flex gap-2">
              <Input value={showSecret || ''} disabled className="font-mono text-xs" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => { navigator.clipboard.writeText(showSecret || ''); toast.success('Copied'); }}
              >
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit Log */}
      {hasConfig && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Webhook Events</CardTitle>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setEventsPage(1); }}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">All statuses</option>
                <option value="TRIGGERED">Triggered</option>
                <option value="FILTERED">Filtered</option>
                <option value="FAILED">Failed</option>
                <option value="REPLAYED">Replayed</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {!eventsData || eventsData.events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No webhook events yet.</p>
            ) : (
              <div className="space-y-1">
                {eventsData.events.map((evt) => (
                  <div key={evt.id}>
                    <button
                      onClick={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-md hover:bg-muted/50 text-left transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-16">{timeAgo(evt.createdAt)}</span>
                        <span className="text-sm font-mono">{evt.event}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${statusBadgeColor[evt.status] || 'bg-muted text-foreground-secondary'}`}>
                          {evt.status}
                        </span>
                      </div>
                      {evt.deployment && (
                        <span className="text-xs text-foreground-secondary">Deploy #{evt.deployment.version}</span>
                      )}
                    </button>
                    {expandedEvent === evt.id && (
                      <div className="ml-4 p-3 mb-2 border rounded-md bg-muted/30 space-y-2 text-sm">
                        {evt.filterReason && (
                          <div><span className="text-muted-foreground">Filter reason:</span> <span className="text-yellow-600">{evt.filterReason}</span></div>
                        )}
                        {evt.error && (
                          <div><span className="text-muted-foreground">Error:</span> <span className="text-red-600">{evt.error}</span></div>
                        )}
                        <details>
                          <summary className="text-xs text-muted-foreground cursor-pointer">Payload</summary>
                          <pre className="text-xs font-mono mt-1 p-2 bg-muted rounded overflow-x-auto max-h-60">
                            {JSON.stringify(evt.payload, null, 2)}
                          </pre>
                        </details>
                        <details>
                          <summary className="text-xs text-muted-foreground cursor-pointer">Headers</summary>
                          <pre className="text-xs font-mono mt-1 p-2 bg-muted rounded overflow-x-auto max-h-40">
                            {JSON.stringify(evt.headers, null, 2)}
                          </pre>
                        </details>
                        {(evt.status === 'FAILED' || evt.status === 'FILTERED') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => replayEvent.mutate(evt.id, {
                              onSuccess: () => toast.success('Event replayed'),
                              onError: (err: any) => toast.error(err.message),
                            })}
                            disabled={replayEvent.isPending}
                          >
                            Replay
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {eventsData.total > eventsData.limit && (
                  <div className="flex justify-center gap-2 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={eventsPage <= 1}
                      onClick={() => setEventsPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground py-1">
                      Page {eventsPage} of {Math.ceil(eventsData.total / eventsData.limit)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={eventsPage >= Math.ceil(eventsData.total / eventsData.limit)}
                      onClick={() => setEventsPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
