/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("crypto");
const {billJournal, invoiceJournal} = require("./source-create-accounting");
const {referenceRegistryKey} = require("./reference-registry-key");
const {
  REGISTRY_SCHEMA_VERSION, REGISTRY_STATES, REQUEST_ID_PATTERN, ReferenceRegistryError,
} = require("./reference-registry-service");
const {validateCreatePayload} = require("./source-create-schema");

function snapshotExists(snapshot) {
  return Boolean(snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists));
}

function identifier(value, label) {
  const result = String(value || "").trim();
  if (!result || result.includes("/") || result.length > 512) {
    throw new ReferenceRegistryError("invalid-argument", `${label} is invalid.`);
  }
  return result;
}

function requestId(value) {
  const result = String(value || "").trim();
  if (!REQUEST_ID_PATTERN.test(result)) throw new ReferenceRegistryError("invalid-argument", "A valid request UUID is required.");
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function payloadHash(recordType, sourceId, payload) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({recordType, sourceId, payload}))).digest("hex");
}

function sameData(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function assertRetryArtifacts(source, journal, payload, prepared) {
  const {createdAt: sourceCreatedAt, ...storedPayload} = source || {};
  if (typeof sourceCreatedAt !== "string" || !sameData(storedPayload, payload)) {
    throw integrityError("The existing source no longer matches this create request.");
  }
  const {createdAt, updatedAt, ...storedJournal} = journal || {};
  const expectedJournal = {...prepared.data};
  delete expectedJournal.createdAt;
  delete expectedJournal.updatedAt;
  if (typeof createdAt !== "string" || createdAt !== updatedAt ||
    !sameData(storedJournal, expectedJournal)) {
    throw integrityError("The existing journal no longer matches this create request.");
  }
}

function adapter(recordType) {
  if (recordType === "invoice") return {collection: "invoices", reference: "invoiceNo", journal: invoiceJournal};
  if (recordType === "bill") return {collection: "bills", reference: "billNumber", journal: billJournal};
  throw new ReferenceRegistryError("invalid-argument", "Record type is invalid.");
}

function integrityError(message) {
  return new ReferenceRegistryError("create-integrity-error", message);
}

function assertExactRetry(data, expected) {
  if (!data || data.schemaVersion !== 1 || data.operation !== "create" ||
    data.recordType !== expected.recordType || data.sourceId !== expected.sourceId ||
    data.payloadHash !== expected.payloadHash || data.registryDocumentId !== expected.registryDocumentId ||
    data.journalId !== expected.journalId) {
    throw new ReferenceRegistryError("idempotency-conflict", "This request ID was already used for a different create operation.");
  }
}

function assertRegistry(snapshot, expected) {
  if (!snapshotExists(snapshot)) throw integrityError("The successful create has no reference claim.");
  const data = snapshot.data();
  if (data.schemaVersion !== REGISTRY_SCHEMA_VERSION || data.recordType !== expected.recordType ||
    data.canonicalReference !== expected.canonicalReference || data.sourceId !== expected.sourceId ||
    data.state !== REGISTRY_STATES.ACTIVE || data.claimRequestId !== expected.requestId) {
    throw integrityError("The reference claim is inconsistent with the create operation.");
  }
}

function createSourceWithReferenceService(options = {}) {
  const firestore = options.firestore;
  const serverTimestamp = options.serverTimestamp;
  const now = options.now || (() => new Date().toISOString());
  const keyForReference = options.keyForReference || referenceRegistryKey;
  if (!firestore || typeof firestore.runTransaction !== "function" || typeof firestore.collection !== "function") throw new TypeError("A Firestore transaction service is required.");
  if (typeof serverTimestamp !== "function" || typeof now !== "function") throw new TypeError("Timestamp providers are required.");

  return async function createSourceWithReference(input = {}) {
    const uid = identifier(input.uid, "Authenticated user ID");
    const type = input.recordType;
    const configuration = adapter(type);
    const sourceId = identifier(input.sourceId, "Source ID");
    const operationId = requestId(input.requestId);
    const payload = validateCreatePayload(type, input.payload);
    if (type === "bill" && String(payload.id) !== sourceId) {
      throw new ReferenceRegistryError("invalid-argument", "Bill ID does not match its source path.");
    }
    if (type === "bill" && payload.attachmentPath &&
      !payload.attachmentPath.startsWith(`users/${uid}/attachments/bills/${sourceId}/`)) {
      throw new ReferenceRegistryError("invalid-argument", "Bill attachment path is outside this Bill.");
    }
    const key = await keyForReference(type, payload[configuration.reference]);
    const createdAt = now();
    if (typeof createdAt !== "string" || !createdAt) throw new TypeError("The create timestamp is invalid.");
    const source = {...payload, createdAt};
    let prepared;
    try {
      prepared = configuration.journal(uid, sourceId, source, createdAt);
    } catch (_error) {
      throw new ReferenceRegistryError("invalid-argument", "The create payload cannot produce a valid accounting journal.");
    }
    const hash = payloadHash(type, sourceId, payload);
    const user = firestore.collection("users").doc(uid);
    const sourceCollection = user.collection(configuration.collection);
    const sourceRef = sourceCollection.doc(sourceId);
    const requestRef = user.collection("referenceCreateRequests").doc(operationId);
    const registryRef = key.registryDocumentId ? user.collection("referenceKeys").doc(key.registryDocumentId) : null;
    const journalRef = firestore.collection("journals").doc(prepared.id);
    const expected = {
      recordType: type, sourceId, payloadHash: hash,
      registryDocumentId: key.registryDocumentId, journalId: prepared.id,
      canonicalReference: key.canonicalReference, requestId: operationId,
    };

    return firestore.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      const sourceSnapshot = await transaction.get(sourceRef);
      const registrySnapshot = registryRef ? await transaction.get(registryRef) : null;
      const journalSnapshot = await transaction.get(journalRef);
      const legacySources = key.canonicalReference ? await transaction.get(sourceCollection) : null;

      if (snapshotExists(requestSnapshot)) {
        assertExactRetry(requestSnapshot.data(), expected);
        if (!snapshotExists(sourceSnapshot) || !snapshotExists(journalSnapshot)) throw integrityError("The successful create is incomplete.");
        assertRetryArtifacts(sourceSnapshot.data(), journalSnapshot.data(), payload, prepared);
        if (registryRef) assertRegistry(registrySnapshot, expected);
        return Object.freeze({status: "already-created", recordType: type, sourceId, canonicalReference: key.canonicalReference, registryDocumentId: key.registryDocumentId, journalId: prepared.id, createdAt: sourceSnapshot.data().createdAt});
      }
      if (snapshotExists(sourceSnapshot) || snapshotExists(journalSnapshot)) {
        throw new ReferenceRegistryError("source-conflict", "The requested source or journal already exists.");
      }
      if (registryRef && snapshotExists(registrySnapshot)) {
        const stored = registrySnapshot.data();
        if (stored && stored.state === REGISTRY_STATES.RETIRED) throw new ReferenceRegistryError("retired-reference", "This reference was previously used and cannot be reused.");
        if (stored && stored.state === REGISTRY_STATES.LEGACY_CONFLICT) throw new ReferenceRegistryError("legacy-conflict", "This reference has a legacy collision that must be resolved first.");
        throw new ReferenceRegistryError("reference-conflict", "This reference is already used by another record.");
      }
      if (legacySources && Array.isArray(legacySources.docs)) {
        for (const legacySource of legacySources.docs) {
          if (String(legacySource.id) === sourceId) continue;
          const legacyReference = legacySource.data()[configuration.reference] ||
            legacySource.data().invoiceNumber || "";
          const legacyKey = await keyForReference(type, legacyReference);
          if (legacyKey.canonicalReference === key.canonicalReference) {
            throw new ReferenceRegistryError(
                "legacy-reference-conflict",
                "This reference is already used by an existing record.",
            );
          }
        }
      }

      transaction.create(sourceRef, source);
      transaction.create(journalRef, prepared.data);
      if (registryRef) {
        transaction.create(registryRef, {
          schemaVersion: REGISTRY_SCHEMA_VERSION, recordType: type,
          canonicalReference: key.canonicalReference, sourceId, state: REGISTRY_STATES.ACTIVE,
          claimedAt: serverTimestamp(), retiredAt: null, claimRequestId: operationId,
        });
      }
      transaction.create(requestRef, {
        schemaVersion: 1, operation: "create", recordType: type, sourceId,
        payloadHash: hash, registryDocumentId: key.registryDocumentId,
        journalId: prepared.id, createdAt: serverTimestamp(),
      });
      return Object.freeze({status: "created", recordType: type, sourceId, canonicalReference: key.canonicalReference, registryDocumentId: key.registryDocumentId, journalId: prepared.id, createdAt});
    });
  };
}

module.exports = {createSourceWithReferenceService, payloadHash};
