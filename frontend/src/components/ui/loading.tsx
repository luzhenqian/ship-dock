import { cn } from '@/lib/utils';

function Loading({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground-secondary animate-[loading-dot_1.4s_ease-in-out_infinite]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground-secondary animate-[loading-dot_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="h-1.5 w-1.5 rounded-full bg-foreground-secondary animate-[loading-dot_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  );
}

export { Loading };
