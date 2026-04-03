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
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link href="/projects/new"><Button>New Project</Button></Link>
      </div>
      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {projects && projects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">No projects yet</p>
          <Link href="/projects/new"><Button>Create your first project</Button></Link>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map((project: any) => <ProjectCard key={project.id} project={project} />)}
      </div>
    </div>
  );
}
