import {
  CANONICAL_WORKBOOK_SCHEMA,
  WORKBOOK_SCHEMA_VERSION
} from "./canonical-workbook-schema.js";

export const CANONICAL_TEMPLATE_FILENAME = "simple-books-import-template.xlsx";

const SUMMARY_ROWS = Object.freeze([
  Object.freeze(["Simple Books Workbook", ""]),
  Object.freeze([
    "Keep your business records in Excel, then import them into Simple Books when you are ready.",
    ""
  ]),
  Object.freeze(["", ""]),
  Object.freeze([
    "Getting started",
    "Use the sheets you need and leave the others blank. Do not add or rename column headings."
  ]),
  Object.freeze([
    "Clients",
    "Keep customer contact details, payment terms and follow-up notes."
  ]),
  Object.freeze([
    "Invoices & Invoice Items",
    "Record each invoice once, then add its line items using the same Invoice Number."
  ]),
  Object.freeze([
    "Bills & Expenses",
    "Track supplier bills and day-to-day business spending."
  ]),
  Object.freeze([
    "Mileage",
    "Record business journeys, miles and the applicable rate per mile."
  ]),
  Object.freeze([
    "Projects & Budgets",
    "Organise work by Project Reference and plan overall or category spending."
  ]),
  Object.freeze([
    "Required fields",
    "Each record needs its main identifying details, date and amount where applicable. Simple Books will check your workbook and tell you what needs fixing before anything is imported."
  ]),
  Object.freeze([
    "Dates",
    "Enter real Excel dates; they are displayed as dd/mm/yyyy."
  ]),
  Object.freeze([
    "Money",
    "Enter amounts as numbers, without typing currency symbols. Amounts are in GBP."
  ]),
  Object.freeze([
    "VAT rates",
    "Enter VAT rates as percentages, for example 20%, 5% or 0%."
  ]),
  Object.freeze([
    "Relationships",
    "Invoice Items use Invoice Number; Projects use Client Name; transactions and budgets use Project Reference."
  ]),
  Object.freeze([
    "Import note",
    "The Summary sheet is guidance only and is not imported into Simple Books."
  ]),
  Object.freeze(["Workbook schema", `Version ${WORKBOOK_SCHEMA_VERSION}`])
]);

export function canonicalWorkbookColumnWidth(column) {
  const wideTextHeaders = new Set([
    "Address",
    "Business Purpose",
    "Description",
    "Notes"
  ]);

  if(wideTextHeaders.has(column.header)){
    return 32;
  }

  if(column.dataType === "date"){
    return 14;
  }

  if(column.dataType === "money"){
    return 16;
  }

  if(column.dataType === "percentage"){
    return 13;
  }

  if(column.dataType === "integer" || column.dataType === "number"){
    return 14;
  }

  return Math.min(28, Math.max(14, column.header.length + 3));
}

export function buildCanonicalTemplateDefinition() {
  return CANONICAL_WORKBOOK_SCHEMA.sheets.map((schemaSheet) => {
    if(schemaSheet.importIgnored){
      return {
        name: schemaSheet.name,
        kind: "summary",
        rows: SUMMARY_ROWS.map(row => [...row]),
        columnWidths: [24, 92]
      };
    }

    return {
      name: schemaSheet.name,
      kind: "data",
      headers: schemaSheet.columns.map(column => column.header),
      columnWidths: schemaSheet.columns.map(canonicalWorkbookColumnWidth)
    };
  });
}

export function applyCanonicalDataSheetFormatting(XLSX, worksheet, schemaSheet, rowCount = 0, options = {}) {
  if(!XLSX?.utils?.encode_col){
    throw new TypeError("A compatible SheetJS library is required to format the worksheet.");
  }

  worksheet["!cols"] = schemaSheet.columns.map(column => ({
    wch: canonicalWorkbookColumnWidth(column)
  }));
  if(options.freeze !== false){
    worksheet["!freeze"] = {
      xSplit: 0,
      ySplit: 1,
      topLeftCell: "A2",
      activePane: "bottomLeft",
      state: "frozen"
    };
  }
  worksheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(schemaSheet.columns.length - 1)}${Math.max(1, rowCount + 1)}`
  };

  if(!XLSX.utils.encode_cell) return;

  schemaSheet.columns.forEach((column, columnIndex) => {
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })];
    if(headerCell){
      headerCell.s = {
        ...(headerCell.s || {}),
        font: { ...((headerCell.s && headerCell.s.font) || {}), bold: true }
      };
    }

    let numberFormat = "";
    if(column.dataType === "date") numberFormat = "dd/mm/yyyy";
    if(column.dataType === "money") numberFormat = "£#,##0.00;[Red]-£#,##0.00";
    if(column.dataType === "percentage") numberFormat = "0%";
    if(column.header === "Miles") numberFormat = "0.0";
    if(!numberFormat) return;

    for(let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1){
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if(cell) cell.z = numberFormat;
    }
  });
}

export function buildCanonicalTemplateWorkbook(XLSX) {
  if(!XLSX?.utils?.book_new || !XLSX?.utils?.aoa_to_sheet || !XLSX?.utils?.book_append_sheet){
    throw new TypeError("A compatible SheetJS library is required to build the workbook.");
  }

  const workbook = XLSX.utils.book_new();

  for(const templateSheet of buildCanonicalTemplateDefinition()){
    const rows = templateSheet.kind === "summary"
      ? templateSheet.rows
      : [templateSheet.headers];
    const worksheet = XLSX.utils.aoa_to_sheet(rows, {
      cellDates: true,
      dateNF: "dd/mm/yyyy"
    });

    worksheet["!cols"] = templateSheet.columnWidths.map(wch => ({ wch }));

    if(templateSheet.kind === "summary"){
      worksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }
      ];
    }else{
      const schemaSheet = CANONICAL_WORKBOOK_SCHEMA.sheets.find(sheet => sheet.name === templateSheet.name);
      applyCanonicalDataSheetFormatting(XLSX, worksheet, schemaSheet, 0, { freeze: false });
    }

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      templateSheet.name
    );
  }

  return workbook;
}

if(typeof window !== "undefined"){
  window.simpleBooksCanonicalWorkbookTemplate = Object.freeze({
    buildWorkbook: buildCanonicalTemplateWorkbook,
    filename: CANONICAL_TEMPLATE_FILENAME,
    schemaVersion: WORKBOOK_SCHEMA_VERSION
  });
}
