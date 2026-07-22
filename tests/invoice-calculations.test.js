import { describe, expect, it } from "vitest";
import {
  calculateInvoiceSubtotal,
  calculateInvoiceTotals,
  calculateVat,
  roundMoney
} from "../resources/js/business-logic.js";

describe("invoice calculations", () => {
  it("calculates the subtotal from active invoice lines", () => {
    expect(calculateInvoiceSubtotal([
      { description: "Bookkeeping", amount: 100 },
      { description: "VAT return", amount: 75 }
    ])).toBe(175);
  });

  it("ignores blank item rows as the invoice form does", () => {
    expect(calculateInvoiceSubtotal([
      { description: "Bookkeeping", amount: 100 },
      { description: "", amount: 50 },
      { description: "   ", amount: 25 }
    ])).toBe(100);
  });

  it("accepts numeric strings", () => {
    expect(calculateInvoiceSubtotal([
      { description: "Bookkeeping", amount: "100.00" }
    ])).toBe(100);
  });

  it("handles missing, invalid, and non-positive amounts safely", () => {
    expect(calculateInvoiceSubtotal([
      { description: "Missing" },
      { description: "Invalid", amount: "not a number" },
      { description: "Negative", amount: -10 },
      null
    ])).toBe(0);
  });

  it.each([
    [0, 0],
    [0.05, 5],
    [0.2, 20]
  ])("calculates VAT at rate %s", (rate, expectedVat) => {
    expect(calculateVat(100, rate)).toBe(expectedVat);
  });

  it("calculates the gross invoice total", () => {
    expect(calculateInvoiceTotals([
      { description: "Services", amount: 100 }
    ], 0.2)).toEqual({ subtotal: 100, vat: 20, total: 120 });
  });

  it("rounds monetary results to two decimal places", () => {
    expect(calculateInvoiceTotals([
      { description: "Services", amount: 10.01 }
    ], 0.2)).toEqual({ subtotal: 10.01, vat: 2, total: 12.01 });
  });

  it("handles floating-point values such as 0.1 plus 0.2", () => {
    expect(calculateInvoiceSubtotal([
      { description: "One", amount: 0.1 },
      { description: "Two", amount: 0.2 }
    ])).toBe(0.3);
    expect(roundMoney(1.005)).toBe(1.01);
  });
});
