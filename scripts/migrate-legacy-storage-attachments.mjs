#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_STATUSES,
  buildMigrationPlan,
  createReplacementToken,
  firebaseDownloadUrl,
  hasDownloadToken,
  objectBytesEquivalent,
  objectsEquivalent,
  recordReferencedPath,
  runMigration,
  safeLogValue,
  storagePathFromDownloadUrl,
  summarizePlan
} from "./lib/legacy-storage-migration.mjs";

const EXPECTED_PROJECT = "simple-books-office";
const DEFAULT_BUCKET = "simple-books-office.firebasestorage.app";
const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArguments(argv) {
  const options = {
    apply: false,
    verify: false,
    project: EXPECTED_PROJECT,
    projectExplicit: false,
    bucket: DEFAULT_BUCKET,
    report: "",
    manifest: "",
    confirmProject: "",
    backupPrefix: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--verify") options.verify = true;
    else if (argument === "--project") {
      options.project = argv[++index] || "";
      options.projectExplicit = true;
    }
    else if (argument === "--bucket") options.bucket = argv[++index] || "";
    else if (argument === "--report") options.report = argv[++index] || "";
    else if (argument === "--manifest") options.manifest = argv[++index] || "";
    else if (argument === "--confirm-project") options.confirmProject = argv[++index] || "";
    else if (argument === "--backup-prefix") options.backupPrefix = argv[++index] || "";
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    "Dry run (read-only, default):",
    "  node scripts/migrate-legacy-storage-attachments.mjs --project simple-books-office --report migration-reports/legacy-storage-dry-run.json",
    "",
    "Guarded apply (DO NOT RUN until the dry run and backup plan are approved):",
    "  node scripts/migrate-legacy-storage-attachments.mjs --apply --project simple-books-office --confirm-project simple-books-office --manifest C:\\private\\simple-books\\legacy-storage-apply.json --backup-prefix migration-backups/<approved-run-id>",
    "",
    "Post-apply verification (read-only):",
    "  node scripts/migrate-legacy-storage-attachments.mjs --verify --project simple-books-office --confirm-project simple-books-office --manifest C:\\private\\simple-books\\legacy-storage-apply.json",
  ].join("\n");
}

function detectFirebaseProject() {
  try {
    const firebaseConfig = JSON.parse(readFileSync(resolve(workspaceRoot, ".firebaserc"), "utf8"));
    return firebaseConfig.projects?.default || "";
  } catch {
    return "";
  }
}

function validateOptions(options, detectedProject = detectFirebaseProject()) {
  if (!options.project || options.project !== EXPECTED_PROJECT) {
    throw new Error(`Refusing unexpected Firebase project: ${options.project || "(missing)"}`);
  }
  if (options.bucket !== DEFAULT_BUCKET) {
    throw new Error(`Refusing unexpected Firebase Storage bucket: ${options.bucket || "(missing)"}`);
  }
  if (options.apply && options.verify) {
    throw new Error("Choose either --apply or --verify, not both.");
  }
  if (!options.apply && !options.verify) return;
  if (!options.projectExplicit) {
    throw new Error("Apply and verification modes require an explicit --project simple-books-office argument.");
  }
  if (options.confirmProject !== options.project || options.confirmProject !== EXPECTED_PROJECT) {
    throw new Error("Apply mode requires --confirm-project simple-books-office.");
  }
  if (detectedProject !== EXPECTED_PROJECT) {
    throw new Error(`Refusing detected Firebase project: ${detectedProject || "(missing)"}`);
  }
  if (!options.manifest) throw new Error("Apply and verification modes require a private --manifest path.");
  if (options.apply && !/^migration-backups\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.backupPrefix)) {
    throw new Error("Apply mode requires a single explicit run ID below migration-backups/.");
  }
  const manifestPath = resolve(options.manifest);
  const relativeManifest = relative(workspaceRoot, manifestPath);
  const insideWorkspace = relativeManifest === ""
    || (!relativeManifest.startsWith(`..${sep}`) && !isAbsolute(relativeManifest));
  if (insideWorkspace) {
    throw new Error("The sensitive manifest must be outside the repository and its public Hosting root.");
  }
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.events)) {
    throw new Error("The migration manifest is missing or invalid.");
  }
  return manifest;
}

