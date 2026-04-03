'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useProject, useDeleteProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnvVarEditor } from '@/components/env-var-editor';

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const { data: project } = useProject(projectId);
  const deleteProject = useDeleteProject();
  const [domain, setDomain] = useState('');
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) setDomain(project.domain || '');
  }, [project]);

  async function handleSave() {
    setSaving(true);
    await api(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        domain: domain || undefined,
        envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      }),
    });
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm('Are you sure?')) return;
    await deleteProject.mutateAsync(projectId);
    router.push('/dashboard');
  }

  if (!project) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Project Settings</h2>
      <Card>
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Name</Label><Input value={project.name} disabled /></div>
          <div><Label>Slug</Label><Input value={project.slug} disabled className="font-mono" /></div>
          <div><Label>Port</Label><Input value={project.port} disabled /></div>
          <div><Label>Domain</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" /></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Environment Variables</CardTitle></CardHeader>
        <CardContent><EnvVarEditor value={envVars} onChange={setEnvVars} /></CardContent>
      </Card>
      <div className="flex justify-between">
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        <Button variant="destructive" onClick={handleDelete}>Delete Project</Button>
      </div>
    </div>
  );
}
