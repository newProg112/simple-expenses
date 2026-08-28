/* eslint-disable max-len, require-jsdoc */

"use strict";

const {createHash, randomUUID} = require("node:crypto");
const {billJournal, invoiceJournal, journalId} = require("./source-create-accounting");
const {referenceRegistryKey, sourceReference} = require("./reference-registry-key");
const {
  JSON_BACKUP_COLLECTIONS,
  JsonBackupV2Error,
  validateAndDecodeJsonBackupV2,
} = require("./json-backup-v2-schema");
const {REQUEST_ID_PATTERN} = require("./reference-registry-constants");

const USER_COLLECTIONS = Object.freeze(JSON_BACKUP_COLLECTIONS.filter((name) => name !== "journals"));
const WRITE_ORDER = Object.freeze([
  ["master-data", ["clients", "customers", "projects", "budgets", "bankAccounts"]],
  ["business-sources", ["invoices", "bills", "expenses", "mileage"]],
  ["banking", ["bankTransactions", "bankIncome", "bankTransfers", "bankReconciliations", "bankExceptionResolutions", "bankTransferLinks"]],
  ["references", ["referenceKeys"]],
  ["journals", ["journals"]],
]);
const BANK_OWNED_COLLECTIONS = new Set([
  "bankAccounts", "bankTransactions", "bankIncome", "bankReconciliations", "bankTransfers", "bankTransferLinks", "bankExceptionResolutions",
]);
const ATTACHMENT_COLLECTIONS = new Set(["bills", "expenses", "mileage", "clients"]);
const ATTACHMENT_FIELDS = Object.freeze(["attachmentName", "attachmentUrl", "attachmentPath", "attachmentSize", "attachmentType"]);
const JOURNAL_PREFIXES = Object.freeze({
  salesInvoice: "invoice", supplierBill: "bill", expenseClaim: "expense", mileageClaim: "mileage",
  bankSettlement: "bank-settlement", bankIncome: "bank-income", bankOpeningBalance: "bank-opening-balance",
  bankTransfer: "bank-transfer", bankException: "bank-exception", journalReversal: "journalReversal",
});

class JsonBackupRestoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "JsonBackupRestoreError";
    this.code = code;
    this.details = details;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function backupHash(backup) {
  return createHash("sha256").update(stableJson(backup), "utf8").digest("hex");
}

function snapshotExists(snapshot) {
  return Boolean(snapshot && (typeof snapshot.exists === "function" ? snapshot.exists() : snapshot.exists));
}

function snapshotDocuments(snapshot) {
  return snapshot && Array.isArray(snapshot.docs) ? snapshot.docs : [];
}

function copyData(value) {
  if (Array.isArray(value)) return value.map(copyData);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function" && Number.isInteger(value.seconds)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyData(child)]));
  }
  return value;
}

function sanitiseRecord(collectionName, data, uid) {
  const restored = copyData(data);
  for (const field of ["uid", "ownerId", "userId"]) delete restored[field];
  if (BANK_OWNED_COLLECTIONS.has(collectionName)) restored.userId = uid;
  if (ATTACHMENT_COLLECTIONS.has(collectionName)) {
    for (const field of ATTACHMENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(restored, field)) restored[field] = field === "attachmentSize" ? 0 : "";
    }
  }
  return restored;
}

function validateJournalData(data, label) {
  if (!data || !Array.isArray(data.lines) || data.lines.length < 2 || !String(data.sourceType || "") || !String(data.sourceId || "")) {
    throw new JsonBackupRestoreError("INVALID_BACKUP", `${label} is not a valid journal.`);
  }
  let debit = 0;
  let credit = 0;
  for (const line of data.lines) {
    const lineDebit = Number(line && line.debit);
    const lineCredit = Number(line && line.credit);
    if (!Number.isFinite(lineDebit) || !Number.isFinite(lineCredit) || lineDebit < 0 || lineCredit < 0) throw new JsonBackupRestoreError("INVALID_BACKUP", `${label} contains an invalid journal line.`);
    debit += lineDebit;
    credit += lineCredit;
  }
  if (Math.round(debit * 100) !== Math.round(credit * 100)) throw new JsonBackupRestoreError("INVALID_BACKUP", `${label} is not balanced.`);
}

