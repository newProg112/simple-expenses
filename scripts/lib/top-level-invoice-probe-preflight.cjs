"use strict";

const {createInterface} = require("node:readline/promises");
const {APPROVED_PRODUCTION_AUDIT_TARGET, PRODUCTION_NODE_MAJOR} =
  require("./production-reference-audit-config.cjs");
const {
  EMULATOR_VARIABLES,
  LOCAL_HOSTS,
  emulatorHostname,
  nodeMajor,
} = require("./production-reference-audit-preflight.cjs");
const {
  MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
  TOP_LEVEL_INVOICE_COLLECTION,
} = require("./top-level-invoice-metadata-adapter.cjs");
const {
  PROBE_SCHEMA_VERSION,
  PROBE_VERSION,
  expectedHash,
} = require("./top-level-invoice-metadata-probe.cjs");

function identifier(value, label) {
  const text = String(value || "").trim();
  if (!text || text.includes("/") || /\s/.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function assertProbeExecutionBoundary(options, environment = process.env, runtimeVersion = process.version) {
  identifier(options.projectId, "Project ID");
  identifier(options.databaseId, "Database ID");
  expectedHash(options.expectedPathHash);
  const emulatorHost = emulatorHostname(environment);
  if (!options.productionReadOnly) {
    if (!emulatorHost || !LOCAL_HOSTS.has(emulatorHost)) {
      throw new Error("Refusing non-emulator Firestore reads without --production-read-only.");
    }
    return;
  }
  const present = EMULATOR_VARIABLES.filter((name) => String(environment[name] || "").trim());
  if (present.length) throw new Error(`Production read-only mode refuses emulator variables: ${present.join(", ")}.`);
  if (options.projectId !== APPROVED_PRODUCTION_AUDIT_TARGET.projectId) {
    throw new Error(`Production read-only mode refuses project: ${options.projectId}`);
  }
  if (!options.databaseProvided || options.databaseId !== APPROVED_PRODUCTION_AUDIT_TARGET.databaseId) {
    throw new Error(`Production mode requires explicit --database ${APPROVED_PRODUCTION_AUDIT_TARGET.databaseId}.`);
  }
  if (nodeMajor(runtimeVersion) !== PRODUCTION_NODE_MAJOR) {
    throw new Error(`Production mode requires Node ${PRODUCTION_NODE_MAJOR}.x; current runtime is ${runtimeVersion || "unknown"}.`);
  }
  if (!options.outputPath) throw new Error("Production mode requires explicit --output.");
}

function confirmationPhrase(options) {
  return `READ ONLY ${options.projectId} ${options.databaseId} TOP-LEVEL ${TOP_LEVEL_INVOICE_COLLECTION} ONLY MAX ${MAX_TOP_LEVEL_INVOICE_DOCUMENTS} HASH ${expectedHash(options.expectedPathHash)}`;
}

function probePreflightSummary(options, details = {}) {
  return Object.freeze({
    status: "ready",
    requestedProjectId: options.projectId,
    credentialProjectId: details.credentialProjectId || null,
    requestedDatabaseId: options.databaseId,
    emulatorVariablesPresent: [...(details.emulatorVariablesPresent || [])],
    nodeVersion: details.nodeVersion || process.version,
    probeVersion: PROBE_VERSION,
    reportSchemaVersion: PROBE_SCHEMA_VERSION,
    outputPath: details.outputPath || null,
    scope: `TOP-LEVEL ${TOP_LEVEL_INVOICE_COLLECTION} ONLY`,
    maxDocuments: MAX_TOP_LEVEL_INVOICE_DOCUMENTS,
    expectedPathHash: expectedHash(options.expectedPathHash),
    productionReadOnlyAcknowledged: Boolean(options.productionReadOnly),
    preflightOnly: Boolean(options.preflightOnly),
  });
}

function formatProbePreflight(summary) {
  return [
    "=== SIMPLE BOOKS TOP-LEVEL INVOICE METADATA PROBE: STRICTLY READ ONLY ===",
    `Project requested: ${summary.requestedProjectId}`,
    `Credential project: ${summary.credentialProjectId || "not required in emulator mode"}`,
    `Database: ${summary.requestedDatabaseId}`,
    `Emulator variables present: ${summary.emulatorVariablesPresent.length ? summary.emulatorVariablesPresent.join(", ") : "none"}`,
    `Node: ${summary.nodeVersion}`,
    `Probe/report schema: ${summary.probeVersion} / ${summary.reportSchemaVersion}`,
    `Output: ${summary.outputPath || "stdout only (emulator mode)"}`,
    `Scope: ${summary.scope}`,
    `Max documents: ${summary.maxDocuments}`,
    `Expected path hash: ${summary.expectedPathHash}`,
    `Production acknowledgement: ${summary.productionReadOnlyAcknowledged ? "present" : "not applicable"}`,
  ].join("\n");
}

async function requireProbeConfirmation(options, streams = {}) {
  const input = streams.input || process.stdin;
  const output = streams.output || process.stderr;
  if (!input.isTTY || !output.isTTY) throw new Error("Production probe requires an interactive terminal confirmation.");
  const expected = confirmationPhrase(options);
  output.write(`\nType this exact phrase to begin the bounded Firestore READ:\n${expected}\n> `);
  const interface_ = createInterface({input, output});
  try {
    const answer = await interface_.question("");
    if (answer !== expected) throw new Error("Exact read-only confirmation phrase did not match; aborting before Firestore reads.");
  } finally {
    interface_.close();
  }
}

module.exports = Object.freeze({
  assertProbeExecutionBoundary,
  confirmationPhrase,
  formatProbePreflight,
  probePreflightSummary,
  requireProbeConfirmation,
});
