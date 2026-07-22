import { normaliseInvoiceDate, roundMoney } from "./business-logic.js";

export const DEFAULT_CHART_OF_ACCOUNTS = Object.freeze([
  Object.freeze({ code: "1000", name: "Bank", type: "Asset" }),
  Object.freeze({ code: "1100", name: "Trade Receivables", type: "Asset" }),
  Object.freeze({ code: "1200", name: "VAT Input", type: "Asset" }),
  Object.freeze({ code: "2000", name: "Trade Payables", type: "Liability" }),
  Object.freeze({ code: "2100", name: "VAT Output", type: "Liability" }),
  Object.freeze({ code: "2200", name: "Employee Reimbursements Payable", type: "Liability" }),
  Object.freeze({ code: "3000", name: "Owner's Equity", type: "Equity" }),
  Object.freeze({ code: "4000", name: "Sales Revenue", type: "Income" }),
  Object.freeze({ code: "5000", name: "General Expenses", type: "Expense" }),
  Object.freeze({ code: "5200", name: "Travel & Mileage", type: "Expense" }),
  Object.freeze({ code: "5300", name: "Utilities", type: "Expense" }),
  Object.freeze({ code: "5400", name: "Professional Fees", type: "Expense" }),
  Object.freeze({ code: "5500", name: "Software & Subscriptions", type: "Expense" })
]);

const ACCOUNT_BY_CODE = new Map(
  DEFAULT_CHART_OF_ACCOUNTS.map(account => [account.code, account])
);

const EXPENSE_ACCOUNT_BY_CATEGORY = Object.freeze({
  travel: "5200",
  mileage: "5200",
  utilities: "5300",
  utility: "5300",
  "professional fees": "5400",
  professional: "5400",
  accounting: "5400",
  legal: "5400",
  software: "5500",
  "software/subscriptions": "5500",
  subscriptions: "5500",
  subscription: "5500",
  "travel/mileage": "5200"
});

function firstPresent(source, fields) {
  for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return null;
}

