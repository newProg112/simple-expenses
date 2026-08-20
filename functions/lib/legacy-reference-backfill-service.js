/* eslint-disable max-len, require-jsdoc */

"use strict";

const {referenceRegistryKey, sourceReference} = require("./reference-registry-key");
const {
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_STATES,
} = require("./reference-registry-service");
const {
  BACKFILL_REQUEST_ID,
  BACKFILL_SCHEMA_VERSION,
  BACKFILL_VERSION,
  CONFLICT_SOURCE_ID,
  MIGRATION_COLLECTION,
} = require("./legacy-reference-backfill-constants");
const RECORD_TYPES = Object.freeze([
  Object.freeze({recordType: "invoice", collectionName: "invoices"}),
  Object.freeze({recordType: "bill", collectionName: "bills"}),
]);

class LegacyReferenceBackfillError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LegacyReferenceBackfillError";
    this.code = code;
    this.details = details;
  }
}

function identifier(value, label) {
  const result = String(value || "").trim();
  if (!result || result.includes("/") || /\s/.test(result)) {
    throw new LegacyReferenceBackfillError("invalid-argument", `${label} is invalid.`);
  }
  return result;
}

function exists(snapshot) {
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function data(snapshot) {
  return snapshot && typeof snapshot.data === "function" ? snapshot.data() : undefined;
}

function sameStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

function sourceDescriptor(configuration, snapshot, key) {
  return Object.freeze({
    recordType: configuration.recordType,
    collectionName: configuration.collectionName,
    sourceId: String(snapshot.id),
    reference: sourceReference(configuration.recordType, data(snapshot)),
    canonicalReference: key.canonicalReference,
    registryDocumentId: key.registryDocumentId,
    referenceField: configuration.recordType === "invoice" ? "invoiceNo" : "billNumber",
  });
}

function outcome(kind, group, details = {}) {
  return Object.freeze({
    kind,
    recordType: group.recordType,
    canonicalReference: group.canonicalReference,
    registryDocumentId: group.registryDocumentId,
    sourceIds: group.sources.map((source) => source.sourceId),
    ...details,
  });
}

function registryIdentityError(stored, group) {
  if (!stored || stored.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    stored.recordType !== group.recordType ||
    stored.canonicalReference !== group.canonicalReference ||
    !Object.values(REGISTRY_STATES).includes(stored.state)) {
    return "The existing registry document has invalid or mismatched identity fields.";
  }
  return "";
}

function compatibleExistingOutcome(stored, group) {
  const identityError = registryIdentityError(stored, group);
  if (identityError) return outcome("incompatible-existing-registry", group, {reason: identityError});

  if (group.sources.length === 1) {
    if (stored.state === REGISTRY_STATES.ACTIVE && stored.sourceId === group.sources[0].sourceId) {
      return outcome("active-claim-already-valid", group);
    }
    return outcome("incompatible-existing-registry", group, {
      reason: `A live unique source is incompatible with the existing ${stored.state} registry state.`,
      existingState: stored.state,
      existingSourceId: String(stored.sourceId || ""),
    });
  }

  if (stored.state === REGISTRY_STATES.LEGACY_CONFLICT &&
    stored.sourceId === CONFLICT_SOURCE_ID &&
    sameStrings(stored.conflictingSourceIds, group.sources.map((source) => source.sourceId))) {
    return outcome("legacy-conflict-already-valid", group);
  }
  return outcome("incompatible-existing-registry", group, {
    reason: "A canonical legacy collision is incompatible with the existing registry history.",
    existingState: String(stored.state || ""),
    existingSourceId: String(stored.sourceId || ""),
  });
}

function activeClaim(group, timestamp) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    recordType: group.recordType,
    canonicalReference: group.canonicalReference,
    sourceId: group.sources[0].sourceId,
    state: REGISTRY_STATES.ACTIVE,
    claimedAt: timestamp,
    retiredAt: null,
    claimRequestId: BACKFILL_REQUEST_ID,
    backfillVersion: BACKFILL_VERSION,
  };
}

function conflictClaim(group, timestamp) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    recordType: group.recordType,
    canonicalReference: group.canonicalReference,
    sourceId: CONFLICT_SOURCE_ID,
    state: REGISTRY_STATES.LEGACY_CONFLICT,
    conflictingSourceIds: group.sources.map((source) => source.sourceId),
    conflictCount: group.sources.length,
    claimedAt: null,
    retiredAt: null,
    conflictDetectedAt: timestamp,
    backfillVersion: BACKFILL_VERSION,
  };
}

