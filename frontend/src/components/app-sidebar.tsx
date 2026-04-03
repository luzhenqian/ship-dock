'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/domains', label: 'Domains' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 border-r bg-gray-50/50 min-h-screen p-4">
      <Link href="/dashboard" className="text-xl font-bold mb-8 block">Ship Dock</Link>
      <nav className="space-y-1">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname.startsWith(item.href) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-gray-100'
            }`}>{item.label}</Link>
        ))}
      </nav>
    </aside>
  );
}
