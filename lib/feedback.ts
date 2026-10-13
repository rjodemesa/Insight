import type Database from "better-sqlite3";
import { taxonomy } from "@/lib/nlp/taxonomy";

/**
 * Analyst feedback that improves the rules over time. Nothing here changes a tag or a
 * redaction directly: corrections are collected for whoever edits config/taxonomy.json,
 * the lexicon or the redaction rules.
 *
 * Tag feedback: `theme` is the disputed tag (a theme id, or "sentiment"); `suggested`
 * is what it should be (a theme id, a sentiment value, or null for "remove it").
 */
type Conn = Database.Database;

export class FeedbackError extends Error {}

const SENTIMENT_VALUES = ["positive", "neutral", "negative"];

const reviewExists = (conn: Conn, id: number) => conn.prepare("SELECT 1 FROM reviews WHERE id = ?").get(id) !== undefined;
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function addTagFeedback(conn: Conn, userId: number, body: { reviewId: unknown; theme: unknown; suggested: unknown; comment: unknown }) {
  const reviewId = Number(body.reviewId);
  if (!Number.isInteger(reviewId) || reviewId <= 0 || !reviewExists(conn, reviewId)) throw new FeedbackError("Review not found.");
  const ids = new Set(taxonomy().themes.map((t) => t.id));
  const theme = clean(body.theme, 60) || null;
  const suggested = clean(body.suggested, 60) || null;
  if (theme && theme !== "sentiment" && !ids.has(theme)) throw new FeedbackError("Unknown tag.");
  if (suggested && !ids.has(suggested) && !SENTIMENT_VALUES.includes(suggested)) throw new FeedbackError("Unknown suggestion.");
  if (theme === "sentiment" && suggested && !SENTIMENT_VALUES.includes(suggested)) throw new FeedbackError("Suggest positive, neutral or negative.");
  if (!theme && !suggested) throw new FeedbackError("Say which tag is wrong or which one is missing.");
  const comment = clean(body.comment, 500) || null;
  const id = Number(
    conn
      .prepare("INSERT INTO tag_feedback (review_id, user_id, theme, suggested_theme, comment) VALUES (?, ?, ?, ?, ?)")
      .run(reviewId, userId, theme, suggested, comment).lastInsertRowid,
  );
  return { id, reviewId, theme, suggested };
}

export function addRedactionFlag(conn: Conn, userId: number, body: { reviewId: unknown; note: unknown }) {
  const reviewId = Number(body.reviewId);
  if (!Number.isInteger(reviewId) || reviewId <= 0 || !reviewExists(conn, reviewId)) throw new FeedbackError("Review not found.");
  // The note says what kind of data was missed. It must not repeat the data itself.
  const note = clean(body.note, 300) || null;
  const id = Number(conn.prepare("INSERT INTO redaction_flags (review_id, user_id, note) VALUES (?, ?, ?)").run(reviewId, userId, note).lastInsertRowid);
  return { id, reviewId };
}

/** Latest feedback with counts per disputed tag, for the triage list on the Data tab. */
export function listFeedback(conn: Conn, limit = 100) {
  const tax = taxonomy();
  const label = (id: string | null) => (id ? tax.byId.get(id)?.label ?? id : null);
  const tags = conn
    .prepare(
      `SELECT f.id, f.review_id AS reviewId, f.theme, f.suggested_theme AS suggested, f.comment, f.created_at AS createdAt, u.email AS user
       FROM tag_feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT ?`,
    )
    .all(limit) as { id: number; reviewId: number; theme: string | null; suggested: string | null; comment: string | null; createdAt: string; user: string | null }[];
  const byTheme = conn
    .prepare("SELECT theme, suggested_theme AS suggested, COUNT(*) AS n FROM tag_feedback GROUP BY theme, suggested_theme ORDER BY n DESC LIMIT 20")
    .all() as { theme: string | null; suggested: string | null; n: number }[];
  const redactions = conn
    .prepare(
      `SELECT f.id, f.review_id AS reviewId, f.note, f.created_at AS createdAt, u.email AS user
       FROM redaction_flags f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT ?`,
    )
    .all(limit);
  const totals = conn
    .prepare("SELECT (SELECT COUNT(*) FROM tag_feedback) AS tags, (SELECT COUNT(*) FROM redaction_flags) AS redactions")
    .get() as { tags: number; redactions: number };
  return {
    totals,
    tags: tags.map((t) => ({ ...t, themeLabel: t.theme === "sentiment" ? "Sentiment" : label(t.theme), suggestedLabel: label(t.suggested) })),
    byTheme: byTheme.map((t) => ({ ...t, themeLabel: t.theme === "sentiment" ? "Sentiment" : label(t.theme), suggestedLabel: label(t.suggested) })),
    redactions,
  };
}
