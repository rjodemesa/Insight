import en from "@/config/lexicon.en.json";
import fil from "@/config/lexicon.fil.json";
import emoji from "@/config/lexicon.emoji.json";
import { tokenize } from "./text";

/**
 * Merged sentiment lexicon (English + Filipino/Taglish + emoji). One merged list works
 * better than per-language lists because most reviews mix both languages.
 */
interface LexiconFile {
  version: string;
  words: Record<string, number>;
  phrases: Record<string, number>;
  negators: string[];
  intensifiers: Record<string, number>;
  contrast: string[];
}

export interface Phrase {
  tokens: string[];
  valence: number;
}

export interface Lexicon {
  version: string;
  words: Map<string, number>;
  /** Multi-word entries indexed by first token, longest first. */
  phrases: Map<string, Phrase[]>;
  negators: Set<string>;
  intensifiers: Map<string, number>;
  /** Contrast markers ("but", "kaya lang"), as token sequences. */
  contrast: string[][];
}

/** Prefixes that intensify a known word: napakabango = napaka + bango. */
const PREFIXES: [string, number][] = [["napaka", 0.4], ["pinaka", 0.45], ["sobrang", 0.4], ["ang", 0.2]];

export function buildLexicon(files: LexiconFile[]): Lexicon {
  const lex: Lexicon = {
    version: files.map((f) => f.version).join("."),
    words: new Map(), phrases: new Map(), negators: new Set(), intensifiers: new Map(), contrast: [],
  };
  const addPhrase = (text: string, valence: number) => {
    const tokens = tokenize(text);
    if (tokens.length === 0) return;
    if (tokens.length === 1) {
      lex.words.set(tokens[0]!, valence);
      return;
    }
    const list = lex.phrases.get(tokens[0]!) ?? [];
    list.push({ tokens, valence });
    list.sort((a, b) => b.tokens.length - a.tokens.length);
    lex.phrases.set(tokens[0]!, list);
  };
  for (const f of files) {
    for (const [w, v] of Object.entries(f.words)) addPhrase(w, v);
    for (const [p, v] of Object.entries(f.phrases)) addPhrase(p, v);
    for (const n of f.negators) {
      const t = tokenize(n);
      if (t.length === 1) lex.negators.add(t[0]!); // multi-word negators start with a single negator anyway
    }
    for (const [w, v] of Object.entries(f.intensifiers)) lex.intensifiers.set(w, v);
    for (const c of f.contrast) lex.contrast.push(tokenize(c));
  }
  return lex;
}

let cached: Lexicon | null = null;
export function lexicon(): Lexicon {
  return (cached ??= buildLexicon([en, fil, emoji] as LexiconFile[]));
}

/**
 * Valence of a single token, trying text-speak repeats ("sobraaang" → "sobrang") and
 * intensifying prefixes. Returns the extra boost a prefix adds.
 */
export function wordValence(lex: Lexicon, tok: string): { valence: number; boost: number } | null {
  const direct = lex.words.get(tok);
  if (direct !== undefined) return { valence: direct, boost: 0 };
  if (/(.)\1\1/u.test(tok)) {
    for (const v of [tok.replace(/(.)\1{2,}/gu, "$1$1"), tok.replace(/(.)\1{2,}/gu, "$1")]) {
      const hit = lex.words.get(v);
      if (hit !== undefined) return { valence: hit, boost: 0.2 };
    }
  }
  for (const [prefix, boost] of PREFIXES) {
    if (tok.length > prefix.length + 2 && tok.startsWith(prefix)) {
      const hit = lex.words.get(tok.slice(prefix.length));
      if (hit !== undefined) return { valence: hit, boost };
    }
  }
  return null;
}
