'use client';
import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Loading } from '@/components/ui/loading';

interface DnsRecord { name: string; type: string; value: string; ttl?: number }

export default function DomainsPage() {
  const qc = useQueryClient();
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api<any[]>('/domains/providers') });
  const [form, setForm] = useState({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState({ name: '', type: 'A', value: '', ttl: '600' });
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ apiKey: '', apiSecret: '' });
  const [editingRecord, setEditingRecord] = useState<number | null>(null);
  const [editRecordForm, setEditRecordForm] = useState({ name: '', type: '', value: '', ttl: '' });

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    destructive?: boolean;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const showConfirm = useCallback((opts: Omit<typeof confirmDialog, 'open'>) => {
    setConfirmDialog({ ...opts, open: true });
  }, []);

  const addProvider = useMutation({
    mutationFn: (data: any) => api('/domains/providers', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setForm({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' }); setShowAddForm(false); },
  });
  const deleteProvider = useMutation({
    mutationFn: (id: string) => api(`/domains/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setExpandedProvider(null); setSelectedDomain(null); },
  });
  const updateProvider = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api(`/domains/providers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setEditingProvider(null); toast.success('Provider updated'); },
    onError: () => toast.error('Failed to update provider'),
  });
  const startEditing = async (p: any) => {
    const detail = await api<any>(`/domains/providers/${p.id}`);
    setEditForm({ apiKey: detail.apiKey, apiSecret: detail.apiSecret });
    setEditingProvider(p.id);
  };

  const { data: domains, isLoading: domainsLoading, error: domainsError } = useQuery({
    queryKey: ['domains', expandedProvider],
    queryFn: () => api<string[]>(`/domains/providers/${expandedProvider}/domains`),
    enabled: !!expandedProvider,
  });

  const { data: records, isLoading: recordsLoading } = useQuery({
    queryKey: ['dns-records', expandedProvider, selectedDomain],
    queryFn: () => api<DnsRecord[]>(`/domains/providers/${expandedProvider}/domains/${selectedDomain}/records`),
    enabled: !!expandedProvider && !!selectedDomain,
  });

  const addRecord = useMutation({
    mutationFn: (data: any) => api(`/domains/providers/${expandedProvider}/domains/${selectedDomain}/records`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dns-records', expandedProvider, selectedDomain] }); setRecordForm({ name: '', type: 'A', value: '', ttl: '600' }); toast.success('Record added'); },
    onError: (e: Error) => toast.error(e.message || 'Failed to add record'),
  });

  const deleteRecord = useMutation({
    mutationFn: ({ type, name }: { type: string; name: string }) => api(`/domains/providers/${expandedProvider}/domains/${selectedDomain}/records/${type}/${name}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dns-records', expandedProvider, selectedDomain] }); toast.success('Record deleted'); },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete record'),
  });

  const updateRecord = useMutation({
    mutationFn: ({ original, updated }: { original: DnsRecord; updated: DnsRecord }) =>
      api(`/domains/providers/${expandedProvider}/domains/${selectedDomain}/records`, { method: 'PUT', body: JSON.stringify({ original, updated }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dns-records', expandedProvider, selectedDomain] }); setEditingRecord(null); toast.success('Record updated'); },
    onError: (e: Error) => toast.error(e.message || 'Failed to update record'),
  });

  // Reset selected domain when provider changes
  useEffect(() => { setSelectedDomain(null); }, [expandedProvider]);

  const providerLabel = (provider: string, field: 'key' | 'secret') => {
    if (provider === 'NAMECHEAP') return field === 'key' ? 'Username' : 'API Key';
    return field === 'key' ? 'API Key' : 'API Secret';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium tracking-tight">Domain Providers</h1>
        {!showAddForm && (
          <Button size="sm" onClick={() => setShowAddForm(true)}>Add Provider</Button>
        )}
      </div>

      {/* Add Provider */}
      {showAddForm && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>Add Provider</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={form.provider === 'NAMECHEAP' ? 'default' : 'outline'} onClick={() => setForm((f) => ({ ...f, provider: 'NAMECHEAP' }))}>Namecheap</Button>
              <Button size="sm" variant={form.provider === 'GODADDY' ? 'default' : 'outline'} onClick={() => setForm((f) => ({ ...f, provider: 'GODADDY' }))}>GoDaddy</Button>
            </div>
            <div className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
              {form.provider === 'NAMECHEAP' ? (
                <>
                  <p className="font-medium text-foreground">How to get Namecheap API Key</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Log in to Namecheap, go to <span className="font-mono text-xs">Profile &gt; Tools &gt; API Access</span></li>
                    <li>Enable API Access (requires account balance ≥ $50 or 20+ domains)</li>
                    <li>Add your server IP to the whitelisted IPs</li>
                    <li>Fill in your Namecheap <strong>username</strong> and the generated <strong>API Key</strong> below</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-medium text-foreground">How to get GoDaddy API Key</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Go to <span className="font-mono text-xs">developer.godaddy.com/keys</span></li>
                    <li>Click &quot;Create New API Key&quot;, select <strong>Production</strong> environment</li>
                    <li>Copy the generated <strong>Key</strong> and <strong>Secret</strong> (secret is shown only once)</li>
                  </ol>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>{providerLabel(form.provider, 'key')}</Label><Input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={form.provider === 'NAMECHEAP' ? 'your-namecheap-username' : ''} /></div>
              <div><Label>{providerLabel(form.provider, 'secret')}</Label><Input type="password" value={form.apiSecret} onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} /></div>
            </div>
            <Button onClick={() => addProvider.mutate(form)} disabled={addProvider.isPending}>Add Provider</Button>
          </CardContent>
        </Card>
      )}

      {/* Provider List */}
      <div className="space-y-4">
        {providers?.map((p: any) => (
          <Card key={p.id}>
            <CardContent className="py-4 space-y-0">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline">{p.provider}</Badge>
                  <span className="text-sm text-muted-foreground font-mono truncate">
                    {providerLabel(p.provider, 'key')}: {p.apiKey}
                  </span>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => editingProvider === p.id ? setEditingProvider(null) : startEditing(p)}>
                    {editingProvider === p.id ? 'Cancel' : 'Edit'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}
                  >
                    {expandedProvider === p.id ? 'Hide Domains' : 'Domains'}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => showConfirm({
                    title: 'Remove Provider',
                    description: `This will remove the ${p.provider} provider and its stored credentials. This action cannot be undone.`,
                    confirmText: 'remove',
                    destructive: true,
                    onConfirm: () => deleteProvider.mutate(p.id),
                  })}>Remove</Button>
                </div>
              </div>

              {/* Edit Provider Form */}
              {editingProvider === p.id && (
                <div className="border-t mt-4 pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>{providerLabel(p.provider, 'key')}</Label><Input value={editForm.apiKey} onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))} className="font-mono" /></div>
                    <div><Label>{providerLabel(p.provider, 'secret')}</Label><Input type="password" value={editForm.apiSecret} onChange={(e) => setEditForm((f) => ({ ...f, apiSecret: e.target.value }))} className="font-mono" /></div>
                  </div>
                  <Button size="sm" onClick={() => showConfirm({
                    title: 'Update Provider Credentials',
                    description: `Are you sure you want to update the credentials for this ${p.provider} provider?`,
                    destructive: false,
                    onConfirm: () => updateProvider.mutate({ id: p.id, data: editForm }),
                  })} disabled={updateProvider.isPending}>Save</Button>
                </div>
              )}

              {/* Domains + DNS Records */}
              {expandedProvider === p.id && (
                <div className="border-t mt-4 pt-4">
                  {domainsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading domains...</p>
                  ) : domainsError ? (
                    <p className="text-sm text-destructive">{(domainsError as any)?.message || 'Failed to load domains'}</p>
                  ) : !domains?.length ? (
                    <p className="text-sm text-muted-foreground">No domains found</p>
                  ) : (
                    <div className="flex gap-6 min-h-[200px]">
                      {/* Left: Domain List */}
                      <div className="w-56 shrink-0 space-y-0.5">
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Domains</p>
                        {domains.map((domain: string) => (
                          <button
                            key={domain}
                            className={`w-full text-left px-3 py-1.5 rounded text-sm font-mono transition-colors ${selectedDomain === domain ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                            onClick={() => { setSelectedDomain(selectedDomain === domain ? null : domain); setEditingRecord(null); }}
                          >
                            {domain}
                          </button>
                        ))}
                      </div>

                      {/* Right: DNS Records */}
                      <div className="flex-1 min-w-0">
                        {!selectedDomain ? (
                          <p className="text-sm text-muted-foreground pt-6">Select a domain to view DNS records</p>
                        ) : (
                          <div className="space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              DNS Records — {selectedDomain}
                            </p>

                            {recordsLoading ? (
                              <Loading className="py-4" />
                            ) : (
                              <>
                                {/* Records Table */}
                                <div className="rounded-md border divide-y">
                                  {records?.map((r, i) => (
                                    <div key={i}>
                                      {editingRecord === i ? (
                                        /* Edit Mode */
                                        <div className="px-3 py-2 space-y-2 bg-muted/30">
                                          <div className="flex items-end gap-2">
                                            <div className="w-20">
                                              <Label className="text-xs">Type</Label>
                                              <select
                                                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                                                value={editRecordForm.type}
                                                onChange={(e) => setEditRecordForm((f) => ({ ...f, type: e.target.value }))}
                                              >
                                                <option value="A">A</option>
                                                <option value="A+DDNS">A + Dynamic DNS</option>
                                                <option value="AAAA">AAAA</option>
                                                <option value="ALIAS">ALIAS</option>
                                                <option value="CAA">CAA</option>
                                                <option value="CNAME">CNAME</option>
                                                <option value="MX">MX</option>
                                                <option value="NS">NS</option>
                                                <option value="SRV">SRV</option>
                                                <option value="TXT">TXT</option>
                                                <option value="URL">URL Redirect</option>
                                              </select>
                                            </div>
                                            <div className="w-32">
                                              <Label className="text-xs">Name</Label>
                                              <Input className="h-8 font-mono" value={editRecordForm.name} onChange={(e) => setEditRecordForm((f) => ({ ...f, name: e.target.value }))} />
                                            </div>
                                            <div className="flex-1">
                                              <Label className="text-xs">Value</Label>
                                              <Input className="h-8 font-mono" value={editRecordForm.value} onChange={(e) => setEditRecordForm((f) => ({ ...f, value: e.target.value }))} />
                                            </div>
                                            <div className="w-20">
                                              <Label className="text-xs">TTL</Label>
                                              <Input className="h-8 font-mono" value={editRecordForm.ttl} onChange={(e) => setEditRecordForm((f) => ({ ...f, ttl: e.target.value }))} />
                                            </div>
                                          </div>
                                          <div className="flex gap-1.5">
                                            <Button
                                              size="sm"
                                              className="h-7 text-xs"
                                              disabled={updateRecord.isPending}
                                              onClick={() => showConfirm({
                                                title: 'Update DNS Record',
                                                description: `Update ${r.type} record "${r.name}" on ${selectedDomain}?`,
                                                destructive: false,
                                                onConfirm: () => updateRecord.mutate({
                                                  original: r,
                                                  updated: { name: editRecordForm.name, type: editRecordForm.type, value: editRecordForm.value, ttl: parseInt(editRecordForm.ttl) || 600 },
                                                }),
                                              })}
                                            >
                                              Save
                                            </Button>
                                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingRecord(null)}>Cancel</Button>
                                          </div>
                                        </div>
                                      ) : (
                                        /* View Mode */
                                        <div className="flex items-center justify-between px-3 py-1.5 text-sm group">
                                          <div className="flex items-center gap-3 min-w-0">
                                            <Badge variant="secondary" className="shrink-0 font-mono text-xs w-14 justify-center">{r.type}</Badge>
                                            <span className="font-mono w-28 truncate shrink-0">{r.name}</span>
                                            <span className="text-muted-foreground font-mono truncate">{r.value}</span>
                                            {r.ttl != null && <span className="text-xs text-muted-foreground shrink-0">TTL {r.ttl}</span>}
                                          </div>
                                          <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 text-xs"
                                              onClick={() => { setEditingRecord(i); setEditRecordForm({ name: r.name, type: r.type, value: r.value, ttl: String(r.ttl || 600) }); }}
                                            >
                                              Edit
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 text-xs text-destructive hover:text-destructive"
                                              onClick={() => showConfirm({
                                                title: 'Delete DNS Record',
                                                description: `Delete ${r.type} record "${r.name}" (${r.value}) from ${selectedDomain}? This action cannot be undone.`,
                                                confirmText: 'delete',
                                                destructive: true,
                                                onConfirm: () => deleteRecord.mutate({ type: r.type, name: r.name }),
                                              })}
                                            >
                                              Delete
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {(!records || records.length === 0) && (
                                    <p className="px-3 py-3 text-sm text-muted-foreground">No records</p>
                                  )}
                                </div>

                                {/* Add Record */}
                                <div className="flex items-end gap-2">
                                  <div className="w-20">
                                    <Label className="text-xs">Type</Label>
                                    <select
                                      className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                                      value={recordForm.type}
                                      onChange={(e) => setRecordForm((f) => ({ ...f, type: e.target.value }))}
                                    >
                                      <option value="A">A</option>
                                      <option value="CNAME">CNAME</option>
                                      <option value="TXT">TXT</option>
                                      <option value="MX">MX</option>
                                    </select>
                                  </div>
                                  <div className="w-32">
                                    <Label className="text-xs">Name</Label>
                                    <Input className="h-8 font-mono" value={recordForm.name} onChange={(e) => setRecordForm((f) => ({ ...f, name: e.target.value }))} placeholder="@" />
                                  </div>
                                  <div className="flex-1">
                                    <Label className="text-xs">Value</Label>
                                    <Input className="h-8 font-mono" value={recordForm.value} onChange={(e) => setRecordForm((f) => ({ ...f, value: e.target.value }))} placeholder="1.2.3.4" />
                                  </div>
                                  <div className="w-20">
                                    <Label className="text-xs">TTL</Label>
                                    <Input className="h-8 font-mono" value={recordForm.ttl} onChange={(e) => setRecordForm((f) => ({ ...f, ttl: e.target.value }))} />
                                  </div>
                                  <Button
                                    size="sm"
                                    className="h-8"
                                    onClick={() => showConfirm({
                                      title: 'Add DNS Record',
                                      description: `Add ${recordForm.type} record "${recordForm.name}" → ${recordForm.value} to ${selectedDomain}?`,
                                      destructive: false,
                                      onConfirm: () => addRecord.mutate({ ...recordForm, ttl: parseInt(recordForm.ttl) || 600 }),
                                    })}
                                    disabled={!recordForm.name || !recordForm.value || addRecord.isPending}
                                  >
                                    Add
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        destructive={confirmDialog.destructive}
        onConfirm={confirmDialog.onConfirm}
      />
    </div>
  );
}
