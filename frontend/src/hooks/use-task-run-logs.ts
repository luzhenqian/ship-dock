'use client';
import { useEffect, useRef, useState } from 'react';
import { connectSocket } from '@/lib/socket';

interface LogLine { t: number; m: string }

export function useTaskRunLogs(runId: string | undefined, initialLogs: LogLine[] = []) {
  const [logs, setLogs] = useState<LogLine[]>(initialLogs);
  const [status, setStatus] = useState<string | null>(null);
  const socketRef = useRef(connectSocket());

  useEffect(() => {
    if (!runId) return;
    setLogs(initialLogs);
    setStatus(null);
    const socket = socketRef.current;
    const join = () => socket.emit('join-task-run', runId);
    join();
    socket.on('connect', join);
    socket.on('log', (entry: LogLine) => setLogs((prev) => [...prev, entry]));
    socket.on('status', (s: { status: string }) => setStatus(s.status));
    return () => {
      socket.emit('leave-task-run', runId);
      socket.off('connect', join);
      socket.off('log');
      socket.off('status');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { logs, status };
}
