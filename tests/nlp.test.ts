import { describe, expect, it } from "vitest";
import raw from "@/config/taxonomy.json";
import { analyzeReview } from "@/lib/nlp/analyze";
import { compileTaxonomy } from "@/lib/nlp/taxonomy";

const a = (text: string, rating: number | null = null) => analyzeReview({ title: null, text, rating });
const themesOf = (text: string) => Object.fromEntries(a(text).themes.map((t) => [t.theme, t.sentiment]));

describe("sentiment", () => {
  it.each([
    ["Sobrang bango! Sulit talaga 😍", "positive"],
    ["Very good quality, smells great", "positive"],
    ["Mabango at malinis. Will buy again!", "positive"],
    ["👍👍👍", "positive"],
    ["Hindi maganda, tumagas yung bote pagdating 😡", "negative"],
    ["di bango, parang fake", "negative"],
    ["Leak sa packaging, sira yung takip", "negative"],
    ["Not worth it", "negative"],
    ["hnd sulit, matagal dumating", "negative"],
    ["Order no: [ORDER_001] still not delivered", "negative"],
  ])("%s → %s", (text, label) => {
    expect(a(text).sentiment).toBe(label);
  });

  it("flips on negation but not across a comma", () => {
    expect(a("hindi maganda").sentiment).toBe("negative");
    expect(a("maganda").sentiment).toBe("positive");
    expect(a("hindi, maganda talaga").sentiment).toBe("positive");
    expect(a("no problem at all").sentiment).toBe("positive");
  });

  it("weights the clause after 'pero' / 'but' more", () => {
    expect(a("Okay naman pero mahal na ngayon").sentiment).toBe("negative");
    expect(a("Medyo mahal pero sulit naman").sentiment).toBe("positive");
    expect(a("Smells great but leaking bottle").sentiment).toBe("negative");
  });

  it("understands Filipino prefixes and stretched spelling", () => {
    expect(a("napakabango").sentiment).toBe("positive");
    expect(a("sobraaang ganda").sentiment).toBe("positive");
    expect(a("napakabango").sentimentScore!).toBeGreaterThan(a("mabango").sentimentScore!);
  });

  it("returns no sentiment for empty or redaction-only text", () => {
    expect(a("").sentiment).toBeNull();
    expect(a("[PHONE_001]").sentiment).toBeNull();
    expect(a("xyz qwerty").sentiment).toBe("neutral");
    expect(a("xyz qwerty").confidence).toBeLessThan(0.5);
  });

  it("flags rating/text conflicts only when the text is clearly polar", () => {
    expect(a("Sira at tumagas, sayang pera", 5).ratingTextConflict).toBe(1);
    expect(a("Sobrang bango, sulit!", 1).ratingTextConflict).toBe(1);
    expect(a("Sobrang bango, sulit!", 5).ratingTextConflict).toBe(0);
    expect(a("Sobrang bango, sulit!", null).ratingTextConflict).toBeNull();
    expect(a("xyz qwerty", 5).ratingTextConflict).toBeNull();
  });
});

describe("theme tagging", () => {
  it("tags Five Vector themes with their own sentiment", () => {
    expect(themesOf("Leak sa packaging, sira yung takip")).toMatchObject({ leak: "negative", damaged_packaging: "negative", cap_seal: "negative" });
    expect(themesOf("Mabilis dumating, legit seller")).toMatchObject({ delivery_speed: "positive", authenticity: "positive" });
    expect(themesOf("Medyo mahal pero sulit naman")).toMatchObject({ price: "negative", value_for_money: "positive" });
    expect(themesOf("di bango, parang fake")).toMatchObject({ scent: "negative", authenticity: "negative" });
  });

  it("reads negated complaints as praise", () => {
    expect(themesOf("No leaks, well packed")).toMatchObject({ leak: "positive", damaged_packaging: "positive" });
    expect(themesOf("walang tagas")).toMatchObject({ leak: "positive" });
  });

  it("ends a negation at the first sentiment word it reaches", () => {
    expect(themesOf("Walang damage at ang bango")).toMatchObject({ damaged_packaging: "positive", scent: "positive" });
    expect(a("Walang damage at ang bango").sentiment).toBe("positive");
  });

  it("uses the sentence's sentiment for neutral keywords", () => {
    expect(themesOf("The delivery was terrible")).toMatchObject({ delivery_speed: "negative" });
    expect(themesOf("Love the scent")).toMatchObject({ scent: "positive" });
  });

  it("matches wildcards and whole words only", () => {
    expect(themesOf("it keeps leaking")).toHaveProperty("leak");
    expect(themesOf("chocolate scent")).not.toHaveProperty("delivery_speed"); // "late" inside "chocolate"
  });

  it("validates the taxonomy file", () => {
    expect(() => compileTaxonomy(raw)).not.toThrow();
    expect(() => compileTaxonomy({ version: "x", themes: [{ id: "a", label: "A", vector: "Nope", keywords: [], positive: [], negative: [] }] })).toThrow(/vector/);
    const dup = { id: "a", label: "A", vector: "Value", keywords: [], positive: [], negative: [] };
    expect(() => compileTaxonomy({ version: "x", themes: [dup, dup] })).toThrow(/duplicate/);
  });
});
