/**
 * PII detection rules (English / Filipino / Taglish aware). Best-effort by design:
 * names without a cue word, or written in unusual ways, will be missed. Analysts can
 * flag misses from the review viewer; those feed this file.
 *
 * Each rule returns spans [start, end) of text to replace. Rules run in priority order;
 * a later rule never overrides a span an earlier rule already claimed.
 */
export type PiiKind = "EMAIL" | "PHONE" | "HANDLE" | "ORDER" | "ADDRESS" | "NAME" | "IMAGE";

export interface Span {
  start: number;
  end: number;
  kind: PiiKind;
}

interface RegexRule {
  kind: PiiKind;
  re: RegExp; // must be global
  group?: number; // redact only this capture group
}

const REGEX_RULES: RegexRule[] = [
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Profile and other links: any URL can identify a person, so links are treated as handles.
  { kind: "HANDLE", re: /\b(?:https?:\/\/|www\.)\S+/gi },
  { kind: "HANDLE", re: /\b(?:facebook|fb|instagram|tiktok|twitter|x)\.com\/\S+/gi },
  { kind: "HANDLE", re: /(?<![\w.@])@[A-Za-z0-9_][A-Za-z0-9_.]{1,29}/g },
  // PH mobile: 09xx xxx xxxx, +63 9xx…, 639xx…, with optional spaces or dashes.
  { kind: "PHONE", re: /(?<!\d)(?:\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g },
  // PH landline (Metro Manila 02 and provincial 0xx area codes).
  { kind: "PHONE", re: /(?<!\d)(?:\(0?\d{1,2}\)|\+?63[\s-]?\d{1,2}|0\d{1,2})[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g },
  // Order / tracking / account numbers introduced by a cue word.
  {
    kind: "ORDER",
    re: /\b(?:order|tracking|track|account|acct|ref(?:erence)?|transaction|txn|waybill|parcel)\s*(?:no\.?|number|num|#|id)?\s*[:#]?\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]{5,})/gi,
    group: 1,
  },
  // Barangay / purok / sitio cues, block-and-lot, numbered streets.
  // No "i" flag: the cue is matched in either case explicitly, but the place-name words after it must be capitalised.
  { kind: "ADDRESS", re: /\b(?:[Bb]rgy|BRGY|[Bb]gy|BGY|[Bb]arangay|BARANGAY|[Pp]urok|PUROK|[Ss]itio|SITIO)\.?\s*[\w-]+(?:\s+[A-Z][\w-]*){0,2}/g },
  { kind: "ADDRESS", re: /\b(?:blk|block)\.?\s*\d+\w*(?:\s*,?\s*lot\.?\s*\d+\w*)?/gi },
  { kind: "ADDRESS", re: /\blot\.?\s*\d+\w*\s*,?\s*(?:blk|block)\.?\s*\d+\w*/gi },
  { kind: "ADDRESS", re: /\b\d{1,5}\s+[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Drive|Dr|Highway|Hwy)\b\.?/g },
  { kind: "ADDRESS", re: /\b(?:taga|from|dito sa|here in|nakatira sa|sa)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s+City)\b/g, group: 1 },
];

/** Bare long digit runs (Lazada order ids are 15 digits). Runs last so phones win. */
const BARE_NUMBER: RegexRule = { kind: "ORDER", re: /(?<![\d.,])\d{9,}(?![\d.,])/g };

// Capitalised words that follow cue phrases but are not names.
const NOT_NAMES = new Set(
  ("the this that it its very so good great nice best super legit sulit item product seller shop store " +
    "lazada shopee thank thanks salamat maraming ok okay po na ang ng sa si yung and but i my me " +
    "original orig authentic fake new order delivery package parcel worth recommended highly")
    .split(" "),
);

const NAME_WORD = "[A-Za-zÀ-ÿÑñ][a-zà-ÿñ'-]+";
const CAP_WORD = "[A-ZÀ-ÞÑ][a-zà-ÿñ'-]+";

interface NameCue {
  cue: RegExp; // global, case-insensitive; the name starts right after the match
  firstWord: RegExp; // sticky
  after?: RegExp; // sticky; must match right after the name (e.g. punctuation)
}

const NAME_CUES: NameCue[] = [
  // "ako si maria", "ako po si Maria", "pangalan ko ay Juan", "my name is Ana"
  {
    // Cues end at a word boundary so "ako sigurado" is not read as "ako si" + "gurado".
    cue: /\b(?:ako\s+(?:po\s+)?(?:ay\s+)?si|my\s+name\s+is|pangalan\s+ko(?:\s+po)?(?:\s+ay)?|name\s*:)(?:\s+|(?<=:))/gi,
    firstWord: new RegExp(NAME_WORD, "y"),
  },
  // "po si Maria", "this is Maria, …" — only capitalised, and "this is" needs a boundary after it.
  { cue: /\bpo\s+si\s+/gi, firstWord: new RegExp(CAP_WORD, "y") },
  {
    cue: /\bthis\s+is\s+/gi,
    firstWord: new RegExp(CAP_WORD, "y"),
    after: /\s*(?:[,.!]|$|from\b|here\b|po\b)/y,
  },
];
const NEXT_CAP = new RegExp(`\\s+(${CAP_WORD})`, "y");

function nameSpans(text: string, extraStop: Set<string>): Span[] {
  const spans: Span[] = [];
  const stop = (w: string) => NOT_NAMES.has(w.toLowerCase()) || extraStop.has(w.toLowerCase());
  for (const { cue, firstWord, after } of NAME_CUES) {
    cue.lastIndex = 0;
    for (let m = cue.exec(text); m; m = cue.exec(text)) {
      const start = m.index + m[0].length;
      firstWord.lastIndex = start;
      const w = firstWord.exec(text);
      if (!w || stop(w[0])) continue;
      let end = start + w[0].length;
      for (let k = 0; k < 2; k++) {
        NEXT_CAP.lastIndex = end;
        const n = NEXT_CAP.exec(text);
        if (!n || stop(n[1]!)) break;
        end = NEXT_CAP.lastIndex;
      }
      if (after) {
        after.lastIndex = end;
        if (!after.test(text)) continue;
      }
      spans.push({ start, end, kind: "NAME" });
    }
  }
  // Signature at the very end: "… – Maria", "~ Juan D."
  const sig = /(?:^|\s)[-–—~]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?){0,2})\s*$/.exec(text);
  if (sig && !stop(sig[1]!.split(/\s+/)[0]!)) {
    const start = sig.index + sig[0].indexOf(sig[1]!);
    spans.push({ start, end: start + sig[1]!.length, kind: "NAME" });
  }
  return spans;
}