function summarize(mode, scanned, blanks, outcomes) {
  const count = (kind) => outcomes.filter((item) => item.kind === kind).length;
  const collisionGroups = outcomes.filter((item) =>
    ["would-create-legacy-conflict", "legacy-conflict-created", "legacy-conflict-already-valid"].includes(item.kind),
  ).length;
  const incompatible = count("incompatible-existing-registry") + count("source-changed-during-apply") + count("migration-error");
  const summary = {
    scanned,
    blankSkipped: blanks.length,
    activeClaimWouldCreate: count("would-create-active-claim"),
    activeClaimCreated: count("active-claim-created"),
    activeClaimAlreadyValid: count("active-claim-already-valid"),
    legacyConflictWouldCreate: count("would-create-legacy-conflict"),
    legacyConflictCreated: count("legacy-conflict-created"),
    legacyConflictAlreadyValid: count("legacy-conflict-already-valid"),
    incompatibleExistingRegistry: count("incompatible-existing-registry"),
    sourceChangedDuringApply: count("source-changed-during-apply"),
    migrationErrors: count("migration-error"),
    collisionGroups,
    cutoverReady: collisionGroups === 0 && incompatible === 0,
  };
  return Object.freeze({...summary, status: summary.cutoverReady ? "complete" : "incomplete", mode});
}

async function buildPlan(userReference) {
  const [invoiceSnapshot, billSnapshot, registrySnapshot] = await Promise.all([
    userReference.collection("invoices").get(),
    userReference.collection("bills").get(),
    userReference.collection("referenceKeys").get(),
  ]);
  const groups = new Map();
  const blanks = [];
  let scanned = 0;

  for (const [configuration, snapshot] of [[RECORD_TYPES[0], invoiceSnapshot], [RECORD_TYPES[1], billSnapshot]]) {
    for (const sourceSnapshot of snapshot.docs) {
      scanned += 1;
      const key = await referenceRegistryKey(configuration.recordType, sourceReference(configuration.recordType, data(sourceSnapshot)));
      const source = sourceDescriptor(configuration, sourceSnapshot, key);
      if (!key.registryDocumentId) {
        blanks.push(Object.freeze({recordType: configuration.recordType, sourceId: source.sourceId}));
        continue;
      }
      const current = groups.get(key.registryDocumentId) || {
        recordType: configuration.recordType,
        canonicalReference: key.canonicalReference,
        registryDocumentId: key.registryDocumentId,
        sources: [],
      };
      current.sources.push(source);
      groups.set(key.registryDocumentId, current);
    }
  }

  for (const group of groups.values()) group.sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const registry = new Map(registrySnapshot.docs.map((snapshot) => [String(snapshot.id), data(snapshot)]));
  return {scanned, blanks: blanks.sort((left, right) => `${left.recordType}:${left.sourceId}`.localeCompare(`${right.recordType}:${right.sourceId}`)), groups, registry};
}

async function validateOrphanRegistry(registryDocumentId, stored, groups) {
  if (groups.has(registryDocumentId)) return null;
  let key;
  try {
    key = await referenceRegistryKey(stored?.recordType, stored?.canonicalReference);
  } catch (_error) {
    return {
      kind: "incompatible-existing-registry", recordType: String(stored?.recordType || ""),
      canonicalReference: String(stored?.canonicalReference || ""), registryDocumentId,
      sourceIds: [], reason: "An unrecognised registry document has invalid identity fields.",
    };
  }
  if (stored?.schemaVersion !== REGISTRY_SCHEMA_VERSION || key.registryDocumentId !== registryDocumentId) {
    return {
      kind: "incompatible-existing-registry", recordType: String(stored?.recordType || ""),
      canonicalReference: String(stored?.canonicalReference || ""), registryDocumentId,
      sourceIds: [], reason: "An unrecognised registry document does not match its canonical key.",
    };
  }
  if (stored.state === REGISTRY_STATES.RETIRED) return null;
  return {
    kind: "incompatible-existing-registry", recordType: stored.recordType,
    canonicalReference: stored.canonicalReference, registryDocumentId,
    sourceIds: [], reason: `The ${stored.state || "invalid"} registry entry has no matching live source group.`,
  };
}

