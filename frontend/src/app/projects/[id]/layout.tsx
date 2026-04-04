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
