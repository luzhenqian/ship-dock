'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EnvVarEditor({ value, onChange }: { value: Record<string, string>; onChange: (vars: Record<string, string>) => void }) {
  const entries = Object.entries(value);

  function handleKeyChange(oldKey: string, input: string) {
    // Support pasting KEY=VALUE or KEY="VALUE"
    const eqIndex = input.indexOf('=');
    if (eqIndex > 0) {
      const newKey = input.slice(0, eqIndex).trim();
      let newVal = input.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
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

    // Normal key rename
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      updated[k === oldKey ? input : k] = v;
    }
    onChange(updated);
  }

  function handlePasteMultiline(e: React.ClipboardEvent<HTMLInputElement>, oldKey: string) {
    const text = e.clipboardData.getData('text');
    // Detect multi-line paste like "KEY1=val1\nKEY2=val2"
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

  return (
    <div className="space-y-2">
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
            value={val}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className="font-mono"
          />
          <Button variant="ghost" size="sm" onClick={() => { const { [key]: _, ...rest } = value; onChange(rest); }}>X</Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange({ ...value, '': '' })}>+ Add Variable</Button>
    </div>
  );
}
