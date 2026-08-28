/* eslint-disable max-len, require-jsdoc */

"use strict";

const JSON_BACKUP_APP = "Simple Books";
const JSON_BACKUP_SCHEMA_VERSION = 2;
const JSON_BACKUP_CODEC_VERSION = 1;
const CODEC_KEY = "__simpleBooksV2Value";

const JSON_BACKUP_COLLECTIONS = Object.freeze([
  "invoices", "bills", "expenses", "mileage", "clients", "customers", "projects", "budgets",
  "bankAccounts", "bankTransactions", "bankIncome", "bankReconciliations", "bankTransfers",
  "bankTransferLinks", "bankExceptionResolutions", "journals", "referenceKeys",
]);

const JSON_BACKUP_ACCOUNT_FIELDS = Object.freeze([
  "fullName", "email", "role", "businessName", "businessEmail", "phoneNumber", "businessType",
  "addressLine1", "addressLine2", "townCity", "postcode", "vatRegistered", "vatNumber",
  "businessWebsite", "companyNumber", "paymentTermsDefault", "accountName", "sortCode", "accountNumber",
]);

const JSON_BACKUP_OMISSION_IDS = Object.freeze([
  "storage-binaries", "authentication", "billing-profile", "operational-markers", "account-internals", "admin-analytics",
]);

class JsonBackupV2Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "JsonBackupV2Error";
    this.code = code;
    this.details = details;
  }
}

function fail(message, details) {
  throw new JsonBackupV2Error("INVALID_BACKUP", message, details);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, fields, label) {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) fail(`${label} contains unknown field ${field}.`);
  }
}

function validTimestampParts(seconds, nanoseconds) {
  return Number.isSafeInteger(seconds) && Number.isInteger(nanoseconds) && nanoseconds >= 0 && nanoseconds <= 999999999;
}

function decodeJsonBackupValue(value, options = {}) {
  const path = options.path || "value";
  const timestampFactory = options.timestampFactory || ((seconds, nanoseconds) => ({seconds, nanoseconds}));
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => decodeJsonBackupValue(item, {timestampFactory, path: `${path}[${index}]`}));
  if (!plainObject(value)) fail(`${path} contains an unsupported value.`);
  if (Object.prototype.hasOwnProperty.call(value, CODEC_KEY)) {
    if (Object.keys(value).length !== 1 || !plainObject(value[CODEC_KEY])) fail(`${path} contains a malformed Firestore value marker.`);
    const marker = value[CODEC_KEY];
    if (marker.version !== JSON_BACKUP_CODEC_VERSION || typeof marker.type !== "string") fail(`${path} contains an unsupported Firestore value marker.`);
    if (marker.type === "timestamp") {
      exactFields(marker, ["version", "type", "seconds", "nanoseconds"], path);
      if (!validTimestampParts(marker.seconds, marker.nanoseconds)) fail(`${path} contains a malformed Timestamp marker.`);
      return timestampFactory(marker.seconds, marker.nanoseconds);
    }
    if (marker.type === "escaped-object") {
      exactFields(marker, ["version", "type", "value"], path);
      if (!plainObject(marker.value)) fail(`${path} contains a malformed escaped-object marker.`);
      const decoded = {};
      for (const key of Object.keys(marker.value)) decoded[key] = decodeJsonBackupValue(marker.value[key], {timestampFactory, path: `${path}.value.${key}`});
      return decoded;
    }
    fail(`${path} contains an unknown Firestore value marker type.`);
  }
  const decoded = {};
  for (const key of Object.keys(value)) decoded[key] = decodeJsonBackupValue(value[key], {timestampFactory, path: `${path}.${key}`});
  return decoded;
}

function requireReference(ids, collection, id, label) {
  if (id && !ids[collection].has(String(id))) fail(`${label} references missing ${collection} record ${id}.`);
}

