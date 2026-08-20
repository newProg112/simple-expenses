/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  recordTypeConfiguration,
  referenceRegistryKey,
  sourceReference,
} = require("./reference-registry-key");

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_STATES = Object.freeze({
  ACTIVE: "active",
  RETIRED: "retired",
  LEGACY_CONFLICT: "legacy-conflict",
});
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ReferenceRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReferenceRegistryError";
    this.code = code;
  }
}

function snapshotExists(snapshot) {
  return Boolean(snapshot && (typeof snapshot.exists === "function" ?
    snapshot.exists() : snapshot.exists));
}

function requiredIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!identifier || identifier.includes("/") || identifier.length > 512) {
    throw new ReferenceRegistryError("invalid-argument", `${label} is invalid.`);
  }
  return identifier;
}

function requiredRequestId(value) {
  const requestId = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new ReferenceRegistryError("invalid-argument", "A valid request UUID is required.");
  }
  return requestId;
}

function requiredRawReference(value) {
  if (typeof value !== "string") {
    throw new ReferenceRegistryError("invalid-argument", "Reference must be a string.");
  }
  return value;
}

function registryDocumentData(key, sourceId, state, timestamps, requestIds = {}) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    recordType: key.recordType,
    canonicalReference: key.canonicalReference,
    sourceId,
    state,
    claimedAt: timestamps.claimedAt,
    retiredAt: timestamps.retiredAt,
    ...(requestIds.claimRequestId ? {claimRequestId: requestIds.claimRequestId} : {}),
    ...(requestIds.retireRequestId ? {retireRequestId: requestIds.retireRequestId} : {}),
  };
}

function assertRegistryDocument(data, key) {
  const validState = Object.values(REGISTRY_STATES).includes(data && data.state);
  if (!data || data.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    data.recordType !== key.recordType ||
    data.canonicalReference !== key.canonicalReference || !validState ||
    !String(data.sourceId || "")) {
    throw new ReferenceRegistryError(
        "registry-integrity-error",
        "The stored reference claim is inconsistent and was not changed.",
    );
  }
  return data;
}

function referenceConflict(message = "This reference is already reserved and cannot be used.") {
  return new ReferenceRegistryError("reference-conflict", message);
}

function assertSourceMutable(source) {
  if (source && source.bankSettlement) {
    throw new ReferenceRegistryError(
        "bank-settled-source",
        "This record is matched to a bank transaction and its reference cannot be changed.",
    );
  }
}

function sourceReferenceUpdate(configuration, source, rawReference) {
  const update = {[configuration.primaryField]: rawReference};
  if (Object.prototype.hasOwnProperty.call(source, configuration.legacyField)) {
    update[configuration.legacyField] = rawReference;
  }
  return update;
}

