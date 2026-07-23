import { describe, expect, it } from "vitest";
import {
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal,
  reverseJournal
} from "../resources/js/ledger-engine.js";
import {
  buildProfitLossReport,
  filterJournalsByDateRange,
  formatProfitLossAmount,
  profitLossViewFromJournals
} from "../resources/js/profit-loss-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

function invoice(overrides = {}) {
  return createSalesInvoiceJournal({
    id: "invoice-1",
    invoiceNo: "INV-001",
    client: "Customer",
    date: "2026-07-10",
    amount: 100,
    vat: 20,
    total: 120,
    ...overrides
  });
}

function bill(overrides = {}) {
  return createBillJournal({
    id: "bill-1",
    billNumber: "BILL-001",
    supplier: "Supplier",
    billDate: "2026-07-11",
    category: "General",
    net: 100,
    vat: 20,
    total: 120,
    ...overrides
  });
}

function expense(overrides = {}) {
  return createExpenseJournal({
    id: "expense-1",
    date: "2026-07-12",
    merchant: "Shop",
    category: "General",
    net: 200,
    vat: 40,
    gross: 240,
    ...overrides
  });
}

function mileage(overrides = {}) {
  return createMileageJournal({
    id: "mileage-1",
    type: "mileage",
    date: "2026-07-13",
    from: "Home",
    to: "Client",
    miles: 100,
    ratePerMile: 0.55,
    amount: 55,
    ...overrides
  });
}

describe("Profit & Loss source accounting", () => {
  it("reports a £100 sales invoice credit as £100 revenue", () => {
    const report = buildProfitLossReport([invoice()]);
    expect(report.totalIncome).toBe(100);
    expect(report.incomeRows).toEqual([
      expect.objectContaining({
        accountCode: "4000",
        accountName: "Sales Revenue",
        amount: 100,
        amountDisplay: "£100.00"
      })
    ]);
  });

  it("reports a £100 supplier bill debit as £100 expenses", () => {
    expect(buildProfitLossReport([bill()]).totalExpenses).toBe(100);
  });

  it("reports a £200 ordinary expense debit as £200 expenses", () => {
    expect(buildProfitLossReport([expense()]).totalExpenses).toBe(200);
  });

  it("reports a £55 mileage debit as £55 Travel & Mileage expenses", () => {
    const report = buildProfitLossReport([mileage()]);
    expect(report.totalExpenses).toBe(55);
    expect(report.expenseRows[0]).toEqual(expect.objectContaining({
      accountCode: "5200",
      accountName: "Travel & Mileage",
      amount: 55
    }));
  });

  it("excludes VAT Input and VAT Output", () => {
    const report = buildProfitLossReport([invoice(), bill()]);
    expect([...report.incomeRows, ...report.expenseRows]
      .map(row => row.accountCode)).not.toEqual(
      expect.arrayContaining(["1200", "2100"])
    );
  });

  it("excludes receivables, payables, and reimbursement liabilities", () => {
    const report = buildProfitLossReport([
      invoice(),
      bill(),
      expense(),
      mileage()
    ]);
    expect([...report.incomeRows, ...report.expenseRows]
      .map(row => row.accountCode)).not.toEqual(
      expect.arrayContaining(["1100", "2000", "2200"])
    );
  });

  it("totals income across multiple journals", () => {
    const report = buildProfitLossReport([
      invoice(),
      invoice({
        id: "invoice-2",
        invoiceNo: "INV-002",
        amount: 250,
        vat: 50,
        total: 300
      })
    ]);
    expect(report.totalIncome).toBe(350);
  });

  it("totals expenses across multiple expense accounts", () => {
    const report = buildProfitLossReport([
      bill({ category: "Utilities" }),
      expense({ category: "Software", net: 75, vat: 15, gross: 90 }),
      mileage()
    ]);
    expect(report.totalExpenses).toBe(230);
    expect(report.expenseRows.map(row => row.accountCode))
      .toEqual(["5200", "5300", "5500"]);
  });

  it("calculates net profit as income less expenses", () => {
    const view = profitLossViewFromJournals([
      invoice({ amount: 300, vat: 60, total: 360 }),
      bill()
    ]);
    expect(view.netResult).toBe(200);
    expect(view.state).toBe("profit");
    expect(view.status).toBe("Profit");
    expect(view.netResultLabel).toBe("Net Profit");
  });

  it("identifies and clearly displays a net loss", () => {
    const view = profitLossViewFromJournals([invoice(), expense()]);
    expect(view.netResult).toBe(-100);
    expect(view.state).toBe("loss");
    expect(view.status).toBe("Loss");
    expect(view.netResultLabel).toBe("Net Loss");
    expect(view.netResultDisplay).toBe("£100.00");
  });

  it("identifies break-even when financial activity exists", () => {
    const breakEven = profitLossViewFromJournals([invoice(), bill()]);
    expect(breakEven).toEqual(expect.objectContaining({
      state: "breakEven",
      status: "Break-even",
      netResult: 0,
      netResultDisplay: "£0.00"
    }));
  });

  it("returns the no-data state for an empty journal list", () => {
    const noData = profitLossViewFromJournals([]);
    expect(noData).toEqual(expect.objectContaining({
      state: "noData",
      status: "No data",
      netResultDisplay: "—"
    }));
  });
});

