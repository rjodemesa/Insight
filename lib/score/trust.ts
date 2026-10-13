/**
 * Trust weight per review (DERIVED), 0–1.5. Weighted averages use it so that verified,
 * substantive, helpful reviews count for more than anonymous one-word ones:
 *   0 for duplicates; otherwise
 *   verified (1.0 yes, 0.8 unknown, 0.6 no)
 *   × text (0.5 none, 0.7 for 1–3 characters, 1.0 otherwise)
 *   × helpful bonus (1 + min(0.5, 0.1·log2(1 + helpful votes)))
 */
export const TRUST_FORMULA =
  "verified (1.0 / unknown 0.8 / no 0.6) × text (none 0.5 / 1–3 chars 0.7 / else 1.0) × (1 + min(0.5, 0.1·log2(1 + helpful votes))); duplicates 0";

export function trustWeight(r: {
  isDuplicate: boolean;
  verifiedPurchase: number | null;
  textLength: number;
  helpfulCount: number | null;
}): number {
  if (r.isDuplicate) return 0;
  const verified = r.verifiedPurchase === 1 ? 1 : r.verifiedPurchase === 0 ? 0.6 : 0.8;
  const text = r.textLength === 0 ? 0.5 : r.textLength <= 3 ? 0.7 : 1;
  const helpful = 1 + Math.min(0.5, 0.1 * Math.log2(1 + Math.max(0, r.helpfulCount ?? 0)));
  return Math.round(verified * text * helpful * 1000) / 1000;
}
