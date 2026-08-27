import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import {
  CANONICAL_TEMPLATE_FILENAME,
  buildCanonicalTemplateDefinition,
  buildCanonicalTemplateWorkbook
} from "../resources/js/canonical-workbook-template.js";

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

function encodeColumn(index) {
  let column = "";

  for(let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)){
    column = String.fromCharCode(65 + ((value - 1) % 26)) + column;
  }

  return column;
}

function fakeSheetJs() {
  return {
    utils: {
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      aoa_to_sheet: rows => ({
        "!ref": `A1:${encodeColumn(Math.max(0, rows[0]?.length - 1))}${rows.length}`,
        __rows: rows.map(row => [...row])
      }),
      book_append_sheet: (workbook, worksheet, name) => {
        workbook.SheetNames.push(name);
        workbook.Sheets[name] = worksheet;
      },
      encode_col: encodeColumn
    }
  };
}

function pageFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  return source.slice(start, end);
}

describe("canonical workbook template", () => {
  it("builds the exact nine canonical sheets in schema order without README", () => {
    const workbook = buildCanonicalTemplateWorkbook(fakeSheetJs());

    expect(workbook.SheetNames).toEqual(EXPECTED_SHEETS);
    expect(workbook.SheetNames).toEqual(
      CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => sheet.name)
    );
    expect(workbook.SheetNames).not.toContain("README");
    expect(workbook.Sheets.Summary).toBeDefined();
  });

  it("creates every data sheet directly from the exact canonical headers", () => {
    const workbook = buildCanonicalTemplateWorkbook(fakeSheetJs());

    for(const schemaSheet of CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored)){
      expect(workbook.Sheets[schemaSheet.name].__rows).toEqual([
        schemaSheet.columns.map(column => column.header)
      ]);
    }
  });

  it("contains no example records, fake values, or internal IDs", () => {
    const definitions = buildCanonicalTemplateDefinition();
    const dataSheets = definitions.filter(sheet => sheet.kind === "data");
    const headers = dataSheets.flatMap(sheet => sheet.headers);

    expect(dataSheets.every(sheet => !("rows" in sheet))).toBe(true);
    expect(headers.some(header => /(^|\s)ID$/i.test(header))).toBe(false);
    expect(headers).not.toContain("Created At");
    expect(headers).not.toContain("Updated At");
    expect(headers).not.toContain("Attachment");
  });

  it("provides concise Summary guidance and communicates schema version 1", () => {
    const summary = buildCanonicalTemplateDefinition().find(sheet => sheet.name === "Summary");
    const summaryText = summary.rows.flat().join(" ");

    expect(summaryText).toContain("Simple Books Workbook");
    expect(summary.rows[1][0]).toContain("Simple Books import and export workbook structure");
    expect(summaryText).toContain("Keep sheet names and column headings unchanged");
    expect(summaryText).toContain("Supported records");
    expect(summaryText).toContain("Clients, invoices and invoice items, bills, expenses, mileage, projects and budgets");
    expect(summaryText).toContain("Portability limits");
    expect(summaryText).toContain("Banking, attachments and logos, payment or settlement history and generated reports are not included");
    expect(summaryText).toContain("Version 1");
    expect(summaryText).toContain("dd/mm/yyyy");
    expect(summaryText).toContain("Simple Books will check your workbook and tell you what needs fixing before anything is imported.");
    expect(summaryText).toContain("for example 20%, 5% or 0%");
    expect(summaryText).toContain("Invoice Items use Invoice Number");
    expect(summaryText).toContain("Projects use Client Name");
    expect(summaryText).toContain("transactions and budgets use Project Reference");
    expect(summaryText).toContain("Summary sheet is guidance only and is not imported");
    expect(summaryText).not.toMatch(/KPI|revenue|profit|amount due/i);
  });

  it("adds supported usability metadata without manufacturing blank data rows", () => {
    const workbook = buildCanonicalTemplateWorkbook(fakeSheetJs());

    for(const name of EXPECTED_SHEETS.slice(1)){
      const worksheet = workbook.Sheets[name];

      expect(worksheet.__rows).toHaveLength(1);
      expect(worksheet["!cols"]).toHaveLength(worksheet.__rows[0].length);
      expect(worksheet["!autofilter"].ref).toMatch(/^A1:[A-Z]+1$/);
      expect(worksheet["!freeze"]).toBeUndefined();
    }

    expect(workbook.Sheets.Summary["!merges"]).toHaveLength(2);
  });

  it("keeps schema ownership out of exports.html and delegates one workbook build", () => {
    const exportsPath = fileURLToPath(new URL("../exports.html", import.meta.url));
    const pageSource = readFileSync(exportsPath, "utf8");
    const downloadFunction = pageFunction(
      pageSource,
      "downloadExcelImportTemplate",
      "validateExcelImportWorkbook"
    );

    expect(pageSource).toContain('/resources/js/canonical-workbook-template.js');
    expect(downloadFunction).toContain("template.buildWorkbook(XLSX)");
    expect(downloadFunction).not.toContain("appendFormattedSheet");
    expect(downloadFunction).not.toMatch(/"(README|Clients|Invoices|Bills|Expenses|Mileage|Projects|Budgets)"/);
    expect(pageSource).not.toContain("function buildExcelImportTemplateData");
    expect(CANONICAL_TEMPLATE_FILENAME).toBe("simple-books-import-template.xlsx");
  });
});
