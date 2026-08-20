"use strict";

const {constants: fsConstants} = require("node:fs");
const {access, link, lstat, open, stat, unlink} = require("node:fs/promises");
const {randomUUID} = require("node:crypto");
const {dirname, extname, resolve} = require("node:path");
const {createInterface} = require("node:readline/promises");
const {
  APPROVED_PRODUCTION_AUDIT_TARGET,
  PRODUCTION_NODE_MAJOR,
  PRODUCTION_REQUIRED_LIMITS,
} = require("./production-reference-audit-config.cjs");
const {
  AUDIT_SCHEMA_VERSION,
  AUDIT_VERSION,
  validatePageSize,
  validateSafetyLimits,
} = require("./production-reference-audit.cjs");

const EMULATOR_VARIABLES = Object.freeze([
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
  "FIREBASE_DATABASE_EMULATOR_HOST",
]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function emulatorHostname(environment) {
  const host = String(environment.FIRESTORE_EMULATOR_HOST || "").trim();
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(1).split("]")[0].toLowerCase();
  if (host === "::1") return host;
  return host.split(":")[0].toLowerCase();
}

function nodeMajor(version) {
  const match = String(version || "").trim().match(/^v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

function localJsonPath(pathValue, label) {
  const original = String(pathValue || "").trim();
  if (!original) throw new Error(`${label} is required.`);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(original) || /^file:/i.test(original) || /^[\\/]{2}/.test(original)) {
    throw new Error(`${label} must be a local filesystem path.`);
  }
  const path = resolve(original);
  if (extname(path).toLowerCase() !== ".json") throw new Error(`${label} must end in .json.`);
  return path;
}

function validateIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!text || text.includes("/") || /\s/.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function assertExecutionBoundary(options, environment = process.env, runtimeVersion = process.version) {
  validateIdentifier(options.projectId, "Project ID");
  validateIdentifier(options.databaseId, "Database ID");
  if (options.uid) validateIdentifier(options.uid, "UID");
  validatePageSize(options.pageSize);
  const safetyLimits = options.safetyLimits || {};
  validateSafetyLimits(safetyLimits);

  const emulatorHost = emulatorHostname(environment);
  if (!options.productionReadOnly) {
    if (!emulatorHost || !LOCAL_HOSTS.has(emulatorHost)) {
      throw new Error("Refusing non-emulator Firestore reads without --production-read-only.");
    }
    return;
  }

  const presentEmulatorVariables = EMULATOR_VARIABLES.filter((name) => String(environment[name] || "").trim());
  if (presentEmulatorVariables.length) {
    throw new Error(`Production read-only mode refuses emulator variables: ${presentEmulatorVariables.join(", ")}.`);
  }
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
  for (const name of PRODUCTION_REQUIRED_LIMITS) {
    if (safetyLimits[name] === undefined || safetyLimits[name] === null || safetyLimits[name] === "") {
      throw new Error(`Production mode requires explicit --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
    }
  }
}

async function inspectOutputPath(outputPath) {
  const path = localJsonPath(outputPath, "Output path");
  const parent = dirname(path);
  let directory;
  try {
    directory = await stat(parent);
  } catch (error) {
    throw new Error(`Output directory does not exist: ${parent}`, {cause: error});
  }
  if (!directory.isDirectory()) throw new Error(`Output parent is not a directory: ${parent}`);
  await access(parent, fsConstants.W_OK);
  try {
    await lstat(path);
    throw new Error(`Output file already exists: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return path;
}

async function verifyCredentialProject(projectId, resolveCredentialProject) {
  let detectedProject;
  try {
    detectedProject = String(await resolveCredentialProject() || "").trim();
  } catch (error) {
    throw new Error("Credential project identity could not be established.", {cause: error});
  }
  if (!detectedProject) throw new Error("Credential project identity could not be established.");
  if (detectedProject !== projectId) {
    throw new Error(`Credential project mismatch: expected ${projectId}, received ${detectedProject}.`);
  }
  return detectedProject;
}

function scopeLabel(options) {
  return options.uid ? "SINGLE UID DIAGNOSTIC" : "FULL CENSUS";
}

function confirmationPhrase(options) {
  return `READ ONLY ${options.projectId} ${options.databaseId} ${scopeLabel(options)}`;
}

function preflightSummary(options, details = {}) {
  const limits = validateSafetyLimits(options.safetyLimits);
  return Object.freeze({
    status: "ready",
    requestedProjectId: options.projectId,
    credentialProjectId: details.credentialProjectId || null,
    requestedDatabaseId: options.databaseId,
    emulatorVariablesPresent: [...(details.emulatorVariablesPresent || [])],
    nodeVersion: details.nodeVersion || process.version,
    auditVersion: AUDIT_VERSION,
    reportSchemaVersion: AUDIT_SCHEMA_VERSION,
    outputPath: details.outputPath || null,
    pageSize: validatePageSize(options.pageSize),
    scanScope: scopeLabel(options),
    productionReadOnlyAcknowledged: Boolean(options.productionReadOnly),
    preflightOnly: Boolean(options.preflightOnly),
    safetyLimits: limits,
  });
}

function formatPreflight(summary) {
  return [
    "=== SIMPLE BOOKS REFERENCE AUDIT: STRICTLY READ ONLY ===",
    `Project requested: ${summary.requestedProjectId}`,
    `Credential project: ${summary.credentialProjectId || "not required in emulator mode"}`,
    `Database: ${summary.requestedDatabaseId}`,
    `Emulator variables present: ${summary.emulatorVariablesPresent.length ? summary.emulatorVariablesPresent.join(", ") : "none"}`,
    `Node: ${summary.nodeVersion}`,
    `Audit/report schema: ${summary.auditVersion} / ${summary.reportSchemaVersion}`,
    `Output: ${summary.outputPath || "stdout only (emulator mode)"}`,
    `Page size: ${summary.pageSize}`,
    `Scope: ${summary.scanScope}`,
    `Production acknowledgement: ${summary.productionReadOnlyAcknowledged ? "present" : "not applicable"}`,
    `Limits: documents=${summary.safetyLimits.maxDocuments ?? "unlimited-emulator"}, pages=${summary.safetyLimits.maxPages ?? "unlimited-emulator"}, uids=${summary.safetyLimits.maxUids ?? "unlimited-emulator"}, elapsedMs=${summary.safetyLimits.maxElapsedMs ?? "unlimited-emulator"}`,
  ].join("\n");
}

async function requireHumanConfirmation(options, streams = {}) {
  const input = streams.input || process.stdin;
  const output = streams.output || process.stderr;
  if (!input.isTTY || !output.isTTY) throw new Error("Production audit requires an interactive terminal confirmation.");
  const expected = confirmationPhrase(options);
  output.write(`\nType this exact phrase to begin Firestore READS:\n${expected}\n> `);
  const interface_ = createInterface({input, output});
  try {
    const answer = await interface_.question("");
    if (answer !== expected) throw new Error("Exact read-only confirmation phrase did not match; aborting before Firestore reads.");
  } finally {
    interface_.close();
  }
}

async function atomicWriteJson(outputPath, value, status = "complete", dependencies = {}) {
  const path = resolve(outputPath);
  const temporaryPath = `${path}.partial-${process.pid}-${randomUUID()}`;
  const payload = `${JSON.stringify({...value, artifact: {status}}, null, 2)}\n`;
  const openFile = dependencies.open || open;
  const linkFile = dependencies.link || link;
  const unlinkFile = dependencies.unlink || unlink;
  let handle;
  try {
    handle = await openFile(temporaryPath, "wx");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await linkFile(temporaryPath, path);
    await unlinkFile(temporaryPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlinkFile(temporaryPath).catch(() => {});
    throw error;
  }
  return path;
}

function incompleteArtifactPath(outputPath, now = new Date()) {
  const suffix = now.toISOString().replace(/[:.]/g, "-");
  return `${resolve(outputPath)}.incomplete-${suffix}.json`;
}

module.exports = {
  EMULATOR_VARIABLES,
  LOCAL_HOSTS,
  assertExecutionBoundary,
  atomicWriteJson,
  confirmationPhrase,
  emulatorHostname,
  formatPreflight,
  incompleteArtifactPath,
  inspectOutputPath,
  localJsonPath,
  nodeMajor,
  preflightSummary,
  requireHumanConfirmation,
  scopeLabel,
  verifyCredentialProject,
};
