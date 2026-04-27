'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: { name: string; command: string; workDir?: string | null };
  title: string;
  submitLabel: string;
  onSubmit: (values: { name: string; command: string; workDir?: string }) => Promise<void>;
}

export function TaskFormDialog({ open, onOpenChange, initial, title, submitLabel, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [workDir, setWorkDir] = useState(initial?.workDir ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setCommand(initial?.command ?? '');
      setWorkDir(initial?.workDir ?? '');
      setError(null);
    }
  }, [open, initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name, command, workDir: workDir || undefined });
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="block mb-1">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="seed" required />
          </label>
          <label className="block text-sm">
            <span className="block mb-1">Command</span>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm run seed" required className="font-mono" />
          </label>
          <label className="block text-sm">
            <span className="block mb-1">Working directory <span className="text-muted-foreground">(optional)</span></span>
            <Input value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="backend" />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
