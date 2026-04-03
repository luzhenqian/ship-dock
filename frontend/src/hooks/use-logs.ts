'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { connectSocket } from '@/lib/socket';

export function useHistoricalLogs(
  projectId: string,
  options?: { type?: string; search?: string; lines?: number },
) {
  return useQuery({
    queryKey: ['logs', projectId, options],
    queryFn: () => {
      const params = new URLSearchParams();
      if (options?.type) params.set('type', options.type);
      if (options?.search) params.set('search', options.search);
      if (options?.lines) params.set('lines', options.lines.toString());
      return api(`/projects/${projectId}/logs?${params}`);
    },
  });
}

export function useLiveLogs(projectId: string) {
  const [logs, setLogs] = useState<Array<{ type: string; line: string }>>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const bufferRef = useRef<Array<{ type: string; line: string }>>([]);

  const clear = useCallback(() => {
    setLogs([]);
    bufferRef.current = [];
  }, []);

  useEffect(() => {
    const socket = connectSocket();

    socket.emit('join-logs', projectId);
    setConnected(true);

    const handler = (data: { type: string; line: string }) => {
      if (paused) {
        bufferRef.current.push(data);
      } else {
        setLogs((prev) => [...prev, data]);
      }
    };

    socket.on('log-line', handler);

    return () => {
      socket.off('log-line', handler);
      socket.emit('leave-logs', projectId);
      setConnected(false);
    };
  }, [projectId, paused]);

  const resume = useCallback(() => {
    setPaused(false);
    setLogs((prev) => [...prev, ...bufferRef.current]);
    bufferRef.current = [];
  }, []);

  return { logs, connected, paused, setPaused, resume, clear };
}
