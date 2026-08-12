import { randomUUID } from "node:crypto";

export const MIGRATION_STATUSES = Object.freeze({
  READY: "LINKED — READY TO MIGRATE",
  UNASSIGNED: "UNASSIGNED — REQUIRES REVIEW",
  CONFLICT: "CONFLICT — DESTINATION EXISTS",
  MISSING_SOURCE: "MISSING SOURCE",
  AMBIGUOUS_OWNER: "AMBIGUOUS OWNER",
  ALREADY_MIGRATED: "ALREADY MIGRATED",
  ERROR: "ERROR"
});

export const LEGACY_COLLECTIONS = Object.freeze({
  bills: "bills",
  expenses: "expenses",
  clients: "clients"
});

export function storagePathFromDownloadUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const marker = "/o/";
    const index = url.pathname.indexOf(marker);
    return index === -1 ? "" : decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

export function hasDownloadToken(value) {
  if (!value || typeof value !== "string") return false;
  try {
    return Boolean(new URL(value).searchParams.get("token"));
  } catch {
    return false;
  }
}

export function redactSensitiveValue(value) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    return url.toString();
  } catch {
    return value.replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]");
  }
}

export function safeLogValue(value) {
  if (Array.isArray(value)) return value.map(safeLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      /token/i.test(key)
        ? (typeof child === "string" ? (child ? "[redacted]" : child) : Boolean(child))
        : /attachmentUrl|downloadUrl/i.test(key)
          ? (typeof child === "string" ? redactSensitiveValue(child) : Boolean(child))
        : safeLogValue(child)
    ]));
  }
  return redactSensitiveValue(value);
}

export function legacyPathParts(path) {
  const match = String(path || "").match(/^(bills|expenses|clients)\/([^/]+)\/(.+)$/);
  return match ? { recordType: match[1], recordId: match[2], filename: match[3] } : null;
}

export function destinationPathFor(record, filename) {
  if (!record?.uid || !LEGACY_COLLECTIONS[record.recordType] || !record?.recordId || !filename) {
    throw new Error("A UID, supported record type, record ID and filename are required.");
  }
  return `users/${record.uid}/attachments/${record.recordType}/${record.recordId}/${filename}`;
}

export function recordReferencedPath(record) {
  return record?.attachmentPath || storagePathFromDownloadUrl(record?.attachmentUrl) || "";
}

export function objectFingerprint(object) {
  if (!object) return "";
  return [object.size || "", object.md5Hash || "", object.crc32c || ""].join(":");
}

export function objectBytesEquivalent(left, right) {
  if (!left || !right) return false;
  if (String(left.size || "") !== String(right.size || "")) return false;
  if (left.md5Hash && right.md5Hash) return left.md5Hash === right.md5Hash;
  return Boolean(left.crc32c && right.crc32c && left.crc32c === right.crc32c);
}

export function objectsEquivalent(left, right) {
  if (!objectBytesEquivalent(left, right)) return false;
  return !((left.contentType || right.contentType) && left.contentType !== right.contentType);
}

function recordSummary(record) {
  return {
    uid: record.uid,
    recordType: record.recordType,
    recordId: record.recordId,
    documentName: record.documentName,
    updateTime: record.updateTime || "",
    attachmentName: record.attachmentName || "",
    attachmentPath: record.attachmentPath || "",
    attachmentUrlRedacted: redactSensitiveValue(record.attachmentUrl || ""),
    attachmentUrlPresent: Boolean(record.attachmentUrl),
    attachmentUrlHasToken: hasDownloadToken(record.attachmentUrl),
    attachmentSize: Number(record.attachmentSize || 0),
    attachmentType: record.attachmentType || ""
  };
}

function objectSummary(object) {
  return {
    path: object.name,
    filename: String(object.name || "").split("/").pop() || "",
    size: Number(object.size || 0),
    contentType: object.contentType || "",
    md5Hash: object.md5Hash || "",
    crc32c: object.crc32c || "",
    generation: object.generation || "",
    metageneration: object.metageneration || "",
    timeCreated: object.timeCreated || "",
    updated: object.updated || "",
    downloadTokenPresent: Boolean(object.metadata?.firebaseStorageDownloadTokens),
    customMetadataKeys: Object.keys(object.metadata || {}).sort()
  };
}

