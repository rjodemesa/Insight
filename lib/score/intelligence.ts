/**
 * Intelligence Score (DERIVED), 0–100, for a product, brand or any filtered set:
 *
 *   raw = 100 × (0.40·S + 0.35·R + 0.25·Q)
 *     S = (trust-weighted mean text sentiment + 1) / 2     text sentiment, 0–1
 *     R = (trust-weighted mean star rating − 1) / 4        rating, 0–1
 *     Q = 1 − trust-weighted share of reviews with a negative theme   issue-free share, 0–1
 *   A missing component (e.g. no ratings) is dropped and the other weights rescaled.
 *
 *   score = (w·raw + K·prior) / (w + K),  K = 20
 *     w = sum of trust weights (effective sample size); prior = the same raw score
 *     over the comparison set (e.g. the whole category). Small samples are pulled
 *     toward the prior, so 3 glowing reviews do not outrank 3,000 good ones.
 */
export const SCORE_WEIGHTS = { sentiment: 0.4, rating: 0.35, issueFree: 0.25 } as const;
export const SHRINKAGE_K = 20;

export const INTELLIGENCE_FORMULA =
  "100 × (0.40·sentiment + 0.35·rating + 0.25·issue-free share), trust-weighted, then shrunk toward the comparison-set score: (w·raw + 20·prior) / (w + 20)";

export interface ScoreInputs {
  /** Number of reviews (not duplicates). */
  n: number;
  /** Sum of trust weights. */
  weight: number;
  /** Trust-weighted mean compound sentiment, -1..1, or null if no text. */
  sentiment: number | null;
  /** Trust-weighted mean rating, 1..5, or null if no ratings. */
  rating: number | null;
  /** Trust-weighted share of reviews with at least one negative theme, 0..1. */
  issueShare: number | null;
}

export interface ScoreResult {
  score: number | null;
  raw: number | null;
  prior: number | null;
  components: { sentiment: number | null; rating: number | null; issueFree: number | null };
  n: number;
  effectiveN: number;
  /** How far to trust the score, from sample size alone. */
  reliability: "low" | "medium" | "high";
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function rawScore(i: ScoreInputs): { raw: number | null; components: ScoreResult["components"] } {
  const components = {
    sentiment: i.sentiment === null ? null : clamp01((i.sentiment + 1) / 2),
    rating: i.rating === null ? null : clamp01((i.rating - 1) / 4),
    issueFree: i.issueShare === null ? null : clamp01(1 - i.issueShare),
  };
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
    const c = components[k];
    if (c === null) continue;
    sum += SCORE_WEIGHTS[k] * c;
    w += SCORE_WEIGHTS[k];
  }
  return { raw: w === 0 ? null : (100 * sum) / w, components };
}

export function intelligenceScore(i: ScoreInputs, prior: number | null): ScoreResult {
  const { raw, components } = rawScore(i);
  let score: number | null = raw;
  if (raw !== null && prior !== null) score = (i.weight * raw + SHRINKAGE_K * prior) / (i.weight + SHRINKAGE_K);
  const r = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
  return {
    score: score === null ? null : round1(score),
    raw: raw === null ? null : round1(raw),
    prior: prior === null ? null : round1(prior),
    components: { sentiment: r(components.sentiment), rating: r(components.rating), issueFree: r(components.issueFree) },
    n: i.n,
    effectiveN: round1(i.weight),
    reliability: i.n < 30 ? "low" : i.n < 100 ? "medium" : "high",
  };
}