function readMoney(source, fields, label, required = false) {
  const rawValue = firstPresent(source, fields);

  if (rawValue === null) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite, non-negative number.`);
  }

  return roundMoney(value);
}

function requirePositiveMoney(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return roundMoney(value);
}

function sourceDate(source, fields) {
  const rawDate = firstPresent(source, fields);
  const date = normaliseInvoiceDate(rawDate).inputValue;

  if (!date) throw new Error("A valid transaction date is required.");
  return date;
}

function sourceReference(source, fields, label) {
  const reference = firstPresent(source, fields);
  return reference === null ? label : String(reference);
}

function amountFromNetVatTotal(source, options) {
  const net = requirePositiveMoney(
    readMoney(source, options.netFields, options.netLabel, true),
    options.netLabel
  );
  let vat = readMoney(source, options.vatFields, options.vatLabel);

  if (vat === null) {
    const rawRate = firstPresent(source, options.vatRateFields);
    const vatRate = rawRate === null ? 0 : Number(rawRate);

    if (!Number.isFinite(vatRate) || vatRate < 0) {
      throw new Error("VAT rate must be a finite, non-negative number.");
    }

    vat = roundMoney(net * vatRate);
  }

  const calculatedTotal = roundMoney(net + vat);
  const suppliedTotal = readMoney(source, options.totalFields, options.totalLabel);
  const total = suppliedTotal === null ? calculatedTotal : suppliedTotal;

  if (total !== calculatedTotal) {
    throw new Error(
      `${options.totalLabel} does not equal net plus VAT; no journal was created.`
    );
  }

  return { net, vat, total };
}

function expenseAccountCode(category) {
  const key = String(category || "").trim().toLowerCase();
  return EXPENSE_ACCOUNT_BY_CATEGORY[key] || "5000";
}

function journalLine(accountCode, description, debit = 0, credit = 0) {
  return {
    accountCode,
    description,
    debit: roundMoney(debit),
    credit: roundMoney(credit)
  };
}

function finishJournal(journal) {
  const validation = validateJournal(journal);

  if (!validation.valid) {
    throw new Error(`Invalid journal: ${validation.errors.join(" ")}`);
  }

  return journal;
}

function hasTwoDecimalPlaces(value) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

export function validateJournal(journal) {
  const errors = [];
  let totalDebits = 0;
  let totalCredits = 0;

  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return {
      valid: false,
      errors: ["Journal is required."],
      totalDebits: 0,
      totalCredits: 0
    };
  }

  if (!journal.date) errors.push("Journal date is required.");

  if (!Array.isArray(journal.lines) || journal.lines.length < 2) {
    errors.push("Journal must contain at least two lines.");
  }

  if (Array.isArray(journal.lines)) {
    journal.lines.forEach((line, index) => {
      const label = `Line ${index + 1}`;
      const accountCode = String(line?.accountCode || "");

      if (!ACCOUNT_BY_CODE.has(accountCode)) {
        errors.push(`${label} has an invalid account code.`);
      }

      const debit = Number(line?.debit ?? 0);
      const credit = Number(line?.credit ?? 0);

      if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
        errors.push(`${label} debit and credit must be finite numbers.`);
        return;
      }

      if (debit < 0 || credit < 0) {
        errors.push(`${label} debit and credit cannot be negative.`);
      }

      if (!hasTwoDecimalPlaces(debit) || !hasTwoDecimalPlaces(credit)) {
        errors.push(`${label} monetary values must have no more than two decimal places.`);
      }

      if (debit > 0 && credit > 0) {
        errors.push(`${label} cannot contain both a debit and a credit.`);
      }

      if (debit === 0 && credit === 0) {
        errors.push(`${label} must contain a non-zero debit or credit.`);
      }

      totalDebits += debit;
      totalCredits += credit;
    });
  }

  totalDebits = roundMoney(totalDebits);
  totalCredits = roundMoney(totalCredits);

  if (totalDebits !== totalCredits) {
    errors.push("Journal debits and credits must balance.");
  }

  return {
    valid: errors.length === 0,
    errors,
    totalDebits,
    totalCredits
  };
}

export function createSalesInvoiceJournal(invoice) {
  if (!invoice || typeof invoice !== "object") {
    throw new Error("Sales invoice is required.");
  }

  const sourceId = sourceReference(invoice, ["id", "invoiceNo"], "invoice");
  const invoiceNumber = sourceReference(invoice, ["invoiceNo", "id"], sourceId);
  const clientName = sourceReference(invoice, ["client", "clientName"], "customer");
  const activeItems = [];

  if (Array.isArray(invoice.items)) {
    invoice.items.forEach((item, index) => {
      const description = String(item?.description || "").trim();
      if (!description) return;

      const amount = readMoney(item, ["amount"], `Invoice line ${index + 1} amount`, true);
      if (amount === 0) return;
      activeItems.push({ description, amount });
    });
  }

  let net;

  if (activeItems.length) {
    net = roundMoney(activeItems.reduce((sum, item) => sum + item.amount, 0));
    const suppliedNet = readMoney(invoice, ["amount", "net", "netAmount"], "Invoice net");

    if (suppliedNet !== null && suppliedNet !== net) {
      throw new Error("Invoice net does not equal its line-item total; no journal was created.");
    }
  } else {
    net = requirePositiveMoney(
      readMoney(invoice, ["amount", "net", "netAmount"], "Invoice net", true),
      "Invoice net"
    );
  }

  const values = amountFromNetVatTotal(
    { ...invoice, amount: net },
    {
      netFields: ["amount"],
      vatFields: ["vat", "vatAmount"],
      vatRateFields: ["vatRate"],
      totalFields: ["total", "gross", "grossAmount"],
      netLabel: "Invoice net",
      vatLabel: "Invoice VAT",
      totalLabel: "Invoice total"
    }
  );
  const description = `Sales invoice ${invoiceNumber} - ${clientName}`;
  const revenueLines = activeItems.length
    ? activeItems.map(item => journalLine("4000", item.description, 0, item.amount))
    : [journalLine("4000", description, 0, values.net)];
  const lines = [
    journalLine("1100", description, values.total, 0),
    ...revenueLines
  ];

  if (values.vat > 0) {
    lines.push(journalLine("2100", `VAT on invoice ${invoiceNumber}`, 0, values.vat));
  }

  return finishJournal({
    id: `sales-invoice:${sourceId}`,
    date: sourceDate(invoice, ["date", "invoiceDate"]),
    sourceType: "salesInvoice",
    sourceId,
    description,
    lines
  });
}

export function createBillJournal(bill) {
  if (!bill || typeof bill !== "object") throw new Error("Supplier bill is required.");

  const sourceId = sourceReference(bill, ["id", "billNumber"], "bill");
  const billNumber = sourceReference(bill, ["billNumber", "id"], sourceId);
  const supplier = sourceReference(bill, ["supplier", "merchant"], "supplier");
  const values = amountFromNetVatTotal(bill, {
    netFields: ["net", "netAmount", "amount"],
    vatFields: ["vat", "vatAmount"],
    vatRateFields: ["vatRate"],
    totalFields: ["total", "totalAmount", "gross"],
    netLabel: "Bill net",
    vatLabel: "Bill VAT",
    totalLabel: "Bill total"
  });
  const accountCode = expenseAccountCode(bill.category);
  const description = `Supplier bill ${billNumber} - ${supplier}`;
  const lines = [journalLine(accountCode, description, values.net, 0)];

  if (values.vat > 0) {
    lines.push(journalLine("1200", `VAT on bill ${billNumber}`, values.vat, 0));
  }

  lines.push(journalLine("2000", description, 0, values.total));

  return finishJournal({
    id: `bill:${sourceId}`,
    date: sourceDate(bill, ["billDate", "date", "invoiceDate"]),
    sourceType: "supplierBill",
    sourceId,
    description,
    lines
  });
}

export function createExpenseJournal(expense) {
  if (!expense || typeof expense !== "object") throw new Error("Expense is required.");

  const sourceId = sourceReference(expense, ["id", "expenseId"], "expense");
  const merchant = sourceReference(expense, ["merchant", "supplier"], "expense");
  const values = amountFromNetVatTotal(expense, {
    netFields: ["net", "netAmount"],
    vatFields: ["vat", "vatAmount"],
    vatRateFields: ["vatRate"],
    totalFields: ["gross", "grossAmount", "total"],
    netLabel: "Expense net",
    vatLabel: "Expense VAT",
    totalLabel: "Expense gross"
  });
  const accountCode = expenseAccountCode(expense.category);
  const description = `Expense ${sourceId} - ${merchant}`;
  const lines = [journalLine(accountCode, description, values.net, 0)];

  if (values.vat > 0) {
    lines.push(journalLine("1200", `VAT on expense ${sourceId}`, values.vat, 0));
  }

  lines.push(journalLine("2200", description, 0, values.total));

  return finishJournal({
    id: `expense:${sourceId}`,
    date: sourceDate(expense, ["date", "expenseDate"]),
    sourceType: "expense",
    sourceId,
    description,
    lines
  });
}

export function createMileageJournal(mileage) {
  if (!mileage || typeof mileage !== "object") throw new Error("Mileage claim is required.");

  const sourceId = sourceReference(mileage, ["id", "mileageId"], "mileage");
  const suppliedAmount = readMoney(
    mileage,
    ["amount", "mileageAmount", "gross", "claimAmount", "total"],
    "Mileage claim amount"
  );
  const miles = readMoney(mileage, ["miles", "claimMiles"], "Mileage miles");
  const rate = readMoney(mileage, ["ratePerMile", "mileageRate"], "Mileage rate");
  const calculatedAmount = miles !== null && rate !== null
    ? roundMoney(miles * rate)
    : null;
  const amount = requirePositiveMoney(
    suppliedAmount ?? calculatedAmount,
    "Mileage claim amount"
  );

  if (suppliedAmount !== null && calculatedAmount !== null && suppliedAmount !== calculatedAmount) {
    throw new Error("Mileage claim amount does not equal miles multiplied by rate.");
  }

  const route = [mileage.from, mileage.to].filter(Boolean).join(" to ");
  const description = route
    ? `Mileage claim ${sourceId} - ${route}`
    : `Mileage claim ${sourceId}`;

  return finishJournal({
    id: `mileage:${sourceId}`,
    date: sourceDate(mileage, ["date", "mileageDate"]),
    sourceType: "mileage",
    sourceId,
    description,
    lines: [
      journalLine("5200", description, amount, 0),
      journalLine("2200", description, 0, amount)
    ]
  });
}

export function reverseJournal(originalJournal) {
  const originalValidation = validateJournal(originalJournal);

  if (!originalValidation.valid) {
    throw new Error(`Cannot reverse an invalid journal: ${originalValidation.errors.join(" ")}`);
  }

  const reversal = {
    id: `reversal:${originalJournal.id || originalJournal.sourceId || "journal"}`,
    date: originalJournal.date,
    sourceType: "journalReversal",
    sourceId: String(originalJournal.id || originalJournal.sourceId || "journal"),
    reversesJournalId: originalJournal.id || "",
    description: `Reversal: ${originalJournal.description || originalJournal.id || "journal"}`,
    lines: originalJournal.lines.map(line => ({
      accountCode: line.accountCode,
      description: `Reversal: ${line.description || originalJournal.description || "journal line"}`,
      debit: line.credit,
      credit: line.debit
    }))
  };

  return finishJournal(reversal);
}

function requireValidJournals(journals) {
  if (!Array.isArray(journals)) throw new Error("Journals must be an array.");

  journals.forEach((journal, index) => {
    const validation = validateJournal(journal);
    if (!validation.valid) {
      throw new Error(`Journal ${index + 1} is invalid: ${validation.errors.join(" ")}`);
    }
  });
}

export function buildTrialBalance(journals = []) {
  requireValidJournals(journals);
  const totalsByAccount = new Map();

  journals.forEach(journal => {
    journal.lines.forEach(line => {
      const totals = totalsByAccount.get(line.accountCode) || { debits: 0, credits: 0 };
      totals.debits = roundMoney(totals.debits + line.debit);
      totals.credits = roundMoney(totals.credits + line.credit);
      totalsByAccount.set(line.accountCode, totals);
    });
  });

  const accounts = [...totalsByAccount.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([accountCode, totals]) => {
      const account = ACCOUNT_BY_CODE.get(accountCode);
      const balance = roundMoney(totals.debits - totals.credits);

      return {
        accountCode,
        accountName: account.name,
        accountType: account.type,
        debits: totals.debits,
        credits: totals.credits,
        balance,
        debitBalance: balance > 0 ? balance : 0,
        creditBalance: balance < 0 ? roundMoney(-balance) : 0
      };
    });
  const totalDebits = roundMoney(
    accounts.reduce((sum, account) => sum + account.debitBalance, 0)
  );
  const totalCredits = roundMoney(
    accounts.reduce((sum, account) => sum + account.creditBalance, 0)
  );

  return {
    accounts,
    totalDebits,
    totalCredits,
    balanced: totalDebits === totalCredits
  };
}

export function buildAccountLedger(journals = [], accountCode) {
  requireValidJournals(journals);
  const code = String(accountCode || "");

  if (!ACCOUNT_BY_CODE.has(code)) throw new Error("A valid account code is required.");

  const entries = [];
  let sequence = 0;

  journals.forEach(journal => {
    journal.lines.forEach(line => {
      if (line.accountCode !== code) return;

      entries.push({
        date: journal.date,
        debit: line.debit,
        credit: line.credit,
        journalReference: journal.id || journal.sourceId || "",
        sourceType: journal.sourceType || "",
        sourceId: journal.sourceId || "",
        description: line.description || journal.description || "",
        sequence: sequence++
      });
    });
  });

  entries.sort((left, right) => {
    const leftDate = normaliseInvoiceDate(left.date).inputValue || String(left.date);
    const rightDate = normaliseInvoiceDate(right.date).inputValue || String(right.date);
    return leftDate.localeCompare(rightDate) || left.sequence - right.sequence;
  });

  let runningBalance = 0;
  const ledgerEntries = entries.map(({ sequence: _sequence, ...entry }) => {
    runningBalance = roundMoney(runningBalance + entry.debit - entry.credit);
    return { ...entry, runningBalance };
  });

  return {
    account: { ...ACCOUNT_BY_CODE.get(code) },
    entries: ledgerEntries,
    closingBalance: runningBalance
  };
}

export function hasJournalForSource(journals, sourceType, sourceId) {
  if (!Array.isArray(journals)) return false;

  return journals.some(journal =>
    String(journal?.sourceType || "") === String(sourceType || "") &&
    String(journal?.sourceId || "") === String(sourceId || "")
  );
}
