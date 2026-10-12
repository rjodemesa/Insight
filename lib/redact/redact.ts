import { findPii, type PiiKind } from "./rules";

export interface RedactedItem {
  field: string;
  token: string; // e.g. [PHONE_001]
  kind: PiiKind;
  value: string; // original text — goes only to the encrypted vault
}

/**
 * Per-record redaction state. Fields of one review share it, so the same phone number
 * in the title and the text gets the same token.
 */
export class RecordRedactor {
  private counters = new Map<PiiKind, number>();
  private byValue = new Map<string, string>();
  readonly items: RedactedItem[] = [];

  constructor(private stopWords: string[] = []) {}

  private tokenFor(kind: PiiKind, value: string, field: string): string {
    const key = `${kind}|${value.toLowerCase().replace(/[\s-]/g, "")}`;
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const token = `[${kind}_${String(n).padStart(3, "0")}]`;
    this.byValue.set(key, token);
    this.items.push({ field, token, kind, value });
    return token;
  }

  /** Returns the text with every detected PII span replaced by its token. */
  redact(field: string, text: string | null): string | null {
    if (!text) return text;
    const spans = findPii(text, this.stopWords);
    if (spans.length === 0) return text;
    let out = "";
    let pos = 0;
    for (const s of spans) {
      out += text.slice(pos, s.start) + this.tokenFor(s.kind, text.slice(s.start, s.end), field);
      pos = s.end;
    }
    return out + text.slice(pos);
  }

  /** Customer image URLs are never shown: vault them and return only the count. */
  images(raw: string | null): number {
    if (!raw) return 0;
    const urls = raw.match(/https?:\/\/[^\s,;|"'\]]+/g) ?? [];
    urls.forEach((u) => this.tokenFor("IMAGE", u, "reviewCustomerImages"));
    return urls.length;
  }
}

/** Puts originals back in place of tokens. Only used by the audited IT-officer reveal. */
export function restoreTokens(text: string | null, values: Map<string, string>): string | null {
  if (!text) return text;
  return text.replace(/\[[A-Z]+_\d{3}\]/g, (t) => values.get(t) ?? t);
}
