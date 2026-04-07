'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useImport, useSubmitImportConfig } from '@/hooks/use-imports';
import { ImportEnvMapper } from '@/components/import-env-mapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

interface ItemConfig {
  itemId: string;
  name: string;
  slug: string;
  port?: number;
  repoUrl?: string;
  branch?: string;
  domain?: string;
  dbConflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND';
  envVars: Record<string, string>;
}

export default function ConfigurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: importData, isLoading } = useImport(id);
  const submitConfig = useSubmitImportConfig(id);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [configs, setConfigs] = useState<ItemConfig[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize configs from import data
  useEffect(() => {
    if (importData?.items && !initialized) {
      const initial = importData.items.map((item) => {
        const cfg = item.config || {};
        const name = cfg.name || item.sourceName;
        return {
          itemId: item.id,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          port: cfg.port,
          repoUrl: cfg.gitRemote || cfg.repoUrl || '',
          branch: cfg.branch || 'main',
          domain: cfg.domain || '',
          dbConflictStrategy: cfg.dbConflictStrategy || 'SKIP' as const,
          envVars: cfg.env || cfg.envVars || {},
        };
      });
      setConfigs(initial);
      setInitialized(true);
    }
  }, [importData, initialized]);

  function updateConfig(index: number, updates: Partial<ItemConfig>) {
    setConfigs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  async function handleSubmit() {
    await submitConfig.mutateAsync(configs);
    router.push(`/import/${id}/execute`);
  }

  if (isLoading || !initialized) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">No projects to configure.</p>
        <Button variant="outline" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const current = configs[currentIndex];
  const isLast = currentIndex === configs.length - 1;

  // Build env var list for mapper
  const envVarList = Object.entries(current.envVars).map(([key, value]) => ({
    key,
    originalValue: value,
    suggestedValue: value,
    autoMapped: false,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium tracking-tight">Configure Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Project {currentIndex + 1} of {configs.length}
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Project config */}
        <Card>
          <CardHeader>
            <CardTitle>{current.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  value={current.name}
                  onChange={(e) => updateConfig(currentIndex, { name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={current.slug}
                  onChange={(e) => updateConfig(currentIndex, { slug: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={current.domain || ''}
                  onChange={(e) => updateConfig(currentIndex, { domain: e.target.value })}
                  placeholder="app.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  value={current.port ?? ''}
                  onChange={(e) =>
                    updateConfig(currentIndex, {
                      port: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  placeholder="3001"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="repo">Repository URL</Label>
                <Input
                  id="repo"
                  value={current.repoUrl || ''}
                  onChange={(e) => updateConfig(currentIndex, { repoUrl: e.target.value })}
                  placeholder="https://github.com/user/repo"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="branch">Branch</Label>
                <Input
                  id="branch"
                  value={current.branch || ''}
                  onChange={(e) => updateConfig(currentIndex, { branch: e.target.value })}
                  placeholder="main"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conflict">Database Conflict Strategy</Label>
              <select
                id="conflict"
                value={current.dbConflictStrategy}
                onChange={(e) =>
                  updateConfig(currentIndex, {
                    dbConflictStrategy: e.target.value as ItemConfig['dbConflictStrategy'],
                  })
                }
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="SKIP">Skip if exists</option>
                <option value="OVERWRITE">Overwrite</option>
                <option value="APPEND">Append data</option>
                <option value="ERROR">Error on conflict</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Environment variables */}
        {envVarList.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
            </CardHeader>
            <CardContent>
              <ImportEnvMapper
                envVars={envVarList}
                onChange={(vars) => updateConfig(currentIndex, { envVars: vars })}
              />
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={() => {
              if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
              else router.back();
            }}
          >
            <ChevronLeft className="size-3 mr-1" />
            {currentIndex > 0 ? 'Previous' : 'Back'}
          </Button>

          {isLast ? (
            <Button onClick={handleSubmit} disabled={submitConfig.isPending}>
              {submitConfig.isPending && <Loader2 className="size-3 animate-spin mr-1" />}
              Review & Import
            </Button>
          ) : (
            <Button onClick={() => setCurrentIndex(currentIndex + 1)}>
              Next
              <ChevronRight className="size-3 ml-1" />
            </Button>
          )}
        </div>

        {submitConfig.isError && (
          <p className="text-sm text-destructive">
            Failed to save configuration: {submitConfig.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
