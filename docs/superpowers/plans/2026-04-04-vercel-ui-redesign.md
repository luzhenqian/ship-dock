# Vercel UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul Ship Dock's entire frontend UI to match Vercel's latest design language — covering design tokens, navigation restructure, component polish, and page-level refinements for both light and dark modes.

**Architecture:** Replace the current left sidebar + horizontal tabs navigation with a top nav bar + conditional project sidebar. Update all CSS custom properties to use hex/rgba values matching Vercel's palette. Polish every base component and page for consistency.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, shadcn/ui (base-ui/react), CVA, Geist font, lucide-react

**Important:** This project uses Next.js 16 which has breaking changes. Before writing any Next.js-specific code, read the relevant guide in `frontend/node_modules/next/dist/docs/` as instructed in `frontend/AGENTS.md`.

---

### Task 1: Update Design Tokens in globals.css

**Files:**
- Modify: `frontend/src/app/globals.css`

This task replaces all OKLCH color variables with new hex/rgba values matching Vercel's design language and adds new utility tokens.

- [ ] **Step 1: Replace the `:root` and `.dark` CSS variable blocks**

Replace the full contents of `frontend/src/app/globals.css` with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-background-secondary: var(--background-secondary);
  --color-foreground: var(--foreground);
  --color-foreground-secondary: var(--foreground-secondary);
  --color-foreground-muted: var(--foreground-muted);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-border-hover: var(--border-hover);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-status-ready: var(--status-ready);
  --color-status-building: var(--status-building);
  --color-status-error: var(--status-error);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  --background: #ffffff;
  --background-secondary: #fafafa;
  --foreground: #111111;
  --foreground-secondary: #666666;
  --foreground-muted: #999999;
  --card: #ffffff;
  --card-foreground: #111111;
  --popover: #ffffff;
  --popover-foreground: #111111;
  --primary: #111111;
  --primary-foreground: #ffffff;
  --secondary: #fafafa;
  --secondary-foreground: #111111;
  --muted: #fafafa;
  --muted-foreground: #666666;
  --accent: #fafafa;
  --accent-foreground: #111111;
  --destructive: #ee0000;
  --border: rgba(0, 0, 0, 0.08);
  --border-hover: rgba(0, 0, 0, 0.15);
  --input: rgba(0, 0, 0, 0.08);
  --ring: rgba(0, 0, 0, 0.15);
  --status-ready: #50e3c2;
  --status-building: #f5a623;
  --status-error: #ee0000;
  --radius: 0.75rem;
}

