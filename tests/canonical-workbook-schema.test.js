import { describe, expect, it } from "vitest";
import {
  CANONICAL_WORKBOOK_SCHEMA,
  WORKBOOK_SCHEMA_VERSION
} from "../resources/js/canonical-workbook-schema.js";

const EXPECTED_COLUMNS = Object.freeze({
  Clients: [
    "Client Name", "Email", "Phone", "Address", "Payment Terms", "Status",
    "Follow Up Date", "Last Contacted Date", "Notes"
  ],
  Invoices: [
    "Invoice Number", "Client Name", "Invoice Date", "Payment Terms", "Due Date",
    "Project Reference", "VAT Rate", "Net", "VAT", "Total", "Status", "Recurring",
    "Recurring Frequency", "Next Invoice Date", "Reminder Date"
  ],
  "Invoice Items": [
    "Invoice Number", "Line Number", "Description", "Net Amount"
  ],
  Bills: [
    "Supplier", "Bill Number", "Bill Date", "Due Date", "Category",
    "Project Reference", "Net", "VAT Rate", "VAT", "Total", "Status", "Notes"
  ],
  Expenses: [
    "Date", "Merchant", "Category", "Description", "Project Reference", "Net",
    "VAT Rate", "VAT", "Gross", "Status", "Notes"
  ],
  Mileage: [
    "Date", "From", "To", "Business Purpose", "Project Reference", "Miles",
    "Rate Per Mile", "Amount", "Status", "Notes"
  ],
  Projects: [
    "Project Reference", "Project Name", "Client Name", "Description", "Status",
    "Start Date", "End Date", "Project Budget"
  ],
  Budgets: [
    "Budget Name", "Period Type", "Start Date", "End Date", "Budget Type",
    "Category", "Project Reference", "Planned Amount", "Status"
  ]
});

const EXPECTED_SHEETS = [
  "Summary",
  "Clients",
  "Invoices",
  "Invoice Items",
  "Bills",
  "Expenses",
  "Mileage",
  "Projects",
  "Budgets"
];

function sheet(name) {
  return CANONICAL_WORKBOOK_SCHEMA.sheets.find(item => item.name === name);
}

function column(sheetName, header) {
  return sheet(sheetName)?.columns.find(item => item.header === header);
}

describe("canonical workbook schema", () => {
  it("publishes explicit schema version 1", () => {
    expect(WORKBOOK_SCHEMA_VERSION).toBe(1);
    expect(CANONICAL_WORKBOOK_SCHEMA.version).toBe(1);
    expect(CANONICAL_WORKBOOK_SCHEMA.id).toBe("simple-books-canonical-workbook");
  });

  it("defines the exact approved visible sheet order", () => {
    expect(CANONICAL_WORKBOOK_SCHEMA.sheets.map(item => item.name))
      .toEqual(EXPECTED_SHEETS);
  });

  it("defines the exact approved columns and column order", () => {
    expect(Object.fromEntries(
      CANONICAL_WORKBOOK_SCHEMA.sheets
        .filter(item => !item.importIgnored)
        .map(item => [item.name, item.columns.map(itemColumn => itemColumn.header)])
    )).toEqual(EXPECTED_COLUMNS);
  });

  it("marks Summary as the only import-ignored sheet", () => {
    expect(sheet("Summary")).toMatchObject({ importIgnored: true, columns: [] });
    expect(CANONICAL_WORKBOOK_SCHEMA.sheets
      .filter(item => item.importIgnored)
      .map(item => item.name))
      .toEqual(["Summary"]);
  });

  it("does not expose internal IDs, attachments, timestamps, or banking metadata", () => {
    const headers = CANONICAL_WORKBOOK_SCHEMA.sheets
      .flatMap(item => item.columns.map(itemColumn => itemColumn.header));

    expect(headers).not.toContain("Invoice ID");
    expect(headers).not.toContain("Bill ID");
    expect(headers).not.toContain("Expense ID");
    expect(headers).not.toContain("Mileage ID");
    expect(headers).not.toContain("Project ID");
    expect(headers).not.toContain("Client ID");
    expect(headers).not.toContain("Created At");
    expect(headers).not.toContain("Updated At");
    expect(headers).not.toContain("Attachment");
    expect(headers).not.toContain("Bank Settlement");
    expect(headers.some(header => /(^|\s)ID$/i.test(header))).toBe(false);
  });

  it("represents every approved human-readable relationship", () => {
    expect(column("Invoices", "Client Name").relationship)
      .toEqual({ sheet: "Clients", column: "Client Name" });
    expect(column("Invoice Items", "Invoice Number").relationship)
      .toEqual({ sheet: "Invoices", column: "Invoice Number" });
    expect(column("Projects", "Client Name").relationship)
      .toEqual({ sheet: "Clients", column: "Client Name" });

    for (const sourceSheet of ["Invoices", "Bills", "Expenses", "Mileage", "Budgets"]) {
      expect(column(sourceSheet, "Project Reference").relationship)
        .toEqual({ sheet: "Projects", column: "Project Reference" });
    }
  });

  it("describes input, data type, calculated, alias, enum, and import semantics", () => {
    const dataColumns = CANONICAL_WORKBOOK_SCHEMA.sheets
      .filter(item => !item.importIgnored)
      .flatMap(item => item.columns);

    for (const itemColumn of dataColumns) {
      expect(["required", "optional", "none"]).toContain(itemColumn.input);
      expect(typeof itemColumn.dataType).toBe("string");
      expect(typeof itemColumn.calculated).toBe("boolean");
      expect(typeof itemColumn.importIgnored).toBe("boolean");
      expect(Array.isArray(itemColumn.aliases)).toBe(true);
      expect(Array.isArray(itemColumn.enumValues)).toBe(true);
    }

    expect(column("Invoices", "Net")).toMatchObject({
      input: "none",
      dataType: "money",
      calculated: true
    });
    expect(column("Invoices", "Invoice Date")).toMatchObject({
      input: "required",
      dataType: "date"
    });
    expect(column("Invoices", "VAT Rate")).toMatchObject({
      dataType: "percentage",
      enumValues: [0.2, 0.05, 0]
    });
    expect(column("Expenses", "Merchant").aliases)
      .toEqual(["Supplier", "Supplier / Merchant"]);
  });

  it("retains the approved current maximum of three invoice items", () => {
    expect(CANONICAL_WORKBOOK_SCHEMA.constraints.maximumInvoiceItemsPerInvoice)
      .toBe(3);
  });
});
