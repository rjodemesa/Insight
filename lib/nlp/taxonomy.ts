import raw from "@/config/taxonomy.json";
import { lexicon, type Lexicon } from "./lexicon";
import { negatedAt, type SentenceScore, type SentimentLabel } from "./sentiment";
import { matchAt, tokenize, type Sentence } from "./text";

/**
 * Rule-based theme tagging against config/taxonomy.json. Each theme maps to one of the
 * Five Vectors. A theme's sentiment comes from its polar keywords ("tumagas" is always a
 * negative leak mention, "walang tagas" a positive one) or, for neutral keywords
 * ("delivery"), from the sentence the keyword is in.
 */
export const VECTORS = ["Product", "Packaging", "Communication", "Retail Execution", "Value"] as const;
export type Vector = (typeof VECTORS)[number];

interface ThemeDef {
  id: string;
  label: string;
  vector: string;
  keywords: string[];
  positive: string[];
  negative: string[];
}

interface Term {
  theme: number;
  tokens: string[];
  polarity: -1 | 0 | 1;
}

export interface ThemeInfo {
  id: string;
  label: string;
  vector: Vector;
}

export interface Taxonomy {
  version: string;
  themes: ThemeInfo[];
  byId: Map<string, ThemeInfo>;
  /** Terms indexed by their exact first token, longest first. */
  exact: Map<string, Term[]>;
  /** Single-token wildcard terms (leak*), matched by prefix. */
  prefixed: Term[];
}

export interface ThemeTag {
  theme: string;
  vector: Vector;
  sentiment: SentimentLabel;
  confidence: number;
}

export function compileTaxonomy(src: { version: string; themes: ThemeDef[] }): Taxonomy {
  const tax: Taxonomy = { version: src.version, themes: [], byId: new Map(), exact: new Map(), prefixed: [] };
  src.themes.forEach((t, idx) => {
    if (!/^[a-z_]+$/.test(t.id)) throw new Error(`Taxonomy: bad theme id "${t.id}".`);
    if (tax.byId.has(t.id)) throw new Error(`Taxonomy: duplicate theme id "${t.id}".`);
    if (!(VECTORS as readonly string[]).includes(t.vector)) throw new Error(`Taxonomy: theme "${t.id}" has unknown vector "${t.vector}".`);
    const info: ThemeInfo = { id: t.id, label: t.label, vector: t.vector as Vector };
    tax.themes.push(info);
    tax.byId.set(t.id, info);
    const seen = new Set<string>();
    // Polar lists first, so a word listed twice keeps its polarity.
    const lists: [string[], -1 | 0 | 1][] = [[t.negative, -1], [t.positive, 1], [t.keywords, 0]];
    for (const [list, polarity] of lists) {
      for (const text of list) {
        const tokens = tokenize(text.replace(/\*$/, "")).map((x, i, a) => (i === a.length - 1 && text.endsWith("*") ? `${x}*` : x));
        const key = tokens.join(" ");
        if (tokens.length === 0 || seen.has(key)) continue;
        seen.add(key);
        const term: Term = { theme: idx, tokens, polarity };
        if (tokens.length === 1 && tokens[0]!.endsWith("*")) tax.prefixed.push(term);
        else {
          const first = tokens[0]!;
          const list2 = tax.exact.get(first) ?? [];
          list2.push(term);
          list2.sort((a, b) => b.tokens.length - a.tokens.length);
          tax.exact.set(first, list2);
        }
      }
    }
  });
  return tax;
}

let cached: Taxonomy | null = null;
export function taxonomy(): Taxonomy {
  return (cached ??= compileTaxonomy(raw as { version: string; themes: ThemeDef[] }));
}

const SIGN: Record<SentimentLabel, -1 | 0 | 1> = { negative: -1, neutral: 0, positive: 1 };

export function tagThemes(
  sentences: Sentence[],
  scores: SentenceScore[],
  tax: Taxonomy = taxonomy(),
  lex: Lexicon = lexicon(),
): ThemeTag[] {
  const found = new Map<number, { pos: number; neg: number; mentions: number; strong: boolean }>();
  sentences.forEach((s, si) => {
    const { tokens } = s;
    const nextFree = new Map<number, number>(); // per theme: don't count overlapping terms twice
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const candidates = [...(tax.exact.get(tok) ?? []), ...tax.prefixed.filter((t) => tok.startsWith(t.tokens[0]!.slice(0, -1)))];
      const done = new Set<number>();
      for (const term of candidates) {
        if (done.has(term.theme) || (nextFree.get(term.theme) ?? 0) > i) continue;
        if (!matchAt(tokens, i, term.tokens)) continue;
        done.add(term.theme);
        nextFree.set(term.theme, i + term.tokens.length);
        let effect: number = term.polarity;
        if (effect !== 0) {
          if (!term.tokens.some((p) => lex.negators.has(p)) && negatedAt(lex, tokens, i)) effect = -effect;
        } else effect = SIGN[scores[si]?.label ?? "neutral"];
        const f = found.get(term.theme) ?? { pos: 0, neg: 0, mentions: 0, strong: false };
        f.mentions++;
        if (effect > 0) f.pos++;
        if (effect < 0) f.neg++;
        if (term.polarity !== 0 || term.tokens.length > 1) f.strong = true;
        found.set(term.theme, f);
      }
    }
  });
  const tags: ThemeTag[] = [];
  for (const [idx, f] of found) {
    const t = tax.themes[idx]!;
    // Ties between praise and complaint count as negative: a complaint is the actionable part.
    const sentiment: SentimentLabel = f.neg > 0 && f.neg >= f.pos ? "negative" : f.pos > 0 ? "positive" : "neutral";
    const confidence = Math.min(0.95, 0.6 + (f.strong ? 0.15 : 0) + 0.1 * (f.mentions - 1));
    tags.push({ theme: t.id, vector: t.vector, sentiment, confidence: Math.round(confidence * 100) / 100 });
  }
  return tags;
}
