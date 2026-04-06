'use client';

import { useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from 'next-themes';
import { EditorView, keymap } from '@codemirror/view';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  schema?: Record<string, string[]>;
}

export function SqlEditor({ value, onChange, onExecute, schema }: SqlEditorProps) {
  const { resolvedTheme } = useTheme();

  const executeKeymap = keymap.of([
    {
      key: 'Mod-Enter',
      run: () => {
        onExecute();
        return true;
      },
    },
  ]);

  const handleChange = useCallback(
    (val: string) => onChange(val),
    [onChange],
  );

  return (
    <CodeMirror
      value={value}
      onChange={handleChange}
      extensions={[
        sql({ dialect: PostgreSQL, schema }),
        executeKeymap,
        EditorView.lineWrapping,
      ]}
      theme={resolvedTheme === 'dark' ? oneDark : 'light'}
      height="128px"
      className="border rounded-md overflow-hidden text-sm"
      placeholder="SELECT * FROM users LIMIT 10;"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
      }}
    />
  );
}
