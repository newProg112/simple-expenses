/* eslint-disable max-len, require-jsdoc, quote-props */

"use strict";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value, label, {positive = false} = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (positive && amount <= 0) ||
    Math.abs(amount * 100 - Math.round(amount * 100)) >= 1e-8) {
    throw new Error(`${label} is invalid.`);
  }
  return roundMoney(amount);
}

function inputDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const candidate = `${match[3]}-${match[2]}-${match[1]}`;
    return validCalendarDate(candidate);
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (match) return validCalendarDate(`${match[1]}-${match[2]}-${match[3]}`);
  throw new Error("A valid transaction date is required.");
}

function validCalendarDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day) {
    throw new Error("A valid transaction date is required.");
  }
  return value;
}

function journalId(uid, prefix, sourceId) {
  return `${prefix}_${encodeURIComponent(uid)}_${encodeURIComponent(sourceId)}`;
}

function serialise(uid, id, sourceNumber, createdAt, journal) {
  const debits = roundMoney(journal.lines.reduce((sum, line) => sum + line.debit, 0));
  const credits = roundMoney(journal.lines.reduce((sum, line) => sum + line.credit, 0));
  if (!journal.lines.length || debits !== credits) throw new Error("Journal is not balanced.");
  return {
    userId: uid,
    journalId: id,
    date: journal.date,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    sourceNumber: sourceNumber || "",
    description: journal.description,
    createdAt,
    updatedAt: createdAt,
    reversedJournalId: "",
    lines: journal.lines,
  };
}

function invoiceJournal(uid, sourceId, source, createdAt) {
  const items = source.items.map((item) => ({
    description: String(item.description).trim(),
    amount: money(item.amount, "Invoice line amount"),
  })).filter((item) => item.description && item.amount > 0);
  const net = roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  if (!items.length || net !== money(source.amount, "Invoice net", {positive: true})) {
    throw new Error("Invoice net does not equal its line-item total.");
  }
  const vat = money(source.vat, "Invoice VAT");
  const total = money(source.total, "Invoice total", {positive: true});
  if (roundMoney(net + vat) !== total) throw new Error("Invoice total does not equal net plus VAT.");
  const number = source.invoiceNo || sourceId;
  const description = `Sales invoice ${number} - ${source.client || "customer"}`;
  const lines = [
    {accountCode: "1100", description, debit: total, credit: 0},
    ...items.map((item) => ({
      accountCode: "4000", description: item.description, debit: 0, credit: item.amount,
    })),
  ];
  if (vat > 0) {
    lines.push({
      accountCode: "2100", description: `VAT on invoice ${number}`, debit: 0, credit: vat,
    });
  }
  const id = journalId(uid, "invoice", sourceId);
  return {id, data: serialise(uid, id, source.invoiceNo, createdAt, {
    date: inputDate(source.date), sourceType: "salesInvoice", sourceId, description, lines,
  })};
}

const BILL_ACCOUNTS = Object.freeze({
  travel: "5200", mileage: "5200", utilities: "5300", utility: "5300",
  "professional fees": "5400", professional: "5400", accounting: "5400", legal: "5400",
  software: "5500", "software/subscriptions": "5500", subscriptions: "5500",
  subscription: "5500", "travel/mileage": "5200",
});

function billJournal(uid, sourceId, source, createdAt) {
  const net = money(source.net, "Bill net", {positive: true});
  const vat = money(source.vat, "Bill VAT");
  const total = money(source.total, "Bill total", {positive: true});
  if (roundMoney(net + vat) !== total) throw new Error("Bill total does not equal net plus VAT.");
  const number = source.billNumber || sourceId;
  const description = `Supplier bill ${number} - ${source.supplier || "supplier"}`;
  const category = String(source.category || "").trim().toLowerCase().replace(/\s+/g, " ");
  const lines = [{
    accountCode: BILL_ACCOUNTS[category] || "5000", description, debit: net, credit: 0,
  }];
  if (vat > 0) {
    lines.push({
      accountCode: "1200", description: `VAT on bill ${number}`, debit: vat, credit: 0,
    });
  }
  lines.push({accountCode: "2000", description, debit: 0, credit: total});
  const id = journalId(uid, "bill", sourceId);
  return {id, data: serialise(uid, id, source.billNumber, createdAt, {
    date: inputDate(source.billDate), sourceType: "supplierBill", sourceId, description, lines,
  })};
}

module.exports = {billJournal, invoiceJournal};
