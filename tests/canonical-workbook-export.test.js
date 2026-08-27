import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import {
  CANONICAL_EXPORT_SHEET_NAMES,
  buildCanonicalExportDefinition,
  buildCanonicalExportWorkbook
} from "../resources/js/canonical-workbook-export.js";
import { preflightCanonicalWorkbook } from "../resources/js/canonical-workbook-preflight.js";
import { planPhase4BExecution } from "../resources/js/canonical-workbook-phase4b.js";

const EXPECTED_SHEETS = [
  "Summary", "Clients", "Invoices", "Invoice Items", "Bills",
  "Expenses", "Mileage", "Projects", "Budgets"
];

function canonicalSource(overrides = {}) {
  return {
    clients: [{
      id: "client-internal", name: "Acme Ltd", email: "accounts@acme.test",
      phone: "01234", status: "Active", followUp: "2026-09-01",
      lastContacted: "2026-08-20", notes: "Call quarterly"
    }],
    customers: [{
      id: "customer-internal", name: "acme ltd", email: "accounts@acme.test",
      address: "1 High Street", paymentTerms: "14 days"
    }],
    invoices: [{
      id: "invoice-internal", invoiceNo: "INV-1", client: "Acme Ltd",
      clientEmail: "accounts@acme.test", date: "2026-08-20", paymentTerms: "14 days",
      dueDate: "2026-09-03", projectReference: "P-1", amount: 100, vatRate: 20,
      vat: 20, total: 120, status: "Unpaid", recurringInvoice: "No",
      items: [
        { id: "item-internal-1", description: "First service", amount: 40 },
        { id: "item-internal-2", description: "Second service", amount: 60 }
      ],
      paidAt: "not-portable", settlementJournalId: "not-portable"
    }],
    bills: [{
      id: "bill-internal", supplier: "Supplier Ltd", billNumber: "B-1",
      billDate: "2026-08-20", dueDate: "2026-09-03", category: "Utilities",
      projectReference: "P-1", net: 50, vatRate: 0.2, vat: 10, total: 60,
      status: "Unpaid", notes: "Monthly bill", attachmentName: "bill.pdf",
      storagePath: "private/bill.pdf"
    }],
    expenses: [{
      id: "expense-internal", date: "2026-08-20", merchant: "Shop",
      category: "Office", description: "Supplies", projectReference: "P-1",
      net: 100, vatRate: 0.2, vat: 17, gross: 117, status: "Draft",
      notes: "VAT adjusted manually", attachmentName: "receipt.jpg"
    }],
    mileage: [{
      id: "mileage-internal", date: "2026-08-20", from: "Office", to: "Client",
      businessPurpose: "Meeting", projectReference: "P-1", miles: 10,
      ratePerMile: 0.55, amount: 5.5, status: "Draft", notes: "Return separately"
    }],
    projects: [{
      id: "project-internal", reference: "P-1", name: "Project One",
      customerId: "customer-internal", customerName: "Acme Ltd",
      description: "Migration", status: "Active", startDate: "2026-08-01",
      endDate: "2026-10-31", budget: 1000
    }],
    budgets: [{
      id: "budget-internal", name: "August plan", periodType: "monthly",
      startDate: "2026-08-01", endDate: "2026-08-31", budgetType: "category",
      category: "Office", projectId: "project-internal", projectName: "Project One",
      projectReference: "P-1", plannedAmount: 500, actualSpending: 117,
      remaining: 383, percentageUsed: 23.4, status: "Active"
    }],
    ...overrides
  };
}

function sheet(definition, name) {
  return definition.sheets.find(candidate => candidate.name === name);
}

function workbookFromDefinition(definition) {
  return {
    SheetNames: definition.sheets.map(item => item.name),
    Sheets: Object.fromEntries(definition.sheets.map(item => [
      item.name,
      item.kind === "summary"
        ? item.rows
        : [item.headers, ...item.rows.map(row => item.headers.map(header => row[header] ?? ""))]
    ]))
  };
}

