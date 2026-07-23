import { describe, expect, it } from "vitest";
import {
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal,
  DEFAULT_CHART_OF_ACCOUNTS,
  reverseJournal
} from "../resources/js/ledger-engine.js";
import {
  balanceSheetErrorView,
  balanceSheetViewFromJournals,
  buildBalanceSheetReport,
  createBalanceSheetView,
  filterJournalsAsAt,
  formatBalanceSheetAmount,
  ownerJournalsFromDocuments
} from "../resources/js/balance-sheet-view.js";

function journal(id, date, lines) {
  return { id, date, sourceType: "test", sourceId: id, lines };
}

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
    net: 50,
    vat: 10,
    gross: 60,
    ...overrides
  });
}

function mileage(overrides = {}) {
  return createMileageJournal({
    id: "mileage-1",
    type: "mileage",
    date: "2026-07-13",
    miles: 100,
    ratePerMile: 0.55,
    amount: 55,
    ...overrides
  });
}

function simpleEquityJournal(overrides = {}) {
  return journal(
    overrides.id || "opening",
    overrides.date || "2026-07-01",
    [
      { accountCode: "1000", debit: 1000, credit: 0 },
      { accountCode: "3000", debit: 0, credit: 1000 }
    ]
  );
}

describe("Balance Sheet core statement", () => {
  it("returns No data for an empty journal set", () => {
    expect(balanceSheetViewFromJournals([])).toEqual(expect.objectContaining({
      state: "noData",
      status: "No data",
      totalAssetsDisplay: "—"
    }));
  });

  it("balances a £1,000 Bank debit against Owner's Equity", () => {
    const view = balanceSheetViewFromJournals([simpleEquityJournal()]);
    expect(view).toEqual(expect.objectContaining({
      state: "balanced",
      status: "Balanced",
      totalAssets: 1000,
      totalEquity: 1000,
      difference: 0
    }));
  });

  it("shows Trade Receivables as an asset", () => {
    const view = balanceSheetViewFromJournals([invoice()]);
    expect(view.assetRows).toContainEqual(expect.objectContaining({
      accountCode: "1100",
      accountName: "Trade Receivables",
      amount: 120
    }));
  });

  it("shows Trade Payables as a liability", () => {
    const view = balanceSheetViewFromJournals([bill()]);
    expect(view.liabilityRows).toContainEqual(expect.objectContaining({
      accountCode: "2000",
      amount: 120
    }));
  });

  it("shows VAT Input as an asset", () => {
    const view = balanceSheetViewFromJournals([bill()]);
    expect(view.assetRows).toContainEqual(expect.objectContaining({
      accountCode: "1200",
      amount: 20
    }));
  });

  it("shows VAT Output as a liability", () => {
    const view = balanceSheetViewFromJournals([invoice()]);
    expect(view.liabilityRows).toContainEqual(expect.objectContaining({
      accountCode: "2100",
      amount: 20
    }));
  });

  it("shows Employee Reimbursements Payable as a liability", () => {
    const view = balanceSheetViewFromJournals([expense()]);
    expect(view.liabilityRows).toContainEqual(expect.objectContaining({
      accountCode: "2200",
      amount: 60
    }));
  });

  it("derives Current Year Profit from sales less expenses", () => {
    const view = balanceSheetViewFromJournals([invoice(), expense()]);
    expect(view).toEqual(expect.objectContaining({
      currentYearResult: 50,
      currentYearResultLabel: "Current Year Profit",
      currentYearResultDisplay: "£50.00"
    }));
  });

  it("derives Current Year Loss when expenses exceed sales", () => {
    const view = balanceSheetViewFromJournals([
      invoice(),
      expense({ net: 150, vat: 30, gross: 180 })
    ]);
    expect(view).toEqual(expect.objectContaining({
      currentYearResult: -50,
      currentYearResultLabel: "Current Year Loss",
      currentYearResultDisplay: "£50.00"
    }));
  });

  it("adds profit to equity", () => {
    const view = balanceSheetViewFromJournals([
      simpleEquityJournal(),
      invoice()
    ]);
    expect(view.totalEquity).toBe(1100);
  });

  it("subtracts a loss from equity", () => {
    const view = balanceSheetViewFromJournals([
      simpleEquityJournal(),
      expense()
    ]);
    expect(view.totalEquity).toBe(950);
  });

  it("uses debit orientation for assets and credit orientation for liabilities and equity", () => {
    const view = balanceSheetViewFromJournals([journal(
      "orientation",
      "2026-07-01",
      [
        { accountCode: "1000", debit: 100, credit: 0 },
        { accountCode: "2000", debit: 0, credit: 60 },
        { accountCode: "3000", debit: 0, credit: 40 }
      ]
    )]);
    expect(view.assetRows[0].amount).toBe(100);
    expect(view.liabilityRows[0].amount).toBe(60);
    expect(view.equityRows[0].amount).toBe(40);
  });
});

