/**
 * JS mirror of the CSS tokens in app/globals.css, for places that need literal
 * colours (Recharts). Keep the two in sync. Values are placeholders until the
 * official brand palette is supplied.
 */
export const theme = {
  brand: "#0047bb",
  brandStrong: "#00307d",
  brandSoft: "#e8f0fc",
  ink: "#14213d",
  inkMuted: "#4a5873",
  border: "#d5dbe6",
  sentiment: { positive: "#1b7f3b", neutral: "#5c6577", negative: "#b42318" },
  /** Categorical series, colour-blind-friendly order. */
  series: ["#0047bb", "#e07b00", "#1b7f3b", "#6941c6", "#b42318", "#0e7490", "#7a5af8", "#475467"],
  /**
   * Chart marks. Sentiment is a diverging scale: blue ↔ red poles with a gray midpoint.
   * Green ↔ red was rejected: deuteranopes see ΔE 4.2 between them (validator target ≥ 8);
   * blue ↔ red gives 25.7. Text keeps the words "positive"/"negative" so colour never stands alone.
   */
  chart: {
    positive: "#2a78d6",
    neutral: "#898781",
    negative: "#e34948",
    /** One-series bars and lines. */
    single: "#2a78d6",
    grid: "#e1e0d9",
    axis: "#898781",
    label: "#4a5873",
  },
} as const;

export type Provenance = "OBSERVED" | "DERIVED" | "AI" | "ESTIMATED";

export const PROVENANCE: Record<Provenance, { color: string; definition: string }> = {
  OBSERVED: { color: "#1f5fbf", definition: "Taken directly from the uploaded review data." },
  DERIVED: { color: "#6941c6", definition: "Calculated deterministically from observed data by a documented formula." },
  AI: { color: "#b54708", definition: "Written or tagged by an AI model. Check it against the cited reviews." },
  ESTIMATED: { color: "#475467", definition: "Based on an assumption you can edit, not on measured data." },
};
