#!/usr/bin/env node
"use strict";

const {readFile, writeFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {createRequire} = require("node:module");
const functionsRequire = createRequire(resolve(__dirname, "../functions/package.json"));
const admin = functionsRequire("firebase-admin");
const {FieldPath, getFirestore} = functionsRequire("firebase-admin/firestore");
const {GoogleAuth} = functionsRequire("google-auth-library");
const {
  compareAuditReports,
  createProductionReferenceAudit,
  validatePageSize,
} = require("./lib/production-reference-audit.cjs");
const {createReadOnlyFirestoreAdapter} = require("./lib/read-only-firestore-adapter.cjs");

const PRODUCTION_PROJECT_ALLOWLIST = Object.freeze(["simple-books-office"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function parseArguments(argv) {
  const options = {
    projectId: "", databaseId: "(default)", uid: "", pageSize: undefined,
    comparePath: "", outputPath: "", productionReadOnly: false, help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project") options.projectId = String(argv[++index] || "").trim();
    else if (argument === "--database") options.databaseId = String(argv[++index] || "").trim();
    else if (argument === "--uid") options.uid = String(argv[++index] || "").trim();
    else if (argument === "--page-size") options.pageSize = String(argv[++index] || "").trim();
    else if (argument === "--compare") options.comparePath = String(argv[++index] || "").trim();
    else if (argument === "--output") options.outputPath = String(argv[++index] || "").trim();
    else if (argument === "--production-read-only") options.productionReadOnly = true;
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
    "Single emulator UID:",
    "  node scripts/audit-production-reference-registry.cjs --project demo-simple-books --uid <uid> --page-size 25",
    "",
    "Future production read-only census (does not unlock writes):",
    "  node scripts/audit-production-reference-registry.cjs --production-read-only --project simple-books-office --database '(default)'",
    "",
    "Optional local artifacts:",
    "  --output <report.json> --compare <prior-report.json>",
  ].join("\n");
}

function emulatorHostname(environment) {
  const host = String(environment.FIRESTORE_EMULATOR_HOST || "").trim();
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(1).split("]")[0].toLowerCase();
  if (host === "::1") return host;
  return host.split(":")[0].toLowerCase();
}

function assertExecutionBoundary(options, environment = process.env) {
  if (!options.projectId || options.projectId.includes("/") || /\s/.test(options.projectId)) {
    throw new Error("An explicit valid --project is required.");
  }
  if (!options.databaseId || options.databaseId.includes("/")) throw new Error("Database ID is invalid.");
  if (options.uid && (options.uid.includes("/") || /\s/.test(options.uid))) throw new Error("UID is invalid.");
  validatePageSize(options.pageSize);
  const emulatorHost = emulatorHostname(environment);
  if (options.productionReadOnly) {
    const emulatorVariables = [
      "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST",
      "FIREBASE_STORAGE_EMULATOR_HOST", "FIREBASE_DATABASE_EMULATOR_HOST",
    ].filter((name) => String(environment[name] || "").trim());
    if (emulatorVariables.length) throw new Error("Production read-only mode refuses all Firebase emulator variables.");
    if (!PRODUCTION_PROJECT_ALLOWLIST.includes(options.projectId)) {
      throw new Error(`Production read-only mode refuses project: ${options.projectId}`);
    }
    return;
  }
  if (!emulatorHost || !LOCAL_HOSTS.has(emulatorHost)) {
    throw new Error("Refusing non-emulator Firestore reads without --production-read-only.");
  }
}

async function verifyCredentialProject(options) {
  if (!options.productionReadOnly) return;
  const detectedProject = String(await new GoogleAuth().getProjectId() || "").trim();
  if (!detectedProject || detectedProject !== options.projectId) {
    throw new Error(`Credential project mismatch: expected ${options.projectId}, received ${detectedProject || "(missing)"}.`);
  }
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  assertExecutionBoundary(options, environment);
  await verifyCredentialProject(options);
  process.stderr.write("=== SIMPLE BOOKS REFERENCE AUDIT: STRICTLY READ ONLY ===\n");
  const appName = `reference-audit-${process.pid}-${Date.now()}`;
  const app = admin.initializeApp({projectId: options.projectId}, appName);
  try {
    const firestore = options.databaseId === "(default)" ? admin.firestore(app) : getFirestore(app, options.databaseId);
    const adapter = createReadOnlyFirestoreAdapter(firestore, FieldPath);
    const report = await createProductionReferenceAudit(adapter, {
      projectId: options.projectId,
      databaseId: options.databaseId,
      uid: options.uid,
      pageSize: options.pageSize,
    });
    if (options.comparePath) {
      const previous = JSON.parse(await readFile(resolve(options.comparePath), "utf8"));
      report.comparison = compareAuditReports(previous, report);
    }
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outputPath) await writeFile(resolve(options.outputPath), output, {encoding: "utf8", flag: "wx"});
    process.stdout.write(output);
    return report;
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
  PRODUCTION_PROJECT_ALLOWLIST,
  assertExecutionBoundary,
  emulatorHostname,
  main,
  parseArguments,
  usage,
  verifyCredentialProject,
};
