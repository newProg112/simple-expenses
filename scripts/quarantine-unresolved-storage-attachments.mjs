#!/usr/bin/env node
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_STATUSES,
  buildMigrationPlan,
  firebaseDownloadUrl,
  objectBytesEquivalent,
  objectsEquivalent,
  recordReferencedPath,
  safeLogValue,
  summarizePlan
} from "./lib/legacy-storage-migration.mjs";
import {
  apiClient,
  detectFirebaseProject,
  getAccessToken,
  listStorageObjects,
  loadAttachmentRecords,
  patchBackupMetadata,
  readManifest,
  requireDownloadStatus,
  rewriteObject,
  splitDownloadTokens,
  storageObjectUrl,
  writeJson
} from "./migrate-legacy-storage-attachments.mjs";

const EXPECTED_PROJECT = "simple-books-office";
const EXPECTED_BUCKET = "simple-books-office.firebasestorage.app";
const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const QUARANTINE_READY = "UNRESOLVED — READY TO QUARANTINE";
const QUARANTINED = "ALREADY QUARANTINED";

function parseArguments(argv) {
  const options = {
    apply: false,
    verify: false,
    project: "",
    bucket: EXPECTED_BUCKET,
    confirmProject: "",
    baselineManifest: "",
    manifest: "",
    backupPrefix: "",
    report: "migration-reports/unresolved-storage-quarantine-dry-run.json"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--verify") options.verify = true;
    else if (argument === "--project") options.project = argv[++index] || "";
    else if (argument === "--bucket") options.bucket = argv[++index] || "";
    else if (argument === "--confirm-project") options.confirmProject = argv[++index] || "";
    else if (argument === "--baseline-manifest") options.baselineManifest = argv[++index] || "";
    else if (argument === "--manifest") options.manifest = argv[++index] || "";
    else if (argument === "--backup-prefix") options.backupPrefix = argv[++index] || "";
    else if (argument === "--report") options.report = argv[++index] || "";
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function outsideWorkspace(path) {
  const relativePath = relative(workspaceRoot, resolve(path));
  return relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function validateOptions(options, detectedProject = detectFirebaseProject()) {
  if (options.apply && options.verify) throw new Error("Choose either --apply or --verify, not both.");
  if (options.project !== EXPECTED_PROJECT) throw new Error("An explicit --project simple-books-office is required.");
  if (options.bucket !== EXPECTED_BUCKET) throw new Error(`Refusing unexpected Storage bucket: ${options.bucket || "(missing)"}`);
  if (detectedProject !== EXPECTED_PROJECT) throw new Error(`Refusing detected Firebase project: ${detectedProject || "(missing)"}`);
  if (!options.baselineManifest || !outsideWorkspace(options.baselineManifest)) {
    throw new Error("An external --baseline-manifest outside the Hosting root is required.");
  }
  if (!existsSync(resolve(options.baselineManifest))) throw new Error("The baseline manifest does not exist.");
  if (!options.apply && !options.verify) return;
  if (options.confirmProject !== EXPECTED_PROJECT) throw new Error("--confirm-project simple-books-office is required.");
  if (!options.manifest || !outsideWorkspace(options.manifest)) {
    throw new Error("An external private --manifest outside the Hosting root is required.");
  }
  if (options.apply && !/^migration-quarantine\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.backupPrefix)) {
    throw new Error("Apply requires one explicit run ID below migration-quarantine/.");
  }
}

function baselineUnresolvedItems(baselineManifest) {
  const runPlan = baselineManifest.events.find(event => event.stage === "RUN_PLAN");
  if (!runPlan?.plan || !runPlan?.summary) throw new Error("The baseline manifest has no RUN_PLAN.");
  const unresolved = runPlan.plan.filter(item => item.status === MIGRATION_STATUSES.UNASSIGNED);
  if (
    runPlan.summary.totalLegacyReferencesAndObjects !== 45
    || runPlan.summary.linkedReady !== 26
    || runPlan.summary.unresolved !== 19
    || unresolved.length !== 19
  ) {
    throw new Error("The baseline manifest is not the approved 45/26/19 migration plan.");
  }
  return unresolved;
}

function sourceMatchesBaseline(source, baseline) {
  return source
    && String(source.size || "") === String(baseline.size || "")
    && (source.contentType || "") === (baseline.contentType || "")
    && (source.md5Hash || "") === (baseline.md5Hash || "")
    && (source.crc32c || "") === (baseline.crc32c || "")
    && (source.generation || "") === (baseline.generation || "")
    && (source.metageneration || "") === (baseline.metageneration || "")
    && (source.timeCreated || "") === (baseline.timeCreated || "")
    && (source.updated || "") === (baseline.updated || "")
    && Boolean(source.metadata?.firebaseStorageDownloadTokens) === Boolean(baseline.downloadTokenPresent)
    && JSON.stringify(Object.keys(source.metadata || {}).sort()) === JSON.stringify(baseline.customMetadataKeys || []);
}

function buildQuarantinePlan({ baselineItems, currentPlan, objects, backupPrefix = "" }) {
  const currentByPath = new Map(currentPlan.map(item => [item.source.path, item]));
  const objectsByPath = new Map(objects.map(object => [object.name, object]));
  return baselineItems.map(item => {
    const sourcePath = item.source.path;
    const backupPath = backupPrefix ? `${backupPrefix}/${sourcePath}` : "";
    const source = objectsByPath.get(sourcePath) || null;
    const backup = backupPath ? objectsByPath.get(backupPath) || null : null;
    const current = currentByPath.get(sourcePath) || null;
    const base = { sourcePath, backupPath, baseline: item.source, source, backup };
    if (source) {
      if (!current || current.status !== MIGRATION_STATUSES.UNASSIGNED || current.references.length) {
        return { ...base, status: "BLOCKED", reason: "The object now has or may have a Firestore relationship." };
      }
      if (!sourceMatchesBaseline(source, item.source)) {
        return { ...base, status: "BLOCKED", reason: "The source differs from the approved unresolved baseline." };
      }
      if (backup && !objectBytesEquivalent(source, backup)) {
        return { ...base, status: "BLOCKED", reason: "A non-equivalent quarantine backup exists." };
      }
      return { ...base, status: QUARANTINE_READY, reason: "Still unreferenced and unchanged from the approved baseline." };
    }
    if (backup && objectsEquivalent(item.source, backup) && !splitDownloadTokens(backup).length) {
      return { ...base, status: QUARANTINED, reason: "Source is absent and a verified token-free backup exists." };
    }
    return { ...base, status: "BLOCKED", reason: "Source is missing without a verified quarantine backup." };
  });
}

function quarantineSummary(plan) {
  return {
    total: plan.length,
    ready: plan.filter(item => item.status === QUARANTINE_READY).length,
    alreadyQuarantined: plan.filter(item => item.status === QUARANTINED).length,
    blocked: plan.filter(item => item.status === "BLOCKED").length
  };
}

function assertCurrentQuarantineScope({ baselineItems, currentPlan, allowCompleted = false }) {
  const baselinePaths = new Set(baselineItems.map(item => item.source.path));
  if (currentPlan.some(item => !baselinePaths.has(item.source.path))) {
    throw new Error("A legacy object or reference exists outside the approved 19-object quarantine baseline.");
  }
  if (currentPlan.some(item => item.status !== MIGRATION_STATUSES.UNASSIGNED || item.references.length)) {
    throw new Error("An approved unresolved object now has a Firestore relationship or blocking state.");
  }
  if (!allowCompleted && currentPlan.length !== 19) {
    throw new Error("The initial quarantine scope is not exactly the approved 19 unresolved objects.");
  }
}

function createManifestWriter(options, baselinePlan) {
  const path = resolve(options.manifest);
  const manifest = existsSync(path)
    ? readManifest(path)
    : {
        schemaVersion: 1,
        type: "UNRESOLVED_LEGACY_STORAGE_QUARANTINE",
        sensitive: true,
        project: options.project,
        bucket: options.bucket,
        backupPrefix: options.backupPrefix,
        startedAt: new Date().toISOString(),
        events: [{ at: new Date().toISOString(), stage: "RUN_PLAN", plan: safeLogValue(baselinePlan) }]
      };
  if (
    manifest.type !== "UNRESOLVED_LEGACY_STORAGE_QUARANTINE"
    || manifest.project !== options.project
    || manifest.bucket !== options.bucket
    || manifest.backupPrefix !== options.backupPrefix
    || manifest.events.find(event => event.stage === "RUN_PLAN")?.plan?.length !== 19
  ) {
    throw new Error("The quarantine manifest does not match this approved run.");
  }
  return async event => {
    manifest.events.push({ at: new Date().toISOString(), ...event });
    writeJson(path, manifest);
  };
}

function fullObjectEquivalent(source, backup) {
  if (!objectsEquivalent(source, backup)) return false;
  const fields = ["cacheControl", "contentDisposition", "contentEncoding", "contentLanguage", "contentType", "customTime"];
  return fields.every(field => (source[field] || "") === (backup[field] || ""));
}

async function runQuarantineItem(item, operations) {
  if (item.status === QUARANTINED) return operations.resumeQuarantined(item);
  if (item.status !== QUARANTINE_READY) return { sourcePath: item.sourcePath, status: "SKIPPED", reason: item.reason };
  const source = await operations.getObject(item.sourcePath);
  operations.assertSource(source, item.baseline);
  await operations.assertUnreferenced(item.sourcePath);
  await operations.recordManifest({ stage: "BEFORE", sourcePath: item.sourcePath, backupPath: item.backupPath, source });
  const backup = await operations.copyBackup(source, item.backupPath);
  operations.verifyBackup(source, backup);
  await operations.recordManifest({ stage: "BACKUP_VERIFIED", sourcePath: item.sourcePath, backupPath: item.backupPath, source, backup });
  await operations.assertDeletionBoundary(source, backup, item.sourcePath);
  const legacyUrls = operations.legacyDownloadUrls(source);
  await operations.deleteSource(source);
  await operations.verifyDeleted(legacyUrls, item.sourcePath);
  await operations.recordManifest({ stage: "COMPLETE", sourcePath: item.sourcePath, backupPath: item.backupPath, source, backup });
  return { sourcePath: item.sourcePath, backupPath: item.backupPath, status: "QUARANTINED" };
}

function createOperations({ client, options, recordManifest }) {
  const getObject = path => client.request(storageObjectUrl(options.bucket, path), { allowNotFound: true });
  const assertUnreferencedRecords = (sourcePath, currentRecords) => {
    if (currentRecords.some(record => recordReferencedPath(record) === sourcePath)) {
      throw new Error(`Firestore now references unresolved object: ${sourcePath}`);
    }
  };
  return {
    getObject,
    recordManifest,
    assertSource(source, baseline) {
      if (!sourceMatchesBaseline(source, baseline)) throw new Error(`Source changed: ${baseline.path}`);
    },
    async assertUnreferenced(sourcePath) {
      const latestRecords = await loadAttachmentRecords(client, options.project);
      assertUnreferencedRecords(sourcePath, latestRecords);
    },
    async copyBackup(source, backupPath) {
      const metadata = { ...(source.metadata || {}) };
      delete metadata.firebaseStorageDownloadTokens;
      metadata.quarantineBackupOf = source.name;
      metadata.quarantineRun = options.backupPrefix.slice("migration-quarantine/".length);
      const existing = await getObject(backupPath);
      if (existing) {
        if (!objectBytesEquivalent(source, existing)) throw new Error(`Quarantine backup conflict: ${backupPath}`);
        if (
          !fullObjectEquivalent(source, existing)
          || splitDownloadTokens(existing).length
          || existing.metadata?.quarantineBackupOf !== source.name
          || existing.metadata?.quarantineRun !== metadata.quarantineRun
        ) {
          return patchBackupMetadata(client, options.bucket, existing, source, metadata);
        }
        return existing;
      }
      return rewriteObject(client, options.bucket, source, backupPath, metadata);
    },
    verifyBackup(source, backup) {
      if (!fullObjectEquivalent(source, backup)) throw new Error(`Quarantine backup verification failed: ${backup?.name || "missing"}`);
      if (splitDownloadTokens(backup).length) throw new Error(`Quarantine backup has a Firebase download token: ${backup.name}`);
    },
    async assertDeletionBoundary(source, backup, sourcePath) {
      const [latestSource, latestBackup, latestRecords] = await Promise.all([
        getObject(sourcePath),
        getObject(backup.name),
        loadAttachmentRecords(client, options.project)
      ]);
      if (!latestSource || latestSource.generation !== source.generation || latestSource.metageneration !== source.metageneration) {
        throw new Error(`Source changed before quarantine deletion: ${sourcePath}`);
      }
      if (!latestBackup || latestBackup.generation !== backup.generation || latestBackup.metageneration !== backup.metageneration) {
        throw new Error(`Backup changed before quarantine deletion: ${sourcePath}`);
      }
      this.verifyBackup(latestSource, latestBackup);
      assertUnreferencedRecords(sourcePath, latestRecords);
    },
    legacyDownloadUrls(source) {
      return splitDownloadTokens(source).map(token => firebaseDownloadUrl(options.bucket, source.name, token));
    },
    async deleteSource(source) {
      if (!source.generation) throw new Error(`Source generation is required: ${source.name}`);
      const url = new URL(storageObjectUrl(options.bucket, source.name));
      url.searchParams.set("ifGenerationMatch", source.generation);
      await client.request(url, { method: "DELETE" });
    },
    async verifyDeleted(urls, sourcePath) {
      if (await getObject(sourcePath)) throw new Error(`Legacy source still exists: ${sourcePath}`);
      for (const url of urls) await requireDownloadStatus(url, [401, 403, 404], "Quarantined legacy token");
    },
    async resumeQuarantined(item) {
      const manifest = readManifest(options.manifest);
      const before = manifest.events.find(event => event.stage === "BEFORE" && event.sourcePath === item.sourcePath);
      if (!before?.source) throw new Error(`Missing rollback state for quarantined source: ${item.sourcePath}`);
      const backup = await getObject(item.backupPath);
      this.verifyBackup(before.source, backup);
      await this.assertUnreferenced(item.sourcePath);
      const urls = this.legacyDownloadUrls(before.source);
      if (!urls.length) throw new Error(`No original bearer token recorded: ${item.sourcePath}`);
      await this.verifyDeleted(urls, item.sourcePath);
      await recordManifest({ stage: "COMPLETE", sourcePath: item.sourcePath, backupPath: item.backupPath, source: before.source, backup });
      return { sourcePath: item.sourcePath, backupPath: item.backupPath, status: QUARANTINED };
    }
  };
}

async function verifyQuarantine({ options, client, baselineItems, objects, records }) {
  const manifest = readManifest(options.manifest);
  if (
    manifest.type !== "UNRESOLVED_LEGACY_STORAGE_QUARANTINE"
    || manifest.project !== options.project
    || manifest.bucket !== options.bucket
    || manifest.events.find(event => event.stage === "RUN_PLAN")?.plan?.length !== 19
  ) {
    throw new Error("The quarantine verification manifest is not the approved 19-object run.");
  }
  const objectsByPath = new Map(objects.map(object => [object.name, object]));
  const remainingLegacyPlan = buildMigrationPlan({ objects, records });
  assertCurrentQuarantineScope({ baselineItems, currentPlan: remainingLegacyPlan, allowCompleted: true });
  if (remainingLegacyPlan.length) throw new Error("One or more approved legacy sources still exist after quarantine.");
  const beforeByPath = new Map(manifest.events
    .filter(event => event.stage === "BEFORE")
    .map(event => [event.sourcePath, event]));
  let revokedUrls = 0;
  for (const item of baselineItems) {
    const before = beforeByPath.get(item.source.path);
    if (!before) throw new Error(`Missing quarantine rollback state: ${item.source.path}`);
    const backup = await client.request(storageObjectUrl(options.bucket, before.backupPath), { allowNotFound: true });
    if (objectsByPath.has(item.source.path)) throw new Error(`Legacy source still exists: ${item.source.path}`);
    if (!fullObjectEquivalent(before.source, backup) || splitDownloadTokens(backup).length) {
      throw new Error(`Quarantine backup verification failed: ${item.source.path}`);
    }
    if (records.some(record => recordReferencedPath(record) === item.source.path)) {
      throw new Error(`Firestore references quarantined source: ${item.source.path}`);
    }
    const tokens = splitDownloadTokens(before.source);
    if (!tokens.length) throw new Error(`No original token recorded: ${item.source.path}`);
    for (const token of tokens) {
      await requireDownloadStatus(firebaseDownloadUrl(options.bucket, item.source.path, token), [401, 403, 404], "Quarantined legacy token");
      revokedUrls += 1;
    }
  }
  return { mode: "QUARANTINE_READ_ONLY_VERIFICATION", status: "PASS", quarantinedObjectsVerified: 19, tokenFreeBackupsVerified: 19, legacyTokenUrlsRevoked: revokedUrls, FirestoreReferences: 0, errors: 0 };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return;
  validateOptions(options);
  const baselineManifest = readManifest(options.baselineManifest);
  const baselineItems = baselineUnresolvedItems(baselineManifest);
  const client = apiClient(getAccessToken());
  const [objects, records] = await Promise.all([
    listStorageObjects(client, options.bucket),
    loadAttachmentRecords(client, options.project)
  ]);
  if (options.verify) {
    console.log(JSON.stringify(await verifyQuarantine({ options, client, baselineItems, objects, records }), null, 2));
    return;
  }
  const currentPlan = buildMigrationPlan({ objects, records });
  const retrying = options.apply && existsSync(resolve(options.manifest));
  assertCurrentQuarantineScope({ baselineItems, currentPlan, allowCompleted: retrying });
  const plan = buildQuarantinePlan({ baselineItems, currentPlan, objects, backupPrefix: options.backupPrefix });
  const summary = quarantineSummary(plan);
  if (!options.apply) {
    const report = { schemaVersion: 1, mode: "QUARANTINE_DRY_RUN_READ_ONLY", generatedAt: new Date().toISOString(), project: options.project, bucket: options.bucket, summary, items: safeLogValue(plan) };
    writeJson(resolve(options.report), report);
    for (const item of plan) console.log(`${item.status}: ${item.sourcePath}`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (summary.total !== 19 || summary.blocked || summary.ready + summary.alreadyQuarantined !== 19) {
    throw new Error("Quarantine apply requires the exact approved 19-object plan with no blocked items.");
  }
  const recordManifest = createManifestWriter(options, plan);
  const operations = createOperations({ client, options, recordManifest });
  const results = [];
  for (const item of plan) results.push(await runQuarantineItem(item, operations));
  console.log(JSON.stringify(safeLogValue({ mode: "QUARANTINE_APPLY", summary, results }), null, 2));
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch(error => {
    console.error(`Quarantine failed: ${safeLogValue(error.message)}`);
    process.exit(1);
  });
}

export { assertCurrentQuarantineScope, buildQuarantinePlan, createOperations, quarantineSummary, runQuarantineItem, sourceMatchesBaseline, validateOptions, verifyQuarantine };
