'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';

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

export function useMigrationLogs(migrationId: string) {
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

    const joinRoom = () => {
      socket.emit('join-migration', migrationId);
    };

    joinRoom();
    socket.on('connect', joinRoom);

    socket.on('migration:log', (data: MigrationLog) => {
      setLogs((prev) => [...prev, data]);
    });

    socket.on('migration:progress', (data: MigrationProgress) => {
      setProgress(data);
    });

    socket.on('migration:status', (data: { status: string; errorMessage?: string }) => {
      setStatus(data.status);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.status)) {
        onCompleteRef.current?.();
      }
    });

    return () => {
      socket.emit('leave-migration', migrationId);
      socket.off('connect', joinRoom);
      socket.off('migration:log');
      socket.off('migration:progress');
      socket.off('migration:status');
    };
  }, [migrationId]);

  return { logs, progress, status, onComplete };
}
