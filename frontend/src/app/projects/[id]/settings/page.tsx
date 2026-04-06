'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProject, useDeleteProject } from '@/hooks/use-projects';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnvVarEditor } from '@/components/env-var-editor';
import { useServices, useCreateService, useDeleteService, useDetectServices, useTestService } from '@/hooks/use-services';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { RepoSelector } from '@/components/repo-selector';
import { ExternalLink } from 'lucide-react';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: project, refetch } = useProject(projectId);
  const deleteProject = useDeleteProject();
  const { data: settings } = useQuery({
    queryKey: ['projects-dir'],
    queryFn: () => api<{ projectsDir: string }>('/projects/settings/projects-dir'),
  });

  const { data: savedEnvVars } = useQuery({
    queryKey: ['env-vars', projectId],
    queryFn: () => api<Record<string, string>>(`/projects/${projectId}/env`),
  });

  const [domain, setDomain] = useState('');
  const [directory, setDirectory] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [startCommand, setStartCommand] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [newService, setNewService] = useState({ type: 'POSTGRESQL', name: '', config: '' });
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [provisioning, setProvisioning] = useState(false);
  const [showDbDeleteConfirm, setShowDbDeleteConfirm] = useState(false);
  const [dbDeleting, setDbDeleting] = useState(false);
  const [dbExporting, setDbExporting] = useState(false);
  const [showRepoConnect, setShowRepoConnect] = useState(false);
  const [repoMode, setRepoMode] = useState<'select' | 'manual'>('select');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('main');
  const [repoConnecting, setRepoConnecting] = useState(false);
  const [showRepoDisconnect, setShowRepoDisconnect] = useState(false);

  const { data: services, refetch: refetchServices } = useServices(projectId);
  const createService = useCreateService(projectId);
  const deleteService = useDeleteService(projectId);
  const detectServices = useDetectServices(projectId);
  const testService = useTestService(projectId);

  useEffect(() => {
    if (project) {
      setDomain(project.domain || '');
      setDirectory(project.directory || project.slug || '');
      setWorkDir(project.workDir || '');
      setStartCommand(project.startCommand || '');
    }
  }, [project]);

  useEffect(() => {
    if (savedEnvVars && Object.keys(envVars).length === 0) {
      setEnvVars(savedEnvVars);
    }
  }, [savedEnvVars]);

  async function handleSave() {
    setSaving(true);
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        domain: domain || undefined,
        directory: directory || undefined,
        workDir: workDir || null,
        startCommand: startCommand || null,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      }),
    });
    setSaving(false);
    refetch();
    toast.success('Settings saved', {
      description: 'Redeploy to apply the changes to your running service.',
      action: {
        label: 'Redeploy',
        onClick: async () => {
          try {
            await api(`/projects/${projectId}/deployments`, { method: 'POST' });
            toast.success('Deployment started');
            router.push(`/projects/${projectId}/deployments`);
          } catch (err: any) {
            toast.error(`Deploy failed: ${err.message}`);
          }
        },
      },
      duration: 10000,
    });
  }

  async function handleDelete() {
    if (!confirm('Are you sure? This will stop the PM2 process and remove nginx config.')) return;
    await deleteProject.mutateAsync(projectId);
    router.push('/dashboard');
  }

  if (!project) return <p>Loading...</p>;

  const projectsDir = settings?.projectsDir || '/var/www';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={project.name} disabled />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={project.slug} disabled className="font-mono" />
          </div>
          <div>
            <Label>Port</Label>
            <Input value={project.port} disabled />
          </div>
          <div>
            <Label>Domain</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Repository</CardTitle></CardHeader>
        <CardContent>
          {project.sourceType === 'GITHUB' && project.repoUrl ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitHubIcon className="h-5 w-5" />
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline inline-flex items-center gap-1"
                >
                  {project.repoUrl.replace('https://github.com/', '')}
                  <ExternalLink className="h-3 w-3" />
                </a>
                {project.branch && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground font-mono">
                    {project.branch}
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                onClick={() => setShowRepoDisconnect(true)}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connect a GitHub repository to enable git-based deployments.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRepoMode('select');
                  setRepoUrl('');
                  setRepoBranch('main');
                  setShowRepoConnect(true);
                }}
              >
                <GitHubIcon className="h-4 w-4 mr-1.5" />
                Connect Repository
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Project Directory</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Deploy path on server</Label>
          <div className="flex items-center gap-0">
            <span className="inline-flex items-center shrink-0 px-3 h-9 rounded-l-md border border-r-0 bg-muted text-sm text-muted-foreground font-mono whitespace-nowrap">
              {projectsDir}/
            </span>
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="rounded-l-none font-mono min-w-0"
              placeholder={project.slug}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Full path: <code className="bg-muted px-1 rounded">{projectsDir}/{directory || project.slug}</code>
            {directory !== project.slug && <span className="ml-2 text-yellow-600">(custom)</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            Directory will be created automatically if it doesn&apos;t exist.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Working Directory</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Subdirectory for running commands</Label>
          <Input
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            className="font-mono"
            placeholder="e.g. apps/web"
          />
          <p className="text-xs text-muted-foreground">
            For monorepos: commands like <code className="bg-muted px-1 rounded">npm install</code>, <code className="bg-muted px-1 rounded">npm run build</code> will run inside this subdirectory.
            Leave empty to use the project root.
          </p>
          {workDir && (
            <p className="text-xs text-muted-foreground">
              Commands will run in: <code className="bg-muted px-1 rounded">{projectsDir}/{directory || project.slug}/{workDir}</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Start Command</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Label>Custom PM2 start script</Label>
          <Input
            value={startCommand}
            onChange={(e) => setStartCommand(e.target.value)}
            className="font-mono"
            placeholder="e.g. dist/src/main.js"
          />
          <p className="text-xs text-muted-foreground">
            The entry file for PM2 to run. Leave empty to auto-detect from <code className="bg-muted px-1 rounded">package.json</code> (uses <code className="bg-muted px-1 rounded">npm start</code> or <code className="bg-muted px-1 rounded">dist/main.js</code>).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Database</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {project.useLocalDb ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Active</span>
                <span className="text-sm">Platform PostgreSQL</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{project.dbName}</code>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={dbExporting}
                  onClick={async () => {
                    setDbExporting(true);
                    try {
                      const res = await fetch(
                        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/projects/${projectId}/export-database`,
                        { headers: { Authorization: `Bearer ${(await import('@/lib/api')).getAccessToken()}` } },
                      );
                      if (!res.ok) throw new Error('Export failed');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${project.dbName}-export.sql`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success('Database exported');
                    } catch (err: any) {
                      toast.error(`Export failed: ${err.message}`);
                    } finally {
                      setDbExporting(false);
                    }
                  }}
                >
                  {dbExporting ? 'Exporting...' : 'Export SQL'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={dbDeleting}
                  onClick={() => setShowDbDeleteConfirm(true)}
                >
                  Disable & Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Enable platform database to auto-create a PostgreSQL database and inject <code className="bg-muted px-1 rounded">DATABASE_URL</code> into environment variables.
              </p>
              <Button
                size="sm"
                disabled={provisioning}
                onClick={async () => {
                  setProvisioning(true);
                  try {
                    await api(`/projects/${projectId}/provision-database`, { method: 'POST' });
                    toast.success('Database created', { description: 'DATABASE_URL has been added to your environment variables. Redeploy to apply.' });
                    refetch();
                    const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
                    setEnvVars(newEnv);
                  } catch (err: any) {
                    toast.error(`Failed: ${err.message}`);
                  } finally {
                    setProvisioning(false);
                  }
                }}
              >
                {provisioning ? 'Creating...' : 'Enable Platform Database'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Environment Variables</CardTitle></CardHeader>
        <CardContent>
          <EnvVarEditor value={envVars} onChange={setEnvVars} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Services</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => detectServices.mutate(undefined, {
                  onSuccess: (data) => {
                    refetchServices();
                    toast.success(data.length > 0 ? `Detected ${data.length} service(s)` : 'No new services detected');
                  },
                })}
                disabled={detectServices.isPending}
              >
                {detectServices.isPending ? 'Detecting...' : 'Auto Detect'}
              </Button>
              <Button size="sm" onClick={() => setShowAddService(true)}>+ Add Service</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Configure connections to your project&apos;s PostgreSQL, Redis, and MinIO services. Use &quot;Auto Detect&quot; to discover connections from environment variables.
          </p>
          {(!services || services.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
              No services configured. Click &quot;Auto Detect&quot; or &quot;+ Add Service&quot; to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {services.map((svc: any) => (
                <div key={svc.id} className="flex items-center justify-between p-3 border rounded-md">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      svc.type === 'POSTGRESQL' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                      svc.type === 'REDIS' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                      'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    }`}>
                      {svc.type}
                    </span>
                    <span className="text-sm font-medium">{svc.name}</span>
                    {svc.autoDetected && <span className="text-xs text-muted-foreground">(auto)</span>}
                    {testResults[svc.id] && (
                      <span className={`text-xs ${testResults[svc.id].success ? 'text-green-600' : 'text-red-600'}`}>
                        {testResults[svc.id].success ? '✓ Connected' : `✗ ${testResults[svc.id].message}`}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testService.mutate(svc.id, {
                        onSuccess: (result) => setTestResults((prev) => ({ ...prev, [svc.id]: result })),
                      })}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (confirm(`Delete "${svc.name}"?`)) {
                          deleteService.mutate(svc.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddService} onOpenChange={setShowAddService}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service Connection</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Type</Label>
              <select
                value={newService.type}
                onChange={(e) => setNewService({ ...newService, type: e.target.value })}
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="POSTGRESQL">PostgreSQL</option>
                <option value="REDIS">Redis</option>
                <option value="MINIO">MinIO</option>
              </select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={newService.name}
                onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                placeholder="e.g. Main Database"
              />
            </div>
            <div>
              <Label>Config (JSON)</Label>
              <textarea
                value={newService.config}
                onChange={(e) => setNewService({ ...newService, config: e.target.value })}
                placeholder={
                  newService.type === 'POSTGRESQL'
                    ? '{"host":"localhost","port":5432,"database":"mydb","user":"postgres","password":"xxx"}'
                    : newService.type === 'REDIS'
                    ? '{"host":"localhost","port":6379,"password":"","db":0}'
                    : '{"endPoint":"localhost","port":9000,"accessKey":"xxx","secretKey":"xxx","useSSL":false}'
                }
                className="w-full h-24 p-2 font-mono text-xs border rounded-md bg-background resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddService(false)}>Cancel</Button>
            <Button
              disabled={!newService.name || !newService.config || createService.isPending}
              onClick={() => {
                let config: Record<string, any>;
                try { config = JSON.parse(newService.config); } catch { toast.error('Invalid JSON'); return; }
                createService.mutate(
                  { type: newService.type, name: newService.name, config },
                  {
                    onSuccess: () => {
                      setShowAddService(false);
                      setNewService({ type: 'POSTGRESQL', name: '', config: '' });
                      toast.success('Service added');
                    },
                    onError: (err: any) => toast.error(err.message),
                  },
                );
              }}
            >
              {createService.isPending ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-between items-center pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <Card className="border-status-error/30">
        <CardHeader>
          <CardTitle className="text-status-error">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-foreground-secondary mb-4">
            Permanently delete this project. This will stop the process and remove all configuration.
          </p>
          <Button variant="destructive" onClick={handleDelete}>Delete Project</Button>
        </CardContent>
      </Card>

      <Dialog open={showRepoConnect} onOpenChange={setShowRepoConnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Repository</DialogTitle>
          </DialogHeader>
          {repoMode === 'select' && !repoUrl ? (
            <RepoSelector
              onSelect={(url, defaultBranch) => {
                setRepoUrl(url);
                setRepoBranch(defaultBranch);
              }}
              onSwitchToManual={() => setRepoMode('manual')}
            />
          ) : repoMode === 'manual' && !repoUrl ? (
            <div className="space-y-3">
              <div>
                <Label>Repository URL</Label>
                <Input
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Repository</Label>
                <Input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="font-mono"
                  placeholder="https://github.com/owner/repo"
                />
              </div>
              <div>
                <Label>Branch</Label>
                <Input
                  value={repoBranch}
                  onChange={(e) => setRepoBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRepoConnect(false)}>Cancel</Button>
            {(repoMode === 'manual' && !repoUrl) ? (
              <Button disabled>Connect</Button>
            ) : repoUrl ? (
              <Button
                disabled={!repoUrl || repoConnecting}
                onClick={async () => {
                  setRepoConnecting(true);
                  try {
                    await api(`/projects/${projectId}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ repoUrl, branch: repoBranch || 'main' }),
                    });
                    toast.success('Repository connected', {
                      description: 'Redeploy to pull from GitHub.',
                    });
                    setShowRepoConnect(false);
                    refetch();
                  } catch (err: any) {
                    toast.error(`Failed: ${err.message}`);
                  } finally {
                    setRepoConnecting(false);
                  }
                }}
              >
                {repoConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showRepoDisconnect}
        onOpenChange={setShowRepoDisconnect}
        title="Disconnect repository"
        description="This will disconnect the GitHub repository. The project will switch back to file upload mode and any configured webhook will be removed."
        onConfirm={async () => {
          try {
            await api(`/projects/${projectId}`, {
              method: 'PATCH',
              body: JSON.stringify({ repoUrl: '' }),
            });
            toast.success('Repository disconnected');
            refetch();
          } catch (err: any) {
            toast.error(`Failed: ${err.message}`);
          }
        }}
        destructive
      />

      <ConfirmDialog
        open={showDbDeleteConfirm}
        onOpenChange={setShowDbDeleteConfirm}
        title="Delete platform database"
        description={`This will permanently delete the database "${project.dbName}" and all its data. This action cannot be undone. Consider exporting your data first.`}
        onConfirm={async () => {
          setDbDeleting(true);
          try {
            await api(`/projects/${projectId}/provision-database`, { method: 'DELETE' });
            toast.success('Database deleted', { description: 'DATABASE_URL has been removed from environment variables.' });
            refetch();
            const newEnv = await api<Record<string, string>>(`/projects/${projectId}/env`);
            setEnvVars(newEnv);
          } catch (err: any) {
            toast.error(`Failed: ${err.message}`);
          } finally {
            setDbDeleting(false);
          }
        }}
        destructive
      />
    </div>
  );
}
