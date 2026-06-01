import { describe, expect, it } from "vitest";
import { minutesBetween, summarizeNumbers } from "./statistics";

describe("statistics helpers", () => {
  it("summarizes numeric samples", () => {
    const stats = summarizeNumbers([1, 2, 3]);
    expect(stats.count).toBe(3);
    expect(stats.average).toBe(2);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(stats.stddev).toBeGreaterThan(0);
  });

  it("computes positive minute durations", () => {
    expect(minutesBetween(new Date("2026-05-11T00:00:00Z"), new Date("2026-05-11T00:10:00Z"))).toBe(10);
    expect(minutesBetween(new Date("2026-05-11T00:10:00Z"), new Date("2026-05-11T00:00:00Z"))).toBe(0);
  });
});