function targetJournalId(uid, sourceType, sourceId) {
  const prefix = JOURNAL_PREFIXES[sourceType];
  if (!prefix) throw new JsonBackupRestoreError("INVALID_BACKUP", `Unsupported journal source type ${sourceType}.`);
  return journalId(uid, prefix, sourceId);
}

async function prepareRestorePlan(decoded, uid, serverTimestamp) {
  const plan = {account: copyData(decoded.account), collections: {}};
  for (const name of JSON_BACKUP_COLLECTIONS) plan.collections[name] = [];
  for (const name of USER_COLLECTIONS) {
    if (name === "referenceKeys") continue;
    plan.collections[name] = decoded.collections[name].map((record) => ({id: record.id, data: sanitiseRecord(name, record.data, uid)}));
  }

  const sourceRecords = {
    invoice: new Map(plan.collections.invoices.map((record) => [record.id, record.data])),
    bill: new Map(plan.collections.bills.map((record) => [record.id, record.data])),
  };
  const exportedClaims = new Map(decoded.collections.referenceKeys.map((record) => [record.id, record.data]));
  const claimIds = new Set();
  for (const recordType of ["invoice", "bill"]) {
    for (const [sourceId, source] of sourceRecords[recordType]) {
      const key = await referenceRegistryKey(recordType, sourceReference(recordType, source));
      if (!key.registryDocumentId) continue;
      if (claimIds.has(key.registryDocumentId)) throw new JsonBackupRestoreError("INVALID_BACKUP", `Duplicate active ${recordType} reference ${key.canonicalReference}.`);
      claimIds.add(key.registryDocumentId);
      const exported = exportedClaims.get(key.registryDocumentId);
      plan.collections.referenceKeys.push({
        id: key.registryDocumentId,
        data: {
          schemaVersion: 1, recordType, canonicalReference: key.canonicalReference, sourceId, state: "active",
          claimedAt: exported && exported.state === "active" ? exported.claimedAt : serverTimestamp(), retiredAt: null,
        },
      });
    }
  }
  for (const record of decoded.collections.referenceKeys) {
    if (record.data.state === "active") continue;
    const key = await referenceRegistryKey(record.data.recordType, record.data.canonicalReference || "");
    if (!key.registryDocumentId || key.registryDocumentId !== record.id || claimIds.has(record.id)) throw new JsonBackupRestoreError("INVALID_BACKUP", `referenceKeys/${record.id} is not a safe historical reference claim.`);
    claimIds.add(record.id);
    const data = sanitiseRecord("referenceKeys", record.data, uid);
    delete data.claimRequestId;
    delete data.retireRequestId;
    plan.collections.referenceKeys.push({id: record.id, data});
  }

  const exportedJournals = decoded.collections.journals;
  const oldToNew = new Map();
  for (const record of exportedJournals) {
    if (["salesInvoice", "supplierBill"].includes(record.data.sourceType)) {
      oldToNew.set(record.id, targetJournalId(uid, record.data.sourceType, record.data.sourceId));
    } else if (record.data.sourceType !== "journalReversal") {
      oldToNew.set(record.id, targetJournalId(uid, record.data.sourceType, record.data.sourceId));
    }
  }
  for (const record of exportedJournals.filter((item) => item.data.sourceType === "journalReversal")) {
    const mappedSource = oldToNew.get(String(record.data.sourceId || ""));
    if (!mappedSource) throw new JsonBackupRestoreError("INVALID_BACKUP", `journals/${record.id} reverses a journal that is not in the backup.`);
    oldToNew.set(record.id, targetJournalId(uid, "journalReversal", mappedSource));
  }
  const journalIds = new Set();
  const addJournal = (id, data) => {
    if (journalIds.has(id)) throw new JsonBackupRestoreError("INVALID_BACKUP", `Restore would create duplicate journal ${id}.`);
    validateJournalData(data, `journals/${id}`);
    journalIds.add(id);
    plan.collections.journals.push({id, data: {...data, userId: uid, journalId: id}});
  };
  for (const record of plan.collections.invoices) {
    try {
      const prepared = invoiceJournal(uid, record.id, record.data, record.data.createdAt || serverTimestamp());
      addJournal(prepared.id, prepared.data);
    } catch (error) {
      throw new JsonBackupRestoreError("INVALID_BACKUP", `invoices/${record.id} cannot regenerate its accounting journal: ${error.message}`);
    }
  }
  for (const record of plan.collections.bills) {
    try {
      const prepared = billJournal(uid, record.id, record.data, record.data.createdAt || serverTimestamp());
      addJournal(prepared.id, prepared.data);
    } catch (error) {
      throw new JsonBackupRestoreError("INVALID_BACKUP", `bills/${record.id} cannot regenerate its accounting journal: ${error.message}`);
    }
  }
  for (const record of exportedJournals) {
    if (["salesInvoice", "supplierBill"].includes(record.data.sourceType)) continue;
    const data = sanitiseRecord("journals", record.data, uid);
    if (data.sourceType === "journalReversal") {
      data.sourceId = oldToNew.get(String(data.sourceId || ""));
      if (data.reversedJournalId) data.reversedJournalId = oldToNew.get(String(data.reversedJournalId)) || "";
    }
    const id = oldToNew.get(record.id);
    addJournal(id, data);
  }
  return plan;
}

