'use client';
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useGitHubInstallations, useGitHubInstallationUrl, useGitHubCallback, useDeleteGitHubInstallation } from '@/hooks/use-github-app';
import { GitBranch, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { Loading } from '@/components/ui/loading';

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading className="py-20" />}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const { data: installations, isLoading: installationsLoading } = useGitHubInstallations();
  const { data: urlData } = useGitHubInstallationUrl();
  const callback = useGitHubCallback();
  const deleteInstallation = useDeleteGitHubInstallation();
  const callbackHandled = useRef(false);

  useEffect(() => {
    if (callbackHandled.current) return;
    const installationId = searchParams.get('installation_id');
    const setupAction = searchParams.get('setup_action');
    if (installationId && setupAction) {
      callbackHandled.current = true;
      callback.mutate({ installation_id: installationId, setup_action: setupAction });
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Server Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Projects Directory</Label><Input value="/var/www" disabled /></div>
          <div><Label>Port Range</Label><Input value="3001 - 3999" disabled /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              GitHub Connection
            </CardTitle>
            {urlData?.url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = urlData.url}
              >
                <GitBranch className="mr-2 h-4 w-4" />
                Connect GitHub
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {callback.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting GitHub...
            </div>
          )}

          {installationsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : installations && installations.length > 0 ? (
            <div className="space-y-3">
              {installations.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <GitBranch className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{inst.accountLogin}</p>
                      <p className="text-xs text-muted-foreground">
                        {inst.accountType} &middot; Connected {new Date(inst.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(`https://github.com/settings/installations`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteInstallation.mutate(inst.id)}
                      disabled={deleteInstallation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No GitHub accounts connected. Connect GitHub to select repositories when creating projects and receive webhooks automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
