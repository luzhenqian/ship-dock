'use client';
import { use, useEffect, useState } from 'react';
import { useProject } from '@/hooks/use-projects';
import { api } from '@/lib/api';
import { PipelineEditor } from '@/components/pipeline-editor';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/loading';

export default function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const { data: project } = useProject(projectId);
  const [stages, setStages] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project?.pipeline) setStages((project.pipeline as any).stages || []);
  }, [project]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await api(`/projects/${projectId}/pipeline`, { method: 'PATCH', body: JSON.stringify({ stages }) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!project) return <Loading className="py-20" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium tracking-tight">Pipeline</h2>
        <div className="flex items-center gap-2">
          {saved && <span className="text-sm text-status-ready">Saved!</span>}
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Pipeline'}</Button>
        </div>
      </div>
      <PipelineEditor stages={stages} onChange={setStages} />
    </div>
  );
}
