import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BANK_CATEGORISATION_STATUS_MESSAGE,
  BANK_SETTLEMENT_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  isBankCategorisedExpense,
  isBankingSettledSource,
  sourceStatusForSave
} from "../resources/js/bank-settlement-source-state.js";

const pages = Object.freeze({
  invoice:readFileSync(new URL("../resources/tools/invoice-generator.html",import.meta.url),"utf8"),
  bill:readFileSync(new URL("../resources/tools/bills.html",import.meta.url),"utf8"),
  expense:readFileSync(new URL("../resources/tools/expenses.html",import.meta.url),"utf8")
});

const marker = Object.freeze({
  version:1,transactionId:"bank-1",journalId:"bank-settlement_user-1_bank-1"
});

describe("Banking-settled source status state", () => {
  it("identifies only a complete existing Banking settlement marker", () => {
    expect(isBankingSettledSource({ bankSettlement:marker })).toBe(true);
    expect(isBankingSettledSource({})).toBe(false);
    expect(isBankingSettledSource({ bankSettlement:{ ...marker,transactionId:"" } })).toBe(false);
    expect(isBankingSettledSource({ bankSettlement:{ ...marker,journalId:"" } })).toBe(false);
    expect(isBankingSettledSource({ bankSettlement:{ ...marker,version:2 } })).toBe(false);
  });

  it("identifies Banking-created expenses and uses the dedicated read-only message", () => {
    expect(isBankCategorisedExpense({ bankCategorisation:{ version:1,transactionId:"bank-1" } })).toBe(true);
    expect(isBankCategorisedExpense({ bankCategorisation:{ version:2,transactionId:"bank-1" } })).toBe(false);
    expect(isBankCategorisedExpense({})).toBe(false);
    expect(BANK_CATEGORISATION_STATUS_MESSAGE).toBe(
      "This expense was created from a bank transaction. Uncategorise it in Banking before editing or deleting it."
    );
  });

  it.each([
    ["invoice","Unpaid"],
    ["bill","Unpaid"],
    ["expense","Draft"],
    ["mileage","Approved"]
  ])("prevents a settled %s status changing to %s and restores editing after Unmatch",(_type,requested) => {
    const settled = { status:"Paid",bankSettlement:marker };
    expect(sourceStatusForSave(settled,requested)).toBe("Paid");
    const { bankSettlement:_removed,...unmatched } = settled;
    expect(sourceStatusForSave(unmatched,requested)).toBe(requested);
  });

  it("uses the required explanatory message", () => {
    expect(BANK_SETTLEMENT_STATUS_MESSAGE).toBe(
      "This record is matched to a bank transaction. Unmatch it in Banking before changing its payment status."
    );
    Object.values(pages).forEach(html => expect(html).toContain("BANK_SETTLEMENT_STATUS_MESSAGE"));
    expect(BANK_SETTLEMENT_ACCOUNTING_MESSAGE).toBe(
      "This invoice is matched to a bank transaction. Unmatch it in Banking before changing accounting details."
    );
  });

  it("locks invoice status toggling in rendering and in the action handler", () => {
    expect(pages.invoice).toContain("const bankingSettled = isBankingSettledSource(invoice)");
    expect(pages.invoice).toMatch(/onclick="toggleInvoiceStatus[\s\S]*?disabled title=/);
    expect(pages.invoice).toMatch(/if\(isBankingSettledSource\(invoice\)\)\{[\s\S]*?alert\(BANK_SETTLEMENT_STATUS_MESSAGE\)/);
  });

  it("locks bill status controls while preserving unrelated edit saves", () => {
    expect(pages.bill).toContain('document.getElementById("status").disabled = isBankingSettledSource(bill)');
    expect(pages.bill).toContain("status: sourceStatusForSave(existingBill");
    expect(pages.bill).toMatch(/data-bill-action="toggle-paid"[\s\S]*?disabled title=/);
    expect(pages.bill).toMatch(/if \(isBankingSettledSource\(bill\)\)[\s\S]*?alert\(BANK_SETTLEMENT_STATUS_MESSAGE\)/);
    expect(pages.bill).toContain('document.getElementById("status").disabled = false');
  });

  it("locks both expense and mileage status controls and preserves the marker on edit", () => {
    expect(pages.expense).toContain('document.getElementById("status").disabled = bankingSettled');
    expect(pages.expense).toContain('document.getElementById("mileageStatus").disabled = bankingSettled');
    expect(pages.expense).toContain("status: sourceStatusForSave(existingExpense");
    expect(pages.expense).toContain("bankSettlement:existingExpense.bankSettlement");
    expect(pages.expense).toMatch(/data-expense-action="mark-paid"[\s\S]*?disabled title=/);
    expect(pages.expense).toMatch(/if \(isBankingSettledSource\(expense\)\)[\s\S]*?alert\(BANK_SETTLEMENT_STATUS_MESSAGE\)/);
    expect(pages.expense).toContain('document.getElementById("status").disabled = false');
    expect(pages.expense).toContain('document.getElementById("mileageStatus").disabled = false');
  });

  it("blocks editing, saving, deleting and payment actions for a Banking-created expense", () => {
    expect(pages.expense).toContain("isBankCategorisedExpense(existingExpense)");
    expect(pages.expense).toMatch(/function editExpense[\s\S]*?isBankCategorisedExpense\(expense\)[\s\S]*?BANK_CATEGORISATION_STATUS_MESSAGE/);
    expect(pages.expense).toMatch(/function markExpensePaid[\s\S]*?isBankCategorisedExpense\(expense\)[\s\S]*?BANK_CATEGORISATION_STATUS_MESSAGE/);
    expect(pages.expense).toMatch(/function deleteExpense[\s\S]*?isBankCategorisedExpense\(expenseToDelete\)[\s\S]*?BANK_CATEGORISATION_STATUS_MESSAGE/);
    expect(pages.expense).toMatch(/data-expense-action="edit"[\s\S]*?bankCategorised \? ` disabled title=/);
    expect(pages.expense).toMatch(/data-expense-action="delete"[\s\S]*?bankCategorised \? ` disabled title=/);
  });

  it.each(Object.entries(pages))("keeps the %s inline module syntactically valid",(_name,html) => {
    const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
    const withoutImports = source.replace(/^\s*import[\s\S]*?;\s*$/gm,"");
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    expect(source).not.toBe("");
    expect(() => new AsyncFunction(withoutImports)).not.toThrow();
  });
});