function documentReference(firestore, uid, collectionName, id) {
  return collectionName === "journals" ? firestore.collection("journals").doc(id) : firestore.collection("users").doc(uid).collection(collectionName).doc(id);
}

async function inspectDestination(firestore, uid) {
  const counts = {};
  for (const name of USER_COLLECTIONS) {
    const snapshot = await firestore.collection("users").doc(uid).collection(name).limit(1).get();
    counts[name] = snapshot.empty ? 0 : 1;
  }
  const journals = await firestore.collection("journals").where("userId", "==", uid).limit(1).get();
  counts.journals = journals.empty ? 0 : 1;
  const nonEmptyCollections = JSON_BACKUP_COLLECTIONS.filter((name) => counts[name]);
  return {empty: nonEmptyCollections.length === 0, counts, nonEmptyCollections};
}

async function writeRecords(firestore, uid, records, batchSize) {
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = firestore.batch();
    for (const record of records.slice(offset, offset + batchSize)) batch.set(documentReference(firestore, uid, record.collectionName, record.id), record.data);
    await batch.commit();
  }
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    if (Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)) return {seconds: value.seconds, nanoseconds: value.nanoseconds};
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]));
  }
  return value;
}

function serverTimestampSentinel(value) {
  if (!value || typeof value !== "object") return false;
  const method = String(value._methodName || value.constructor && value.constructor.name || "").toLowerCase();
  return method.includes("servertimestamp");
}

