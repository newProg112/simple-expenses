"use strict";

const {createHash} = require("node:crypto");
const {
  referenceRegistryKey,
  sourceReference,
} = require("../../functions/lib/reference-registry-key");
const {
  BACKFILL_SCHEMA_VERSION,
  BACKFILL_VERSION,
  CONFLICT_SOURCE_ID,
} = require("../../functions/lib/legacy-reference-backfill-constants");
const {
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_STATES,
} = require("../../functions/lib/reference-registry-service");

const AUDIT_SCHEMA_VERSION = 1;
const AUDIT_VERSION = "phase3c3c-step2a-v1";
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const COLLECTIONS = Object.freeze({
  invoice: "invoices",
  bill: "bills",
  registry: "referenceKeys",
  metadata: "referenceBackfillMigrations",
});
const DISCOVERY_COLLECTIONS = Object.freeze([
  COLLECTIONS.invoice,
  COLLECTIONS.bill,
  COLLECTIONS.registry,
  COLLECTIONS.metadata,
]);

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function normalizeForSerialization(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Stable serialization does not support non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return {"$bigint": value.toString()};
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Stable serialization received an unsupported value.");
  }
  if (value instanceof Date) return {"$date": value.toISOString()};
  if (typeof value.toDate === "function" && typeof value.toMillis === "function") {
    return {"$timestamp": value.toDate().toISOString()};
  }
  if (Buffer.isBuffer(value)) return {"$bytes": value.toString("base64")};
  if (seen.has(value)) throw new TypeError("Stable serialization does not support cycles.");
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item) => normalizeForSerialization(item, seen));
  } else if (plainObject(value)) {
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeForSerialization(value[key], seen);
    }
  } else {
    throw new TypeError("Stable serialization supports only JSON-like values and Firestore timestamps.");
  }
  seen.delete(value);
  return normalized;
}

function canonicalSerialize(value) {
  return JSON.stringify(normalizeForSerialization(value));
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalSerialize(value), "utf8").digest("hex");
}

function auditHashValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : {"$invalidNumber": String(value)};
  if (typeof value === "bigint") return {"$bigint": value.toString()};
  if (value === undefined) return {"$undefined": true};
  if (typeof value === "function" || typeof value === "symbol") return {"$unsupported": typeof value};
  if (value instanceof Date) return {"$date": value.toISOString()};
  if (typeof value.toDate === "function" && typeof value.toMillis === "function") {
    return {"$timestamp": value.toDate().toISOString()};
  }
  if (Buffer.isBuffer(value)) return {"$bytes": value.toString("base64")};
  if (typeof value.path === "string" && value.constructor?.name === "DocumentReference") {
    return {"$reference": value.path};
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number") {
    return {"$geoPoint": [value.latitude, value.longitude]};
  }
  if (seen.has(value)) return {"$cycle": true};
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => auditHashValue(item, seen));
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) result[key] = auditHashValue(value[key], seen);
    if (!plainObject(value)) result.$type = String(value.constructor?.name || "Object");
  }
  seen.delete(value);
  return result;
}

