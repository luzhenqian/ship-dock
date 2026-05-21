'use client';
import { use, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  FolderOpen, File as FileIcon, Download, Trash2, Archive, Upload, FolderPlus, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

  const [uploadMode, setUploadMode] = useState<'file' | 'folder'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
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

  const handleUpload = async () => {
    try {
      if (uploadMode === 'folder') {
        if (uploadFiles.length === 0) return;
        await folderMutation.mutateAsync({ files: uploadFiles, targetDir: uploadTargetDir });
        toast.success(`Uploaded ${uploadFiles.length} files`);
      } else {
        if (!uploadFile) return;
        await uploadMutation.mutateAsync({
          file: uploadFile,
          targetDir: uploadTargetDir,
          extract: uploadExtract,
        });
        toast.success(uploadExtract ? 'File uploaded and extracted' : 'File uploaded');
      }
      setShowUpload(false);
      setUploadFile(null);
      setUploadFiles([]);
      setUploadTargetDir('');
      setUploadExtract(false);
      setUploadMode('file');
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Files</h2>
        {stats && (
          <div className="text-sm text-foreground-secondary">
            {formatBytes(stats.used)} / {formatBytes(stats.fileTotalLimit)}
          </div>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 mb-4 text-sm">
        <button
          onClick={() => navigateTo('')}
          className="text-foreground-secondary hover:text-foreground transition-colors"
        >
          /
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

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <Button size="sm" onClick={() => { setUploadTargetDir(currentPath); setShowUpload(true); }}>
          <Upload className="h-4 w-4 mr-1.5" /> Upload
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowMkdir(true)}>
          <FolderPlus className="h-4 w-4 mr-1.5" /> New Folder
        </Button>
      </div>

      {/* File list */}
      {isLoading ? (
        <Loading className="py-20" />
      ) : listing && listing.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <FolderOpen className="h-10 w-10 text-foreground-muted mb-3" />
          <p className="text-foreground-secondary mb-1">No files yet</p>
          <p className="text-foreground-muted text-sm mb-4">Upload files or create a folder to get started.</p>
          <Button size="sm" onClick={() => { setUploadTargetDir(currentPath); setShowUpload(true); }}>
            <Upload className="h-4 w-4 mr-1.5" /> Upload
          </Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden divide-y">
          {listing?.items.map((item) => {
            const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
            return (
              <div key={item.name} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
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
                <div className="flex items-center gap-4 shrink-0">
                  {item.type === 'file' && (
                    <span className="text-xs text-foreground-muted w-20 text-right">{formatBytes(item.size)}</span>
                  )}
                  <span className="text-xs text-foreground-muted w-16 text-right">{timeAgo(item.modifiedAt)}</span>
                  <div className="flex gap-1 w-24 justify-end">
                    {item.type === 'file' && isArchive(item.name) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
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
                        onClick={() => handleDownload(itemPath)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-foreground-muted hover:text-red-500"
                      onClick={() => setDeleteTarget({ name: item.name, path: itemPath })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={(open) => {
        setShowUpload(open);
        if (!open) { setUploadFile(null); setUploadFiles([]); setUploadExtract(false); setUploadMode('file'); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
              <button
                className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${uploadMode === 'file' ? 'bg-background shadow-sm font-medium' : 'text-foreground-secondary'}`}
                onClick={() => { setUploadMode('file'); setUploadFiles([]); }}
              >
                File
              </button>
              <button
                className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${uploadMode === 'folder' ? 'bg-background shadow-sm font-medium' : 'text-foreground-secondary'}`}
                onClick={() => { setUploadMode('folder'); setUploadFile(null); setUploadExtract(false); }}
              >
                Folder
              </button>
            </div>

            {uploadMode === 'file' ? (
              <div>
                <Label>File</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block w-full text-sm text-foreground-secondary mt-1
                    file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-border
                    file:text-sm file:font-medium file:bg-background file:text-foreground
                    hover:file:bg-muted file:cursor-pointer file:transition-colors"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setUploadFile(f);
                    setUploadExtract(false);
                  }}
                />
                {uploadFile && stats && uploadFile.size > stats.fileSizeLimit && (
                  <p className="text-xs text-red-500 mt-1">
                    File size ({formatBytes(uploadFile.size)}) exceeds limit ({formatBytes(stats.fileSizeLimit)})
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label>Folder</Label>
                <input
                  ref={folderInputRef}
                  type="file"
                  /* @ts-expect-error webkitdirectory is non-standard */
                  webkitdirectory=""
                  multiple
                  className="block w-full text-sm text-foreground-secondary mt-1
                    file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-border
                    file:text-sm file:font-medium file:bg-background file:text-foreground
                    hover:file:bg-muted file:cursor-pointer file:transition-colors"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setUploadFiles(files);
                  }}
                />
                {uploadFiles.length > 0 && (
                  <p className="text-xs text-foreground-secondary mt-1">
                    {uploadFiles.length} files, {formatBytes(uploadFiles.reduce((s, f) => s + f.size, 0))} total
                  </p>
                )}
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
            {uploadMode === 'file' && uploadFile && isArchive(uploadFile.name) && (
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
              <div className="text-xs text-foreground-muted">
                Storage: {formatBytes(stats.used)} / {formatBytes(stats.fileTotalLimit)} used
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
            <Button
              onClick={handleUpload}
              disabled={
                (uploadMode === 'file' && (!uploadFile || (!!stats && !!uploadFile && uploadFile.size > stats.fileSizeLimit))) ||
                (uploadMode === 'folder' && uploadFiles.length === 0) ||
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