function expectedDataMismatch(actual, expected, path = "data") {
  if (serverTimestampSentinel(expected)) return actual && typeof actual.toDate === "function" ? "" : path;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path;
    for (let index = 0; index < expected.length; index++) {
      const mismatch = expectedDataMismatch(actual[index], expected[index], `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
    return "";
  }
  if (expected && typeof expected === "object") {
    if (Number.isInteger(expected.seconds) && Number.isInteger(expected.nanoseconds)) {
      const persistedNanoseconds = Math.floor(expected.nanoseconds / 1000) * 1000;
      return actual && actual.seconds === expected.seconds &&
        (actual.nanoseconds === expected.nanoseconds || actual.nanoseconds === persistedNanoseconds) ? "" : path;
    }
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return path;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return `${path} fields`;
    for (const key of expectedKeys) {
      const mismatch = expectedDataMismatch(actual[key], expected[key], `${path}.${key}`);
      if (mismatch) return mismatch;
    }
    return "";
  }
  return Object.is(actual, expected) ? "" : path;
}

async function verifyRestore(firestore, uid, plan) {
  const failures = [];
  for (const name of JSON_BACKUP_COLLECTIONS) {
    const snapshot = name === "journals" ? await firestore.collection("journals").where("userId", "==", uid).get() : await firestore.collection("users").doc(uid).collection(name).get();
    const actual = new Map(snapshotDocuments(snapshot).map((doc) => [doc.id, doc.data()]));
    const expected = plan.collections[name];
    if (actual.size !== expected.length) failures.push(`${name} count is ${actual.size}; expected ${expected.length}.`);
    for (const record of expected) {
      if (!actual.has(record.id)) failures.push(`${name}/${record.id} is missing.`);
      else if (name === "journals" && actual.get(record.id).userId !== uid) failures.push(`${name}/${record.id} has wrong ownership.`);
      else if (BANK_OWNED_COLLECTIONS.has(name) && actual.get(record.id).userId !== uid) failures.push(`${name}/${record.id} has wrong ownership.`);
      else {
        const mismatch = expectedDataMismatch(actual.get(record.id), record.data);
        if (mismatch) failures.push(`${name}/${record.id} data does not match the restore plan at ${mismatch}.`);
      }
    }
  }
  const accountSnapshot = await firestore.collection("users").doc(uid).get();
  const account = snapshotExists(accountSnapshot) ? accountSnapshot.data() : {};
  for (const [field, expected] of Object.entries(plan.account)) {
    if (stableJson(comparable(account[field])) !== stableJson(comparable(expected))) failures.push(`Account setting ${field} was not restored correctly.`);
  }
  if (failures.length) throw new JsonBackupRestoreError("VERIFICATION_FAILED", "Restore verification failed.", {failures: failures.slice(0, 25)});
  return {verified: true, collectionCounts: Object.fromEntries(JSON_BACKUP_COLLECTIONS.map((name) => [name, plan.collections[name].length]))};
}

function createJsonBackupRestoreService(options = {}) {
  const firestore = options.firestore;
  const timestampFactory = options.timestampFactory;
  const serverTimestamp = options.serverTimestamp;
  const now = options.now || (() => Date.now());
  const batchSize = options.batchSize || 400;
  if (!firestore || typeof firestore.collection !== "function" || typeof firestore.batch !== "function" || typeof firestore.runTransaction !== "function") throw new TypeError("A Firestore service is required.");
  if (typeof timestampFactory !== "function" || typeof serverTimestamp !== "function") throw new TypeError("Firestore Timestamp providers are required.");

  return async function restoreJsonBackupV2(input = {}) {
    const uid = String(input.uid || "").trim();
    const jobId = String(input.jobId || "").trim();
    if (!uid) throw new JsonBackupRestoreError("UNAUTHENTICATED", "Authentication is required.");
    if (!REQUEST_ID_PATTERN.test(jobId)) throw new JsonBackupRestoreError("INVALID_REQUEST", "A valid restore job UUID is required.");
    let decoded;
    try {
      decoded = validateAndDecodeJsonBackupV2(input.backup, {timestampFactory});
    } catch (error) {
      if (error instanceof JsonBackupV2Error) throw new JsonBackupRestoreError(error.code, error.message, error.details);
      throw error;
    }
    const hash = backupHash(input.backup);
    const jobRef = firestore.collection("jsonRestoreJobs").doc(`${encodeURIComponent(uid)}_${jobId}`);
    const lockRef = firestore.collection("jsonRestoreLocks").doc(uid);
    const initialJob = await jobRef.get();
    const initial = snapshotExists(initialJob) ? initialJob.data() : null;
    if (initial && initial.ownerUid !== uid) throw new JsonBackupRestoreError("JOB_CONFLICT", "Restore job ownership is invalid.");
    if (initial && initial.backupHash !== hash) throw new JsonBackupRestoreError("JOB_CONFLICT", "This restore job ID is already bound to another backup.");
    const exportedAtMillis = Date.parse(decoded.exportedAt);
    const exportedAtTimestamp = timestampFactory(
        Math.floor(exportedAtMillis / 1000),
        (exportedAtMillis % 1000) * 1000000,
    );
    const plan = await prepareRestorePlan(decoded, uid, () => exportedAtTimestamp);
    if (initial && initial.status === "completed") {
      const verification = await verifyRestore(firestore, uid, plan);
      return {status: "completed", verified: true, replayed: true, jobId, ...verification};
    }
    if (!initial) {
      const destination = await inspectDestination(firestore, uid);
      if (!destination.empty) throw new JsonBackupRestoreError("NON_EMPTY_DESTINATION", "The destination account contains restorable data.", {collections: destination.nonEmptyCollections});
    }
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now() + 10 * 60 * 1000);
    await firestore.runTransaction(async (transaction) => {
      const [snapshot, lockSnapshot] = await Promise.all([transaction.get(jobRef), transaction.get(lockRef)]);
      const current = snapshotExists(snapshot) ? snapshot.data() : null;
      const lock = snapshotExists(lockSnapshot) ? lockSnapshot.data() : null;
      if (current && (current.ownerUid !== uid || current.backupHash !== hash)) throw new JsonBackupRestoreError("JOB_CONFLICT", "Restore job does not match this request.");
      const leaseMillis = current && current.leaseExpiresAt && typeof current.leaseExpiresAt.toMillis === "function" ? current.leaseExpiresAt.toMillis() : current && current.leaseExpiresAt instanceof Date ? current.leaseExpiresAt.getTime() : 0;
      if (current && current.status === "running" && leaseMillis > now()) throw new JsonBackupRestoreError("RESTORE_IN_PROGRESS", "This restore job is already running.");
      const lockLeaseMillis = lock && lock.leaseExpiresAt && typeof lock.leaseExpiresAt.toMillis === "function" ? lock.leaseExpiresAt.toMillis() : lock && lock.leaseExpiresAt instanceof Date ? lock.leaseExpiresAt.getTime() : 0;
      if (lock && lock.jobId !== jobId && lock.status === "running" && lockLeaseMillis > now()) throw new JsonBackupRestoreError("RESTORE_IN_PROGRESS", "Another restore job is already running for this account.");
      transaction.set(jobRef, {
        ownerUid: uid, jobId, backupHash: hash, schemaVersion: 2, status: "running", stage: current && current.stage || "starting",
        attemptCount: Number(current && current.attemptCount || 0) + 1, leaseId, leaseExpiresAt, updatedAt: serverTimestamp(),
        ...(!current ? {createdAt: serverTimestamp(), exportedAt: decoded.exportedAt} : {}),
      }, {merge: true});
      transaction.set(lockRef, {ownerUid: uid, jobId, backupHash: hash, status: "running", leaseId, leaseExpiresAt, updatedAt: serverTimestamp()}, {merge: true});
    });
    let currentStage = "account-settings";
    try {
      await firestore.collection("users").doc(uid).set(plan.account, {merge: true});
      await jobRef.set({stage: "account-settings", updatedAt: serverTimestamp()}, {merge: true});
      let completedRecords = 0;
      const totalRecords = JSON_BACKUP_COLLECTIONS.reduce((total, name) => total + plan.collections[name].length, 0);
      for (const [stage, names] of WRITE_ORDER) {
        currentStage = stage;
        const records = names.flatMap((collectionName) => plan.collections[collectionName].map((record) => ({...record, collectionName})));
        await writeRecords(firestore, uid, records, batchSize);
        completedRecords += records.length;
        const renewedLease = new Date(now() + 10 * 60 * 1000);
        await Promise.all([
          jobRef.set({stage, completedRecords, totalRecords, updatedAt: serverTimestamp(), leaseExpiresAt: renewedLease}, {merge: true}),
          lockRef.set({status: "running", jobId, leaseId, leaseExpiresAt: renewedLease, updatedAt: serverTimestamp()}, {merge: true}),
        ]);
      }
      const verification = await verifyRestore(firestore, uid, plan);
      await jobRef.set({status: "completed", stage: "completed", verified: true, completedAt: serverTimestamp(), updatedAt: serverTimestamp(), leaseExpiresAt: null, collectionCounts: verification.collectionCounts}, {merge: true});
      await lockRef.set({status: "completed", jobId, leaseId, leaseExpiresAt: null, completedAt: serverTimestamp(), updatedAt: serverTimestamp()}, {merge: true});
      return {status: "completed", verified: true, replayed: false, jobId, ...verification};
    } catch (error) {
      try {
        await jobRef.set({status: "failed", stage: "failed", failedStage: currentStage, errorCode: error.code || "INTERNAL", errorMessage: String(error.message || "Restore failed.").slice(0, 1000), failedAt: serverTimestamp(), updatedAt: serverTimestamp(), leaseExpiresAt: null}, {merge: true});
        await lockRef.set({status: "failed", failedStage: currentStage, jobId, leaseId, leaseExpiresAt: null, failedAt: serverTimestamp(), updatedAt: serverTimestamp()}, {merge: true});
      } catch (_) {/* Preserve the original restore failure. */}
      throw error;
    }
  };
}

module.exports = {
  ATTACHMENT_FIELDS,
  BANK_OWNED_COLLECTIONS,
  JsonBackupRestoreError,
  USER_COLLECTIONS,
  WRITE_ORDER,
  backupHash,
  createJsonBackupRestoreService,
  inspectDestination,
  prepareRestorePlan,
  verifyRestore,
};
