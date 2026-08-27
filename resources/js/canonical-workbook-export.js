import {
  CANONICAL_WORKBOOK_SCHEMA,
  WORKBOOK_SCHEMA_VERSION
} from "./canonical-workbook-schema.js";
import {
  applyCanonicalDataSheetFormatting
} from "./canonical-workbook-template.js";

export const CANONICAL_EXPORT_SHEET_NAMES = Object.freeze(
  CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => sheet.name)
);

const DATA_SHEETS = CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored);
const MAX_INVOICE_ITEMS = CANONICAL_WORKBOOK_SCHEMA.constraints.maximumInvoiceItemsPerInvoice;

function text(value) {
  return String(value ?? "").trim();
}

function identity(value) {
  return text(value).toLocaleLowerCase("en-GB");
}

function finiteNumber(value, fallback = 0) {
  if(value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value, fallback = 0) {
  return Math.round((finiteNumber(value, fallback) + Number.EPSILON) * 100) / 100;
}

function optionalMoney(value) {
  return value === "" || value === null || value === undefined ? "" : money(value);
}

function dateCell(value) {
  if(!value) return "";
  const source = typeof value?.toDate === "function" ? value.toDate() : value;
  if(source instanceof Date){
    if(Number.isNaN(source.getTime())) return "";
    return new Date(source.getFullYear(), source.getMonth(), source.getDate());
  }
  const valueText = text(source);
  let match = valueText.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = valueText.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime())
    ? ""
    : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function vatRate(value, net = 0, vat = 0) {
  let rate = Number(value);
  if(!Number.isFinite(rate) && finiteNumber(net) > 0){
    rate = finiteNumber(vat) / finiteNumber(net);
  }
  if(!Number.isFinite(rate)) return 0;
  if(rate > 1 && rate <= 100) rate /= 100;
  return rate;
}

function enumLabel(value, fallback = "") {
  const normalized = text(value);
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase()
    : fallback;
}

function yesNo(value) {
  if(value === true) return "Yes";
  if(value === false) return "No";
  return identity(value) === "yes" || identity(value) === "true" ? "Yes" : "No";
}

function sourcePeople(source) {
  return [
    ...(source.clients || []).map(record => ({ ...record, _kind: "client" })),
    ...(source.customers || []).map(record => ({ ...record, _kind: "customer" }))
  ].filter(record => text(record.name ?? record.clientName ?? record.customerName ?? record.businessName));
}

function personName(record) {
  return text(record.name ?? record.clientName ?? record.customerName ?? record.businessName);
}

function clustersForPeople(people) {
  const parent = people.map((_, index) => index);
  const root = (index) => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const join = (left, right) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if(leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const tokens = new Map();

  people.forEach((person, index) => {
    const personTokens = [
      identity(person.nameKey || personName(person)) && `name:${identity(person.nameKey || personName(person))}`,
      identity(person.emailKey || person.email) && `email:${identity(person.emailKey || person.email)}`
    ].filter(Boolean);
    personTokens.forEach((token) => {
      if(tokens.has(token)) join(index, tokens.get(token));
      else tokens.set(token, index);
    });
  });

  const clusters = new Map();
  people.forEach((person, index) => {
    const key = root(index);
    clusters.set(key, [...(clusters.get(key) || []), person]);
  });
  return [...clusters.values()];
}

function preferredValue(records, fields, kinds = ["client", "customer"]) {
  for(const kind of kinds){
    for(const record of records.filter(candidate => candidate._kind === kind)){
      for(const field of fields){
        if(text(record[field])) return text(record[field]);
      }
    }
  }
  return "";
}

function materiallyDifferentValues(records, fields) {
  return new Set(records.flatMap(record => fields.map(field => text(record[field])))
    .filter(Boolean).map(identity)).size > 1;
}

export function reconcileCanonicalClients(source, warnings = []) {
  const people = sourcePeople(source);
  const clients = clustersForPeople(people).map((records) => {
    const nameFields = ["name", "clientName", "customerName", "businessName"];
    if(materiallyDifferentValues(records, nameFields) || materiallyDifferentValues(records, ["email"])){
      warnings.push(`Client data for ${preferredValue(records, nameFields) || "an unnamed customer"} differs between saved records; the Client Tracker value was preferred and the structured customer fields were retained where available.`);
    }
    return {
      "Client Name": preferredValue(records, nameFields),
      "Email": preferredValue(records, ["email"]),
      "Phone": preferredValue(records, ["phone"]),
      "Address": preferredValue(records, ["address", "clientAddress"], ["customer", "client"]),
      "Payment Terms": preferredValue(records, ["paymentTerms"], ["customer", "client"]),
      "Status": preferredValue(records, ["status"]) || "Lead",
      "Follow Up Date": dateCell(preferredValue(records, ["followUp", "followUpDate"])),
      "Last Contacted Date": dateCell(preferredValue(records, ["lastContacted", "lastContactedDate"])),
      "Notes": preferredValue(records, ["notes"])
    };
  });

  const knownNames = new Set(clients.map(row => identity(row["Client Name"])));
  for(const invoice of source.invoices || []){
    const name = text(invoice.client ?? invoice.clientName);
    if(!name || knownNames.has(identity(name))) continue;
    clients.push({
      "Client Name": name,
      "Email": text(invoice.clientEmail),
      "Phone": "",
      "Address": text(invoice.clientAddress),
      "Payment Terms": text(invoice.paymentTerms),
      "Status": "Lead",
      "Follow Up Date": "",
      "Last Contacted Date": "",
      "Notes": ""
    });
    knownNames.add(identity(name));
    warnings.push(`Client ${name} was reconstructed from an invoice because no matching Client Tracker or customer record was available.`);
  }
  return clients;
}

function canonicalInvoiceRows(source, warnings) {
  const invoices = [];
  const items = [];
  for(const invoice of source.invoices || []){
    const invoiceNumber = text(invoice.invoiceNo ?? invoice.invoiceNumber);
    const storedItems = Array.isArray(invoice.items) ? invoice.items : [];
    if(!storedItems.length){
      warnings.push(`Invoice ${invoiceNumber || "(number unavailable)"} has no stored line-item detail and cannot be recreated with full line-level fidelity.`);
    }
    if(storedItems.length > MAX_INVOICE_ITEMS){
      warnings.push(`Invoice ${invoiceNumber || "(number unavailable)"} has more than ${MAX_INVOICE_ITEMS} stored items; only the supported first ${MAX_INVOICE_ITEMS} were exported.`);
    }
    storedItems.slice(0, MAX_INVOICE_ITEMS).forEach((item, index) => {
      items.push({
        "Invoice Number": invoiceNumber,
        "Line Number": index + 1,
        "Description": text(item.description),
        "Net Amount": money(item.amount ?? item.netAmount ?? item.net)
      });
    });
    const net = money(invoice.amount ?? invoice.net);
    const vat = money(invoice.vat);
    invoices.push({
      "Invoice Number": invoiceNumber,
      "Client Name": text(invoice.client ?? invoice.clientName),
      "Invoice Date": dateCell(invoice.date ?? invoice.invoiceDate),
      "Payment Terms": text(invoice.paymentTerms),
      "Due Date": dateCell(invoice.dueDate),
      "Project Reference": text(invoice.projectReference),
      "VAT Rate": vatRate(invoice.vatRate, net, vat),
      "Net": net,
      "VAT": vat,
      "Total": money(invoice.total, net + vat),
      "Status": text(invoice.status) || "Unpaid",
      "Recurring": yesNo(invoice.recurringInvoice ?? invoice.recurring),
      "Recurring Frequency": enumLabel(invoice.recurringFrequency),
      "Next Invoice Date": dateCell(invoice.nextInvoiceDate),
      "Reminder Date": dateCell(invoice.reminderDate)
    });
  }
  return { invoices, items };
}

function canonicalBillRows(source) {
  return (source.bills || []).map((bill) => {
    const net = money(bill.net ?? bill.amount);
    const vat = money(bill.vat);
    return {
      "Supplier": text(bill.supplier),
      "Bill Number": text(bill.billNumber),
      "Bill Date": dateCell(bill.billDate ?? bill.date),
      "Due Date": dateCell(bill.dueDate),
      "Category": text(bill.category) || "General",
      "Project Reference": text(bill.projectReference),
      "Net": net,
      "VAT Rate": vatRate(bill.vatRate, net, vat),
      "VAT": vat,
      "Total": money(bill.total, net + vat),
      "Status": text(bill.status) || "Unpaid",
      "Notes": text(bill.notes)
    };
  });
}

function canonicalExpenseRows(source) {
  return (source.expenses || []).map((expense) => {
    const net = money(expense.net ?? expense.netAmount);
    const vat = money(expense.vat ?? expense.vatAmount);
    return {
      "Date": dateCell(expense.date),
      "Merchant": text(expense.merchant ?? expense.supplier),
      "Category": text(expense.category) || "General",
      "Description": text(expense.description),
      "Project Reference": text(expense.projectReference),
      "Net": net,
      "VAT Rate": vatRate(expense.vatRate, net, vat),
      "VAT": vat,
      "Gross": money(expense.gross ?? expense.grossAmount ?? expense.total, net + vat),
      "Status": text(expense.status) || "Draft",
      "Notes": text(expense.notes)
    };
  });
}

function canonicalMileageRows(source) {
  return (source.mileage || []).map((record) => {
    const miles = finiteNumber(record.miles);
    const rate = finiteNumber(record.ratePerMile ?? record.mileageRate);
    return {
      "Date": dateCell(record.date),
      "From": text(record.from),
      "To": text(record.to),
      "Business Purpose": text(record.businessPurpose ?? record.purpose),
      "Project Reference": text(record.projectReference),
      "Miles": miles,
      "Rate Per Mile": rate,
      "Amount": money(record.amount ?? record.mileageAmount ?? record.gross, miles * rate),
      "Status": text(record.status) || "Draft",
      "Notes": text(record.notes)
    };
  });
}

function canonicalProjectRows(source, warnings) {
  const references = new Map();
  return (source.projects || []).map((project) => {
    const reference = text(project.reference ?? project.projectReference);
    if(!reference){
      warnings.push(`Project ${text(project.name ?? project.projectName) || "(name unavailable)"} has no stable Project Reference; no replacement reference was invented.`);
    }else if(references.has(identity(reference))){
      warnings.push(`Project Reference ${reference} is used by more than one saved Project; the references were preserved and canonical preflight will require the ambiguity to be corrected before import.`);
    }
    references.set(identity(reference), true);
    return {
      "Project Reference": reference,
      "Project Name": text(project.name ?? project.projectName),
      "Client Name": text(project.customerName ?? project.clientName),
      "Description": text(project.description),
      "Status": enumLabel(project.status, "Active"),
      "Start Date": dateCell(project.startDate),
      "End Date": dateCell(project.endDate),
      "Project Budget": optionalMoney(project.budget ?? project.projectBudget)
    };
  });
}

function canonicalBudgetRows(source) {
  return (source.budgets || []).map(budget => ({
    "Budget Name": text(budget.name ?? budget.budgetName),
    "Period Type": enumLabel(budget.periodType),
    "Start Date": dateCell(budget.startDate),
    "End Date": dateCell(budget.endDate),
    "Budget Type": enumLabel(budget.budgetType),
    "Category": identity(budget.budgetType) === "overall" ? "" : text(budget.category),
    "Project Reference": text(budget.projectReference),
    "Planned Amount": money(budget.plannedAmount),
    "Status": enumLabel(budget.status, "Active")
  }));
}

function summaryRows(data, exportedAt, warnings) {
  const invoiceTotal = data.Invoices.reduce((sum, row) => sum + finiteNumber(row.Total), 0);
  const unpaidBills = data.Bills.filter(row => identity(row.Status) !== "paid")
    .reduce((sum, row) => sum + finiteNumber(row.Total), 0);
  const portabilityWarnings = [...warnings];
  const rows = [
    ["Simple Books Workbook", ""],
    ["Exported", exportedAt],
    ["Workbook schema", `Version ${WORKBOOK_SCHEMA_VERSION}`],
    ["", ""],
    ["Records", "Count"],
    ...DATA_SHEETS.map(sheet => [sheet.name, data[sheet.name].length]),
    ["", ""],
    ["Invoice total", money(invoiceTotal)],
    ["Unpaid bills total", money(unpaidBills)],
    ["", ""],
    ["Import note", "Summary is not imported. This workbook can be imported back into Simple Books without changing its sheets or headings."]
  ];
  if(portabilityWarnings.length){
    rows.push(["", ""], ["Data quality", `${portabilityWarnings.length} warning${portabilityWarnings.length === 1 ? "" : "s"}`]);
    portabilityWarnings.slice(0, 8).forEach(warning => rows.push(["Warning", warning]));
    if(portabilityWarnings.length > 8){
      rows.push(["Warning", `${portabilityWarnings.length - 8} additional warning(s) were omitted to keep Summary concise.`]);
    }
  }
  return rows;
}

export function buildCanonicalExportDefinition(source = {}, options = {}) {
  const warnings = [];
  const invoiceData = canonicalInvoiceRows(source, warnings);
  const data = {
    Clients: reconcileCanonicalClients(source, warnings),
    Invoices: invoiceData.invoices,
    "Invoice Items": invoiceData.items,
    Bills: canonicalBillRows(source),
    Expenses: canonicalExpenseRows(source),
    Mileage: canonicalMileageRows(source),
    Projects: canonicalProjectRows(source, warnings),
    Budgets: canonicalBudgetRows(source)
  };
  const hasPaidSource = [...data.Invoices, ...data.Bills]
    .some(row => identity(row.Status) === "paid");
  if(hasPaidSource){
    warnings.unshift("Paid invoices or bills retain their Status, but cannot be recreated in a blank account without payment history; canonical import will stop those new records safely.");
  }
  const exportedAt = options.exportedAt instanceof Date ? options.exportedAt : new Date(options.exportedAt || Date.now());
  return {
    warnings,
    sheets: CANONICAL_WORKBOOK_SCHEMA.sheets.map(schemaSheet => schemaSheet.importIgnored
      ? { name: schemaSheet.name, kind: "summary", rows: summaryRows(data, exportedAt, warnings) }
      : {
          name: schemaSheet.name,
          kind: "data",
          headers: schemaSheet.columns.map(column => column.header),
          rows: data[schemaSheet.name]
        })
  };
}

export function buildCanonicalExportWorkbook(XLSX, source = {}, options = {}) {
  if(!XLSX?.utils?.book_new || !XLSX?.utils?.aoa_to_sheet || !XLSX?.utils?.book_append_sheet){
    throw new TypeError("A compatible SheetJS library is required to build the workbook.");
  }
  const definition = buildCanonicalExportDefinition(source, options);
  const workbook = XLSX.utils.book_new();
  for(const sheet of definition.sheets){
    const rows = sheet.kind === "summary"
      ? sheet.rows
      : [sheet.headers, ...sheet.rows.map(row => sheet.headers.map(header => row[header] ?? ""))];
    const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "dd/mm/yyyy" });
    if(sheet.kind === "summary"){
      worksheet["!cols"] = [{ wch: 24 }, { wch: 94 }];
      worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
      const titleCell = worksheet.A1;
      if(titleCell) titleCell.s = { ...(titleCell.s || {}), font: { bold: true, sz: 16 } };
      if(worksheet.B2) worksheet.B2.z = "dd/mm/yyyy hh:mm";
      for(const address of ["B15", "B16"]){
        const cell = worksheet[address];
        if(cell?.t === "n") cell.z = "£#,##0.00;[Red]-£#,##0.00";
      }
    }else{
      const schemaSheet = CANONICAL_WORKBOOK_SCHEMA.sheets.find(candidate => candidate.name === sheet.name);
      applyCanonicalDataSheetFormatting(XLSX, worksheet, schemaSheet, sheet.rows.length);
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return { workbook, warnings: definition.warnings };
}
