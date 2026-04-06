'use client';
import { useEffect, useRef, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface DeployLogViewerProps {
  logs: Array<{ stage: string; line: string; t?: number }>;
}

function formatTimestamp(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function DeployLogViewer({ logs }: DeployLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenCountRef = useRef(0);

  const stats = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const { line } of logs) {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (/\bwarn(ing)?\b/i.test(plain)) warnings++;
      else if (plain.includes('[stderr]') || plain.includes('Error') || plain.includes('error:') || plain.includes('FAILED')) errors++;
    }
    return { total: logs.length, errors, warnings };
  }, [logs]);

  // Initialize terminal once
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
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    writtenCountRef.current = 0;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      writtenCountRef.current = 0;
    };
  }, []);

  // Track which logs array identity we last wrote from
  const logsSourceRef = useRef(logs);

  // Write new logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (logsSourceRef.current !== logs && writtenCountRef.current > 0) {
      term.clear();
      writtenCountRef.current = 0;
    }
    logsSourceRef.current = logs;

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const start = writtenCountRef.current;
    for (let i = start; i < logs.length; i++) {
      const { line, t } = logs[i];
      const plain = stripAnsi(line);
      const isWarning = /\bwarn(ing)?\b/i.test(plain);
      const isError = !isWarning && (plain.includes('[stderr]') || plain.includes('Error') || plain.includes('error:') || plain.includes('FAILED'));
      const isCommand = plain.startsWith('$ ');

      // Timestamp prefix (dim gray)
      const tsPrefix = t ? `\x1b[90m${formatTimestamp(t)}\x1b[0m   ` : '';

      if (isWarning) {
        // Yellow background, black text — like Vercel warning lines
        term.writeln(`${tsPrefix}\x1b[43;30m ${plain} \x1b[0m`);
      } else if (isError) {
        // Red background, white text — like Vercel error lines
        term.writeln(`${tsPrefix}\x1b[41m ${plain} \x1b[0m`);
      } else if (isCommand) {
        term.writeln(`${tsPrefix}\x1b[36m${plain}\x1b[0m`);
      } else {
        term.writeln(`${tsPrefix}${plain}`);
      }
    }
    writtenCountRef.current = logs.length;
  }, [logs]);

  return (
    <div className="rounded-xl border overflow-hidden">
      {/* Stats bar — like Vercel's top bar with line count, errors, warnings */}
      <div className="flex items-center gap-4 px-4 py-2 bg-[#0a0a0a] border-b border-border/50 text-[13px] font-mono">
        <span className="text-foreground-muted">{stats.total} lines</span>
        {stats.errors > 0 && (
          <span className="text-status-error">{stats.errors} error{stats.errors !== 1 ? 's' : ''}</span>
        )}
        {stats.warnings > 0 && (
          <span className="text-yellow-500">{stats.warnings} warning{stats.warnings !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{ height: 600, backgroundColor: '#0a0a0a' }}
      />
    </div>
  );
}
