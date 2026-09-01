import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import { preflightCanonicalWorkbook } from "../resources/js/canonical-workbook-preflight.js";
import {
  createFirestorePhase4BPersistence,
  executePhase4B,
  planPhase4BExecution
} from "../resources/js/canonical-workbook-phase4b.js";
import {
  prepareBankSettlementJournal,
  prepareBillJournal,
  prepareExpenseJournal,
  prepareInvoiceJournal,
  prepareMileageJournal
} from "../resources/js/ledger-firestore.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";

const DATA_SHEETS = CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored);
const USER_ID = "user-1";

function schemaSheet(name) {
  return DATA_SHEETS.find(sheet => sheet.name === name);
}

function row(name, values = {}) {
  return schemaSheet(name).columns.map(column => values[column.header] ?? "");
}

function canonicalWorkbook(sheetRows = {}) {
  return {
    SheetNames: CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => sheet.name),
    Sheets: Object.fromEntries(CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => [
      sheet.name,
      sheet.name === "Summary"
        ? [["Simple Books Workbook"], ["Workbook schema", "Version 1"]]
        : [sheet.columns.map(column => column.header), ...(sheetRows[sheet.name] || [])]
    ]))
  };
}

function checked(sheetRows = {}, options = {}) {
  return preflightCanonicalWorkbook(canonicalWorkbook(sheetRows), {
    existing: {}, plan: "Pro", ...options
  });
}

function client(overrides = {}) {
  return row("Clients", {
    "Client Name": "Acme Ltd",
    Email: "accounts@acme.test",
    Address: "1 High Street",
    "Payment Terms": "14 days",
    Status: "Lead",
    ...overrides
  });
}

function project(overrides = {}) {
  return row("Projects", {
    "Project Reference": "P-1", "Project Name": "Project One",
    "Client Name": "Acme Ltd", Status: "Active", ...overrides
  });
}

function budget(overrides = {}) {
  return row("Budgets", {
    "Budget Name": "Monthly", "Period Type": "Monthly",
    "Start Date": "2026-08-01", "End Date": "2026-08-31",
    "Budget Type": "Overall", "Project Reference": "P-1",
    "Planned Amount": 500, Status: "Active", ...overrides
  });
}

function invoice(overrides = {}) {
  return row("Invoices", {
    "Invoice Number": "INV-1", "Client Name": "Acme Ltd",
    "Invoice Date": "2026-08-20", "Payment Terms": "14 days",
    "Due Date": "2026-09-03", "Project Reference": "P-1",
    "VAT Rate": 0.2, Status: "Unpaid", Recurring: "No", ...overrides
  });
}

function invoiceItem(lineNumber = 1, overrides = {}) {
  return row("Invoice Items", {
    "Invoice Number": "INV-1", "Line Number": lineNumber,
    Description: `Service ${lineNumber}`, "Net Amount": 100, ...overrides
  });
}

function bill(overrides = {}) {
  return row("Bills", {
    Supplier: "Supplier Ltd", "Bill Number": "B-1", "Bill Date": "2026-08-20",
    "Due Date": "2026-09-03", Category: "Utilities", "Project Reference": "P-1",
    Net: 100, "VAT Rate": 0.2, VAT: 20, Total: 120, Status: "Unpaid", ...overrides
  });
}

function expense(overrides = {}) {
  return row("Expenses", {
    Date: "2026-08-20", Merchant: "Shop", Category: "Office",
    Description: "Supplies", "Project Reference": "P-1",
    Net: 100, "VAT Rate": 0.2, VAT: 17, Gross: 117,
    Status: "Draft", ...overrides
  });
}

function mileage(overrides = {}) {
  return row("Mileage", {
    Date: "2026-08-20", From: "Office", To: "Client",
    "Business Purpose": "Meeting", "Project Reference": "P-1",
    Miles: 10, "Rate Per Mile": 0.55, Amount: 5.5,
    Status: "Draft", ...overrides
  });
}

function accountingRows(overrides = {}) {
  return {
    Clients: [client()],
    Projects: [project()],
    Budgets: [budget()],
    Invoices: [invoice(overrides.invoice)],
    "Invoice Items": [invoiceItem(1, overrides.item)],
    Bills: [bill(overrides.bill)],
    Expenses: [expense(overrides.expense)],
    Mileage: [mileage(overrides.mileage)]
  };
}

function clone(value) {
  return structuredClone(value);
}

