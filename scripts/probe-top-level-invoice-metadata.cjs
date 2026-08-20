#!/usr/bin/env node
"use strict";

const {resolve} = require("node:path");
const {createRequire} = require("node:module");
const functionsRequire = createRequire(resolve(__dirname, "../functions/package.json"));
const {APPROVED_PRODUCTION_AUDIT_TARGET} = require("./lib/production-reference-audit-config.cjs");
const {
  EMULATOR_VARIABLES,
  atomicWriteJson,
  incompleteArtifactPath,
  inspectOutputPath,
  verifyCredentialProject,
} = require("./lib/production-reference-audit-preflight.cjs");
const {createTopLevelInvoiceMetadataAdapter} = require("./lib/top-level-invoice-metadata-adapter.cjs");
const {createTopLevelInvoiceMetadataProbe} = require("./lib/top-level-invoice-metadata-probe.cjs");
const {
  assertProbeExecutionBoundary,
  formatProbePreflight,
  probePreflightSummary,
  requireProbeConfirmation,
} = require("./lib/top-level-invoice-probe-preflight.cjs");

function parseArguments(argv) {
  const options = {
    projectId: "", databaseId: "(default)", databaseProvided: false,
    outputPath: "", expectedPathHash: "", productionReadOnly: false,
    preflightOnly: false, help: false,
  };
  function valueAfter(index, flag) {
    const value = String(argv[index + 1] || "").trim();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project") options.projectId = valueAfter(index++, argument);
    else if (argument === "--database") {
      options.databaseId = valueAfter(index++, argument);
      options.databaseProvided = true;
    } else if (argument === "--output") options.outputPath = valueAfter(index++, argument);
    else if (argument === "--expected-path-hash") options.expectedPathHash = valueAfter(index++, argument);
    else if (argument === "--production-read-only") options.productionReadOnly = true;
    else if (argument === "--preflight-only") options.preflightOnly = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  const hash = "d95e98a89f89072a9690ba4b8fb906e7daf2d8c73a3f22259b8575a2306e6af4";
  return [
    "STRICTLY READ ONLY top-level invoice metadata probe",
    "",
    "Emulator:",
    `  node scripts/probe-top-level-invoice-metadata.cjs --project demo-simple-books --expected-path-hash ${hash}`,
    "",
    "Future production preflight (zero Firestore document reads):",
    `  node scripts/probe-top-level-invoice-metadata.cjs --production-read-only --preflight-only --project ${APPROVED_PRODUCTION_AUDIT_TARGET.projectId} --database '${APPROVED_PRODUCTION_AUDIT_TARGET.databaseId}' --expected-path-hash ${hash} --output <new-report.json>`,
    "",
    "Remove --preflight-only only after a separate production-read approval.",
    "The production read requires an exact interactive confirmation.",
    "Scope and cap are immutable: TOP-LEVEL invoices ONLY, maximum 2 documents.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), environment = process.env, dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const runtimeVersion = dependencies.runtimeVersion || process.version;
  assertProbeExecutionBoundary(options, environment, runtimeVersion);
  let outputPath = null;
  if (options.outputPath) outputPath = await (dependencies.inspectOutputPath || inspectOutputPath)(options.outputPath);

  let credentialProjectId = null;
  if (options.productionReadOnly) {
    const resolver = dependencies.resolveCredentialProject || (() => {
      const {GoogleAuth} = functionsRequire("google-auth-library");
      return new GoogleAuth().getProjectId();
    });
    credentialProjectId = await verifyCredentialProject(options.projectId, resolver);
  }
  const summary = probePreflightSummary(options, {
    credentialProjectId,
    emulatorVariablesPresent: EMULATOR_VARIABLES.filter((name) => String(environment[name] || "").trim()),
    nodeVersion: runtimeVersion,
    outputPath,
  });
  process.stderr.write(`${formatProbePreflight(summary)}\n`);
  if (options.preflightOnly) {
    process.stderr.write("PREFLIGHT READY: zero Firestore document reads were performed.\n");
    return {preflight: summary, firestoreReadsStarted: false};
  }

  process.stderr.write("PROBE SCOPE CONFIRMATION: TOP-LEVEL invoices ONLY; maximum documents: 2.\n");
  if (options.productionReadOnly) {
    await (dependencies.requireHumanConfirmation || requireProbeConfirmation)(options);
  }

  const appName = `top-level-invoice-probe-${process.pid}-${Date.now()}`;
  const firebase = dependencies.firebase || (() => {
    const admin = functionsRequire("firebase-admin");
    const firestoreApi = functionsRequire("firebase-admin/firestore");
    return {admin, FieldPath: firestoreApi.FieldPath, getFirestore: firestoreApi.getFirestore};
  })();
  const initializeApp = dependencies.initializeApp || ((configuration, name) => firebase.admin.initializeApp(configuration, name));
  const app = initializeApp({projectId: options.projectId}, appName);
  try {
    const firestore = dependencies.firestore || (options.databaseId === "(default)" ?
      firebase.admin.firestore(app) : firebase.getFirestore(app, options.databaseId));
    const adapter = (dependencies.createAdapter || createTopLevelInvoiceMetadataAdapter)(firestore, firebase.FieldPath);
    const report = await createTopLevelInvoiceMetadataProbe(adapter, {
      projectId: options.projectId,
      databaseId: options.databaseId,
      expectedPathHash: options.expectedPathHash,
    });
    const status = report.artifact.status;
    let artifactPath = null;
    if (outputPath) {
      artifactPath = status === "complete" ? outputPath : incompleteArtifactPath(outputPath);
      await (dependencies.atomicWriteJson || atomicWriteJson)(artifactPath, report, status);
      process.stderr.write(`${status.toUpperCase()} local artifact: ${artifactPath}\n`);
    }
    const printable = {...report, artifact: {status, path: artifactPath}};
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    if (status !== "complete") {
      const error = new Error("Metadata probe is incomplete; the requested completed output artifact was not created.");
      error.code = "invoice-metadata-probe-incomplete";
      error.report = printable;
      throw error;
    }
    return printable;
  } finally {
    await app.delete();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`READ ONLY top-level invoice metadata probe failed: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({main, parseArguments, usage});
