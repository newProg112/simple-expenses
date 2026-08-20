/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("crypto");
const {billJournal, invoiceJournal} = require("./source-create-accounting");
const {referenceRegistryKey, sourceReference} = require("./reference-registry-key");
const {
  REGISTRY_SCHEMA_VERSION, REGISTRY_STATES, REQUEST_ID_PATTERN, ReferenceRegistryError,
} = require("./reference-registry-service");
const {validateEditPayload} = require("./source-create-schema");
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
  if (recordType === "invoice") return {collection: "invoices", reference: "invoiceNo", legacy: "invoiceNumber", journal: invoiceJournal};
  if (recordType === "bill") return {collection: "bills", reference: "billNumber", legacy: "invoiceNumber", journal: billJournal};
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
    throw new ReferenceRegistryError("registry-integrity-error", "The stored reference claim is inconsistent and was not changed.");
  }
  return data;
}

function registryData(key, sourceId, timestamp, operationId) {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION, recordType: key.recordType,
    canonicalReference: key.canonicalReference, sourceId, state: REGISTRY_STATES.ACTIVE,
    claimedAt: timestamp, retiredAt: null, claimRequestId: operationId,
  };
}

function assertRequest(data, expected) {
  if (!data || data.schemaVersion !== 1 || data.operation !== "edit" ||
    data.recordType !== expected.recordType || data.sourceId !== expected.sourceId ||
    data.requestHash !== expected.requestHash || data.journalId !== expected.journalId) {
    throw new ReferenceRegistryError("idempotency-conflict", "This request ID was already used for a different edit operation.");
  }
}

function assertRetrySource(source, payload, marker, adapter) {
  for (const [field, value] of Object.entries(payload)) {
    if (!same(source[field], value)) throw new ReferenceRegistryError("edit-integrity-error", "The edited source no longer matches this request.");
  }
  if (source.updatedAt !== marker.editedAt || (marker.legacyFieldUpdated && source[adapter.legacy] !== payload[adapter.reference])) {
    throw new ReferenceRegistryError("edit-integrity-error", "The edited source no longer matches this request.");
  }
}

function assertRetryRegistry(snapshot, documentId, state, sourceId, requestField, operationId) {
  if (!documentId) return;
  if (!exists(snapshot)) throw new ReferenceRegistryError("edit-integrity-error", "The edit reference lifecycle is incomplete.");
  const data = snapshot.data();
  if (data.state !== state || data.sourceId !== sourceId || (requestField && data[requestField] !== operationId)) {
    throw new ReferenceRegistryError("edit-integrity-error", "The edit reference lifecycle is inconsistent.");
  }
}

