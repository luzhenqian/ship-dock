'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EnvVarEditor({ value, onChange }: { value: Record<string, string>; onChange: (vars: Record<string, string>) => void }) {
  const entries = Object.entries(value);
  return (
    <div className="space-y-2">
      {entries.map(([key, val], i) => (
        <div key={i} className="flex gap-2">
          <Input placeholder="KEY" value={key} onChange={(e) => {
            const updated: Record<string, string> = {};
            for (const [k, v] of Object.entries(value)) {
              updated[k === key ? e.target.value : k] = v;
            }
            onChange(updated);
          }} className="font-mono" />
          <Input placeholder="value" value={val} onChange={(e) => onChange({ ...value, [key]: e.target.value })} className="font-mono" />
          <Button variant="ghost" size="sm" onClick={() => { const { [key]: _, ...rest } = value; onChange(rest); }}>X</Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange({ ...value, '': '' })}>+ Add Variable</Button>
    </div>
  );
}