function memoryPersistence(initial = {}, behavior = {}) {
  const state = {
    clients: clone(initial.clients || []),
    customers: clone(initial.customers || []),
    projects: clone(initial.projects || []),
    budgets: clone(initial.budgets || []),
    invoices: clone(initial.invoices || []),
    bills: clone(initial.bills || []),
    expenses: clone(initial.expenses || []),
    mileage: clone(initial.mileage || []),
    journals: clone(initial.journals || []),
    plan: initial.plan ?? "Pro",
    demoMode: initial.demoMode === true
  };
  const next = { clients: 1, customers: 1, projects: 1, budgets: 1, invoices: 1, bills: 1, expenses: 1, mileage: 1 };
  const calls = [];
  const now = "2026-08-26T12:00:00.000Z";

  function addAccounting(moduleName, payload, prepare) {
    calls.push(moduleName);
    if(behavior.failModule === moduleName) throw new Error(`${moduleName} atomic persistence failed`);
    const singular = moduleName === "mileage" ? "mileage" : moduleName.slice(0, -1);
    const id = `${singular}-${next[moduleName]++}`;
    const source = { id, ...clone(payload), createdAt: now, updatedAt: "" };
    const journal = prepare(USER_ID, id, source, { createdAt: now, updatedAt: now });
    state[moduleName].push(source);
    state.journals.push({ id: journal.journalId, ...journal });
    return { id, journalId: journal.journalId };
  }

  const persistence = {
    readExecutionContext: vi.fn(async () => clone(state)),
    ensureClientRepresentations: vi.fn(async operation => {
      calls.push("clients");
      if(behavior.failModule === "clients") throw new Error("clients batch failed");
      let clientId = operation.client.existingId;
      let customerId = operation.customer.existingId;
      if(operation.client.action === "create"){
        clientId = `client-${next.clients++}`;
        state.clients.push({ id: clientId, ...clone(operation.client.payload) });
      }
      if(operation.customer.action === "create"){
        customerId = `customer-${next.customers++}`;
        state.customers.push({ id: customerId, ...clone(operation.customer.payload) });
      }
      return { clientId, customerId };
    }),
    createProject: vi.fn(async payload => {
      calls.push("projects");
      if(behavior.failModule === "projects") throw new Error("projects persistence failed");
      const record = { id: `project-${next.projects++}`, ...clone(payload) };
      state.projects.push(record);
      return record;
    }),
    createBudget: vi.fn(async payload => {
      calls.push("budgets");
      if(behavior.failModule === "budgets") throw new Error("budgets persistence failed");
      const record = { id: `budget-${next.budgets++}`, ...clone(payload) };
      state.budgets.push(record);
      return record;
    }),
    createInvoiceAccounting: vi.fn(async payload =>
      addAccounting("invoices", payload, prepareInvoiceJournal)),
    createBillAccounting: vi.fn(async payload =>
      addAccounting("bills", payload, prepareBillJournal)),
    createExpenseAccounting: vi.fn(async payload =>
      addAccounting("expenses", payload, prepareExpenseJournal)),
    createMileageAccounting: vi.fn(async payload =>
      addAccounting("mileage", payload, prepareMileageJournal))
  };
  return { persistence, state, calls };
}

function balanced(journal) {
  const debit = journal.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = journal.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  return Math.round(debit * 100) === Math.round(credit * 100);
}

function accountBalance(journals, accountCode) {
  return buildTrialBalance(journals).accounts.find(account => account.accountCode === accountCode)?.balance ?? 0;
}

