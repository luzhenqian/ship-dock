'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  onConfirm: () => void;
  destructive?: boolean;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmText, onConfirm, destructive = true,
}: ConfirmDialogProps) {
  const [input, setInput] = useState('');
  const requiresTyping = !!confirmText;

  const handleConfirm = () => {
    if (requiresTyping && input !== confirmText) return;
    onConfirm();
    onOpenChange(false);
    setInput('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); setInput(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requiresTyping && (
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-bold">{confirmText}</span> to confirm:
            </p>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={confirmText} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setInput(''); }}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={requiresTyping && input !== confirmText}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
