import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import {
  normalizeWorkbookDate,
  normalizeWorkbookNumber,
  normalizeWorkbookVatRate,
  preflightCanonicalWorkbook
} from "../resources/js/canonical-workbook-preflight.js";

const DATA_SHEETS = CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored);

function schemaSheet(name) {
  return DATA_SHEETS.find(sheet => sheet.name === name);
}

function row(name, values = {}) {
  return schemaSheet(name).columns.map(column => values[column.header] ?? "");
}

function canonicalWorkbook(sheetRows = {}, order) {
  const names = order || CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => sheet.name);
  const sheets = Object.fromEntries(CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => [
    sheet.name,
    sheet.name === "Summary"
      ? [["Simple Books Workbook"], ["Workbook schema", "Version 1"]]
      : [sheet.columns.map(column => column.header), ...(sheetRows[sheet.name] || [])]
  ]));
  return { SheetNames: names, Sheets: sheets };
}

function preflight(workbook, options = {}) {
  return preflightCanonicalWorkbook(workbook, {
    existing: {},
    plan: "Pro",
    ...options
  });
}

function validInvoiceRows(overrides = {}) {
  return {
    Clients: [row("Clients", { "Client Name": "Acme Ltd" })],
    Invoices: [row("Invoices", {
      "Invoice Number": "INV-1",
      "Client Name": "Acme Ltd",
      "Invoice Date": "26/08/2026",
      "VAT Rate": 0.2,
      "Status": "Unpaid",
      ...overrides.invoice
    })],
    "Invoice Items": [row("Invoice Items", {
      "Invoice Number": "INV-1",
      "Line Number": 1,
      "Description": "Bookkeeping",
      "Net Amount": 100,
      ...overrides.item
    })]
  };
}

