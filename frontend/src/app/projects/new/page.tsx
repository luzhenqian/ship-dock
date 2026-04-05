'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnvVarEditor } from '@/components/env-var-editor';
import { MigrationWizard } from '@/components/migration-wizard';
import { GitBranch, Upload, ChevronRight, Loader2, Check, Database, Globe, Terminal } from 'lucide-react';

type Step = 'source' | 'basic' | 'env' | 'confirm' | 'import';
const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: 'Import' },
  { key: 'basic', label: 'Configure' },
  { key: 'env', label: 'Environment' },
  { key: 'confirm', label: 'Deploy' },
];

/* ── Validation helpers ── */

function isValidGithubUrl(url: string) {
  return /^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(url.replace(/\.git$/, ''));
}

function isValidSlug(slug: string) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

function isValidDomain(domain: string) {
  return /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
}

function isValidPort(port: string) {
  const n = parseInt(port, 10);
  return Number.isInteger(n) && n >= 3001 && n <= 3999;
}

function getEnvVarErrors(envVars: Record<string, string>): string | null {
  const keys = Object.keys(envVars);
  for (const key of keys) {
    if (key.trim() === '') return 'Variable name cannot be empty';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `Invalid variable name: ${key}`;
  }
  const unique = new Set(keys);
  if (unique.size !== keys.length) return 'Duplicate variable names found';
  return null;
}