function assertExpectedInitialPlan(summary) {
  const unassigned = summary.byStatus?.[MIGRATION_STATUSES.UNASSIGNED] || 0;
  const ambiguous = summary.byStatus?.[MIGRATION_STATUSES.AMBIGUOUS_OWNER] || 0;
  if (
    summary.totalLegacyReferencesAndObjects !== 45
    || summary.linkedReady !== 26
    || summary.unresolved !== 19
    || unassigned !== 19
    || ambiguous !== 0
    || summary.alreadyMigrated !== 0
    || summary.destinationConflicts !== 0
    || summary.missingSources !== 0
    || summary.errors !== 0
  ) {
    throw new Error("The initial apply plan no longer matches the approved 45/26/19 migration baseline.");
  }
}

function assertApplyPlanAllowed({ options, plan, summary }) {
  const manifestPath = resolve(options.manifest);
  if (!existsSync(manifestPath)) {
    assertExpectedInitialPlan(summary);
    return;
  }

  const manifest = readManifest(manifestPath);
  if (manifest.project !== options.project || manifest.bucket !== options.bucket || manifest.backupPrefix !== options.backupPrefix) {
    throw new Error("The existing manifest does not match this project, bucket or backup run.");
  }
  const baselineEvent = manifest.events.find(event => event.stage === "RUN_PLAN");
  if (!baselineEvent?.plan || !baselineEvent?.summary) {
    throw new Error("The existing manifest has no approved RUN_PLAN baseline.");
  }
  assertExpectedInitialPlan(baselineEvent.summary);

  const baselinePaths = new Set(baselineEvent.plan.map(item => item.source.path));
  const baselineUnresolved = new Set(baselineEvent.plan
    .filter(item => item.status === MIGRATION_STATUSES.UNASSIGNED)
    .map(item => item.source.path));
  const currentUnresolved = new Set(plan
    .filter(item => item.status === MIGRATION_STATUSES.UNASSIGNED)
    .map(item => item.source.path));
  if (
    plan.some(item => !baselinePaths.has(item.source.path))
    || baselineUnresolved.size !== 19
    || currentUnresolved.size !== 19
    || [...baselineUnresolved].some(path => !currentUnresolved.has(path))
    || (summary.byStatus?.[MIGRATION_STATUSES.AMBIGUOUS_OWNER] || 0) !== 0
    || summary.destinationConflicts !== 0
    || summary.missingSources !== 0
    || summary.errors !== 0
  ) {
    throw new Error("The retry plan has drifted from the approved manifest baseline.");
  }
}

function getAccessToken() {
  const command = process.platform === "win32"
    ? { executable: "powershell.exe", args: ["-NoProfile", "-Command", "gcloud.cmd auth print-access-token"] }
    : { executable: "gcloud", args: ["auth", "print-access-token"] };
  const result = spawnSync(command.executable, command.args, { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Unable to obtain a Google Cloud access token from the signed-in gcloud account.");
  }
  return result.stdout.trim();
}

function apiClient(accessToken) {
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    if (options.allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const safeUrl = new URL(url);
      safeUrl.searchParams.delete("token");
      throw new Error(`${options.method || "GET"} ${safeUrl.origin}${safeUrl.pathname} failed with ${response.status}.`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
  return { request };
}

function firestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(firestoreValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, firestoreValue(child)]));
  return null;
}

function firestoreDocument(document) {
  return {
    documentName: document.name,
    updateTime: document.updateTime || "",
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreValue(value)]))
  };
}

