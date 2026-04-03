'use client';

const statusIcons: Record<string, string> = { PENDING: 'o', RUNNING: '...', SUCCESS: 'v', FAILED: 'x' };
const statusColors: Record<string, string> = { PENDING: 'text-muted-foreground', RUNNING: 'text-yellow-500', SUCCESS: 'text-green-500', FAILED: 'text-red-500' };

export function StageProgress({ stages, activeIndex, onStageClick }: { stages: Array<{ name: string; status: string }>; activeIndex?: number; onStageClick?: (i: number) => void }) {
  return (
    <div className="space-y-1">
      {stages.map((stage, i) => (
        <button key={i} onClick={() => onStageClick?.(i)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${i === activeIndex ? 'bg-accent' : 'hover:bg-accent/50'}`}>
          <span className={`font-mono ${statusColors[stage.status] || 'text-muted-foreground'}`}>[{statusIcons[stage.status] || '?'}]</span>
          <span>{stage.name}</span>
        </button>
      ))}
    </div>
  );
}
