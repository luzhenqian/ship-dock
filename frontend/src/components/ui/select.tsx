'use client';

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { useFloating, offset, flip, shift, size } from "@floating-ui/react-dom"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

function Select({ value, onChange, options, placeholder = "Select...", className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    open,
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip({ fallbackAxisSideDirection: 'end' }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(availableHeight - 8, 80)}px`;
        },
      }),
    ],
  });

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const reference = refs.reference.current as HTMLElement | null;
      if (reference?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, refs.reference]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={refs.setReference as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
      >
        <span className={selected ? '' : 'text-foreground-muted'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && createPortal(
        <div
          ref={(node) => {
            refs.setFloating(node);
            (listRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          style={{ ...floatingStyles, zIndex: 9999, width: (refs.reference.current as HTMLElement)?.offsetWidth }}
          className="overflow-y-auto rounded-lg border bg-background shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="flex w-full items-center justify-between px-2.5 py-2 text-[13px] hover:bg-foreground/[0.04] first:rounded-t-lg last:rounded-b-lg"
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <span>{option.label}</span>
              {value === option.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export { Select }
export type { SelectOption }
