import { TopNav } from '@/components/top-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
