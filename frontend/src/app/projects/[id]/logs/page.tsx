'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLiveLogs, useHistoricalLogs } from '@/hooks/use-logs';

export default function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [logType, setLogType] = useState<'stdout' | 'stderr'>('stdout');
  const [search, setSearch] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const writtenRef = useRef(0);

  const { logs, paused, setPaused, resume, clear, connected } = useLiveLogs(id);
  const { data: historical } = useHistoricalLogs(id, { type: logType, lines: 200 });

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.4,
      scrollback: 50000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#ffffff40',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    writtenRef.current = 0;

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Write historical logs on load
  useEffect(() => {
    const term = termRef.current;
    if (!term || !historical?.lines) return;

    term.clear();
    writtenRef.current = 0;
    for (const line of historical.lines) {
      const colored = colorize(line);
      term.writeln(colored);
    }
  }, [historical]);

  // Write live logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const start = writtenRef.current;
    for (let i = start; i < logs.length; i++) {
      const { type, line } = logs[i];
      if (logType !== 'stdout' && logType !== type) continue;
      const prefix = type === 'stderr' ? '\x1b[31m[stderr]\x1b[0m ' : '';
      term.writeln(`${prefix}${colorize(line)}`);
    }
    writtenRef.current = logs.length;
  }, [logs, logType]);

  // Search
  useEffect(() => {
    if (search && searchAddonRef.current) {
      searchAddonRef.current.findNext(search);
    }
  }, [search]);

  const handleClear = () => {
    termRef.current?.clear();
    clear();
    writtenRef.current = 0;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={logType === 'stdout' ? 'default' : 'outline'}
            onClick={() => setLogType('stdout')}
          >
            stdout
          </Button>
          <Button
            size="sm"
            variant={logType === 'stderr' ? 'destructive' : 'outline'}
            onClick={() => setLogType('stderr')}
          >
            stderr
          </Button>
          <span className={`ml-2 h-2 w-2 rounded-full ${connected ? 'bg-status-ready shadow-[0_0_6px_rgba(80,227,194,0.4)]' : 'bg-foreground-muted'}`} />
          <span className="text-xs text-foreground-muted">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={handleClear}>Clear</Button>
          <Button
            size="sm"
            variant={paused ? 'default' : 'destructive'}
            onClick={() => paused ? resume() : setPaused(true)}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden">
        <div ref={containerRef} style={{ height: 600, backgroundColor: '#0a0a0a' }} />
      </div>
    </div>
  );
}

function colorize(line: string): string {
  if (line.includes('[ERROR]') || line.includes('Error') || line.includes('error:')) {
    return `\x1b[31m${line}\x1b[0m`;
  }
  if (line.includes('[WARN]') || line.includes('warn')) {
    return `\x1b[33m${line}\x1b[0m`;
  }
  return line;
}