function candidateClues(object, records, allObjects) {
  const parts = legacyPathParts(object.name);
  const recordIdMatches = parts
    ? records.filter(record => record.recordType === parts.recordType && record.recordId === parts.recordId)
      .map(record => ({ uid: record.uid, documentName: record.documentName }))
    : [];
  const equivalentPaths = allObjects
    .filter(candidate => candidate.name !== object.name && objectsEquivalent(candidate, object))
    .map(candidate => candidate.name)
    .sort();
  return { recordIdMatches, equivalentPaths };
}

export function buildMigrationPlan({ objects, records }) {
  const allObjects = [...objects];
  const objectsByPath = new Map(allObjects.map(object => [object.name, object]));
  const legacyObjects = allObjects.filter(object => legacyPathParts(object.name));
  const referencesByPath = new Map();

  for (const record of records) {
    const path = recordReferencedPath(record);
    if (!legacyPathParts(path)) continue;
    const references = referencesByPath.get(path) || [];
    references.push(record);
    referencesByPath.set(path, references);
  }

  const sourcePaths = new Set([
    ...legacyObjects.map(object => object.name),
    ...referencesByPath.keys()
  ]);

  return [...sourcePaths].sort().map(sourcePath => {
    const source = objectsByPath.get(sourcePath) || null;
    const parts = legacyPathParts(sourcePath);
    let references = referencesByPath.get(sourcePath) || [];
    if (source && references.length === 0 && parts) {
      references = records.filter(record => {
        if (record.recordType !== parts.recordType || record.recordId !== parts.recordId) return false;
        const expectedDestination = destinationPathFor(record, parts.filename);
        const destination = objectsByPath.get(expectedDestination);
        return recordReferencedPath(record) === expectedDestination && objectsEquivalent(source, destination);
      });
    }
    const base = {
      source: source ? objectSummary(source) : { path: sourcePath, filename: parts?.filename || "" },
      references: references.map(recordSummary),
      destinationPath: "",
      reason: "",
      clues: source ? candidateClues(source, records, allObjects) : { recordIdMatches: [], equivalentPaths: [] }
    };

    if (!source) {
      return { ...base, status: MIGRATION_STATUSES.MISSING_SOURCE, reason: "A record references this legacy path, but the source object was not found." };
    }
    if (references.length === 0) {
      return { ...base, status: MIGRATION_STATUSES.UNASSIGNED, reason: "No Firestore attachmentPath or attachmentUrl points to this object." };
    }

    const ownerKeys = new Set(references.map(record => `${record.uid}:${record.recordType}:${record.recordId}`));
    if (references.length !== 1 || ownerKeys.size !== 1) {
      return { ...base, status: MIGRATION_STATUSES.AMBIGUOUS_OWNER, reason: "More than one authoritative Firestore relationship points to this source." };
    }

    const record = references[0];
    if (parts.recordType !== record.recordType || parts.recordId !== record.recordId) {
      return { ...base, status: MIGRATION_STATUSES.AMBIGUOUS_OWNER, reason: "The legacy path record type or ID conflicts with the authoritative Firestore record." };
    }

    const destinationPath = destinationPathFor(record, parts.filename);
    const destination = objectsByPath.get(destinationPath) || null;
    const recordPath = recordReferencedPath(record);
    const migrated = recordPath === destinationPath;

    if (destination && migrated && objectsEquivalent(source, destination)) {
      return {
        ...base,
        destinationPath,
        destination: objectSummary(destination),
        status: MIGRATION_STATUSES.ALREADY_MIGRATED,
        reason: "The record already points to an equivalent UID-scoped object; only verified legacy cleanup may remain."
      };
    }
    if (destination && !objectsEquivalent(source, destination)) {
      return {
        ...base,
        destinationPath,
        destination: objectSummary(destination),
        status: MIGRATION_STATUSES.CONFLICT,
        reason: "A non-equivalent destination object already exists."
      };
    }
    if (destination) {
      return {
        ...base,
        destinationPath,
        destination: objectSummary(destination),
        status: MIGRATION_STATUSES.READY,
        reason: "An equivalent destination exists and can be verified before resuming the Firestore update."
      };
    }

    return {
      ...base,
      destinationPath,
      status: MIGRATION_STATUSES.READY,
      reason: "Exactly one authoritative Firestore record identifies the owner and destination."
    };
  });
}