function firestoreField(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value === null) return { nullValue: null };
  throw new Error(`Unsupported Firestore migration field type: ${typeof value}`);
}

async function listFirestoreDocuments(client, project, collectionPath) {
  const documents = [];
  let pageToken = "";
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collectionPath}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await client.request(url);
    documents.push(...(body.documents || []).map(firestoreDocument));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return documents;
}

async function loadAttachmentRecords(client, project) {
  const users = await listFirestoreDocuments(client, project, "users");
  const records = [];
  for (const user of users) {
    const uid = user.documentName.split("/").pop();
    for (const recordType of ["bills", "expenses", "clients"]) {
      const children = await listFirestoreDocuments(client, project, `users/${uid}/${recordType}`);
      for (const record of children) {
        const attachmentUrl = record.attachmentUrl || "";
        const attachmentPath = record.attachmentPath || "";
        records.push({
          uid,
          recordType,
          recordId: record.documentName.split("/").pop(),
          documentName: record.documentName,
          updateTime: record.updateTime,
          attachmentName: record.attachmentName || "",
          attachmentPath,
          attachmentUrl,
          attachmentSize: Number(record.attachmentSize || 0),
          attachmentType: record.attachmentType || ""
        });
      }
    }
  }
  return records;
}

async function listStorageObjects(client, bucket) {
  const objects = [];
  let pageToken = "";
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o`);
    url.searchParams.set("maxResults", "1000");
    url.searchParams.set("fields", "items(name,bucket,size,contentType,md5Hash,crc32c,generation,metageneration,timeCreated,updated,metadata),nextPageToken");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await client.request(url);
    objects.push(...(body.items || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return objects;
}

function reportPath(options) {
  if (options.report) return resolve(options.report);
  return resolve("migration-reports", "legacy-storage-dry-run.json");
}

function writeJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  renameSync(temporaryPath, path);
}

function printPlan(plan, summary, outputPath) {
  for (const item of plan) {
    const owner = item.references[0]?.uid ? ` owner=${item.references[0].uid}` : "";
    console.log(`${item.status}: ${item.source.path}${owner}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Sanitized report: ${outputPath}`);
}

function createManifestWriter(options) {
  const manifestPath = resolve(options.manifest);
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {
        schemaVersion: 1,
        sensitive: true,
        warning: "Contains bearer-token URLs and original metadata. Keep private and out of Git.",
        project: options.project,
        bucket: options.bucket,
        backupPrefix: options.backupPrefix,
        startedAt: new Date().toISOString(),
        events: []
      };
  if (
    manifest.schemaVersion !== 1
    || manifest.project !== options.project
    || manifest.bucket !== options.bucket
    || manifest.backupPrefix !== options.backupPrefix
    || !Array.isArray(manifest.events)
  ) {
    throw new Error("The existing manifest does not match this project, bucket or backup run.");
  }
  return async event => {
    manifest.events.push({ at: new Date().toISOString(), ...event });
    writeJson(manifestPath, manifest);
  };
}

function storageObjectUrl(bucket, path) {
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(path)}`;
}

async function rewriteObject(client, bucket, source, destination, metadata) {
  if (!source.generation) throw new Error(`Source generation is required before copy: ${source.name}`);
  const url = new URL(`${storageObjectUrl(bucket, source.name)}/rewriteTo/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(destination)}`);
  url.searchParams.set("ifGenerationMatch", "0");
  url.searchParams.set("ifSourceGenerationMatch", source.generation);
  const requestBody = JSON.stringify(storageCopyResource(source, metadata));
  let body = await client.request(url, { method: "POST", body: requestBody });
  while (!body.done) {
    url.searchParams.set("rewriteToken", body.rewriteToken);
    body = await client.request(url, { method: "POST", body: requestBody });
  }
  return body.resource;
}

