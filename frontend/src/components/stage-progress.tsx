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