describe("canonical workbook preflight", () => {
  it("parses the canonical nine-sheet template and ignores Summary", () => {
    const result = preflight(canonicalWorkbook());

    expect(result.workbookType).toBe("canonical");
    expect(result.schema).toMatchObject({ version: 1, detected: true });
    expect(result.counts).toEqual({
      clients: 0, invoices: 0, invoiceItems: 0, bills: 0,
      expenses: 0, mileage: 0, projects: 0, budgets: 0
    });
    expect(result.records).not.toHaveProperty("summary");
    expect(result.safeToProceed).toBe(true);
  });

  it("accepts reordered sheets and reordered canonical columns", () => {
    const workbook = canonicalWorkbook(validInvoiceRows(), [
      "Mileage", "Budgets", "Invoices", "Summary", "Clients", "Bills",
      "Projects", "Invoice Items", "Expenses"
    ]);
    const invoiceRows = workbook.Sheets.Invoices;
    const reorderedIndexes = [14, 0, 2, 1, 6, 7, 8, 9, 10, 11, 12, 13, 3, 4, 5];
    workbook.Sheets.Invoices = invoiceRows.map(source => reorderedIndexes.map(index => source[index]));

    const result = preflight(workbook);

    expect(result.errors).toEqual([]);
    expect(result.records.invoices[0]).toMatchObject({
      invoiceNumber: "INV-1",
      clientName: "Acme Ltd",
      invoiceDate: "2026-08-26"
    });
  });

  it("accepts completely blank sheets and ignores blank rows", () => {
    const workbook = canonicalWorkbook({
      Clients: [Array(schemaSheet("Clients").columns.length).fill(""), row("Clients", { "Client Name": "Acme" })]
    });
    const result = preflight(workbook);

    expect(result.counts.clients).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("handles genuine dates, Excel serial dates and supported legacy text", () => {
    expect(normalizeWorkbookDate(new Date("2026-08-26T00:00:00.000Z"))).toEqual({ value: "2026-08-26", warning: "" });
    expect(normalizeWorkbookDate(46270).value).toBe("2026-09-05");
    expect(normalizeWorkbookDate("26/08/2026")).toMatchObject({ value: "2026-08-26" });
    expect(normalizeWorkbookDate("2026-02-30")).toHaveProperty("error");
  });

  it("reports malformed dates with sheet, row and field context", () => {
    const result = preflight(canonicalWorkbook({
      Expenses: [row("Expenses", { Date: "not-a-date", Merchant: "Shop", Net: 10 })]
    }));

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "invalid-value", sheet: "Expenses", row: 2, field: "Date"
    }));
  });

  it("normalizes money strings and rejects malformed money", () => {
    expect(normalizeWorkbookNumber("£1,234.50", { money: true })).toMatchObject({ value: 1234.5 });
    expect(normalizeWorkbookNumber("twelve pounds", { money: true })).toHaveProperty("error");
  });

  it("normalizes Excel percentages and reasonable legacy VAT representations", () => {
    expect(normalizeWorkbookVatRate(0.2)).toEqual({ value: 0.2, warning: "" });
    expect(normalizeWorkbookVatRate("20%").value).toBe(0.2);
    expect(normalizeWorkbookVatRate(20)).toMatchObject({ value: 0.2 });
    expect(normalizeWorkbookVatRate(0.175)).toHaveProperty("error");
  });

  it("normalizes enum casing and Overdue to the derived unpaid state", () => {
    const result = preflight(canonicalWorkbook({
      Clients: [row("Clients", { "Client Name": "Acme", Status: "active" })],
      Bills: [row("Bills", {
        Supplier: "Supplier", "Bill Date": "2026-08-26", Net: 100,
        "VAT Rate": 0.2, VAT: 20, Total: 120, Status: "Overdue"
      })]
    }));

    expect(result.records.clients[0].status).toBe("Active");
    expect(result.records.bills[0].status).toBe("Unpaid");
    expect(result.warnings.some(item => item.message.includes("Overdue was normalized"))).toBe(true);
  });

  it("resolves Invoice Items and calculates authoritative invoice totals", () => {
    const result = preflight(canonicalWorkbook(validInvoiceRows()));

    expect(result.errors).toEqual([]);
    expect(result.records.invoices[0]).toMatchObject({ net: 100, vat: 20, total: 120 });
    expect(result.unresolvedRelationships).toEqual([]);
  });

  it("reports a missing Invoice Items to Invoices relationship", () => {
    const result = preflight(canonicalWorkbook({
      "Invoice Items": [row("Invoice Items", {
        "Invoice Number": "MISSING", "Line Number": 1,
        Description: "Work", "Net Amount": 10
      })]
    }));

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unresolved-relationship", sheet: "Invoice Items", field: "Invoice Number"
    }));
  });

  it("enforces three invoice items and rejects duplicate line numbers", () => {
    const items = [1, 2, 2, 4].map(lineNumber => row("Invoice Items", {
      "Invoice Number": "INV-1", "Line Number": lineNumber,
      Description: `Line ${lineNumber}`, "Net Amount": 10
    }));
    const rows = validInvoiceRows();
    rows["Invoice Items"] = items;
    const result = preflight(canonicalWorkbook(rows));

    expect(result.errors.some(item => item.code === "duplicate-line-number")).toBe(true);
    expect(result.errors.some(item => item.code === "invoice-item-limit")).toBe(true);
  });

  it("validates Client Name relationships against workbook and account context", () => {
    const missing = validInvoiceRows();
    missing.Clients = [];
    expect(preflight(canonicalWorkbook(missing)).errors.some(item => item.field === "Client Name")).toBe(true);

    const resolved = preflight(canonicalWorkbook(missing), {
      existing: { clients: [{ name: "Acme Ltd" }] }
    });
    expect(resolved.errors.some(item => item.field === "Client Name")).toBe(false);
  });

  it("validates Project Reference relationships across transaction modules", () => {
    const result = preflight(canonicalWorkbook({
      Expenses: [row("Expenses", {
        Date: "2026-08-26", Merchant: "Shop", "Project Reference": "P-404",
        Net: 10, "VAT Rate": 0, VAT: 0, Gross: 10
      })]
    }));

    expect(result.unresolvedRelationships).toContainEqual(expect.objectContaining({
      sheet: "Expenses", targetType: "project", value: "P-404"
    }));
  });

  it("validates Budget type, category, project and period semantics", () => {
    const result = preflight(canonicalWorkbook({
      Budgets: [row("Budgets", {
        "Budget Name": "Travel", "Period Type": "Monthly",
        "Start Date": "2026-08-02", "End Date": "2026-08-31",
        "Budget Type": "Category", "Planned Amount": 100,
        "Project Reference": "P-404"
      })]
    }));

    expect(result.records.budgets[0]).toMatchObject({ periodType: "monthly", budgetType: "category" });
    expect(result.errors.some(item => item.code === "budget-category-required")).toBe(true);
    expect(result.errors.some(item => item.code === "budget-period-mismatch")).toBe(true);
    expect(result.errors.some(item => item.field === "Project Reference")).toBe(true);
  });

  it("reports arithmetic discrepancies without trusting calculated workbook values", () => {
    const rows = validInvoiceRows({ invoice: { Net: 999, VAT: 999, Total: 999 } });
    const result = preflight(canonicalWorkbook(rows));

    expect(result.warnings.filter(item => item.code === "arithmetic-discrepancy").length).toBeGreaterThanOrEqual(2);
    expect(result.records.invoices[0]).toMatchObject({ net: 100, vat: 20, total: 120 });
  });

  it("preserves manually adjustable Expense VAT and warns on material discrepancies", () => {
    const result = preflight(canonicalWorkbook({
      Expenses: [row("Expenses", {
        Date: "2026-08-26", Merchant: "Shop", Net: 100,
        "VAT Rate": 0.2, VAT: 17, Gross: 117
      })]
    }));

    expect(result.records.expenses[0]).toMatchObject({ vat: 17, gross: 117 });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "manual-vat-discrepancy" }));
  });

  it("reports malformed required fields instead of defaulting them silently", () => {
    const result = preflight(canonicalWorkbook({
      Clients: [row("Clients", { Email: "nobody@example.test" })]
    }));

    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "required-field", sheet: "Clients", row: 2, field: "Client Name"
    }));
    expect(result.safeToProceed).toBe(false);
  });

  it("combines legacy addresses, maps invoice Description and discards Payment Method", () => {
    const workbook = {
      SheetNames: ["README", "Clients", "Invoices", "Bills", "Expenses", "Mileage"],
      Sheets: {
        README: [["Purpose", "Legacy import"]],
        Clients: [
          ["Client Name", "Address Line 1", "Town/City", "Postcode"],
          ["Acme Ltd", "1 High Street", "Manchester", "M1 1AA"]
        ],
        Invoices: [
          ["Invoice Number", "Client Name", "Invoice Date", "Description", "Net", "VAT Rate", "VAT", "Total", "Status"],
          ["INV-OLD", "Acme Ltd", "26/08/2026", "Legacy service", 100, 0.2, 20, 120, "Overdue"]
        ],
        Bills: [[]],
        Expenses: [
          ["Date", "Merchant", "Net", "VAT Rate", "VAT", "Gross", "Payment Method"],
          ["26/08/2026", "Shop", 10, 0, 0, 10, "Business card"]
        ],
        Mileage: [[]]
      }
    };

    const result = preflight(workbook);

    expect(result.workbookType).toBe("legacy");
    expect(result.records.clients[0].address).toBe("1 High Street, Manchester, M1 1AA");
    expect(result.records.invoiceItems[0]).toMatchObject({
      invoiceNumber: "INV-OLD", lineNumber: 1,
      description: "Legacy service", netAmount: 100
    });
    expect(result.records.expenses[0]).not.toHaveProperty("paymentMethod");
    expect(result.warnings.some(item => item.code === "legacy-field-not-imported")).toBe(true);
  });

  it("marks existing duplicates as future skips without overwriting", () => {
    const result = preflight(canonicalWorkbook(validInvoiceRows()), {
      existing: {
        clients: [],
        invoices: [{ invoiceNo: "inv-1" }]
      }
    });

    expect(result.duplicateCandidates).toContainEqual(expect.objectContaining({
      module: "invoices", source: "existing-account", proposedAction: "skip"
    }));
    expect(result.warnings.some(item => item.code === "existing-duplicate")).toBe(true);
  });

  it("uses the real Starter active-project entitlement before any execution", () => {
    const result = preflight(canonicalWorkbook({
      Projects: [row("Projects", {
        "Project Reference": "P-2", "Project Name": "Second", Status: "Active"
      })]
    }), {
      plan: "Starter",
      existing: {
        projects: Array.from({ length: 5 }, (_, index) => ({
          reference: `P-${index + 10}`,
          status: "Active"
        }))
      }
    });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "active-project-limit" }));
    expect(result.safeToProceed).toBe(false);
  });

  it("rejects input formulas and ignores calculated formula results", () => {
    const workbook = canonicalWorkbook(validInvoiceRows());
    const invoiceRows = workbook.Sheets.Invoices;
    workbook.Sheets.Invoices = {
      rows: invoiceRows,
      G2: { f: "20/100", v: 0.2 },
      H2: { f: "SUM(1,2)", v: 999 }
    };
    const result = preflight(workbook, { rowsFromSheet: sheet => sheet.rows });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "formula-not-accepted", field: "VAT Rate" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "formula-ignored", field: "Net" }));
  });

  it("never invokes write-capable APIs during parsing or preflight", () => {
    const writes = {
      addDoc: vi.fn(() => { throw new Error("must not run"); }),
      setDoc: vi.fn(() => { throw new Error("must not run"); }),
      updateDoc: vi.fn(() => { throw new Error("must not run"); }),
      deleteDoc: vi.fn(() => { throw new Error("must not run"); })
    };

    const result = preflight(canonicalWorkbook(), { services: writes });

    expect(result.safeToProceed).toBe(true);
    Object.values(writes).forEach(write => expect(write).not.toHaveBeenCalled());
  });

  it("keeps browser workbook upload isolated from every legacy execution path", () => {
    const exportsSource = readFileSync(
      fileURLToPath(new URL("../exports.html", import.meta.url)),
      "utf8"
    );
    const start = exportsSource.indexOf("async function validateExcelImportWorkbook");
    const end = exportsSource.indexOf("async function readOnlyWorkbookPreflightContext", start);
    const uploadPath = exportsSource.slice(start, end);

    expect(uploadPath).toContain("preflightModule.preflight");
    expect(uploadPath).toContain("setAllImportButtonsEnabled(false)");
    expect(uploadPath).not.toContain("validatedImportWorkbook = workbook");
    expect(uploadPath).not.toMatch(/addDoc|setDoc|updateDoc|deleteDoc|importValidated|importClientsFromWorkbook/);
  });
});
