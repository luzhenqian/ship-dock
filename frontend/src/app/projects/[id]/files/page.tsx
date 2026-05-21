'use client';
import { use, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  FolderOpen, File as FileIcon, Download, Trash2, Archive, Upload, FolderPlus, ChevronRight, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  useProjectFiles, useProjectFileStats, useProjectDirectories,
  useUploadProjectFile, useUploadProjectFolder, useMkdir, useDeleteProjectFile, useExtractArchive,
  getFileDownloadUrl,
} from '@/hooks/use-project-files';
import { getAccessToken } from '@/lib/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function isArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
}

function timeAgo(dateStr: string): string {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPath = searchParams.get('path') || '';

  const { data: listing, isLoading } = useProjectFiles(projectId, currentPath);
  const { data: stats } = useProjectFileStats(projectId);
  const { data: existingDirs } = useProjectDirectories(projectId);
  const uploadMutation = useUploadProjectFile(projectId);
  const folderMutation = useUploadProjectFolder(projectId);
  const mkdirMutation = useMkdir(projectId);
  const deleteMutation = useDeleteProjectFile(projectId);
  const extractMutation = useExtractArchive(projectId);

  const [showUpload, setShowUpload] = useState(false);
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; path: string } | null>(null);

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadIsFolder, setUploadIsFolder] = useState(false);
  const [uploadTargetDir, setUploadTargetDir] = useState('');
  const [uploadExtract, setUploadExtract] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const navigateTo = (path: string) => {
    const p = path ? `?path=${encodeURIComponent(path)}` : '';
    router.replace(`/projects/${projectId}/files${p}`, { scroll: false });
  };

  const breadcrumbs = currentPath ? currentPath.split('/') : [];

  const handleDownload = async (filePath: string) => {
    const url = getFileDownloadUrl(projectId, filePath);
    const token = getAccessToken();
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filePath.split('/').pop() || 'download';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resetUpload = () => {
    setUploadFiles([]);
    setUploadIsFolder(false);
    setUploadTargetDir('');
    setUploadExtract(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;
    try {
      if (uploadIsFolder || uploadFiles.length > 1) {
        await folderMutation.mutateAsync({ files: uploadFiles, targetDir: uploadTargetDir });
        toast.success(`Uploaded ${uploadFiles.length} files`);
      } else {
        await uploadMutation.mutateAsync({
          file: uploadFiles[0],
          targetDir: uploadTargetDir,
          extract: uploadExtract,
        });
        toast.success(uploadExtract ? 'File uploaded and extracted' : 'File uploaded');
      }
      setShowUpload(false);
      resetUpload();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleMkdir = async () => {
    if (!newDirName.trim()) return;
    const path = currentPath ? `${currentPath}/${newDirName.trim()}` : newDirName.trim();
    try {
      await mkdirMutation.mutateAsync(path);
      toast.success('Directory created');
      setShowMkdir(false);
      setNewDirName('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExtract = async (filePath: string, fileName: string) => {
    try {
      await extractMutation.mutateAsync(filePath);
      toast.success(`Extracted ${fileName}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const usagePercent = stats ? Math.min(100, Math.round((stats.used / stats.fileTotalLimit) * 100)) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Files</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowMkdir(true)}>
            <FolderPlus className="h-4 w-4 mr-1.5" /> New Folder
          </Button>
          <Button size="sm" onClick={() => { setUploadTargetDir(currentPath); setShowUpload(true); }}>
            <Upload className="h-4 w-4 mr-1.5" /> Upload
          </Button>
        </div>
      </div>

      {/* Usage bar */}
      {stats && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-foreground-muted mb-1">
            <span>{formatBytes(stats.used)} used</span>
            <span>{formatBytes(stats.fileTotalLimit)} total</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-foreground/20'}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 mb-4 text-sm">
          <button
            onClick={() => navigateTo('')}
            className="text-foreground-secondary hover:text-foreground transition-colors"
          >
            Root
          </button>
          {breadcrumbs.map((part, i) => {
            const path = breadcrumbs.slice(0, i + 1).join('/');
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-foreground-muted" />
                {isLast ? (
                  <span className="text-foreground font-medium">{part}</span>
                ) : (
                  <button
                    onClick={() => navigateTo(path)}
                    className="text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    {part}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <Loading className="py-20" />
      ) : listing && listing.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <FolderOpen className="h-8 w-8 text-foreground-muted mb-3" />
          <p className="text-foreground-secondary text-sm mb-1">No files yet</p>
          <p className="text-foreground-muted text-xs mb-4">Upload files or create a folder to get started.</p>
          <Button size="sm" onClick={() => { setUploadTargetDir(currentPath); setShowUpload(true); }}>
            <Upload className="h-4 w-4 mr-1.5" /> Upload
          </Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center px-4 py-2 bg-muted/30 border-b text-xs font-medium text-foreground-muted">
            <span className="flex-1">Name</span>
            <span className="w-20 text-right">Size</span>
            <span className="w-20 text-right ml-4">Modified</span>
            <span className="w-24 text-right ml-4">Actions</span>
          </div>
          <div className="divide-y">
            {listing?.items.map((item) => {
              const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
              return (
                <div key={item.name} className="flex items-center px-4 py-2.5 hover:bg-muted/30 transition-colors">
                  <div
                    className={`flex items-center gap-3 min-w-0 flex-1 ${item.type === 'directory' ? 'cursor-pointer' : ''}`}
                    onClick={() => item.type === 'directory' && navigateTo(itemPath)}
                  >
                    {item.type === 'directory' ? (
                      <FolderOpen className="h-4 w-4 text-foreground-secondary shrink-0" />
                    ) : (
                      <FileIcon className="h-4 w-4 text-foreground-muted shrink-0" />
                    )}
                    <span className="text-sm truncate">{item.name}</span>
                  </div>
                  <span className="text-xs text-foreground-muted w-20 text-right">
                    {item.type === 'file' ? formatBytes(item.size) : '—'}
                  </span>
                  <span className="text-xs text-foreground-muted w-20 text-right ml-4">{timeAgo(item.modifiedAt)}</span>
                  <div className="flex gap-1 w-24 justify-end ml-4">
                    {item.type === 'file' && isArchive(item.name) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="Extract archive"
                        onClick={() => handleExtract(itemPath, item.name)}
                        disabled={extractMutation.isPending}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {item.type === 'file' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="Download"
                        onClick={() => handleDownload(itemPath)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-foreground-muted hover:text-red-500"
                      title="Delete"
                      onClick={() => setDeleteTarget({ name: item.name, path: itemPath })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) { setUploadFiles([f]); setUploadIsFolder(false); setUploadExtract(false); }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        /* @ts-expect-error webkitdirectory is non-standard */
        webkitdirectory=""
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) { setUploadFiles(files); setUploadIsFolder(true); setUploadExtract(false); }
        }}
      />

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) resetUpload(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Pick buttons */}
            <div>
              <Label>Select content</Label>
              <div className="flex gap-2 mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileIcon className="h-4 w-4 mr-1.5" /> Choose File
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <FolderOpen className="h-4 w-4 mr-1.5" /> Choose Folder
                </Button>
              </div>
            </div>

            {/* Selection summary */}
            {uploadFiles.length > 0 && (
              <div className="rounded-md border px-3 py-2.5 text-sm flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {uploadIsFolder ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <FolderOpen className="h-3.5 w-3.5 text-foreground-muted shrink-0" />
                        <span className="truncate font-medium">
                          {(uploadFiles[0] as any).webkitRelativePath?.split('/')[0] || 'Folder'}
                        </span>
                      </div>
                      <p className="text-xs text-foreground-muted mt-0.5">{uploadFiles.length} files, {formatBytes(uploadFiles.reduce((s, f) => s + f.size, 0))}</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <FileIcon className="h-3.5 w-3.5 text-foreground-muted shrink-0" />
                        <span className="truncate">{uploadFiles[0].name}</span>
                      </div>
                      <p className="text-xs text-foreground-muted mt-0.5">{formatBytes(uploadFiles[0].size)}</p>
                    </>
                  )}
                  {!uploadIsFolder && uploadFiles[0] && stats && uploadFiles[0].size > stats.fileSizeLimit && (
                    <p className="text-xs text-red-500 mt-1">
                      Exceeds per-file limit ({formatBytes(stats.fileSizeLimit)})
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-foreground-muted hover:text-foreground"
                  title="Clear selection"
                  onClick={resetUpload}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div>
              <Label>Target Directory</Label>
              <Input
                value={uploadTargetDir}
                onChange={(e) => setUploadTargetDir(e.target.value)}
                placeholder="/ (project root)"
                list="dir-suggestions"
              />
              <datalist id="dir-suggestions">
                {existingDirs?.map((d) => <option key={d} value={d} />)}
              </datalist>
              <p className="text-xs text-foreground-muted mt-1">Relative to project root. Leave empty for root.</p>
            </div>
            {!uploadIsFolder && uploadFiles.length === 1 && isArchive(uploadFiles[0].name) && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadExtract}
                  onChange={(e) => setUploadExtract(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm">Extract after upload</span>
              </label>
            )}
            {stats && (
              <div>
                <div className="flex items-center justify-between text-xs text-foreground-muted mb-1">
                  <span>{formatBytes(stats.used)} used</span>
                  <span>{formatBytes(stats.fileTotalLimit)}</span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-foreground/20'}`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button
              onClick={handleUpload}
              disabled={
                uploadFiles.length === 0 ||
                (!uploadIsFolder && uploadFiles[0] && !!stats && uploadFiles[0].size > stats.fileSizeLimit) ||
                uploadMutation.isPending || folderMutation.isPending
              }
            >
              {(uploadMutation.isPending || folderMutation.isPending) ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showMkdir} onOpenChange={(open) => { setShowMkdir(open); if (!open) setNewDirName(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Folder name</Label>
            <Input
              value={newDirName}
              onChange={(e) => setNewDirName(e.target.value)}
              placeholder="my-folder"
              onKeyDown={(e) => e.key === 'Enter' && handleMkdir()}
            />
            {currentPath && (
              <p className="text-xs text-foreground-muted mt-1">
                Will be created at: {currentPath}/{newDirName || '...'}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMkdir(false)}>Cancel</Button>
            <Button onClick={handleMkdir} disabled={!newDirName.trim() || mkdirMutation.isPending}>
              {mkdirMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name}`}
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteMutation.mutateAsync(deleteTarget.path);
            toast.success(`Deleted ${deleteTarget.name}`);
          } catch (err: any) {
            toast.error(err.message);
          }
        }}
        destructive
      />
    </div>
  );
}
