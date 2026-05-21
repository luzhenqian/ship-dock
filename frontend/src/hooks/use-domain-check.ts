import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

type CheckResult = { status: 'available' } | { status: 'conflict'; currentIp: string } | { status: 'unknown'; message: string };

export function useDomainCheck() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentIp, setCurrentIp] = useState('');
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const checkAndConfirm = useCallback(async (domain: string): Promise<boolean> => {
    if (!domain) return true;
    try {
      const result = await api<CheckResult>('/projects/check-domain', {
        method: 'POST',
        body: JSON.stringify({ domain }),
      });
      if (result.status === 'available') return true;
      if (result.status === 'unknown') {
        toast.warning('DNS 解析失败，无法验证域名指向');
        return true;
      }
      setCurrentIp(result.currentIp);
      setDialogOpen(true);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    } catch {
      toast.warning('域名检查失败，跳过验证');
      return true;
    }
  }, []);

  const onConfirm = useCallback(() => {
    setDialogOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const onCancel = useCallback(() => {
    setDialogOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return {
    checkAndConfirm,
    dialogProps: { open: dialogOpen, onOpenChange: (v: boolean) => { if (!v) onCancel(); }, currentIp, onConfirm, onCancel },
  };
}