export default function NewProjectPage() {
  const router = useRouter();
  const createProject = useCreateProject();
  const [step, setStep] = useState<Step>('source');
  const [createdProjectId, setCreatedProjectId] = useState('');
  const [createError, setCreateError] = useState('');
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

  /* ── Per-step validation ── */

  const sourceErrors: Record<string, string> = {};
  if (form.sourceType === 'GITHUB') {
    if (!form.repoUrl) sourceErrors.repoUrl = 'Repository URL is required';
    else if (!isValidGithubUrl(form.repoUrl)) sourceErrors.repoUrl = 'Enter a valid GitHub repository URL';
    if (!form.branch.trim()) sourceErrors.branch = 'Branch is required';
  }
  const canContinueFromSource = form.sourceType !== '' && Object.keys(sourceErrors).length === 0;

  const basicErrors = (() => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Project name is required';
    if (!form.slug.trim()) e.slug = 'Slug is required';
    else if (!isValidSlug(form.slug)) e.slug = 'Only lowercase letters, numbers, and hyphens';
    if (form.domain && !isValidDomain(form.domain)) e.domain = 'Enter a valid domain (e.g. app.example.com)';
    if (form.port && !isValidPort(form.port)) e.port = 'Port must be between 3001 and 3999';
    return e;
  })();
  const canContinueFromBasic = Object.keys(basicErrors).length === 0 && form.name.trim() !== '' && form.slug.trim() !== '';

  const envError = getEnvVarErrors(form.envVars);
  const canContinueFromEnv = envError === null;

  /* ── Effects ── */

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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /* ── Helpers ── */

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
    if (!canContinueFromSource) return;
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
    setCreateError('');
    try {
      const result = await createProject.mutateAsync({
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
      if (form.useLocalDb) {
        setCreatedProjectId(result.id);
        setStep('import');
      } else {
        router.push(`/projects/${result.id}`);
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create project');
    }
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  /* ── Inline error helper ── */
  function FieldError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return <p className="text-xs text-destructive">{msg}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">New Project</h1>
        <p className="mt-1 text-[13px] text-foreground-muted">Import and deploy your application.</p>
      </div>

      {/* Step indicator */}
      {step !== 'import' && (
        <div className="mb-8 flex items-center gap-1">
          {STEPS.map((s, i) => {
            const isActive = s.key === step;
            const isCompleted = i < currentStepIndex;
            return (
              <div key={s.key} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="mx-1 size-3 text-foreground-muted" />
                )}
                <button
                  onClick={() => isCompleted && setStep(s.key)}
                  disabled={!isCompleted}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-foreground text-background'
                      : isCompleted
                        ? 'text-foreground hover:bg-muted cursor-pointer'
                        : 'text-foreground-muted cursor-default'
                  }`}
                >
                  {isCompleted && <Check className="size-3" />}
                  {s.label}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Step: Source */}
      {step === 'source' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => update({ sourceType: 'GITHUB' })}
              className={`group flex flex-col items-center gap-3 rounded-xl border px-4 py-6 transition-all ${
                form.sourceType === 'GITHUB'
                  ? 'border-foreground bg-foreground/[0.03] ring-1 ring-foreground'
                  : 'border-border hover:border-border-hover hover:bg-muted/50'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                form.sourceType === 'GITHUB' ? 'bg-foreground text-background' : 'bg-muted text-foreground-secondary'
              }`}>
                <GitBranch className="size-4.5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Git Repository</p>
                <p className="mt-0.5 text-xs text-foreground-muted">Import from GitHub</p>
              </div>
            </button>
            <button
              onClick={() => update({ sourceType: 'UPLOAD' })}
              className={`group flex flex-col items-center gap-3 rounded-xl border px-4 py-6 transition-all ${
                form.sourceType === 'UPLOAD'
                  ? 'border-foreground bg-foreground/[0.03] ring-1 ring-foreground'
                  : 'border-border hover:border-border-hover hover:bg-muted/50'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                form.sourceType === 'UPLOAD' ? 'bg-foreground text-background' : 'bg-muted text-foreground-secondary'
              }`}>
                <Upload className="size-4.5" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Upload Files</p>
                <p className="mt-0.5 text-xs text-foreground-muted">Deploy from local files</p>
              </div>
            </button>
          </div>

          {form.sourceType === 'GITHUB' && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="space-y-2">
                <Label className="text-[13px] text-foreground-secondary">Repository URL</Label>
                <Input
                  placeholder="https://github.com/user/repo"
                  value={form.repoUrl}
                  onChange={(e) => update({ repoUrl: e.target.value })}
                  autoFocus
                />
                <FieldError msg={form.repoUrl ? sourceErrors.repoUrl : undefined} />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] text-foreground-secondary">Branch</Label>
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
                    className="font-mono text-[13px]"
                  />
                  {branchDropdownOpen && filteredBranches.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
                      <div className="max-h-48 overflow-auto py-1">
                        {filteredBranches.map((b) => (
                          <button
                            key={b}
                            className={`flex w-full items-center px-3 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-accent ${b === form.branch ? 'bg-accent text-foreground font-medium' : 'text-foreground-secondary'}`}
                            onClick={() => { update({ branch: b }); setBranchDropdownOpen(false); }}
                          >
                            {b === form.branch && <Check className="mr-2 size-3" />}
                            {b}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {branchesLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={goToBasic} disabled={!canContinueFromSource} className="h-9 px-4">
              Continue <ChevronRight className="ml-1 size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Basic Info */}
      {step === 'basic' && (
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border p-4">
            <div className="space-y-2">
              <Label className="text-[13px] text-foreground-secondary">Project Name</Label>
              <Input
                value={form.name}
                onChange={(e) => update({ name: e.target.value, slug: autoSlug(e.target.value) })}
                placeholder="My Application"
                autoFocus
              />
              <FieldError msg={form.name ? basicErrors.name : undefined} />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] text-foreground-secondary">Slug</Label>
              <div className="relative">
                <Terminal className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-muted" />
                <Input
                  value={form.slug}
                  onChange={(e) => update({ slug: e.target.value })}
                  className="pl-8 font-mono text-[13px]"
                />
              </div>
              {form.slug && basicErrors.slug ? (
                <FieldError msg={basicErrors.slug} />
              ) : (
                <p className="text-xs text-foreground-muted">Used for directory name and PM2 process</p>
              )}
            </div>
          </div>

          <div className="space-y-4 rounded-xl border p-4">
            <div className="space-y-2">
              <Label className="text-[13px] text-foreground-secondary">
                <Globe className="size-3.5" /> Domain
                <span className="font-normal text-foreground-muted">(optional)</span>
              </Label>
              <Input
                placeholder="app.example.com"
                value={form.domain}
                onChange={(e) => update({ domain: e.target.value })}
              />
              <FieldError msg={form.domain ? basicErrors.domain : undefined} />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] text-foreground-secondary">
                Port
                <span className="font-normal text-foreground-muted">(optional, auto-assigned if empty)</span>
              </Label>
              <Input
                type="number"
                placeholder="3001–3999"
                value={form.port}
                onChange={(e) => update({ port: e.target.value })}
              />
              <FieldError msg={form.port ? basicErrors.port : undefined} />
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${form.useLocalDb ? 'bg-foreground text-background' : 'bg-muted text-foreground-muted'}`}>
                  <Database className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Platform Database</p>
                  <p className="text-xs text-foreground-muted">Auto-create PostgreSQL and inject DATABASE_URL</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.useLocalDb}
                onClick={() => update({ useLocalDb: !form.useLocalDb })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${form.useLocalDb ? 'bg-foreground' : 'bg-border'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform mt-0.5 ${form.useLocalDb ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('source')} className="h-9 text-foreground-secondary">
              Back
            </Button>
            <Button onClick={() => setStep('env')} disabled={!canContinueFromBasic} className="h-9 px-4">
              Continue <ChevronRight className="ml-1 size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Environment Variables */}
      {step === 'env' && (
        <div className="space-y-6">
          <div className="rounded-xl border p-4 space-y-3">
            <EnvVarEditor value={form.envVars} onChange={(envVars) => update({ envVars })} />
            <FieldError msg={envError ?? undefined} />
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('basic')} className="h-9 text-foreground-secondary">
              Back
            </Button>
            <Button onClick={() => setStep('confirm')} disabled={!canContinueFromEnv} className="h-9 px-4">
              Continue <ChevronRight className="ml-1 size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step: Confirm */}
      {step === 'confirm' && (
        <div className="space-y-6">
          <div className="rounded-xl border divide-y">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-foreground-muted">Source</span>
              <span className="text-[13px] font-medium font-mono">
                {form.sourceType === 'GITHUB' ? 'Git' : 'Upload'}
                {form.repoUrl && <span className="ml-1 text-foreground-secondary font-normal">{form.repoUrl.split('/').slice(-2).join('/')}</span>}
              </span>
            </div>
            {form.branch && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Branch</span>
                <span className="text-[13px] font-mono">{form.branch}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-foreground-muted">Project</span>
              <span className="text-[13px] font-medium">{form.name}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-foreground-muted">Slug</span>
              <span className="text-[13px] font-mono">{form.slug}</span>
            </div>
            {form.domain && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Domain</span>
                <span className="text-[13px]">{form.domain}</span>
              </div>
            )}
            {form.port && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Port</span>
                <span className="text-[13px] font-mono">{form.port}</span>
              </div>
            )}
            {form.useLocalDb && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Database</span>
                <span className="text-[13px]">PostgreSQL <span className="text-foreground-muted">(auto-provisioned)</span></span>
              </div>
            )}
            {Object.keys(form.envVars).length > 0 && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-foreground-muted">Environment</span>
                <span className="text-[13px]">{Object.keys(form.envVars).length} variable{Object.keys(form.envVars).length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {createError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {createError}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('env')} className="h-9 text-foreground-secondary">
              Back
            </Button>
            <Button onClick={handleCreate} disabled={createProject.isPending} className="h-9 px-5">
              {createProject.isPending ? <><Loader2 className="size-3.5 animate-spin" /> Deploying...</> : 'Deploy'}
            </Button>
          </div>
        </div>
      )}

      {/* Step: Import */}
      {step === 'import' && (
        <div className="space-y-6">
          <div className="rounded-xl border p-4">
            <div className="mb-4">
              <h2 className="text-sm font-medium">Import Existing Data</h2>
              <p className="mt-1 text-xs text-foreground-muted">You can import data from an existing database now, or skip this step.</p>
            </div>
            <MigrationWizard projectId={createdProjectId} onClose={() => router.push(`/projects/${createdProjectId}`)} />
          </div>
          <Button variant="ghost" onClick={() => router.push(`/projects/${createdProjectId}`)} className="h-9 text-foreground-secondary">
            Skip for now
          </Button>
        </div>
      )}
    </div>
  );
}
