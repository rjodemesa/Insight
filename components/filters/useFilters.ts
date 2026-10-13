"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { FILTER_KEYS, type FilterKey } from "@/lib/query/keys";

/**
 * Global filters live in the page URL (?brand=X&from=2024-01-01), in the same format the
 * APIs read. So the back button undoes a filter, a link shares a view, and drilling down
 * is just a link with one more parameter.
 */

/** Only the filter parameters of `sp`, in a stable order. */
export function filterQuery(sp: URLSearchParams | { getAll(k: string): string[] }): string {
  const out = new URLSearchParams();
  for (const k of FILTER_KEYS) for (const v of sp.getAll(k)) if (v) out.append(k, v);
  return out.toString();
}

/**
 * Link to `path` with the current filters plus `extra`. A key in `extra` replaces that
 * key's current values; null removes it. Non-filter parameters (e.g. view) are kept as given.
 */
export function drillHref(filters: string, extra: Record<string, string | string[] | null>, path = "/insights"): string {
  const sp = new URLSearchParams(filters);
  for (const [k, v] of Object.entries(extra)) {
    sp.delete(k);
    if (v === null) continue;
    for (const x of Array.isArray(v) ? v : [v]) sp.append(k, x);
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `?` + query, or "" when empty. */
export const withQuery = (qs: string) => (qs ? `?${qs}` : "");

export function useFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useMemo(() => filterQuery(sp), [sp]);

  const commit = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  /** Replace all values of one key (empty array or null clears it). Other params are kept. */
  const set = useCallback(
    (key: FilterKey | string, values: string[] | string | null) => {
      const next = new URLSearchParams(sp.toString());
      next.delete(key);
      for (const v of values === null ? [] : Array.isArray(values) ? values : [values]) if (v) next.append(key, v);
      // A new filter or sort order starts again from the first page.
      if (FILTER_KEYS.includes(key as FilterKey) || key === "sort") next.delete("offset");
      commit(next);
    },
    [commit, sp],
  );

  /** Replace every filter at once (saved views), keeping non-filter params such as `view`. */
  const replaceAll = useCallback(
    (filters: string) => {
      const next = new URLSearchParams(sp.toString());
      for (const k of FILTER_KEYS) next.delete(k);
      next.delete("offset");
      for (const [k, v] of new URLSearchParams(filters)) next.append(k, v);
      commit(next);
    },
    [commit, sp],
  );

  return {
    query,
    params: sp,
    get: (k: string) => sp.get(k),
    getAll: (k: string) => sp.getAll(k),
    set,
    replaceAll,
    clear: () => replaceAll(""),
  };
}
