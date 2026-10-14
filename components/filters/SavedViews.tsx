"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERSONA_DASHBOARDS, PERSONA_PARAM, personaFrom, personaHref, type PersonaKey } from "@/lib/personas";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import { useFilters } from "./useFilters";

interface View {
  id: number | string;
  persona: string | null;
  name: string;
  filters: string;
}
interface ViewsResponse {
  personas: Record<string, string>;
  saved: View[];
  presets: View[];
}

/**
 * Switch between the Overview and the persona dashboards, apply a saved or built-in view,
 * save the current filters under a name, or delete your own views.
 */
export default function SavedViews() {
  const api = useApi();
  const f = useFilters();
  const router = useRouter();
  const openPersona = personaFrom(useSearchParams().get(PERSONA_PARAM));
  // Highlight the open dashboard only while on the Dashboard tab.
  const current = usePathname() === "/dashboard" ? openPersona : undefined;
  const { data, reload } = useJson<ViewsResponse>("/api/views");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const v = await api<{ replaced: boolean }>("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, persona: persona || null, filters: f.query }),
      });
      setMsg(v.replaced ? `Updated “${name}”.` : `Saved “${name}”.`);
      setName("");
      void reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function remove(v: View) {
    if (!window.confirm(`Delete the view “${v.name}”?`)) return;
    try {
      await api(`/api/views/${v.id}`, { method: "DELETE" });
      void reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const personas = data?.personas ?? {};
  const group = (list: View[]) => {
    const by = new Map<string, View[]>();
    for (const v of list) {
      const k = v.persona ? personas[v.persona] ?? v.persona : "Other";
      by.set(k, [...(by.get(k) ?? []), v]);
    }
    return [...by.entries()];
  };
  const openDashboard = (key: PersonaKey | null) => {
    router.push(personaHref(key));
    setOpen(false);
  };
  const dashboards: [PersonaKey | null, string][] = [[null, "Overview"], ...Object.entries(PERSONA_DASHBOARDS).map(([k, d]) => [k as PersonaKey, d.title] as [PersonaKey, string])];
  const apply = (v: View) => {
    f.replaceAll(v.filters);
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="rounded border border-line bg-surface px-2.5 py-1.5 text-sm">
        ☆ Views <span aria-hidden="true" className="text-ink-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 space-y-3 rounded-lg border border-line bg-surface p-3 text-sm shadow-lg">
          <section>
            <h3 className="mb-1 font-semibold">Dashboards</h3>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Dashboards">
              {dashboards.map(([key, title]) => (
                <button key={title} type="button" onClick={() => openDashboard(key)} aria-pressed={current === key}
                  className={`rounded border px-2 py-0.5 text-xs ${current === key ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft"}`}>
                  {title}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">My views</h3>
            {data?.saved.length ? (
              <ul className="space-y-0.5">
                {data.saved.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <button type="button" onClick={() => apply(v)} className="flex-1 text-left text-brand hover:underline">
                      {v.name}
                      {v.persona && <span className="ml-1 text-xs text-ink-muted">· {personas[v.persona] ?? v.persona}</span>}
                    </button>
                    <button type="button" onClick={() => remove(v)} aria-label={`Delete view ${v.name}`} className="text-ink-muted hover:text-negative">×</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">None yet. Save the current filters below.</p>
            )}
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Starting points</h3>
            {group(data?.presets ?? []).map(([label, list]) => (
              <div key={label} className="mb-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
                <ul>
                  {list.map((v) => (
                    <li key={v.id}>
                      <button type="button" onClick={() => apply(v)} className="text-left text-brand hover:underline">{v.name}</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <form onSubmit={save} className="space-y-1.5 border-t border-line pt-2">
            <h3 className="font-semibold">Save current filters</h3>
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="View name"
              aria-label="View name" className="w-full rounded border border-line px-2 py-1" />
            <div className="flex gap-2">
              <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona" className="flex-1 rounded border border-line px-1 py-1">
                <option value="">No persona</option>
                {Object.entries(personas).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="submit" className="rounded bg-brand px-3 py-1 text-white">Save</button>
            </div>
            {msg && <p role="status" className="text-xs text-ink-muted">{msg}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
