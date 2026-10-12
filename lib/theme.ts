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
} as const;

export type Provenance = "OBSERVED" | "DERIVED" | "AI" | "ESTIMATED";

export const PROVENANCE: Record<Provenance, { color: string; definition: string }> = {
  OBSERVED: { color: "#1f5fbf", definition: "Taken directly from the uploaded review data." },
  DERIVED: { color: "#6941c6", definition: "Calculated deterministically from observed data by a documented formula." },
  AI: { color: "#b54708", definition: "Written or tagged by an AI model. Check it against the cited reviews." },
  ESTIMATED: { color: "#475467", definition: "Based on an assumption you can edit, not on measured data." },
};
