import { describe, expect, it } from "vitest";
import {
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal
} from "../resources/js/ledger-engine.js";
import {
  activeGeneralLedgerAccounts,
  filterJournalsByDate,
  formatGeneralLedgerBalance,
  generalLedgerDateRange,
  generalLedgerReference,
  generalLedgerViewFromJournals,
  resolveGeneralLedgerAccount,
  sortJournalsForAccountLedger
} from "../resources/js/general-ledger-view.js";

function invoice(overrides = {}) {
  const values = {
    id: "invoice-1",
    invoiceNo: "INV-001",
    client: "Customer",
    date: "2026-07-10",
    amount: 100,
    vat: 20,
    total: 120,
    ...overrides
  };
  return {
    ...createSalesInvoiceJournal(values),
    id: values.documentId || values.id,
    journalId: values.journalId || `journal-${values.id}`,
    sourceNumber: values.invoiceNo
  };
}

function bill(overrides = {}) {
  const values = {
    id: "bill-1",
    billNumber: "BILL-001",
    supplier: "Supplier",
    billDate: "2026-07-11",
    category: "Utilities",
    net: 50,
    vat: 10,
    total: 60,
    ...overrides
  };
  return {
    ...createBillJournal(values),
    id: values.documentId || values.id,
    journalId: values.journalId || `journal-${values.id}`,
    sourceNumber: values.billNumber
  };
}

function expense(overrides = {}) {
  const values = {
    id: "expense-1",
    date: "2026-07-12",
    merchant: "Shop",
    category: "General",
    net: 25,
    vat: 5,
    gross: 30,
    ...overrides
  };
  return {
    ...createExpenseJournal(values),
    id: values.documentId || values.id,
    journalId: values.journalId || `journal-${values.id}`,
    sourceNumber: values.reference || values.id
  };
}

function mileage(overrides = {}) {
  const values = {
    id: "mileage-1",
    type: "mileage",
    date: "2026-07-13",
    from: "Home",
    to: "Client",
    miles: 10,
    ratePerMile: 0.55,
    amount: 5.5,
    ...overrides
  };
  return {
    ...createMileageJournal(values),
    id: values.documentId || values.id,
    journalId: values.journalId || `journal-${values.id}`,
    sourceNumber: values.reference || values.id
  };
}

describe("General Ledger active accounts", () => {
  it("deduplicates active accounts, sorts by code, and uses chart names", () => {
    const accounts = activeGeneralLedgerAccounts([
      invoice(),
      invoice({
        id: "invoice-2",
        invoiceNo: "INV-002",
        date: "2026-07-14",
        amount: 50,
        vat: 10,
        total: 60
      }),
      bill()
    ]);

    expect(accounts.map(account => account.accountCode))
      .toEqual(["1100", "1200", "2000", "2100", "4000", "5300"]);
    expect(accounts.filter(account => account.accountCode === "1100")).toHaveLength(1);
    expect(accounts.find(account => account.accountCode === "1100")).toEqual({
      accountCode: "1100",
      accountName: "Trade Receivables",
      label: "1100 — Trade Receivables"
    });
  });

  it("does not produce options from malformed zero-only lines", () => {
    const invalid = invoice();
    invalid.lines.push({
      accountCode: "5000",
      description: "Invalid zero line",
      debit: 0,
      credit: 0
    });
    const view = generalLedgerViewFromJournals([invalid]);

    expect(view.state).toBe("error");
    expect(view.accounts).toEqual([]);
  });
});

describe("General Ledger source accounts", () => {
  it("renders a sales invoice receivable debit and excludes unrelated lines", () => {
    const view = generalLedgerViewFromJournals([invoice()], {
      accountCode: "1100"
    });

    expect(view.state).toBe("loaded");
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toEqual(expect.objectContaining({
      reference: "INV-001",
      debitDisplay: "£120.00",
      creditDisplay: "—",
      runningBalanceDisplay: "£120.00 Dr"
    }));
  });

  it("renders a supplier bill under Trade Payables as a credit", () => {
    const view = generalLedgerViewFromJournals([bill()], {
      accountCode: "2000"
    });
    expect(view.rows[0]).toEqual(expect.objectContaining({
      debitDisplay: "—",
      creditDisplay: "£60.00",
      runningBalanceDisplay: "£60.00 Cr"
    }));
  });

  it("renders ordinary expenses under their mapped expense account", () => {
    const view = generalLedgerViewFromJournals([expense()], {
      accountCode: "5000"
    });
    expect(view.rows[0].debitDisplay).toBe("£25.00");
    expect(view.selectedAccountName).toBe("General Expenses");
  });

  it("renders mileage under Travel & Mileage account 5200", () => {
    const view = generalLedgerViewFromJournals([mileage()], {
      accountCode: "5200"
    });
    expect(view.rows[0].debitDisplay).toBe("£5.50");
    expect(view.selectedAccountName).toBe("Travel & Mileage");
  });
});