describe("canonical workbook Phase 4B execution", () => {
  it("does not let accounting execution bypass trusted safe preflight", async () => {
    const memory = memoryPersistence();
    const result = await executePhase4B({ safeToProceed: true, records: {} }, {
      persistence: memory.persistence
    });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "untrusted-preflight" }));
    expect(memory.persistence.readExecutionContext).not.toHaveBeenCalled();
  });

  it("prevents every write when a predictable accounting conflict exists", async () => {
    const existing = {
      id: "invoice-old", invoiceNo: "INV-1", client: "Different Client",
      date: "2026-08-20", amount: 100, vat: 20, total: 120,
      items: [{ description: "Service 1", amount: 100 }], status: "Unpaid"
    };
    const memory = memoryPersistence({ invoices: [existing] });
    const result = await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "invoices-details-conflict" }));
    expect(memory.calls).toEqual([]);
  });

  it("executes the complete approved module order", async () => {
    const memory = memoryPersistence();
    const result = await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    expect(result.success).toBe(true);
    expect(memory.calls).toEqual([
      "clients", "projects", "budgets", "invoices", "bills", "expenses", "mileage"
    ]);
    expect(result.modulesAttempted).toEqual(memory.calls);
    expect(result.created).toEqual({
      clients: 1, projects: 1, budgets: 1, invoices: 1, bills: 1, expenses: 1, mileage: 1
    });
  });

  it("resolves invoice Client and Project relationships created by the same workbook", async () => {
    const memory = memoryPersistence();
    await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    expect(memory.persistence.createInvoiceAccounting).toHaveBeenCalledWith(
      expect.objectContaining({
        client: "Acme Ltd", clientEmail: "accounts@acme.test",
        clientAddress: "1 High Street", projectId: "project-1", projectReference: "P-1"
      }),
      expect.any(Object)
    );
  });

  it("resolves an invoice through an existing Customer and existing Project", async () => {
    const customer = { id: "customer-9", name: "Acme Ltd", email: "a@acme.test", address: "2 Road" };
    const projectRecord = { id: "project-9", reference: "P-1", name: "Existing Project", status: "Active" };
    const rows = {
      Invoices: [invoice()],
      "Invoice Items": [invoiceItem()]
    };
    const preflight = checked(rows, { existing: { clients: [customer], projects: [projectRecord] } });
    const memory = memoryPersistence({ customers: [customer], projects: [projectRecord] });
    await executePhase4B(preflight, { persistence: memory.persistence });
    expect(memory.persistence.createInvoiceAccounting).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEmail: "a@acme.test", clientAddress: "2 Road",
        projectId: "project-9", projectReference: "P-1"
      }),
      expect.any(Object)
    );
  });

  it("preserves invoice items inside the invoice source and its revenue journal", async () => {
    const rows = accountingRows();
    rows["Invoice Items"] = [
      invoiceItem(1, { Description: "Consulting", "Net Amount": 60 }),
      invoiceItem(2, { Description: "Bookkeeping", "Net Amount": 40 })
    ];
    const memory = memoryPersistence();
    await executePhase4B(checked(rows), { persistence: memory.persistence });
    expect(memory.state.invoices[0].items).toEqual([
      { description: "Consulting", amount: 60 },
      { description: "Bookkeeping", amount: 40 }
    ]);
    expect(memory.state.journals.find(item => item.sourceType === "salesInvoice").lines)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ accountCode: "4000", description: "Consulting", credit: 60 }),
        expect.objectContaining({ accountCode: "4000", description: "Bookkeeping", credit: 40 })
      ]));
  });

  it("posts the actual Unpaid Invoice and Bill accounting positions", async () => {
    const memory = memoryPersistence();
    const rows = {
      Clients: [client()],
      Invoices: [invoice({ "Project Reference": "" })],
      "Invoice Items": [invoiceItem()],
      Bills: [bill({ "Project Reference": "" })]
    };
    const result = await executePhase4B(checked(rows), { persistence: memory.persistence });
    expect(result.success).toBe(true);
    expect(memory.state.invoices[0]).toMatchObject({ status: "Unpaid", total: 120 });
    expect(memory.state.bills[0]).toMatchObject({ status: "Unpaid", total: 120 });
    expect(memory.state.invoices[0]).not.toHaveProperty("paidAt");
    expect(memory.state.bills[0]).not.toHaveProperty("paidAt");
    expect(accountBalance(memory.state.journals, "1100")).toBe(120);
    expect(accountBalance(memory.state.journals, "2000")).toBe(-120);
    expect(buildTrialBalance(memory.state.journals).balanced).toBe(true);
  });

  it.each([
    ["Invoice", "invoices", { Clients: [client()], Invoices: [invoice({ Status: "Paid", "Project Reference": "" })], "Invoice Items": [invoiceItem()] }],
    ["Bill", "bills", { Bills: [bill({ Status: "Paid", "Project Reference": "" })] }]
  ])("stops a new Paid %s before all writes because payment history is absent", async (_label, moduleName, rows) => {
    const memory = memoryPersistence();
    const preflight = checked(rows);
    const first = await executePhase4B(preflight, { persistence: memory.persistence });
    const retry = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(first.errors).toContainEqual(expect.objectContaining({
      code: "paid-accounting-history-required", module: moduleName
    }));
    expect(retry.errors).toContainEqual(expect.objectContaining({
      code: "paid-accounting-history-required", module: moduleName
    }));
    expect(memory.calls).toEqual([]);
    expect(memory.state[moduleName]).toEqual([]);
    expect(memory.state.journals).toEqual([]);
  });

  it("skips an exact existing Paid Invoice only when its Banking clearing journal is valid", async () => {
    const unpaidRows = {
      Clients: [client()],
      Invoices: [invoice({ "Project Reference": "" })],
      "Invoice Items": [invoiceItem()]
    };
    const paidRows = {
      ...unpaidRows,
      Invoices: [invoice({ Status: "Paid", "Project Reference": "" })]
    };
    const memory = memoryPersistence();
    await executePhase4B(checked(unpaidRows), { persistence: memory.persistence });
    const source = memory.state.invoices[0];
    source.status = "Paid";
    source.bankSettlement = {
      version: 1, transactionId: "bank-1",
      journalId: `bank-settlement_${USER_ID}_bank-1`
    };
    const settlement = prepareBankSettlementJournal(USER_ID, "bank-1", {
      transactionDate: "2026-08-21", bankAccountId: "account-1",
      recordType: "invoice", recordId: source.id, amount: source.total
    }, { createdAt: "2026-08-26T12:00:00.000Z", updatedAt: "2026-08-26T12:00:00.000Z" });
    memory.state.journals.push({ id: settlement.journalId, ...settlement });

    const journalCount = memory.state.journals.length;
    const result = await executePhase4B(checked(paidRows), { persistence: memory.persistence });
    expect(result.success).toBe(true);
    expect(result.skipped.invoices).toBe(1);
    expect(memory.state.journals).toHaveLength(journalCount);
    expect(accountBalance(memory.state.journals, "1100")).toBe(0);
    expect(memory.state.journals.filter(item => item.sourceType === "bankSettlement")).toHaveLength(1);
  });

  it("refuses to treat a matching manual-status Paid Invoice as accounting-safe without a settlement", async () => {
    const unpaidRows = {
      Clients: [client()],
      Invoices: [invoice({ "Project Reference": "" })],
      "Invoice Items": [invoiceItem()]
    };
    const memory = memoryPersistence();
    await executePhase4B(checked(unpaidRows), { persistence: memory.persistence });
    memory.state.invoices[0].status = "Paid";
    const result = await executePhase4B(checked({
      ...unpaidRows,
      Invoices: [invoice({ Status: "Paid", "Project Reference": "" })]
    }), { persistence: memory.persistence });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "invoices-paid-settlement-integrity-conflict"
    }));
    expect(accountBalance(memory.state.journals, "1100")).toBe(120);
  });

  it("rejects a canonical invoice without required Invoice Items before writes", async () => {
    const preflight = checked({ Clients: [client()], Invoices: [invoice({ Net: 100, VAT: 20, Total: 120 })] });
    const memory = memoryPersistence();
    const result = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(preflight.errors).toContainEqual(expect.objectContaining({ code: "invoice-items-required" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "unsafe-preflight" }));
    expect(memory.calls).toEqual([]);
  });

  it("reconstructs one neutral line for a legacy invoice without historical detail", async () => {
    const legacy = {
      SheetNames: ["Clients", "Invoices", "Bills", "Expenses", "Mileage"],
      Sheets: {
        Clients: [["Client Name"], ["Acme Ltd"]],
        Invoices: [
          ["Invoice Number", "Client Name", "Invoice Date", "Net", "VAT Rate", "VAT", "Total", "Status"],
          ["INV-OLD", "Acme Ltd", "20/08/2026", 100, 0.2, 20, 120, "Unpaid"]
        ],
        Bills: [[]], Expenses: [[]], Mileage: [[]]
      }
    };
    const preflight = preflightCanonicalWorkbook(legacy, { existing: {}, plan: "Pro" });
    const memory = memoryPersistence();
    const result = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(preflight.records.invoiceItems).toContainEqual(expect.objectContaining({
      description: "Imported legacy invoice", netAmount: 100
    }));
    expect(result.success).toBe(true);
    expect(result.fidelityWarnings).toContainEqual(expect.objectContaining({
      code: "legacy-invoice-item-synthesized"
    }));
    expect(memory.state.invoices[0].items).toEqual([
      { description: "Imported legacy invoice", amount: 100 }
    ]);
  });

  it("keeps the three-item invoice limit as a pre-write error", async () => {
    const rows = accountingRows();
    rows["Invoice Items"] = [1, 2, 3, 4].map(line => invoiceItem(line, { "Net Amount": 25 }));
    const preflight = checked(rows);
    const memory = memoryPersistence();
    await executePhase4B(preflight, { persistence: memory.persistence });
    expect(preflight.errors).toContainEqual(expect.objectContaining({ code: "invoice-item-limit" }));
    expect(memory.calls).toEqual([]);
  });

  it("skips an identical Invoice Number with its journal and retry adds neither artifact", async () => {
    const memory = memoryPersistence();
    const preflight = checked({ Clients: [client()], Projects: [project()], Invoices: [invoice()], "Invoice Items": [invoiceItem()] });
    const first = await executePhase4B(preflight, { persistence: memory.persistence });
    const second = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(first.created.invoices).toBe(1);
    expect(second.created.invoices).toBe(0);
    expect(second.skipped.invoices).toBe(1);
    expect(memory.state.invoices).toHaveLength(1);
    expect(memory.state.journals.filter(item => item.sourceType === "salesInvoice")).toHaveLength(1);
  });

  it("does not treat an identical source with a missing required journal as a safe skip", async () => {
    const existing = {
      id: "invoice-old", invoiceNo: "INV-1", client: "Acme Ltd", date: "2026-08-20",
      paymentTerms: "14 days", dueDate: "2026-09-03", amount: 100, vatRate: 0.2,
      vat: 20, total: 120, items: [{ description: "Service 1", amount: 100 }],
      status: "Unpaid", recurringInvoice: "No", recurringFrequency: "",
      nextInvoiceDate: "", reminderDate: "", projectReference: ""
    };
    const rows = {
      Invoices: [invoice({ "Project Reference": "" })],
      "Invoice Items": [invoiceItem()]
    };
    const customer = { id: "customer-9", name: "Acme Ltd" };
    const preflight = checked(rows, { existing: { clients: [customer] } });
    const memory = memoryPersistence({ customers: [customer], invoices: [existing] });
    const result = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(result.conflicts).toContainEqual(expect.objectContaining({
      code: "invoices-journal-integrity-conflict"
    }));
    expect(memory.calls).toEqual([]);
  });

  it("handles numbered and blank-number Bill duplicates conservatively", async () => {
    for(const billNumber of ["B-1", ""]){
      const rows = { Bills: [bill({ "Bill Number": billNumber, "Project Reference": "" })] };
      const preflight = checked(rows);
      const memory = memoryPersistence();
      await executePhase4B(preflight, { persistence: memory.persistence });
      const retry = await executePhase4B(preflight, { persistence: memory.persistence });
      expect(retry.skipped.bills).toBe(1);
      expect(memory.state.bills).toHaveLength(1);
      expect(memory.state.journals.filter(item => item.sourceType === "supplierBill")).toHaveLength(1);
    }
  });

  it("surfaces a same-identity Bill conflict without overwriting", async () => {
    const existing = {
      id: "bill-old", supplier: "Supplier Ltd", billNumber: "B-1", billDate: "2026-08-20",
      dueDate: "2026-09-03", category: "Utilities", net: 50, vatRate: 0.2, vat: 10,
      total: 60, status: "Unpaid", projectReference: ""
    };
    const preflight = checked({ Bills: [bill({ "Project Reference": "" })] });
    const memory = memoryPersistence({ bills: [existing] });
    const result = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "bills-details-conflict" }));
    expect(memory.state.bills).toEqual([existing]);
  });

  it("preserves accepted manual Expense VAT and creates the repository journal", async () => {
    const memory = memoryPersistence();
    const result = await executePhase4B(checked({ Expenses: [expense({ "Project Reference": "" })] }), {
      persistence: memory.persistence
    });
    expect(result.success).toBe(true);
    expect(memory.state.expenses[0]).toMatchObject({ net: 100, vatRate: 0.2, vat: 17, gross: 117 });
    const journal = memory.state.journals.find(item => item.sourceType === "expenseClaim");
    expect(journal.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "1200", debit: 17 }),
      expect.objectContaining({ accountCode: "2200", credit: 117 })
    ]));
  });

  it.each(["Draft", "Submitted", "Approved", "Paid"])(
    "imports an Expense in %s with the same accrued-liability journal as the application",
    async status => {
      const memory = memoryPersistence();
      const result = await executePhase4B(checked({
        Expenses: [expense({ Status: status, "Project Reference": "" })]
      }), { persistence: memory.persistence });
      expect(result.success).toBe(true);
      expect(memory.state.expenses[0].status).toBe(status);
      expect(memory.state.expenses[0]).not.toHaveProperty("paidAt");
      expect(memory.state.expenses[0]).not.toHaveProperty("bankSettlement");
      expect(memory.state.journals[0].lines.map(line => line.accountCode)).toEqual(["5000", "1200", "2200"]);
      expect(accountBalance(memory.state.journals, "2200")).toBe(-117);
      expect(buildTrialBalance(memory.state.journals).balanced).toBe(true);
    }
  );

  it("skips duplicate Expenses and conflicts on changed same-identity details", async () => {
    const preflight = checked({ Expenses: [expense({ "Project Reference": "" })] });
    const memory = memoryPersistence();
    await executePhase4B(preflight, { persistence: memory.persistence });
    expect((await executePhase4B(preflight, { persistence: memory.persistence })).skipped.expenses).toBe(1);
    memory.state.expenses[0].description = "Changed";
    const conflict = await executePhase4B(preflight, { persistence: memory.persistence });
    expect(conflict.conflicts).toContainEqual(expect.objectContaining({ code: "expenses-details-conflict" }));
  });

  it("preserves normalized Mileage rate/amount and skips its duplicate", async () => {
    const preflight = checked({ Mileage: [mileage({ "Project Reference": "", "Rate Per Mile": "" })] });
    const memory = memoryPersistence();
    await executePhase4B(preflight, { persistence: memory.persistence });
    expect(memory.state.mileage[0]).toMatchObject({ miles: 10, ratePerMile: 0.55, amount: 5.5 });
    expect((await executePhase4B(preflight, { persistence: memory.persistence })).skipped.mileage).toBe(1);
    expect(memory.state.journals.filter(item => item.sourceType === "mileageClaim")).toHaveLength(1);
  });

  it.each(["Draft", "Submitted", "Approved", "Paid"])(
    "imports Mileage in %s with the same accrued-liability journal as the application",
    async status => {
      const memory = memoryPersistence();
      const result = await executePhase4B(checked({
        Mileage: [mileage({ Status: status, "Project Reference": "" })]
      }), { persistence: memory.persistence });
      expect(result.success).toBe(true);
      expect(memory.state.mileage[0].status).toBe(status);
      expect(memory.state.mileage[0]).not.toHaveProperty("paidAt");
      expect(memory.state.mileage[0]).not.toHaveProperty("bankSettlement");
      expect(memory.state.journals[0].lines.map(line => line.accountCode)).toEqual(["5200", "2200"]);
      expect(accountBalance(memory.state.journals, "2200")).toBe(-5.5);
      expect(buildTrialBalance(memory.state.journals).balanced).toBe(true);
    }
  );

  it("accepts blank optional Project References for every accounting module", async () => {
    const rows = accountingRows({
      invoice: { "Project Reference": "" }, bill: { "Project Reference": "" },
      expense: { "Project Reference": "" }, mileage: { "Project Reference": "" }
    });
    rows.Projects = [];
    rows.Budgets = [];
    const memory = memoryPersistence();
    const result = await executePhase4B(checked(rows), { persistence: memory.persistence });
    expect(result.success).toBe(true);
    expect(memory.state.invoices[0].projectId).toBe("");
    expect(memory.state.bills[0].projectId).toBe("");
    expect(memory.state.expenses[0].projectId).toBe("");
    expect(memory.state.mileage[0].projectId).toBe("");
  });

  it("does not let invalid or disappeared relationships reach writes", async () => {
    const invalid = checked({ Expenses: [expense({ "Project Reference": "P-404" })] });
    const invalidMemory = memoryPersistence();
    await executePhase4B(invalid, { persistence: invalidMemory.persistence });
    expect(invalidMemory.calls).toEqual([]);

    const projectRecord = { id: "project-9", reference: "P-1", name: "Existing", status: "Active" };
    const stale = checked({ Expenses: [expense()] }, { existing: { projects: [projectRecord] } });
    const staleMemory = memoryPersistence();
    const result = await executePhase4B(stale, { persistence: staleMemory.persistence });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "missing-project-relationship" }));
    expect(staleMemory.calls).toEqual([]);
  });

  it("creates balanced repository-backed journals for every accounting source", async () => {
    const memory = memoryPersistence();
    await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    expect(memory.state.journals).toHaveLength(4);
    memory.state.journals.forEach(journal => expect(balanced(journal)).toBe(true));
    expect(memory.state.journals.map(item => item.sourceType)).toEqual([
      "salesInvoice", "supplierBill", "expenseClaim", "mileageClaim"
    ]);
  });

  it("does not report a source as created when its required journal unit fails", async () => {
    const memory = memoryPersistence({}, { failModule: "expenses" });
    const result = await executePhase4B(checked({ Expenses: [expense({ "Project Reference": "" })] }), {
      persistence: memory.persistence
    });
    expect(result.created.expenses).toBe(0);
    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "accounting-persistence-failure", module: "expenses",
      accountingUnit: "source-and-required-journal"
    }));
    expect(memory.state.expenses).toEqual([]);
    expect(memory.state.journals).toEqual([]);
  });

  it("stops later accounting records and reports exact partial state", async () => {
    const memory = memoryPersistence({}, { failModule: "expenses" });
    const result = await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    expect(result).toMatchObject({
      success: false, stoppedEarly: true, partialWrites: true,
      created: { clients: 1, projects: 1, budgets: 1, invoices: 1, bills: 1, expenses: 0, mileage: 0 }
    });
    expect(memory.persistence.createMileageAccounting).not.toHaveBeenCalled();
  });

  it("never invokes Banking, settlement, matching, attachment, overwrite or Auth APIs", async () => {
    const prohibited = {
      createBankTransaction: vi.fn(), createSettlementJournal: vi.fn(),
      markBankMatched: vi.fn(), uploadAttachment: vi.fn(), updateExisting: vi.fn(), createUser: vi.fn()
    };
    const memory = memoryPersistence();
    Object.assign(memory.persistence, prohibited);
    await executePhase4B(checked(accountingRows()), { persistence: memory.persistence });
    Object.values(prohibited).forEach(method => expect(method).not.toHaveBeenCalled());
    for(const source of [
      ...memory.state.invoices, ...memory.state.bills, ...memory.state.expenses, ...memory.state.mileage
    ]){
      expect(source).not.toHaveProperty("bankSettlement");
      expect(source).not.toHaveProperty("bankMatched");
      expect(source.attachmentPath || "").toBe("");
    }
    expect(memory.state.journals.some(item => item.sourceType === "bankSettlement")).toBe(false);
  });

  it("keeps planning pure", () => {
    const preflight = checked(accountingRows());
    const memory = memoryPersistence();
    const plan = planPhase4BExecution(preflight, memory.state);
    expect(plan.eligible).toBe(true);
    expect(plan.operations.invoices).toHaveLength(1);
    expect(memory.calls).toEqual([]);
  });

  it("uses authoritative callables for Invoice/Bill and transactions for Expense/Mileage units", async () => {
    const writes = [];
    const allocated = new Map();
    const collectionReads = new Map([
      ["clients", []], ["customers", []], ["projects", []], ["budgets", []],
      ["invoices", []], ["bills", []], ["expenses", []], ["journals", []]
    ]);
    const services = {
      db: {},
      collection: vi.fn((_db, first, second, third) => {
        const name = third || first;
        return { kind: "collection", name, path: third ? `${first}/${second}/${third}` : name };
      }),
      doc: vi.fn((parent, name, uid) => {
        if(parent?.kind === "collection"){
          const nextId = (allocated.get(parent.name) || 0) + 1;
          allocated.set(parent.name, nextId);
          return { kind: "document", name: parent.name, id: `${parent.name}-${nextId}` };
        }
        return { kind: "document", name, uid, id: uid };
      }),
      getDocs: vi.fn(async reference => ({
        docs: (collectionReads.get(reference.name) || []).map(record => ({
          id: record.id, data: () => record
        }))
      })),
      getDoc: vi.fn(async reference => ({
        exists: () => reference.name === "userProfiles",
        data: () => reference.name === "userProfiles" ? { currentPlan: "Pro", billingOverride: true } : {}
      })),
      addDoc: vi.fn(),
      writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => undefined) })),
      query: vi.fn(reference => reference),
      where: vi.fn(() => ({})),
      runTransaction: vi.fn(async (_db, execute) => execute({
        get: vi.fn(async () => ({ exists: () => false })),
        set: vi.fn((reference, payload) => writes.push({ reference, payload }))
      })),
      createRequestId: vi.fn()
        .mockReturnValueOnce("123e4567-e89b-42d3-a456-426614174000")
        .mockReturnValueOnce("223e4567-e89b-42d3-a456-426614174001"),
      nextBillId: vi.fn(() => 1724140800000),
      now: vi.fn(() => "2026-08-26T12:00:00.000Z"),
      serverTimestamp: vi.fn(() => "server-time")
    };
    const callables = {
      createInvoiceWithReference: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("ambiguous"), { code: "functions/unavailable" }))
        .mockImplementation(async request => ({
          data: { status: "already-created", journalId: `invoice_${USER_ID}_${request.sourceId}` }
        })),
      createBillWithReference: vi.fn(async request => ({
        data: { status: "created", journalId: `bill_${USER_ID}_${request.sourceId}` }
      }))
    };
    const persistence = createFirestorePhase4BPersistence({
      services, user: { uid: USER_ID }, callables
    });

    await persistence.readExecutionContext();
    await expect(persistence.createInvoiceAccounting({ status: "Paid", invoiceNo: "INV-PAID" }))
      .rejects.toThrow(/requires payment or Banking settlement history/);
    await expect(persistence.createBillAccounting({ status: "Paid", supplier: "Supplier" }))
      .rejects.toThrow(/requires payment or Banking settlement history/);
    await persistence.createInvoiceAccounting({ status: "Unpaid", invoiceNo: "INV-1" });
    await persistence.createBillAccounting({ status: "Unpaid", supplier: "Supplier" });
    const expenseResult = await persistence.createExpenseAccounting({
      type: "expense", date: "2026-08-20", merchant: "Shop", category: "Office",
      description: "Supplies", net: 100, vatRate: 0.2, vat: 17, gross: 117,
      status: "Draft", notes: "", projectId: "", projectName: "", projectReference: "",
      from: "", to: "", businessPurpose: "", miles: 0, ratePerMile: 0, amount: 0,
      attachmentName: "", attachmentUrl: "", attachmentPath: "", attachmentSize: 0, attachmentType: ""
    });
    const mileageResult = await persistence.createMileageAccounting({
      type: "mileage", date: "2026-08-20", merchant: "", category: "Mileage",
      description: "", from: "Office", to: "Client", businessPurpose: "Meeting",
      miles: 10, ratePerMile: 0.55, amount: 5.5, net: 0, vatRate: 0, vat: 0, gross: 5.5,
      status: "Draft", notes: "", projectId: "", projectName: "", projectReference: "",
      attachmentName: "", attachmentUrl: "", attachmentPath: "", attachmentSize: 0, attachmentType: ""
    });

    expect(callables.createInvoiceWithReference).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ status: "Unpaid" }) })
    );
    expect(callables.createInvoiceWithReference).toHaveBeenCalledTimes(2);
    expect(callables.createInvoiceWithReference.mock.calls[0][0]).toEqual(
      callables.createInvoiceWithReference.mock.calls[1][0]
    );
    expect(callables.createBillWithReference).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "1724140800000", payload: expect.objectContaining({ id: 1724140800000 }) })
    );
    expect(expenseResult.journalId).toBe(`expense_${USER_ID}_expenses-1`);
    expect(mileageResult.journalId).toBe(`mileage_${USER_ID}_expenses-2`);
    expect(writes.map(write => write.reference.name)).toEqual([
      "expenses", "journals", "expenses", "journals"
    ]);
    expect(writes.filter(write => write.reference.name === "journals").every(write => balanced(write.payload))).toBe(true);
    expect(writes.some(write => write.reference.name === "banking")).toBe(false);
  });

  it("keeps Import All initially disabled and connects Phase 4B only through Phase 4C", () => {
    const source = readFileSync(fileURLToPath(new URL("../exports.html", import.meta.url)), "utf8");
    const start = source.indexOf("async function validateExcelImportWorkbook");
    const end = source.indexOf("async function readOnlyWorkbookPreflightContext", start);
    const uploadPath = source.slice(start, end);
    expect(source).toContain('id="importAllButton" onclick="importValidatedWorkbookAll()" disabled');
    expect(uploadPath).toContain("setAllImportButtonsEnabled(false)");
    expect(uploadPath).toContain("importController.arm(validatedWorkbookPreflight)");
    expect(uploadPath).not.toContain("executePhase4B");
    expect(uploadPath).not.toContain("createFirestorePhase4BPersistence");
    expect(source).toContain("canonical-workbook-phase4c.js");
  });
});
