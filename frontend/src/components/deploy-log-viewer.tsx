'use client';
import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

export function DeployLogViewer({ logs }: { logs: Array<{ stage: string; line: string }> }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <ScrollArea className="h-[600px] rounded-md border bg-gray-950 p-4">
      <pre className="text-sm font-mono text-green-400 whitespace-pre-wrap">
        {logs.map((log, i) => (<div key={i}><span className="text-gray-500">[{log.stage}]</span> {log.line}</div>))}
        <div ref={bottomRef} />
      </pre>
    </ScrollArea>
  );
}
