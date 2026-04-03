'use client';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface Stage {
  name: string;
  type: 'builtin' | 'command';
  command?: string;
  optional?: boolean;
  config?: Record<string, any>;
}

function SortableStage({ stage, index, onUpdate, onRemove }: { stage: Stage; index: number; onUpdate: (i: number, s: Stage) => void; onRemove: (i: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `stage-${index}` });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 mb-2">
      <div {...attributes} {...listeners} className="cursor-grab px-2 text-muted-foreground">::</div>
      <Card className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <Input value={stage.name} onChange={(e) => onUpdate(index, { ...stage, name: e.target.value })} className="w-32 font-mono text-sm" placeholder="name" />
          <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">{stage.type}</span>
          {stage.type === 'command' ? (
            <Input value={stage.command || ''} onChange={(e) => onUpdate(index, { ...stage, command: e.target.value })} className="flex-1 font-mono text-sm" placeholder="command" />
          ) : <span className="text-sm text-muted-foreground flex-1">System managed</span>}
          {stage.type === 'command' && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={!!stage.optional} onChange={(e) => onUpdate(index, { ...stage, optional: e.target.checked })} className="rounded" />
              optional
            </label>
          )}
          {stage.type === 'command' && <Button variant="ghost" size="sm" onClick={() => onRemove(index)}>X</Button>}
        </div>
      </Card>
    </div>
  );
}

export function PipelineEditor({ stages, onChange }: { stages: Stage[]; onChange: (s: Stage[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor));
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = parseInt((active.id as string).replace('stage-', ''));
    const newIndex = parseInt((over.id as string).replace('stage-', ''));
    onChange(arrayMove(stages, oldIndex, newIndex));
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stages.map((_, i) => `stage-${i}`)} strategy={verticalListSortingStrategy}>
          {stages.map((stage, i) => (
            <SortableStage
              key={`stage-${i}`}
              stage={stage}
              index={i}
              onUpdate={(idx, s) => { const u = [...stages]; u[idx] = s; onChange(u); }}
              onRemove={(idx) => onChange(stages.filter((_, j) => j !== idx))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button variant="outline" onClick={() => onChange([...stages, { name: '', type: 'command', command: '' }])} className="mt-2">+ Add Stage</Button>
    </div>
  );
}
