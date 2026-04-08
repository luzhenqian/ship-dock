'use client';

import { use, useState, useEffect } from 'react';
import copyToClipboard from 'copy-to-clipboard';
import { useRouter } from 'next/navigation';
import { useImport } from '@/hooks/use-imports';
import { getAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Copy, Check, Loader2, Terminal } from 'lucide-react';

export default function CliConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: importData } = useImport(id);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setToken(getAccessToken());
  }, []);

  // CLI progress from polled import data
  const cliProgress: { stage: string; message?: string; percent?: number }[] =
    (importData?.manifestData as any)?.cliProgress || [];

  // Redirect when upload complete or import already has items
  useEffect(() => {
    if (importData?.status === 'UPLOADED' || (importData && importData.items && importData.items.length > 0)) {
      router.push(`/import/${id}/preview`);
    }
  }, [importData, id, router]);

  const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const apiUrl = typeof window !== 'undefined' && rawApiUrl.startsWith('/')
    ? `${window.location.origin}${rawApiUrl}`
    : rawApiUrl;
  const cliCommand = token
    ? `npx ship-dock-migrate --server ${apiUrl} --token ${token} --import-id ${id}`
    : 'Generating token...';

  function handleCopy() {
    copyToClipboard(cliCommand);
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

          <div className="rounded-lg border p-4 space-y-3">
            {cliProgress.length === 0 ? (
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Waiting for CLI...</p>
                  <p className="text-xs text-muted-foreground">
                    Run the command above on your source server. Progress will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {cliProgress.map((p, i) => {
                  const isLast = i === cliProgress.length - 1;
                  const isDone = p.stage === 'done';
                  return (
                    <div key={p.stage} className="flex items-center gap-3">
                      {isDone ? (
                        <Check className="size-4 text-green-500" />
                      ) : isLast && !isDone ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Check className="size-4 text-green-500" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium capitalize">{p.stage}</p>
                        {p.message && (
                          <p className="text-xs text-muted-foreground">{p.message}</p>
                        )}
                        {isLast && !isDone && p.percent != null && p.percent > 0 && p.percent < 100 && (
                          <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                            <div
                              className="h-1.5 rounded-full bg-foreground transition-all"
                              style={{ width: `${p.percent}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
