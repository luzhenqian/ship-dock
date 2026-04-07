'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

interface EnvVar {
  key: string;
  originalValue: string;
  suggestedValue: string;
  autoMapped: boolean;
  warning?: string;
}

interface ImportEnvMapperProps {
  envVars: EnvVar[];
  onChange: (vars: Record<string, string>) => void;
}

export function ImportEnvMapper({ envVars, onChange }: ImportEnvMapperProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of envVars) {
      initial[v.key] = v.suggestedValue;
    }
    return initial;
  });

  function handleChange(key: string, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    onChange(next);
  }

  function handleKeepOriginal(key: string, originalValue: string) {
    handleChange(key, originalValue);
  }

  if (envVars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No environment variables detected.</p>
    );
  }

  return (
    <div className="space-y-3">
      {envVars.map((v) => (
        <div key={v.key} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Label className="font-mono text-xs">{v.key}</Label>
            {v.autoMapped && (
              <Badge variant="secondary" className="text-[10px]">
                auto-mapped
              </Badge>
            )}
          </div>
          {v.warning && (
            <p className="text-xs text-destructive">{v.warning}</p>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={values[v.key] ?? ''}
              onChange={(e) => handleChange(v.key, e.target.value)}
              className="font-mono text-xs"
              placeholder={v.originalValue}
            />
            {values[v.key] !== v.originalValue && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleKeepOriginal(v.key, v.originalValue)}
                title="Keep original value"
              >
                <RotateCcw className="size-3" />
              </Button>
            )}
          </div>
          {v.suggestedValue !== v.originalValue && (
            <p className="text-[11px] text-muted-foreground">
              Original: <span className="font-mono">{v.originalValue || '(empty)'}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
