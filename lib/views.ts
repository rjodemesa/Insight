import type Database from "better-sqlite3";
import { canonicalFilterQuery } from "@/lib/query/filters";

/**
 * Saved views: named filter sets, private to the user who saved them. Built-in starting
 * points per persona are listed alongside (not stored), using only filters that exist in
 * any dataset (themes, vectors, sentiment), never a hard-coded brand or retailer.
 */
type Conn = Database.Database;

export const PERSONAS = {
  analyst: "A&I Analyst",
  brand: "Brand / Marketing",
  rnd: "R&D / Product",
  sales: "Sales / Retail",
  leadership: "Leadership",
} as const;
export type Persona = keyof typeof PERSONAS;

export const MAX_VIEWS_PER_USER = 50;

export const PRESET_VIEWS: { id: string; persona: Persona; name: string; filters: string }[] = [
  { id: "preset:leadership-verified", persona: "leadership", name: "Verified purchases only", filters: "verified=true" },
  { id: "preset:brand-negative", persona: "brand", name: "Negative reviews", filters: "sentiment=negative" },
  { id: "preset:brand-communication", persona: "brand", name: "Claims, ads and labels", filters: "vector=Communication" },
  { id: "preset:rnd-issues", persona: "rnd", name: "Product and packaging complaints", filters: "vector=Product&vector=Packaging&themeSentiment=negative" },
  { id: "preset:rnd-leaks", persona: "rnd", name: "Leaks, caps and seals", filters: "theme=leak&theme=cap_seal&theme=damaged_packaging&themeSentiment=negative" },
  { id: "preset:sales-delivery", persona: "sales", name: "Delivery and seller issues", filters: "theme=delivery_speed&theme=seller_service&theme=wrong_missing_item&themeSentiment=negative" },
  { id: "preset:sales-authenticity", persona: "sales", name: "Authenticity and expiry concerns", filters: "theme=authenticity&theme=expiry" },
  { id: "preset:analyst-conflicts", persona: "analyst", name: "Rating disagrees with text", filters: "conflict=true" },
  { id: "preset:analyst-value", persona: "analyst", name: "Price and value complaints", filters: "vector=Value&themeSentiment=negative" },
];

export class ViewError extends Error {}

export function listViews(conn: Conn, userId: number) {
  const saved = conn
    .prepare("SELECT id, persona, name, filters, created_at AS createdAt FROM saved_views WHERE user_id = ? ORDER BY persona, name")
    .all(userId);
  return { personas: PERSONAS, saved, presets: PRESET_VIEWS };
}

export function saveView(conn: Conn, userId: number, body: { name: unknown; persona: unknown; filters: unknown }) {
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!name) throw new ViewError("Give the view a name.");
  const persona = typeof body.persona === "string" && body.persona in PERSONAS ? body.persona : null;
  if (typeof body.filters !== "string") throw new ViewError("No filters to save.");
  const filters = canonicalFilterQuery(new URLSearchParams(body.filters.slice(0, 4000)));
  const count = conn.prepare("SELECT COUNT(*) FROM saved_views WHERE user_id = ?").pluck().get(userId) as number;
  const existing = conn.prepare("SELECT id FROM saved_views WHERE user_id = ? AND name = ?").pluck().get(userId, name) as number | undefined;
  if (existing === undefined && count >= MAX_VIEWS_PER_USER) throw new ViewError(`You can keep up to ${MAX_VIEWS_PER_USER} views. Delete one first.`);
  if (existing !== undefined) {
    conn.prepare("UPDATE saved_views SET persona = ?, filters = ? WHERE id = ?").run(persona, filters, existing);
    return { id: existing, name, persona, filters, replaced: true };
  }
  const id = Number(
    conn.prepare("INSERT INTO saved_views (user_id, persona, name, filters) VALUES (?, ?, ?, ?)").run(userId, persona, name, filters).lastInsertRowid,
  );
  return { id, name, persona, filters, replaced: false };
}

/** Deletes one of the user's own views. Returns false when it is not theirs or does not exist. */
export function deleteView(conn: Conn, userId: number, id: number): boolean {
  return conn.prepare("DELETE FROM saved_views WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
