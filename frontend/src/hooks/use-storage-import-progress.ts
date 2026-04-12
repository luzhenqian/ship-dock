'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';
import { api } from '@/lib/api';

interface StorageImportLog {
  timestamp: string;
  level: string;
  message: string;
}

interface StorageImportProgress {
  completedFiles: number;
  totalFiles: number;
  currentFile: string;
}

export function useStorageImportProgress(projectId: string, importId: string) {
  const [logs, setLogs] = useState<StorageImportLog[]>([]);
  const [progress, setProgress] = useState<StorageImportProgress | null>(null);
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());
  const onCompleteRef = useRef<(() => void) | null>(null);

  const onComplete = useCallback((cb: () => void) => {
    onCompleteRef.current = cb;
  }, []);

  useEffect(() => {
    if (!importId) return;

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
    const joinRoom = () => { socket.emit('join-storage-import', importId); };
    joinRoom();
    socket.on('connect', joinRoom);
    socket.on('storage-import:log', (data: StorageImportLog) => { setLogs((prev) => [...prev, data]); });
    socket.on('storage-import:progress', (data: StorageImportProgress) => { setProgress(data); });
    socket.on('storage-import:status', (data: { status: string }) => { handleDone(data.status); });

    // Polling fallback — covers cases where WebSocket can't connect
    pollTimer = setInterval(async () => {
      try {
        const data = await api<any>(`/projects/${projectId}/storage/import/${importId}`);
        if (data.status && data.status !== status) {
          setProgress({
            completedFiles: data.completedFiles ?? 0,
            totalFiles: data.totalFiles ?? 0,
            currentFile: '',
          });
          handleDone(data.status);
        }
      } catch {}
    }, 3000);

    return () => {
      socket.emit('leave-storage-import', importId);
      socket.off('connect', joinRoom);
      socket.off('storage-import:log');
      socket.off('storage-import:progress');
      socket.off('storage-import:status');
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [importId, projectId]);

  return { logs, progress, status, onComplete };
}
