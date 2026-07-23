import { describe, expect, it } from "vitest";
import {
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal
} from "../resources/js/ledger-engine.js";
import {
  createTrialBalanceView,
  formatTrialBalanceGbp,
  journalFromFirestoreData,
  requireJournalOwnerId,
  trialBalanceViewFromJournals
} from "../resources/js/trial-balance-view.js";

function salesInvoice(overrides = {}) {
  return createSalesInvoiceJournal({
    id: "invoice-1",
    invoiceNo: "INV-001",
    client: "Customer",
    date: "2026-07-01",
    amount: 100,
    vat: 20,
    total: 120,
    ...overrides
  });
}

function allSourceJournals() {
  return [
    salesInvoice(),
    createBillJournal({
      id: "bill-1",
      billNumber: "BILL-001",
      supplier: "Supplier",
      billDate: "2026-07-02",
      category: "Utilities",
      net: 50,
      vat: 10,
      total: 60
    }),
    createExpenseJournal({
      id: "expense-1",
      date: "2026-07-03",
      merchant: "Shop",
      category: "General",
      net: 25,
      vat: 5,
      gross: 30
    }),
    createMileageJournal({
      id: "mileage-1",
      type: "mileage",
      date: "2026-07-04",
      from: "Home",
      to: "Client",
      miles: 10,
      ratePerMile: 0.55,
      amount: 5.5
    })
  ];
}

describe("Trial Balance view states", () => {
  it("produces No data instead of a false balanced state for an empty journal list", () => {
    expect(trialBalanceViewFromJournals([])).toEqual(expect.objectContaining({
      state: "empty",
      status: "No data",
      totalDebitsDisplay: "—",
      totalCreditsDisplay: "—",
      differenceDisplay: "—",
      rows: []
    }));
  });

  it("returns an error state for invalid journal data", () => {
    const view = trialBalanceViewFromJournals([{
      id: "invalid",
      date: "2026-07-01",
      lines: [{ accountCode: "1100", debit: 100, credit: 0 }]
    }]);

    expect(view).toEqual(expect.objectContaining({
      state: "error",
      status: "Unable to calculate",
      rows: []
    }));
    expect(view.error).toBeInstanceOf(Error);
  });

  it("reports an artificial non-zero difference as Out of balance", () => {
    const view = createTrialBalanceView({
      accounts: [{
        accountCode: "1100",
        accountName: "Trade Receivables",
        debitBalance: 100,
        creditBalance: 0
      }],
      totalDebits: 100,
      totalCredits: 99,
      balanced: false
    }, 1);

    expect(view.status).toBe("Out of balance");
    expect(view.statusText).toBe("Review journal data");
    expect(view.difference).toBe(1);
    expect(view.differenceDisplay).toBe("£1.00");
  });
});

