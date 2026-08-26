/* eslint-disable max-len, require-jsdoc */

"use strict";

const {ReferenceRegistryError} = require("./reference-registry-service");

const INVOICE_FIELDS = new Set([
  "invoiceNo", "client", "clientEmail", "clientAddress", "paymentTerms", "dueDate",
  "amount", "vatRate", "vat", "total", "items", "status", "date", "recurringInvoice",
  "recurringFrequency", "nextInvoiceDate", "reminderDate", "projectId", "projectName",
  "projectReference",
]);
const INVOICE_EDIT_FIELDS = new Set([
  ...INVOICE_FIELDS,
  "businessName", "businessEmail", "businessWebsite", "businessVat",
]);
const BILL_FIELDS = new Set([
  "id", "supplier", "billNumber", "billDate", "dueDate", "category", "net", "vatRate", "vat",
  "total", "status", "notes", "projectId", "projectName", "projectReference",
  "attachmentName", "attachmentUrl", "attachmentPath", "attachmentSize", "attachmentType",
]);
const BILL_EDIT_FIELDS = new Set(
    [...BILL_FIELDS].filter((field) => field !== "id"),
);

function invalid(message = "Create payload is invalid.") {
  throw new ReferenceRegistryError("invalid-argument", message);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function string(value, field, max = 4000) {
  if (typeof value !== "string" || value.length > max) invalid(`${field} is invalid.`);
  return value;
}

function number(value, field, {positive = false} = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
    (positive && value <= 0) || Math.abs(value * 100 - Math.round(value * 100)) >= 1e-8) {
    invalid(`${field} is invalid.`);
  }
  return value;
}

function exactFields(payload, allowed) {
  if (!plainObject(payload) || Object.keys(payload).some((field) => !allowed.has(field))) invalid();
}

function project(payload) {
  return {
    projectId: string(payload.projectId, "projectId", 512),
    projectName: string(payload.projectName, "projectName", 512),
    projectReference: string(payload.projectReference, "projectReference", 512),
  };
}

function invoice(payload, {edit = false} = {}) {
  exactFields(payload, edit ? INVOICE_EDIT_FIELDS : INVOICE_FIELDS);
  if (!edit && payload.status !== "Unpaid") {
    invalid("A new Invoice must have Unpaid status.");
  }
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 3) invalid("Invoice items are invalid.");
  const items = payload.items.map((item) => {
    if (!plainObject(item) || Object.keys(item).some((field) => !["description", "amount"].includes(field))) invalid("Invoice item is invalid.");
    return {description: string(item.description, "item description", 1000), amount: number(item.amount, "item amount", {positive: true})};
  });
  return {
    invoiceNo: string(payload.invoiceNo, "invoiceNo", 512),
    client: string(payload.client, "client", 512),
    clientEmail: string(payload.clientEmail, "clientEmail", 512),
    clientAddress: string(payload.clientAddress, "clientAddress", 4000),
    paymentTerms: string(payload.paymentTerms, "paymentTerms", 128),
    dueDate: string(payload.dueDate, "dueDate", 32),
    amount: number(payload.amount, "amount", {positive: true}),
    ...(payload.vatRate === undefined ? {} : {vatRate: number(payload.vatRate, "vatRate")}),
    vat: number(payload.vat, "vat"), total: number(payload.total, "total", {positive: true}),
    items, ...(edit ? {} : {status: "Unpaid"}), date: string(payload.date, "date", 32),
    recurringInvoice: string(payload.recurringInvoice, "recurringInvoice", 32),
    recurringFrequency: string(payload.recurringFrequency, "recurringFrequency", 64),
    nextInvoiceDate: string(payload.nextInvoiceDate, "nextInvoiceDate", 32),
    reminderDate: string(payload.reminderDate, "reminderDate", 32),
    ...project(payload),
    ...(edit ? {
      businessName: string(payload.businessName, "businessName", 512),
      businessEmail: string(payload.businessEmail, "businessEmail", 512),
      businessWebsite: string(payload.businessWebsite, "businessWebsite", 2048),
      businessVat: string(payload.businessVat, "businessVat", 128),
    } : {}),
  };
}

function bill(payload, {edit = false} = {}) {
  exactFields(payload, edit ? BILL_EDIT_FIELDS : BILL_FIELDS);
  if (!string(payload.supplier, "supplier", 512).trim()) invalid("supplier is required.");
  if (!["Unpaid", "Paid"].includes(payload.status)) invalid("Bill status is invalid.");
  const net = number(payload.net, "net", {positive: true});
  const vatRate = number(payload.vatRate, "vatRate");
  const vat = number(payload.vat, "vat");
  const total = number(payload.total, "total", {positive: true});
  const expectedVat = Math.round((net * vatRate + Number.EPSILON) * 100) / 100;
  if (vat !== expectedVat || total !== Math.round((net + vat + Number.EPSILON) * 100) / 100) invalid("Bill amounts are inconsistent.");
  return {
    ...(edit ? {} : {
      id: (typeof payload.id === "number" && Number.isSafeInteger(payload.id) && payload.id > 0) ?
        payload.id : invalid("id is invalid."),
    }),
    supplier: payload.supplier, billNumber: string(payload.billNumber, "billNumber", 512),
    billDate: string(payload.billDate, "billDate", 32), dueDate: string(payload.dueDate, "dueDate", 32),
    category: string(payload.category, "category", 128), net, vatRate, vat, total,
    status: payload.status, notes: string(payload.notes, "notes", 4000), ...project(payload),
    attachmentName: string(payload.attachmentName, "attachmentName", 512),
    attachmentUrl: string(payload.attachmentUrl, "attachmentUrl", 4096),
    attachmentPath: string(payload.attachmentPath, "attachmentPath", 1024),
    attachmentSize: number(payload.attachmentSize, "attachmentSize"),
    attachmentType: string(payload.attachmentType, "attachmentType", 256),
  };
}

module.exports = {
  BILL_EDIT_FIELDS, BILL_FIELDS, INVOICE_EDIT_FIELDS, INVOICE_FIELDS,
  validateCreatePayload(recordType, payload) {
    if (recordType === "invoice") return invoice(payload);
    if (recordType === "bill") return bill(payload);
    invalid("Record type is invalid.");
  },
  validateEditPayload(recordType, payload) {
    if (recordType === "invoice") return invoice(payload, {edit: true});
    if (recordType === "bill") return bill(payload, {edit: true});
    invalid("Record type is invalid.");
  },
};
