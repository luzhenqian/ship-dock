'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DomainsPage() {
  const qc = useQueryClient();
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: () => api('/domains/providers') });
  const [form, setForm] = useState({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' });
  const addProvider = useMutation({
    mutationFn: (data: any) => api('/domains/providers', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setForm({ provider: 'NAMECHEAP', apiKey: '', apiSecret: '' }); },
  });
  const deleteProvider = useMutation({
    mutationFn: (id: string) => api(`/domains/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Domain Providers</h1>
      <Card className="mb-6">
        <CardHeader><CardTitle>Add Provider</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button variant={form.provider === 'NAMECHEAP' ? 'default' : 'outline'} onClick={() => setForm((f) => ({ ...f, provider: 'NAMECHEAP' }))}>Namecheap</Button>
            <Button variant={form.provider === 'GODADDY' ? 'default' : 'outline'} onClick={() => setForm((f) => ({ ...f, provider: 'GODADDY' }))}>GoDaddy</Button>
          </div>
          <div><Label>API Key</Label><Input value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} /></div>
          <div><Label>API Secret</Label><Input type="password" value={form.apiSecret} onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} /></div>
          <Button onClick={() => addProvider.mutate(form)} disabled={addProvider.isPending}>Add Provider</Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {providers?.map((p: any) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{p.provider}</p>
                <p className="text-sm text-muted-foreground font-mono">Key: {p.apiKey} | Secret: {p.apiSecret}</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => deleteProvider.mutate(p.id)}>Remove</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
