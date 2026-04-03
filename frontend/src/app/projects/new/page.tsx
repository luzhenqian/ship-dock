'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProject } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EnvVarEditor } from '@/components/env-var-editor';

type Step = 'source' | 'basic' | 'env' | 'confirm';

export default function NewProjectPage() {
  const router = useRouter();
  const createProject = useCreateProject();
  const [step, setStep] = useState<Step>('source');
  const [form, setForm] = useState({
    sourceType: '' as 'GITHUB' | 'UPLOAD' | '',
    repoUrl: '',
    branch: 'main',
    name: '',
    slug: '',
    domain: '',
    port: '',
    envVars: {} as Record<string, string>,
  });

  function update(p: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function handleCreate() {
    await createProject.mutateAsync({
      name: form.name,
      slug: form.slug,
      sourceType: form.sourceType,
      repoUrl: form.sourceType === 'GITHUB' ? form.repoUrl : undefined,
      branch: form.branch,
      domain: form.domain || undefined,
      port: form.port ? parseInt(form.port) : undefined,
      envVars: Object.keys(form.envVars).length > 0 ? form.envVars : undefined,
    });
    router.push('/dashboard');
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
      {step === 'source' && (
        <Card>
          <CardHeader><CardTitle>Step 1: Source</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Button variant={form.sourceType === 'GITHUB' ? 'default' : 'outline'} className="h-24" onClick={() => update({ sourceType: 'GITHUB' })}>GitHub Repository</Button>
              <Button variant={form.sourceType === 'UPLOAD' ? 'default' : 'outline'} className="h-24" onClick={() => update({ sourceType: 'UPLOAD' })}>Upload Files</Button>
            </div>
            {form.sourceType === 'GITHUB' && (
              <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input placeholder="https://github.com/user/repo" value={form.repoUrl} onChange={(e) => update({ repoUrl: e.target.value })} />
                <Label>Branch</Label>
                <Input value={form.branch} onChange={(e) => update({ branch: e.target.value })} />
              </div>
            )}
            <Button onClick={() => setStep('basic')} disabled={!form.sourceType}>Next</Button>
          </CardContent>
        </Card>
      )}
      {step === 'basic' && (
        <Card>
          <CardHeader><CardTitle>Step 2: Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Project Name</Label><Input value={form.name} onChange={(e) => update({ name: e.target.value, slug: autoSlug(e.target.value) })} /></div>
            <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => update({ slug: e.target.value })} className="font-mono" /><p className="text-xs text-muted-foreground mt-1">Used for directory name and PM2 process</p></div>
            <div><Label>Domain (optional)</Label><Input placeholder="app.example.com" value={form.domain} onChange={(e) => update({ domain: e.target.value })} /></div>
            <div><Label>Port (optional, auto-assigned if empty)</Label><Input type="number" placeholder="3001-3999" value={form.port} onChange={(e) => update({ port: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('source')}>Back</Button>
              <Button onClick={() => setStep('env')} disabled={!form.name || !form.slug}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {step === 'env' && (
        <Card>
          <CardHeader><CardTitle>Step 3: Environment Variables</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <EnvVarEditor value={form.envVars} onChange={(envVars) => update({ envVars })} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('basic')}>Back</Button>
              <Button onClick={() => setStep('confirm')}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {step === 'confirm' && (
        <Card>
          <CardHeader><CardTitle>Step 4: Confirm</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <p><strong>Source:</strong> {form.sourceType} {form.repoUrl && `(${form.repoUrl})`}</p>
              <p><strong>Name:</strong> {form.name}</p>
              <p><strong>Slug:</strong> {form.slug}</p>
              {form.domain && <p><strong>Domain:</strong> {form.domain}</p>}
              {form.port && <p><strong>Port:</strong> {form.port}</p>}
              {Object.keys(form.envVars).length > 0 && <p><strong>Env vars:</strong> {Object.keys(form.envVars).length} variables</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('env')}>Back</Button>
              <Button onClick={handleCreate} disabled={createProject.isPending}>{createProject.isPending ? 'Creating...' : 'Create & Deploy'}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
