'use client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface DeployLogViewerProps {
  logs: Array<{ stage: string; line: string }>;
}

export function DeployLogViewer({ logs }: DeployLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenCountRef = useRef(0);

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

  // Write new logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const start = writtenCountRef.current;
    for (let i = start; i < logs.length; i++) {
      const { stage, line } = logs[i];
      const isError = line.includes('[stderr]') || line.includes('Error') || line.includes('error:') || line.includes('FAILED');
      const isCommand = line.startsWith('$ ');
      if (isError) {
        term.writeln(`\x1b[90m[${stage}]\x1b[0m \x1b[31m${line}\x1b[0m`);
      } else if (isCommand) {
        term.writeln(`\x1b[90m[${stage}]\x1b[0m \x1b[36m${line}\x1b[0m`);
      } else {
        term.writeln(`\x1b[90m[${stage}]\x1b[0m ${line}`);
      }
    }
    writtenCountRef.current = logs.length;
  }, [logs]);

  return (
    <div className="rounded-md border overflow-hidden">
      <div
        ref={containerRef}
        style={{ height: 600, backgroundColor: '#0a0a0a' }}
      />
    </div>
  );
}
