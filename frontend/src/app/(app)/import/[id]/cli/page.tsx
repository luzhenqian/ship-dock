'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useImport, useGenerateImportToken } from '@/hooks/use-imports';
import { useImportProgress } from '@/hooks/use-import-progress';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Copy, Check, Loader2, Terminal } from 'lucide-react';

export default function CliConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: importData } = useImport(id);
  const generateToken = useGenerateImportToken();
  const { uploadComplete } = useImportProgress(id);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generateToken.mutateAsync().then((res) => setToken(res.token));
  }, []);

  // Redirect when upload complete or import already has items
  useEffect(() => {
    if (uploadComplete || (importData && importData.items && importData.items.length > 0)) {
      router.push(`/import/${id}/preview`);
    }
  }, [uploadComplete, importData, id, router]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const cliCommand = token
    ? `npx ship-dock-cli export --url ${apiUrl} --token ${token} --import-id ${id}`
    : 'Generating token...';

  function handleCopy() {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(cliCommand);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = cliCommand;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium tracking-tight">Connect via CLI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run this command on your source server to export and upload your projects.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" />
            CLI Command
          </CardTitle>
          <CardDescription>
            Copy and run this on the server you want to import from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <pre className="rounded-lg bg-muted p-4 pr-12 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {cliCommand}
            </pre>
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-2 right-2"
              onClick={handleCopy}
              disabled={!token}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Waiting for upload...</p>
              <p className="text-xs text-muted-foreground">
                This page will automatically continue once the CLI finishes uploading.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