function createSourceEditService(options = {}) {
  const firestore = options.firestore;
  const serverTimestamp = options.serverTimestamp;
  const now = options.now || (() => new Date().toISOString());
  const keyForReference = options.keyForReference || referenceRegistryKey;
  if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") throw new TypeError("A Firestore transaction service is required.");
  if (typeof serverTimestamp !== "function" || typeof now !== "function") throw new TypeError("Timestamp providers are required.");

  return async function updateSourceWithReference(input = {}) {
    const uid = identifier(input.uid, "Authenticated user ID");
    const recordType = input.recordType;
    const adapter = configuration(recordType);
    const sourceId = identifier(input.sourceId, "Source ID");
    const operationId = requestId(input.requestId);
    const payload = validateEditPayload(recordType, input.payload);
    const expectedState = validateExpectedState(recordType, input.expectedState);
    if (recordType === "bill" && payload.attachmentPath && !payload.attachmentPath.startsWith(`users/${uid}/attachments/bills/${sourceId}/`)) {
      throw new ReferenceRegistryError("invalid-argument", "Bill attachment path is outside this Bill.");
    }
    const editedAt = now();
    if (typeof editedAt !== "string" || !editedAt) throw new TypeError("The edit timestamp is invalid.");
    const user = firestore.collection("users").doc(uid);
    const sourceCollection = user.collection(adapter.collection);
    const sourceRef = sourceCollection.doc(sourceId);
    const requestRef = user.collection("referenceEditRequests").doc(operationId);
    const preparedId = adapter.journal(uid, sourceId, {...payload, createdAt: editedAt}, editedAt).id;
    const journalRef = firestore.collection("journals").doc(preparedId);
    const requestHash = hash({recordType, sourceId, expectedState, payload});
    const expectedRequest = {recordType, sourceId, requestHash, journalId: preparedId};

    return firestore.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      const sourceSnapshot = await transaction.get(sourceRef);
      const journalSnapshot = await transaction.get(journalRef);

      if (exists(requestSnapshot)) {
        const marker = requestSnapshot.data();
        assertRequest(marker, expectedRequest);
        if (!exists(sourceSnapshot) || !exists(journalSnapshot)) throw new ReferenceRegistryError("edit-integrity-error", "The successful edit is incomplete.");
        const oldRef = marker.oldRegistryDocumentId ? user.collection("referenceKeys").doc(marker.oldRegistryDocumentId) : null;
        const newRef = marker.newRegistryDocumentId ? user.collection("referenceKeys").doc(marker.newRegistryDocumentId) : null;
        const oldSnapshot = oldRef ? await transaction.get(oldRef) : null;
        const newSnapshot = newRef && marker.newRegistryDocumentId !== marker.oldRegistryDocumentId ? await transaction.get(newRef) : oldSnapshot;
        assertRetrySource(sourceSnapshot.data(), payload, marker, adapter);
        const retryJournal = adapter.journal(uid, sourceId, sourceSnapshot.data(), journalSnapshot.data().createdAt || marker.editedAt).data;
        retryJournal.updatedAt = marker.editedAt;
        if (!same(journalSnapshot.data(), retryJournal)) throw new ReferenceRegistryError("edit-integrity-error", "The edited journal no longer matches this request.");
        if (marker.referenceChanged) {
          assertRetryRegistry(oldSnapshot, marker.oldRegistryDocumentId, REGISTRY_STATES.RETIRED, sourceId, "retireRequestId", operationId);
          assertRetryRegistry(newSnapshot, marker.newRegistryDocumentId, REGISTRY_STATES.ACTIVE, sourceId, "claimRequestId", operationId);
        } else {
          assertRetryRegistry(newSnapshot, marker.newRegistryDocumentId, REGISTRY_STATES.ACTIVE, sourceId, null, operationId);
        }
        return Object.freeze({status: "already-updated", recordType, sourceId, canonicalReference: marker.canonicalReference, registryDocumentId: marker.newRegistryDocumentId, journalId: preparedId, editedAt: marker.editedAt});
      }

      if (!exists(sourceSnapshot)) throw new ReferenceRegistryError("source-not-found", "The source record no longer exists.");
      const source = sourceSnapshot.data();
      if (source.bankSettlement) throw new ReferenceRegistryError("bank-settled-source", "This record is matched to a bank transaction and cannot be edited.");
      if (!same(editStateProjection(recordType, source), expectedState)) throw new ReferenceRegistryError("stale-source", "This record changed after it was opened. Refresh and review it before saving.");

      const oldKey = await keyForReference(recordType, sourceReference(recordType, source));
      const newKey = await keyForReference(recordType, payload[adapter.reference]);
      const referenceChanged = oldKey.registryDocumentId !== newKey.registryDocumentId;
      const oldRef = oldKey.registryDocumentId ? user.collection("referenceKeys").doc(oldKey.registryDocumentId) : null;
      const newRef = newKey.registryDocumentId ? user.collection("referenceKeys").doc(newKey.registryDocumentId) : null;
      const oldSnapshot = oldRef ? await transaction.get(oldRef) : null;
      const newSnapshot = newRef && newKey.registryDocumentId !== oldKey.registryDocumentId ? await transaction.get(newRef) : oldSnapshot;
      const legacySources = referenceChanged && newKey.canonicalReference ? await transaction.get(sourceCollection) : null;

      if (oldRef) {
        if (!exists(oldSnapshot)) throw new ReferenceRegistryError("source-reference-unclaimed", "The source reference has no active registry claim.");
        const oldClaim = assertRegistry(oldSnapshot.data(), oldKey);
        if (oldClaim.state !== REGISTRY_STATES.ACTIVE || oldClaim.sourceId !== sourceId) throw new ReferenceRegistryError("reference-conflict", "The source reference claim is not active for this record.");
      }
      if (referenceChanged && newRef && exists(newSnapshot)) {
        const newClaim = assertRegistry(newSnapshot.data(), newKey);
        if (newClaim.state === REGISTRY_STATES.RETIRED) throw new ReferenceRegistryError("retired-reference", "This reference was previously used and cannot be reused.");
        if (newClaim.state === REGISTRY_STATES.LEGACY_CONFLICT) throw new ReferenceRegistryError("legacy-conflict", "This reference has a legacy collision that must be resolved first.");
        throw new ReferenceRegistryError("reference-conflict", "This reference is already used by another record.");
      }
      if (legacySources && Array.isArray(legacySources.docs)) {
        for (const candidate of legacySources.docs) {
          if (String(candidate.id) === sourceId) continue;
          const candidateKey = await keyForReference(recordType, sourceReference(recordType, candidate.data()));
          if (candidateKey.canonicalReference === newKey.canonicalReference) throw new ReferenceRegistryError("legacy-reference-conflict", "This reference is already used by an existing record.");
        }
      }

      const sourceUpdate = {...payload, updatedAt: editedAt};
      const legacyFieldUpdated = Object.prototype.hasOwnProperty.call(source, adapter.legacy);
      if (legacyFieldUpdated) sourceUpdate[adapter.legacy] = payload[adapter.reference];
      const updatedSource = {...source, ...sourceUpdate};
      let prepared;
      try {
        const journalCreatedAt = exists(journalSnapshot) && journalSnapshot.data().createdAt ? journalSnapshot.data().createdAt : editedAt;
        prepared = adapter.journal(uid, sourceId, updatedSource, journalCreatedAt);
        prepared.data.updatedAt = editedAt;
      } catch (_error) {
        throw new ReferenceRegistryError("invalid-argument", "The edit payload cannot produce a valid accounting journal.");
      }
      const timestamp = serverTimestamp();
      if (referenceChanged && oldRef) transaction.update(oldRef, {state: REGISTRY_STATES.RETIRED, retiredAt: timestamp, retireRequestId: operationId});
      if (referenceChanged && newRef) transaction.create(newRef, registryData(newKey, sourceId, timestamp, operationId));
      transaction.update(sourceRef, sourceUpdate);
      transaction.set(journalRef, prepared.data);
      transaction.create(requestRef, {
        schemaVersion: 1, operation: "edit", recordType, sourceId, requestHash,
        oldRegistryDocumentId: oldKey.registryDocumentId, newRegistryDocumentId: newKey.registryDocumentId,
        canonicalReference: newKey.canonicalReference, referenceChanged, legacyFieldUpdated,
        journalId: prepared.id, editedAt, createdAt: timestamp,
      });
      return Object.freeze({status: "updated", recordType, sourceId, canonicalReference: newKey.canonicalReference, registryDocumentId: newKey.registryDocumentId, retiredRegistryDocumentId: referenceChanged ? oldKey.registryDocumentId : null, journalId: prepared.id, editedAt});
    });
  };
}

module.exports = {createSourceEditService};
