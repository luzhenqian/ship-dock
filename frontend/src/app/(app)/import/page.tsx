'use client';

import { useRouter } from 'next/navigation';
import { useCreateImport } from '@/hooks/use-imports';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Server, Cloud } from 'lucide-react';

export default function ImportPage() {
  const router = useRouter();
  const createImport = useCreateImport();

  async function handleSelect(sourceType: 'CLI_PACKAGE' | 'REMOTE') {
    const result = await createImport.mutateAsync({ sourceType });
    if (sourceType === 'CLI_PACKAGE') {
      router.push(`/import/${result.id}/cli`);
    } else {
      router.push(`/import/${result.id}/cloud`);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium tracking-tight">Import Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bring existing projects into Ship Dock from another server or cloud provider.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <button
          className="text-left"
          onClick={() => handleSelect('CLI_PACKAGE')}
          disabled={createImport.isPending}
        >
          <Card className="h-full transition-colors hover:border-foreground/30 cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="size-4" />
                Server / VPS
              </CardTitle>
              <CardDescription>
                Import from a Linux server using the Ship Dock CLI tool. Automatically detects projects, databases, and services.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Run a CLI command on your source server to package everything up, then upload the archive here.
              </p>
            </CardContent>
          </Card>
        </button>

        <button
          className="text-left"
          onClick={() => handleSelect('REMOTE')}
          disabled={createImport.isPending}
        >
          <Card className="h-full transition-colors hover:border-foreground/30 cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="size-4" />
                Cloud / Serverless
              </CardTitle>
              <CardDescription>
                Import from Vercel, Railway, Render, or other cloud platforms by connecting your repo and services.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Provide your GitHub repo URL and connect external databases, Redis, or storage.
              </p>
            </CardContent>
          </Card>
        </button>
      </div>

      {createImport.isError && (
        <p className="text-sm text-destructive mt-4">
          Failed to create import: {createImport.error.message}
        </p>
      )}
    </div>
  );
}