async function patchObjectMetadata(client, bucket, object, metadata) {
  if (!object.metageneration) throw new Error(`Object metageneration is required before metadata update: ${object.name}`);
  const url = new URL(storageObjectUrl(bucket, object.name));
  url.searchParams.set("ifMetagenerationMatch", object.metageneration);
  return client.request(url, { method: "PATCH", body: JSON.stringify({ metadata }) });
}

const COPYABLE_SYSTEM_METADATA_FIELDS = [
  "cacheControl",
  "contentDisposition",
  "contentEncoding",
  "contentLanguage",
  "contentType",
  "customTime"
];

function storageCopyResource(source, metadata) {
  const resource = { metadata };
  for (const field of COPYABLE_SYSTEM_METADATA_FIELDS) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== "") {
      resource[field] = source[field];
    }
  }
  return resource;
}

function backupNeedsMetadataRepair(source, backup, expectedMetadata) {
  if (backup.metadata?.firebaseStorageDownloadTokens) return true;
  if (backup.metadata?.migrationBackupOf !== expectedMetadata.migrationBackupOf) return true;
  if (backup.metadata?.migrationRun !== expectedMetadata.migrationRun) return true;
  return COPYABLE_SYSTEM_METADATA_FIELDS.some(field =>
    (source[field] || "") !== (backup[field] || "")
  );
}

async function patchBackupMetadata(client, bucket, backup, source, metadata) {
  if (!backup.metageneration) throw new Error(`Object metageneration is required before metadata update: ${backup.name}`);
  const url = new URL(storageObjectUrl(bucket, backup.name));
  url.searchParams.set("ifMetagenerationMatch", backup.metageneration);
  return client.request(url, {
    method: "PATCH",
    body: JSON.stringify(storageCopyResource(source, metadata))
  });
}

