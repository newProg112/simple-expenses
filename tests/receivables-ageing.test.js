import { describe, expect, it } from "vitest";
import { buildReceivablesAgeing } from "../resources/js/business-logic.js";

const referenceDate = "2026-07-22";

function invoice(dueDate, total = 10, status = "Unpaid") {
  return { dueDate, total, status };
}

describe("receivables ageing", () => {
  it.each([
    ["2026-07-23", "Not yet due"],
    ["2026-07-22", "0-30 days"],
    ["2026-07-21", "0-30 days"],
    ["2026-06-22", "0-30 days"],
    ["2026-06-21", "31-60 days"],
    ["2026-05-23", "31-60 days"],
    ["2026-05-22", "61+ days"],
    ["2026-04-23", "61+ days"]
  ])("puts an invoice due on %s in %s", (dueDate, expectedBucket) => {
    const buckets = buildReceivablesAgeing([invoice(dueDate)], referenceDate);
    expect(buckets[expectedBucket]).toBe(10);
  });

  it("excludes paid invoices and includes supported outstanding statuses", () => {
    const buckets = buildReceivablesAgeing([
      invoice("2026-07-22", 100, "Paid"),
      invoice("2026-07-22", 20, "Unpaid"),
      invoice("2026-06-21", 30, "Outstanding"),
      invoice("2026-05-22", 40, "Overdue")
    ], referenceDate);

    expect(buckets).toEqual({
      "Not yet due": 0,
      "0-30 days": 20,
      "31-60 days": 30,
      "61+ days": 40
    });
  });

  it("always returns all four buckets when totals are zero", () => {
    expect(buildReceivablesAgeing([], referenceDate)).toEqual({
      "Not yet due": 0,
      "0-30 days": 0,
      "31-60 days": 0,
      "61+ days": 0
    });
  });

  it("uses invoice outstanding totals and reconciles all buckets", () => {
    const invoices = [
      invoice("2026-07-23", "10.25"),
      invoice("2026-07-22", 20.5),
      invoice("2026-06-21", 30.75),
      invoice("2026-05-22", 40)
    ];
    const buckets = buildReceivablesAgeing(invoices, referenceDate);

    expect(Object.values(buckets).reduce((sum, total) => sum + total, 0)).toBe(101.5);
  });

  it("ignores invalid dates without crashing", () => {
    expect(() => buildReceivablesAgeing([
      invoice("invalid", 100),
      invoice("", 50)
    ], referenceDate)).not.toThrow();
    expect(buildReceivablesAgeing([invoice("invalid", 100)], referenceDate))
      .toEqual({ "Not yet due": 0, "0-30 days": 0, "31-60 days": 0, "61+ days": 0 });
  });
});
