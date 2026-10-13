import { lexicon, wordValence, type Lexicon } from "./lexicon";
import { COMMA, matchAt, type Sentence } from "./text";

/**
 * Lexicon-based sentiment (DERIVED), in the style of VADER, tuned for English, Filipino
 * and Taglish reviews:
 *   - each sentiment word or phrase has a score from -4 to +4
 *   - a negator up to 3 words before it (not across a comma) flips it: × -0.74
 *   - intensifiers just before it scale it: very × 1.3, medyo × 0.65
 *   - in a sentence with "but"/"pero", words before it count × 0.5, after it × 1.5
 *   - each "!" (up to 3) adds 0.292 in the sentence's direction
 *   - compound = sum / √(sum² + 15), in [-1, 1]
 * Label: positive if compound ≥ 0.05, negative if ≤ -0.05, else neutral.
 */
export type SentimentLabel = "positive" | "neutral" | "negative";

export interface SentenceScore {
  sum: number;
  hits: number;
  compound: number;
  label: SentimentLabel;
}

export interface SentimentResult {
  label: SentimentLabel;
  /** Compound score in [-1, 1]. */
  score: number;
  /** 0–1: how much evidence the label rests on. */
  confidence: number;
  hits: number;
  sentences: SentenceScore[];
}

const NEGATION = -0.74;
const ALPHA = 15;
export const THRESHOLD = 0.05;

export const compound = (sum: number) => (sum === 0 ? 0 : sum / Math.sqrt(sum * sum + ALPHA));
export const labelOf = (c: number): SentimentLabel => (c >= THRESHOLD ? "positive" : c <= -THRESHOLD ? "negative" : "neutral");

function contrastLength(lex: Lexicon, tokens: string[], i: number): number {
  for (const seq of lex.contrast) if (matchAt(tokens, i, seq)) return seq.length;
  return 0;
}

/**
 * True when a negator appears within 3 tokens before `i`, without crossing a comma, a
 * contrast word or another sentiment word (which the negator belongs to instead:
 * in "walang damage at ang bango", "walang" negates "damage", not "bango").
 */
export function negatedAt(lex: Lexicon, tokens: string[], i: number): boolean {
  for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
    const t = tokens[j]!;
    if (t === COMMA || contrastLength(lex, tokens, j) > 0) return false;
    if (lex.negators.has(t)) return true;
    if (!lex.intensifiers.has(t) && wordValence(lex, t)) return false;
  }
  return false;
}

export function scoreSentence(s: Sentence, lex: Lexicon = lexicon()): SentenceScore {
  const { tokens } = s;
  const hits: { at: number; v: number }[] = [];
  let contrastAt = -1;
  for (let i = 0; i < tokens.length; ) {
    const tok = tokens[i]!;
    if (tok === COMMA) { i++; continue; }
    const c = contrastLength(lex, tokens, i);
    if (c > 0) { contrastAt = i; i += c; continue; }

    let v = 0;
    let boost = 0;
    let span = 1;
    const phrase = lex.phrases.get(tok)?.find((p) => matchAt(tokens, i, p.tokens));
    if (phrase) {
      v = phrase.valence;
      span = phrase.tokens.length;
    } else if (!lex.negators.has(tok) && !lex.intensifiers.has(tok)) {
      const w = wordValence(lex, tok);
      if (w) ({ valence: v, boost } = w);
    }
    if (v !== 0) {
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
        if (tokens[j] === COMMA) break;
        const b = lex.intensifiers.get(tokens[j]!);
        if (b !== undefined) boost += b;
      }
      v *= 1 + boost;
      // A phrase that contains a negator ("not worth") already carries it.
      if (!(phrase && phrase.tokens.some((p) => lex.negators.has(p))) && negatedAt(lex, tokens, i)) v *= NEGATION;
      hits.push({ at: i, v });
    }
    i += span;
  }
  let sum = 0;
  for (const h of hits) sum += contrastAt < 0 ? h.v : h.at < contrastAt ? h.v * 0.5 : h.v * 1.5;
  if (sum !== 0) sum += Math.sign(sum) * 0.292 * Math.min(s.exclamations, 3);
  const c = compound(sum);
  return { sum, hits: hits.length, compound: c, label: labelOf(c) };
}

export function scoreSentiment(sentences: Sentence[], lex: Lexicon = lexicon()): SentimentResult {
  const scored = sentences.map((s) => scoreSentence(s, lex));
  const sum = scored.reduce((a, s) => a + s.sum, 0);
  const hits = scored.reduce((a, s) => a + s.hits, 0);
  const score = compound(sum);
  // Evidence-based: more sentiment words and a stronger score mean a surer label.
  const confidence = hits === 0 ? 0.3 : Math.min(0.95, 0.35 + 0.15 * Math.min(hits, 3) + 0.2 * Math.abs(score));
  return { label: labelOf(score), score: Math.round(score * 1000) / 1000, confidence: Math.round(confidence * 100) / 100, hits, sentences: scored };
}