function validateRelationships(collections) {
  const ids = Object.fromEntries(JSON_BACKUP_COLLECTIONS.map((name) => [name, new Set(collections[name].map((record) => record.id))]));
  for (const name of ["invoices", "bills", "expenses", "mileage", "budgets", "bankIncome"]) {
    for (const record of collections[name]) {
      requireReference(ids, "projects", record.data.projectId, `${name}/${record.id}`);
      requireReference(ids, "bankTransactions", record.data.bankSettlement && record.data.bankSettlement.transactionId, `${name}/${record.id}`);
    }
  }
  for (const record of collections.projects) {
    const customerId = String(record.data.customerId || "");
    if (customerId && !ids.customers.has(customerId) && !ids.clients.has(customerId)) fail(`projects/${record.id} references missing client or customer ${customerId}.`);
  }
  for (const name of ["bankTransactions", "bankIncome", "bankReconciliations", "bankExceptionResolutions"]) {
    for (const record of collections[name]) requireReference(ids, "bankAccounts", record.data.bankAccountId, `${name}/${record.id}`);
  }
  for (const name of ["bankTransfers", "bankTransferLinks"]) {
    for (const record of collections[name]) {
      requireReference(ids, "bankAccounts", record.data.sourceBankAccountId, `${name}/${record.id}`);
      requireReference(ids, "bankAccounts", record.data.destinationBankAccountId, `${name}/${record.id}`);
    }
  }
  const matches = {invoice: "invoices", bill: "bills", expense: "expenses", bankIncome: "bankIncome", bankTransfer: "bankTransfers", bankException: "bankExceptionResolutions"};
  for (const record of collections.bankTransactions) {
    const type = String(record.data.matchedRecordType || "");
    const matchedId = String(record.data.matchedRecordId || "");
    if (record.data.status === "matched") {
      if (!matches[type] || !matchedId) fail(`bankTransactions/${record.id} has an invalid matched-record link.`);
      requireReference(ids, matches[type], matchedId, `bankTransactions/${record.id}`);
    }
  }
  for (const name of ["bankIncome", "bankExceptionResolutions"]) {
    for (const record of collections[name]) requireReference(ids, "bankTransactions", record.data.bankTransactionId, `${name}/${record.id}`);
  }
  for (const record of collections.bankTransferLinks) {
    requireReference(ids, "bankTransfers", record.data.transferId, `bankTransferLinks/${record.id}`);
    requireReference(ids, "bankTransactions", record.data.sourceTransactionId, `bankTransferLinks/${record.id}`);
    requireReference(ids, "bankTransactions", record.data.destinationTransactionId, `bankTransferLinks/${record.id}`);
  }
  const sourceCollections = {salesInvoice: "invoices", supplierBill: "bills", expenseClaim: "expenses", bankSettlement: "bankTransactions", bankIncome: "bankIncome", bankOpeningBalance: "bankAccounts", bankTransfer: "bankTransfers", bankException: "bankExceptionResolutions"};
  for (const record of collections.journals) {
    if (record.data.sourceType === "journalReversal") continue;
    if (record.data.sourceType === "mileageClaim") {
      const sourceId = String(record.data.sourceId || "");
      if (!ids.mileage.has(sourceId) && !ids.expenses.has(sourceId)) fail(`journals/${record.id} references missing mileage record ${sourceId}.`);
      continue;
    }
    const sourceCollection = sourceCollections[record.data.sourceType];
    if (!sourceCollection) fail(`journals/${record.id} has unsupported sourceType ${record.data.sourceType || "(blank)"}.`);
    requireReference(ids, sourceCollection, record.data.sourceId, `journals/${record.id}`);
  }
  for (const record of collections.referenceKeys) {
    if (!["invoice", "bill"].includes(record.data.recordType)) fail(`referenceKeys/${record.id} has an unsupported record type.`);
    if (!["active", "retired", "legacy-conflict"].includes(record.data.state)) fail(`referenceKeys/${record.id} has an unsupported state.`);
    if (record.data.state === "active") requireReference(ids, record.data.recordType === "invoice" ? "invoices" : "bills", record.data.sourceId, `referenceKeys/${record.id}`);
  }
}

