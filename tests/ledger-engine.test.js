import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  buildAccountLedger,
  buildTrialBalance,
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal,
  hasJournalForSource,
  reverseJournal,
  validateJournal
} from "../resources/js/ledger-engine.js";

function basicJournal(overrides = {}) {
  return {
    id: "journal-1",
    date: "2026-07-01",
    sourceType: "test",
    sourceId: "source-1",
    description: "Test journal",
    lines: [
      { accountCode: "1000", description: "Debit", debit: 100, credit: 0 },
      { accountCode: "3000", description: "Credit", debit: 0, credit: 100 }
    ],
    ...overrides
  };
}

describe("default Chart of Accounts", () => {
  it("contains the required accounts and the reimbursement liability", () => {
    expect(DEFAULT_CHART_OF_ACCOUNTS.map(account => account.code)).toEqual([
      "1000", "1100", "1200", "2000", "2100", "2200", "3000",
      "4000", "5000", "5200", "5300", "5400", "5500"
    ]);
    expect(DEFAULT_CHART_OF_ACCOUNTS.find(account => account.code === "2200"))
      .toEqual({ code: "2200", name: "Employee Reimbursements Payable", type: "Liability" });
  });
});

describe("journal validation", () => {
  it("accepts a balanced journal and returns its totals", () => {
    expect(validateJournal(basicJournal())).toEqual({
      valid: true,
      errors: [],
      totalDebits: 100,
      totalCredits: 100
    });
  });

  it("rejects a missing journal", () => {
    expect(validateJournal(null).valid).toBe(false);
  });

  it("requires a date and at least two lines", () => {
    const result = validateJournal(basicJournal({ date: "", lines: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Journal date is required.",
      "Journal must contain at least two lines."
    ]));
  });

  it("rejects invalid account codes", () => {
    const journal = basicJournal();
    journal.lines[0].accountCode = "9999";
    expect(validateJournal(journal).errors).toContain("Line 1 has an invalid account code.");
  });

  it("rejects a line containing both debit and credit", () => {
    const journal = basicJournal();
    journal.lines[0] = { accountCode: "1000", debit: 100, credit: 100 };
    expect(validateJournal(journal).errors)
      .toContain("Line 1 cannot contain both a debit and a credit.");
  });

  it("rejects negative and zero-only lines", () => {
    const journal = basicJournal({
      lines: [
        { accountCode: "1000", debit: -10, credit: 0 },
        { accountCode: "3000", debit: 0, credit: 0 }
      ]
    });
    const result = validateJournal(journal);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Line 1 debit and credit cannot be negative.",
      "Line 2 must contain a non-zero debit or credit."
    ]));
  });

  it("rejects unbalanced journals", () => {
    const journal = basicJournal();
    journal.lines[1].credit = 99;
    expect(validateJournal(journal).errors)
      .toContain("Journal debits and credits must balance.");
  });

  it("rejects non-finite values and values beyond two decimal places", () => {
    const nonFinite = basicJournal();
    nonFinite.lines[0].debit = Number.NaN;
    expect(validateJournal(nonFinite).errors)
      .toContain("Line 1 debit and credit must be finite numbers.");

    const overPrecise = basicJournal();
    overPrecise.lines[0].debit = 100.001;
    overPrecise.lines[1].credit = 100.001;
    expect(validateJournal(overPrecise).errors)
      .toContain("Line 1 monetary values must have no more than two decimal places.");
  });
});

