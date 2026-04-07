'use client';

import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { usePm2Config, useUpdatePm2Config, Pm2ConfigData } from '@/hooks/use-pm2-config';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { codeToHtml } from 'shiki';
import { Loading } from '@/components/ui/loading';

function useHighlightedCode(code: string, lang: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, { lang, theme: 'github-dark' }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  return html;
}

export default function Pm2ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const { data, isLoading } = usePm2Config(projectId);
  const updateConfig = useUpdatePm2Config(projectId);

  const [form, setForm] = useState<Pm2ConfigData>({
    script: null,
    instances: 1,
    execMode: 'fork',
    maxMemoryRestart: null,
  });

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  function setField<K extends keyof Pm2ConfigData>(key: K, value: Pm2ConfigData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-switch to cluster when instances > 1
      if (key === 'instances' && typeof value === 'number' && value > 1) {
        next.execMode = 'cluster';
      }
      return next;
    });
  }

  const preview = data?.preview || '';
  const highlightedPreview = useHighlightedCode(preview, 'javascript');

  async function handleSave() {
    try {
      await updateConfig.mutateAsync(form);
      toast.success('PM2 configuration saved and process restarted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (!project || isLoading) return <Loading className="py-20" />;

  if (!project.directory) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Please deploy the project before managing PM2 settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Process Info</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground text-xs">Process Name</Label>
              <p className="text-sm font-mono">{data?.info.name}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Working Directory</Label>
              <p className="text-sm font-mono">{data?.info.cwd}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Port</Label>
              <p className="text-sm font-mono">{data?.info.port}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">NODE_ENV</Label>
              <p className="text-sm font-mono">production</p>
            </div>
          </div>
          {data?.info.envVars && Object.keys(data.info.envVars).length > 0 && (
            <details className="pt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Environment Variables ({Object.keys(data.info.envVars).length})
              </summary>
              <div className="mt-2 space-y-1">
                {Object.entries(data.info.envVars).map(([key, val]) => (
                  <div key={key} className="text-xs font-mono">
                    <span className="text-foreground">{key}</span>
                    <span className="text-muted-foreground"> = {val}</span>
                  </div>
                ))}
              </div>
              <a href={`/projects/${projectId}/settings`} className="text-xs text-muted-foreground hover:text-foreground underline mt-2 inline-block">
                Edit in Settings
              </a>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Runtime Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Start Script</Label>
            <Input
              value={form.script || ''}
              onChange={(e) => setField('script', e.target.value || null)}
              className="font-mono text-sm"
              placeholder={data?.info.detectedScript || 'dist/main.js'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to auto-detect{data?.info.detectedScript ? ` (${data.info.detectedScript})` : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Instances</Label>
              <Input
                type="number"
                min={1} max={16}
                value={form.instances}
                onChange={(e) => setField('instances', parseInt(e.target.value) || 1)}
                className="w-32"
              />
            </div>
            <div>
              <Label>Exec Mode</Label>
              <select
                value={form.execMode}
                onChange={(e) => setField('execMode', e.target.value)}
                className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="fork">fork</option>
                <option value="cluster">cluster</option>
              </select>
            </div>
          </div>
          {form.instances > 1 && form.execMode === 'cluster' && (
            <p className="text-xs text-muted-foreground">Multiple instances require cluster mode</p>
          )}

          <div>
            <Label>Max Memory Restart</Label>
            <Input
              value={form.maxMemoryRestart || ''}
              onChange={(e) => setField('maxMemoryRestart', e.target.value || null)}
              className="w-32 font-mono"
              placeholder="300M"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Auto-restart when memory exceeds this limit (e.g., 300M, 1G). Leave empty for no limit.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateConfig.isPending}>
        {updateConfig.isPending ? 'Saving...' : 'Save & Restart'}
      </Button>

      <Card>
        <CardHeader><CardTitle>Generated Configuration</CardTitle></CardHeader>
        <CardContent>
          {highlightedPreview ? (
            <div
              className="rounded-md text-xs overflow-x-auto leading-relaxed [&_pre]:p-4 [&_pre]:rounded-md"
              dangerouslySetInnerHTML={{ __html: highlightedPreview }}
            />
          ) : (
            <pre className="bg-muted p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
              {preview}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
