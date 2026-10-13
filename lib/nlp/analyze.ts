import { lexicon } from "./lexicon";
import { scoreSentiment, type SentimentLabel } from "./sentiment";
import { tagThemes, taxonomy, type ThemeTag } from "./taxonomy";
import { splitSentences } from "./text";

/**
 * Per-review NLP: sentiment, themes and the rating/text conflict flag. Runs only on
 * REDACTED title and text, so no personal data reaches tagging (or, later, the AI).
 */
export interface ReviewAnalysis {
  sentiment: SentimentLabel | null; // null when there is no text to read
  sentimentScore: number | null;
  confidence: number | null;
  /** 1 when a 4–5 star rating comes with clearly negative text, or 1–2 stars with clearly positive text. */
  ratingTextConflict: 0 | 1 | null;
  themes: ThemeTag[];
}

/** Stored on each review so a taxonomy or lexicon change can be detected and reprocessed. */
export function nlpVersion(): string {
  return `tax${taxonomy().version}-lex${lexicon().version}`;
}

/** |compound| must reach this before a rating/text disagreement counts as a conflict. */
export const CONFLICT_THRESHOLD = 0.3;

export function analyzeReview(input: { title: string | null; text: string | null; rating: number | null }): ReviewAnalysis {
  const sentences = [...splitSentences(input.title), ...splitSentences(input.text)];
  if (sentences.length === 0) {
    return { sentiment: null, sentimentScore: null, confidence: null, ratingTextConflict: null, themes: [] };
  }
  const s = scoreSentiment(sentences);
  const themes = tagThemes(sentences, s.sentences);
  let conflict: 0 | 1 | null = null;
  if (input.rating !== null && s.hits > 0) {
    conflict = (input.rating >= 4 && s.score <= -CONFLICT_THRESHOLD) || (input.rating <= 2 && s.score >= CONFLICT_THRESHOLD) ? 1 : 0;
  }
  return { sentiment: s.label, sentimentScore: s.score, confidence: s.confidence, ratingTextConflict: conflict, themes };
}
