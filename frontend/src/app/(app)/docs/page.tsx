'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const docs = [
  {
    title: 'Analytics Integration',
    description: 'Connect Google Analytics (GA4) and Microsoft Clarity to your projects',
    href: '/docs/analytics',
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documentation</h1>
        <p className="text-muted-foreground mt-1">
          Guides and references for Ship Dock features.
        </p>
      </div>

      <div className="grid gap-4">
        {docs.map((doc) => (
          <Link key={doc.href} href={doc.href}>
            <Card className="transition-colors hover:border-foreground/20">
              <CardHeader>
                <CardTitle className="text-base">{doc.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{doc.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
