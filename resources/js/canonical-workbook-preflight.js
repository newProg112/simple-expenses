import { CANONICAL_WORKBOOK_SCHEMA } from "./canonical-workbook-schema.js";
import {
  PROJECT_STATUS,
  canUseAnotherActiveProject
} from "./project-access.js";

const DATA_SHEETS = CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored);
const DATA_SHEET_NAMES = new Set(DATA_SHEETS.map(sheet => sheet.name));
const IGNORED_SHEETS = new Set(["Summary", "README"]);
const MONEY_TOLERANCE = 0.02;
const trustedPreflightResults = new WeakSet();

const FIELD_KEYS = Object.freeze({
  "From": "from",
  "To": "to",
  "VAT": "vat",
  "VAT Rate": "vatRate"
});

function fieldKey(header) {
  if(FIELD_KEYS[header]) return FIELD_KEYS[header];
  return header
    .replace(/[^A-Za-z0-9]+(.)/g, (_, character) => character.toUpperCase())
    .replace(/^[A-Z]/, character => character.toLowerCase());
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function identity(value) {
  return cleanText(value).toLocaleLowerCase("en-GB");
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function issue(severity, code, sheet, row, field, message, details = {}) {
  return { severity, code, sheet, row, field, message, ...details };
}

function addError(state, code, sheet, row, field, message, details) {
  state.errors.push(issue("error", code, sheet, row, field, message, details));
}

function addWarning(state, code, sheet, row, field, message, details) {
  state.warnings.push(issue("warning", code, sheet, row, field, message, details));
}

function isBlank(value) {
  return value === null || value === undefined || cleanText(value) === "";
}

function validDateParts(year, month, day) {
  if(!Number.isInteger(year) || year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function dateKey(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeWorkbookDate(value) {
  if(isBlank(value)) return { value: "", warning: "" };

  if(value instanceof Date){
    if(Number.isNaN(value.getTime())) return { error: "Enter a valid date." };
    return {
      value: dateKey(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      warning: ""
    };
  }

  if(typeof value === "number"){
    if(!Number.isFinite(value) || value < 1 || value >= 2958466){
      return { error: "Enter a valid Excel date." };
    }
    const milliseconds = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
    const date = new Date(milliseconds);
    return {
      value: dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      warning: ""
    };
  }

  const text = cleanText(value);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if(match){
    const [, year, month, day] = match.map(Number);
    return validDateParts(year, month, day)
      ? { value: dateKey(year, month, day), warning: "" }
      : { error: "Enter a valid date." };
  }

  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(match){
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return validDateParts(year, month, day)
      ? { value: dateKey(year, month, day), warning: "Legacy date text was normalized to YYYY-MM-DD." }
      : { error: "Enter a valid date." };
  }

  return { error: "Enter a valid Excel date or a supported DD/MM/YYYY date." };
}

export function normalizeWorkbookNumber(value, { money = false } = {}) {
  if(isBlank(value)) return { value: null, warning: "" };
  if(typeof value === "number"){
    return Number.isFinite(value)
      ? { value: money ? roundMoney(value) : value, warning: "" }
      : { error: "Enter a valid number." };
  }

  let text = cleanText(value);
  let negative = false;
  if(/^\(.*\)$/.test(text)){
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/^£\s*/, "").replace(/,/g, "").trim();
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)){
    return { error: money ? "Enter money as a number." : "Enter a valid number." };
  }
  const parsed = Number(text) * (negative ? -1 : 1);
  return Number.isFinite(parsed)
    ? {
        value: money ? roundMoney(parsed) : parsed,
        warning: "A legacy numeric string was normalized to a number."
      }
    : { error: "Enter a valid number." };
}

export function normalizeWorkbookVatRate(value) {
  if(isBlank(value)) return { value: null, warning: "" };
  let normalized;
  let warning = "";

  if(typeof value === "string" && cleanText(value).endsWith("%")){
    const parsed = normalizeWorkbookNumber(cleanText(value).slice(0, -1));
    if(parsed.error) return { error: "Enter a valid VAT percentage." };
    normalized = parsed.value / 100;
  }else{
    const parsed = normalizeWorkbookNumber(value);
    if(parsed.error) return { error: "Enter a valid VAT percentage." };
    normalized = parsed.value;
    if(normalized > 1 && normalized <= 100){
      normalized /= 100;
      warning = "A whole-number VAT rate was normalized to a percentage.";
    }
  }

  const allowed = [0.2, 0.05, 0];
  const matched = allowed.find(rate => Math.abs(rate - normalized) < 0.000001);
  return matched === undefined
    ? { error: "VAT Rate must be one of the rates currently supported by Simple Books: 20%, 5% or 0%." }
    : { value: matched, warning };
}

function enumValue(value, allowed, fallback, mappings = {}) {
  if(isBlank(value)) return { value: fallback, warning: "" };
  const text = cleanText(value);
  const mapped = mappings[identity(text)];
  if(mapped) return { value: mapped.value, warning: mapped.warning || "" };
  const match = allowed.find(option => identity(option) === identity(text));
  return match === undefined
    ? { error: `Use one of: ${allowed.join(", ")}.` }
    : { value: match, warning: match === text ? "" : "Enum casing was normalized." };
}

function worksheetRows(sheet, sheetName, rowsFromSheet) {
  if(Array.isArray(sheet)) return sheet;
  if(Array.isArray(sheet?.__rows)) return sheet.__rows;
  if(typeof rowsFromSheet !== "function"){
    throw new TypeError(`A rowsFromSheet adapter is required for ${sheetName}.`);
  }
  return rowsFromSheet(sheet, sheetName);
}

function excelColumnName(index) {
  let name = "";
  for(let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)){
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function hasFormula(sheet, rowIndex, columnIndex) {
  if(Array.isArray(sheet) || Array.isArray(sheet?.__rows)) return false;
  return Boolean(sheet?.[`${excelColumnName(columnIndex)}${rowIndex + 1}`]?.f);
}

function schemaHeaderLookup(schemaSheet) {
  const lookup = new Map();
  for(const column of schemaSheet.columns){
    for(const name of [column.header, ...column.aliases]){
      lookup.set(identity(name), column);
    }
  }
  return lookup;
}

function parseSheet(state, workbook, schemaSheet, rowsFromSheet) {
  const rawSheet = workbook.Sheets[schemaSheet.name];
  if(!rawSheet) return [];
  const rows = worksheetRows(rawSheet, schemaSheet.name, rowsFromSheet) || [];
  if(rows.length === 0 || rows.every(row => (row || []).every(isBlank))) return [];

  const headers = (rows[0] || []).map(cleanText);
  const lookup = schemaHeaderLookup(schemaSheet);
  const mappedHeaders = new Map();
  const unknownHeaders = [];

  headers.forEach((header, columnIndex) => {
    if(!header) return;
    const column = lookup.get(identity(header));
    if(!column){
      unknownHeaders.push(header);
      return;
    }
    const entries = mappedHeaders.get(column.header) || [];
    entries.push({ columnIndex, sourceHeader: header });
    mappedHeaders.set(column.header, entries);
  });

  for(const header of unknownHeaders){
    const paymentMethod = identity(header) === "payment method";
    addWarning(
      state,
      paymentMethod ? "legacy-field-not-imported" : "unknown-column",
      schemaSheet.name,
      1,
      header,
      paymentMethod
        ? "Legacy Payment Method has no canonical destination and was not added to the normalized record."
        : `Unknown column “${header}” was ignored.`
    );
  }

  const duplicateMappings = [...mappedHeaders.entries()]
    .filter(([header, entries]) => entries.length > 1 && header !== "Address");
  for(const [header] of duplicateMappings){
    addError(state, "duplicate-column", schemaSheet.name, 1, header, `More than one column maps to ${header}.`);
  }

  const records = [];
  rows.slice(1).forEach((rawRow, rowOffset) => {
    const row = rawRow || [];
    if(row.every(isBlank)) return;
    const rowNumber = rowOffset + 2;
    const record = { _sheet: schemaSheet.name, _row: rowNumber };

    for(const column of schemaSheet.columns){
      const mappings = mappedHeaders.get(column.header) || [];
      let rawValue = "";
      let sourceColumnIndex = -1;

      if(column.header === "Address" && mappings.length > 1){
        rawValue = mappings.map(mapping => cleanText(row[mapping.columnIndex])).filter(Boolean).join(", ");
        sourceColumnIndex = mappings[0]?.columnIndex ?? -1;
        if(rawValue){
          addWarning(state, "legacy-address-combined", schemaSheet.name, rowNumber, "Address", "Legacy split address fields were combined into canonical Address.");
        }
      }else if(mappings.length){
        sourceColumnIndex = mappings[0].columnIndex;
        rawValue = row[sourceColumnIndex];
      }

      const key = fieldKey(column.header);
      if(sourceColumnIndex >= 0 && hasFormula(rawSheet, rowNumber - 1, sourceColumnIndex)){
        if(column.calculated){
          record[key] = null;
          addWarning(state, "formula-ignored", schemaSheet.name, rowNumber, column.header, "The formula result was not trusted; Simple Books will calculate this value during validation or future execution.");
        }else{
          record[key] = null;
          addError(state, "formula-not-accepted", schemaSheet.name, rowNumber, column.header, "Formulas are not accepted for input fields.");
        }
        continue;
      }

      let normalized = { value: cleanText(rawValue), warning: "" };
      if(column.dataType === "date") normalized = normalizeWorkbookDate(rawValue);
      if(column.dataType === "money") normalized = normalizeWorkbookNumber(rawValue, { money: true });
      if(column.dataType === "integer" || column.dataType === "number") normalized = normalizeWorkbookNumber(rawValue);
      if(column.dataType === "percentage") normalized = normalizeWorkbookVatRate(rawValue);
      if(column.enumValues.length && column.dataType !== "percentage"){
        const fallback = defaultEnumValue(schemaSheet.name, column.header);
        const mappingsForEnum = enumMappings(schemaSheet.name, column.header);
        normalized = enumValue(rawValue, column.enumValues, fallback, mappingsForEnum);
      }

      if(normalized.error){
        record[key] = null;
        addError(state, "invalid-value", schemaSheet.name, rowNumber, column.header, normalized.error);
      }else{
        record[key] = normalized.value;
        if(normalized.warning){
          addWarning(state, "value-normalized", schemaSheet.name, rowNumber, column.header, normalized.warning);
        }
      }

      if(column.input === "required" && isBlank(rawValue)){
        addError(state, "required-field", schemaSheet.name, rowNumber, column.header, `${column.header} is required.`);
      }
    }

    records.push(record);
  });

  return records;
}

function defaultEnumValue(sheet, field) {
  const defaults = {
    "Clients.Status": "Lead",
    "Invoices.Status": "Unpaid",
    "Invoices.Recurring": "No",
    "Bills.Category": "General",
    "Bills.Status": "Unpaid",
    "Expenses.Category": "General",
    "Expenses.Status": "Draft",
    "Mileage.Status": "Draft",
    "Projects.Status": "Active",
    "Budgets.Status": "Active"
  };
  return defaults[`${sheet}.${field}`] ?? "";
}

function enumMappings(sheet, field) {
  if((sheet === "Invoices" || sheet === "Bills") && field === "Status"){
    return {
      overdue: {
        value: "Unpaid",
        warning: "Overdue was normalized to Unpaid because overdue is derived from due date."
      }
    };
  }
  return {};
}

function recordContext(record) {
  return [record._sheet, record._row];
}

function requireNonNegative(state, record, field, label, { positive = false } = {}) {
  const value = record[field];
  if(value === null || value === "") return;
  if(!Number.isFinite(value) || (positive ? value <= 0 : value < 0)){
    addError(state, "invalid-range", ...recordContext(record), label, `${label} must be ${positive ? "greater than zero" : "zero or more"}.`);
  }
}

function compareAmount(state, record, field, expected, message, severity = "warning") {
  const actual = record[field];
  if(actual === null || actual === "") return;
  if(Math.abs(actual - expected) > MONEY_TOLERANCE){
    const add = severity === "error" ? addError : addWarning;
    add(state, "arithmetic-discrepancy", ...recordContext(record), fieldLabel(field), message, { expected, actual });
  }
}

function fieldLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase());
}

function validateRows(state) {
  for(const client of state.records.clients){
    if(!cleanText(client.clientName)) addError(state, "required-field", ...recordContext(client), "Client Name", "Client Name is required.");
  }

  for(const item of state.records.invoiceItems){
    if(item.netAmount === null || item.netAmount === ""){
      addError(state, "required-field", ...recordContext(item), "Net Amount", "Net Amount is required.");
    }
    requireNonNegative(state, item, "netAmount", "Net Amount", { positive: true });
    if(!Number.isInteger(item.lineNumber) || item.lineNumber < 1){
      addError(state, "invalid-line-number", ...recordContext(item), "Line Number", "Line Number must be a positive whole number.");
    }
  }

  for(const bill of state.records.bills){
    requireNonNegative(state, bill, "net", "Net");
    const vatRate = bill.vatRate ?? inferVatRate(state, bill, "Bills");
    bill.vatRate = vatRate;
    const expectedVat = roundMoney((bill.net || 0) * (vatRate || 0));
    const expectedTotal = roundMoney((bill.net || 0) + expectedVat);
    compareAmount(state, bill, "vat", expectedVat, "Bill VAT does not match Net × VAT Rate.");
    compareAmount(state, bill, "total", expectedTotal, "Bill Total does not match Net + VAT.");
    bill.vat = expectedVat;
    bill.total = expectedTotal;
    if(bill.billDate && bill.dueDate && bill.dueDate < bill.billDate){
      addError(state, "date-order", ...recordContext(bill), "Due Date", "Bill Due Date cannot be before Bill Date.");
    }
  }

  for(const expense of state.records.expenses){
    requireNonNegative(state, expense, "net", "Net");
    const vatRate = expense.vatRate ?? inferVatRate(state, expense, "Expenses");
    expense.vatRate = vatRate;
    const expectedVat = roundMoney((expense.net || 0) * (vatRate || 0));
    const suppliedVat = expense.vat ?? expectedVat;
    if(Math.abs(suppliedVat - expectedVat) > MONEY_TOLERANCE){
      addWarning(state, "manual-vat-discrepancy", ...recordContext(expense), "VAT", "Expense VAT differs from Net × VAT Rate. The supplied VAT amount was preserved.", { expected: expectedVat, actual: suppliedVat });
    }
    expense.vat = suppliedVat;
    const expectedGross = roundMoney((expense.net || 0) + suppliedVat);
    compareAmount(state, expense, "gross", expectedGross, "Expense Gross does not match Net + the supplied VAT amount.");
    if(expense.gross === null) expense.gross = expectedGross;
  }

  for(const mileage of state.records.mileage){
    requireNonNegative(state, mileage, "miles", "Miles", { positive: true });
    if(mileage.ratePerMile === null){
      mileage.ratePerMile = 0.55;
      addWarning(state, "mileage-rate-defaulted", ...recordContext(mileage), "Rate Per Mile", "Missing Rate Per Mile was set to the application's current default of £0.55 for preflight.");
    }
    requireNonNegative(state, mileage, "ratePerMile", "Rate Per Mile", { positive: true });
    const expected = roundMoney((mileage.miles || 0) * (mileage.ratePerMile || 0));
    compareAmount(state, mileage, "amount", expected, "Mileage Amount does not match Miles × Rate Per Mile.");
    mileage.amount = expected;
  }

  for(const project of state.records.projects){
    requireNonNegative(state, project, "projectBudget", "Project Budget");
    if(project.startDate && project.endDate && project.endDate < project.startDate){
      addError(state, "date-order", ...recordContext(project), "End Date", "Project End Date cannot be before Start Date.");
    }
  }

  for(const budget of state.records.budgets){
    requireNonNegative(state, budget, "plannedAmount", "Planned Amount", { positive: true });
    budget.periodType = cleanText(budget.periodType).toLowerCase();
    budget.budgetType = cleanText(budget.budgetType).toLowerCase();
    if(budget.startDate && budget.endDate && budget.endDate < budget.startDate){
      addError(state, "date-order", ...recordContext(budget), "End Date", "Budget End Date cannot be before Start Date.");
    }
    validateBudgetPeriod(state, budget);
    if(budget.budgetType === "category" && !cleanText(budget.category)){
      addError(state, "budget-category-required", ...recordContext(budget), "Category", "Category is required for a Category budget.");
    }
    if(budget.budgetType === "overall" && cleanText(budget.category)){
      addWarning(state, "budget-category-ignored", ...recordContext(budget), "Category", "Category is not used for an Overall budget and was cleared.");
      budget.category = "";
    }
  }

  for(const invoice of state.records.invoices){
    if(invoice.invoiceDate && invoice.dueDate && invoice.dueDate < invoice.invoiceDate){
      addError(state, "date-order", ...recordContext(invoice), "Due Date", "Invoice Due Date cannot be before Invoice Date.");
    }
    if(invoice.recurring === "Yes"){
      if(!invoice.recurringFrequency){
        addError(state, "recurring-field-required", ...recordContext(invoice), "Recurring Frequency", "Recurring Frequency is required when Recurring is Yes.");
      }
      if(!invoice.nextInvoiceDate){
        addError(state, "recurring-field-required", ...recordContext(invoice), "Next Invoice Date", "Next Invoice Date is required when Recurring is Yes.");
      }
    }
  }
}

function inferVatRate(state, record, sheet) {
  if(Number.isFinite(record.net) && record.net > 0 && Number.isFinite(record.vat)){
    const inferred = normalizeWorkbookVatRate(record.vat / record.net);
    if(!inferred.error){
      addWarning(state, "vat-rate-inferred", ...recordContext(record), "VAT Rate", "Missing VAT Rate was inferred from Net and VAT.");
      return inferred.value;
    }
  }
  addWarning(state, "vat-rate-missing", ...recordContext(record), "VAT Rate", `Historical ${sheet} data has no VAT Rate; 0% was used for preflight.`);
  return 0;
}

function validateBudgetPeriod(state, budget) {
  if(!budget.startDate || !budget.endDate) return;
  const [startYear, startMonth] = budget.startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = budget.endDate.split("-").map(Number);
  if(budget.periodType === "monthly"){
    const lastDay = new Date(Date.UTC(startYear, startMonth, 0)).getUTCDate();
    if(budget.startDate !== dateKey(startYear, startMonth, 1) || budget.endDate !== dateKey(startYear, startMonth, lastDay)){
      addError(state, "budget-period-mismatch", ...recordContext(budget), "Period Type", "Monthly budget dates must cover one complete calendar month.");
    }
  }else if(budget.periodType === "quarterly"){
    const startQuarterMonth = Math.floor((startMonth - 1) / 3) * 3 + 1;
    const endQuarterMonth = startQuarterMonth + 2;
    const lastDay = new Date(Date.UTC(startYear, endQuarterMonth, 0)).getUTCDate();
    if(startMonth !== startQuarterMonth || budget.startDate !== dateKey(startYear, startQuarterMonth, 1) || budget.endDate !== dateKey(startYear, endQuarterMonth, lastDay)){
      addError(state, "budget-period-mismatch", ...recordContext(budget), "Period Type", "Quarterly budget dates must cover one complete calendar quarter.");
    }
  }else if(budget.periodType === "annual"){
    if(budget.startDate !== dateKey(startYear, 1, 1) || budget.endDate !== dateKey(startYear, 12, 31) || endYear !== startYear){
      addError(state, "budget-period-mismatch", ...recordContext(budget), "Period Type", "Annual budget dates must cover one complete calendar year.");
    }
  }
}

function addLegacyInvoiceItems(state, workbookType) {
  const invoicesWithItems = new Set(
    state.records.invoiceItems.map(item => identity(item.invoiceNumber)).filter(Boolean)
  );
  for(const invoice of state.records.invoices){
    const invoiceKey = identity(invoice.invoiceNumber);
    if(workbookType === "legacy" && !invoicesWithItems.has(invoiceKey) && invoice.net !== null){
      const description = invoice._legacyDescription || "Imported legacy invoice";
      const item = {
        _sheet: "Invoices",
        _row: invoice._row,
        invoiceNumber: invoice.invoiceNumber,
        lineNumber: 1,
        description,
        netAmount: invoice.net
      };
      state.records.invoiceItems.push(item);
      invoicesWithItems.add(invoiceKey);
      addWarning(
        state,
        invoice._legacyDescription ? "legacy-invoice-item-created" : "legacy-invoice-item-synthesized",
        "Invoices",
        invoice._row,
        "Invoice Number",
        invoice._legacyDescription
          ? "Legacy invoice Description was normalized into Invoice Items line 1."
          : "Historical line-item detail was unavailable, so one neutral compatibility line was reconstructed from the legacy invoice net amount."
      );
    }
    delete invoice._legacyDescription;
  }
}

function captureLegacyFields(state, workbook, rowsFromSheet) {
  const sheet = workbook.Sheets.Invoices;
  if(!sheet) return;
  const rows = worksheetRows(sheet, "Invoices", rowsFromSheet) || [];
  const headers = (rows[0] || []).map(cleanText);
  const descriptionIndex = headers.findIndex(header => identity(header) === "description");
  if(descriptionIndex < 0) return;
  let recordIndex = 0;
  for(const row of rows.slice(1)){
    if((row || []).every(isBlank)) continue;
    const record = state.records.invoices[recordIndex++];
    if(record) record._legacyDescription = cleanText(row[descriptionIndex]);
  }
}

function resolveRelationships(state, existing) {
  const clientNames = new Set([
    ...state.records.clients.map(record => identity(record.clientName)),
    ...(existing.clients || []).map(record => identity(record.clientName ?? record.name))
  ].filter(Boolean));
  const projectReferences = new Set([
    ...state.records.projects.map(record => identity(record.projectReference)),
    ...(existing.projects || []).map(record => identity(record.projectReference ?? record.reference))
  ].filter(Boolean));
  const invoiceNumbers = new Set([
    ...state.records.invoices.map(record => identity(record.invoiceNumber)),
    ...(existing.invoices || []).map(record => identity(record.invoiceNumber ?? record.invoiceNo))
  ].filter(Boolean));

  for(const source of [...state.records.invoices, ...state.records.projects]){
    if(source.clientName && !clientNames.has(identity(source.clientName))){
      addRelationshipError(state, source, "Client Name", "client", source.clientName);
    }
  }
  for(const source of [
    ...state.records.invoices,
    ...state.records.bills,
    ...state.records.expenses,
    ...state.records.mileage,
    ...state.records.budgets
  ]){
    if(source.projectReference && !projectReferences.has(identity(source.projectReference))){
      addRelationshipError(state, source, "Project Reference", "project", source.projectReference);
    }
  }

  const linesByInvoice = new Map();
  for(const item of state.records.invoiceItems){
    const key = identity(item.invoiceNumber);
    if(!invoiceNumbers.has(key)){
      addRelationshipError(state, item, "Invoice Number", "invoice", item.invoiceNumber);
    }
    const lines = linesByInvoice.get(key) || [];
    if(lines.some(existingItem => existingItem.lineNumber === item.lineNumber)){
      addError(state, "duplicate-line-number", ...recordContext(item), "Line Number", `Invoice ${item.invoiceNumber} has duplicate line number ${item.lineNumber}.`);
    }
    lines.push(item);
    linesByInvoice.set(key, lines);
  }

  for(const [invoiceNumber, lines] of linesByInvoice){
    if(lines.length > CANONICAL_WORKBOOK_SCHEMA.constraints.maximumInvoiceItemsPerInvoice){
      const first = lines[CANONICAL_WORKBOOK_SCHEMA.constraints.maximumInvoiceItemsPerInvoice];
      addError(state, "invoice-item-limit", ...recordContext(first), "Invoice Number", `Invoice ${invoiceNumber} has more than three line items.`);
    }
  }

  for(const invoice of state.records.invoices){
    const items = linesByInvoice.get(identity(invoice.invoiceNumber)) || [];
    if(items.length){
      const expectedNet = roundMoney(items.reduce((sum, item) => sum + (item.netAmount || 0), 0));
      compareAmount(state, invoice, "net", expectedNet, "Invoice Net does not match its Invoice Items.");
      invoice.net = expectedNet;
      const rate = invoice.vatRate ?? inferVatRate(state, invoice, "Invoices");
      invoice.vatRate = rate;
      const expectedVat = roundMoney(expectedNet * rate);
      const expectedTotal = roundMoney(expectedNet + expectedVat);
      compareAmount(state, invoice, "vat", expectedVat, "Invoice VAT does not match Net × VAT Rate.");
      compareAmount(state, invoice, "total", expectedTotal, "Invoice Total does not match Net + VAT.");
      invoice.vat = expectedVat;
      invoice.total = expectedTotal;
    }else{
      addWarning(state, "invoice-items-missing", ...recordContext(invoice), "Invoice Number", "No invoice-item detail is available; line-level fidelity cannot be confirmed.");
      if(state.workbookType === "canonical"){
        addError(state, "invoice-items-required", ...recordContext(invoice), "Invoice Number", "Canonical invoices require at least one Invoice Items row.");
      }
      if(invoice.net === null){
        addError(state, "required-field", ...recordContext(invoice), "Net", "Invoice Net or Invoice Items are required to validate the invoice amount.");
      }else{
        const rate = invoice.vatRate ?? inferVatRate(state, invoice, "Invoices");
        invoice.vatRate = rate;
        const expectedVat = roundMoney(invoice.net * rate);
        const expectedTotal = roundMoney(invoice.net + expectedVat);
        compareAmount(state, invoice, "vat", expectedVat, "Invoice VAT does not match Net × VAT Rate.");
        compareAmount(state, invoice, "total", expectedTotal, "Invoice Total does not match Net + VAT.");
        invoice.vat = expectedVat;
        invoice.total = expectedTotal;
      }
    }
  }
}

function addRelationshipError(state, record, field, targetType, value) {
  const unresolved = { sheet: record._sheet, row: record._row, field, targetType, value };
  state.unresolvedRelationships.push(unresolved);
  addError(state, "unresolved-relationship", ...recordContext(record), field, `${field} “${value}” does not match a workbook or existing-account ${targetType}.`);
}

function duplicateKey(moduleName, record) {
  if(moduleName === "clients") return identity(record.clientName ?? record.name);
  if(moduleName === "invoices") return identity(record.invoiceNumber ?? record.invoiceNo);
  if(moduleName === "projects") return identity(record.projectReference ?? record.reference);
  if(moduleName === "bills"){
    const number = identity(record.billNumber);
    if(number) return `number:${number}`;
    const supplier = identity(record.supplier);
    const date = cleanText(record.billDate);
    const total = Number(record.total);
    return supplier && date && Number.isFinite(total) ? `fallback:${supplier}|${date}|${roundMoney(total).toFixed(2)}` : "";
  }
  if(moduleName === "expenses"){
    const merchant = identity(record.merchant);
    return merchant && record.date && Number.isFinite(record.gross)
      ? `${record.date}|${merchant}|${roundMoney(record.gross).toFixed(2)}` : "";
  }
  if(moduleName === "mileage"){
    return record.date && record.from && record.to && Number.isFinite(record.miles)
      ? `${record.date}|${identity(record.from)}|${identity(record.to)}|${Number(record.miles).toFixed(1)}` : "";
  }
  return "";
}

function detectDuplicates(state, existing) {
  for(const moduleName of ["clients", "invoices", "bills", "expenses", "mileage", "projects"]){
    const seen = new Map();
    const existingKeys = new Set((existing[moduleName] || []).map(record => duplicateKey(moduleName, record)).filter(Boolean));
    for(const record of state.records[moduleName]){
      const key = duplicateKey(moduleName, record);
      if(!key) continue;
      if(seen.has(key)){
        addError(state, "duplicate-workbook-record", ...recordContext(record), "", `This ${moduleName.slice(0, -1)} duplicates row ${seen.get(key)} in the workbook.`);
      }else{
        seen.set(key, record._row);
      }
      if(existingKeys.has(key)){
        state.duplicateCandidates.push({
          module: moduleName,
          sheet: record._sheet,
          row: record._row,
          key,
          source: "existing-account",
          proposedAction: "skip"
        });
        addWarning(state, "existing-duplicate", ...recordContext(record), "", "A likely existing record was found; the proposed future action is skip, never overwrite.");
      }
    }
  }
}

function validateStarterProjectLimit(state, context) {
  const activeWorkbookProjects = state.records.projects.filter(project => project.status === PROJECT_STATUS.ACTIVE);
  if(!Object.prototype.hasOwnProperty.call(context, "plan") && !Object.prototype.hasOwnProperty.call(context, "demoMode")){
    if(activeWorkbookProjects.length){
      addWarning(state, "active-project-limit-not-evaluated", "Projects", 0, "Status", "Active-project capacity was not evaluated because account plan context was not supplied.");
    }
    return;
  }
  const existingProjects = context.existing?.projects || [];
  const duplicateRows = new Set(
    state.duplicateCandidates
      .filter(candidate => candidate.module === "projects")
      .map(candidate => candidate.row)
  );
  const projected = [...existingProjects];
  for(const project of activeWorkbookProjects){
    if(project.status !== PROJECT_STATUS.ACTIVE || duplicateRows.has(project._row)) continue;
    if(!canUseAnotherActiveProject(context.plan, projected, context.demoMode === true)){
      addError(state, "active-project-limit", ...recordContext(project), "Status", "Importing this Active project would exceed the account's current active-project limit.");
      continue;
    }
    projected.push({ status: PROJECT_STATUS.ACTIVE });
  }
}

function detectWorkbookType(sheetNames) {
  const names = new Set(sheetNames);
  if(names.has("Invoice Items") || names.has("Projects") || names.has("Budgets")){
    return "canonical";
  }
  return "legacy";
}

function cleanRecords(records) {
  return Object.fromEntries(Object.entries(records).map(([moduleName, moduleRecords]) => [
    moduleName,
    moduleRecords.map(record => ({
      ...Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith("_"))),
      source: { sheet: record._sheet, row: record._row }
    }))
  ]));
}

function deepFreeze(value) {
  if(!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function isTrustedWorkbookPreflightResult(value) {
  return Boolean(value && trustedPreflightResults.has(value));
}

export function preflightCanonicalWorkbook(workbook, options = {}) {
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  if(!workbook?.Sheets || sheetNames.length === 0){
    throw new TypeError("A readable workbook with at least one sheet is required.");
  }

  const workbookType = detectWorkbookType(sheetNames);
  const state = {
    workbookType,
    records: {
      clients: [], invoices: [], invoiceItems: [], bills: [], expenses: [],
      mileage: [], projects: [], budgets: []
    },
    errors: [],
    warnings: [],
    duplicateCandidates: [],
    unresolvedRelationships: []
  };

  if(workbookType === "canonical"){
    for(const schemaSheet of DATA_SHEETS){
      if(!workbook.Sheets[schemaSheet.name]){
        addError(state, "missing-sheet", schemaSheet.name, 0, "", `Canonical workbook is missing the ${schemaSheet.name} sheet.`);
      }
    }
  }

  if(!sheetNames.some(sheetName => DATA_SHEET_NAMES.has(sheetName))){
    addError(state, "no-business-sheets", "Workbook", 0, "", "Workbook contains no recognized Simple Books data sheets.");
  }

  for(const sheetName of sheetNames){
    if(!DATA_SHEET_NAMES.has(sheetName) && !IGNORED_SHEETS.has(sheetName)){
      addWarning(state, "unknown-sheet", sheetName, 0, "", `Unknown sheet “${sheetName}” was ignored.`);
    }
  }

  const moduleNames = ["clients", "invoices", "invoiceItems", "bills", "expenses", "mileage", "projects", "budgets"];
  DATA_SHEETS.forEach((schemaSheet, index) => {
    state.records[moduleNames[index]] = parseSheet(state, workbook, schemaSheet, options.rowsFromSheet);
  });

  captureLegacyFields(state, workbook, options.rowsFromSheet);
  addLegacyInvoiceItems(state, workbookType);
  validateRows(state);
  detectDuplicates(state, options.existing || {});
  resolveRelationships(state, options.existing || {});
  validateStarterProjectLimit(state, options);

  const normalizedRecords = cleanRecords(state.records);
  const counts = Object.fromEntries(
    Object.entries(normalizedRecords).map(([moduleName, records]) => [moduleName, records.length])
  );

  const result = deepFreeze({
    contract: "simple-books-workbook-preflight-v1",
    schema: {
      id: CANONICAL_WORKBOOK_SCHEMA.id,
      version: workbookType === "canonical" ? CANONICAL_WORKBOOK_SCHEMA.version : null,
      detected: workbookType === "canonical"
    },
    workbookType,
    records: normalizedRecords,
    counts,
    errors: state.errors,
    warnings: state.warnings,
    duplicateCandidates: state.duplicateCandidates,
    unresolvedRelationships: state.unresolvedRelationships,
    safeToProceed: state.errors.length === 0
  });
  trustedPreflightResults.add(result);
  return result;
}

if(typeof window !== "undefined"){
  window.simpleBooksWorkbookPreflight = Object.freeze({
    preflight: preflightCanonicalWorkbook
  });
}
