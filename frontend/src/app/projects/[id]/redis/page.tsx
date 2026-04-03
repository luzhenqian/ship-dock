'use client';

import { use, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RedisCliPanel } from '@/components/redis-cli-panel';
import { useRedisKeys, useRedisKeyDetail, useDeleteRedisKey } from '@/hooks/use-redis';

export default function RedisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pattern, setPattern] = useState('*');
  const [selectedKey, setSelectedKey] = useState('');
  const [showCli, setShowCli] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: keysData, isLoading } = useRedisKeys(id, pattern);
  const { data: keyDetail } = useRedisKeyDetail(id, selectedKey);
  const deleteMutation = useDeleteRedisKey(id);

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => {
        if (selectedKey === deleteTarget) setSelectedKey('');
        setDeleteTarget(null);
      },
    });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const typeColors: Record<string, string> = {
    string: 'text-green-600',
    hash: 'text-blue-600',
    list: 'text-orange-600',
    set: 'text-purple-600',
    zset: 'text-pink-600',
  };

  return (
    <div>
      {showCli && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Redis CLI</h3>
            <Button size="sm" variant="outline" onClick={() => setShowCli(false)}>Close</Button>
          </div>
          <RedisCliPanel projectId={id} />
        </div>
      )}

      <div className="flex gap-4" style={{ height: showCli ? 'calc(100vh - 600px)' : 'calc(100vh - 220px)' }}>
        {/* Key list */}
        <div className="w-64 shrink-0 border rounded-md flex flex-col">
          <div className="p-3 border-b space-y-2">
            <Input
              placeholder="Filter pattern (e.g. user:*)"
              value={pattern}
              onChange={(e) => setPattern(e.target.value || '*')}
              className="h-8 text-sm"
            />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowCli(true)}>CLI</Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {keysData?.keys?.map((item: any) => (
              <button
                key={item.key}
                className={`w-full text-left px-3 py-2 text-sm flex justify-between hover:bg-muted/50 ${selectedKey === item.key ? 'bg-muted font-medium' : ''}`}
                onClick={() => setSelectedKey(item.key)}
              >
                <span className="truncate">{item.key}</span>
                <span className={`text-xs shrink-0 ml-2 ${typeColors[item.type] || 'text-muted-foreground'}`}>{item.type}</span>
              </button>
            ))}
            {keysData?.keys?.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No keys found</div>
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {!selectedKey ? (
            <div className="text-sm text-muted-foreground">Select a key to view its value.</div>
          ) : keyDetail ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium font-mono">{keyDetail.key}</h3>
                  <p className="text-xs text-muted-foreground">
                    Type: {keyDetail.type} | TTL: {keyDetail.ttl === -1 ? 'No expiry' : `${keyDetail.ttl}s`} | Size: {keyDetail.size}
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(selectedKey)}>Delete</Button>
              </div>
              <div className="border rounded-md bg-[#0a0a0a] text-[#e5e5e5] p-4 font-mono text-sm overflow-auto max-h-[calc(100vh-360px)]">
                <pre className="whitespace-pre-wrap">
                  {typeof keyDetail.value === 'object'
                    ? JSON.stringify(keyDetail.value, null, 2)
                    : String(keyDetail.value)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Redis Key?"
        description={`This will permanently delete the key "${deleteTarget}".`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
