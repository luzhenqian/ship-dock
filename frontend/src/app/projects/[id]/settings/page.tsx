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
            <span className="inline-flex items-center px-3 h-9 rounded-l-md border border-r-0 bg-muted text-sm text-muted-foreground font-mono">
              {projectsDir}/
            </span>
            <Input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="rounded-l-none font-mono"
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

      <div className="flex justify-between items-center">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="destructive" onClick={handleDelete}>Delete Project</Button>
      </div>
    </div>
  );
}