describe("sales invoice posting", () => {
  it("posts multiple revenue lines and 20% VAT", () => {
    const journal = createSalesInvoiceJournal({
      id: "inv-1",
      invoiceNo: "INV-001",
      client: "Acme Ltd",
      date: "01/07/2026",
      items: [
        { description: "Bookkeeping", amount: "100.00" },
        { description: "VAT return", amount: 50 }
      ],
      amount: 150,
      vat: 30,
      total: 180
    });

    expect(journal.date).toBe("2026-07-01");
    expect(journal.description).toBe("Sales invoice INV-001 - Acme Ltd");
    expect(journal.lines).toEqual([
      expect.objectContaining({ accountCode: "1100", debit: 180, credit: 0 }),
      expect.objectContaining({ accountCode: "4000", description: "Bookkeeping", debit: 0, credit: 100 }),
      expect.objectContaining({ accountCode: "4000", description: "VAT return", debit: 0, credit: 50 }),
      expect.objectContaining({ accountCode: "2100", debit: 0, credit: 30 })
    ]);
    expect(validateJournal(journal).valid).toBe(true);
  });

  it.each([
    [0, 100, 2],
    [0.05, 105, 3],
    [0.2, 120, 3]
  ])("posts a sales invoice at VAT rate %s", (vatRate, total, lineCount) => {
    const journal = createSalesInvoiceJournal({
      id: `invoice-${vatRate}`,
      invoiceNo: `INV-${vatRate}`,
      client: "Customer",
      date: "2026-07-02",
      amount: 100,
      vatRate,
      total
    });

    expect(journal.lines).toHaveLength(lineCount);
    expect(journal.lines[0].debit).toBe(total);
    expect(validateJournal(journal).valid).toBe(true);
  });

  it("treats missing VAT as no VAT", () => {
    const journal = createSalesInvoiceJournal({
      id: "inv-no-vat",
      date: "2026-07-03",
      amount: 75,
      total: 75
    });
    expect(journal.lines.some(line => line.accountCode === "2100")).toBe(false);
  });

  it("rejects inconsistent totals and invalid values instead of creating suspense", () => {
    expect(() => createSalesInvoiceJournal({
      id: "bad-total",
      date: "2026-07-03",
      amount: 100,
      vat: 20,
      total: 119
    })).toThrow("does not equal net plus VAT");

    expect(() => createSalesInvoiceJournal({
      id: "bad-value",
      date: "2026-07-03",
      amount: "invalid"
    })).toThrow("finite, non-negative number");
  });
});

describe("supplier bill posting", () => {
  it("posts utilities, input VAT, and trade payables", () => {
    const journal = createBillJournal({
      id: "bill-1",
      billNumber: "BILL-001",
      supplier: "Energy Ltd",
      billDate: "2026-07-04",
      category: "Utilities",
      net: 100,
      vatRate: 0.2,
      total: 120
    });

    expect(journal.lines).toEqual([
      expect.objectContaining({ accountCode: "5300", debit: 100, credit: 0 }),
      expect.objectContaining({ accountCode: "1200", debit: 20, credit: 0 }),
      expect.objectContaining({ accountCode: "2000", debit: 0, credit: 120 })
    ]);
  });

  it("uses General Expenses as the fallback and omits zero VAT", () => {
    const journal = createBillJournal({
      id: "bill-2",
      supplier: "Supplier",
      billDate: "2026-07-05",
      net: 40,
      vat: 0,
      total: 40
    });
    expect(journal.lines.map(line => line.accountCode)).toEqual(["5000", "2000"]);
  });

  it.each([
    ["Travel", "5200"],
    ["Professional fees", "5400"],
    ["Software", "5500"]
  ])("maps %s bills to account %s", (category, accountCode) => {
    const journal = createBillJournal({
      id: `bill-${accountCode}`,
      billDate: "2026-07-06",
      category,
      net: 10,
      total: 10
    });
    expect(journal.lines[0].accountCode).toBe(accountCode);
  });
});

describe("expense posting", () => {
  it("posts professional fees and VAT to employee reimbursement payable", () => {
    const journal = createExpenseJournal({
      id: "expense-1",
      date: "2026-07-07",
      merchant: "Accountants LLP",
      category: "Professional fees",
      net: 200,
      vat: 40,
      gross: 240
    });
    expect(journal.lines).toEqual([
      expect.objectContaining({ accountCode: "5400", debit: 200, credit: 0 }),
      expect.objectContaining({ accountCode: "1200", debit: 40, credit: 0 }),
      expect.objectContaining({ accountCode: "2200", debit: 0, credit: 240 })
    ]);
  });

  it("supports a non-VAT general expense", () => {
    const journal = createExpenseJournal({
      id: "expense-2",
      date: "2026-07-08",
      merchant: "Local Shop",
      category: "Meals",
      net: 25,
      gross: 25
    });
    expect(journal.lines.map(line => line.accountCode)).toEqual(["5000", "2200"]);
  });
});

describe("mileage posting", () => {
  it("posts the calculated claim amount without VAT", () => {
    const journal = createMileageJournal({
      id: "mileage-1",
      date: "2026-07-09",
      from: "Leeds",
      to: "York",
      miles: 100,
      ratePerMile: 0.45,
      amount: 45
    });
    expect(journal.lines).toEqual([
      expect.objectContaining({ accountCode: "5200", debit: 45, credit: 0 }),
      expect.objectContaining({ accountCode: "2200", debit: 0, credit: 45 })
    ]);
    expect(journal.lines.some(line => ["1200", "2100"].includes(line.accountCode))).toBe(false);
  });

  it("calculates the claim when only miles and rate are supplied", () => {
    const journal = createMileageJournal({
      id: "mileage-2",
      date: "2026-07-10",
      miles: 12.5,
      ratePerMile: 0.45
    });
    expect(journal.lines[0].debit).toBe(5.63);
  });

  it("rejects a stored claim that disagrees with miles multiplied by rate", () => {
    expect(() => createMileageJournal({
      id: "mileage-bad",
      date: "2026-07-10",
      miles: 10,
      ratePerMile: 0.45,
      amount: 5
    })).toThrow("does not equal miles multiplied by rate");
  });
});