function updateTimeText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function validatePageSize(value) {
  const pageSize = Number(value === undefined ? DEFAULT_PAGE_SIZE : value);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new TypeError(`Page size must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return pageSize;
}

function requiredIdentifier(value, label) {
  const result = String(value || "").trim();
  if (!result || result.includes("/") || /\s/.test(result)) throw new TypeError(`${label} is invalid.`);
  return result;
}

function diagnosticSort(left, right) {
  return canonicalSerialize(left).localeCompare(canonicalSerialize(right));
}

function issue(code, details = {}) {
  return {code, ...details};
}

function safeReadErrorCode(error) {
  return String(error?.code || error?.name || "read-error").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
}

function exactUserDocument(path, collectionName) {
  const segments = String(path || "").split("/");
  return segments.length === 4 && segments[0] === "users" && segments[2] === collectionName ? segments[1] : "";
}

async function readAllPages(fetchPage, metrics) {
  const documents = [];
  let cursor = null;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page || !Array.isArray(page.documents) || typeof page.nextCursor === "undefined") {
      throw new TypeError("Read-only adapter returned an invalid page.");
    }
    metrics.pagesFetched += 1;
    metrics.documentsRead += page.documents.length;
    documents.push(...page.documents);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return documents;
}

async function discoverUidUniverse(adapter, pageSize, metrics) {
  const uids = new Set();
  const sources = {};
  const failures = [];
  const unexpectedPaths = [];
  for (const collectionName of DISCOVERY_COLLECTIONS) {
    let documentsRead = 0;
    const sourceUids = new Set();
    try {
      let cursor = null;
      for (;;) {
        const page = await adapter.readCollectionGroupPage(collectionName, pageSize, cursor);
        if (!page || !Array.isArray(page.documents) || typeof page.nextCursor === "undefined") {
          throw new TypeError("Read-only adapter returned an invalid page.");
        }
        metrics.pagesFetched += 1;
        metrics.documentsRead += page.documents.length;
        documentsRead += page.documents.length;
        for (const document of page.documents) {
          const uid = exactUserDocument(document.path, collectionName);
          if (!uid) {
            unexpectedPaths.push({collectionName, pathHash: sha256(String(document.path || ""))});
            continue;
          }
          uids.add(uid);
          sourceUids.add(uid);
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    } catch (error) {
      failures.push(issue("uid-discovery-read-failed", {collectionName, errorCode: safeReadErrorCode(error)}));
      sources[collectionName] = {documentsRead, uidsDiscovered: sourceUids.size, complete: false};
      continue;
    }
    sources[collectionName] = {documentsRead, uidsDiscovered: sourceUids.size, complete: true};
  }
  return {
    complete: failures.length === 0,
    orderedUids: [...uids].sort(),
    sources,
    failures: failures.sort(diagnosticSort),
    unexpectedPaths: unexpectedPaths.sort(diagnosticSort),
  };
}

async function sourceEntry(recordType, document) {
  const data = plainObject(document.data) ? document.data : {};
  const rawReference = sourceReference(recordType, data);
  const key = await referenceRegistryKey(recordType, rawReference);
  return {
    recordType,
    sourceId: String(document.id),
    path: String(document.path),
    updateTime: updateTimeText(document.updateTime),
    rawReferenceHash: sha256(String(rawReference ?? "")),
    canonicalReference: key.canonicalReference,
    canonicalReferenceHash: sha256(key.canonicalReference),
    registryDocumentId: key.registryDocumentId,
  };
}

function registryIdentityFields(document) {
  const data = plainObject(document.data) ? document.data : {};
  return {
    documentId: String(document.id),
    path: String(document.path),
    updateTime: updateTimeText(document.updateTime),
    data,
  };
}

async function inspectRegistryDocument(document) {
  const entry = registryIdentityFields(document);
  const data = entry.data;
  const problems = [];
  let expectedDocumentId = "";
  if (data.schemaVersion !== REGISTRY_SCHEMA_VERSION) problems.push("schema-version");
  if (!Object.values(REGISTRY_STATES).includes(data.state)) problems.push("state");
  if (typeof data.canonicalReference !== "string" || !data.canonicalReference) problems.push("canonical-reference");
  if (!String(data.sourceId || "")) problems.push("source-id");
  try {
    const key = await referenceRegistryKey(data.recordType, data.canonicalReference);
    expectedDocumentId = key.registryDocumentId || "";
    if (key.canonicalReference !== data.canonicalReference) problems.push("canonical-reference-not-canonical");
    if (entry.documentId !== expectedDocumentId) problems.push("document-id");
  } catch (_error) {
    problems.push("record-type");
  }
  if (data.state === REGISTRY_STATES.LEGACY_CONFLICT) {
    if (data.sourceId !== CONFLICT_SOURCE_ID) problems.push("conflict-source-id");
    if (!Array.isArray(data.conflictingSourceIds) || data.conflictingSourceIds.some((id) => !String(id || ""))) {
      problems.push("conflicting-source-ids");
    }
  }
  return {...entry, expectedDocumentId, valid: problems.length === 0, problems: [...new Set(problems)].sort()};
}

function sourceSummary(entries, groups) {
  const collisions = [...groups.values()].filter((group) => group.length > 1);
  return {
    totalCount: entries.length,
    blankReferenceCount: entries.filter((entry) => !entry.registryDocumentId).length,
    nonblankReferenceCount: entries.filter((entry) => entry.registryDocumentId).length,
    canonicalGroupCount: groups.size,
    uniqueCanonicalGroups: [...groups.values()].filter((group) => group.length === 1).length,
    collisionGroups: collisions.length,
    recordsInCollisions: collisions.reduce((sum, group) => sum + group.length, 0),
  };
}

function metadataSummary(documents) {
  if (!documents.length) return {presence: false, count: 0, version: null, status: null, cutoverReady: null};
  const preferred = documents.find((document) => document.id === BACKFILL_VERSION) || documents[0];
  const data = plainObject(preferred.data) ? preferred.data : {};
  return {
    presence: true,
    count: documents.length,
    version: typeof data.migrationVersion === "string" ? data.migrationVersion : null,
    status: typeof data.status === "string" ? data.status : null,
    cutoverReady: typeof data.cutoverReady === "boolean" ? data.cutoverReady : null,
  };
}

function validateMetadata(documents, uid) {
  const blockers = [];
  const numericFields = [
    "scanned", "blankSkipped", "activeClaimCreated", "activeClaimAlreadyValid",
    "legacyConflictCreated", "legacyConflictAlreadyValid", "incompatibleExistingRegistry",
    "sourceChangedDuringApply", "migrationErrors", "collisionGroups",
  ];
  for (const document of documents) {
    const data = plainObject(document.data) ? document.data : null;
    const valid = document.id === BACKFILL_VERSION && data &&
      data.schemaVersion === BACKFILL_SCHEMA_VERSION && data.migrationVersion === BACKFILL_VERSION &&
      ["complete", "incomplete"].includes(data.status) && typeof data.cutoverReady === "boolean" &&
      data.cutoverReady === (data.status === "complete") && Boolean(data.lastRunAt) &&
      (data.status !== "complete" || Boolean(data.completedAt)) &&
      numericFields.every((field) => Number.isInteger(data[field]) && data[field] >= 0);
    if (!valid) blockers.push(issue("unexpected-migration-metadata", {uid, metadataDocumentId: String(document.id)}));
  }
  return blockers;
}

function hashSourceEntries(entries) {
  return sha256(entries.map((entry) => ({
    path: entry.path,
    sourceId: entry.sourceId,
    recordType: entry.recordType,
    rawReferenceHash: entry.rawReferenceHash,
    canonicalReferenceHash: entry.canonicalReferenceHash,
    registryDocumentId: entry.registryDocumentId,
    updateTime: entry.updateTime,
  })).sort(diagnosticSort));
}

function hashRegistryEntries(entries) {
  return sha256(entries.map((entry) => ({
    path: entry.path,
    documentId: entry.documentId,
    updateTime: entry.updateTime,
    data: auditHashValue(entry.data),
  })).sort(diagnosticSort));
}

function hashMetadataEntries(entries) {
  return sha256(entries.map((entry) => ({
    path: String(entry.path), id: String(entry.id), updateTime: updateTimeText(entry.updateTime), data: auditHashValue(entry.data),
  })).sort(diagnosticSort));
}

function consistentConflict(registry, group) {
  const storedIds = Array.isArray(registry.data.conflictingSourceIds) ?
    registry.data.conflictingSourceIds.map(String).sort() : [];
  const liveIds = group.map((entry) => entry.sourceId).sort();
  return registry.data.state === REGISTRY_STATES.LEGACY_CONFLICT &&
    registry.data.sourceId === CONFLICT_SOURCE_ID &&
    Number(registry.data.conflictCount) === liveIds.length &&
    canonicalSerialize(storedIds) === canonicalSerialize(liveIds);
}

async function auditUid(adapter, uid, pageSize, metrics) {
  const collectionResults = {};
  const readFailures = [];
  for (const collectionName of Object.values(COLLECTIONS)) {
    try {
      collectionResults[collectionName] = await readAllPages(
          (cursor) => adapter.readUserCollectionPage(uid, collectionName, pageSize, cursor), metrics,
      );
    } catch (error) {
      collectionResults[collectionName] = [];
      readFailures.push(issue("uid-collection-read-failed", {
        uid, collectionName, errorCode: safeReadErrorCode(error),
      }));
    }
  }

  const invoiceEntries = await Promise.all(collectionResults.invoices.map((document) => sourceEntry("invoice", document)));
  const billEntries = await Promise.all(collectionResults.bills.map((document) => sourceEntry("bill", document)));
  const allSources = [...invoiceEntries, ...billEntries].sort(diagnosticSort);
  const groupsByType = {invoice: new Map(), bill: new Map()};
  for (const entry of allSources) {
    if (!entry.registryDocumentId) continue;
    const groups = groupsByType[entry.recordType];
    const group = groups.get(entry.registryDocumentId) || [];
    group.push(entry);
    group.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    groups.set(entry.registryDocumentId, group);
  }
  metrics.peakCanonicalGroupSize = Math.max(metrics.peakCanonicalGroupSize,
      ...[...groupsByType.invoice.values(), ...groupsByType.bill.values()].map((group) => group.length), 0);

  const registryEntries = await Promise.all(collectionResults.referenceKeys.map(inspectRegistryDocument));
  registryEntries.sort((left, right) => left.documentId.localeCompare(right.documentId));
  const registryById = new Map(registryEntries.map((entry) => [entry.documentId, entry]));
  const liveGroupByRegistryId = new Map([...groupsByType.invoice, ...groupsByType.bill]);
  const blockers = [...readFailures];
  const warnings = [];
  const diagnostics = [];
  let activeClaimsToCreate = 0;
  let legacyConflictsToCreate = 0;

  for (const entry of allSources.filter((source) => !source.registryDocumentId)) {
    diagnostics.push(issue("blank-reference", {uid, recordType: entry.recordType, sourceId: entry.sourceId}));
  }

  for (const registry of registryEntries) {
    if (!registry.valid) {
      blockers.push(issue("malformed-registry-document", {
        uid, registryDocumentId: registry.documentId, problems: registry.problems,
      }));
      const liveGroup = liveGroupByRegistryId.get(registry.documentId);
      if (registry.problems.includes("record-type") ||
        (liveGroup && registry.data.recordType !== liveGroup[0].recordType)) {
        blockers.push(issue("namespace-type-mismatch", {uid, registryDocumentId: registry.documentId}));
      }
      if (registry.problems.includes("document-id")) {
        blockers.push(issue("registry-document-id-mismatch", {
          uid, registryDocumentId: registry.documentId, expectedRegistryDocumentId: registry.expectedDocumentId,
        }));
      }
    }
  }

  for (const recordType of ["invoice", "bill"]) {
    for (const [registryDocumentId, group] of [...groupsByType[recordType]].sort(([left], [right]) => left.localeCompare(right))) {
      const registry = registryById.get(registryDocumentId);
      const common = {
        uid, recordType, registryDocumentId,
        canonicalReferenceHash: group[0].canonicalReferenceHash,
        sourceIds: group.map((entry) => entry.sourceId),
      };
      if (group.length > 1) {
        blockers.push(issue("canonical-collision-group", {...common, count: group.length}));
        if (!registry) {
          legacyConflictsToCreate += 1;
          diagnostics.push(issue("legacy-conflict-pending", {...common, count: group.length}));
        } else if (registry.valid && consistentConflict(registry, group)) {
          diagnostics.push(issue("legacy-conflict-consistent", {...common, count: group.length}));
        } else if (registry.valid) {
          blockers.push(issue("legacy-conflict-inconsistent", {...common, existingState: registry.data.state}));
        }
        continue;
      }

      const source = group[0];
      const unique = {
        uid, recordType, registryDocumentId,
        canonicalReferenceHash: source.canonicalReferenceHash,
        sourceId: source.sourceId,
      };
      if (!registry) {
        activeClaimsToCreate += 1;
        warnings.push(issue("unique-source-missing-claim", unique));
      } else if (!registry.valid) {
        // The malformed registry blocker already contains the safe diagnostics.
      } else if (registry.data.state === REGISTRY_STATES.ACTIVE && registry.data.sourceId === source.sourceId) {
        diagnostics.push(issue("unique-source-correct-active-claim", unique));
      } else if (registry.data.state === REGISTRY_STATES.ACTIVE) {
        blockers.push(issue("active-claim-wrong-source", {
          ...unique, existingSourceId: String(registry.data.sourceId),
        }));
      } else if (registry.data.state === REGISTRY_STATES.RETIRED) {
        blockers.push(issue("retired-key-used-by-live-source", unique));
      } else {
        blockers.push(issue("legacy-conflict-inconsistent", {...unique, existingState: registry.data.state}));
      }
    }
  }

  const allGroups = new Map([
    ...groupsByType.invoice,
    ...groupsByType.bill,
  ]);
  for (const registry of registryEntries.filter((entry) => entry.valid)) {
    if (allGroups.has(registry.documentId)) continue;
    if (registry.data.state === REGISTRY_STATES.ACTIVE) {
      blockers.push(issue("orphan-active-registry-key", {uid, recordType: registry.data.recordType, registryDocumentId: registry.documentId}));
    } else if (registry.data.state === REGISTRY_STATES.LEGACY_CONFLICT) {
      blockers.push(issue("orphan-legacy-conflict-registry-key", {uid, recordType: registry.data.recordType, registryDocumentId: registry.documentId}));
    }
  }

  blockers.push(...validateMetadata(collectionResults.referenceBackfillMigrations, uid));
  blockers.sort(diagnosticSort);
  warnings.sort(diagnosticSort);
  diagnostics.sort(diagnosticSort);

  const sourceStateHash = hashSourceEntries(allSources);
  const registryStateHash = hashRegistryEntries(registryEntries);
  const migrationMetadataHash = hashMetadataEntries(collectionResults.referenceBackfillMigrations);
  const invoices = sourceSummary(invoiceEntries, groupsByType.invoice);
  const bills = sourceSummary(billEntries, groupsByType.bill);
  const registry = {
    totalReferenceKeys: registryEntries.length,
    activeCount: registryEntries.filter((entry) => entry.valid && entry.data.state === REGISTRY_STATES.ACTIVE).length,
    retiredCount: registryEntries.filter((entry) => entry.valid && entry.data.state === REGISTRY_STATES.RETIRED).length,
    legacyConflictCount: registryEntries.filter((entry) => entry.valid && entry.data.state === REGISTRY_STATES.LEGACY_CONFLICT).length,
    malformedInvalidCount: registryEntries.filter((entry) => !entry.valid).length,
  };
  const migrationMetadata = metadataSummary(collectionResults.referenceBackfillMigrations);
  const combinedAuditHash = sha256({
    uid, sourceStateHash, registryStateHash, migrationMetadataHash,
    invoices, bills, registry, migrationMetadata,
    blockers, warnings,
    expectedBackfillWrites: {activeClaimsToCreate, legacyConflictsToCreate},
  });
  return {
    uid,
    readComplete: readFailures.length === 0,
    invoices,
    bills,
    registry,
    migrationMetadata,
    expectedBackfillWrites: {activeClaimsToCreate, legacyConflictsToCreate},
    blockers,
    warnings,
    diagnostics,
    hashes: {sourceStateHash, registryStateHash, migrationMetadataHash, combinedAuditHash},
    readyForApprovalScan: blockers.length === 0,
  };
}

function sum(results, select) {
  return results.reduce((total, result) => total + Number(select(result) || 0), 0);
}

function globalTotals(results) {
  return {
    invoices: {
      totalCount: sum(results, (result) => result.invoices.totalCount),
      blankReferenceCount: sum(results, (result) => result.invoices.blankReferenceCount),
      nonblankReferenceCount: sum(results, (result) => result.invoices.nonblankReferenceCount),
      canonicalGroupCount: sum(results, (result) => result.invoices.canonicalGroupCount),
      uniqueCanonicalGroups: sum(results, (result) => result.invoices.uniqueCanonicalGroups),
      collisionGroups: sum(results, (result) => result.invoices.collisionGroups),
      recordsInCollisions: sum(results, (result) => result.invoices.recordsInCollisions),
    },
    bills: {
      totalCount: sum(results, (result) => result.bills.totalCount),
      blankReferenceCount: sum(results, (result) => result.bills.blankReferenceCount),
      nonblankReferenceCount: sum(results, (result) => result.bills.nonblankReferenceCount),
      canonicalGroupCount: sum(results, (result) => result.bills.canonicalGroupCount),
      uniqueCanonicalGroups: sum(results, (result) => result.bills.uniqueCanonicalGroups),
      collisionGroups: sum(results, (result) => result.bills.collisionGroups),
      recordsInCollisions: sum(results, (result) => result.bills.recordsInCollisions),
    },
    registry: {
      totalReferenceKeys: sum(results, (result) => result.registry.totalReferenceKeys),
      activeCount: sum(results, (result) => result.registry.activeCount),
      retiredCount: sum(results, (result) => result.registry.retiredCount),
      legacyConflictCount: sum(results, (result) => result.registry.legacyConflictCount),
      malformedInvalidCount: sum(results, (result) => result.registry.malformedInvalidCount),
    },
  };
}

async function createProductionReferenceAudit(adapter, input = {}) {
  if (!adapter || Object.keys(adapter).sort().join(",") !== "readCollectionGroupPage,readUserCollectionPage" ||
    typeof adapter.readCollectionGroupPage !== "function" || typeof adapter.readUserCollectionPage !== "function") {
    throw new TypeError("An exact read-only Firestore adapter is required.");
  }
  const projectId = requiredIdentifier(input.projectId, "Project ID");
  const databaseId = String(input.databaseId || "(default)").trim();
  if (!databaseId || databaseId.includes("/")) throw new TypeError("Database ID is invalid.");
  const pageSize = validatePageSize(input.pageSize);
  const started = Date.now();
  const metrics = {documentsRead: 0, pagesFetched: 0, uidsScanned: 0, peakCanonicalGroupSize: 0};
  let census;
  if (input.uid) {
    census = {
      complete: true,
      orderedUids: [requiredIdentifier(input.uid, "UID")],
      sources: {explicitUid: {documentsRead: 0, uidsDiscovered: 1, complete: true}},
      failures: [], unexpectedPaths: [], mode: "explicit-uid",
    };
  } else {
    census = {...await discoverUidUniverse(adapter, pageSize, metrics), mode: "complete-census"};
  }

  const perUid = [];
  for (const uid of census.orderedUids) {
    perUid.push(await auditUid(adapter, uid, pageSize, metrics));
    metrics.uidsScanned += 1;
  }
  const blockers = [
    ...census.failures,
    ...(!census.complete ? [issue("incomplete-uid-census")] : []),
    ...(census.mode !== "complete-census" ? [issue("incomplete-uid-census", {reason: "explicit-uid-scope"})] : []),
    ...perUid.flatMap((result) => result.blockers),
  ].sort(diagnosticSort);
  const warnings = [
    ...census.unexpectedPaths.map((item) => issue("unexpected-census-document-path", item)),
    ...perUid.flatMap((result) => result.warnings),
  ].sort(diagnosticSort);
  const totals = globalTotals(perUid);
  const expectedBackfillWrites = {
    activeClaimsToCreate: sum(perUid, (result) => result.expectedBackfillWrites.activeClaimsToCreate),
    legacyConflictsToCreate: sum(perUid, (result) => result.expectedBackfillWrites.legacyConflictsToCreate),
  };
  const censusHash = sha256({
    projectId, databaseId, mode: census.mode, orderedUids: census.orderedUids, sources: census.sources,
    complete: census.complete, unexpectedPaths: census.unexpectedPaths,
  });
  const overallAuditHash = sha256({
    schemaVersion: AUDIT_SCHEMA_VERSION, auditVersion: AUDIT_VERSION,
    projectId, databaseId, censusHash,
    perUid: perUid.map((result) => ({uid: result.uid, combinedAuditHash: result.hashes.combinedAuditHash})),
    totals, expectedBackfillWrites, blockers, warnings,
  });
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    auditVersion: AUDIT_VERSION,
    projectId,
    databaseId,
    generatedAt: new Date().toISOString(),
    pageSize,
    census: {
      mode: census.mode,
      complete: census.complete,
      approvalScopeComplete: census.complete && census.mode === "complete-census",
      totalDiscoveredUids: census.orderedUids.length,
      discoverySources: census.sources,
      orderedUids: census.orderedUids,
      unexpectedPathCount: census.unexpectedPaths.length,
    },
    perUid,
    globalTotals: totals,
    expectedBackfillWrites,
    blockers,
    warnings,
    hashes: {censusHash, overallAuditHash},
    readiness: {readyForApprovalScan: census.complete && census.mode === "complete-census" && blockers.length === 0},
    metrics: {...metrics, elapsedMs: Date.now() - started},
  };
}

function uidMap(report) {
  return new Map((Array.isArray(report?.perUid) ? report.perUid : []).map((entry) => [String(entry.uid), entry]));
}

function sourceCounts(entry) {
  return {invoices: Number(entry?.invoices?.totalCount || 0), bills: Number(entry?.bills?.totalCount || 0)};
}

function compareAuditReports(previous, current) {
  if (!plainObject(previous) || !plainObject(current) || previous.schemaVersion !== AUDIT_SCHEMA_VERSION ||
    current.schemaVersion !== AUDIT_SCHEMA_VERSION || previous.auditVersion !== AUDIT_VERSION || current.auditVersion !== AUDIT_VERSION) {
    throw new TypeError("Both reports must be compatible production reference audit artifacts.");
  }
  const before = uidMap(previous);
  const after = uidMap(current);
  const addedUids = [...after.keys()].filter((uid) => !before.has(uid)).sort();
  const removedUids = [...before.keys()].filter((uid) => !after.has(uid)).sort();
  const sourceCountDrift = [];
  const sourceHashDrift = [];
  const registryHashDrift = [];
  const metadataHashDrift = [];
  for (const uid of [...after.keys()].filter((item) => before.has(item)).sort()) {
    const oldEntry = before.get(uid);
    const newEntry = after.get(uid);
    if (canonicalSerialize(sourceCounts(oldEntry)) !== canonicalSerialize(sourceCounts(newEntry))) {
      sourceCountDrift.push({uid, before: sourceCounts(oldEntry), after: sourceCounts(newEntry)});
    }
    if (oldEntry?.hashes?.sourceStateHash !== newEntry?.hashes?.sourceStateHash) sourceHashDrift.push(uid);
    if (oldEntry?.hashes?.registryStateHash !== newEntry?.hashes?.registryStateHash) registryHashDrift.push(uid);
    if (oldEntry?.hashes?.migrationMetadataHash !== newEntry?.hashes?.migrationMetadataHash) metadataHashDrift.push(uid);
  }
  const overallDrift = previous?.hashes?.overallAuditHash !== current?.hashes?.overallAuditHash;
  return {
    addedUids, removedUids, sourceCountDrift,
    sourceHashDrift, registryHashDrift, metadataHashDrift, overallDrift,
    hasDrift: overallDrift || addedUids.length > 0 || removedUids.length > 0 ||
      sourceCountDrift.length > 0 || sourceHashDrift.length > 0 ||
      registryHashDrift.length > 0 || metadataHashDrift.length > 0,
  };
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  AUDIT_VERSION,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  canonicalSerialize,
  compareAuditReports,
  createProductionReferenceAudit,
  sha256,
  validatePageSize,
};
