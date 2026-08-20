/* eslint-disable require-jsdoc */

"use strict";

const {createHash} = require("node:crypto");

const RECORD_TYPES = Object.freeze({
  invoice: Object.freeze({
    collectionName: "invoices",
    primaryField: "invoiceNo",
    legacyField: "invoiceNumber",
  }),
  bill: Object.freeze({
    collectionName: "bills",
    primaryField: "billNumber",
    legacyField: "invoiceNumber",
  }),
});
const canonicalization = import("./reference-canonicalization.mjs");

function recordTypeConfiguration(recordType) {
  const value = String(recordType || "");
  const configuration = RECORD_TYPES[value];
  if (!configuration) {
    const error = new TypeError(
        "A supported reference record type is required.",
    );
    error.code = "invalid-record-type";
    throw error;
  }
  return configuration;
}

async function canonicalReference(rawReference) {
  const helpers = await canonicalization;
  return helpers.normaliseDocumentReference(rawReference);
}

async function referenceRegistryKey(recordType, rawReference) {
  const normalizedRecordType = String(recordType || "");
  recordTypeConfiguration(normalizedRecordType);
  const canonical = await canonicalReference(rawReference);
  if (!canonical) {
    return Object.freeze({
      recordType: normalizedRecordType,
      canonicalReference: "",
      registryDocumentId: null,
      scopedCanonical: null,
    });
  }
  const scopedCanonical = `${normalizedRecordType}\0${canonical}`;
  return Object.freeze({
    recordType: normalizedRecordType,
    canonicalReference: canonical,
    registryDocumentId: createHash("sha256")
        .update(scopedCanonical, "utf8")
        .digest("hex"),
    scopedCanonical,
  });
}

function sourceReference(recordType, source) {
  const configuration = recordTypeConfiguration(recordType);
  return source && (source[configuration.primaryField] ||
    source[configuration.legacyField]) || "";
}

module.exports = {
  RECORD_TYPES,
  canonicalReference,
  recordTypeConfiguration,
  referenceRegistryKey,
  sourceReference,
};
