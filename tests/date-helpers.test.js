import { describe, expect, it } from "vitest";
import {
  addInvoiceDueDays,
  formatDashboardMonthLabel,
  normaliseInvoiceDate
} from "../resources/js/business-logic.js";

describe("invoice due dates", () => {
  it("adds 14 payment-term days", () => {
    expect(addInvoiceDueDays("2026-03-10", 14)).toBe("2026-03-24");
  });

  it("crosses month end", () => {
    expect(addInvoiceDueDays("2026-04-25", 14)).toBe("2026-05-09");
  });

  it("crosses year end", () => {
    expect(addInvoiceDueDays("2026-12-25", 14)).toBe("2027-01-08");
  });

  it("handles leap-year February", () => {
    expect(addInvoiceDueDays("2028-02-20", 14)).toBe("2028-03-05");
  });

  it("supports zero due days and backdated invoice dates", () => {
    expect(addInvoiceDueDays("2024-01-15", 0)).toBe("2024-01-15");
    expect(addInvoiceDueDays("2020-06-01", 14)).toBe("2020-06-15");
  });
});

describe("invoice date parsing and formatting", () => {
  it.each([
    "2026-03-09",
    "09/03/2026",
    "2026-03-09T23:30:00.000Z"
  ])("normalises %s without shifting the calendar day", value => {
    const result = normaliseInvoiceDate(value);
    expect(result.inputValue).toBe("2026-03-09");
    expect(result.display).toBe("09/03/2026");
    expect(result.yearMonthKey).toBe("2026-03");
  });

  it("normalises a JavaScript Date", () => {
    expect(normaliseInvoiceDate(new Date(2026, 2, 9)).inputValue).toBe("2026-03-09");
  });

  it("normalises a Firestore Timestamp-like object without importing Firebase", () => {
    const timestamp = { toDate: () => new Date(2026, 2, 9) };
    expect(normaliseInvoiceDate(timestamp).display).toBe("09/03/2026");
  });

  it("returns an empty result for missing and invalid values", () => {
    expect(normaliseInvoiceDate(null).inputValue).toBe("");
    expect(normaliseInvoiceDate("not-a-date").date).toBeNull();
    expect(normaliseInvoiceDate("31/02/2026").date).toBeNull();
  });

  it("formats a sortable month key as a dashboard label", () => {
    expect(formatDashboardMonthLabel("2026-03")).toBe("Mar 26");
    expect(formatDashboardMonthLabel("invalid")).toBe("");
  });
});
