import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/ingest/csv";
import { validateHeader, REQUIRED_COLUMNS } from "@/lib/ingest/columns";
import { detectLanguage } from "@/lib/nlp/language";

async function parse(chunks: string[]) {
  const rows: string[][] = [];
  async function* gen() {
    yield* chunks;
  }
  for await (const r of parseCsv(gen())) rows.push(r);
  return rows;
}

describe("CSV parser", () => {
  it("handles quotes, commas, doubled quotes, newlines, CRLF and a BOM", async () => {
    const csv = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",\n';
    expect(await parse([csv])).toEqual([
      ["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["2", "line1\nline2", ""],
    ]);
  });

  it("gives the same result however the input is chunked", async () => {
    const csv = 'a,b\r\n"q""x",y\r\n"multi\r\nline","z"';
    const whole = await parse([csv]);
    const oneByOne = await parse(csv.split(""));
    expect(oneByOne).toEqual(whole);
    expect(whole).toEqual([["a", "b"], ['q"x', "y"], ["multi\r\nline", "z"]]);
  });
});

describe("header validation", () => {
  it("accepts any order and case, and lists missing columns", () => {
    const shuffled = [...REQUIRED_COLUMNS].reverse().map((c) => c.toUpperCase());
    expect(validateHeader(["extra", ...shuffled]).missing).toEqual([]);
    const v = validateHeader(REQUIRED_COLUMNS.filter((c) => c !== "reviewText" && c !== "brand"));
    expect(v.index).toBeNull();
    expect(v.missing).toEqual(["brand", "reviewText"]);
  });
});

describe("language detection", () => {
  it.each([
    ["Very good quality, smells great", "english"],
    ["Sobrang bango talaga, salamat po", "filipino"],
    ["Ang bango, very good quality talaga", "taglish"],
    ["👍👍👍", "emoji_only"],
    ["", "empty"],
    ["ty", "other"],
  ])("%s → %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});
