'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import {
  useAnalyticsConnections,
  useDeleteConnection,
} from '@/hooks/use-analytics';
import { getAccessToken } from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function getProviderLabel(provider: string) {
  return provider === 'GOOGLE_GA4' ? 'Google Analytics' : 'Microsoft Clarity';
}

export default function IntegrationsPage() {
  const { data: connections, isLoading } = useAnalyticsConnections();
  const deleteConnection = useDeleteConnection();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function handleConnect(provider: 'google' | 'microsoft') {
    const token = getAccessToken();
    window.location.href = `${API_URL}/analytics/connect/${provider}?token=${token}`;
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteConnection.mutateAsync(deleteId);
      toast.success('Connection removed');
    } catch (err: any) {
      toast.error(err.message);
    }
    setDeleteId(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground">
          Connect third-party accounts to enable analytics tracking across your projects.
        </p>
      </div>

      <div className="flex gap-3">
        <Button onClick={() => handleConnect('google')}>
          Connect Google Account
        </Button>
        <Button variant="outline" onClick={() => handleConnect('microsoft')}>
          Connect Microsoft Account
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : connections?.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No accounts connected yet. Connect a Google or Microsoft account to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections?.map((conn: any) => (
            <Card key={conn.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {getProviderLabel(conn.provider)}
                  <Badge variant="secondary">{conn.accountEmail}</Badge>
                  {new Date(conn.tokenExpiry) < new Date() && (
                    <Badge variant="destructive">Expired</Badge>
                  )}
                </CardTitle>
                <CardAction>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteId(conn.id)}
                  >
                    Disconnect
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(conn.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Disconnect Account"
        description="This will remove the connection and any project integrations using this account."
        onConfirm={handleDelete}
        destructive
      />
    </div>
  );
}
