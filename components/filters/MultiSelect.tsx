"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
  count?: number;
  group?: string;
}

/** Button + checkbox list. Type to narrow long lists; Escape or a click outside closes it. */
export default function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  let lastGroup: string | undefined;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`rounded border px-2.5 py-1.5 text-sm ${selected.length ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
      >
        {label}
        {selected.length > 0 && <span className="ml-1 font-semibold">({selected.length})</span>}
        <span aria-hidden="true" className="ml-1 text-ink-muted">▾</span>
      </button>
      {open && (
        <div id={id} role="group" aria-label={label} className="absolute z-20 mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-lg">
          {options.length > 10 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="mb-2 w-full rounded border border-line px-2 py-1 text-sm"
            />
          )}
          <ul className="max-h-64 overflow-y-auto text-sm">
            {shown.map((o) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={o.value}>
                  {header && <div className="mt-1 px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{header}</div>}
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-canvas">
                    <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                    <span className="flex-1">{o.label}</span>
                    {o.count !== undefined && <span className="tabular-nums text-xs text-ink-muted">{o.count.toLocaleString("en-PH")}</span>}
                  </label>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-1 py-1 text-ink-muted">No matches.</li>}
          </ul>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-2 text-sm text-brand underline">
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