describe("journal reversal", () => {
  it("swaps debits and credits, retains the reference, and does not mutate the original", () => {
    const original = createSalesInvoiceJournal({
      id: "invoice-reverse",
      invoiceNo: "INV-REV",
      client: "Customer",
      date: "2026-07-11",
      amount: 100,
      vat: 20,
      total: 120
    });
    const snapshot = structuredClone(original);
    const reversal = reverseJournal(original);

    expect(reversal.reversesJournalId).toBe(original.id);
    expect(reversal.description).toBe(`Reversal: ${original.description}`);
    expect(reversal.lines[0].debit).toBe(original.lines[0].credit);
    expect(reversal.lines[0].credit).toBe(original.lines[0].debit);
    expect(validateJournal(reversal).valid).toBe(true);
    expect(original).toEqual(snapshot);
  });

  it("refuses to reverse an invalid journal", () => {
    expect(() => reverseJournal(basicJournal({ lines: [] })))
      .toThrow("Cannot reverse an invalid journal");
  });
});

describe("trial balance", () => {
  it("aggregates account balances, sorts account codes, and remains balanced", () => {
    const invoice = createSalesInvoiceJournal({
      id: "tb-invoice",
      date: "2026-07-12",
      amount: 100,
      vat: 20,
      total: 120
    });
    const bill = createBillJournal({
      id: "tb-bill",
      billDate: "2026-07-13",
      category: "Utilities",
      net: 50,
      vat: 10,
      total: 60
    });
    const trialBalance = buildTrialBalance([invoice, bill]);

    expect(trialBalance.accounts.map(account => account.accountCode))
      .toEqual(["1100", "1200", "2000", "2100", "4000", "5300"]);
    expect(trialBalance.accounts.find(account => account.accountCode === "1100"))
      .toEqual(expect.objectContaining({ debitBalance: 120, creditBalance: 0 }));
    expect(trialBalance.totalDebits).toBe(180);
    expect(trialBalance.totalCredits).toBe(180);
    expect(trialBalance.balanced).toBe(true);
  });

  it("returns an empty balanced trial balance", () => {
    expect(buildTrialBalance([])).toEqual({
      accounts: [], totalDebits: 0, totalCredits: 0, balanced: true
    });
  });

  it("rejects invalid journals rather than silently including them", () => {
    expect(() => buildTrialBalance([basicJournal({ lines: [] })]))
      .toThrow("Journal 1 is invalid");
  });
});

describe("account ledger", () => {
  it("sorts entries chronologically and calculates debit running balances", () => {
    const later = createSalesInvoiceJournal({
      id: "later",
      date: "2026-07-20",
      amount: 100,
      total: 100
    });
    const earlier = createSalesInvoiceJournal({
      id: "earlier",
      date: "2026-07-10",
      amount: 50,
      total: 50
    });
    const ledger = buildAccountLedger([later, earlier], "1100");

    expect(ledger.account.name).toBe("Trade Receivables");
    expect(ledger.entries.map(entry => entry.journalReference))
      .toEqual(["sales-invoice:earlier", "sales-invoice:later"]);
    expect(ledger.entries.map(entry => entry.runningBalance)).toEqual([50, 150]);
    expect(ledger.closingBalance).toBe(150);
  });

  it("calculates credit balances as negative running balances", () => {
    const invoice = createSalesInvoiceJournal({
      id: "credit-ledger",
      date: "2026-07-15",
      amount: 80,
      total: 80
    });
    const ledger = buildAccountLedger([invoice], "4000");
    expect(ledger.entries[0]).toEqual(expect.objectContaining({
      debit: 0,
      credit: 80,
      runningBalance: -80
    }));
  });

  it("rejects an unknown account code", () => {
    expect(() => buildAccountLedger([], "9999")).toThrow("valid account code");
  });
});

describe("duplicate source protection", () => {
  it("detects a journal with the same source type and source id", () => {
    const journals = [basicJournal()];
    expect(hasJournalForSource(journals, "test", "source-1")).toBe(true);
    expect(hasJournalForSource(journals, "test", "different")).toBe(false);
    expect(hasJournalForSource(journals, "bill", "source-1")).toBe(false);
  });
});