describe("General Ledger ordering and dates", () => {
  it("sorts entries chronologically", () => {
    const view = generalLedgerViewFromJournals([
      invoice({ id: "later", invoiceNo: "INV-L", date: "2026-07-20" }),
      invoice({ id: "earlier", invoiceNo: "INV-E", date: "2026-07-01" })
    ], { accountCode: "1100" });

    expect(view.rows.map(row => row.reference)).toEqual(["INV-E", "INV-L"]);
  });

  it("uses journal identity as a stable same-date secondary order", () => {
    const ordered = sortJournalsForAccountLedger([
      invoice({
        id: "b",
        journalId: "journal-b",
        invoiceNo: "INV-B",
        date: "2026-07-10"
      }),
      invoice({
        id: "a",
        journalId: "journal-a",
        invoiceNo: "INV-A",
        date: "2026-07-10"
      })
    ]);
    expect(ordered.map(journal => journal.sourceNumber)).toEqual(["INV-A", "INV-B"]);
  });

  it("applies Date From inclusively", () => {
    const filtered = filterJournalsByDate([
      invoice({ id: "before", date: "2026-07-09" }),
      invoice({ id: "boundary", date: "2026-07-10" })
    ], "2026-07-10", "");
    expect(filtered.map(journal => journal.sourceId)).toEqual(["boundary"]);
  });

  it("applies Date To inclusively", () => {
    const filtered = filterJournalsByDate([
      invoice({ id: "boundary", date: "2026-07-10" }),
      invoice({ id: "after", date: "2026-07-11" })
    ], "", "2026-07-10");
    expect(filtered.map(journal => journal.sourceId)).toEqual(["boundary"]);
  });

  it("applies a combined inclusive range", () => {
    const filtered = filterJournalsByDate([
      invoice({ id: "start", date: "2026-07-10" }),
      invoice({ id: "middle", date: "2026-07-11" }),
      invoice({ id: "end", date: "2026-07-12" }),
      invoice({ id: "outside", date: "2026-07-13" })
    ], "2026-07-10", "2026-07-12");
    expect(filtered.map(journal => journal.sourceId))
      .toEqual(["start", "middle", "end"]);
  });

  it("uses the written calendar date without timezone shifting", () => {
    const filtered = filterJournalsByDate([
      invoice({ id: "timestamp", date: "2026-07-10T23:30:00-11:00" })
    ], "2026-07-10", "2026-07-10");
    expect(filtered).toHaveLength(1);
  });

  it("detects an invalid date range", () => {
    expect(generalLedgerDateRange("2026-07-12", "2026-07-10")).toEqual({
      valid: false,
      from: "2026-07-12",
      to: "2026-07-10",
      error: "Date From must be on or before Date To."
    });
    const view = generalLedgerViewFromJournals([invoice()], {
      accountCode: "1100",
      dateFrom: "2026-07-12",
      dateTo: "2026-07-10"
    });
    expect(view.state).toBe("invalidDate");
    expect(view.status).toBe("Check dates");
  });
});

describe("General Ledger presentation", () => {
  it("formats debit, credit, and zero running balances conventionally", () => {
    expect(formatGeneralLedgerBalance(240)).toBe("£240.00 Dr");
    expect(formatGeneralLedgerBalance(-200)).toBe("£200.00 Cr");
    expect(formatGeneralLedgerBalance(0)).toBe("£0.00");
  });

  it("uses source number, source ID, journal ID, then journal reference", () => {
    expect(generalLedgerReference({
      sourceNumber: "INV-001",
      sourceId: "source",
      journalId: "journal",
      journalReference: "document"
    })).toBe("INV-001");
    expect(generalLedgerReference({
      sourceId: "source",
      journalId: "journal",
      journalReference: "document"
    })).toBe("source");
    expect(generalLedgerReference({
      journalId: "journal",
      journalReference: "document"
    })).toBe("journal");
    expect(generalLedgerReference({ journalReference: "document" }))
      .toBe("document");
  });
});

describe("General Ledger states and query selection", () => {
  it("returns No data when the signed-in user has no journals", () => {
    const view = generalLedgerViewFromJournals([]);
    expect(view).toEqual(expect.objectContaining({
      state: "noData",
      status: "No data",
      accountsCount: 0,
      entriesCount: 0
    }));
  });

  it("returns Ready when no account is selected", () => {
    const view = generalLedgerViewFromJournals([invoice()]);
    expect(view).toEqual(expect.objectContaining({
      state: "ready",
      status: "Ready",
      entriesCount: 0,
      selectedAccountCode: ""
    }));
  });

  it("returns Loaded when the selected account has entries", () => {
    const view = generalLedgerViewFromJournals([invoice()], {
      accountCode: "1100"
    });
    expect(view).toEqual(expect.objectContaining({
      state: "loaded",
      status: "Loaded",
      statusText: "1 entry shown",
      entriesCount: 1
    }));
  });

  it("returns No activity when the selected period has no entries", () => {
    const view = generalLedgerViewFromJournals([invoice()], {
      accountCode: "1100",
      dateFrom: "2026-08-01"
    });
    expect(view).toEqual(expect.objectContaining({
      state: "noActivity",
      status: "No activity",
      entriesCount: 0,
      closingBalanceDisplay: "£0.00"
    }));
  });

  it("returns an error without partial results for malformed journals", () => {
    const view = generalLedgerViewFromJournals([{
      id: "bad",
      date: "2026-07-10",
      lines: [{ accountCode: "1100", debit: 100, credit: 0 }]
    }], { accountCode: "1100" });
    expect(view).toEqual(expect.objectContaining({
      state: "error",
      accounts: [],
      rows: [],
      status: "Unable to load"
    }));
  });

  it("resolves an active query account and safely ignores unknown values", () => {
    const accounts = activeGeneralLedgerAccounts([invoice()]);
    expect(resolveGeneralLedgerAccount("1100", accounts)).toBe("1100");
    expect(resolveGeneralLedgerAccount("9999", accounts)).toBe("");
    expect(resolveGeneralLedgerAccount("", accounts)).toBe("");
  });
});
