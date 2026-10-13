"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/components/SessionContext";

/**
 * GETs JSON from `url` and re-fetches when it changes; null skips the request. Keeps the
 * previous data while a new request is in flight, so charts dim instead of flashing.
 * Out-of-order responses are dropped.
 */
export function useJson<T>(url: string | null) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [api, url]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}