export function summarizePlan(plan) {
  const byStatus = Object.fromEntries(Object.values(MIGRATION_STATUSES).map(status => [status, 0]));
  for (const item of plan) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  return {
    totalLegacyReferencesAndObjects: plan.length,
    linkedReady: byStatus[MIGRATION_STATUSES.READY],
    unresolved: byStatus[MIGRATION_STATUSES.UNASSIGNED] + byStatus[MIGRATION_STATUSES.AMBIGUOUS_OWNER],
    alreadyMigrated: byStatus[MIGRATION_STATUSES.ALREADY_MIGRATED],
    destinationConflicts: byStatus[MIGRATION_STATUSES.CONFLICT],
    missingSources: byStatus[MIGRATION_STATUSES.MISSING_SOURCE],
    errors: byStatus[MIGRATION_STATUSES.ERROR],
    byStatus
  };
}

export function createReplacementToken() {
  return randomUUID();
}

export function firebaseDownloadUrl(bucket, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}

export async function migratePlanItem(item, operations, context) {
  const sourcePath = item.source.path;
  const record = item.references[0];
  if (item.status !== MIGRATION_STATUSES.READY && item.status !== MIGRATION_STATUSES.ALREADY_MIGRATED) {
    return { status: "SKIPPED", reason: item.status };
  }

  const source = await operations.getObject(sourcePath);
  if (!source) throw new Error(`Source object disappeared: ${sourcePath}`);
  const currentRecord = await operations.getRecord(record.documentName);
  operations.assertRecordStillOwnsSource(currentRecord, record, sourcePath, item.destinationPath);

  const backupPath = `${context.backupPrefix}/${sourcePath}`;
  const before = {
    source,
    record: currentRecord,
    sourcePath,
    destinationPath: item.destinationPath,
    backupPath
  };
  await operations.recordManifest({ stage: "BEFORE", before });

  const backup = await operations.copyForBackup(source, backupPath, context);
  await operations.verifyEquivalent(source, backup);
  operations.verifyBackupTokenFree(backup);
  await operations.recordManifest({ stage: "BACKUP_VERIFIED", before, backup });

  let destination = await operations.getObject(item.destinationPath);
  let replacementToken = "";
  if (!destination) {
    replacementToken = operations.createReplacementToken();
    destination = await operations.copyForDestination(source, item.destinationPath, replacementToken, record.uid, context);
  }
  await operations.verifyEquivalent(source, destination);
  ({ destination, replacementToken } = await operations.ensureDestinationToken(
    destination,
    item.destinationPath,
    replacementToken,
    record.uid,
    context,
    source
  ));
  operations.verifyReplacementToken(source, destination, replacementToken);
  await operations.recordManifest({ stage: "COPY_VERIFIED", before, backup, destination });

  const replacementUrl = operations.destinationDownloadUrl(item.destinationPath, destination, replacementToken);
  const attachmentUpdate = {
    attachmentPath: item.destinationPath,
    attachmentUrl: replacementUrl,
    attachmentSize: Number(destination.size || source.size || 0),
    attachmentType: destination.contentType || source.contentType || ""
  };
  await operations.updateRecord(currentRecord, attachmentUpdate);
  const updatedRecord = await operations.getRecord(record.documentName);
  operations.verifyRecordUpdate(updatedRecord, attachmentUpdate);
  await operations.verifyReplacementAccess(replacementUrl);
  await operations.recordManifest({ stage: "RECORD_VERIFIED", before, backup, destination, attachmentUpdate, updatedRecord });

  await operations.assertDestructiveBoundaryUnchanged({
    source,
    backup,
    destination,
    updatedRecord,
    attachmentUpdate,
    replacementToken
  });

  const legacyTokenUrls = operations.legacyDownloadUrls(source);
  await operations.removeLegacyObject(source);
  await operations.verifyLegacyTokensRevoked(legacyTokenUrls, sourcePath);
  await operations.recordManifest({ stage: "COMPLETE", before, backup, destination, attachmentUpdate, updatedRecord });
  return { status: "MIGRATED", sourcePath, destinationPath: item.destinationPath, backupPath };
}

export async function runMigration({ plan, apply, operations, context }) {
  if (!apply) {
    return { mode: "DRY_RUN", summary: summarizePlan(plan), results: plan.map(item => ({ sourcePath: item.source.path, status: item.status })) };
  }
  if (!operations) throw new Error("Apply mode requires migration operations.");
  const results = [];
  for (const item of plan) {
    if (![MIGRATION_STATUSES.READY, MIGRATION_STATUSES.ALREADY_MIGRATED].includes(item.status)) {
      results.push({ sourcePath: item.source.path, status: "SKIPPED", reason: item.status });
      continue;
    }
    results.push(await migratePlanItem(item, operations, context));
  }
  return { mode: "APPLY", summary: summarizePlan(plan), results };
}