function createApplyOperations({ client, options, objectsByPath }) {
  const getObject = async path => {
    const object = await client.request(storageObjectUrl(options.bucket, path), { allowNotFound: true });
    if (object) objectsByPath.set(path, object);
    return object;
  };
  const getRecord = async documentName => firestoreDocument(await client.request(`https://firestore.googleapis.com/v1/${documentName}`));
  const recordManifest = createManifestWriter(options);

  return {
    getObject,
    getRecord,
    createReplacementToken,
    recordManifest,
    assertRecordStillOwnsSource(current, planned, sourcePath, destinationPath) {
      const currentPath = recordReferencedPath(current);
      if (current.documentName !== planned.documentName || ![sourcePath, destinationPath].includes(currentPath)) {
        throw new Error(`Firestore relationship changed before migration: ${planned.documentName}`);
      }
    },
    async copyForBackup(source, backupPath, context) {
      const metadata = { ...(source.metadata || {}) };
      delete metadata.firebaseStorageDownloadTokens;
      metadata.migrationBackupOf = source.name;
      metadata.migrationRun = context.runId;
      const existing = await getObject(backupPath);
      if (existing) {
        if (!objectBytesEquivalent(source, existing)) throw new Error(`Backup conflict: ${backupPath}`);
        if (backupNeedsMetadataRepair(source, existing, metadata)) {
          return patchBackupMetadata(client, options.bucket, existing, source, metadata);
        }
        return existing;
      }
      return rewriteObject(client, options.bucket, source, backupPath, metadata);
    },
    async copyForDestination(source, destinationPath, replacementToken, uid, context) {
      const metadata = { ...(source.metadata || {}) };
      metadata.firebaseStorageDownloadTokens = replacementToken;
      metadata.ownerUid = uid;
      metadata.migratedFrom = source.name;
      metadata.migrationRun = context.runId;
      return rewriteObject(client, options.bucket, source, destinationPath, metadata);
    },
    async ensureDestinationToken(destination, destinationPath, replacementToken, uid, context, source) {
      const destinationTokens = String(destination.metadata?.firebaseStorageDownloadTokens || "")
        .split(",").map(token => token.trim()).filter(Boolean);
      const sourceTokens = String(source.metadata?.firebaseStorageDownloadTokens || "")
        .split(",").map(token => token.trim()).filter(Boolean);
      let token = replacementToken
        || (destinationTokens.length === 1 && !sourceTokens.includes(destinationTokens[0]) ? destinationTokens[0] : "");
      if (token) return { destination, replacementToken: token };
      token = createReplacementToken();
      const metadata = {
        ...(destination.metadata || {}),
        firebaseStorageDownloadTokens: token,
        ownerUid: uid,
        migrationRun: context.runId
      };
      const updated = await patchObjectMetadata(client, options.bucket, destination, metadata);
      return { destination: updated, replacementToken: token };
    },
    async verifyEquivalent(source, copy) {
      if (!objectsEquivalent(source, copy)) throw new Error(`Object verification failed: ${copy?.name || "missing copy"}`);
    },
    verifyBackupTokenFree(backup) {
      if (backup.metadata?.firebaseStorageDownloadTokens) {
        throw new Error(`Backup unexpectedly has Firebase download-token metadata: ${backup.name}`);
      }
    },
    verifyReplacementToken(source, destination, replacementToken) {
      const sourceTokens = String(source.metadata?.firebaseStorageDownloadTokens || "")
        .split(",").map(token => token.trim()).filter(Boolean);
      const destinationTokens = String(destination.metadata?.firebaseStorageDownloadTokens || "")
        .split(",").map(token => token.trim()).filter(Boolean);
      if (!replacementToken || sourceTokens.includes(replacementToken) || !destinationTokens.includes(replacementToken)) {
        throw new Error(`Destination replacement-token verification failed: ${destination.name}`);
      }
    },
    destinationDownloadUrl(destinationPath, destination, token) {
      const resolvedToken = token || destination.metadata?.firebaseStorageDownloadTokens;
      if (!resolvedToken) throw new Error(`Destination has no Firebase download token: ${destinationPath}`);
      return firebaseDownloadUrl(options.bucket, destinationPath, resolvedToken);
    },
    legacyDownloadUrls(source) {
      return String(source.metadata?.firebaseStorageDownloadTokens || "")
        .split(",")
        .map(token => token.trim())
        .filter(Boolean)
        .map(token => firebaseDownloadUrl(options.bucket, source.name, token));
    },
    async updateRecord(currentRecord, update) {
      if (!currentRecord.updateTime) {
        throw new Error(`Firestore updateTime is required before update: ${currentRecord.documentName}`);
      }
      const url = new URL(`https://firestore.googleapis.com/v1/${currentRecord.documentName}`);
      for (const field of Object.keys(update)) url.searchParams.append("updateMask.fieldPaths", field);
      url.searchParams.set("currentDocument.updateTime", currentRecord.updateTime);
      const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, firestoreField(value)]));
      await client.request(url, { method: "PATCH", body: JSON.stringify({ fields }) });
    },
    verifyRecordUpdate(updatedRecord, expected) {
      for (const [key, value] of Object.entries(expected)) {
        if (updatedRecord[key] !== value) throw new Error(`Firestore verification failed for ${key}.`);
      }
    },
    async verifyReplacementAccess(downloadUrl) {
      const response = await fetch(downloadUrl, { headers: { range: "bytes=0-0" } });
      if (![200, 206].includes(response.status)) throw new Error(`Replacement URL verification failed with ${response.status}.`);
    },
    async assertDestructiveBoundaryUnchanged({
      source,
      backup,
      destination,
      updatedRecord,
      attachmentUpdate,
      replacementToken
    }) {
      const [currentBackup, currentDestination, currentRecord] = await Promise.all([
        getObject(backup.name),
        getObject(destination.name),
        getRecord(updatedRecord.documentName)
      ]);
      if (
        !currentBackup
        || currentBackup.generation !== backup.generation
        || !objectsEquivalent(source, currentBackup)
      ) {
        throw new Error(`Backup changed before source deletion: ${source.name}`);
      }
      this.verifyBackupTokenFree(currentBackup);
      if (
        !currentDestination
        || currentDestination.generation !== destination.generation
        || !objectsEquivalent(source, currentDestination)
      ) {
        throw new Error(`Destination changed before source deletion: ${source.name}`);
      }
      this.verifyReplacementToken(source, currentDestination, replacementToken);
      if (!currentRecord.updateTime || currentRecord.updateTime !== updatedRecord.updateTime) {
        throw new Error(`Firestore record changed before source deletion: ${source.name}`);
      }
      this.verifyRecordUpdate(currentRecord, attachmentUpdate);
    },
    async removeLegacyObject(source) {
      if (!source.generation) throw new Error(`Source generation is required before deletion: ${source.name}`);
      const url = new URL(storageObjectUrl(options.bucket, source.name));
      url.searchParams.set("ifGenerationMatch", source.generation);
      await client.request(url, { method: "DELETE" });
      objectsByPath.delete(source.name);
    },
    async verifyLegacyTokensRevoked(oldDownloadUrls, sourcePath) {
      if (await getObject(sourcePath)) throw new Error(`Legacy object still exists after deletion: ${sourcePath}`);
      for (const oldDownloadUrl of oldDownloadUrls) {
        const response = await fetch(oldDownloadUrl, { headers: { range: "bytes=0-0" } });
        if (![401, 403, 404].includes(response.status)) {
          throw new Error(`Legacy bearer token still returned HTTP ${response.status}.`);
        }
      }
    }
  };
}

