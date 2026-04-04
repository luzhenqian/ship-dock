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

  // Track which logs array identity we last wrote from, so we can detect
  // when the source switches (e.g. realtime → persisted) and clear + rewrite.
  const logsSourceRef = useRef(logs);

  // Write new logs incrementally
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // If the logs array reference changed and we already wrote some lines,
    // the source switched (e.g. persisted logs arrived with more data).
    // Clear the terminal and rewrite from scratch.
    if (logsSourceRef.current !== logs && writtenCountRef.current > 0) {
      term.clear();
      writtenCountRef.current = 0;
    }
    logsSourceRef.current = logs;

    const start = writtenCountRef.current;
    for (let i = start; i < logs.length; i++) {
      const { stage, line } = logs[i];
      const isWarning = /\bwarn(ing)?\b/i.test(line);
      const isError = !isWarning && (line.includes('[stderr]') || line.includes('Error') || line.includes('error:') || line.includes('FAILED'));
      const isCommand = line.startsWith('$ ');
      if (isWarning) {
        term.writeln(`\x1b[90m[${stage}]\x1b[0m \x1b[33m${line}\x1b[0m`);
      } else if (isError) {
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
    <div className="rounded-xl border overflow-hidden">
      <div
        ref={containerRef}
        style={{ height: 600, backgroundColor: '#0a0a0a' }}
      />
    </div>
  );
}
