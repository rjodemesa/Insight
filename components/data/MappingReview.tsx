"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "@/components/SessionContext";
import { useJson } from "@/components/ui/useJson";
import Card from "@/components/ui/Card";
import { num } from "@/components/ui/format";

interface Row {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  size: string | null;
  aliases: number;
  lowestSimilarity: number;
  reviews: number;
}
interface ListResponse {
  total: number;
  limit: number;
  offset: number;
  products: Row[];
  method: string;
}
interface Alias {
  id: number;
  name: string;
  code: string | null;
  upc: string | null;
  similarity: number | null;
}
interface AliasResponse {
  product: { id: number; name: string; brand: string | null; size: string | null };
  aliases: Alias[];
}

const PAGE = 25;

/**
 * Product-mapping review: weakest matches first. Tick products to merge them, or open one
 * to split listing names off into a new product. Every change is audited and kept by
 * later imports and reprocessing.
 */
export default function MappingReview() {
  const api = useApi();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Row[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(Number(sp.get("mapping")) || null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = useJson<ListResponse>(`/api/mapping?limit=${PAGE}&offset=${offset}${search ? `&q=${encodeURIComponent(search)}` : ""}`);

  useEffect(() => {
    const id = Number(sp.get("mapping"));
    if (id) setOpenId(id);
  }, [sp]);

  const toggle = (r: Row) => {
    setPicked((p) => (p.some((x) => x.id === r.id) ? p.filter((x) => x.id !== r.id) : [...p, r]));
    setTarget((t) => t ?? r.id);
  };

  async function merge() {
    if (target === null || picked.length < 2) return;
    const into = picked.find((p) => p.id === target)!;
    const others = picked.filter((p) => p.id !== target);
    if (!window.confirm(`Merge ${others.length} product(s) into “${into.name}”? Their listing names and reviews move to it.`)) return;
    try {
      const r = await api<{ reviewsMoved: number; aliasesMoved: number }>("/api/products/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target, sourceIds: others.map((o) => o.id) }),
      });
      setMsg({ ok: true, text: `Merged. ${num(r.aliasesMoved)} listing names and ${num(r.reviewsMoved)} reviews moved to “${into.name}”.` });
      setPicked([]);
      setTarget(null);
      void list.reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  const d = list.data;
  return (
    <Card
      title="Product mapping review"
      provenance="DERIVED"
      subtitle={d ? `${num(d.total)} products. ${d.method}` : undefined}
      loading={list.loading}
      error={list.error}
    >
      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); setOffset(0); setSearch(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or brand" aria-label="Search products"
          className="w-64 rounded border border-line px-2 py-1" />
        <button type="submit" className="rounded border border-line px-3 py-1">Search</button>
        {picked.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {picked.length} selected
            {picked.length >= 2 && (
              <>
                <label className="flex items-center gap-1">
                  keep
                  <select value={target ?? ""} onChange={(e) => setTarget(Number(e.target.value))} className="max-w-56 rounded border border-line px-1 py-0.5">
                    {picked.map((p) => <option key={p.id} value={p.id}>{p.name} (#{p.id})</option>)}
                  </select>
                </label>
                <button type="button" onClick={merge} className="rounded bg-brand px-3 py-1 text-white">Merge</button>
              </>
            )}
            <button type="button" onClick={() => { setPicked([]); setTarget(null); }} className="text-brand underline">clear</button>
          </span>
        )}
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mb-2 text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}

      {d && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1 pr-2"><span className="sr-only">Select</span></th>
                <th className="pr-3 font-medium">Product</th>
                <th className="pr-3 text-right font-medium">Listing names</th>
                <th className="pr-3 text-right font-medium" title="Weakest name match (1 = exact)">Lowest similarity</th>
                <th className="pr-3 text-right font-medium">Reviews</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.products.map((r) => (
                <tr key={r.id} className={`border-t border-line ${openId === r.id ? "bg-brand-soft" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.some((p) => p.id === r.id)} onChange={() => toggle(r)} />
                  </td>
                  <td className="pr-3">
                    <Link href={`/insights/product/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
                    <div className="text-xs text-ink-muted">{[r.brand, r.category, r.size].filter(Boolean).join(" · ")} · #{r.id}</div>
                  </td>
                  <td className="pr-3 text-right tabular-nums">{r.aliases}</td>
                  <td className="pr-3 text-right tabular-nums">{r.lowestSimilarity.toFixed(2)}</td>
                  <td className="pr-3 text-right tabular-nums">{num(r.reviews)}</td>
                  <td>
                    <button type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)} className="text-brand underline">
                      {openId === r.id ? "close" : "split…"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav aria-label="Pages" className="mt-2 flex items-center justify-between text-sm">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded border border-line px-3 py-1 disabled:opacity-40">← Previous</button>
            <span className="text-ink-muted">{num(offset + 1)}–{num(Math.min(offset + PAGE, d.total))} of {num(d.total)}</span>
            <button type="button" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Next →</button>
          </nav>
        </div>
      )}

      {openId !== null && (
        <SplitPanel id={openId} onDone={(text) => { setMsg({ ok: true, text }); void list.reload(); }} onClose={() => setOpenId(null)} />
      )}
    </Card>
  );
}

function SplitPanel({ id, onDone, onClose }: { id: number; onDone: (msg: string) => void; onClose: () => void }) {
  const api = useApi();
  const { data, error, reload } = useJson<AliasResponse>(`/api/mapping/${id}`);
  const [chosen, setChosen] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setChosen([]), [id]);

  async function split() {
    try {
      const r = await api<{ newProductId: number; newName: string; reviewsMoved: number }>(`/api/products/${id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliasIds: chosen, name: name.trim() || null }),
      });
      onDone(`Split off “${r.newName}” (#${r.newProductId}) with ${num(r.reviewsMoved)} reviews.`);
      setChosen([]);
      setName("");
      setErr(null);
      void reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section aria-label="Split product" className="mt-4 rounded-lg border border-brand p-3 text-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          Split “{data?.product.name ?? `#${id}`}”
          <span className="block text-xs font-normal text-ink-muted">Tick the listing names that are a different product. At least one must stay.</span>
        </h3>
        <button type="button" onClick={onClose} aria-label="Close split panel" className="text-ink-muted">×</button>
      </div>
      {error && <p role="alert" className="text-negative">{error}</p>}
      {data && (
        <>
          <ul className="max-h-64 space-y-1 overflow-auto">
            {data.aliases.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={chosen.includes(a.id)}
                    onChange={() => setChosen((c) => (c.includes(a.id) ? c.filter((x) => x !== a.id) : [...c, a.id]))} />
                  <span className="flex-1">{a.name}{a.code && <span className="text-xs text-ink-muted"> · code {a.code}</span>}{a.upc && <span className="text-xs text-ink-muted"> · UPC {a.upc}</span>}</span>
                  <span className="tabular-nums text-xs text-ink-muted">{a.similarity?.toFixed(2) ?? "–"}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Name for the new product (optional)"
              aria-label="New product name" className="w-72 rounded border border-line px-2 py-1" />
            <button type="button" disabled={!chosen.length || chosen.length >= data.aliases.length} onClick={split}
              className="rounded bg-brand px-3 py-1 text-white disabled:opacity-40">Split {chosen.length || ""} into new product</button>
            {err && <span role="alert" className="text-negative">{err}</span>}
          </div>
        </>
      )}
    </section>
  );
}
