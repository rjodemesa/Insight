import { describe, expect, it } from "vitest";
import { intelligenceScore, rawScore, SHRINKAGE_K } from "@/lib/score/intelligence";
import { trustWeight } from "@/lib/score/trust";
import { compareProportions, daysBefore } from "@/lib/trend/stats";

describe("trust weight", () => {
  it("follows the documented formula", () => {
    expect(trustWeight({ isDuplicate: true, verifiedPurchase: 1, textLength: 50, helpfulCount: 10 })).toBe(0);
    expect(trustWeight({ isDuplicate: false, verifiedPurchase: 1, textLength: 50, helpfulCount: 0 })).toBe(1);
    expect(trustWeight({ isDuplicate: false, verifiedPurchase: null, textLength: 2, helpfulCount: null })).toBeCloseTo(0.56);
    expect(trustWeight({ isDuplicate: false, verifiedPurchase: 0, textLength: 0, helpfulCount: null })).toBeCloseTo(0.3);
    expect(trustWeight({ isDuplicate: false, verifiedPurchase: 1, textLength: 50, helpfulCount: 1_000_000 })).toBe(1.5);
  });
});

describe("Intelligence Score", () => {
  it("is 100 for perfect and 0 for worst inputs", () => {
    expect(rawScore({ n: 1, weight: 1, sentiment: 1, rating: 5, issueShare: 0 }).raw).toBe(100);
    expect(rawScore({ n: 1, weight: 1, sentiment: -1, rating: 1, issueShare: 1 }).raw).toBe(0);
  });

  it("rescales weights when a component is missing", () => {
    expect(rawScore({ n: 1, weight: 1, sentiment: 1, rating: null, issueShare: 0 }).raw).toBe(100);
    expect(rawScore({ n: 0, weight: 0, sentiment: null, rating: null, issueShare: null }).raw).toBeNull();
  });

  it("shrinks small samples toward the prior", () => {
    const tiny = intelligenceScore({ n: 3, weight: 3, sentiment: 1, rating: 5, issueShare: 0 }, 60);
    const big = intelligenceScore({ n: 3000, weight: 3000, sentiment: 0.8, rating: 4.6, issueShare: 0.05 }, 60);
    expect(tiny.score).toBeCloseTo((3 * 100 + SHRINKAGE_K * 60) / (3 + SHRINKAGE_K), 1);
    expect(big.score!).toBeGreaterThan(tiny.score!);
    expect(tiny.reliability).toBe("low");
    expect(big.reliability).toBe("high");
  });
});

describe("trend statistics", () => {
  it("flags only significant changes with enough data", () => {
    expect(compareProportions(40, 100, 10, 100)).toMatchObject({ significant: true, direction: "up", diffPts: 30 });
    expect(compareProportions(4, 10, 1, 10).significant).toBe(false); // too few reviews
    expect(compareProportions(12, 100, 10, 100)).toMatchObject({ significant: false, direction: "flat" });
    expect(compareProportions(0, 0, 5, 50).current).toBeNull();
  });

  it("does date arithmetic in UTC", () => {
    expect(daysBefore("2024-03-01", 1)).toBe("2024-02-29");
    expect(daysBefore("2024-03-01T23:59:00.000Z", 0)).toBe("2024-03-01");
  });
});
