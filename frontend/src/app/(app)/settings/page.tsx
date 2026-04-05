'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
  return (
    <Card>
      <CardHeader><CardTitle>Server Info</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div><Label>Projects Directory</Label><Input value="/var/www" disabled /></div>
        <div><Label>Port Range</Label><Input value="3001 - 3999" disabled /></div>
      </CardContent>
    </Card>
  );
}
