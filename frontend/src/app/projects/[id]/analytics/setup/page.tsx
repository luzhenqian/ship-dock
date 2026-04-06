'use client';

import { use, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  useAnalyticsConnections,
  useGa4Accounts,
  useGa4Properties,
  useGa4Streams,
  useCreateIntegration,
  useCreateGa4Property,
  useCreateGa4Stream,
} from '@/hooks/use-analytics';

type Step = 'provider' | 'connection' | 'resource' | 'confirm';
type Provider = 'GOOGLE_GA4' | 'MICROSOFT_CLARITY';

export default function AnalyticsSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProvider = searchParams.get('provider') as Provider | null;

  const [step, setStep] = useState<Step>(
    initialProvider === 'MICROSOFT_CLARITY' ? 'resource' :
    initialProvider ? 'connection' : 'provider'
  );
  const [provider, setProvider] = useState<Provider | null>(initialProvider);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [measurementId, setMeasurementId] = useState<string | null>(null);
  const [clarityProjectId, setClarityProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [newPropertyName, setNewPropertyName] = useState('');
  const [newStreamName, setNewStreamName] = useState('');
  const [newStreamUri, setNewStreamUri] = useState('');
  const { data: connections } = useAnalyticsConnections();
  const { data: accounts } = useGa4Accounts(
    provider === 'GOOGLE_GA4' ? connectionId : null,
  );
  const { data: properties } = useGa4Properties(
    provider === 'GOOGLE_GA4' ? connectionId : null,
    accountId,
  );
  const { data: streams } = useGa4Streams(
    provider === 'GOOGLE_GA4' ? connectionId : null,
    propertyId,
  );

  const createIntegration = useCreateIntegration();
  const createGa4Property = useCreateGa4Property();
  const createGa4Stream = useCreateGa4Stream();

  const filteredConnections = connections?.filter(
    (c: any) => c.provider === provider,
  );

  async function handleConfirm() {
    try {
      if (provider === 'GOOGLE_GA4') {
        await createIntegration.mutateAsync({
          projectId,
          connectionId: connectionId!,
          provider: 'GOOGLE_GA4',
          ga4PropertyId: propertyId!,
          ga4StreamId: streamId || undefined,
          measurementId: measurementId || undefined,
        });
      } else {
        await createIntegration.mutateAsync({
          projectId,
          connectionId: connectionId || undefined,
          provider: 'MICROSOFT_CLARITY',
          clarityProjectId: clarityProjectId!,
        });
      }
      toast.success('Integration created');
      router.push(`/projects/${projectId}/analytics`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleCreateGa4Property() {
    if (!newPropertyName || !connectionId || !accountId) return;
    setCreating(true);
    try {
      const result = await createGa4Property.mutateAsync({
        connectionId: connectionId!,
        accountId: accountId!,
        displayName: newPropertyName,
      });
      setPropertyId(result.name);
      setNewPropertyName('');
      toast.success('Property created');
    } catch (err: any) {
      toast.error(err.message);
    }
    setCreating(false);
  }

  async function handleCreateGa4Stream() {
    if (!newStreamName || !newStreamUri || !connectionId || !propertyId) return;
    setCreating(true);
    try {
      const result = await createGa4Stream.mutateAsync({
        connectionId: connectionId!,
        propertyId: propertyId!,
        displayName: newStreamName,
        defaultUri: newStreamUri,
      });
      setStreamId(result.name);
      setMeasurementId(result.measurementId);
      setNewStreamName('');
      setNewStreamUri('');
      toast.success(`Stream created: ${result.measurementId}`);
    } catch (err: any) {
      toast.error(err.message);
    }
    setCreating(false);
  }


  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Set Up Analytics</h1>

      {/* Step 1: Choose Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose Provider</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            variant={provider === 'GOOGLE_GA4' ? 'default' : 'outline'}
            onClick={() => {
              setProvider('GOOGLE_GA4');
              setStep('connection');
              setConnectionId(null);
              setAccountId(null);
              setPropertyId(null);
            }}
          >
            Google Analytics (GA4)
          </Button>
          <Button
            variant={provider === 'MICROSOFT_CLARITY' ? 'default' : 'outline'}
            onClick={() => {
              setProvider('MICROSOFT_CLARITY');
              setStep('resource');
              setConnectionId(null);
              setClarityProjectId(null);
            }}
          >
            Microsoft Clarity
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Choose Connection (GA4 only) */}
      {provider === 'GOOGLE_GA4' && step !== 'provider' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Choose Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredConnections?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No connected accounts.{' '}
                <a href="/settings/integrations" className="underline">
                  Connect one in Settings
                </a>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {filteredConnections?.map((conn: any) => (
                  <Button
                    key={conn.id}
                    variant={connectionId === conn.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setConnectionId(conn.id);
                      setStep('resource');
                    }}
                  >
                    {conn.accountEmail}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Choose or Create Resource - GA4 */}
      {connectionId && step === 'resource' && provider === 'GOOGLE_GA4' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Choose GA4 Property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Account</Label>
              <div className="flex flex-wrap gap-2">
                {accounts?.map((acc: any) => (
                  <Button
                    key={acc.name}
                    variant={accountId === acc.name ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setAccountId(acc.name);
                      setPropertyId(null);
                      setStreamId(null);
                    }}
                  >
                    {acc.displayName}
                  </Button>
                ))}
              </div>
            </div>

            {accountId && (
              <div className="space-y-2">
                <Label>Property</Label>
                <div className="flex flex-wrap gap-2">
                  {properties?.map((prop: any) => (
                    <Button
                      key={prop.name}
                      variant={propertyId === prop.name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setPropertyId(prop.name);
                        setStreamId(null);
                        setMeasurementId(null);
                      }}
                    >
                      {prop.displayName}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="New property name"
                    value={newPropertyName}
                    onChange={(e) => setNewPropertyName(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newPropertyName || creating}
                    onClick={handleCreateGa4Property}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}

            {propertyId && (
              <div className="space-y-2">
                <Label>Data Stream</Label>
                <div className="flex flex-wrap gap-2">
                  {streams?.map((s: any) => (
                    <Button
                      key={s.name}
                      variant={streamId === s.name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setStreamId(s.name);
                        setMeasurementId(s.measurementId);
                        setStep('confirm');
                      }}
                    >
                      {s.displayName} ({s.measurementId})
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="Stream name"
                    value={newStreamName}
                    onChange={(e) => setNewStreamName(e.target.value)}
                  />
                  <Input
                    placeholder="https://example.com"
                    value={newStreamUri}
                    onChange={(e) => setNewStreamUri(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newStreamName || !newStreamUri || creating}
                    onClick={handleCreateGa4Stream}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Enter Clarity Project ID (manual — no API available) */}
      {step === 'resource' && provider === 'MICROSOFT_CLARITY' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Enter Clarity Project ID</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Find your Project ID in{' '}
              <a
                href="https://clarity.microsoft.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Clarity Dashboard
              </a>{' '}
              → Settings → Overview.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Project ID</Label>
                <Input
                  placeholder="e.g. abc123xyz"
                  value={clarityProjectId || ''}
                  onChange={(e) => setClarityProjectId(e.target.value || null)}
                />
              </div>
              <Button
                size="sm"
                disabled={!clarityProjectId}
                onClick={() => setStep('confirm')}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm */}
      {step === 'confirm' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{provider === 'MICROSOFT_CLARITY' ? '3' : '4'}. Confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Provider:</span>{' '}
                {provider === 'GOOGLE_GA4' ? 'Google Analytics' : 'Microsoft Clarity'}
              </p>
              {provider === 'GOOGLE_GA4' && (
                <>
                  <p>
                    <span className="text-muted-foreground">Property:</span>{' '}
                    {propertyId}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Measurement ID:</span>{' '}
                    {measurementId || 'N/A'}
                  </p>
                </>
              )}
              {provider === 'MICROSOFT_CLARITY' && (
                <p>
                  <span className="text-muted-foreground">Project ID:</span>{' '}
                  {clarityProjectId}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={createIntegration.isPending}>
                Confirm
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/projects/${projectId}/analytics`)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
