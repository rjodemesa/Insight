import type Database from "better-sqlite3";
import { arr, obj, str, type AIProvider, type AITask } from "@/lib/ai/provider";
import { cite, GROUNDING_RULES, type Fact, type SourceReview } from "@/lib/ai/grounding";
import { detect, type AlertKind, type Candidate, type Severity } from "./detect";

/**
 * The agent: detect (fixed rules) → drop changes already proposed → the AI writes a short
 * description and a suggested next step for each new one → stored as `proposed`.
 * Nothing leaves the app and nothing counts as an alert until a person approves it.
 */

const MAX_NEW = 10;

export interface Evidence {
  facts: Fact[];
  reviews: SourceReview[];
}

interface Written {
  key: string;
  title: string;
  description: string;
  recommendation: string;
}

const NEXT_STEP: Record<AlertKind, string> = {
  theme_rising: "Read the recent complaints to confirm the pattern, then check with the product or supply team whether a batch, formula or packaging change lines up with the start of the rise.",
  negative_share_rising: "Open the negative reviews for this month to see which themes drive the rise before acting; the month may still be incomplete.",
  retailer_outlier: "Compare this retailer's complaints with other retailers (delivery, packaging damage, authenticity) and raise them with the account team if they are retailer-specific.",
};

/** Numbers each candidate's evidence as facts F1… and its sample reviews, for the prompt and for citations. */
function evidenceFor(c: Candidate, offset: number): Evidence {
  return { facts: c.evidence.map((text, i) => ({ id: `F${offset + i + 1}`, text, drill: c.drill })), reviews: c.reviews };
}

export function alertTask(items: { key: string; c: Candidate; ev: Evidence }[]): AITask<Written[]> {
  const keys = new Set(items.map((i) => i.key));
  return {
    name: "alert",
    system: `You write alerts for P&G Philippines brand teams about changes found in consumer reviews. The app has already detected each change with a statistical test; you only explain it.
For each alert give: a title of at most 10 words; a description of 1 to 3 sentences saying what changed and what customers say, citing the facts and reviews; and one concrete next step for the team.
Return one entry per alert, with its key copied exactly.

${GROUNDING_RULES}`,
    prompt: items
      .map(({ key, c, ev }) =>
        [
          `ALERT ${key} (severity ${c.severity}; draft title: ${c.title})`,
          ...ev.facts.map((f) => `[${f.id}] ${f.text}`),
          ...ev.reviews.map((r) => `[R${r.id}] (${[r.date, r.rating !== null ? `${r.rating}★` : null, r.retailer, r.brand].filter(Boolean).join(", ")}) ${r.text}`),
        ].join("\n"),
      )
      .join("\n\n"),
    maxOutputTokens: 8192,
    schema: {
      type: "OBJECT",
      properties: {
        alerts: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { key: { type: "STRING" }, title: { type: "STRING" }, description: { type: "STRING" }, recommendation: { type: "STRING" } },
            required: ["key", "title", "description", "recommendation"],
          },
        },
      },
      required: ["alerts"],
    },
    parse(raw) {
      const out: Written[] = [];
      for (const a of arr(obj(raw, "alerts").alerts)) {
        const x = (a ?? {}) as Record<string, unknown>;
        const key = typeof x.key === "string" ? x.key : "";
        if (!keys.has(key) || out.some((o) => o.key === key)) continue;
        out.push({ key, title: str(x.title, 120), description: str(x.description, 1000), recommendation: str(x.recommendation, 500) });
      }
      return out;
    },
    mock() {
      return {
        alerts: items.map(({ key, c, ev }) => ({
          key,
          title: c.title,
          description: `${ev.facts[0]!.text} [${ev.facts[0]!.id}]${ev.reviews[0] ? ` For example [R${ev.reviews[0].id}].` : ""}`,
          recommendation: NEXT_STEP[c.kind],
        })),
      };
    },
  };
}

export interface ScanStats {
  detected: number;
  alreadyProposed: number;
  created: number;
  writtenBy: string;
  aiError: string | null;
}

