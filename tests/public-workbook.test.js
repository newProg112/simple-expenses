import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import {
  PUBLIC_WORKBOOK_FILENAME,
  PUBLIC_WORKBOOK_URL,
  buildPublicWorkbookBuffer,
  validatePublicWorkbook,
} from "../scripts/generate-public-workbook.mjs";

const workbookUrl = new URL(
  "../downloads/simple-books-workbook.xlsx",
  import.meta.url,
);
const asset = readFileSync(workbookUrl);
const workbook = XLSX.read(asset, {
  type: "buffer",
  cellDates: true,
  cellStyles: true,
});

function rows(name) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], {
    header: 1,
    defval: "",
    blankrows: true,
    raw: true,
  });
}

describe("public canonical workbook", () => {
  it("exists as a real XLSX at the stable public location", () => {
    expect(existsSync(workbookUrl)).toBe(true);
    expect(PUBLIC_WORKBOOK_FILENAME).toBe("simple-books-workbook.xlsx");
    expect(PUBLIC_WORKBOOK_URL).toBe(
      "/downloads/simple-books-workbook.xlsx",
    );
    expect(asset.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("round-trips through the shared generator validation", () => {
    const result = validatePublicWorkbook(workbook);

    expect(result.sheetNames).toEqual(
      CANONICAL_WORKBOOK_SCHEMA.sheets.map((sheet) => sheet.name),
    );
    expect(result.preflight.safeToProceed).toBe(true);
    expect(result.preflight.records).not.toHaveProperty("summary");
  });

  it("has exact canonical headers and no business rows", () => {
    for (const schemaSheet of CANONICAL_WORKBOOK_SCHEMA.sheets) {
      if (schemaSheet.importIgnored) continue;

      const sheetRows = rows(schemaSheet.name);
      expect(sheetRows[0]).toEqual(
        schemaSheet.columns.map((column) => column.header),
      );
      expect(
        sheetRows.slice(1).filter(
          (row) => row.some((value) => value !== ""),
        ),
      ).toEqual([]);
    }
  });

  it("contains concise public Summary guidance and no private metadata", () => {
    const summaryText = rows("Summary").flat().join(" ");
    expect(summaryText).toContain(
      "Simple Books import and export workbook structure",
    );
    expect(summaryText).toContain(
      "Summary sheet is guidance only and is not imported",
    );
    expect(summaryText).toContain(
      "Keep sheet names and column headings unchanged",
    );
    expect(summaryText).toContain("Portability limits");
    expect(summaryText).not.toMatch(
      /firebase|api[_ -]?key|secret|account id|user id|demo record/i,
    );
    expect(workbook.Custprops || {}).toEqual({});
  });

  it("retains canonical worksheet presentation metadata", () => {
    for (const schemaSheet of CANONICAL_WORKBOOK_SCHEMA.sheets) {
      if (schemaSheet.importIgnored) continue;

      const worksheet = workbook.Sheets[schemaSheet.name];
      expect(worksheet["!cols"]).toHaveLength(schemaSheet.columns.length);
      expect(worksheet["!autofilter"]?.ref).toMatch(/^A1:[A-Z]+1$/);
    }
  });

  it("is reproducible from the canonical template authority", () => {
    expect(buildPublicWorkbookBuffer()).toEqual(asset);

    const generatorSource = readFileSync(
      new URL("../scripts/generate-public-workbook.mjs", import.meta.url),
      "utf8",
    );
    expect(generatorSource).toContain(
      'from "../resources/js/canonical-workbook-schema.js"',
    );
    expect(generatorSource).toContain(
      'from "../resources/js/canonical-workbook-template.js"',
    );
    expect(generatorSource).not.toMatch(
      /const (?:EXPECTED_SHEETS|EXPECTED_COLUMNS|PUBLIC_WORKBOOK_SCHEMA)/,
    );
  });
});
