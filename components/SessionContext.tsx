"use client";

import { createContext, useCallback, useContext } from "react";
import type { Role } from "@/lib/auth/session";

interface ClientSession {
  csrfToken: string;
  role: Role;
  email: string;
}

const Ctx = createContext<ClientSession | null>(null);

export function SessionProvider({ value, children }: { value: ClientSession; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): ClientSession {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** fetch() that adds the CSRF header and parses JSON errors into a message. */
export function useApi() {
  const { csrfToken } = useSession();
  // Stable identity so callers can list it in effect dependencies.
  return useCallback(
    async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
      const res = await fetch(url, { ...init, headers: { ...init.headers, "X-CSRF-Token": csrfToken } });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
      return data;
    },
    [csrfToken],
  );
}
