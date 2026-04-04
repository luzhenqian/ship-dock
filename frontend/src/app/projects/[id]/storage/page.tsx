'use client';

import { use, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useStorageBuckets, useStorageObjects, useUploadFile, useDeleteFile, getDownloadUrl } from '@/hooks/use-storage';
import { getAccessToken } from '@/lib/api';

export default function StoragePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ bucket: string; key: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: buckets, isLoading, error } = useStorageBuckets(id);
  const { data: objects } = useStorageObjects(id, selectedBucket, prefix);
  const uploadMutation = useUploadFile(id);
  const deleteMutation = useDeleteFile(id);

  const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : [];

  const handleBucketSelect = (name: string) => {
    setSelectedBucket(name);
    setPrefix('');
  };

  const handleFolderClick = (folderPrefix: string) => {
    setPrefix(folderPrefix);
  };

  const handleBreadcrumb = (index: number) => {
    if (index < 0) {
      setPrefix('');
    } else {
      setPrefix(breadcrumbs.slice(0, index + 1).join('/') + '/');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBucket) return;
    await uploadMutation.mutateAsync({ bucket: selectedBucket, prefix, file });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (key: string) => {
    const url = getDownloadUrl(id, selectedBucket, key);
    const token = getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = key.split('/').pop() || 'download';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (error || !buckets?.length) return <div className="text-sm text-muted-foreground">No MinIO connection configured. Add one in Settings → Services.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Bucket list */}
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Buckets</div>
        <ScrollArea className="h-full">
          {buckets.map((b: any) => (
            <button
              key={b.name}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedBucket === b.name ? 'bg-muted font-medium' : ''}`}
              onClick={() => handleBucketSelect(b.name)}
            >
              {b.name}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* File browser */}
      <div className="flex-1 min-w-0">
        {!selectedBucket ? (
          <div className="text-sm text-muted-foreground">Select a bucket to browse files.</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1 text-sm">
                <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBreadcrumb(-1)}>
                  {selectedBucket}
                </button>
                {breadcrumbs.map((crumb, i) => (
                  <span key={i}>
                    <span className="text-muted-foreground mx-1">/</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => handleBreadcrumb(i)}>
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
              <div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>

            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Size</th>
                    <th className="px-3 py-2 text-left font-medium">Modified</th>
                    <th className="px-3 py-2 text-left font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {objects?.prefixes?.map((p: string) => {
                    const name = p.replace(prefix, '').replace(/\/$/, '');
                    return (
                      <tr key={p} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => handleFolderClick(p)}>
                        <td className="px-3 py-2 font-medium">{name}/</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2">—</td>
                      </tr>
                    );
                  })}
                  {objects?.objects?.map((obj: any) => {
                    const name = obj.name.replace(prefix, '');
                    return (
                      <tr key={obj.name} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs">{name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatSize(obj.size)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(obj.lastModified).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => handleDownload(obj.name)}>
                              Download
                            </button>
                            <button className="text-xs text-red-600 hover:underline" onClick={() => setDeleteTarget({ bucket: selectedBucket, key: obj.name })}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!objects?.prefixes?.length && !objects?.objects?.length && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Empty</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {objects?.isTruncated && (
              <div className="mt-3 text-center">
                <span className="text-xs text-muted-foreground">Showing first {objects.objects.length} files. More files available.</span>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete File?"
        description={`This will permanently delete "${deleteTarget?.key}".`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