function encodeColumn(index) {
  let result = "";
  for(let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)){
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function fakeXlsx() {
  return {
    utils: {
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      aoa_to_sheet: (rows) => {
        const worksheet = { __rows: rows };
        rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
          if(value === "") return;
          worksheet[`${encodeColumn(columnIndex)}${rowIndex + 1}`] = {
            v: value,
            t: value instanceof Date ? "d" : typeof value === "number" ? "n" : "s"
          };
        }));
        return worksheet;
      },
      book_append_sheet: (workbook, worksheet, name) => {
        workbook.SheetNames.push(name);
        workbook.Sheets[name] = worksheet;
      },
      encode_col: encodeColumn,
      encode_cell: ({ r, c }) => `${encodeColumn(c)}${r + 1}`
    }
  };
}

describe("canonical ordinary Excel export", () => {
  it("uses the shared schema for exact nine-sheet order and headers", () => {
    const definition = buildCanonicalExportDefinition(canonicalSource(), {
      exportedAt: new Date(2026, 7, 27, 14, 30)
    });
    expect(CANONICAL_EXPORT_SHEET_NAMES).toEqual(EXPECTED_SHEETS);
    expect(definition.sheets.map(item => item.name)).toEqual(EXPECTED_SHEETS);
    expect(definition.sheets.some(item => item.name === "README")).toBe(false);
    expect(definition.sheets.some(item => item.name === "Banking")).toBe(false);
    for(const schemaSheet of CANONICAL_WORKBOOK_SCHEMA.sheets.filter(item => !item.importIgnored)){
      expect(sheet(definition, schemaSheet.name).headers)
        .toEqual(schemaSheet.columns.map(column => column.header));
    }
  });

  it("reconciles Client Tracker and customer records into one human Client", () => {
    const definition = buildCanonicalExportDefinition(canonicalSource());
    expect(sheet(definition, "Clients").rows).toEqual([{
      "Client Name": "Acme Ltd",
      "Email": "accounts@acme.test",
      "Phone": "01234",
      "Address": "1 High Street",
      "Payment Terms": "14 days",
      "Status": "Active",
      "Follow Up Date": expect.any(Date),
      "Last Contacted Date": expect.any(Date),
      "Notes": "Call quarterly"
    }]);
  });

  it("preserves canonical mappings, line order, relationships, and manual Expense VAT", () => {
    const definition = buildCanonicalExportDefinition(canonicalSource());
    expect(sheet(definition, "Invoices").rows[0]).toMatchObject({
      "Invoice Number": "INV-1", "Client Name": "Acme Ltd",
      "Project Reference": "P-1", "VAT Rate": 0.2, Net: 100, VAT: 20,
      Total: 120, Status: "Unpaid"
    });
    expect(sheet(definition, "Invoice Items").rows).toEqual([
      { "Invoice Number": "INV-1", "Line Number": 1, Description: "First service", "Net Amount": 40 },
      { "Invoice Number": "INV-1", "Line Number": 2, Description: "Second service", "Net Amount": 60 }
    ]);
    expect(sheet(definition, "Bills").rows[0]).toMatchObject({
      Supplier: "Supplier Ltd", "Bill Number": "B-1", "Project Reference": "P-1",
      Net: 50, "VAT Rate": 0.2, VAT: 10, Total: 60, Status: "Unpaid"
    });
    expect(sheet(definition, "Expenses").rows[0]).toMatchObject({
      Merchant: "Shop", "Project Reference": "P-1", Net: 100,
      "VAT Rate": 0.2, VAT: 17, Gross: 117
    });
    expect(sheet(definition, "Mileage").rows[0]).toMatchObject({
      From: "Office", To: "Client", "Project Reference": "P-1",
      Miles: 10, "Rate Per Mile": 0.55, Amount: 5.5
    });
    expect(sheet(definition, "Projects").rows[0]).toMatchObject({
      "Project Reference": "P-1", "Project Name": "Project One",
      "Client Name": "Acme Ltd", "Project Budget": 1000
    });
    expect(sheet(definition, "Budgets").rows[0]).toEqual({
      "Budget Name": "August plan", "Period Type": "Monthly",
      "Start Date": expect.any(Date), "End Date": expect.any(Date),
      "Budget Type": "Category", Category: "Office", "Project Reference": "P-1",
      "Planned Amount": 500, Status: "Active"
    });
  });

  it("does not export internal IDs, attachments, settlement fields, or derived budget values", () => {
    const serialized = JSON.stringify(buildCanonicalExportDefinition(canonicalSource()));
    for(const forbidden of [
      "client-internal", "customer-internal", "invoice-internal", "bill-internal",
      "expense-internal", "mileage-internal", "project-internal", "item-internal",
      "bill.pdf", "receipt.jpg", "storagePath", "paidAt", "settlementJournalId",
      "actualSpending", "remaining", "percentageUsed"
    ]){
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("builds real date/numeric/percentage cells with canonical formats", () => {
    const XLSX = fakeXlsx();
    const { workbook } = buildCanonicalExportWorkbook(XLSX, canonicalSource(), {
      exportedAt: new Date(2026, 7, 27, 14, 30)
    });
    expect(workbook.SheetNames).toEqual(EXPECTED_SHEETS);
    expect(workbook.Sheets.Invoices.C2.t).toBe("d");
    expect(workbook.Sheets.Invoices.C2.z).toBe("dd/mm/yyyy");
    expect(workbook.Sheets.Invoices.G2.t).toBe("n");
    expect(workbook.Sheets.Invoices.G2.v).toBe(0.2);
    expect(workbook.Sheets.Invoices.G2.z).toBe("0%");
    expect(workbook.Sheets.Invoices.H2.z).toContain("£");
    expect(workbook.Sheets.Summary.B2.z).toBe("dd/mm/yyyy hh:mm");
  });

  it("passes canonical preflight structurally and keeps Unpaid records safe", () => {
    const definition = buildCanonicalExportDefinition(canonicalSource());
    const result = preflightCanonicalWorkbook(workbookFromDefinition(definition), {
      existing: {}, plan: "Pro"
    });
    expect(result.schema.detected).toBe(true);
    expect(result.safeToProceed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.records.invoices[0].status).toBe("Unpaid");
    expect(result.records.bills[0].status).toBe("Unpaid");
    expect(result.records.expenses[0].vat).toBe(17);
    expect(result.records.invoiceItems.map(item => item.description))
      .toEqual(["First service", "Second service"]);
  });

  it("preserves Paid status and surfaces its known blank-account portability stop", () => {
    const source = canonicalSource({
      invoices: [{ ...canonicalSource().invoices[0], status: "Paid" }],
      bills: [{ ...canonicalSource().bills[0], status: "Paid" }]
    });
    const definition = buildCanonicalExportDefinition(source);
    const summaryText = sheet(definition, "Summary").rows.flat().join(" ");
    expect(sheet(definition, "Invoices").rows[0].Status).toBe("Paid");
    expect(sheet(definition, "Bills").rows[0].Status).toBe("Paid");
    expect(summaryText).toContain("cannot be recreated in a blank account without payment history");

    const preflight = preflightCanonicalWorkbook(workbookFromDefinition(definition), {
      existing: {}, plan: "Pro"
    });
    expect(preflight.safeToProceed).toBe(true);
    const plan = planPhase4BExecution(preflight);
    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "paid-accounting-history-required", module: "invoices" }),
      expect.objectContaining({ code: "paid-accounting-history-required", module: "bills" })
    ]));
  });

  it("bridges the module-scoped builder into the classic download script", () => {
    const html = readFileSync(new URL("../exports.html", import.meta.url), "utf8");
    const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
    const classicScript = html.match(/<script>([\s\S]*?function downloadExcelExport[\s\S]*?)<\/script>/)?.[1] || "";

    expect(moduleScript).toContain("buildCanonicalExportWorkbook");
    expect(moduleScript).toContain("window.simpleBooksCanonicalWorkbookExport = Object.freeze");
    expect(classicScript).toContain("window.simpleBooksCanonicalWorkbookExport");
    expect(classicScript).toContain("exportBuilder.buildWorkbook(XLSX, exportData)");
    expect(classicScript).not.toMatch(/(?<![\w.])buildCanonicalExportWorkbook\s*\(/);
  });

  it("keeps exports.html on the canonical builder without an independent ordinary-export header list", () => {
    const html = readFileSync(new URL("../exports.html", import.meta.url), "utf8");
    expect(html).toContain('readFirestoreCollection(user, services, "projects")');
    expect(html).toContain('readFirestoreCollection(user, services, "budgets")');
    expect(html).not.toContain("function invoiceExcelRow");
    expect(html).not.toContain('appendFormattedSheet(XLSX, workbook, "Invoices"');
  });
});
