'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useProjectIntegrations, useDeleteIntegration } from '@/hooks/use-analytics';
import { toast } from 'sonner';

export default function ProjectAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { data: integrations, isLoading } = useProjectIntegrations(projectId);
  const deleteIntegration = useDeleteIntegration();

  const ga4 = integrations?.find((i: any) => i.provider === 'GOOGLE_GA4');
  const clarity = integrations?.find(
    (i: any) => i.provider === 'MICROSOFT_CLARITY',
  );

  async function handleRemove(integrationId: string) {
    try {
      await deleteIntegration.mutateAsync({ projectId, integrationId });
      toast.success('Integration removed');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <Link href={`/projects/${projectId}/analytics/setup`}>
          <Button>Set Up Integration</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* GA4 Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Google Analytics (GA4)</CardTitle>
            {ga4 && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(ga4.id)}
                >
                  Remove
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {ga4 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>{ga4.measurementId}</Badge>
                  <span className="text-xs text-muted-foreground">
                    via {ga4.connection?.accountEmail}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/projects/${projectId}/analytics/reports`}>
                    <Button size="sm">View Reports</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not configured.{' '}
                <Link
                  href={`/projects/${projectId}/analytics/setup`}
                  className="underline"
                >
                  Set up GA4
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Clarity Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Microsoft Clarity</CardTitle>
            {clarity && (
              <CardAction>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(clarity.id)}
                >
                  Remove
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {clarity ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>{clarity.clarityProjectId}</Badge>
                  <span className="text-xs text-muted-foreground">
                    via {clarity.connection?.accountEmail}
                  </span>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`https://clarity.microsoft.com/projects/view/${clarity.clarityProjectId}/dashboard`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="outline">
                      Open Clarity Dashboard
                    </Button>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not configured.{' '}
                <Link
                  href={`/projects/${projectId}/analytics/setup`}
                  className="underline"
                >
                  Set up Clarity
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