function createLegacyReferenceBackfillService(options = {}) {
  const firestore = options.firestore;
  const serverTimestamp = options.serverTimestamp;
  if (!firestore || typeof firestore.collection !== "function" || typeof firestore.runTransaction !== "function") {
    throw new TypeError("A Firestore transaction service is required.");
  }
  if (typeof serverTimestamp !== "function") throw new TypeError("A server timestamp provider is required.");

  async function applyGroup(userReference, group) {
    const registryReference = userReference.collection("referenceKeys").doc(group.registryDocumentId);
    return firestore.runTransaction(async (transaction) => {
      const sourceSnapshots = [];
      for (const source of group.sources) {
        sourceSnapshots.push(await transaction.get(userReference.collection(source.collectionName).doc(source.sourceId)));
      }
      for (let index = 0; index < sourceSnapshots.length; index += 1) {
        const snapshot = sourceSnapshots[index];
        const expected = group.sources[index];
        if (!exists(snapshot)) return outcome("source-changed-during-apply", group, {reason: `Source ${expected.sourceId} no longer exists.`});
        const key = await referenceRegistryKey(expected.recordType, sourceReference(expected.recordType, data(snapshot)));
        if (key.registryDocumentId !== group.registryDocumentId) {
          return outcome("source-changed-during-apply", group, {reason: `Source ${expected.sourceId} changed reference after the scan.`});
        }
      }
      const registrySnapshot = await transaction.get(registryReference);
      if (exists(registrySnapshot)) return compatibleExistingOutcome(data(registrySnapshot), group);
      const timestamp = serverTimestamp();
      if (group.sources.length === 1) {
        transaction.create(registryReference, activeClaim(group, timestamp));
        return outcome("active-claim-created", group);
      }
      transaction.create(registryReference, conflictClaim(group, timestamp));
      return outcome("legacy-conflict-created", group);
    });
  }

  return async function backfillLegacyReferences(input = {}) {
    const uid = identifier(input.uid, "UID");
    const dryRun = input.dryRun !== false;
    const userReference = firestore.collection("users").doc(uid);
    const plan = await buildPlan(userReference);
    const outcomes = [];
    const groups = [...plan.groups.values()].sort((left, right) =>
      `${left.recordType}:${left.canonicalReference}:${left.registryDocumentId}`.localeCompare(`${right.recordType}:${right.canonicalReference}:${right.registryDocumentId}`),
    );

    for (const group of groups) {
      const stored = plan.registry.get(group.registryDocumentId);
      if (dryRun) {
        outcomes.push(stored ? compatibleExistingOutcome(stored, group) :
          outcome(group.sources.length === 1 ? "would-create-active-claim" : "would-create-legacy-conflict", group));
      } else {
        try {
          outcomes.push(await applyGroup(userReference, group));
        } catch (error) {
          outcomes.push(outcome("migration-error", group, {reason: String(error?.message || error)}));
        }
      }
    }

    for (const [registryDocumentId, stored] of [...plan.registry].sort(([left], [right]) => left.localeCompare(right))) {
      const orphan = await validateOrphanRegistry(registryDocumentId, stored, plan.groups);
      if (orphan) outcomes.push(Object.freeze(orphan));
    }

    outcomes.sort((left, right) => `${left.recordType}:${left.canonicalReference}:${left.registryDocumentId}:${left.kind}`.localeCompare(`${right.recordType}:${right.canonicalReference}:${right.registryDocumentId}:${right.kind}`));
    const summary = summarize(dryRun ? "dry-run" : "apply", plan.scanned, plan.blanks, outcomes);

    if (!dryRun) {
      const metadataReference = userReference.collection(MIGRATION_COLLECTION).doc(BACKFILL_VERSION);
      await firestore.runTransaction(async (transaction) => {
        const existingMetadata = await transaction.get(metadataReference);
        const previous = exists(existingMetadata) ? data(existingMetadata) : {};
        const timestamp = serverTimestamp();
        transaction.set(metadataReference, {
          schemaVersion: BACKFILL_SCHEMA_VERSION,
          migrationVersion: BACKFILL_VERSION,
          status: summary.status,
          cutoverReady: summary.cutoverReady,
          scanned: summary.scanned,
          blankSkipped: summary.blankSkipped,
          activeClaimCreated: summary.activeClaimCreated,
          activeClaimAlreadyValid: summary.activeClaimAlreadyValid,
          legacyConflictCreated: summary.legacyConflictCreated,
          legacyConflictAlreadyValid: summary.legacyConflictAlreadyValid,
          incompatibleExistingRegistry: summary.incompatibleExistingRegistry,
          sourceChangedDuringApply: summary.sourceChangedDuringApply,
          migrationErrors: summary.migrationErrors,
          collisionGroups: summary.collisionGroups,
          lastRunAt: timestamp,
          ...(summary.cutoverReady ? {completedAt: previous.completedAt || timestamp} : {}),
        });
      });
    }

    return Object.freeze({
      schemaVersion: BACKFILL_SCHEMA_VERSION,
      migrationVersion: BACKFILL_VERSION,
      uid,
      mode: summary.mode,
      summary,
      blanks: Object.freeze(plan.blanks),
      outcomes: Object.freeze(outcomes),
    });
  };
}

module.exports = {
  BACKFILL_REQUEST_ID,
  BACKFILL_SCHEMA_VERSION,
  BACKFILL_VERSION,
  CONFLICT_SOURCE_ID,
  MIGRATION_COLLECTION,
  LegacyReferenceBackfillError,
  createLegacyReferenceBackfillService,
};
