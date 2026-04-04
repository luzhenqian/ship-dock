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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

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
    </div>
  );
}
