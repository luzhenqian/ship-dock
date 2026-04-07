'use client';

import { use, useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDatabaseTables, useDatabaseOverview, useTableData, useTableStructure, useUpdateRow, useDeleteRows, useInsertRow } from '@/hooks/use-database';
import { useQueryClient } from '@tanstack/react-query';
import { SqlQueryPanel } from '@/components/sql-query-panel';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MigrationWizard } from '@/components/migration-wizard';
import { JsonPreviewDialog } from '@/components/json-preview-dialog';
import { Upload, RefreshCw } from 'lucide-react';

type SubView = 'data' | 'structure' | 'query';
type EditingCell = { rowIndex: number; column: string } | null;
type NewRow = Record<string, string> | null;

export default function DatabasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedTable = searchParams.get('table') ?? '';
  const subView = (searchParams.get('view') as SubView) || 'data';
  const page = Number(searchParams.get('page')) || 1;
  const sortParam = searchParams.get('sort');
  const orderParam = searchParams.get('order') as 'asc' | 'desc' | null;
  const sort = sortParam ? { column: sortParam, order: orderParam || 'asc' } : null;

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, pathname, router]);

  const setSelectedTable = useCallback((table: string) => {
    updateParams({ table: table || null, page: null, sort: null, order: null, view: null });
  }, [updateParams]);

  const setSubView = useCallback((view: SubView) => {
    updateParams({ view: view === 'data' ? null : view });
  }, [updateParams]);

  const setPage = useCallback((p: number) => {
    updateParams({ page: p <= 1 ? null : String(p) });
  }, [updateParams]);

  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newRow, setNewRow] = useState<NewRow>(null);
  const [newRowEditingCol, setNewRowEditingCol] = useState<string | null>(null);
  const [copiedRow, setCopiedRow] = useState<Record<string, any> | null>(null);
  const [showMigration, setShowMigration] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<{ column: string; value: any; row?: any } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const newRowRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: tables, isLoading: tablesLoading, error: tablesError } = useDatabaseTables(id);
  const { data: overview } = useDatabaseOverview(id);
  const { data: tableData, isLoading: dataLoading } = useTableData(id, selectedTable, {
    page,
    pageSize: 50,
    sort: sort?.column,
    order: sort?.order,
  });
  const { data: structure } = useTableStructure(id, selectedTable);
  const updateRow = useUpdateRow(id, selectedTable);
  const deleteRows = useDeleteRows(id, selectedTable);
  const insertRow = useInsertRow(id, selectedTable);

  const primaryKeys: string[] = structure?.primaryKeys || [];

  const toggleRowSelection = useCallback((rowIndex: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    if (!tableData) return;
    setSelectedRows((prev) =>
      prev.size === tableData.rows.length ? new Set() : new Set(tableData.rows.map((_: any, i: number) => i)),
    );
  }, [tableData]);

  const handleDeleteSelected = useCallback(async () => {
    if (!tableData || primaryKeys.length === 0) return;

    const rowPks = Array.from(selectedRows).map((i) => {
      const row = tableData.rows[i];
      const pk: Record<string, any> = {};
      for (const k of primaryKeys) pk[k] = row[k];
      return pk;
    });

    try {
      await deleteRows.mutateAsync(rowPks);
      queryClient.invalidateQueries({ queryKey: ['db-table-data', id, selectedTable] });
      setSelectedRows(new Set());
    } catch {
      // error visible via mutation state
    }
  }, [tableData, primaryKeys, selectedRows, deleteRows, queryClient, id, selectedTable]);

  const handleAddRow = useCallback(() => {
    if (!tableData) return;
    const empty: Record<string, string> = {};
    for (const col of tableData.columns) empty[col] = '';
    setNewRow(empty);
    setNewRowEditingCol(tableData.columns[0] || null);
  }, [tableData]);

  const handleCopyRow = useCallback(() => {
    if (!tableData || selectedRows.size !== 1) return;
    const idx = Array.from(selectedRows)[0];
    setCopiedRow({ ...tableData.rows[idx] });
  }, [tableData, selectedRows]);

  const handlePasteRow = useCallback(() => {
    if (!copiedRow || !tableData) return;
    const row: Record<string, string> = {};
    for (const col of tableData.columns) {
      row[col] = copiedRow[col] === null ? '' : (typeof copiedRow[col] === 'object' ? JSON.stringify(copiedRow[col]) : String(copiedRow[col]));
    }
    // Clear primary key values so DB can auto-generate
    for (const pk of primaryKeys) {
      const colDef = structure?.columns?.find((c: any) => c.column_name === pk);
      if (colDef?.column_default) row[pk] = '';
    }
    setNewRow(row);
    setNewRowEditingCol(tableData.columns[0] || null);
  }, [copiedRow, tableData, primaryKeys, structure]);

  const handleSaveNewRow = useCallback(async () => {
    if (!newRow) return;
    const data: Record<string, any> = {};
    for (const [k, v] of Object.entries(newRow)) {
      if (v !== '') data[k] = v;
    }
    try {
      await insertRow.mutateAsync(data);
      queryClient.invalidateQueries({ queryKey: ['db-table-data', id, selectedTable] });
      setNewRow(null);
      setNewRowEditingCol(null);
    } catch {
      // error visible via mutation state
    }
  }, [newRow, insertRow, queryClient, id, selectedTable]);

  const handleCancelNewRow = useCallback(() => {
    setNewRow(null);
    setNewRowEditingCol(null);
  }, []);

  const handleCellDoubleClick = useCallback((rowIndex: number, column: string, currentValue: any) => {
    if (primaryKeys.length === 0) return;
    setEditingCell({ rowIndex, column });
    setEditValue(currentValue === null ? '' : (typeof currentValue === 'object' ? JSON.stringify(currentValue, null, 2) : String(currentValue)));
  }, [primaryKeys.length]);

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const handleSaveEdit = useCallback(async (row: any) => {
    if (!editingCell || primaryKeys.length === 0) {
      setEditingCell(null);
      setEditValue('');
      return;
    }

    const originalValue = row[editingCell.column];
    const originalStr = originalValue === null ? '' : (typeof originalValue === 'object' ? JSON.stringify(originalValue, null, 2) : String(originalValue));

    if (editValue === originalStr) {
      setEditingCell(null);
      setEditValue('');
      return;
    }

    const pkValues: Record<string, any> = {};
    for (const pk of primaryKeys) {
      pkValues[pk] = row[pk];
    }

    let value: any = editValue === '' ? null : editValue;
    // Try to parse as JSON if original was an object or if it looks like JSON
    if (value !== null && (typeof originalValue === 'object' || /^\s*[\[{]/.test(value))) {
      try { value = JSON.parse(value); } catch { /* keep as string */ }
    }

    try {
      await updateRow.mutateAsync({ primaryKeys: pkValues, column: editingCell.column, value });
      queryClient.invalidateQueries({ queryKey: ['db-table-data', id, selectedTable] });
    } catch {
      // error is visible via mutation state
    }
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, primaryKeys, editValue, updateRow, queryClient, id, selectedTable]);

  useEffect(() => {
    if (editingCell && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingCell]);

  useEffect(() => {
    if (newRowEditingCol && newRowRef.current) {
      newRowRef.current.focus();
    }
  }, [newRowEditingCol]);

  const handleSort = (column: string) => {
    const newOrder = sort?.column === column && sort.order === 'asc' ? 'desc' : 'asc';
    updateParams({ sort: column, order: newOrder, page: null });
  };

  if (tablesLoading) return <div className="text-sm text-muted-foreground">Loading tables...</div>;
  if (tablesError) return <div className="text-sm text-muted-foreground">No PostgreSQL connection configured. Add one in Settings → Services.</div>;
  if (!tables?.length) return <div className="text-sm text-muted-foreground">Database is empty — no tables found. Deploy your project to run migrations.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Sidebar */}
      <div className="w-48 shrink-0 border rounded-xl">
        <div className="p-3 border-b text-[11px] font-medium text-foreground-muted uppercase tracking-wider">Tables</div>
        <ScrollArea className="h-full">
          {tables.map((t: any) => (
            <button
              key={t.table_name}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-foreground/[0.04] ${selectedTable === t.table_name ? 'bg-foreground/[0.06] font-medium' : 'text-foreground-secondary'}`}
              onClick={() => { setSelectedTable(t.table_name); setSelectedRows(new Set()); setNewRow(null); setCopiedRow(null); }}
            >
              {t.table_name}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {showMigration ? (
          <MigrationWizard projectId={id} onClose={() => setShowMigration(false)} />
        ) : !selectedTable ? (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowMigration(true)}>
                <Upload className="h-4 w-4 mr-2" /> Import Data
              </Button>
            </div>
            {overview ? (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Database Size</p>
                    <p className="text-xl font-semibold">{formatBytes(overview.dbSize)}</p>
                  </div>
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Tables</p>
                    <p className="text-xl font-semibold">{overview.tableCount}</p>
                  </div>
                  <div className="border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Rows</p>
                    <p className="text-xl font-semibold">{overview.totalRows.toLocaleString()}</p>
                  </div>
                </div>
                {/* Per-table breakdown */}
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Tables by Size</p>
                  <div className="border rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          <th className="px-3 py-2 text-left font-medium">Table</th>
                          <th className="px-3 py-2 text-right font-medium">Rows</th>
                          <th className="px-3 py-2 text-right font-medium">Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.tables.map((t: any) => (
                          <tr
                            key={t.name}
                            className="border-b last:border-0 hover:bg-foreground/[0.04] cursor-pointer"
                            onClick={() => { setSelectedTable(t.name); setSelectedRows(new Set()); setNewRow(null); setCopiedRow(null); }}
                          >
                            <td className="px-3 py-2 font-mono text-xs">{t.name}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{t.rows.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{formatBytes(t.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Select a table to view its data.</div>
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-1 mb-4">
              {(['data', 'structure', 'query'] as SubView[]).map((v) => (
                <Button key={v} size="sm" variant={subView === v ? 'default' : 'outline'} onClick={() => setSubView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Button>
              ))}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => setShowMigration(true)}>
                <Upload className="h-4 w-4 mr-2" /> Import Data
              </Button>
            </div>

            {subView === 'data' && tableData && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Button size="sm" variant="outline" onClick={handleAddRow} disabled={!!newRow}>
                    + Insert
                  </Button>
                  {primaryKeys.length > 0 && selectedRows.size === 1 && (
                    <Button size="sm" variant="outline" onClick={handleCopyRow}>
                      Copy
                    </Button>
                  )}
                  {copiedRow && (
                    <Button size="sm" variant="outline" onClick={handlePasteRow} disabled={!!newRow}>
                      Paste
                    </Button>
                  )}
                  {primaryKeys.length > 0 && selectedRows.size > 0 && (
                    <>
                      <div className="w-px h-5 bg-border" />
                      <span className="text-sm text-muted-foreground">Selected {selectedRows.size}</span>
                      <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                        Delete
                      </Button>
                    </>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['tableData', id, selectedTable] })}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="border rounded-xl overflow-auto max-h-[calc(100vh-340px)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b sticky top-0">
                        {primaryKeys.length > 0 && (
                          <th className="px-3 py-2 w-8">
                            <input
                              type="checkbox"
                              checked={tableData.rows.length > 0 && selectedRows.size === tableData.rows.length}
                              onChange={toggleAllRows}
                              className="rounded"
                            />
                          </th>
                        )}
                        {tableData.columns.map((col: string) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-foreground/[0.04]"
                            onClick={() => handleSort(col)}
                          >
                            {col} {sort?.column === col ? (sort.order === 'asc' ? '↑' : '↓') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row: any, i: number) => (
                        <tr key={i} className={`border-b last:border-0 hover:bg-foreground/[0.04] ${selectedRows.has(i) ? 'bg-foreground/[0.06]' : ''}`}>
                          {primaryKeys.length > 0 && (
                            <td className="px-3 py-2 w-8">
                              <input
                                type="checkbox"
                                checked={selectedRows.has(i)}
                                onChange={() => toggleRowSelection(i)}
                                className="rounded"
                              />
                            </td>
                          )}
                          {tableData.columns.map((col: string) => {
                            const isEditing = editingCell?.rowIndex === i && editingCell?.column === col;
                            return (
                              <td
                                key={col}
                                className={`px-3 py-2 whitespace-nowrap font-mono text-xs max-w-xs ${isEditing ? '' : 'truncate'} ${primaryKeys.length > 0 ? 'cursor-text' : ''}`}
                                onDoubleClick={() => handleCellDoubleClick(i, col, row[col])}
                              >
                                {isEditing ? (
                                  <textarea
                                    ref={editRef}
                                    className="w-full bg-background border rounded px-1.5 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring resize-y"
                                    rows={typeof row[col] === 'object' && row[col] !== null ? 4 : 1}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(row); }
                                      if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                    onBlur={() => handleSaveEdit(row)}
                                  />
                                ) : row[col] === null ? (
                                  <span className="text-muted-foreground italic">NULL</span>
                                ) : typeof row[col] === 'object' ? (
                                  <button
                                    className="text-left text-blue-500 hover:underline truncate block max-w-xs"
                                    onClick={(e) => { e.stopPropagation(); setJsonPreview({ column: col, value: row[col], row }); }}
                                  >
                                    {JSON.stringify(row[col])}
                                  </button>
                                ) : (
                                  String(row[col])
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {newRow && (
                        <tr className="border-b last:border-0 bg-green-500/5">
                          {primaryKeys.length > 0 && <td className="px-3 py-2 w-8" />}
                          {tableData.columns.map((col: string) => (
                            <td key={col} className="px-3 py-1 whitespace-nowrap font-mono text-xs">
                              <input
                                ref={newRowEditingCol === col ? newRowRef : undefined}
                                className="w-full bg-background border rounded px-1.5 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                                value={newRow[col] ?? ''}
                                placeholder={structure?.columns?.find((c: any) => c.column_name === col)?.column_default ? 'DEFAULT' : 'NULL'}
                                onChange={(e) => setNewRow((prev) => prev ? { ...prev, [col]: e.target.value } : prev)}
                                onFocus={() => setNewRowEditingCol(col)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveNewRow();
                                  if (e.key === 'Escape') handleCancelNewRow();
                                  if (e.key === 'Tab') {
                                    const cols = tableData.columns;
                                    const idx = cols.indexOf(col);
                                    const next = e.shiftKey ? cols[idx - 1] : cols[idx + 1];
                                    if (next) { e.preventDefault(); setNewRowEditingCol(next); }
                                  }
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                    {newRow && (
                      <tfoot>
                        <tr>
                          <td colSpan={tableData.columns.length + (primaryKeys.length > 0 ? 1 : 0)} className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Button size="sm" onClick={handleSaveNewRow}>Save</Button>
                              <Button size="sm" variant="outline" onClick={handleCancelNewRow}>Cancel</Button>
                              <span className="text-xs text-muted-foreground">Enter to save · Escape to cancel · Tab to move between fields</span>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {(updateRow.isError || deleteRows.isError || insertRow.isError) && (
                  <div className="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded">
                    {updateRow.isError && <>Update failed: {(updateRow.error as any)?.message || 'Unknown error'}</>}
                    {deleteRows.isError && <>Delete failed: {(deleteRows.error as any)?.message || 'Unknown error'}</>}
                    {insertRow.isError && <>Insert failed: {(insertRow.error as any)?.message || 'Unknown error'}</>}
                  </div>
                )}
                <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                  <span>{tableData.total} rows total{primaryKeys.length === 0 ? ' · No primary key (read-only)' : ''}</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button>
                    <span>{page} / {tableData.totalPages}</span>
                    <Button size="sm" variant="outline" disabled={page >= tableData.totalPages} onClick={() => setPage(page + 1)}>→</Button>
                  </div>
                </div>
              </>
            )}

            {subView === 'structure' && structure && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Columns</h3>
                  <div className="border rounded-xl overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 border-b">
                          <th className="px-3 py-2 text-left font-medium">Column</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium">Nullable</th>
                          <th className="px-3 py-2 text-left font-medium">Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {structure.columns.map((col: any) => (
                          <tr key={col.column_name} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">{col.column_name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{col.data_type}{col.character_maximum_length ? `(${col.character_maximum_length})` : ''}</td>
                            <td className="px-3 py-2 text-xs">{col.is_nullable}</td>
                            <td className="px-3 py-2 font-mono text-xs truncate max-w-xs">{col.column_default || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {structure.indexes.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Indexes</h3>
                    <div className="border rounded-xl overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30 border-b">
                            <th className="px-3 py-2 text-left font-medium">Name</th>
                            <th className="px-3 py-2 text-left font-medium">Definition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structure.indexes.map((idx: any) => (
                            <tr key={idx.indexname} className="border-b last:border-0">
                              <td className="px-3 py-2 font-mono text-xs">{idx.indexname}</td>
                              <td className="px-3 py-2 font-mono text-xs">{idx.indexdef}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {subView === 'query' && <SqlQueryPanel projectId={id} schema={tables?.reduce((acc: Record<string, string[]>, t: any) => { acc[t.table_name] = t.columns || []; return acc; }, {})} />}
          </>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete rows"
        description={`Are you sure you want to delete ${selectedRows.size} row${selectedRows.size > 1 ? 's' : ''}? This action cannot be undone.`}
        onConfirm={handleDeleteSelected}
        destructive
      />

      <JsonPreviewDialog
        open={!!jsonPreview}
        onOpenChange={(open) => { if (!open) setJsonPreview(null); }}
        title={jsonPreview?.column ?? 'JSON'}
        value={jsonPreview?.value}
        onSave={primaryKeys.length > 0 && jsonPreview?.row ? async (newValue) => {
          const pkValues: Record<string, any> = {};
          for (const pk of primaryKeys) pkValues[pk] = jsonPreview.row[pk];
          try {
            await updateRow.mutateAsync({ primaryKeys: pkValues, column: jsonPreview.column, value: newValue });
            queryClient.invalidateQueries({ queryKey: ['db-table-data', id, selectedTable] });
          } catch { /* error visible via mutation state */ }
        } : undefined}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
