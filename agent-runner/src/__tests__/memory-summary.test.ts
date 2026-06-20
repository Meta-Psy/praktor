import { describe, it, expect } from "vitest";
import { toMemorySummary } from "../memory-summary.js";

describe("toMemorySummary", () => {
  it("converts a unix-epoch max into RFC3339 last_updated", () => {
    const s = toMemorySummary(12, 1_750_000_000);
    expect(s.count).toBe(12);
    expect(s.last_updated).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });
  it("returns empty last_updated when there are no memories", () => {
    const s = toMemorySummary(0, 0);
    expect(s).toEqual({ count: 0, last_updated: "" });
  });
});