describe("Trial Balance closing-balance presentation", () => {
  it("shows the conventional balances for one sales invoice", () => {
    const view = trialBalanceViewFromJournals([salesInvoice()]);

    expect(view.state).toBe("ready");
    expect(view.rows).toEqual([
      expect.objectContaining({
        accountCode: "1100",
        accountName: "Trade Receivables",
        debitBalance: 120,
        creditBalance: 0,
        debitDisplay: "£120.00",
        creditDisplay: ""
      }),
      expect.objectContaining({
        accountCode: "2100",
        accountName: "VAT Output",
        debitDisplay: "",
        creditDisplay: "£20.00"
      }),
      expect.objectContaining({
        accountCode: "4000",
        accountName: "Sales Revenue",
        debitDisplay: "",
        creditDisplay: "£100.00"
      })
    ]);
  });

  it("aggregates invoice, bill, expense, and mileage journals correctly", () => {
    const view = trialBalanceViewFromJournals(allSourceJournals());
    const vatInput = view.rows.find(row => row.accountCode === "1200");
    const reimbursements = view.rows.find(row => row.accountCode === "2200");

    expect(view.state).toBe("ready");
    expect(vatInput).toEqual(expect.objectContaining({
      accountName: "VAT Input",
      debitBalance: 15,
      debitDisplay: "£15.00",
      creditDisplay: ""
    }));
    expect(reimbursements).toEqual(expect.objectContaining({
      accountName: "Employee Reimbursements Payable",
      creditBalance: 35.5,
      debitDisplay: "",
      creditDisplay: "£35.50"
    }));
    expect(view.rows.filter(row => row.accountCode === "1200")).toHaveLength(1);
    expect(view.totalDebits).toBe(215.5);
    expect(view.totalCredits).toBe(215.5);
    expect(view.difference).toBe(0);
    expect(view.status).toBe("Balanced");
  });

  it("sorts rows by account code", () => {
    const view = trialBalanceViewFromJournals(allSourceJournals());
    const codes = view.rows.map(row => row.accountCode);
    expect(codes).toEqual([...codes].sort((left, right) => left.localeCompare(right)));
  });

  it("never displays both a debit and credit closing balance on one row", () => {
    const view = trialBalanceViewFromJournals(allSourceJournals());
    view.rows.forEach(row => {
      expect(Boolean(row.debitDisplay) && Boolean(row.creditDisplay)).toBe(false);
    });
  });

  it("formats GBP with grouping and two decimal places", () => {
    expect(formatTrialBalanceGbp(1234.56)).toBe("£1,234.56");
    expect(formatTrialBalanceGbp(0)).toBe("£0.00");
  });
});

describe("Firestore journal preparation and owner isolation", () => {
  it("maps a Firestore document without mutating its data", () => {
    const data = {
      journalId: "stored-id",
      date: "2026-07-01",
      sourceType: "salesInvoice",
      sourceId: "invoice-1",
      sourceNumber: "INV-001",
      description: "Invoice",
      lines: [
        { accountCode: "1100", description: "Receivable", debit: 120, credit: 0 },
        { accountCode: "4000", description: "Revenue", debit: 0, credit: 120 }
      ]
    };
    const before = structuredClone(data);
    const journal = journalFromFirestoreData("firestore-document-id", data);

    expect(journal).toEqual({
      id: "firestore-document-id",
      journalId: "stored-id",
      date: "2026-07-01",
      sourceType: "salesInvoice",
      sourceId: "invoice-1",
      sourceNumber: "INV-001",
      description: "Invoice",
      lines: data.lines
    });
    expect(journal.lines).not.toBe(data.lines);
    expect(data).toEqual(before);
  });

  it("preserves malformed values so validation can reject rather than repair them", () => {
    const journal = journalFromFirestoreData("bad-journal", {
      date: "",
      sourceType: "expenseClaim",
      sourceId: "expense-1",
      lines: "not-an-array"
    });
    const view = trialBalanceViewFromJournals([journal]);

    expect(journal.lines).toBe("not-an-array");
    expect(view.state).toBe("error");
  });

  it("requires a non-empty authenticated user ID for the owner query", () => {
    expect(requireJournalOwnerId(" user-1 ")).toBe("user-1");
    expect(() => requireJournalOwnerId("")).toThrow("authenticated user ID");
    expect(() => requireJournalOwnerId(null)).toThrow("authenticated user ID");
  });
});

describe("Trial Balance General Ledger drill-down", () => {
  it("builds an encoded, accessible General Ledger link for each account", () => {
    const view = createTrialBalanceView({
      accounts: [{
        accountCode: "1100/A",
        accountName: "Trade Receivables",
        debitBalance: 10,
        creditBalance: 0
      }],
      totalDebits: 10,
      totalCredits: 10,
      balanced: true
    }, 1);

    expect(view.rows[0]).toEqual(expect.objectContaining({
      generalLedgerHref: "/resources/tools/general-ledger.html?account=1100%2FA",
      generalLedgerLabel: "View General Ledger for Trade Receivables"
    }));
    expect(view.totalDebits).toBe(10);
    expect(view.totalCredits).toBe(10);
  });
});
