'use client';

import { use, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useStorageBuckets, useStorageObjects, useUploadFile, useDeleteFile, useDeleteBulk, useDeletePrefix, useRenamePrefix, usePreviewUrl, getDownloadUrl } from '@/hooks/use-storage';
import { StorageImportWizard } from '@/components/storage-import-wizard';
import { getAccessToken } from '@/lib/api';
import { Loading } from '@/components/ui/loading';
import { X } from 'lucide-react';

function isPreviewable(name: string) {
  return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name);
}

export default function StoragePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedBucket, setSelectedBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ bucket: string; key: string } | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ bucket: string; prefix: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ bucket: string; prefix: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: buckets, isLoading, error } = useStorageBuckets(id);
  const { data: objects } = useStorageObjects(id, selectedBucket, prefix);
  const uploadMutation = useUploadFile(id);
  const deleteMutation = useDeleteFile(id);
  const deleteBulkMutation = useDeleteBulk(id);
  const deletePrefixMutation = useDeletePrefix(id);
  const renamePrefixMutation = useRenamePrefix(id);
  const previewMutation = usePreviewUrl(id);

  const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : [];

  const handleBucketSelect = (name: string) => {
    setSelectedBucket(name);
    setPrefix('');
    setSelectedFiles(new Set());
  };

  const handleFolderClick = (folderPrefix: string) => {
    setPrefix(folderPrefix);
    setSelectedFiles(new Set());
  };

  const handleBreadcrumb = (index: number) => {
    if (index < 0) setPrefix('');
    else setPrefix(breadcrumbs.slice(0, index + 1).join('/') + '/');
    setSelectedFiles(new Set());
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
    deleteMutation.mutate(deleteTarget, { onSuccess: () => { setDeleteTarget(null); setSelectedFiles((prev) => { const next = new Set(prev); next.delete(deleteTarget.key); return next; }); } });
  };

  const handleDeleteFolder = () => {
    if (!deleteFolderTarget) return;
    deletePrefixMutation.mutate(deleteFolderTarget, { onSuccess: () => setDeleteFolderTarget(null) });
  };

  const handleRenameFolder = () => {
    if (!renameTarget || !renameName.trim()) return;
    const parentPrefix = renameTarget.prefix.replace(/[^/]+\/$/, '');
    const newPrefix = parentPrefix + renameName.trim() + '/';
    renamePrefixMutation.mutate(
      { bucket: renameTarget.bucket, oldPrefix: renameTarget.prefix, newPrefix },
      { onSuccess: () => setRenameTarget(null) },
    );
  };

  const handleBulkDelete = () => {
    if (!selectedFiles.size) return;
    deleteBulkMutation.mutate(
      { bucket: selectedBucket, keys: Array.from(selectedFiles) },
      { onSuccess: () => { setSelectedFiles(new Set()); setBulkDeleteConfirm(false); } },
    );
  };

  const handlePreview = async (key: string) => {
    const result = await previewMutation.mutateAsync({ bucket: selectedBucket, key });
    setPreviewUrl(result.url);
    setPreviewName(key.split('/').pop() || key);
  };

  const toggleFile = (key: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (!objects?.objects?.length) return;
    const allKeys = objects.objects.map((o: any) => o.name);
    if (selectedFiles.size === allKeys.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(allKeys));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  if (isLoading) return <Loading className="py-20" />;
  if (error || !buckets?.length) return <div className="text-sm text-muted-foreground">No MinIO connection configured. Add one in Settings → Services.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Bucket list */}
      <div className="w-48 shrink-0 border rounded-xl">
        <div className="p-3 border-b text-[11px] font-medium text-foreground-muted uppercase tracking-wider">Buckets</div>
        <ScrollArea className="h-full">
          {buckets.map((b: any) => (
            <button
              key={b.name}
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-foreground/[0.04] ${selectedBucket === b.name ? 'bg-foreground/[0.06] font-medium' : 'text-foreground-secondary'}`}
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
        ) : showImport ? (
          <StorageImportWizard
            projectId={id}
            bucket={selectedBucket}
            prefix={prefix}
            onClose={() => setShowImport(false)}
          />
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
              <div className="flex gap-2 items-center">
                {selectedFiles.size > 0 && (
                  <Button size="sm" variant="destructive" onClick={() => setBulkDeleteConfirm(true)}>
                    Delete {selectedFiles.size} selected
                  </Button>
                )}
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>Import</Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>

            <div className="border rounded-xl overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="px-3 py-2 w-8">
                      {objects?.objects?.length > 0 && (
                        <input
                          type="checkbox"
                          checked={objects.objects.length > 0 && selectedFiles.size === objects.objects.length}
                          onChange={toggleAll}
                        />
                      )}
                    </th>
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
                      <tr key={p} className="border-b hover:bg-foreground/[0.04]">
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 font-medium cursor-pointer" onClick={() => handleFolderClick(p)}>{name}/</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              className="text-xs text-foreground-secondary hover:text-foreground hover:underline"
                              onClick={(e) => { e.stopPropagation(); setRenameTarget({ bucket: selectedBucket, prefix: p, name }); setRenameName(name); }}
                            >
                              Rename
                            </button>
                            <button
                              className="text-xs text-status-error hover:underline"
                              onClick={(e) => { e.stopPropagation(); setDeleteFolderTarget({ bucket: selectedBucket, prefix: p }); }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {objects?.objects?.map((obj: any) => {
                    const name = obj.name.replace(prefix, '');
                    const canPreview = isPreviewable(name);
                    return (
                      <tr key={obj.name} className="border-b last:border-0 hover:bg-foreground/[0.04]">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedFiles.has(obj.name)}
                            onChange={() => toggleFile(obj.name)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {canPreview ? (
                            <button className="hover:underline hover:text-foreground text-left" onClick={() => handlePreview(obj.name)}>
                              {name}
                            </button>
                          ) : name}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{formatSize(obj.size)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(obj.lastModified).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            {canPreview && (
                              <button className="text-xs text-foreground-secondary hover:text-foreground hover:underline" onClick={() => handlePreview(obj.name)}>
                                Preview
                              </button>
                            )}
                            <button className="text-xs text-foreground-secondary hover:text-foreground hover:underline" onClick={() => handleDownload(obj.name)}>
                              Download
                            </button>
                            <button className="text-xs text-status-error hover:underline" onClick={() => setDeleteTarget({ bucket: selectedBucket, key: obj.name })}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!objects?.prefixes?.length && !objects?.objects?.length && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Empty</td></tr>
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

      {/* Delete single file */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete File?"
        description={`This will permanently delete "${deleteTarget?.key}".`}
        onConfirm={handleDelete}
      />

      {/* Delete folder */}
      <ConfirmDialog
        open={!!deleteFolderTarget}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
        title="Delete Folder?"
        description={`This will permanently delete "${deleteFolderTarget?.prefix}" and all files inside it.`}
        onConfirm={handleDeleteFolder}
      />

      {/* Bulk delete */}
      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={(open) => !open && setBulkDeleteConfirm(false)}
        title={`Delete ${selectedFiles.size} Files?`}
        description={`This will permanently delete ${selectedFiles.size} selected files.`}
        onConfirm={handleBulkDelete}
      />

      {/* Rename folder dialog */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRenameTarget(null)}>
          <div className="bg-background border rounded-xl p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Rename Folder</h3>
            <div>
              <label className="text-sm text-muted-foreground">New name</label>
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(); }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button size="sm" onClick={handleRenameFolder} disabled={!renameName.trim() || renameName === renameTarget.name || renamePrefixMutation.isPending}>
                {renamePrefixMutation.isPending ? 'Renaming...' : 'Rename'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview dialog */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-w-4xl max-h-[90vh] p-2" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-2 -right-2 z-10 bg-background border rounded-full p-1 hover:bg-muted"
              onClick={() => setPreviewUrl(null)}
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewUrl}
              alt={previewName}
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <p className="text-center text-sm text-muted-foreground mt-2">{previewName}</p>
          </div>
        </div>
      )}
    </div>
  );
}