function validateAndDecodeJsonBackupV2(backup, options = {}) {
  if (!plainObject(backup)) fail("Backup root must be a JSON object.");
  exactFields(backup, ["app", "schemaVersion", "exportedAt", "manifest", "account", "collections"], "Backup root");
  if (backup.app !== JSON_BACKUP_APP) fail(`Backup app must be ${JSON_BACKUP_APP}.`);
  if (backup.schemaVersion !== JSON_BACKUP_SCHEMA_VERSION) fail(`Only schema version ${JSON_BACKUP_SCHEMA_VERSION} is supported.`);
  if (typeof backup.exportedAt !== "string" || Number.isNaN(Date.parse(backup.exportedAt))) fail("Backup exportedAt must be a valid date-time string.");
  if (!plainObject(backup.manifest) || !plainObject(backup.account) || !plainObject(backup.collections)) fail("Backup manifest, account and collections must be objects.");
  exactFields(backup.manifest, ["codecVersion", "collectionCounts", "accountFields", "storageBinariesIncluded", "omissions"], "Backup manifest");
  const manifest = backup.manifest;
  if (manifest.codecVersion !== JSON_BACKUP_CODEC_VERSION || manifest.storageBinariesIncluded !== false || !plainObject(manifest.collectionCounts) || !Array.isArray(manifest.accountFields) || !Array.isArray(manifest.omissions)) fail("Backup manifest is invalid.");
  exactFields(backup.collections, JSON_BACKUP_COLLECTIONS, "Backup collections");
  exactFields(manifest.collectionCounts, JSON_BACKUP_COLLECTIONS, "Manifest collectionCounts");
  const accountKeys = Object.keys(backup.account).sort();
  for (const field of accountKeys) if (!JSON_BACKUP_ACCOUNT_FIELDS.includes(field)) fail(`Unknown or unsafe account setting: ${field}.`);
  if (JSON.stringify([...manifest.accountFields].sort()) !== JSON.stringify(accountKeys)) fail("Manifest accountFields does not match the account settings present.");
  if (JSON.stringify([...manifest.omissions].sort()) !== JSON.stringify([...JSON_BACKUP_OMISSION_IDS].sort())) fail("Manifest omissions do not match the V2 schema.");
  const timestampFactory = options.timestampFactory;
  const collections = {};
  for (const name of JSON_BACKUP_COLLECTIONS) {
    const records = backup.collections[name];
    if (!Array.isArray(records)) fail(`Collection ${name} must be an array.`);
    if (manifest.collectionCounts[name] !== records.length) fail(`Manifest count for ${name} does not match its records.`);
    const seen = new Set();
    collections[name] = records.map((record, index) => {
      if (!plainObject(record)) fail(`collections.${name}[${index}] must have the shape {id, data}.`);
      exactFields(record, ["id", "data"], `collections.${name}[${index}]`);
      if (typeof record.id !== "string" || !record.id || record.id.includes("/") || record.id.length > 1500 || !plainObject(record.data)) fail(`collections.${name}[${index}] must have the shape {id, data}.`);
      if (seen.has(record.id)) fail(`Collection ${name} contains duplicate document ID ${record.id}.`);
      seen.add(record.id);
      return {id: record.id, data: decodeJsonBackupValue(record.data, {timestampFactory, path: `collections.${name}[${index}].data`})};
    });
  }
  const account = decodeJsonBackupValue(backup.account, {timestampFactory, path: "account"});
  validateRelationships(collections);
  return Object.freeze({account, collections, exportedAt: backup.exportedAt, collectionCounts: Object.freeze({...manifest.collectionCounts})});
}

module.exports = {
  JSON_BACKUP_ACCOUNT_FIELDS,
  JSON_BACKUP_APP,
  JSON_BACKUP_CODEC_VERSION,
  JSON_BACKUP_COLLECTIONS,
  JSON_BACKUP_OMISSION_IDS,
  JSON_BACKUP_SCHEMA_VERSION,
  JsonBackupV2Error,
  decodeJsonBackupValue,
  validateAndDecodeJsonBackupV2,
};
