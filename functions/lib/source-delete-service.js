/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("crypto");
const {journalId: sourceJournalId} = require("./source-create-accounting");
const {referenceRegistryKey, sourceReference} = require("./reference-registry-key");
const {
  REGISTRY_SCHEMA_VERSION, REGISTRY_STATES, REQUEST_ID_PATTERN, ReferenceRegistryError,
} = require("./reference-registry-service");
const {editStateProjection} = require("./source-edit-state");

function exists(snapshot) {
  return Boolean(snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists));
}

function identifier(value, label) {
  const result = String(value || "").trim();
  if (!result || result.includes("/") || result.length > 512) throw new ReferenceRegistryError("invalid-argument", `${label} is invalid.`);
  return result;
}

function requestId(value) {
  const result = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(result)) throw new ReferenceRegistryError("invalid-argument", "A valid request UUID is required.");
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function configuration(recordType) {
  if (recordType === "invoice") return {collection: "invoices", journalPrefix: "invoice"};
  if (recordType === "bill") return {collection: "bills", journalPrefix: "bill"};
  throw new ReferenceRegistryError("invalid-argument", "Record type is invalid.");
}

function validateExpectedState(recordType, value) {
  const projected = editStateProjection(recordType, value);
  if (!projected || !same(projected, value) || JSON.stringify(value).length > 100000) {
    throw new ReferenceRegistryError("invalid-argument", "Expected source state is invalid.");
  }
  return projected;
}

function assertRegistry(data, key) {
  if (!data || data.schemaVersion !== REGISTRY_SCHEMA_VERSION || data.recordType !== key.recordType ||
    data.canonicalReference !== key.canonicalReference || !Object.values(REGISTRY_STATES).includes(data.state) || !String(data.sourceId || "")) {
    throw new ReferenceRegistryError("registry-integrity-error", "The stored reference claim is inconsistent and the source was not deleted.");
  }
  return data;
}

function assertRequest(data, expected) {
  if (!data || data.schemaVersion !== 1 || data.operation !== "delete" ||
    data.recordType !== expected.recordType || data.sourceId !== expected.sourceId ||
    data.requestHash !== expected.requestHash || data.journalId !== expected.journalId) {
    throw new ReferenceRegistryError("idempotency-conflict", "This request ID was already used for a different delete operation.");
  }
}

function createSourceDeleteService(options = {}) {
  const firestore = options.firestore;
  const serverTimestamp = options.serverTimestamp;
  const now = options.now || (() => new Date().toISOString());
  const keyForReference = options.keyForReference || referenceRegistryKey;
  if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") throw new TypeError("A Firestore transaction service is required.");
  if (typeof serverTimestamp !== "function" || typeof now !== "function") throw new TypeError("Timestamp providers are required.");

  return async function deleteSourceWithReference(input = {}) {
    const uid = identifier(input.uid, "Authenticated user ID");
    const recordType = input.recordType;
    const adapter = configuration(recordType);
    const sourceId = identifier(input.sourceId, "Source ID");
    const operationId = requestId(input.requestId);
    const expectedState = validateExpectedState(recordType, input.expectedState);
    const deletedAt = now();
    if (typeof deletedAt !== "string" || !deletedAt) throw new TypeError("The delete timestamp is invalid.");
    const user = firestore.collection("users").doc(uid);
    const sourceRef = user.collection(adapter.collection).doc(sourceId);
    const requestRef = user.collection("referenceDeleteRequests").doc(operationId);
    const journalId = sourceJournalId(uid, adapter.journalPrefix, sourceId);
    const requestHash = hash({recordType, sourceId, expectedState});
    const expectedRequest = {recordType, sourceId, requestHash, journalId};

    return firestore.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      const sourceSnapshot = await transaction.get(sourceRef);

      if (exists(requestSnapshot)) {
        const marker = requestSnapshot.data();
        assertRequest(marker, expectedRequest);
        if (exists(sourceSnapshot)) throw new ReferenceRegistryError("delete-integrity-error", "The successful delete is incomplete.");
        if (marker.registryDocumentId) {
          const registrySnapshot = await transaction.get(user.collection("referenceKeys").doc(marker.registryDocumentId));
          if (!exists(registrySnapshot)) throw new ReferenceRegistryError("delete-integrity-error", "The retired reference tombstone is missing.");
          const claim = registrySnapshot.data();
          if (claim.schemaVersion !== REGISTRY_SCHEMA_VERSION || claim.recordType !== recordType ||
            claim.canonicalReference !== marker.canonicalReference || claim.state !== REGISTRY_STATES.RETIRED ||
            claim.sourceId !== sourceId || claim.retireRequestId !== operationId) {
            throw new ReferenceRegistryError("delete-integrity-error", "The retired reference tombstone is inconsistent.");
          }
        }
        return Object.freeze({status: "already-deleted", recordType, sourceId, canonicalReference: marker.canonicalReference, registryDocumentId: marker.registryDocumentId, journalId, deletedAt: marker.deletedAt});
      }

      if (!exists(sourceSnapshot)) throw new ReferenceRegistryError("source-not-found", "The source record no longer exists.");
      const source = sourceSnapshot.data();
      if (source.bankSettlement || source.matched === true) throw new ReferenceRegistryError("bank-settled-source", "This record is matched to a bank transaction and cannot be deleted.");
      if (!same(editStateProjection(recordType, source), expectedState)) throw new ReferenceRegistryError("stale-source", "This record changed after it was loaded. Refresh and review it before deleting.");

      const key = await keyForReference(recordType, sourceReference(recordType, source));
      const registryRef = key.registryDocumentId ? user.collection("referenceKeys").doc(key.registryDocumentId) : null;
      const registrySnapshot = registryRef ? await transaction.get(registryRef) : null;
      if (registryRef) {
        if (!exists(registrySnapshot)) throw new ReferenceRegistryError("source-reference-unclaimed", "The source reference has no active registry claim.");
        const claim = assertRegistry(registrySnapshot.data(), key);
        if (claim.state !== REGISTRY_STATES.ACTIVE || claim.sourceId !== sourceId) {
          throw new ReferenceRegistryError("reference-conflict", "The source reference claim is not active for this record.");
        }
      }

      const timestamp = serverTimestamp();
      if (registryRef) transaction.update(registryRef, {state: REGISTRY_STATES.RETIRED, retiredAt: timestamp, retireRequestId: operationId});
      transaction.delete(sourceRef);
      transaction.create(requestRef, {
        schemaVersion: 1, operation: "delete", recordType, sourceId, requestHash,
        registryDocumentId: key.registryDocumentId, canonicalReference: key.canonicalReference,
        journalId, deletedAt, createdAt: timestamp,
      });
      return Object.freeze({status: "deleted", recordType, sourceId, canonicalReference: key.canonicalReference, registryDocumentId: key.registryDocumentId, journalId, deletedAt});
    });
  };
}

module.exports = {createSourceDeleteService};
