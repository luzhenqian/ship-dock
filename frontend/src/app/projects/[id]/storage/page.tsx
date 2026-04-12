'use client';

import { use, useRef, useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useStorageOverview, useStorageBuckets, useStorageObjects, useUploadFile, useDeleteFile, useDeleteBulk, useDeletePrefix, useRenamePrefix, useCreateFolder, useMovePrefix, getDownloadUrl } from '@/hooks/use-storage';
import { StorageImportWizard } from '@/components/storage-import-wizard';
import { getAccessToken } from '@/lib/api';
import { Loading } from '@/components/ui/loading';
import { X } from 'lucide-react';

function HoverPreview({ projectId, bucket, objectKey, children }: { projectId: string; bucket: string; objectKey: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleEnter = (e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    timerRef.current = setTimeout(async () => {
      setShow(true);
      if (!blobUrl) {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const url = getDownloadUrl(projectId, bucket, objectKey);
          const token = getAccessToken();
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include', signal: controller.signal });
          const blob = await res.blob();
          setBlobUrl(URL.createObjectURL(blob));
        } catch { /* aborted or failed */ }
      }
    }, 300);
  };

  const handleMove = (e: React.MouseEvent) => {
    if (show) setPos({ x: e.clientX, y: e.clientY });
  };

  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(false);
    if (abortRef.current) abortRef.current.abort();
  };

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  return (
    <span onMouseEnter={handleEnter} onMouseMove={handleMove} onMouseLeave={handleLeave}>
      {children}
      {show && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: pos.x + 16, top: pos.y - 80 }}
        >
          <div className="bg-background border rounded-lg shadow-xl p-1.5 max-w-[240px]">
            {blobUrl ? (
              <img src={blobUrl} alt="" className="max-w-[224px] max-h-[160px] object-contain rounded" />
            ) : (
              <div className="w-[120px] h-[80px] flex items-center justify-center text-xs text-muted-foreground">Loading...</div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

function isPreviewable(name: string) {
  return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name);
}

export default function StoragePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedBucket = searchParams.get('bucket') ?? '';
  const prefix = searchParams.get('prefix') ?? '';

  const updateUrl = useCallback((bucket: string, pfx: string) => {
    const params = new URLSearchParams();
    if (bucket) params.set('bucket', bucket);
    if (pfx) params.set('prefix', pfx);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname]);
  const [deleteTarget, setDeleteTarget] = useState<{ bucket: string; key: string } | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ bucket: string; prefix: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ bucket: string; prefix: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveTarget, setMoveTarget] = useState<{ bucket: string; prefix: string; name: string } | null>(null);
  const [moveDest, setMoveDest] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: buckets, isLoading, error } = useStorageBuckets(id);
  const { data: overview } = useStorageOverview(id);
  const { data: objects } = useStorageObjects(id, selectedBucket, prefix);
  const uploadMutation = useUploadFile(id);
  const deleteMutation = useDeleteFile(id);
  const deleteBulkMutation = useDeleteBulk(id);
  const deletePrefixMutation = useDeletePrefix(id);
  const renamePrefixMutation = useRenamePrefix(id);
  const createFolderMutation = useCreateFolder(id);
  const movePrefixMutation = useMovePrefix(id);

  const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : [];
  const allItems = [
    ...(objects?.prefixes?.map((p: any) => typeof p === 'string' ? p : p.prefix) || []),
    ...(objects?.objects?.map((o: any) => o.name) || []),
  ];

  const handleBucketSelect = (name: string) => {
    updateUrl(name, '');
    setSelectedItems(new Set());
  };

  const handleFolderClick = (folderPrefix: string) => {
    updateUrl(selectedBucket, folderPrefix);
    setSelectedItems(new Set());
  };

  const handleBreadcrumb = (index: number) => {
    const newPrefix = index < 0 ? '' : breadcrumbs.slice(0, index + 1).join('/') + '/';
    updateUrl(selectedBucket, newPrefix);
    setSelectedItems(new Set());
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
    deleteMutation.mutate(deleteTarget, { onSuccess: () => { setDeleteTarget(null); setSelectedItems((prev) => { const next = new Set(prev); next.delete(deleteTarget.key); return next; }); } });
  };

  const handleDeleteFolder = () => {
    if (!deleteFolderTarget) return;
    deletePrefixMutation.mutate(deleteFolderTarget, { onSuccess: () => setDeleteFolderTarget(null) });
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim() || !selectedBucket) return;
    const folderPrefix = prefix + newFolderName.trim() + '/';
    createFolderMutation.mutate(
      { bucket: selectedBucket, prefix: folderPrefix },
      { onSuccess: () => { setShowNewFolder(false); setNewFolderName(''); } },
    );
  };

  const handleMoveFolder = () => {
    if (!moveTarget || moveDest === undefined) return;
    const dest = moveDest.trim();
    const destPrefix = dest ? (dest.endsWith('/') ? dest : dest + '/') : '';
    const folderName = moveTarget.name + '/';
    movePrefixMutation.mutate(
      { bucket: moveTarget.bucket, sourcePrefix: moveTarget.prefix, destPrefix: destPrefix + folderName },
      { onSuccess: () => setMoveTarget(null) },
    );
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

  const handleBulkDelete = async () => {
    if (!selectedItems.size) return;
    const folders = Array.from(selectedItems).filter((k) => k.endsWith('/'));
    const files = Array.from(selectedItems).filter((k) => !k.endsWith('/'));

    for (const folder of folders) {
      await deletePrefixMutation.mutateAsync({ bucket: selectedBucket, prefix: folder });
    }
    if (files.length > 0) {
      await deleteBulkMutation.mutateAsync({ bucket: selectedBucket, keys: files });
    }
    setSelectedItems(new Set());
    setBulkDeleteConfirm(false);
  };

  const handlePreview = async (key: string) => {
    const url = getDownloadUrl(id, selectedBucket, key);
    const token = getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    const blob = await res.blob();
    setPreviewUrl(URL.createObjectURL(blob));
    setPreviewName(key.split('/').pop() || key);
  };

  const toggleFile = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (!allItems.length) return;
    if (selectedItems.size === allItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(allItems));
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
          <div className="space-y-4">
            {overview && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Buckets</p>
                    <p className="text-2xl font-semibold mt-1">{overview.totalBuckets}</p>
                  </div>
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Total Objects</p>
                    <p className="text-2xl font-semibold mt-1">{overview.totalObjects.toLocaleString()}</p>
                  </div>
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground">Total Size</p>
                    <p className="text-2xl font-semibold mt-1">{formatSize(overview.totalSize)}</p>
                  </div>
                </div>

                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="px-3 py-2 text-left font-medium">Bucket</th>
                        <th className="px-3 py-2 text-left font-medium">Objects</th>
                        <th className="px-3 py-2 text-left font-medium">Size</th>
                        <th className="px-3 py-2 text-left font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.buckets.map((b: any) => (
                        <tr
                          key={b.name}
                          className="border-b last:border-0 hover:bg-foreground/[0.04] cursor-pointer"
                          onClick={() => handleBucketSelect(b.name)}
                        >
                          <td className="px-3 py-2 font-medium">{b.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.totalObjects.toLocaleString()}</td>
                          <td className="px-3 py-2 text-muted-foreground">{formatSize(b.totalSize)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{b.creationDate ? new Date(b.creationDate).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!overview && <div className="text-sm text-muted-foreground">Select a bucket to browse files.</div>}
          </div>
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
                {selectedItems.size > 0 && (
                  <Button size="sm" variant="destructive" onClick={() => setBulkDeleteConfirm(true)}>
                    Delete {selectedItems.size} selected
                  </Button>
                )}
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                <Button size="sm" variant="outline" onClick={() => { setShowNewFolder(true); setNewFolderName(''); }}>New Folder</Button>
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
                      {allItems.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allItems.length > 0 && selectedItems.size === allItems.length}
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
                  {objects?.prefixes?.map((pObj: any) => {
                    const p = typeof pObj === 'string' ? pObj : pObj.prefix;
                    const name = p.replace(prefix, '').replace(/\/$/, '');
                    const folderSize = pObj.totalSize;
                    const folderObjects = pObj.totalObjects;
                    const folderModified = pObj.lastModified;
                    return (
                      <tr key={p} className="border-b hover:bg-foreground/[0.04]">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedItems.has(p)} onChange={() => toggleFile(p)} />
                        </td>
                        <td className="px-3 py-2 font-medium cursor-pointer" onClick={() => handleFolderClick(p)}>{name}/</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{folderSize != null ? `${formatSize(folderSize)} (${folderObjects})` : '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{folderModified ? new Date(folderModified).toLocaleDateString() : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <button
                              className="text-xs text-foreground-secondary hover:text-foreground hover:underline"
                              onClick={(e) => { e.stopPropagation(); setRenameTarget({ bucket: selectedBucket, prefix: p, name }); setRenameName(name); }}
                            >
                              Rename
                            </button>
                            <button
                              className="text-xs text-foreground-secondary hover:text-foreground hover:underline"
                              onClick={(e) => { e.stopPropagation(); setMoveTarget({ bucket: selectedBucket, prefix: p, name }); setMoveDest(prefix); }}
                            >
                              Move
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
                            checked={selectedItems.has(obj.name)}
                            onChange={() => toggleFile(obj.name)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {canPreview ? (
                            <HoverPreview projectId={id} bucket={selectedBucket} objectKey={obj.name}>
                              <button className="hover:underline hover:text-foreground text-left" onClick={() => handlePreview(obj.name)}>
                                {name}
                              </button>
                            </HoverPreview>
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
        title={`Delete ${selectedItems.size} Files?`}
        description={`This will permanently delete ${selectedItems.size} selected files.`}
        onConfirm={handleBulkDelete}
      />

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowNewFolder(false)}>
          <div className="bg-background border rounded-xl p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">New Folder</h3>
            <div>
              <label className="text-sm text-muted-foreground">Folder name</label>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                placeholder="my-folder"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateFolder} disabled={!newFolderName.trim() || createFolderMutation.isPending}>
                {createFolderMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Move folder dialog */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMoveTarget(null)}>
          <div className="bg-background border rounded-xl p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Move Folder</h3>
            <p className="text-sm text-muted-foreground">
              Moving <span className="font-mono font-medium text-foreground">{moveTarget.name}/</span>
            </p>
            <div>
              <label className="text-sm text-muted-foreground">Destination path</label>
              <Input
                value={moveDest}
                onChange={(e) => setMoveDest(e.target.value)}
                autoFocus
                placeholder="path/to/destination/"
                className="font-mono text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') handleMoveFolder(); }}
              />
              <p className="text-xs text-muted-foreground mt-1">Leave empty for bucket root</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setMoveTarget(null)}>Cancel</Button>
              <Button size="sm" onClick={handleMoveFolder} disabled={movePrefixMutation.isPending}>
                {movePrefixMutation.isPending ? 'Moving...' : 'Move'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}>
          <div className="relative max-w-4xl max-h-[90vh] p-2" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-2 -right-2 z-10 bg-background border rounded-full p-1 hover:bg-muted"
              onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
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