describe("Profit & Loss date filtering", () => {
  const datedJournals = () => [
    invoice({ id: "before", date: "2026-07-09" }),
    invoice({ id: "start", date: "2026-07-10" }),
    invoice({ id: "middle", date: "2026-07-11" }),
    invoice({ id: "end", date: "2026-07-12" }),
    invoice({ id: "after", date: "2026-07-13" })
  ];

  it("applies Date From inclusively", () => {
    const filtered = filterJournalsByDateRange(
      datedJournals(),
      "2026-07-10",
      ""
    );
    expect(filtered.map(journal => journal.sourceId))
      .toEqual(["start", "middle", "end", "after"]);
  });

  it("applies Date To inclusively", () => {
    const filtered = filterJournalsByDateRange(
      datedJournals(),
      "",
      "2026-07-12"
    );
    expect(filtered.map(journal => journal.sourceId))
      .toEqual(["before", "start", "middle", "end"]);
  });

  it("applies a combined inclusive range and excludes outside journals", () => {
    const filtered = filterJournalsByDateRange(
      datedJournals(),
      "2026-07-10",
      "2026-07-12"
    );
    expect(filtered.map(journal => journal.sourceId))
      .toEqual(["start", "middle", "end"]);
    expect(profitLossViewFromJournals(datedJournals(), {
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12"
    }).totalIncome).toBe(300);
  });

  it("rejects an invalid date range without totals", () => {
    const view = profitLossViewFromJournals([invoice()], {
      dateFrom: "2026-07-12",
      dateTo: "2026-07-10"
    });
    expect(view).toEqual(expect.objectContaining({
      state: "invalidDate",
      status: "Check dates",
      totalIncomeDisplay: "—",
      dateError: "Date From must be on or before Date To."
    }));
  });

  it("uses written calendar dates without timezone shifting", () => {
    const journal = invoice({
      id: "timezone",
      date: "2026-07-10T23:30:00-11:00"
    });
    expect(filterJournalsByDateRange(
      [journal],
      "2026-07-10",
      "2026-07-10"
    )).toHaveLength(1);
  });
});

describe("Profit & Loss ordering, contra activity, and states", () => {
  it("orders active accounts by account code", () => {
    const view = profitLossViewFromJournals([
      expense({ category: "Software" }),
      mileage(),
      bill({ category: "Utilities" }),
      expense({
        id: "professional",
        category: "Professional fees",
        net: 50,
        vat: 10,
        gross: 60
      })
    ]);
    expect(view.expenseRows.map(row => row.accountCode))
      .toEqual(["5200", "5300", "5400", "5500"]);
  });

  it("reduces income for debit activity against an income account", () => {
    const original = invoice();
    const reversal = reverseJournal(original);
    reversal.date = "2026-07-11";
    const report = buildProfitLossReport([
      original,
      reversal,
      invoice({
        id: "invoice-2",
        invoiceNo: "INV-002",
        date: "2026-07-12",
        amount: 40,
        vat: 8,
        total: 48
      })
    ]);
    expect(report.totalIncome).toBe(40);
  });

  it("reduces expenses for credit activity against an expense account", () => {
    const original = bill();
    const reversal = reverseJournal(original);
    reversal.date = "2026-07-12";
    const report = buildProfitLossReport([
      original,
      reversal,
      bill({
        id: "bill-2",
        billNumber: "BILL-002",
        billDate: "2026-07-13",
        net: 30,
        vat: 6,
        total: 36
      })
    ]);
    expect(report.totalExpenses).toBe(30);
  });

  it("uses accounting parentheses for abnormal negative account totals", () => {
    expect(formatProfitLossAmount(-25)).toBe("(£25.00)");
    expect(formatProfitLossAmount(25)).toBe("£25.00");
  });

  it("returns unable to calculate for malformed journals", () => {
    const view = profitLossViewFromJournals([{
      id: "bad",
      date: "2026-07-10",
      lines: [{ accountCode: "4000", debit: 0, credit: 100 }]
    }]);
    expect(view).toEqual(expect.objectContaining({
      state: "error",
      status: "Unable to calculate",
      incomeRows: [],
      expenseRows: [],
      totalIncomeDisplay: "—"
    }));
  });

  it("returns no financial data for balance-sheet-only journals", () => {
    const view = profitLossViewFromJournals([{
      id: "balance-sheet-only",
      date: "2026-07-10",
      lines: [
        { accountCode: "1000", debit: 100, credit: 0 },
        { accountCode: "3000", debit: 0, credit: 100 }
      ]
    }]);
    expect(view).toEqual(expect.objectContaining({
      state: "noData",
      status: "No data",
      emptyTitle: "No financial data available."
    }));
  });

  it("normalises Firestore-loaded journals without mutation", () => {
    const stored = {
      date: "2026-07-10",
      sourceType: "salesInvoice",
      sourceId: "invoice-1",
      lines: [
        { accountCode: "1100", debit: 100, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 100 }
      ]
    };
    const before = structuredClone(stored);
    const normalised = journalFromFirestoreData("journal-1", stored);
    const view = profitLossViewFromJournals([normalised]);

    expect(view.totalIncome).toBe(100);
    expect(normalised.lines).not.toBe(stored.lines);
    expect(stored).toEqual(before);
  });
});
