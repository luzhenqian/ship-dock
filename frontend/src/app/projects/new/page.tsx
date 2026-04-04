'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
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
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const branchRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    sourceType: '' as 'GITHUB' | 'UPLOAD' | '',
    repoUrl: '',
    branch: '',
    name: '',
    slug: '',
    domain: '',
    port: '',
    useLocalDb: false,
    envVars: {} as Record<string, string>,
  });

  // Fetch branches when repoUrl changes (debounced)
  useEffect(() => {
    if (form.sourceType !== 'GITHUB' || !form.repoUrl) {
      setBranches([]);
      return;
    }
    const match = form.repoUrl.replace(/\.git$/, '').match(/github\.com\/[^/]+\/[^/]+/);
    if (!match) return;

    const timer = setTimeout(async () => {
      setBranchesLoading(true);
      try {
        const data = await api<{ branches: string[]; defaultBranch: string }>(
          `/projects/github/branches?repoUrl=${encodeURIComponent(form.repoUrl)}`
        );
        setBranches(data.branches);
        if (!form.branch || form.branch === '') {
          update({ branch: data.defaultBranch });
        }
      } catch {
        setBranches([]);
      } finally {
        setBranchesLoading(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [form.repoUrl, form.sourceType]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function update(p: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function repoNameFromUrl(url: string): string {
    try {
      const parts = url.replace(/\.git$/, '').split('/');
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  }

  function goToBasic() {
    if (form.sourceType === 'GITHUB' && form.repoUrl && !form.name) {
      const repoName = repoNameFromUrl(form.repoUrl);
      if (repoName) {
        update({ name: repoName, slug: autoSlug(repoName) });
      }
    }
    setStep('basic');
  }

  const filteredBranches = branches.filter((b) =>
    b.toLowerCase().includes(branchFilter.toLowerCase())
  );

  async function handleCreate() {
    await createProject.mutateAsync({
      name: form.name,
      slug: form.slug,
      sourceType: form.sourceType,
      repoUrl: form.sourceType === 'GITHUB' ? form.repoUrl : undefined,
      branch: form.branch,
      domain: form.domain || undefined,
      port: form.port ? parseInt(form.port) : undefined,
      useLocalDb: form.useLocalDb || undefined,
      envVars: Object.keys(form.envVars).length > 0 ? form.envVars : undefined,
    });
    router.push('/dashboard');
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-xl font-medium tracking-tight mb-6">New Project</h1>
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
                <div className="relative" ref={branchRef}>
                  <Input
                    value={branchDropdownOpen ? branchFilter : form.branch}
                    onChange={(e) => {
                      setBranchFilter(e.target.value);
                      update({ branch: e.target.value });
                      if (!branchDropdownOpen) setBranchDropdownOpen(true);
                    }}
                    onFocus={() => { setBranchDropdownOpen(true); setBranchFilter(form.branch); }}
                    placeholder={branchesLoading ? 'Loading branches...' : 'Select or type a branch'}
                    className="font-mono"
                  />
                  {branchDropdownOpen && filteredBranches.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto rounded-xl border bg-popover shadow-lg">
                      {filteredBranches.map((b) => (
                        <button
                          key={b}
                          className={`w-full px-3 py-2 text-left text-sm font-mono hover:bg-accent transition-colors ${b === form.branch ? 'bg-accent font-medium' : ''}`}
                          onClick={() => { update({ branch: b }); setBranchDropdownOpen(false); }}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
                  {branchesLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">loading...</div>
                  )}
                </div>
              </div>
            )}
            <Button onClick={goToBasic} disabled={!form.sourceType}>Next</Button>
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
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                role="switch"
                aria-checked={form.useLocalDb}
                onClick={() => update({ useLocalDb: !form.useLocalDb })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.useLocalDb ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform ${form.useLocalDb ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <div>
                <Label className="cursor-pointer" onClick={() => update({ useLocalDb: !form.useLocalDb })}>Use platform database</Label>
                <p className="text-xs text-muted-foreground">Auto-create a PostgreSQL database and inject DATABASE_URL</p>
              </div>
            </div>
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
              {form.useLocalDb && <p><strong>Database:</strong> Platform PostgreSQL (auto-provisioned)</p>}
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
