'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useImport } from '@/hooks/use-imports';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Package, Database, HardDrive } from 'lucide-react';

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: importData, isLoading } = useImport(id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  // Auto-select all items on first load
  if (importData?.items && !initialized) {
    setSelected(new Set(importData.items.map((item) => item.id)));
    setInitialized(true);
  }

  function toggleItem(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function toggleAll() {
    if (!importData?.items) return;
    if (selected.size === importData.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importData.items.map((item) => item.id)));
    }
  }

  function handleContinue() {
    router.push(`/import/${id}/configure`);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items = importData?.items ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium tracking-tight">Preview Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {items.length} project{items.length !== 1 ? 's' : ''} detected. Select which ones to import.
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        {items.length > 1 && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.size === items.length}
              onChange={toggleAll}
              className="rounded border-input"
            />
            <span className="text-sm text-muted-foreground">Select all</span>
          </div>
        )}

        {items.map((item) => {
          const config = item.config || {};
          const hasDatabases = config.databases?.length > 0;
          const hasRedis = config.redis?.length > 0;
          const hasStorage = config.storage?.length > 0;

          return (
            <Card
              key={item.id}
              className={`transition-colors ${
                selected.has(item.id) ? 'border-foreground/30' : 'opacity-60'
              }`}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    className="rounded border-input"
                  />
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <Package className="size-4" />
                      {item.sourceName}
                    </CardTitle>
                    <CardDescription>
                      {config.type && (
                        <Badge variant="outline" className="mr-1 text-[10px]">
                          {config.type}
                        </Badge>
                      )}
                      {config.port && (
                        <span className="text-xs">Port {config.port}</span>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  {hasDatabases && (
                    <span className="flex items-center gap-1">
                      <Database className="size-3" />
                      {config.databases.length} database{config.databases.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {hasRedis && (
                    <span className="flex items-center gap-1">
                      <HardDrive className="size-3" />
                      Redis
                    </span>
                  )}
                  {hasStorage && (
                    <span className="flex items-center gap-1">
                      <HardDrive className="size-3" />
                      Storage
                    </span>
                  )}
                  {config.env && (
                    <span>
                      {Object.keys(config.env).length} env vars
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={() => router.back()}>
            Back
          </Button>
          <Button onClick={handleContinue} disabled={selected.size === 0}>
            Continue with {selected.size} project{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
