'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  useTestStorageConnection, useDiscoverStorageObjects, useValidateUrls,
  useUploadImportFiles, useCreateStorageImport, useCancelStorageImport,
} from '@/hooks/use-storage-import';
import { useStorageImportProgress } from '@/hooks/use-storage-import-progress';
import { Cloud, Upload, Link, Check, X, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

type Step = 'source' | 'conflict' | 'execute';
type SourceMode = 'REMOTE' | 'UPLOAD' | 'URL' | '';
type ConflictStrategy = 'OVERWRITE' | 'SKIP' | 'ERROR';

interface StorageObject {
  key: string;
  size: number;
  lastModified?: string;
}

interface StorageImportWizardProps {
  projectId: string;
  bucket: string;
  prefix: string;
  onClose: () => void;
}

export function StorageImportWizard({ projectId, bucket, prefix, onClose }: StorageImportWizardProps) {
  const [step, setStep] = useState<Step>('source');
  const [sourceMode, setSourceMode] = useState<SourceMode>('');

  // Remote S3/MinIO state
  const [connection, setConnection] = useState({
    endpoint: '', port: 9000, accessKey: '', secretKey: '', useSSL: false,
  });
  const [remoteBuckets, setRemoteBuckets] = useState<string[]>([]);
  const [selectedRemoteBucket, setSelectedRemoteBucket] = useState('');
  const [remotePrefix, setRemotePrefix] = useState('');
  const [remoteObjects, setRemoteObjects] = useState<StorageObject[]>([]);
  const [selectedObjects, setSelectedObjects] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [browsed, setBrowsed] = useState(false);

  // Upload state
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadedFileKeys, setUploadedFileKeys] = useState<string[]>([]);

  // URL state
  const [urlText, setUrlText] = useState('');
  const [urlValidation, setUrlValidation] = useState<{ url: string; valid: boolean; error?: string }[] | null>(null);

  // Conflict + execution state
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('SKIP');
  const [importId, setImportId] = useState('');
  const [showLogs, setShowLogs] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const testConnection = useTestStorageConnection(projectId);
  const discoverObjects = useDiscoverStorageObjects(projectId);
  const validateUrls = useValidateUrls(projectId);
  const uploadImportFiles = useUploadImportFiles(projectId, setUploadPercent);
  const createImport = useCreateStorageImport(projectId);
  const cancelImport = useCancelStorageImport(projectId);
  const { logs, progress, status } = useStorageImportProgress(projectId, importId);

  const archiveExtensions = ['zip', 'tar', 'tar.gz', 'tgz', 'tar.bz2', 'gz'];
  const isArchive = (name: string) => archiveExtensions.some((ext) => name.toLowerCase().endsWith(`.${ext}`));

  // --- Remote handlers ---
  const handleTestConnection = async () => {
    try {
      const result = await testConnection.mutateAsync(connection);
      if (!result.success) {
        toast.error(result.error || 'Connection failed');
        return;
      }
      setRemoteBuckets(result.buckets || []);
      setConnected(true);
      toast.success('Connected successfully');
    } catch (err: any) {
      toast.error(err.message || 'Connection failed');
    }
  };

  const handleBrowseBucket = async () => {
    try {
      const result = await discoverObjects.mutateAsync({
        connection, bucket: selectedRemoteBucket, prefix: remotePrefix || undefined,
      });
      setRemoteObjects(result.objects || []);
      setSelectedObjects(new Set((result.objects || []).map((o: StorageObject) => o.key)));
      setBrowsed(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to browse bucket');
    }
  };

  const toggleObject = (key: string) => {
    setSelectedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllObjects = () => {
    if (selectedObjects.size === remoteObjects.length) {
      setSelectedObjects(new Set());
    } else {
      setSelectedObjects(new Set(remoteObjects.map((o) => o.key)));
    }
  };

  // --- Upload handlers ---
  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    setUploadFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // --- URL handlers ---
  const handleValidateUrls = async () => {
    const urls = urlText.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      toast.error('Enter at least one URL');
      return;
    }
    try {
      const result = await validateUrls.mutateAsync(urls);
      setUrlValidation(result.results || []);
    } catch (err: any) {
      toast.error(err.message || 'Validation failed');
    }
  };

  // --- Navigation ---
  const canProceedFromSource = () => {
    if (sourceMode === 'REMOTE') return selectedObjects.size > 0;
    if (sourceMode === 'UPLOAD') return uploadFiles.length > 0;
    if (sourceMode === 'URL') return urlValidation?.some((v) => v.valid) ?? false;
    return false;
  };

  const handleNext = () => {
    if (step === 'source') setStep('conflict');
    else if (step === 'conflict') handleStartImport();
  };

  const handleBack = () => {
    if (step === 'conflict') setStep('source');
  };

  // --- Start import ---
  const handleStartImport = async () => {
    try {
      // For upload source, upload files first
      if (sourceMode === 'UPLOAD') {
        const result = await uploadImportFiles.mutateAsync(uploadFiles);
        const fileKeys = (result.files || []).map((f: any) => f.fileKey);
        setUploadedFileKeys(fileKeys);
        const importResult = await createImport.mutateAsync({
          source: 'FILE',
          fileKeys,
          targetBucket: bucket,
          targetPrefix: prefix,
          conflictStrategy,
          totalFiles: uploadFiles.length,
        });
        setImportId(importResult.id);
      } else if (sourceMode === 'REMOTE') {
        const importResult = await createImport.mutateAsync({
          source: 'REMOTE',
          connection,
          sourceBucket: selectedRemoteBucket,
          objectKeys: Array.from(selectedObjects),
          targetBucket: bucket,
          targetPrefix: prefix,
          conflictStrategy,
          totalFiles: selectedObjects.size,
        });
        setImportId(importResult.id);
      } else if (sourceMode === 'URL') {
        const validUrls = urlValidation?.filter((v) => v.valid).map((v) => v.url) || [];
        const importResult = await createImport.mutateAsync({
          source: 'URL',
          urls: validUrls,
          targetBucket: bucket,
          targetPrefix: prefix,
          conflictStrategy,
          totalFiles: validUrls.length,
        });
        setImportId(importResult.id);
      }
      setStep('execute');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start import');
    }
  };

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Import Files</h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 text-sm text-muted-foreground">
        {(['source', 'conflict', 'execute'] as const).map((s, i) => (
          <span key={s} className={step === s ? 'text-foreground font-medium' : ''}>
            {i > 0 && ' \u2192 '}{s === 'source' ? 'Source' : s === 'conflict' ? 'Conflict Strategy' : 'Importing'}
          </span>
        ))}
      </div>

      {/* Step 1: Source */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'REMOTE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('REMOTE')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Cloud className="h-8 w-8" />
                <p className="font-medium">Remote S3/MinIO</p>
                <p className="text-xs text-muted-foreground text-center">Import from another S3-compatible server</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'UPLOAD' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('UPLOAD')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Upload className="h-8 w-8" />
                <p className="font-medium">Upload Files</p>
                <p className="text-xs text-muted-foreground text-center">Upload files directly from your computer</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'URL' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => setSourceMode('URL')}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Link className="h-8 w-8" />
                <p className="font-medium">URL Import</p>
                <p className="text-xs text-muted-foreground text-center">Import files from public URLs</p>
              </CardContent>
            </Card>
          </div>

          {/* Remote S3/MinIO form */}
          {sourceMode === 'REMOTE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Endpoint</Label>
                  <Input value={connection.endpoint} onChange={(e) => setConnection({ ...connection, endpoint: e.target.value })} placeholder="s3.amazonaws.com" />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input type="number" value={connection.port} onChange={(e) => setConnection({ ...connection, port: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Access Key</Label>
                  <Input value={connection.accessKey} onChange={(e) => setConnection({ ...connection, accessKey: e.target.value })} />
                </div>
                <div>
                  <Label>Secret Key</Label>
                  <Input type="password" value={connection.secretKey} onChange={(e) => setConnection({ ...connection, secretKey: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={connection.useSSL} onChange={(e) => setConnection({ ...connection, useSSL: e.target.checked })} />
                Use SSL
              </label>

              {!connected && (
                <Button
                  onClick={handleTestConnection}
                  disabled={!connection.endpoint || !connection.accessKey || !connection.secretKey || testConnection.isPending}
                >
                  {testConnection.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Test Connection
                </Button>
              )}

              {connected && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Check className="h-4 w-4" /> Connected
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Bucket</Label>
                      <select
                        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                        value={selectedRemoteBucket}
                        onChange={(e) => { setSelectedRemoteBucket(e.target.value); setBrowsed(false); }}
                      >
                        <option value="">Select a bucket</option>
                        {remoteBuckets.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Prefix (optional)</Label>
                      <Input value={remotePrefix} onChange={(e) => setRemotePrefix(e.target.value)} placeholder="path/to/files/" />
                    </div>
                  </div>
                  <Button
                    onClick={handleBrowseBucket}
                    disabled={!selectedRemoteBucket || discoverObjects.isPending}
                  >
                    {discoverObjects.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Browse
                  </Button>

                  {browsed && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={selectedObjects.size === remoteObjects.length && remoteObjects.length > 0} onChange={toggleAllObjects} />
                          Select all ({remoteObjects.length} objects)
                        </label>
                      </div>
                      <div className="border rounded-lg max-h-60 overflow-y-auto">
                        {remoteObjects.map((obj) => (
                          <label key={obj.key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 hover:bg-muted/50 cursor-pointer">
                            <input type="checkbox" checked={selectedObjects.has(obj.key)} onChange={() => toggleObject(obj.key)} />
                            <span className="flex-1 font-mono text-sm truncate">{obj.key}</span>
                            <span className="text-xs text-muted-foreground">{formatBytes(obj.size)}</span>
                          </label>
                        ))}
                        {remoteObjects.length === 0 && (
                          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No objects found</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Upload Files form */}
          {sourceMode === 'UPLOAD' && (
            <div className="space-y-3">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFilesSelected(e.dataTransfer.files);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click or drag and drop files</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFilesSelected(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
              {uploadFiles.length > 0 && (
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {uploadFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 border-b last:border-0">
                      <span className="flex-1 font-mono text-sm truncate">{file.name}</span>
                      {isArchive(file.name) && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">extract</span>
                      )}
                      <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => removeFile(i)}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* URL Import form */}
          {sourceMode === 'URL' && (
            <div className="space-y-3">
              <div>
                <Label>URLs (one per line)</Label>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono min-h-[120px] resize-y"
                  value={urlText}
                  onChange={(e) => { setUrlText(e.target.value); setUrlValidation(null); }}
                  placeholder={"https://example.com/file1.png\nhttps://example.com/file2.jpg"}
                />
              </div>
              <Button onClick={handleValidateUrls} disabled={!urlText.trim() || validateUrls.isPending}>
                {validateUrls.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Validate URLs
              </Button>
              {urlValidation && (
                <div className="border rounded-lg max-h-60 overflow-y-auto">
                  {urlValidation.map((v, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 border-b last:border-0">
                      {v.valid ? <Check className="h-4 w-4 text-green-600 shrink-0" /> : <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className="flex-1 font-mono text-sm truncate">{v.url}</span>
                      {v.error && <span className="text-xs text-destructive">{v.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Next button */}
          {sourceMode && (
            <div className="flex gap-2">
              <Button onClick={handleNext} disabled={!canProceedFromSource()}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Conflict Strategy */}
      {step === 'conflict' && (
        <div className="space-y-4">
          <div className="space-y-3">
            <Label>When a file with the same name already exists:</Label>
            <div className="space-y-2">
              {([
                ['OVERWRITE', 'Overwrite', 'replace the existing file with the imported one'],
                ['SKIP', 'Skip', 'keep the existing file and skip the import'],
                ['ERROR', 'Error', 'stop the import and report an error'],
              ] as const).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="conflict" className="mt-0.5" checked={conflictStrategy === value} onChange={() => setConflictStrategy(value)} />
                  <span><span className="font-medium">{label}</span> — {desc}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleBack}>Back</Button>
            <Button onClick={handleNext} disabled={createImport.isPending || uploadImportFiles.isPending}>
              {(createImport.isPending || uploadImportFiles.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Start Import
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Execute */}
      {step === 'execute' && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{progress?.currentFile ? `Importing: ${progress.currentFile}` : 'Starting...'}</span>
              <span>{progress ? `${progress.completedFiles}/${progress.totalFiles} files` : ''}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: progress ? `${(progress.completedFiles / progress.totalFiles) * 100}%` : '0%' }}
              />
            </div>
          </div>

          {/* Log toggle */}
          <Button variant="ghost" size="sm" onClick={() => setShowLogs(!showLogs)}>
            {showLogs ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showLogs ? 'Hide' : 'Show'} Logs ({logs.length})
          </Button>

          {showLogs && (
            <div className="bg-muted/50 rounded-lg p-3 max-h-60 overflow-y-auto font-mono text-xs space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className={log.level === 'error' ? 'text-destructive' : log.level === 'warn' ? 'text-yellow-500' : ''}>
                  <span className="text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                  {log.message}
                </div>
              ))}
              {logs.length === 0 && <p className="text-muted-foreground">Waiting for logs...</p>}
            </div>
          )}

          {/* Status message */}
          {status === 'COMPLETED' && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="h-4 w-4" /> Import completed successfully
            </div>
          )}
          {status === 'FAILED' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> Import failed. Check logs for details.
            </div>
          )}
          {status === 'CANCELLED' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <X className="h-4 w-4" /> Import was cancelled.
            </div>
          )}

          <div className="flex gap-2">
            {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button variant="destructive" size="sm" onClick={() => cancelImport.mutate(importId)}>
                Cancel
              </Button>
            )}
            {['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button onClick={onClose}>Done</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