.dark {
  --background: #0a0a0a;
  --background-secondary: #111111;
  --foreground: #ededed;
  --foreground-secondary: #888888;
  --foreground-muted: #666666;
  --card: #111111;
  --card-foreground: #ededed;
  --popover: #111111;
  --popover-foreground: #ededed;
  --primary: #ededed;
  --primary-foreground: #0a0a0a;
  --secondary: #1a1a1a;
  --secondary-foreground: #ededed;
  --muted: #1a1a1a;
  --muted-foreground: #888888;
  --accent: #1a1a1a;
  --accent-foreground: #ededed;
  --destructive: #ff4444;
  --border: rgba(255, 255, 255, 0.1);
  --border-hover: rgba(255, 255, 255, 0.2);
  --input: rgba(255, 255, 255, 0.15);
  --ring: rgba(255, 255, 255, 0.2);
  --status-ready: #50e3c2;
  --status-building: #f5a623;
  --status-error: #ff4444;
  --radius: 0.75rem;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
    transition-property: color, background-color, border-color, box-shadow, opacity;
    transition-duration: 150ms;
    transition-timing-function: ease;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `cd frontend && npm run dev`
Expected: No CSS compilation errors. The page renders with updated colors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "style: update design tokens to Vercel-inspired hex/rgba palette"
```

---

### Task 2: Create Top Navigation Bar Component

**Files:**
- Create: `frontend/src/components/top-nav.tsx`

- [ ] **Step 1: Create the top nav component**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const globalLinks = [
  { href: '/domains', label: 'Domains' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

interface TopNavProps {
  projectName?: string;
  projectId?: string;
}

export function TopNav({ projectName, projectId }: TopNavProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/80 px-5 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="font-semibold text-foreground hover:text-foreground/80 transition-colors"
        >
          Ship Dock
        </Link>
        {projectName && projectId && (
          <>
            <span className="text-foreground-muted">／</span>
            <Link
              href={`/projects/${projectId}/deployments`}
              className="text-foreground-secondary hover:text-foreground transition-colors"
            >
              {projectName}
            </Link>
          </>
        )}
      </div>
      <nav className="flex items-center gap-5">
        {globalLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm transition-colors ${
              pathname.startsWith(link.href)
                ? 'text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/top-nav.tsx
git commit -m "feat: add top navigation bar component"
```

---

### Task 3: Create Project Sidebar Component

**Files:**
- Create: `frontend/src/components/project-sidebar.tsx`

- [ ] **Step 1: Create the project sidebar component**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface ProjectSidebarProps {
  projectId: string;
  projectName: string;
  status: string;
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  STOPPED: 'bg-foreground-muted',
  ERROR: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
};

const groups = [
  {
    label: 'Project',
    items: [
      { href: 'deployments', label: 'Deployments' },
      { href: 'pipeline', label: 'Pipeline' },
      { href: 'logs', label: 'Logs' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: 'database', label: 'Database' },
      { href: 'redis', label: 'Redis' },
      { href: 'storage', label: 'Storage' },
    ],
  },
  {
    label: 'Config',
    items: [
      { href: 'settings', label: 'Settings' },
    ],
  },
];

export function ProjectSidebar({ projectId, projectName, status }: ProjectSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-[200px] shrink-0 border-r py-5 px-3">
      <div className="mb-5 px-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${statusColors[status] || 'bg-foreground-muted'}`}
          />
          <span className="text-sm font-medium text-foreground truncate">
            {projectName}
          </span>
        </div>
      </div>
      <nav className="space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-foreground-muted">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const fullHref = `/projects/${projectId}/${item.href}`;
                const isActive = pathname.startsWith(fullHref);
                return (
                  <Link
                    key={item.href}
                    href={fullHref}
                    className={`block rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? 'bg-foreground/[0.06] text-foreground font-medium'
                        : 'text-foreground-secondary hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/project-sidebar.tsx
git commit -m "feat: add project sidebar component with grouped navigation"
```

---

### Task 4: Replace App Layout (Sidebar → Top Nav)

**Files:**
- Modify: `frontend/src/app/(app)/layout.tsx`
- Delete: `frontend/src/components/app-sidebar.tsx`

- [ ] **Step 1: Update the app layout to use TopNav instead of AppSidebar**

Replace the full contents of `frontend/src/app/(app)/layout.tsx` with:

```tsx
import { TopNav } from '@/components/top-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old sidebar component**

```bash
rm frontend/src/components/app-sidebar.tsx
```

- [ ] **Step 3: Verify no remaining imports of AppSidebar**

Run: `grep -r "app-sidebar" frontend/src/` — should return nothing.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/app/\(app\)/layout.tsx frontend/src/components/app-sidebar.tsx
git commit -m "refactor: replace sidebar layout with top nav bar"
```

---

### Task 5: Replace Project Layout (Tabs → Sidebar)

**Files:**
- Modify: `frontend/src/app/projects/[id]/layout.tsx`

- [ ] **Step 1: Replace the project layout to use ProjectSidebar instead of tabs**

Replace the full contents of `frontend/src/app/projects/[id]/layout.tsx` with:

```tsx
'use client';

import { use } from 'react';
import { useProject } from '@/hooks/use-projects';
import { TopNav } from '@/components/top-nav';
import { ProjectSidebar } from '@/components/project-sidebar';

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: project } = useProject(id);

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav
        projectName={project?.name}
        projectId={id}
      />
      <div className="flex flex-1">
        <ProjectSidebar
          projectId={id}
          projectName={project?.name || 'Loading...'}
          status={project?.status || 'STOPPED'}
        />
        <main className="flex-1 min-w-0 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify project pages render with the new layout**

Navigate to a project page in the browser. You should see the top nav with breadcrumb and a left sidebar with grouped navigation.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/\[id\]/layout.tsx
git commit -m "refactor: replace project tabs with grouped sidebar navigation"
```

---

### Task 6: Polish Base UI Components

**Files:**
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/components/ui/card.tsx`
- Modify: `frontend/src/components/ui/input.tsx`
- Modify: `frontend/src/components/ui/badge.tsx`
- Modify: `frontend/src/components/ui/dialog.tsx`

- [ ] **Step 1: Update Button — add active:scale and refine hover**

In `frontend/src/components/ui/button.tsx`, replace the base classes in `buttonVariants` cva call (the first string argument):

Old:
```
"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
```

New:
```
"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
```

Key changes: `transition-all` removed (global transition handles it), `ring-3` → `ring-2`, `ring-ring/50` → `ring-ring/30`, `translate-y-px` → `scale-[0.98]`.

- [ ] **Step 2: Update Card — lighter ring, 12px radius**

In `frontend/src/components/ui/card.tsx`, update the Card className:

Old:
```
"group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl"
```

New:
```
"group/card flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-4 text-sm text-card-foreground has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl"
```

Key change: `ring-1 ring-foreground/10` → `border` (uses the border color from CSS variables which is now rgba-based).

- [ ] **Step 3: Update Input — thinner focus ring**

In `frontend/src/components/ui/input.tsx`, update the Input className:

Old:
```
"h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
```

New:
```
"h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-[13px] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-foreground-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
```

Key changes: `h-8` → `h-9`, `text-base` → `text-[13px]`, `ring-3` → `ring-2`, `ring-ring/50` → `ring-ring/30`, `transition-colors` removed, `md:text-sm` removed, `placeholder:text-muted-foreground` → `placeholder:text-foreground-muted`.

- [ ] **Step 4: Update Badge — lighter, smaller**

In `frontend/src/components/ui/badge.tsx`, update the base classes in `badgeVariants`:

Old:
```
"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!"
```

New:
```
"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!"
```

Key changes: `rounded-4xl` → `rounded-md`, `transition-all` removed, `ring-[3px]` → `ring-2`, `ring-ring/50` → `ring-ring/30`.

- [ ] **Step 5: Update Dialog — backdrop blur, thinner ring**

In `frontend/src/components/ui/dialog.tsx`, update DialogOverlay className:

Old:
```
"fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
```

New:
```
"fixed inset-0 isolate z-50 bg-black/50 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
```

And update DialogContent (the Popup) className:

Old:
```
"fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
```

New:
```
"fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-5 text-sm text-popover-foreground shadow-lg outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
```

Key changes: `ring-1 ring-foreground/10` → `border`, `p-4` → `p-5`, added `shadow-lg`, removed `duration-100`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/button.tsx frontend/src/components/ui/card.tsx frontend/src/components/ui/input.tsx frontend/src/components/ui/badge.tsx frontend/src/components/ui/dialog.tsx
git commit -m "style: polish base UI components for Vercel design language"
```

---

### Task 7: Update Dashboard Page

**Files:**
- Modify: `frontend/src/components/project-card.tsx`
- Modify: `frontend/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Update ProjectCard — Vercel-style with status dot glow**

Replace the full contents of `frontend/src/components/project-card.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  STOPPED: 'bg-foreground-muted',
  ERROR: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProjectCard({ project }: { project: any }) {
  const lastDeploy = project.deployments?.[0];
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-border-hover cursor-pointer">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{project.name}</CardTitle>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${statusColors[project.status] || 'bg-foreground-muted'}`} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-[13px] text-foreground-secondary">
            {project.domain && <p>{project.domain}</p>}
            {lastDeploy ? (
              <p className="text-foreground-muted">
                Deploy #{lastDeploy.version} · {lastDeploy.status.toLowerCase()} · {timeAgo(lastDeploy.createdAt)}
              </p>
            ) : (
              <p className="text-foreground-muted">No deployments yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Update Dashboard page — lighter heading, better empty state**

Replace the full contents of `frontend/src/app/(app)/dashboard/page.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { useProjects } from '@/hooks/use-projects';
import { ProjectCard } from '@/components/project-card';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const { data: projects, isLoading } = useProjects();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-medium tracking-tight">Projects</h1>
        <Link href="/projects/new">
          <Button>New Project</Button>
        </Link>
      </div>
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}
      {projects && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary mb-4">No projects yet</p>
          <Link href="/projects/new">
            <Button>Create your first project</Button>
          </Link>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map((project: any) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project-card.tsx frontend/src/app/\(app\)/dashboard/page.tsx
git commit -m "style: update dashboard and project card with Vercel design"
```

---

### Task 8: Update Deployments Pages

**Files:**
- Modify: `frontend/src/app/projects/[id]/deployments/page.tsx`
- Modify: `frontend/src/app/projects/[id]/deployments/[did]/page.tsx`
- Modify: `frontend/src/components/stage-progress.tsx`
- Modify: `frontend/src/components/deploy-log-viewer.tsx`

- [ ] **Step 1: Update deployments list — minimal rows with status dots**

Replace the full contents of `frontend/src/app/projects/[id]/deployments/page.tsx` with:

```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import { useDeployments, useTriggerDeploy } from '@/hooks/use-deployments';
import { Button } from '@/components/ui/button';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  FAILED: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
  RUNNING: 'bg-status-building shadow-[0_0_6px_rgba(245,166,35,0.4)]',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DeploymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: deployments, isLoading } = useDeployments(projectId);
  const triggerDeploy = useTriggerDeploy(projectId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Deployments</h2>
        <Button onClick={() => triggerDeploy.mutate()} disabled={triggerDeploy.isPending}>
          {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
        </Button>
      </div>
      {isLoading && (
        <div className="space-y-0 border rounded-xl overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 border-b last:border-0 bg-muted/20 animate-pulse" />
          ))}
        </div>
      )}
      {deployments && deployments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border rounded-xl">
          <p className="text-foreground-secondary mb-4">No deployments yet</p>
          <Button onClick={() => triggerDeploy.mutate()} disabled={triggerDeploy.isPending}>
            {triggerDeploy.isPending ? 'Deploying...' : 'Deploy Now'}
          </Button>
        </div>
      )}
      {deployments && deployments.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          {deployments.map((d: any, i: number) => (
            <Link
              key={d.id}
              href={`/projects/${projectId}/deployments/${d.id}`}
              className={`flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.04] transition-colors ${
                i < deployments.length - 1 ? 'border-b' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[d.status] || 'bg-foreground-muted'}`} />
                <span className="font-mono text-[13px]">#{d.version}</span>
                <span className="text-[13px] text-foreground-secondary">{d.status.toLowerCase()}</span>
                {d.triggeredBy && (
                  <span className="text-[13px] text-foreground-muted">by {d.triggeredBy.name}</span>
                )}
              </div>
              <span className="text-[13px] text-foreground-muted">{timeAgo(d.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update StageProgress — connected line with circle icons**

Replace the full contents of `frontend/src/components/stage-progress.tsx` with:

```tsx
'use client';

const statusColors: Record<string, { dot: string; text: string }> = {
  PENDING: { dot: 'border-foreground-muted', text: 'text-foreground-muted' },
  RUNNING: { dot: 'border-status-building bg-status-building/20', text: 'text-status-building' },
  SUCCESS: { dot: 'border-status-ready bg-status-ready/20', text: 'text-foreground' },
  FAILED: { dot: 'border-status-error bg-status-error/20', text: 'text-status-error' },
  SKIPPED: { dot: 'border-foreground-muted bg-foreground-muted/20', text: 'text-foreground-muted' },
};

export function StageProgress({
  stages,
  activeIndex,
  onStageClick,
}: {
  stages: Array<{ name: string; status: string }>;
  activeIndex?: number;
  onStageClick?: (i: number) => void;
}) {
  return (
    <div className="space-y-0">
      {stages.map((stage, i) => {
        const colors = statusColors[stage.status] || statusColors.PENDING;
        const isActive = i === activeIndex;
        const isLast = i === stages.length - 1;

        return (
          <button
            key={i}
            onClick={() => onStageClick?.(i)}
            className={`relative flex items-start gap-3 w-full pl-3 pr-2 py-2 text-left rounded-md transition-colors ${
              isActive ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.03]'
            }`}
          >
            <div className="relative flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full border-2 mt-0.5 ${colors.dot}`} />
              {!isLast && (
                <div className="w-px flex-1 min-h-[16px] bg-border mt-1" />
              )}
            </div>
            <span className={`text-[13px] ${colors.text}`}>{stage.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Update DeployLogViewer — consistent border radius**

In `frontend/src/components/deploy-log-viewer.tsx`, update the outer container div at the bottom:

Old:
```tsx
    <div className="rounded-md border overflow-hidden">
```

New:
```tsx
    <div className="rounded-xl border overflow-hidden">
```

- [ ] **Step 4: Update deployment detail page — lighter headings, remove Badge**

Replace the full contents of `frontend/src/app/projects/[id]/deployments/[did]/page.tsx` with:

```tsx
'use client';

import { use, useMemo, useState } from 'react';
import { useDeployment, useCancelDeploy } from '@/hooks/use-deployments';
import { useDeployLogs } from '@/hooks/use-deploy-logs';
import { StageProgress } from '@/components/stage-progress';
import { DeployLogViewer } from '@/components/deploy-log-viewer';
import { Button } from '@/components/ui/button';

const statusDot: Record<string, string> = {
  SUCCESS: 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]',
  FAILED: 'bg-status-error shadow-[0_0_6px_rgba(238,0,0,0.3)]',
  RUNNING: 'bg-status-building shadow-[0_0_6px_rgba(245,166,35,0.4)]',
  QUEUED: 'bg-foreground-muted',
  CANCELLED: 'bg-foreground-muted',
};

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string; did: string }> }) {
  const { id: projectId, did: deploymentId } = use(params);
  const { data: deployment } = useDeployment(deploymentId);
  const { logs: realtimeLogs, stageStatuses } = useDeployLogs(deploymentId);
  const cancelDeploy = useCancelDeploy();
  const [activeStage, setActiveStage] = useState(0);

  const persistedLogs = useMemo(() => {
    if (!deployment?.stages) return [];
    const logs: Array<{ stage: string; line: string }> = [];
    for (const stage of deployment.stages as any[]) {
      if (stage.logs && Array.isArray(stage.logs)) {
        for (const line of stage.logs) {
          logs.push({ stage: stage.name, line });
        }
      }
    }
    return logs;
  }, [deployment?.stages]);

  const allLogs = useMemo(() => {
    if (realtimeLogs.length === 0) return persistedLogs;
    if (persistedLogs.length === 0) return realtimeLogs;
    return [...persistedLogs, ...realtimeLogs.slice(persistedLogs.length)];
  }, [persistedLogs, realtimeLogs]);

  if (!deployment) return <p className="text-foreground-secondary">Loading...</p>;

  const stages = (deployment.stages as any[]).map((s: any, i: number) => ({
    ...s,
    status: stageStatuses[i] || s.status,
  }));
  const isRunning = deployment.status === 'RUNNING' || deployment.status === 'QUEUED';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium tracking-tight">Deploy #{deployment.version}</h1>
          <span className={`h-2 w-2 rounded-full ${statusDot[deployment.status] || 'bg-foreground-muted'}`} />
          <span className="text-[13px] text-foreground-secondary">{deployment.status.toLowerCase()}</span>
        </div>
        {isRunning && (
          <Button variant="destructive" onClick={() => cancelDeploy.mutate(deploymentId)}>
            Cancel
          </Button>
        )}
      </div>
      <div className="grid grid-cols-[200px_1fr] gap-6 min-w-0">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground-secondary mb-3">Stages</h3>
          <StageProgress stages={stages} activeIndex={activeStage} onStageClick={setActiveStage} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground-secondary mb-3">Output</h3>
          <DeployLogViewer logs={allLogs} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/\[id\]/deployments/page.tsx frontend/src/app/projects/\[id\]/deployments/\[did\]/page.tsx frontend/src/components/stage-progress.tsx frontend/src/components/deploy-log-viewer.tsx
git commit -m "style: update deployments pages with Vercel-style minimal list and stage progress"
```

---

### Task 9: Update Logs Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/logs/page.tsx`

- [ ] **Step 1: Update logs page — consistent terminal radius and typography**

In `frontend/src/app/projects/[id]/logs/page.tsx`, make these changes:

1. Replace all `text-2xl font-bold` with `text-xl font-medium tracking-tight` if present in headings (this page has no main heading, only controls).

2. Replace the terminal container:

Old:
```tsx
      <div className="rounded-md border overflow-hidden">
        <div ref={containerRef} style={{ height: 600, backgroundColor: '#0a0a0a' }} />
      </div>
```

New:
```tsx
      <div className="rounded-xl border overflow-hidden">
        <div ref={containerRef} style={{ height: 600, backgroundColor: '#0a0a0a' }} />
      </div>
```

3. Update the connection indicator:

Old:
```tsx
          <span className={`ml-2 h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className="text-xs text-muted-foreground">{connected ? 'Live' : 'Disconnected'}</span>
```

New:
```tsx
          <span className={`ml-2 h-2 w-2 rounded-full ${connected ? 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]' : 'bg-foreground-muted'}`} />
          <span className="text-xs text-foreground-muted">{connected ? 'Live' : 'Disconnected'}</span>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/\[id\]/logs/page.tsx
git commit -m "style: update logs page with consistent terminal styling"
```

---

### Task 10: Update Pipeline Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/pipeline/page.tsx`
- Modify: `frontend/src/components/pipeline-editor.tsx`

- [ ] **Step 1: Update pipeline page heading**

In `frontend/src/app/projects/[id]/pipeline/page.tsx`, replace:

Old:
```tsx
        <h2 className="text-xl font-bold">Pipeline</h2>
```

New:
```tsx
        <h2 className="text-xl font-medium tracking-tight">Pipeline</h2>
```

Also replace:
```tsx
          {saved && <span className="text-sm text-green-500">Saved!</span>}
```
With:
```tsx
          {saved && <span className="text-sm text-status-ready">Saved!</span>}
```

- [ ] **Step 2: Update pipeline editor — thinner drag cards**

In `frontend/src/components/pipeline-editor.tsx`, update the SortableStage drag handle:

Old:
```tsx
      <div {...attributes} {...listeners} className="cursor-grab px-2 text-muted-foreground">::</div>
```

New:
```tsx
      <div {...attributes} {...listeners} className="cursor-grab px-2 text-foreground-muted hover:text-foreground-secondary">::</div>
```

And update the Card:

Old:
```tsx
      <Card className="flex-1 p-3">
```

New:
```tsx
      <Card className="flex-1 p-3 shadow-none">
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/\[id\]/pipeline/page.tsx frontend/src/components/pipeline-editor.tsx
git commit -m "style: update pipeline page with refined typography and card styling"
```

---

### Task 11: Update Database Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/database/page.tsx`

- [ ] **Step 1: Update database page — Vercel-style tables and sidebar**

In `frontend/src/app/projects/[id]/database/page.tsx`, make these replacements:

1. The table list sidebar:

Old:
```tsx
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Tables</div>
```

New:
```tsx
      <div className="w-48 shrink-0 border rounded-xl">
        <div className="p-3 border-b text-[11px] font-medium text-foreground-muted uppercase tracking-wider">Tables</div>
```

2. Table list items:

Old:
```tsx
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedTable === t.table_name ? 'bg-muted font-medium' : ''}`}
```

New:
```tsx
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-foreground/[0.04] ${selectedTable === t.table_name ? 'bg-foreground/[0.06] font-medium' : 'text-foreground-secondary'}`}
```

3. All data table containers from `rounded-md` → `rounded-xl`.

4. All `bg-muted/50` table headers → `bg-muted/30`.

5. All `hover:bg-muted/30` table row hovers → `hover:bg-foreground/[0.04]`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/\[id\]/database/page.tsx
git commit -m "style: update database page with Vercel-style tables"
```

---

### Task 12: Update Redis Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/redis/page.tsx`
- Modify: `frontend/src/components/redis-cli-panel.tsx`

- [ ] **Step 1: Update Redis page — consistent sidebar and detail styling**

In `frontend/src/app/projects/[id]/redis/page.tsx`:

1. Key list sidebar:

Old:
```tsx
        <div className="w-64 shrink-0 border rounded-md flex flex-col">
```

New:
```tsx
        <div className="w-64 shrink-0 border rounded-xl flex flex-col">
```

2. Key list items:

Old:
```tsx
                className={`w-full text-left px-3 py-2 text-sm flex justify-between hover:bg-muted/50 ${selectedKey === item.key ? 'bg-muted font-medium' : ''}`}
```

New:
```tsx
                className={`w-full text-left px-3 py-2 text-[13px] flex justify-between hover:bg-foreground/[0.04] ${selectedKey === item.key ? 'bg-foreground/[0.06] font-medium' : 'text-foreground-secondary'}`}
```

3. Key value display:

Old:
```tsx
              <div className="border rounded-md bg-[#0a0a0a] text-[#e5e5e5] p-4 font-mono text-sm overflow-auto max-h-[calc(100vh-360px)]">
```

New:
```tsx
              <div className="border rounded-xl bg-[#0a0a0a] text-[#e5e5e5] p-4 font-mono text-[13px] overflow-auto max-h-[calc(100vh-360px)]">
```

- [ ] **Step 2: Update Redis CLI panel — consistent border radius**

In `frontend/src/components/redis-cli-panel.tsx`:

Old:
```tsx
    <div className="border rounded-md bg-[#0a0a0a] text-[#e5e5e5] font-mono text-sm h-80 flex flex-col">
```

New:
```tsx
    <div className="border rounded-xl bg-[#0a0a0a] text-[#e5e5e5] font-mono text-[13px] h-80 flex flex-col">
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/projects/\[id\]/redis/page.tsx frontend/src/components/redis-cli-panel.tsx
git commit -m "style: update Redis page with consistent Vercel styling"
```

---

### Task 13: Update Storage Page

**Files:**
- Modify: `frontend/src/app/projects/[id]/storage/page.tsx`

- [ ] **Step 1: Update storage page — consistent borders and tables**

In `frontend/src/app/projects/[id]/storage/page.tsx`:

1. Bucket sidebar:

Old:
```tsx
      <div className="w-48 shrink-0 border rounded-md">
        <div className="p-3 border-b text-xs font-medium text-muted-foreground uppercase">Buckets</div>
```

New:
```tsx
      <div className="w-48 shrink-0 border rounded-xl">
        <div className="p-3 border-b text-[11px] font-medium text-foreground-muted uppercase tracking-wider">Buckets</div>
```

2. Bucket list items:

Old:
```tsx
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 ${selectedBucket === b.name ? 'bg-muted font-medium' : ''}`}
```

New:
```tsx
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-foreground/[0.04] ${selectedBucket === b.name ? 'bg-foreground/[0.06] font-medium' : 'text-foreground-secondary'}`}
```

3. File table:

Old:
```tsx
            <div className="border rounded-md overflow-auto">
```

New:
```tsx
            <div className="border rounded-xl overflow-auto">
```

4. Table header:

Old:
```tsx
                    <tr className="bg-muted/50 border-b">
```

New:
```tsx
                    <tr className="bg-muted/30 border-b">
```

5. Table row hover:

Old:
```tsx
                      <tr key={p} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => handleFolderClick(p)}>
```

New:
```tsx
                      <tr key={p} className="border-b hover:bg-foreground/[0.04] cursor-pointer" onClick={() => handleFolderClick(p)}>
```

And:
Old:
```tsx
                      <tr key={obj.name} className="border-b last:border-0 hover:bg-muted/30">
```

New:
```tsx
                      <tr key={obj.name} className="border-b last:border-0 hover:bg-foreground/[0.04]">
```

6. Action links — use semantic colors:

Old:
```tsx
                            <button className="text-xs text-blue-600 hover:underline" onClick={() => handleDownload(obj.name)}>
```

New:
```tsx
                            <button className="text-xs text-foreground-secondary hover:text-foreground hover:underline" onClick={() => handleDownload(obj.name)}>
```

Old:
```tsx
                            <button className="text-xs text-red-600 hover:underline" onClick={() => setDeleteTarget({ bucket: selectedBucket, key: obj.name })}>
```

New:
```tsx
                            <button className="text-xs text-status-error hover:underline" onClick={() => setDeleteTarget({ bucket: selectedBucket, key: obj.name })}>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/\[id\]/storage/page.tsx
git commit -m "style: update storage page with Vercel-style tables and sidebar"
```

---

### Task 14: Update Settings, Team, Domains Pages

**Files:**
- Modify: `frontend/src/app/projects/[id]/settings/page.tsx`
- Modify: `frontend/src/app/(app)/team/page.tsx`
- Modify: `frontend/src/app/(app)/domains/page.tsx`
- Modify: `frontend/src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Update project settings page headings and danger zone**

In `frontend/src/app/projects/[id]/settings/page.tsx`:

1. All heading styles — no changes needed, they use CardTitle which is already good.

2. The save/delete buttons at the bottom:

Old:
```tsx
      <div className="flex justify-between items-center">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="destructive" onClick={handleDelete}>Delete Project</Button>
      </div>
```

New:
```tsx
      <div className="flex justify-between items-center pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <Card className="border-status-error/30">
        <CardHeader>
          <CardTitle className="text-status-error">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-foreground-secondary mb-4">
            Permanently delete this project. This will stop the process and remove all configuration.
          </p>
          <Button variant="destructive" onClick={handleDelete}>Delete Project</Button>
        </CardContent>
      </Card>
```

- [ ] **Step 2: Update Team page headings**

In `frontend/src/app/(app)/team/page.tsx`:

Old:
```tsx
      <h1 className="text-2xl font-bold mb-6">Team</h1>
```

New:
```tsx
      <h1 className="text-xl font-medium tracking-tight mb-6">Team</h1>
```

- [ ] **Step 3: Update Domains page headings**

In `frontend/src/app/(app)/domains/page.tsx`:

Old:
```tsx
      <h1 className="text-2xl font-bold mb-6">Domain Providers</h1>
```

New:
```tsx
      <h1 className="text-xl font-medium tracking-tight mb-6">Domain Providers</h1>
```

- [ ] **Step 4: Update System Settings page headings**

In `frontend/src/app/(app)/settings/page.tsx`:

Old:
```tsx
      <h1 className="text-2xl font-bold mb-6">System Settings</h1>
```

New:
```tsx
      <h1 className="text-xl font-medium tracking-tight mb-6">System Settings</h1>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/projects/\[id\]/settings/page.tsx frontend/src/app/\(app\)/team/page.tsx frontend/src/app/\(app\)/domains/page.tsx frontend/src/app/\(app\)/settings/page.tsx
git commit -m "style: update settings, team, and domains pages with refined typography"
```

---

### Task 15: Update Project Creation Wizard

**Files:**
- Modify: `frontend/src/app/projects/new/page.tsx`

- [ ] **Step 1: Update the new project page**

In `frontend/src/app/projects/new/page.tsx`:

1. Main heading:

Old:
```tsx
      <h1 className="text-2xl font-bold mb-6">New Project</h1>
```

New:
```tsx
      <h1 className="text-xl font-medium tracking-tight mb-6">New Project</h1>
```

2. Branch dropdown background (hardcoded white):

Old:
```tsx
                    <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto rounded-md border bg-white shadow-lg">
```

New:
```tsx
                    <div className="absolute z-50 w-full mt-1 max-h-48 overflow-auto rounded-xl border bg-popover shadow-lg">
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/projects/new/page.tsx
git commit -m "style: update project creation wizard with Vercel styling"
```

---

### Task 16: Update SQL Query Panel

**Files:**
- Modify: `frontend/src/components/sql-query-panel.tsx`

- [ ] **Step 1: Update SQL panel — consistent table and terminal styling**

In `frontend/src/components/sql-query-panel.tsx`:

1. Results table:

Old:
```tsx
        <div className="border rounded-md overflow-auto max-h-96">
```

New:
```tsx
        <div className="border rounded-xl overflow-auto max-h-96">
```

2. Table header:

Old:
```tsx
                {data.columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left font-medium whitespace-nowrap">{col}</th>
```

New:
```tsx
                {data.columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left text-[13px] font-medium whitespace-nowrap">{col}</th>
```

3. Table header row:

Old:
```tsx
              <tr className="bg-muted/50 border-b">
```

New:
```tsx
              <tr className="bg-muted/30 border-b">
```

4. Table body rows:

Old:
```tsx
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
```

New:
```tsx
                <tr key={i} className="border-b last:border-0 hover:bg-foreground/[0.04]">
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/sql-query-panel.tsx
git commit -m "style: update SQL query panel with Vercel-style tables"
```

---

### Task 17: Final Verification

- [ ] **Step 1: Run the dev server and check all pages**

Run: `cd frontend && npm run dev`

Check each page visually:
1. `/dashboard` — skeleton loading, project cards with status dots
2. `/projects/[id]/deployments` — minimal list, status dots with glow
3. `/projects/[id]/deployments/[did]` — stage progress with connected line
4. `/projects/[id]/pipeline` — drag cards with thinner borders
5. `/projects/[id]/logs` — terminal with 12px radius, status dot
6. `/projects/[id]/database` — table sidebar, data tables
7. `/projects/[id]/redis` — key list, CLI panel
8. `/projects/[id]/storage` — bucket list, file browser table
9. `/projects/[id]/settings` — card sections, danger zone
10. `/team` — lighter heading, cards
11. `/domains` — lighter heading
12. `/settings` — lighter heading

- [ ] **Step 2: Check dark mode**

Toggle dark mode and verify all pages have proper contrast and colors.

- [ ] **Step 3: Run build to check for errors**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit any final fixes**

If any issues were found, fix them and commit.
