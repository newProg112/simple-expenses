import { describe, expect, it } from "vitest";
import { chronologicalMonthKeys } from "../resources/js/business-logic.js";

describe("chronological month ordering", () => {
  it("orders March through July by YYYY-MM key", () => {
    expect(chronologicalMonthKeys([
      "2026-07-01", "2026-03-01", "2026-05-01", "2026-04-01", "2026-06-01"
    ])).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  });

  it("places December before January across a year boundary", () => {
    expect(chronologicalMonthKeys(["2027-01-01", "2026-12-01"]))
      .toEqual(["2026-12", "2027-01"]);
  });

  it("deduplicates months", () => {
    expect(chronologicalMonthKeys(["2026-03-01", "15/03/2026", "2026-04-01"]))
      .toEqual(["2026-03", "2026-04"]);
  });

  it("keeps already sorted input sorted", () => {
    expect(chronologicalMonthKeys(["2026-03-01", "2026-04-01", "2026-05-01"]))
      .toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("ignores invalid dates", () => {
    expect(chronologicalMonthKeys(["invalid", "2026-03-01", null]))
      .toEqual(["2026-03"]);
  });
});