describe("Balance Sheet reporting date", () => {
  it("includes journals on the As at date", () => {
    const filtered = filterJournalsAsAt([
      simpleEquityJournal({ id: "boundary", date: "2026-07-10" })
    ], "2026-07-10");
    expect(filtered).toHaveLength(1);
  });

  it("excludes journals after the As at date", () => {
    const view = balanceSheetViewFromJournals([
      simpleEquityJournal({ id: "included", date: "2026-07-10" }),
      invoice({ id: "excluded", date: "2026-07-11" })
    ], { asAt: "2026-07-10" });
    expect(view.totalAssets).toBe(1000);
    expect(view.assetRows.map(row => row.accountCode)).toEqual(["1000"]);
  });

  it("uses calendar dates without timezone shifting", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const filtered = filterJournalsAsAt([
        simpleEquityJournal({
          id: "timezone",
          date: "2026-07-10T23:30:00+14:00"
        })
      ], "2026-07-10");
      expect(filtered).toHaveLength(1);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("returns Check date for an invalid As at value", () => {
    expect(balanceSheetViewFromJournals(
      [simpleEquityJournal()],
      { asAt: "not-a-date" }
    )).toEqual(expect.objectContaining({
      state: "invalidDate",
      status: "Check date",
      totalAssetsDisplay: "—"
    }));
  });
});

describe("Balance Sheet account classification and presentation", () => {
  it("excludes zero-value account rows", () => {
    const opening = simpleEquityJournal();
    const reversal = reverseJournal(opening);
    reversal.date = "2026-07-02";
    const view = balanceSheetViewFromJournals([opening, reversal]);
    expect(view.assetRows).toEqual([]);
    expect(view.equityRows).toEqual([]);
  });

  it("sorts rows by account code", () => {
    const view = balanceSheetViewFromJournals([
      invoice(),
      bill(),
      simpleEquityJournal()
    ]);
    const codes = view.assetRows.map(row => row.accountCode);
    expect(codes).toEqual(
      [...codes].sort((left, right) => left.localeCompare(right))
    );
  });

  it("supports another valid Asset account from an extended chart", () => {
    const chart = [
      ...DEFAULT_CHART_OF_ACCOUNTS,
      { code: "1300", name: "Inventory", type: "Asset" }
    ];
    const view = balanceSheetViewFromJournals([journal(
      "inventory",
      "2026-07-01",
      [
        { accountCode: "1300", debit: 75, credit: 0 },
        { accountCode: "3000", debit: 0, credit: 75 }
      ]
    )], { chartOfAccounts: chart });
    expect(view.assetRows).toContainEqual(expect.objectContaining({
      accountCode: "1300",
      accountName: "Inventory",
      amount: 75
    }));
  });

  it("supports another valid Liability account from an extended chart", () => {
    const chart = [
      ...DEFAULT_CHART_OF_ACCOUNTS,
      { code: "2300", name: "Accrued Expenses", type: "Liability" }
    ];
    const view = balanceSheetViewFromJournals([journal(
      "accrual",
      "2026-07-01",
      [
        { accountCode: "5000", debit: 80, credit: 0 },
        { accountCode: "2300", debit: 0, credit: 80 }
      ]
    )], { chartOfAccounts: chart });
    expect(view.liabilityRows).toContainEqual(expect.objectContaining({
      accountCode: "2300",
      accountName: "Accrued Expenses",
      amount: 80
    }));
  });

  it("supports another valid Equity account from an extended chart", () => {
    const chart = [
      ...DEFAULT_CHART_OF_ACCOUNTS,
      { code: "3100", name: "Share Capital", type: "Equity" }
    ];
    const view = balanceSheetViewFromJournals([journal(
      "capital",
      "2026-07-01",
      [
        { accountCode: "1000", debit: 90, credit: 0 },
        { accountCode: "3100", debit: 0, credit: 90 }
      ]
    )], { chartOfAccounts: chart });
    expect(view.equityRows).toContainEqual(expect.objectContaining({
      accountCode: "3100",
      accountName: "Share Capital",
      amount: 90
    }));
  });

  it("does not show Income or Expense accounts directly in statement sections", () => {
    const view = balanceSheetViewFromJournals([invoice(), expense()]);
    const directCodes = [
      ...view.assetRows,
      ...view.liabilityRows,
      ...view.equityRows
    ].map(row => row.accountCode);
    expect(directCodes).not.toEqual(
      expect.arrayContaining(["4000", "5000"])
    );
  });

  it("feeds Income and Expense accounts only into the current-year result", () => {
    const view = balanceSheetViewFromJournals([invoice(), expense()]);
    expect(view.currentYearResult).toBe(50);
    expect(view.equityRows.find(row => row.accountCode === "4000"))
      .toBeUndefined();
    expect(view.equityRows.find(row => row.accountCode === "5000"))
      .toBeUndefined();
  });

  it("formats and rounds amounts to two decimal places", () => {
    expect(formatBalanceSheetAmount(10.126)).toBe("£10.13");
    expect(formatBalanceSheetAmount(-4.555)).toBe("(£4.55)");
  });
});

describe("Balance Sheet states, links, and safety", () => {
  it("returns Out of balance for a non-zero equation difference", () => {
    const report = buildBalanceSheetReport([simpleEquityJournal()]);
    const view = createBalanceSheetView(
      { ...report, difference: 0.01, differenceDisplay: "£0.01" },
      1
    );
    expect(view).toEqual(expect.objectContaining({
      state: "outOfBalance",
      status: "Out of balance"
    }));
  });

  it("returns Balanced when the rounded difference is zero", () => {
    const report = buildBalanceSheetReport([simpleEquityJournal()]);
    const view = createBalanceSheetView(
      { ...report, difference: 0.004 },
      1
    );
    expect(view.status).toBe("Balanced");
  });

  it("returns Unable to calculate for malformed journals", () => {
    const view = balanceSheetViewFromJournals([{
      id: "bad",
      date: "2026-07-01",
      lines: [{ accountCode: "1000", debit: 100, credit: 0 }]
    }]);
    expect(view).toEqual(expect.objectContaining({
      state: "error",
      status: "Unable to calculate",
      totalAssetsDisplay: "—"
    }));
  });

  it("represents a query or loading failure as Unable to calculate", () => {
    const error = new Error("query failed");
    expect(balanceSheetErrorView(error)).toEqual(expect.objectContaining({
      state: "error",
      status: "Unable to calculate",
      error
    }));
  });

  it("excludes another user's data from a mocked document-loading path", () => {
    const documents = [
      {
        id: "mine",
        data: () => ({ ...simpleEquityJournal(), userId: "user-1" })
      },
      {
        id: "theirs",
        data: () => ({ ...simpleEquityJournal(), userId: "user-2" })
      }
    ];
    const loaded = ownerJournalsFromDocuments(documents, "user-1");
    expect(loaded.map(item => item.id)).toEqual(["mine"]);
  });

  it("builds correctly encoded General Ledger account links", () => {
    const view = balanceSheetViewFromJournals([invoice()]);
    expect(view.assetRows.find(row => row.accountCode === "1100"))
      .toEqual(expect.objectContaining({
        generalLedgerHref:
          "/resources/tools/general-ledger.html?account=1100",
        generalLedgerLabel:
          "View General Ledger for Trade Receivables"
      }));
  });

  it("links Current Year Profit or Loss to Profit & Loss", () => {
    const view = balanceSheetViewFromJournals([invoice()]);
    expect(view.currentYearResultHref)
      .toBe("/resources/tools/profit-loss.html");
  });

  it("is deterministic and does not mutate source journals", () => {
    const journals = [invoice(), bill(), expense(), mileage()];
    const before = structuredClone(journals);
    const first = balanceSheetViewFromJournals(journals);
    const second = balanceSheetViewFromJournals(journals);
    expect(first).toEqual(second);
    expect(journals).toEqual(before);
  });
});
