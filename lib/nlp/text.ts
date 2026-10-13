/**
 * Shared tokenizer for sentiment and theme tagging. Works on REDACTED text: redaction
 * tokens such as [PHONE_001] are dropped. Output is a list of sentences, each a list of
 * lower-case word and emoji tokens; a "," token marks a comma, which stops negation.
 */
export interface Sentence {
  tokens: string[];
  exclamations: number;
}

export const COMMA = ",";
const REDACTION = /\[[A-Z]+_\d{3}\]/g;
const TOKEN = /\p{Extended_Pictographic}|[\p{L}\p{N}]+(?:'[\p{L}]+)?|,/gu;
const SENTENCE = /[^.!?;\n\r]+[.!?;\n\r]*/g;

export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .replace(/[‘’`]/g, "'")
      .replace(/[:–—]|\s-\s/g, ",") // colons and dashes stop negation like commas
      .toLowerCase()
      .match(TOKEN) ?? []
  );
}

export function splitSentences(text: string | null | undefined): Sentence[] {
  if (!text) return [];
  const clean = text.replace(REDACTION, " ");
  const out: Sentence[] = [];
  for (const piece of clean.match(SENTENCE) ?? []) {
    const tokens = tokenize(piece);
    if (tokens.some((t) => t !== COMMA)) {
      out.push({ tokens, exclamations: (piece.match(/!/g) ?? []).length });
    }
  }
  return out;
}

/** True when `seq` occurs in `tokens` starting at `i`. A trailing * on the last term matches any ending. */
export function matchAt(tokens: string[], i: number, seq: string[]): boolean {
  if (i + seq.length > tokens.length) return false;
  for (let k = 0; k < seq.length; k++) {
    const want = seq[k]!;
    const got = tokens[i + k]!;
    if (k === seq.length - 1 && want.endsWith("*")) {
      if (!got.startsWith(want.slice(0, -1))) return false;
    } else if (got !== want) return false;
  }
  return true;
}
