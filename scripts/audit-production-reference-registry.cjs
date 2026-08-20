#!/usr/bin/env node
"use strict";

const {readFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {createRequire} = require("node:module");
const functionsRequire = createRequire(resolve(__dirname, "../functions/package.json"));
const admin = functionsRequire("firebase-admin");
const {FieldPath, getFirestore} = functionsRequire("firebase-admin/firestore");
const {GoogleAuth} = functionsRequire("google-auth-library");
const {
  compareAuditReports,
  createProductionReferenceAudit,
} = require("./lib/production-reference-audit.cjs");
const {createReadOnlyFirestoreAdapter} = require("./lib/read-only-firestore-adapter.cjs");
const {APPROVED_PRODUCTION_AUDIT_TARGET} = require("./lib/production-reference-audit-config.cjs");
const {
  EMULATOR_VARIABLES,
  assertExecutionBoundary,
  atomicWriteJson,
  formatPreflight,
  incompleteArtifactPath,
  inspectOutputPath,
  localJsonPath,
  preflightSummary,
  requireHumanConfirmation,
  scopeLabel,
  verifyCredentialProject,
} = require("./lib/production-reference-audit-preflight.cjs");

function parseArguments(argv) {
  const options = {
    projectId: "", databaseId: "(default)", databaseProvided: false,
    uid: "", pageSize: undefined, comparePath: "", outputPath: "",
    productionReadOnly: false, preflightOnly: false, help: false,
    safetyLimits: {maxDocuments: undefined, maxPages: undefined, maxUids: undefined, maxElapsedMs: undefined},
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
    } else if (argument === "--uid") options.uid = valueAfter(index++, argument);
    else if (argument === "--page-size") options.pageSize = valueAfter(index++, argument);
    else if (argument === "--compare") options.comparePath = valueAfter(index++, argument);
    else if (argument === "--output") options.outputPath = valueAfter(index++, argument);
    else if (argument === "--max-documents") options.safetyLimits.maxDocuments = valueAfter(index++, argument);
    else if (argument === "--max-pages") options.safetyLimits.maxPages = valueAfter(index++, argument);
    else if (argument === "--max-uids") options.safetyLimits.maxUids = valueAfter(index++, argument);
    else if (argument === "--max-elapsed-seconds") {
      const seconds = Number(valueAfter(index++, argument));
      options.safetyLimits.maxElapsedMs = Number.isSafeInteger(seconds) ? seconds * 1000 : Number.NaN;
    } else if (argument === "--production-read-only") options.productionReadOnly = true;
    else if (argument === "--preflight-only") options.preflightOnly = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    "READ ONLY reference-registry census/audit",
    "",
    "Emulator census:",
    "  node scripts/audit-production-reference-registry.cjs --project demo-simple-books",
    "",
    "Future production preflight (performs zero Firestore business-data reads):",
    `  node scripts/audit-production-reference-registry.cjs --production-read-only --preflight-only --project ${APPROVED_PRODUCTION_AUDIT_TARGET.projectId} --database '${APPROVED_PRODUCTION_AUDIT_TARGET.databaseId}' --output <new-report.json> --page-size <n> --max-documents <n> --max-pages <n> --max-uids <n> --max-elapsed-seconds <n>`,
    "",
    "Remove --preflight-only only after a separately approved production read.",
    "A production data read always requires an exact interactive typed confirmation.",
    "Single-UID --uid mode is diagnostic and can never be approval-ready.",
  ].join("\n");
}

async function loadComparison(pathValue) {
  if (!pathValue) return null;
  const path = localJsonPath(pathValue, "Comparison path");
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(argv = process.argv.slice(2), environment = process.env, dependencies = {}) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }

  const runtimeVersion = dependencies.runtimeVersion || process.version;
  assertExecutionBoundary(options, environment, runtimeVersion);
  let outputPath = null;
  if (options.outputPath) outputPath = await (dependencies.inspectOutputPath || inspectOutputPath)(options.outputPath);
  const previousReport = await loadComparison(options.comparePath);

  let credentialProjectId = null;
  if (options.productionReadOnly) {
    const credentialResolver = dependencies.resolveCredentialProject || (() => new GoogleAuth().getProjectId());
    credentialProjectId = await verifyCredentialProject(options.projectId, credentialResolver);
  }
  const summary = preflightSummary(options, {
    credentialProjectId,
    emulatorVariablesPresent: EMULATOR_VARIABLES.filter((name) => String(environment[name] || "").trim()),
    nodeVersion: runtimeVersion,
    outputPath,
  });
  process.stderr.write(`${formatPreflight(summary)}\n`);
  if (options.preflightOnly) {
    process.stderr.write("PREFLIGHT READY: zero Firestore census/business-data reads were performed.\n");
    return {preflight: summary, firestoreReadsStarted: false};
  }

  process.stderr.write(`SCAN SCOPE CONFIRMATION: ${scopeLabel(options)}\n`);
  if (options.productionReadOnly) {
    await (dependencies.requireHumanConfirmation || requireHumanConfirmation)(options);
  }

  const appName = `reference-audit-${process.pid}-${Date.now()}`;
  const initializeApp = dependencies.initializeApp || ((configuration, name) => admin.initializeApp(configuration, name));
  const app = initializeApp({projectId: options.projectId}, appName);
  try {
    const firestore = dependencies.firestore || (options.databaseId === "(default)" ?
      admin.firestore(app) : getFirestore(app, options.databaseId));
    const adapter = (dependencies.createAdapter || createReadOnlyFirestoreAdapter)(firestore, FieldPath);
    const report = await createProductionReferenceAudit(adapter, {
      projectId: options.projectId,
      databaseId: options.databaseId,
      uid: options.uid,
      pageSize: options.pageSize,
      safetyLimits: options.safetyLimits,
    });
    if (previousReport) report.comparison = compareAuditReports(previousReport, report);

    let artifactPath = null;
    const artifactStatus = report.scan.complete ? "complete" : "incomplete";
    if (outputPath) {
      artifactPath = report.scan.complete ? outputPath : incompleteArtifactPath(outputPath);
      await (dependencies.atomicWriteJson || atomicWriteJson)(artifactPath, report, artifactStatus);
      process.stderr.write(`${artifactStatus.toUpperCase()} local artifact: ${artifactPath}\n`);
    }
    const printable = {...report, artifact: {status: artifactStatus, path: artifactPath}};
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
    if (!report.scan.complete) {
      const error = new Error("Audit scan is incomplete; the requested completed output artifact was not created.");
      error.code = "audit-incomplete";
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
    process.stderr.write(`READ ONLY audit failed: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertExecutionBoundary,
  loadComparison,
  main,
  parseArguments,
  usage,
};