export async function runAgent(conn: Database.Database, provider: AIProvider): Promise<ScanStats> {
  const found = detect(conn);
  const exists = conn.prepare("SELECT 1 FROM alerts WHERE dedupe_key = ?").pluck();
  const fresh = found.filter((c) => !exists.get(c.key));
  const take = fresh.slice(0, MAX_NEW);
  let offset = 0;
  const items = take.map((c) => {
    const ev = evidenceFor(c, offset);
    offset += ev.facts.length;
    return { key: c.key, c, ev };
  });

  // If the AI fails, the alerts are still proposed with the rule-written text.
  let written = new Map<string, Written>();
  let writtenBy = "rules";
  let aiError: string | null = null;
  if (items.length) {
    try {
      const res = await provider.run(alertTask(items));
      written = new Map(res.data.map((w) => [w.key, w]));
      writtenBy = provider.name === "mock" ? "mock" : `${provider.name}:${provider.model}`;
    } catch (err) {
      aiError = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    }
  }

  const insert = conn.prepare(
    `INSERT INTO alerts (title, description, severity, evidence, status, kind, dedupe_key, recommendation, drill, written_by)
     VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?)`,
  );
  conn.transaction(() => {
    for (const { key, c, ev } of items) {
      const w = written.get(key);
      const description = w?.description ? cite(w.description, ev.facts, ev.reviews).text : "";
      insert.run(
        w?.title || c.title,
        description || ev.facts.map((f) => `${f.text} [${f.id}]`).join(" "),
        c.severity,
        JSON.stringify(ev),
        c.kind,
        key,
        w?.recommendation || NEXT_STEP[c.kind],
        JSON.stringify(c.drill),
        w?.description ? writtenBy : "rules",
      );
    }
  })();
  return { detected: found.length, alreadyProposed: found.length - fresh.length, created: items.length, writtenBy, aiError };
}

export type AlertStatus = "proposed" | "approved" | "dismissed";

export interface AlertRow {
  id: number;
  createdAt: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  severity: Severity;
  kind: AlertKind | null;
  status: AlertStatus;
  evidence: Evidence;
  drill: Record<string, string>;
  writtenBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export function listAlerts(conn: Database.Database, status: AlertStatus | "all", limit = 200): { alerts: AlertRow[]; counts: Record<AlertStatus, number> } {
  const rows = conn
    .prepare(
      `SELECT a.id, a.created_at AS createdAt, a.title, a.description, a.recommendation, a.severity, a.kind, a.status,
         a.evidence, a.drill, a.written_by AS writtenBy, u.email AS decidedBy, a.decided_at AS decidedAt, a.decision_note AS decisionNote
       FROM alerts a LEFT JOIN users u ON u.id = a.decided_by
       WHERE (? = 'all' OR a.status = ?)
       ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.id DESC LIMIT ?`,
    )
    .all(status, status, limit) as (Omit<AlertRow, "evidence" | "drill"> & { evidence: string | null; drill: string | null })[];
  const parse = <T,>(s: string | null, d: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : d;
    } catch {
      return d;
    }
  };
  const counts = { proposed: 0, approved: 0, dismissed: 0 };
  for (const r of conn.prepare("SELECT status, COUNT(*) AS n FROM alerts GROUP BY status").all() as { status: AlertStatus; n: number }[]) counts[r.status] = r.n;
  return {
    alerts: rows.map((r) => ({ ...r, evidence: parse(r.evidence, { facts: [], reviews: [] }), drill: parse(r.drill, {}) })),
    counts,
  };
}

export class DecisionError extends Error {}

/** Approve or dismiss a proposed alert. Decisions are final; the note says why. */
export function decide(conn: Database.Database, id: number, userId: number, decision: unknown, note: unknown) {
  if (decision !== "approve" && decision !== "dismiss") throw new DecisionError("Decision must be approve or dismiss.");
  const clean = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  const status: AlertStatus = decision === "approve" ? "approved" : "dismissed";
  const info = conn
    .prepare(
      `UPDATE alerts SET status = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), decision_note = ?
       WHERE id = ? AND status = 'proposed'`,
    )
    .run(status, userId, clean || null, id);
  if (info.changes === 0) {
    const exists = conn.prepare("SELECT status FROM alerts WHERE id = ?").pluck().get(id) as string | undefined;
    throw new DecisionError(exists ? `This alert was already ${exists}.` : "Alert not found.");
  }
  return { id, status, note: clean || null };
}
