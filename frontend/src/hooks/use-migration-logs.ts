'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';
import { api } from '@/lib/api';

interface MigrationLog {
  timestamp: string;
  level: string;
  message: string;
}

interface MigrationProgress {
  completedTables: number;
  totalTables: number;
  currentTable: string;
}

export function useMigrationLogs(projectId: string, migrationId: string) {
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());
  const onCompleteRef = useRef<(() => void) | null>(null);

  const onComplete = useCallback((cb: () => void) => {
    onCompleteRef.current = cb;
  }, []);

  useEffect(() => {
    if (!migrationId) return;

    const socket = socketRef.current;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const handleDone = (newStatus: string) => {
      setStatus(newStatus);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
        if (pollTimer) clearInterval(pollTimer);
        onCompleteRef.current?.();
      }
    };

    // WebSocket path
    const joinRoom = () => { socket.emit('join-migration', migrationId); };
    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('migration:log', (data: MigrationLog) => { setLogs((prev) => [...prev, data]); });
    socket.on('migration:progress', (data: MigrationProgress) => { setProgress(data); });
    socket.on('migration:status', (data: { status: string }) => { handleDone(data.status); });

    // Fetch full state once (covers fast completions before WS connects)
    const fetchState = async () => {
      try {
        const data = await api<any>(`/projects/${projectId}/migrations/${migrationId}`);
        if (!data.status) return;
        const total = data.totalTables ?? 0;
        const completed = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)
          ? total
          : (data.completedTables ?? 0);
        setProgress({ completedTables: completed, totalTables: total, currentTable: '' });
        handleDone(data.status);
      } catch {}
    };
    fetchState();

    // Polling fallback — covers cases where WebSocket can't connect
    pollTimer = setInterval(fetchState, 3000);

    return () => {
      socket.emit('leave-migration', migrationId);
      socket.off('connect', joinRoom);
      socket.off('migration:log');
      socket.off('migration:progress');
      socket.off('migration:status');
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [migrationId, projectId]);

  return { logs, progress, status, onComplete };
}
