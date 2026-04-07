'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubmitImportConfig, useImport, useTestConnection } from '@/hooks/use-imports';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface ServiceConnection {
  id: string;
  type: 'database' | 'redis' | 'storage';
  config: Record<string, string>;
  tested: boolean | null;
}

export default function CloudImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: importData } = useImport(id);
  const submitConfig = useSubmitImportConfig(id);
  const testConn = useTestConnection();

  const [projectName, setProjectName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [envText, setEnvText] = useState('');
  const [services, setServices] = useState<ServiceConnection[]>([]);

  function addService(type: 'database' | 'redis' | 'storage') {
    const defaults: Record<string, Record<string, string>> = {
      database: { host: '', port: '5432', username: '', password: '', database: '' },
      redis: { url: '' },
      storage: { endpoint: '', accessKey: '', secretKey: '', bucket: '' },
    };
    setServices((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, config: defaults[type], tested: null },
    ]);
  }

  function removeService(serviceId: string) {
    setServices((prev) => prev.filter((s) => s.id !== serviceId));
  }

  function updateServiceConfig(serviceId: string, key: string, value: string) {
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId ? { ...s, config: { ...s.config, [key]: value }, tested: null } : s,
      ),
    );
  }

  async function handleTestConnection(service: ServiceConnection) {
    const result = await testConn.mutateAsync({
      type: service.type,
      ...service.config,
    });
    setServices((prev) =>
      prev.map((s) => (s.id === service.id ? { ...s, tested: result.success } : s)),
    );
  }

  function parseEnvVars(text: string): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
    }
    return vars;
  }

  async function handleContinue() {
    if (!projectName.trim()) return;

    // For cloud import, we create a single item config
    // If there are existing items from the import, use those
    const items = importData?.items?.length
      ? importData.items.map((item) => ({
          itemId: item.id,
          name: projectName,
          slug: projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          repoUrl: repoUrl || undefined,
          branch: branch || undefined,
          envVars: parseEnvVars(envText),
        }))
      : [];

    if (items.length > 0) {
      await submitConfig.mutateAsync(items);
    }

    router.push(`/import/${id}/configure`);
  }

  const serviceLabels: Record<string, string> = {
    database: 'PostgreSQL Database',
    redis: 'Redis',
    storage: 'S3 / MinIO Storage',
  };

  const serviceFields: Record<string, string[]> = {
    database: ['host', 'port', 'username', 'password', 'database'],
    redis: ['url'],
    storage: ['endpoint', 'accessKey', 'secretKey', 'bucket'],
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium tracking-tight">Cloud Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your project source and service connections.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Project details */}
        <Card>
          <CardHeader>
            <CardTitle>Project Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="my-app"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo">GitHub Repository URL</Label>
              <Input
                id="repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch">Branch</Label>
              <Input
                id="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
              />
            </div>
          </CardContent>
        </Card>

        {/* Service connections */}
        <Card>
          <CardHeader>
            <CardTitle>Service Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {services.map((service) => (
              <div key={service.id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{serviceLabels[service.type]}</span>
                    {service.tested === true && (
                      <Badge variant="secondary" className="text-[10px]">
                        <CheckCircle2 className="size-3 mr-0.5" /> Connected
                      </Badge>
                    )}
                    {service.tested === false && (
                      <Badge variant="destructive" className="text-[10px]">
                        <XCircle className="size-3 mr-0.5" /> Failed
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeService(service.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {serviceFields[service.type].map((field) => (
                    <div key={field} className={field === 'url' ? 'col-span-2' : ''}>
                      <Label className="text-xs capitalize">{field}</Label>
                      <Input
                        value={service.config[field] ?? ''}
                        onChange={(e) => updateServiceConfig(service.id, field, e.target.value)}
                        type={field === 'password' || field === 'secretKey' ? 'password' : 'text'}
                        className="text-xs"
                        placeholder={field}
                      />
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestConnection(service)}
                  disabled={testConn.isPending}
                >
                  {testConn.isPending ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : null}
                  Test Connection
                </Button>
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => addService('database')}>
                <Plus className="size-3 mr-1" /> Database
              </Button>
              <Button variant="outline" size="sm" onClick={() => addService('redis')}>
                <Plus className="size-3 mr-1" /> Redis
              </Button>
              <Button variant="outline" size="sm" onClick={() => addService('storage')}>
                <Plus className="size-3 mr-1" /> Storage
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Environment variables */}
        <Card>
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={"DATABASE_URL=postgresql://...\nREDIS_URL=redis://...\nSECRET_KEY=..."}
              className="w-full h-32 rounded-lg border border-input bg-transparent p-3 font-mono text-xs placeholder:text-foreground-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 resize-y"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paste your .env file contents. One variable per line in KEY=VALUE format.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => router.push('/import')}>
            Cancel
          </Button>
          <Button
            onClick={handleContinue}
            disabled={!projectName.trim() || submitConfig.isPending}
          >
            {submitConfig.isPending ? (
              <Loader2 className="size-3 animate-spin mr-1" />
            ) : null}
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
