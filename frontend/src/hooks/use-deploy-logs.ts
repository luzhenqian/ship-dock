'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { connectSocket } from '@/lib/socket';

export function useDeployLogs(deploymentId: string) {
  const [logs, setLogs] = useState<Array<{ stage: string; line: string }>>([]);
  const [stageStatuses, setStageStatuses] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<string>('');
  const socketRef = useRef(connectSocket());
  const onCompleteRef = useRef<(() => void) | null>(null);

  const onComplete = useCallback((cb: () => void) => {
    onCompleteRef.current = cb;
  }, []);

  useEffect(() => {
    const socket = socketRef.current;

    const joinRoom = () => {
      socket.emit('join-deployment', deploymentId);
    };

    // Join immediately and also re-join on reconnect
    joinRoom();
    socket.on('connect', joinRoom);

    socket.on('log', (data: { index?: number; stage?: string; line: string }) => {
      setLogs((prev) => [...prev, { stage: data.stage || `stage-${data.index}`, line: data.line }]);
    });
    socket.on('stage-start', (data: { index: number }) => {
      setStageStatuses((prev) => ({ ...prev, [data.index]: 'RUNNING' }));
    });
    socket.on('stage-end', (data: { index: number; success: boolean }) => {
      setStageStatuses((prev) => ({ ...prev, [data.index]: data.success ? 'SUCCESS' : 'FAILED' }));
    });
    socket.on('status', (data: { status: string }) => {
      setStatus(data.status);
      if (data.status === 'SUCCESS' || data.status === 'FAILED' || data.status === 'CANCELLED') {
        onCompleteRef.current?.();
      }
    });
    return () => {
      socket.emit('leave-deployment', deploymentId);
      socket.off('connect', joinRoom);
      socket.off('log');
      socket.off('stage-start');
      socket.off('stage-end');
      socket.off('status');
    };
  }, [deploymentId]);

  return { logs, stageStatuses, status, onComplete };
}
