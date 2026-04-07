'use client';

import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { useNginxConfig, useUpdateNginxConfig, NginxConfigData } from '@/hooks/use-nginx-config';
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
    codeToHtml(code, {
      lang,
      theme: 'github-dark',
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);
  return html;
}

function buildPreview(
  domain: string,
  port: number,
  config: NginxConfigData,
): string {
  const gzipBlock = config.gzipEnabled
    ? `\n    gzip on;\n    gzip_min_length ${config.gzipMinLength};\n    gzip_types ${config.gzipTypes};`
    : '\n    gzip off;';

  const bufferLines = config.proxyBuffering
    ? `\n        proxy_buffer_size ${config.proxyBufferSize};\n        proxy_buffers ${config.proxyBuffers};`
    : '';

  return `server {
    listen 80;
    server_name ${domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    client_max_body_size ${config.clientMaxBodySize}m;
${gzipBlock}

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout ${config.proxyReadTimeout}s;
        proxy_send_timeout ${config.proxySendTimeout}s;
        proxy_connect_timeout ${config.proxyConnectTimeout}s;
        proxy_buffering ${config.proxyBuffering ? 'on' : 'off'};${bufferLines}
    }
}`;
}

export default function NginxConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const { data, isLoading } = useNginxConfig(projectId);
  const updateConfig = useUpdateNginxConfig(projectId);

  const [form, setForm] = useState<NginxConfigData>({
    clientMaxBodySize: 10,
    proxyReadTimeout: 60,
    proxySendTimeout: 60,
    proxyConnectTimeout: 60,
    gzipEnabled: true,
    gzipMinLength: 1024,
    gzipTypes: 'text/plain text/css application/json application/javascript text/xml',
    proxyBuffering: true,
    proxyBufferSize: '4k',
    proxyBuffers: '8 4k',
  });

  useEffect(() => {
    if (data?.config) setForm(data.config);
  }, [data]);

  const preview = project?.domain ? buildPreview(project.domain, project.port, form) : '';
  const highlightedPreview = useHighlightedCode(preview, 'nginx');

  function setField<K extends keyof NginxConfigData>(key: K, value: NginxConfigData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await updateConfig.mutateAsync(form);
      toast.success('Nginx configuration saved and applied');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (!project || isLoading) return <Loading className="py-20" />;

  if (!project.domain) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Please deploy the project and configure a domain before managing Nginx settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Request Limits</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Max Upload Size</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1} max={1024}
                value={form.clientMaxBodySize}
                onChange={(e) => setField('clientMaxBodySize', parseInt(e.target.value) || 1)}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">MB</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Read Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxyReadTimeout}
                  onChange={(e) => setField('proxyReadTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
            <div>
              <Label>Send Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxySendTimeout}
                  onChange={(e) => setField('proxySendTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
            <div>
              <Label>Connect Timeout</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1} max={3600}
                  value={form.proxyConnectTimeout}
                  onChange={(e) => setField('proxyConnectTimeout', parseInt(e.target.value) || 1)}
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Compression & Caching</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.gzipEnabled}
                onChange={(e) => setField('gzipEnabled', e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm font-medium">Enable Gzip Compression</span>
            </label>
          </div>
          {form.gzipEnabled && (
            <div className="space-y-4 pl-6">
              <div>
                <Label>Min Length (bytes)</Label>
                <Input
                  type="number"
                  min={0} max={1048576}
                  value={form.gzipMinLength}
                  onChange={(e) => setField('gzipMinLength', parseInt(e.target.value) || 0)}
                  className="w-48"
                />
              </div>
              <div>
                <Label>MIME Types</Label>
                <Input
                  value={form.gzipTypes}
                  onChange={(e) => setField('gzipTypes', e.target.value)}
                  className="font-mono text-sm"
                  placeholder="text/plain text/css application/json"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.proxyBuffering}
                onChange={(e) => setField('proxyBuffering', e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <span className="text-sm font-medium">Enable Proxy Buffering</span>
            </label>
          </div>
          {form.proxyBuffering && (
            <div className="space-y-4 pl-6">
              <div>
                <Label>Buffer Size</Label>
                <Input
                  value={form.proxyBufferSize}
                  onChange={(e) => setField('proxyBufferSize', e.target.value)}
                  className="w-32 font-mono"
                  placeholder="4k"
                />
              </div>
              <div>
                <Label>Buffers</Label>
                <Input
                  value={form.proxyBuffers}
                  onChange={(e) => setField('proxyBuffers', e.target.value)}
                  className="w-32 font-mono"
                  placeholder="8 4k"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={updateConfig.isPending}>
        {updateConfig.isPending ? 'Saving...' : 'Save & Apply'}
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
