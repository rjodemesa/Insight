/**
 * Persona dashboards: picked from the Views menu, carried in the URL as ?persona=<key>.
 * Without it the Dashboard shows the Overview. Each persona opens on its own default
 * filters (only vectors, never a hard-coded brand or retailer). Safe to import in the browser.
 */
export const PERSONA_DASHBOARDS = {
  leadership: { title: "Leadership", question: "Are our brands winning with consumers?", filters: "" },
  brand: { title: "Marketing", question: "How are our brands perceived, and what are people saying? Pick a brand in Filters to focus on it.", filters: "" },
  rnd: { title: "R&D", question: "What is wrong with the product itself? Opens on the Product and Packaging vectors.", filters: "vector=Product&vector=Packaging" },
  sales: { title: "Sales", question: "Where is the shelf or delivery experience failing? Opens on the Retail Execution vector.", filters: "vector=Retail+Execution" },
  analyst: { title: "Analyst", question: "Can the data be trusted, and what needs checking?", filters: "" },
} as const;

export type PersonaKey = keyof typeof PERSONA_DASHBOARDS;

export const PERSONA_PARAM = "persona";

export function personaFrom(value: string | null): PersonaKey | null {
  return value && value in PERSONA_DASHBOARDS ? (value as PersonaKey) : null;
}

/** Dashboard link for a persona (null = Overview), opening on its default filters. */
export function personaHref(key: PersonaKey | null): string {
  if (!key) return "/dashboard";
  const sp = new URLSearchParams(PERSONA_DASHBOARDS[key].filters);
  sp.set(PERSONA_PARAM, key);
  return `/dashboard?${sp}`;
}
