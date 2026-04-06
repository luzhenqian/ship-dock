'use client';
import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Upload } from 'lucide-react';

export function EnvVarEditor({ value, onChange }: { value: Record<string, string>; onChange: (vars: Record<string, string>) => void }) {
  const entries = Object.entries(value);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [allVisible, setAllVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleVisibility(key: string) {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allVisible) {
      setVisibleKeys(new Set());
      setAllVisible(false);
    } else {
      setVisibleKeys(new Set(Object.keys(value)));
      setAllVisible(true);
    }
  }

  function isVisible(key: string) {
    return allVisible || visibleKeys.has(key);
  }

  function handleKeyChange(oldKey: string, input: string) {
    const eqIndex = input.indexOf('=');
    if (eqIndex > 0) {
      const newKey = input.slice(0, eqIndex).trim();
      let newVal = input.slice(eqIndex + 1).trim();
      if ((newVal.startsWith('"') && newVal.endsWith('"')) || (newVal.startsWith("'") && newVal.endsWith("'"))) {
        newVal = newVal.slice(1, -1);
      }
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === oldKey) {
          updated[newKey] = newVal;
        } else {
          updated[k] = v;
        }
      }
      onChange(updated);
      return;
    }

    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      updated[k === oldKey ? input : k] = v;
    }
    onChange(updated);
  }

  function handlePasteMultiline(e: React.ClipboardEvent<HTMLInputElement>, oldKey: string) {
    const text = e.clipboardData.getData('text');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(l => l.includes('='))) {
      e.preventDefault();
      const newVars = { ...value };
      delete newVars[oldKey];
      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          const k = line.slice(0, eqIdx).trim();
          let v = line.slice(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          newVars[k] = v;
        }
      }
      onChange(newVars);
    }
  }

  function parseEnvContent(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      let v = trimmed.slice(eqIdx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      result[k] = v;
    }
    return result;
  }

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseEnvContent(text);
      if (Object.keys(parsed).length > 0) {
        // Merge: imported vars override existing, keep non-conflicting
        const merged = { ...value };
        // Remove empty placeholder rows
        for (const k of Object.keys(merged)) {
          if (k === '' && merged[k] === '') delete merged[k];
        }
        Object.assign(merged, parsed);
        onChange(merged);
      }
    };
    reader.readAsText(file);
  }, [value, onChange]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  }

  return (
    <div
      className="space-y-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {entries.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 gap-1 text-xs"
            onClick={toggleAll}
          >
            {allVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {allVisible ? 'Hide All' : 'Show All'}
          </Button>
        </div>
      )}
      {entries.map(([key, val], i) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder="KEY"
            value={key}
            onChange={(e) => handleKeyChange(key, e.target.value)}
            onPaste={(e) => handlePasteMultiline(e, key)}
            className="font-mono"
          />
          <Input
            placeholder="value"
            type={isVisible(key) ? 'text' : 'password'}
            value={val}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className="font-mono"
          />
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => toggleVisibility(key)}>
            {isVisible(key) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { const { [key]: _, ...rest } = value; onChange(rest); }}>X</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange({ ...value, '': '' })}>+ Add Variable</Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          Import .env
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".env,.env.*,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