function splitDownloadTokens(object) {
  return String(object?.metadata?.firebaseStorageDownloadTokens || "")
    .split(",")
    .map(token => token.trim())
    .filter(Boolean);
}

async function requireDownloadStatus(url, allowedStatuses, description) {
  const response = await fetch(url, { headers: { range: "bytes=0-0" } });
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${description} returned unexpected HTTP ${response.status}.`);
  }
}

function verifyUnresolvedObjectUnchanged(baseline, current) {
  if (!current) throw new Error(`Unresolved legacy object is missing: ${baseline.path}`);
  const comparisons = [
    [Number(current.size || 0), Number(baseline.size || 0), "size"],
    [current.contentType || "", baseline.contentType || "", "content type"],
    [current.md5Hash || "", baseline.md5Hash || "", "MD5"],
    [current.crc32c || "", baseline.crc32c || "", "CRC32C"],
    [current.generation || "", baseline.generation || "", "generation"],
    [current.metageneration || "", baseline.metageneration || "", "metageneration"],
    [current.timeCreated || "", baseline.timeCreated || "", "creation time"],
    [current.updated || "", baseline.updated || "", "update time"],
    [Boolean(current.metadata?.firebaseStorageDownloadTokens), Boolean(baseline.downloadTokenPresent), "download-token presence"],
    [JSON.stringify(Object.keys(current.metadata || {}).sort()), JSON.stringify(baseline.customMetadataKeys || []), "custom metadata keys"]
  ];
  for (const [actual, expected, field] of comparisons) {
    if (actual !== expected) throw new Error(`Unresolved object ${field} changed: ${baseline.path}`);
  }
}

async function verifyAppliedMigration({ options, objects, records, plan, summary }) {
  const manifest = readManifest(options.manifest);
  if (manifest.project !== options.project || manifest.bucket !== options.bucket) {
    throw new Error("The verification manifest does not match the selected project and bucket.");
  }
  const baselineEvent = manifest.events.find(event => event.stage === "RUN_PLAN");
  if (!baselineEvent?.plan || !baselineEvent?.summary) {
    throw new Error("The manifest has no approved RUN_PLAN baseline.");
  }
  assertExpectedInitialPlan(baselineEvent.summary);

  const baselineLinked = baselineEvent.plan.filter(item => item.status === MIGRATION_STATUSES.READY);
  const baselineUnresolved = baselineEvent.plan.filter(item => item.status === MIGRATION_STATUSES.UNASSIGNED);
  if (baselineLinked.length !== 26 || baselineUnresolved.length !== 19) {
    throw new Error("The manifest baseline does not contain the approved 26 linked and 19 unresolved objects.");
  }

  const objectsByPath = new Map(objects.map(object => [object.name, object]));
  const recordsByName = new Map(records.map(record => [record.documentName, record]));
  const firstBeforeBySource = new Map();
  for (const event of manifest.events) {
    const sourcePath = event.before?.sourcePath;
    if (event.stage === "BEFORE" && sourcePath && !firstBeforeBySource.has(sourcePath)) {
      firstBeforeBySource.set(sourcePath, event);
    }
  }
  if (firstBeforeBySource.size !== 26) {
    throw new Error(`Expected 26 migrated manifest entries; found ${firstBeforeBySource.size}.`);
  }

  let replacementUrlsVerified = 0;
  let legacyTokenUrlsRevoked = 0;
  for (const baselineItem of baselineLinked) {
    const sourcePath = baselineItem.source.path;
    const beforeEvent = firstBeforeBySource.get(sourcePath);
    if (!beforeEvent) throw new Error(`Missing rollback state for migrated source: ${sourcePath}`);
    const before = beforeEvent.before;
    const source = before.source;
    const backup = objectsByPath.get(before.backupPath);
    const destination = objectsByPath.get(before.destinationPath);
    const currentRecord = recordsByName.get(before.record.documentName);

    if (objectsByPath.has(sourcePath)) throw new Error(`Migrated legacy source still exists: ${sourcePath}`);
    if (!objectsEquivalent(source, backup)) throw new Error(`Backup verification failed: ${sourcePath}`);
    if (splitDownloadTokens(backup).length) throw new Error(`Backup has download-token metadata: ${sourcePath}`);
    if (!objectsEquivalent(source, destination)) throw new Error(`Destination verification failed: ${sourcePath}`);

    const sourceTokens = splitDownloadTokens(source);
    const destinationTokens = splitDownloadTokens(destination);
    if (!sourceTokens.length) {
      throw new Error(`Manifest source has no legacy download token to verify: ${sourcePath}`);
    }
    if (destinationTokens.length !== 1 || sourceTokens.includes(destinationTokens[0])) {
      throw new Error(`Destination token is missing, ambiguous or inherited from the source: ${sourcePath}`);
    }
    if (!currentRecord || currentRecord.attachmentPath !== before.destinationPath) {
      throw new Error(`Firestore does not point to the migrated destination: ${sourcePath}`);
    }
    if (storagePathFromDownloadUrl(currentRecord.attachmentUrl) !== before.destinationPath) {
      throw new Error(`Firestore attachmentUrl does not resolve to the migrated destination: ${sourcePath}`);
    }
    const currentRecordToken = new URL(currentRecord.attachmentUrl).searchParams.get("token") || "";
    if (currentRecordToken !== destinationTokens[0]) {
      throw new Error(`Firestore attachmentUrl token does not match the destination: ${sourcePath}`);
    }
    if (
      Number(currentRecord.attachmentSize || 0) !== Number(destination.size || 0)
      || (destination.contentType && currentRecord.attachmentType !== destination.contentType)
    ) {
      throw new Error(`Firestore attachment metadata does not match the destination: ${sourcePath}`);
    }

    await requireDownloadStatus(currentRecord.attachmentUrl, [200, 206], "Replacement attachment");
    replacementUrlsVerified += 1;
    for (const sourceToken of sourceTokens) {
      await requireDownloadStatus(
        firebaseDownloadUrl(options.bucket, sourcePath, sourceToken),
        [401, 403, 404],
        "Legacy attachment token"
      );
      legacyTokenUrlsRevoked += 1;
    }
  }

  const currentUnresolved = plan.filter(item => item.status === MIGRATION_STATUSES.UNASSIGNED);
  if (
    summary.totalLegacyReferencesAndObjects !== 19
    || summary.linkedReady !== 0
    || summary.unresolved !== 19
    || currentUnresolved.length !== 19
    || summary.alreadyMigrated !== 0
    || summary.destinationConflicts !== 0
    || summary.missingSources !== 0
    || summary.errors !== 0
    || (summary.byStatus?.[MIGRATION_STATUSES.AMBIGUOUS_OWNER] || 0) !== 0
  ) {
    throw new Error("Post-migration live plan is not the expected 19 unresolved-only state.");
  }
  const currentUnresolvedPaths = new Set(currentUnresolved.map(item => item.source.path));
  for (const baselineItem of baselineUnresolved) {
    if (!currentUnresolvedPaths.has(baselineItem.source.path)) {
      throw new Error(`Unresolved object is no longer isolated: ${baselineItem.source.path}`);
    }
    verifyUnresolvedObjectUnchanged(baselineItem.source, objectsByPath.get(baselineItem.source.path));
  }

  return {
    mode: "POST_APPLY_READ_ONLY_VERIFICATION",
    status: "PASS",
    migratedObjectsVerified: 26,
    FirestoreRecordsVerified: 26,
    replacementUrlsVerified,
    legacyObjectsWithTokensRevoked: 26,
    legacyTokenUrlsRevoked,
    unresolvedObjectsUntouched: 19,
    destinationConflicts: 0,
    missingSources: 0,
    errors: 0
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);
  const accessToken = getAccessToken();
  const client = apiClient(accessToken);
  const [objects, records] = await Promise.all([
    listStorageObjects(client, options.bucket),
    loadAttachmentRecords(client, options.project)
  ]);
  const plan = buildMigrationPlan({ objects, records });
  const summary = summarizePlan(plan);

  if (options.verify) {
    const result = await verifyAppliedMigration({ options, objects, records, plan, summary });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!options.apply) {
    const outputPath = reportPath(options);
    const report = {
      schemaVersion: 1,
      mode: "DRY_RUN_READ_ONLY",
      generatedAt: new Date().toISOString(),
      project: options.project,
      bucket: options.bucket,
      summary,
      items: safeLogValue(plan)
    };
    writeJson(outputPath, report);
    printPlan(plan, summary, outputPath);
    return;
  }

  assertApplyPlanAllowed({ options, plan, summary });
  const runId = options.backupPrefix.slice("migration-backups/".length);
  const objectsByPath = new Map(objects.map(object => [object.name, object]));
  const operations = createApplyOperations({ client, options, objectsByPath });
  await operations.recordManifest({ stage: "RUN_PLAN", summary, plan: safeLogValue(plan) });
  const result = await runMigration({
    plan,
    apply: true,
    operations,
    context: { backupPrefix: options.backupPrefix, runId }
  });
  console.log(JSON.stringify(safeLogValue(result), null, 2));
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch(error => {
    const mode = process.argv.includes("--apply")
      ? "apply"
      : process.argv.includes("--verify") ? "verification" : "dry run";
    console.error(`Migration ${mode} failed: ${safeLogValue(error.message)}`);
    process.exit(1);
  });
}

export {
  assertApplyPlanAllowed,
  apiClient,
  backupNeedsMetadataRepair,
  createApplyOperations,
  detectFirebaseProject,
  getAccessToken,
  listStorageObjects,
  loadAttachmentRecords,
  patchBackupMetadata,
  parseArguments,
  readManifest,
  requireDownloadStatus,
  rewriteObject,
  splitDownloadTokens,
  storageObjectUrl,
  validateOptions,
  verifyAppliedMigration,
  writeJson
};
