import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import { buildCanonicalTemplateWorkbook } from "../resources/js/canonical-workbook-template.js";
import { preflightCanonicalWorkbook } from "../resources/js/canonical-workbook-preflight.js";

export const PUBLIC_WORKBOOK_FILENAME = "simple-books-workbook.xlsx";
export const PUBLIC_WORKBOOK_URL = "/downloads/" + PUBLIC_WORKBOOK_FILENAME;

const outputDirectory = fileURLToPath(new URL("../downloads/", import.meta.url));
const outputPath = fileURLToPath(
  new URL("../downloads/" + PUBLIC_WORKBOOK_FILENAME, import.meta.url),
);

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
    raw: true,
  });
}

export function validatePublicWorkbook(workbook) {
  const expectedNames = CANONICAL_WORKBOOK_SCHEMA.sheets.map(
    (sheet) => sheet.name,
  );
  assert.deepEqual(workbook.SheetNames, expectedNames, "Unexpected sheet order");

  for (const schemaSheet of CANONICAL_WORKBOOK_SCHEMA.sheets) {
    const worksheet = workbook.Sheets[schemaSheet.name];
    assert.ok(worksheet, "Missing " + schemaSheet.name + " sheet");

    if (schemaSheet.importIgnored) continue;

    const rows = rowsFromSheet(worksheet);
    assert.deepEqual(
      rows[0],
      schemaSheet.columns.map((column) => column.header),
      schemaSheet.name + " headers do not match the canonical schema",
    );
    assert.equal(
      rows.slice(1).some((row) => row.some((value) => value !== "")),
      false,
      schemaSheet.name + " contains a business record",
    );
    assert.match(
      worksheet["!autofilter"]?.ref || "",
      /^A1:[A-Z]+1$/,
      schemaSheet.name + " is missing canonical header filtering",
    );
  }

  const summaryRows = rowsFromSheet(workbook.Sheets.Summary);
  const summaryText = summaryRows.flat().join(" ");
  [
    "Simple Books import and export workbook structure",
    "Keep sheet names and column headings unchanged",
    "Summary sheet is guidance only and is not imported",
    "Clients, invoices and invoice items, bills, expenses, mileage, projects and budgets",
    "Banking, attachments and logos, payment or settlement history and generated reports are not included",
  ].forEach((statement) => assert.ok(
    summaryText.includes(statement),
    "Summary is missing: " + statement,
  ));

  const preflight = preflightCanonicalWorkbook(workbook, {
    existing: {},
    plan: "Pro",
    rowsFromSheet,
  });
  assert.equal(preflight.workbookType, "canonical");
  assert.equal(preflight.safeToProceed, true);
  assert.deepEqual(preflight.errors, []);
  assert.deepEqual(preflight.counts, {
    clients: 0,
    invoices: 0,
    invoiceItems: 0,
    bills: 0,
    expenses: 0,
    mileage: 0,
    projects: 0,
    budgets: 0,
  });
  assert.equal("summary" in preflight.records, false);

  const publicText = summaryRows.flat().join(" ");
  assert.doesNotMatch(
    publicText,
    /firebase|api[_ -]?key|secret|account id|user id|demo record/i,
    "Workbook contains private or internal content",
  );

  return {
    sheetNames: expectedNames,
    summaryText,
    preflight,
  };
}

export function buildPublicWorkbookBuffer() {
  const workbook = buildCanonicalTemplateWorkbook(XLSX);
  validatePublicWorkbook(workbook);
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
    cellStyles: true,
  });

  const reopened = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellStyles: true,
  });
  validatePublicWorkbook(reopened);
  return buffer;
}

export async function generatePublicWorkbook() {
  const first = buildPublicWorkbookBuffer();
  const second = buildPublicWorkbookBuffer();
  assert.deepEqual(first, second, "Public workbook generation is not deterministic");

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, first);
  return { outputPath, bytes: first.length };
}

// Regenerate after changing the canonical workbook schema or template:
// npm run generate:public-workbook
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await generatePublicWorkbook();
  console.log(
    "Generated " + PUBLIC_WORKBOOK_URL + " (" + result.bytes + " bytes)",
  );
}
