'use client';

import * as React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openAbove = spaceBelow < dropdown.scrollHeight && spaceAbove > spaceBelow;
    const maxH = Math.max(openAbove ? spaceAbove : spaceBelow, 80);

    Object.assign(dropdown.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: '9999',
      maxHeight: `${maxH}px`,
      overflowY: maxH < dropdown.scrollHeight ? 'auto' : '',
      top: openAbove ? '' : `${rect.bottom + 4}px`,
      bottom: openAbove ? `${window.innerHeight - rect.top + 4}px` : '',
    });
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <div ref={triggerRef} className={cn("relative", className)}>
      <button
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
        <div ref={dropdownRef} className="rounded-lg border bg-background shadow-lg">
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
