'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';
import { api } from '@/lib/api';

interface ImportLog {
  timestamp: string;
  level: string;
  message: string;
  itemId?: string;
}

interface ImportProgressData {
  itemId: string;
  stage: string;
  status: string;
  error?: string;
}

interface ImportStatusData {
  status: string;
  itemId?: string;
}

export function useImportProgress(importId: string | null) {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [progress, setProgress] = useState<Map<string, ImportProgressData[]>>(new Map());
  const [statusUpdates, setStatusUpdates] = useState<ImportStatusData[]>([]);
  const [uploadComplete, setUploadComplete] = useState(false);
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
      setStatusUpdates((prev) => [...prev, { status: newStatus }]);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
        if (pollTimer) clearInterval(pollTimer);
        onCompleteRef.current?.();
      }
    };

    const joinRoom = () => {
      socket.emit('join-import', importId);
    };
    joinRoom();
    socket.on('connect', joinRoom);

    socket.on('import:log', (data: ImportLog) => {
      setLogs((prev) => [...prev, data]);
    });

    socket.on('import:progress', (data: ImportProgressData) => {
      setProgress((prev) => {
        const next = new Map(prev);
        const items = next.get(data.itemId) || [];
        const idx = items.findIndex((i) => i.stage === data.stage);
        if (idx >= 0) {
          items[idx] = data;
        } else {
          items.push(data);
        }
        next.set(data.itemId, [...items]);
        return next;
      });
    });

    socket.on('import:status', (data: ImportStatusData) => {
      handleDone(data.status);
    });

    socket.on('import:upload-complete', () => {
      setUploadComplete(true);
    });

    // Polling fallback
    pollTimer = setInterval(async () => {
      try {
        const data = await api<any>(`/imports/${importId}`);
        if (data.status) {
          handleDone(data.status);
        }
      } catch {}
    }, 5000);

    return () => {
      socket.emit('leave-import', importId);
      socket.off('connect', joinRoom);
      socket.off('import:log');
      socket.off('import:progress');
      socket.off('import:status');
      socket.off('import:upload-complete');
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [importId]);

  return { logs, progress, statusUpdates, uploadComplete, onComplete };
}
