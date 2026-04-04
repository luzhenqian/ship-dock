'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function TeamPage() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api('/users') });
  const [inviteRole, setInviteRole] = useState('DEVELOPER');
  const [inviteLink, setInviteLink] = useState('');
  const createInvite = useMutation({
    mutationFn: (role: string) => api('/users/invite', { method: 'POST', body: JSON.stringify({ role }) }),
    onSuccess: (data: any) => setInviteLink(`${window.location.origin}/invite/${data.token}`),
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium tracking-tight mb-6">Team</h1>
      <Card className="mb-6">
        <CardHeader><CardTitle>Invite Member</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {['ADMIN', 'DEVELOPER', 'VIEWER'].map((role) => (
              <Button key={role} variant={inviteRole === role ? 'default' : 'outline'} size="sm" onClick={() => setInviteRole(role)}>{role}</Button>
            ))}
          </div>
          <Button onClick={() => createInvite.mutate(inviteRole)} disabled={createInvite.isPending}>Generate Invite Link</Button>
          {inviteLink && (
            <div className="p-3 bg-muted rounded">
              <p className="text-sm font-mono break-all">{inviteLink}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="space-y-2">
        {users?.map((user: any) => (
          <Card key={user.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Badge>{user.role}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