function regexSpans(text: string, rule: RegexRule): Span[] {
  const out: Span[] = [];
  rule.re.lastIndex = 0;
  for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
    if (rule.group !== undefined) {
      const g = m[rule.group];
      if (!g) continue;
      const start = m.index + m[0].lastIndexOf(g);
      out.push({ start, end: start + g.length, kind: rule.kind });
    } else out.push({ start: m.index, end: m.index + m[0].length, kind: rule.kind });
    if (m[0].length === 0) rule.re.lastIndex++;
  }
  return out;
}

/** All non-overlapping PII spans, sorted by position. `stopWords` (e.g. the row's brand) are never names. */
export function findPii(text: string, stopWords: string[] = []): Span[] {
  if (!text) return [];
  const extraStop = new Set(stopWords.flatMap((s) => s.toLowerCase().split(/\s+/)).filter(Boolean));
  const ordered: Span[][] = [
    ...REGEX_RULES.map((r) => regexSpans(text, r)),
    nameSpans(text, extraStop),
    regexSpans(text, BARE_NUMBER),
  ];
  const accepted: Span[] = [];
  for (const group of ordered) {
    for (const s of group) {
      if (s.end <= s.start) continue;
      // Trim trailing punctuation that URL/handle patterns can swallow.
      while (s.end > s.start && /[.,;:!?)\]]/.test(text[s.end - 1]!)) s.end--;
      if (!accepted.some((a) => s.start < a.end && a.start < s.end)) accepted.push(s);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}