function createReferenceRegistryService(options = {}) {
  const firestore = options.firestore;
  const serverTimestamp = options.serverTimestamp;
  const keyForReference = options.keyForReference || referenceRegistryKey;
  if (!firestore || typeof firestore.runTransaction !== "function" ||
    typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore transaction service is required.");
  }
  if (typeof serverTimestamp !== "function") {
    throw new TypeError("A server timestamp provider is required.");
  }

  function references(uid, recordType, sourceId, registryDocumentId) {
    const configuration = recordTypeConfiguration(recordType);
    const user = firestore.collection("users").doc(uid);
    return {
      configuration,
      source: user.collection(configuration.collectionName).doc(sourceId),
      registry: registryDocumentId ? user.collection("referenceKeys").doc(registryDocumentId) : null,
    };
  }

  async function claimReference(input = {}) {
    const uid = requiredIdentifier(input.uid, "Authenticated user ID");
    const sourceId = requiredIdentifier(input.sourceId, "Source ID");
    const requestId = requiredRequestId(input.requestId);
    const rawReference = requiredRawReference(input.reference);
    const key = await keyForReference(input.recordType, rawReference);
    if (!key.registryDocumentId) {
      return Object.freeze({
        status: "unregistered-blank", recordType: key.recordType, sourceId,
        canonicalReference: "", registryDocumentId: null,
      });
    }
    const refs = references(uid, key.recordType, sourceId, key.registryDocumentId);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(refs.registry);
      if (snapshotExists(snapshot)) {
        const stored = assertRegistryDocument(snapshot.data(), key);
        if (stored.state === REGISTRY_STATES.ACTIVE && stored.sourceId === sourceId &&
          stored.claimRequestId === requestId) {
          return Object.freeze({
            status: "already-claimed", recordType: key.recordType, sourceId,
            canonicalReference: key.canonicalReference,
            registryDocumentId: key.registryDocumentId,
          });
        }
        throw referenceConflict();
      }
      const timestamp = serverTimestamp();
      transaction.create(refs.registry, registryDocumentData(
          key, sourceId, REGISTRY_STATES.ACTIVE,
          {claimedAt: timestamp, retiredAt: null}, {claimRequestId: requestId},
      ));
      return Object.freeze({
        status: "claimed", recordType: key.recordType, sourceId,
        canonicalReference: key.canonicalReference,
        registryDocumentId: key.registryDocumentId,
      });
    });
  }

  async function changeReference(input = {}) {
    const uid = requiredIdentifier(input.uid, "Authenticated user ID");
    const sourceId = requiredIdentifier(input.sourceId, "Source ID");
    const requestId = requiredRequestId(input.requestId);
    const newReference = requiredRawReference(input.newReference);
    const configuration = recordTypeConfiguration(input.recordType);
    const newKey = await keyForReference(input.recordType, newReference);
    const baseRefs = references(uid, input.recordType, sourceId, null);

    return firestore.runTransaction(async (transaction) => {
      const sourceSnapshot = await transaction.get(baseRefs.source);
      if (!snapshotExists(sourceSnapshot)) {
        throw new ReferenceRegistryError("source-not-found", "The source record no longer exists.");
      }
      const source = sourceSnapshot.data();
      assertSourceMutable(source);
      const oldKey = await keyForReference(input.recordType, sourceReference(input.recordType, source));
      const oldRef = oldKey.registryDocumentId ?
        references(uid, input.recordType, sourceId, oldKey.registryDocumentId).registry : null;
      const newRef = newKey.registryDocumentId ?
        references(uid, input.recordType, sourceId, newKey.registryDocumentId).registry : null;
      const sameKey = Boolean(oldRef && newRef && oldKey.registryDocumentId === newKey.registryDocumentId);
      const oldSnapshot = oldRef ? await transaction.get(oldRef) : null;
      const newSnapshot = newRef && !sameKey ? await transaction.get(newRef) : oldSnapshot;

      if (sameKey && snapshotExists(oldSnapshot)) {
        const stored = assertRegistryDocument(oldSnapshot.data(), oldKey);
        if (stored.state === REGISTRY_STATES.ACTIVE && stored.sourceId === sourceId &&
          stored.claimRequestId === requestId) {
          return Object.freeze({
            status: "already-changed", recordType: input.recordType, sourceId,
            canonicalReference: newKey.canonicalReference,
            registryDocumentId: newKey.registryDocumentId,
          });
        }
      }

      if (oldRef) {
        if (!snapshotExists(oldSnapshot)) {
          throw new ReferenceRegistryError(
              "source-reference-unclaimed",
              "The source reference has no active registry claim.",
          );
        }
        const storedOld = assertRegistryDocument(oldSnapshot.data(), oldKey);
        if (storedOld.state !== REGISTRY_STATES.ACTIVE || storedOld.sourceId !== sourceId) {
          throw referenceConflict("The source reference claim is not active for this record.");
        }
      }

      if (!sameKey && newRef && snapshotExists(newSnapshot)) {
        assertRegistryDocument(newSnapshot.data(), newKey);
        throw referenceConflict();
      }

      const timestamp = serverTimestamp();
      if (oldRef && !sameKey) {
        transaction.update(oldRef, {
          state: REGISTRY_STATES.RETIRED,
          retiredAt: timestamp,
          retireRequestId: requestId,
        });
      }
      if (newRef) {
        const existingClaimedAt = sameKey && snapshotExists(oldSnapshot) ?
          oldSnapshot.data().claimedAt : timestamp;
        transaction.set(newRef, registryDocumentData(
            newKey, sourceId, REGISTRY_STATES.ACTIVE,
            {claimedAt: existingClaimedAt, retiredAt: null},
            {claimRequestId: requestId},
        ));
      }
      transaction.update(
          baseRefs.source,
          sourceReferenceUpdate(configuration, source, newReference),
      );
      return Object.freeze({
        status: "changed", recordType: input.recordType, sourceId,
        canonicalReference: newKey.canonicalReference,
        registryDocumentId: newKey.registryDocumentId,
        retiredRegistryDocumentId: oldRef && !sameKey ? oldKey.registryDocumentId : null,
      });
    });
  }

  async function retireReferenceForDelete(input = {}) {
    const uid = requiredIdentifier(input.uid, "Authenticated user ID");
    const sourceId = requiredIdentifier(input.sourceId, "Source ID");
    const requestId = requiredRequestId(input.requestId);
    recordTypeConfiguration(input.recordType);
    const baseRefs = references(uid, input.recordType, sourceId, null);

    return firestore.runTransaction(async (transaction) => {
      const sourceSnapshot = await transaction.get(baseRefs.source);
      if (!snapshotExists(sourceSnapshot)) {
        throw new ReferenceRegistryError("source-not-found", "The source record no longer exists.");
      }
      const source = sourceSnapshot.data();
      assertSourceMutable(source);
      const key = await keyForReference(input.recordType, sourceReference(input.recordType, source));
      if (!key.registryDocumentId) {
        return Object.freeze({
          status: "unregistered-blank", recordType: input.recordType, sourceId,
          canonicalReference: "", registryDocumentId: null, sourceDeleted: false,
        });
      }
      const registryRef = references(
          uid, input.recordType, sourceId, key.registryDocumentId,
      ).registry;
      const registrySnapshot = await transaction.get(registryRef);
      if (!snapshotExists(registrySnapshot)) {
        throw new ReferenceRegistryError(
            "source-reference-unclaimed",
            "The source reference has no registry claim.",
        );
      }
      const stored = assertRegistryDocument(registrySnapshot.data(), key);
      if (stored.state === REGISTRY_STATES.RETIRED && stored.sourceId === sourceId &&
        stored.retireRequestId === requestId) {
        return Object.freeze({
          status: "already-retired", recordType: input.recordType, sourceId,
          canonicalReference: key.canonicalReference,
          registryDocumentId: key.registryDocumentId, sourceDeleted: false,
        });
      }
      if (stored.state !== REGISTRY_STATES.ACTIVE || stored.sourceId !== sourceId) {
        throw referenceConflict("The source reference claim cannot be retired by this record.");
      }
      transaction.update(registryRef, {
        state: REGISTRY_STATES.RETIRED,
        retiredAt: serverTimestamp(),
        retireRequestId: requestId,
      });
      return Object.freeze({
        status: "retired", recordType: input.recordType, sourceId,
        canonicalReference: key.canonicalReference,
        registryDocumentId: key.registryDocumentId, sourceDeleted: false,
      });
    });
  }

  return Object.freeze({claimReference, changeReference, retireReferenceForDelete});
}

module.exports = {
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_STATES,
  REQUEST_ID_PATTERN,
  ReferenceRegistryError,
  createReferenceRegistryService,
};
