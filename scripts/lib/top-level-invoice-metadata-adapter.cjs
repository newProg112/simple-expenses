"use strict";

const {createHash} = require("node:crypto");

const TOP_LEVEL_INVOICE_COLLECTION = "invoices";
const MAX_TOP_LEVEL_INVOICE_DOCUMENTS = 2;

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function timestampIso(value, label) {
  if (!value || typeof value.toDate !== "function") {
    throw new TypeError(`${label} is unavailable.`);
  }
  const date = value.toDate();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} is invalid.`);
  }
  return date.toISOString();
}

function safeMetadata(snapshot) {
  return Object.freeze({
    pathHash: sha256(snapshot.ref.path),
    createTime: timestampIso(snapshot.createTime, "Document createTime"),
    updateTime: timestampIso(snapshot.updateTime, "Document updateTime"),
  });
}

function createTopLevelInvoiceMetadataAdapter(firestore, FieldPath) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore read client is required.");
  }
  if (!FieldPath || typeof FieldPath.documentId !== "function") {
    throw new TypeError("Firestore FieldPath is required.");
  }

  return Object.freeze({
    async readTopLevelInvoices() {
      const snapshot = await firestore.collection(TOP_LEVEL_INVOICE_COLLECTION)
        .select()
        .orderBy(FieldPath.documentId())
        .limit(MAX_TOP_LEVEL_INVOICE_DOCUMENTS)
        .get();
      return Object.freeze(snapshot.docs.map(safeMetadata));
    },
  });
}

module.exports = Object.freeze({
  MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
  TOP_LEVEL_INVOICE_COLLECTION,
  createTopLevelInvoiceMetadataAdapter,
});
