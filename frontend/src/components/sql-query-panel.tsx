'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { JsonPreviewDialog } from '@/components/json-preview-dialog';
import { useExecuteQuery } from '@/hooks/use-database';

interface SqlQueryPanelProps {
  projectId: string;
}

export function SqlQueryPanel({ projectId }: SqlQueryPanelProps) {
  const [sql, setSql] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<{ column: string; value: any } | null>(null);
  const { mutate, data, isPending, error } = useExecuteQuery(projectId);

  const handleExecute = () => {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('DELETE') || trimmed.startsWith('UPDATE')) {
      setShowConfirm(true);
    } else {
      mutate(sql);
    }
  };

  return (
    <div>
      <div className="mb-3">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM users LIMIT 10;"
          className="w-full h-32 p-3 font-mono text-sm border rounded-md bg-background resize-y"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExecute();
          }}
        />
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Button size="sm" onClick={handleExecute} disabled={isPending || !sql.trim()}>
          {isPending ? 'Executing...' : 'Run Query'} <span className="text-xs text-muted-foreground ml-1">(⌘+Enter)</span>
        </Button>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.command} — {data.rowCount} row(s) affected
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 mb-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </div>
      )}

      {data?.rows?.length > 0 && (
        <div className="border rounded-xl overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b">
                {data.columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: any, i: number) => (
                <tr key={i} className="border-b last:border-0 hover:bg-foreground/[0.04]">
                  {data.columns.map((col: string) => (
                    <td key={col} className="px-3 py-2 whitespace-nowrap font-mono text-xs max-w-xs truncate">
                      {row[col] === null ? (
                        <span className="text-muted-foreground italic">NULL</span>
                      ) : typeof row[col] === 'object' ? (
                        <button
                          className="text-left text-blue-500 hover:underline truncate block max-w-xs"
                          onClick={() => setJsonPreview({ column: col, value: row[col] })}
                        >
                          {JSON.stringify(row[col])}
                        </button>
                      ) : (
                        String(row[col])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title="Execute destructive query?"
        description={`You are about to run: ${sql.slice(0, 100)}...`}
        onConfirm={() => mutate(sql)}
      />

      <JsonPreviewDialog
        open={!!jsonPreview}
        onOpenChange={(open) => { if (!open) setJsonPreview(null); }}
        title={jsonPreview?.column ?? 'JSON'}
        value={jsonPreview?.value}
      />
    </div>
  );
}
