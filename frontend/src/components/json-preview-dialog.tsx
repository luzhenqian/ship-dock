'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { codeToHtml } from 'shiki';

function useHighlightedJson(code: string) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, {
      lang: 'json',
      theme: 'github-dark',
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code]);
  return html;
}

interface JsonPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: any;
  onSave?: (value: any) => void;
}

export function JsonPreviewDialog({ open, onOpenChange, title, value, onSave }: JsonPreviewDialogProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const formatted = JSON.stringify(value, null, 2);
  const highlightedHtml = useHighlightedJson(editing ? '' : formatted);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  const handleEdit = () => {
    setEditText(formatted);
    setError('');
    setEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editText);
      onSave?.(parsed);
      setEditing(false);
      onOpenChange(false);
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {editing ? (
          <div>
            <textarea
              ref={textareaRef}
              className="w-full min-h-[200px] max-h-[60vh] p-3 bg-muted/50 rounded-md font-mono text-xs resize-y outline-none focus:ring-1 focus:ring-ring"
              value={editText}
              onChange={(e) => { setEditText(e.target.value); setError(''); }}
              spellCheck={false}
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </div>
        ) : (
          <div
            className="overflow-auto max-h-[60vh] rounded-md [&_pre]:!p-3 [&_pre]:!m-0 [&_pre]:!rounded-md [&_pre]:text-xs [&_code]:text-xs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        )}
        {onSave && (
          <DialogFooter>
            {editing ? (
              <>
                <Button variant="outline" onClick={() => { setEditing(false); setError(''); }}>Cancel</Button>
                <Button onClick={handleSave}>Save</Button>
              </>
            ) : (
              <Button variant="outline" onClick={handleEdit}>Edit</Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
