'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  useTestConnection, useDiscoverTables, useUploadDump, useAnalyzeFile, useCreateMigration, useCancelMigration,
} from '@/hooks/use-migrations';
import { useMigrationLogs } from '@/hooks/use-migration-logs';
import { Database, Upload, Check, X, Loader2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

type Step = 'source' | 'tables' | 'execute' | 'complete';
type SourceMode = 'REMOTE' | 'FILE' | '';
type ConflictStrategy = 'ERROR' | 'OVERWRITE' | 'SKIP';

interface TableInfo {
  tableName: string;
  schemaName: string;
  estimatedRows?: number;
  estimatedSize?: number;
  estimatedSizeFormatted?: string;
}

interface MigrationWizardProps {
  projectId: string;
  onClose: () => void;
}

export function MigrationWizard({ projectId, onClose }: MigrationWizardProps) {
  const [step, setStep] = useState<Step>('source');
  const [sourceMode, setSourceMode] = useState<SourceMode>('');
  const [connection, setConnection] = useState({
    host: '', port: 5432, username: '', password: '', database: '',
  });
  const [fileKey, setFileKey] = useState('');
  const [fileName, setFileName] = useState('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('ERROR');
  const [migrationId, setMigrationId] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  const testConnection = useTestConnection(projectId);
  const discoverTables = useDiscoverTables(projectId);
  const uploadDump = useUploadDump(projectId);
  const analyzeFile = useAnalyzeFile(projectId);
  const createMigration = useCreateMigration(projectId);
  const cancelMigration = useCancelMigration(projectId);
  const { logs, progress, status } = useMigrationLogs(migrationId);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Source Step handlers ---
  const handleTestConnection = async () => {
    setConnectionError('');
    try {
      const result = await testConnection.mutateAsync(connection);
      if (!result.success) {
        setConnectionError(result.error || 'Connection failed');
        return;
      }
      const discovered = await discoverTables.mutateAsync(connection);
      setTables(discovered.tables);
      setSelectedTables(new Set(discovered.tables.map((t: TableInfo) => `${t.schemaName}.${t.tableName}`)));
      setStep('tables');
    } catch (err: any) {
      setConnectionError(err.message || 'Connection failed');
    }
  };

  const handleFileUpload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['sql', 'dump'].includes(ext || '')) {
      setConnectionError('Only .sql and .dump files are supported');
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setConnectionError('File exceeds 1GB limit');
      return;
    }
    setConnectionError('');
    try {
      const result = await uploadDump.mutateAsync(file);
      setFileKey(result.fileKey);
      setFileName(result.fileName);
      const analyzed = await analyzeFile.mutateAsync(result.fileKey);
      setTables(analyzed.tables.map((t: any) => ({ ...t, estimatedRows: 0, estimatedSize: 0, estimatedSizeFormatted: '-' })));
      setSelectedTables(new Set(analyzed.tables.map((t: any) => `${t.schemaName}.${t.tableName}`)));
      setStep('tables');
    } catch (err: any) {
      setConnectionError(err.message || 'Upload failed');
    }
  };

  // --- Tables Step handlers ---
  const toggleTable = (key: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables.map((t) => `${t.schemaName}.${t.tableName}`)));
    }
  };

  const selectedSize = tables
    .filter((t) => selectedTables.has(`${t.schemaName}.${t.tableName}`))
    .reduce((sum, t) => sum + (t.estimatedSize || 0), 0);

  const exceedsLimit = selectedSize > 1024 * 1024 * 1024;

  const handleStartMigration = async () => {
    const selectedTableList = tables
      .filter((t) => selectedTables.has(`${t.schemaName}.${t.tableName}`))
      .map((t) => ({ tableName: t.tableName, schemaName: t.schemaName }));

    const result = await createMigration.mutateAsync({
      source: sourceMode as 'REMOTE' | 'FILE',
      connection: sourceMode === 'REMOTE' ? connection : undefined,
      fileKey: sourceMode === 'FILE' ? fileKey : undefined,
      fileName: sourceMode === 'FILE' ? fileName : undefined,
      tables: selectedTableList,
      conflictStrategy,
    });

    setMigrationId(result.id);
    setStep('execute');
  };

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Import Data</h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 text-sm text-muted-foreground">
        {(['source', 'tables', 'execute', 'complete'] as const).map((s, i) => (
          <span key={s} className={step === s ? 'text-foreground font-medium' : ''}>
            {i > 0 && ' \u2192 '}{s === 'source' ? 'Data Source' : s === 'tables' ? 'Select Tables' : s === 'execute' ? 'Migrating' : 'Complete'}
          </span>
        ))}
      </div>

      {/* Step 1: Source */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'REMOTE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => { setSourceMode('REMOTE'); setConnectionError(''); }}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Database className="h-8 w-8" />
                <p className="font-medium">Remote Database</p>
                <p className="text-xs text-muted-foreground">Connect directly to a PostgreSQL database</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${sourceMode === 'FILE' ? 'border-primary' : 'hover:border-muted-foreground/50'}`}
              onClick={() => { setSourceMode('FILE'); setConnectionError(''); }}
            >
              <CardContent className="flex flex-col items-center gap-2 py-6">
                <Upload className="h-8 w-8" />
                <p className="font-medium">Upload File</p>
                <p className="text-xs text-muted-foreground">Import from .sql or .dump file</p>
              </CardContent>
            </Card>
          </div>

          {sourceMode === 'REMOTE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Host</Label>
                  <Input value={connection.host} onChange={(e) => setConnection({ ...connection, host: e.target.value })} placeholder="localhost" />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input type="number" value={connection.port} onChange={(e) => setConnection({ ...connection, port: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Username</Label>
                  <Input value={connection.username} onChange={(e) => setConnection({ ...connection, username: e.target.value })} />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" value={connection.password} onChange={(e) => setConnection({ ...connection, password: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Database</Label>
                <Input value={connection.database} onChange={(e) => setConnection({ ...connection, database: e.target.value })} />
              </div>
              {connectionError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {connectionError}
                </p>
              )}
              <Button
                onClick={handleTestConnection}
                disabled={!connection.host || !connection.username || !connection.database || testConnection.isPending || discoverTables.isPending}
              >
                {(testConnection.isPending || discoverTables.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Test Connection &amp; Discover Tables
              </Button>
            </div>
          )}

          {sourceMode === 'FILE' && (
            <div className="space-y-3">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {uploadDump.isPending || analyzeFile.isPending ? 'Uploading and analyzing...' : 'Click or drag and drop a .sql or .dump file (max 1GB)'}
                </p>
                {(uploadDump.isPending || analyzeFile.isPending) && <Loader2 className="h-4 w-4 mx-auto mt-2 animate-spin" />}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql,.dump"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              {connectionError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {connectionError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Tables */}
      {step === 'tables' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedTables.size === tables.length} onChange={toggleAll} />
                Select all ({tables.length} tables)
              </label>
            </div>
            {sourceMode === 'REMOTE' && (
              <span className={`text-sm ${exceedsLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                Total: {formatBytes(selectedSize)} {exceedsLimit && '(exceeds 1GB limit)'}
              </span>
            )}
          </div>

          <div className="border rounded-lg max-h-80 overflow-y-auto">
            {tables.map((t) => {
              const key = `${t.schemaName}.${t.tableName}`;
              return (
                <label key={key} className="flex items-center gap-3 px-3 py-2 border-b last:border-0 hover:bg-muted/50 cursor-pointer">
                  <input type="checkbox" checked={selectedTables.has(key)} onChange={() => toggleTable(key)} />
                  <span className="flex-1 font-mono text-sm">{t.schemaName !== 'public' ? `${t.schemaName}.` : ''}{t.tableName}</span>
                  <span className="text-xs text-muted-foreground w-20 text-right">{t.estimatedRows?.toLocaleString() ?? '-'} rows</span>
                  <span className="text-xs text-muted-foreground w-20 text-right">{t.estimatedSizeFormatted || '-'}</span>
                </label>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>Conflict Strategy (when table already exists)</Label>
            <div className="flex gap-3">
              {([['ERROR', 'Stop on conflict'], ['OVERWRITE', 'Drop & reimport'], ['SKIP', 'Skip existing']] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="conflict" checked={conflictStrategy === value} onChange={() => setConflictStrategy(value)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('source')}>Back</Button>
            <Button onClick={handleStartMigration} disabled={selectedTables.size === 0 || exceedsLimit || createMigration.isPending}>
              {createMigration.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Start Migration ({selectedTables.size} tables)
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
              <span>{progress?.currentTable ? `Migrating: ${progress.currentTable}` : 'Starting...'}</span>
              <span>{progress ? `${progress.completedTables}/${progress.totalTables} tables` : ''}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: progress ? `${(progress.completedTables / progress.totalTables) * 100}%` : '0%' }}
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
              <Check className="h-4 w-4" /> Migration completed successfully
            </div>
          )}
          {status === 'FAILED' && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> Migration failed. Check logs for details.
            </div>
          )}

          <div className="flex gap-2">
            {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) && (
              <Button variant="destructive" size="sm" onClick={() => cancelMigration.mutate(migrationId)}>
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
