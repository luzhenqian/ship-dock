'use client';

import { use, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDatabaseTables, useTableData, useTableStructure } from '@/hooks/use-database';
import { SqlQueryPanel } from '@/components/sql-query-panel';

type SubView = 'data' | 'structure' | 'query';

export default function DatabasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [selectedTable, setSelectedTable] = useState('');
  const [subView, setSubView] = useState<SubView>('data');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null);

  const { data: tables, isLoading: tablesLoading } = useDatabaseTables(id);
  const { data: tableData, isLoading: dataLoading } = useTableData(id, selectedTable, {
    page,
    pageSize: 50,
    sort: sort?.column,
    order: sort?.order,
  });
  const { data: structure } = useTableStructure(id, selectedTable);

  const handleSort = (column: string) => {
    setSort((prev) =>
      prev?.column === column
        ? { column, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { column, order: 'asc' },
    );
    setPage(1);
  };

  if (tablesLoading) return <div className="text-sm text-muted-foreground">Loading tables...</div>;
  if (!tables?.length) return <div className="text-sm text-muted-foreground">No PostgreSQL connection configured. Add one in Settings → Services.</div>;

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Sidebar */}
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Tables</div>
        <ScrollArea className="h-full">
          {tables.map((t: any) => (
            <button
              key={t.table_name}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedTable === t.table_name ? 'bg-muted font-medium' : ''}`}
              onClick={() => { setSelectedTable(t.table_name); setPage(1); setSort(null); }}
            >
              {t.table_name}
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {!selectedTable ? (
          <div className="text-sm text-muted-foreground">Select a table to view its data.</div>
        ) : (
          <>
            <div className="flex gap-1 mb-4">
              {(['data', 'structure', 'query'] as SubView[]).map((v) => (
                <Button key={v} size="sm" variant={subView === v ? 'default' : 'outline'} onClick={() => setSubView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Button>
              ))}
            </div>

            {subView === 'data' && tableData && (
              <>
                <div className="border rounded-md overflow-auto max-h-[calc(100vh-340px)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b sticky top-0">
                        {tableData.columns.map((col: string) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted"
                            onClick={() => handleSort(col)}
                          >
                            {col} {sort?.column === col ? (sort.order === 'asc' ? '↑' : '↓') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.rows.map((row: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          {tableData.columns.map((col: string) => (
                            <td key={col} className="px-3 py-2 whitespace-nowrap font-mono text-xs max-w-xs truncate">
                              {row[col] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                  <span>{tableData.total} rows total</span>
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
                  <div className="border rounded-md overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
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
                    <div className="border rounded-md overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b">
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

            {subView === 'query' && <SqlQueryPanel projectId={id} />}
          </>
        )}
      </div>
    </div>
  );
}
