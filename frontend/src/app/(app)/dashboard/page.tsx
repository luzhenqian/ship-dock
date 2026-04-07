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
        <div className="flex items-center gap-2">
          <Link href="/import">
            <Button variant="outline">Import Projects</Button>
          </Link>
          <Link href="/projects/new">
            <Button>New Project</Button>
          </Link>
        </div>
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
