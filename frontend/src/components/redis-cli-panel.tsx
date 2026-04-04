'use client';

import { useState, useRef, useEffect } from 'react';
import { useRedisCommand } from '@/hooks/use-redis';

interface RedisCliPanelProps {
  projectId: string;
}

export function RedisCliPanel({ projectId }: RedisCliPanelProps) {
  const [history, setHistory] = useState<Array<{ command: string; result: string; error?: boolean }>>([]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { mutateAsync } = useRedisCommand(projectId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    const command = input.trim();
    setCmdHistory((prev) => [command, ...prev]);
    setHistoryIndex(-1);
    setInput('');

    try {
      const data = await mutateAsync(command);
      setHistory((prev) => [...prev, {
        command,
        result: typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : String(data.result ?? '(nil)'),
      }]);
    } catch (err: any) {
      setHistory((prev) => [...prev, { command, result: err.message, error: true }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < cmdHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(cmdHistory[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  return (
    <div className="border rounded-xl bg-[#0a0a0a] text-[#e5e5e5] font-mono text-[13px] h-80 flex flex-col">
      <div className="flex-1 overflow-auto p-3">
        {history.map((entry, i) => (
          <div key={i} className="mb-2">
            <div className="text-cyan-400">{'>'} {entry.command}</div>
            <div className={entry.error ? 'text-red-400' : 'text-gray-300 whitespace-pre-wrap'}>{entry.result}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-gray-700 p-2 flex items-center gap-2">
        <span className="text-cyan-400">{'>'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter Redis command..."
          className="flex-1 bg-transparent outline-none text-sm"
          autoFocus
        />
      </div>
    </div>
  );
}
