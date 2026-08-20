"use strict";

const {
  MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
  TOP_LEVEL_INVOICE_COLLECTION,
} = require("./top-level-invoice-metadata-adapter.cjs");

const PROBE_SCHEMA_VERSION = 1;
const PROBE_VERSION = "phase3c3c-step2c3-v1";
const HISTORICAL_WRITER_WINDOW = Object.freeze({
  timezone: "Europe/London (BST, UTC+01:00)",
  start: "2026-05-20T00:00:00+01:00",
  endExclusive: "2026-05-21T00:00:00+01:00",
});
const HASH_PATTERN = /^[a-f\d]{64}$/;
const SAFE_ERROR_CODES = new Map([
  ["7", "permission-denied"], ["16", "unauthenticated"], ["4", "network-timeout"],
  ["14", "unavailable"], ["3", "invalid-query"],
  ["permission-denied", "permission-denied"], ["unauthenticated", "unauthenticated"],
  ["deadline-exceeded", "network-timeout"], ["unavailable", "unavailable"],
  ["resource-exhausted", "resource-exhausted"], ["invalid-argument", "invalid-query"],
]);

function expectedHash(value) {
  const hash = String(value || "").trim();
  if (!HASH_PATTERN.test(hash)) throw new TypeError("Expected path hash must be 64 lowercase hexadecimal characters.");
  return hash;
}

function safeError(error) {
  const rawCode = String(error?.code ?? error?.status ?? "").trim().toLowerCase().replaceAll("_", "-");
  return Object.freeze({
    code: "top-level-invoice-metadata-read-failed",
    errorCategory: SAFE_ERROR_CODES.get(rawCode) || "unknown",
  });
}

function baseArtifact(input, hash) {
  return {
    schemaVersion: PROBE_SCHEMA_VERSION,
    probeVersion: PROBE_VERSION,
    projectId: String(input.projectId || ""),
    databaseId: String(input.databaseId || "(default)"),
    scope: {
      collection: TOP_LEVEL_INVOICE_COLLECTION,
      topLevelOnly: true,
      maxDocuments: MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
      ordering: "document-name-ascending",
      pagination: false,
    },
    expectedPathHash: hash,
    historicalWriterWindow: HISTORICAL_WRITER_WINDOW,
  };
}

function historicalComparison(iso) {
  const timestamp = Date.parse(iso);
  const start = Date.parse(HISTORICAL_WRITER_WINDOW.start);
  const end = Date.parse(HISTORICAL_WRITER_WINDOW.endExclusive);
  if (!Number.isFinite(timestamp)) {
    return {createdOn2026May20: "unknown", createdWithinHistoricalWriterWindow: "unknown"};
  }
  const within = timestamp >= start && timestamp < end;
  return {createdOn2026May20: within, createdWithinHistoricalWriterWindow: within};
}

function validateMetadata(document) {
  if (!document || Object.keys(document).sort().join(",") !== "createTime,pathHash,updateTime") {
    throw new TypeError("Adapter returned an invalid metadata surface.");
  }
  if (!HASH_PATTERN.test(String(document.pathHash || ""))) throw new TypeError("Adapter returned an invalid path hash.");
  for (const name of ["createTime", "updateTime"]) {
    if (!Number.isFinite(Date.parse(document[name]))) throw new TypeError(`Adapter returned invalid ${name}.`);
  }
}

function cardinality(documentsObserved) {
  if (documentsObserved === 0) return {status: "zero", complete: true, provenance: "not-applicable"};
  if (documentsObserved === 1) return {status: "exactly-one", complete: true, provenance: "timestamp-comparison-only"};
  return {status: "multiple-observed-at-cap", complete: false, provenance: "refused-multiple-documents"};
}

async function createTopLevelInvoiceMetadataProbe(adapter, input = {}) {
  const hash = expectedHash(input.expectedPathHash);
  const base = baseArtifact(input, hash);
  if (!adapter || Object.keys(adapter).join(",") !== "readTopLevelInvoices" ||
      typeof adapter.readTopLevelInvoices !== "function") {
    throw new TypeError("An exact top-level invoice read-only adapter is required.");
  }

  let metadata;
  try {
    metadata = await adapter.readTopLevelInvoices();
    if (!Array.isArray(metadata) || metadata.length > MAX_TOP_LEVEL_INVOICE_DOCUMENTS) {
      throw new TypeError("The bounded adapter exceeded the fixed document cap.");
    }
    for (const document of metadata) validateMetadata(document);
  } catch (error) {
    return Object.freeze({
      ...base,
      result: {
        documentsObserved: 0,
        expectedHashMatches: 0,
        unexpectedHashMatches: 0,
        cardinalityStatus: "unknown",
        cardinalityComplete: false,
        provenanceInterpretation: "refused-incomplete-read",
      },
      documents: [],
      failure: safeError(error),
      artifact: {status: "incomplete"},
    });
  }

  const documents = metadata.map((document) => Object.freeze({
    pathHash: document.pathHash,
    matchesExpectedPathHash: document.pathHash === hash,
    createTime: document.createTime,
    updateTime: document.updateTime,
    ...historicalComparison(document.createTime),
  }));
  const expectedHashMatches = documents.filter((document) => document.matchesExpectedPathHash).length;
  const cardinalityResult = cardinality(documents.length);
  return Object.freeze({
    ...base,
    result: {
      documentsObserved: documents.length,
      expectedHashMatches,
      unexpectedHashMatches: documents.length - expectedHashMatches,
      cardinalityStatus: cardinalityResult.status,
      cardinalityComplete: cardinalityResult.complete,
      provenanceInterpretation: cardinalityResult.provenance,
    },
    documents: Object.freeze(documents),
    artifact: {status: "complete"},
  });
}

module.exports = Object.freeze({
  HISTORICAL_WRITER_WINDOW,
  PROBE_SCHEMA_VERSION,
  PROBE_VERSION,
  createTopLevelInvoiceMetadataProbe,
  expectedHash,
  historicalComparison,
});
