export const JSON_BACKUP_APP = "Simple Books";
export const JSON_BACKUP_SCHEMA_VERSION = 2;
export const JSON_BACKUP_CODEC_VERSION = 1;

const CODEC_KEY = "__simpleBooksV2Value";
const CODEC_VERSION = 1;

export const JSON_BACKUP_COLLECTIONS = Object.freeze([
  "invoices",
  "bills",
  "expenses",
  "mileage",
  "clients",
  "customers",
  "projects",
  "budgets",
  "bankAccounts",
  "bankTransactions",
  "bankIncome",
  "bankReconciliations",
  "bankTransfers",
  "bankTransferLinks",
  "bankExceptionResolutions",
  "journals",
  "referenceKeys"
]);

export const JSON_BACKUP_ACCOUNT_FIELDS = Object.freeze([
  "fullName",
  "email",
  "role",
  "businessName",
  "businessEmail",
  "phoneNumber",
  "businessType",
  "addressLine1",
  "addressLine2",
  "townCity",
  "postcode",
  "vatRegistered",
  "vatNumber",
  "businessWebsite",
  "companyNumber",
  "paymentTermsDefault",
  "accountName",
  "sortCode",
  "accountNumber"
]);

export const JSON_BACKUP_OMISSIONS = Object.freeze([
  Object.freeze({
    id: "storage-binaries",
    description: "Storage attachments and company-logo files are not included in JSON backups."
  }),
  Object.freeze({
    id: "authentication",
    description: "Authentication credentials and Firebase Authentication identity data are never included."
  }),
  Object.freeze({
    id: "billing-profile",
    description: "Subscription, plan and billing state in userProfiles is server-owned and is not restorable business data."
  }),
  Object.freeze({
    id: "operational-markers",
    description: "Idempotency requests, edit/delete requests and reference-backfill migration markers are transient server internals."
  }),
  Object.freeze({
    id: "account-internals",
    description: "UID, demo, deletion-workflow, backup-status, logo URL and internal account timestamp fields are excluded."
  }),
  Object.freeze({
    id: "admin-analytics",
    description: "Administrative, support, usage and analytics records are outside the business backup."
  })
]);

export class JsonBackupValidationError extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [String(errors || "Backup validation failed.")];
    super(list[0] || "Backup validation failed.");
    this.name = "JsonBackupValidationError";
    this.errors = Object.freeze([...list]);
  }
}

export class DecodedBackupTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
    Object.freeze(this);
  }
}

function objectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function plainObject(value) {
  if(!objectValue(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validTimestampParts(seconds, nanoseconds) {
  return Number.isInteger(seconds) && Number.isSafeInteger(seconds) &&
    Number.isInteger(nanoseconds) && nanoseconds >= 0 && nanoseconds <= 999999999;
}

function firestoreTimestamp(value) {
  return objectValue(value) &&
    validTimestampParts(value.seconds, value.nanoseconds) &&
    typeof value.toDate === "function" &&
    typeof value.toMillis === "function";
}

function marker(type, value) {
  return {
    [CODEC_KEY]: {
      version: CODEC_VERSION,
      type,
      ...value
    }
  };
}

export function encodeJsonBackupValue(value) {
  if(value === null || typeof value === "string" || typeof value === "boolean") return value;
  if(typeof value === "number") {
    if(!Number.isFinite(value)) throw new TypeError("Backup values cannot contain non-finite numbers.");
    return value;
  }
  if(firestoreTimestamp(value)) {
    return marker("timestamp", {
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    });
  }
  if(Array.isArray(value)) return value.map(encodeJsonBackupValue);
  if(plainObject(value)) {
    const encoded = {};
    for(const key of Object.keys(value).sort()) {
      const child = value[key];
      if(typeof child === "undefined") continue;
      encoded[key] = encodeJsonBackupValue(child);
    }
    return Object.prototype.hasOwnProperty.call(value, CODEC_KEY)
      ? marker("escaped-object", { value: encoded })
      : encoded;
  }
  throw new TypeError(`Unsupported backup value type: ${typeof value}.`);
}

function decodeMarker(value, path, timestampFactory) {
  if(Object.keys(value).length !== 1 || !plainObject(value[CODEC_KEY])) {
    throw new JsonBackupValidationError(`${path} contains a malformed Firestore value marker.`);
  }
  const encoded = value[CODEC_KEY];
  if(encoded.version !== CODEC_VERSION || typeof encoded.type !== "string") {
    throw new JsonBackupValidationError(`${path} contains an unsupported Firestore value marker.`);
  }
  if(encoded.type === "timestamp") {
    if(Object.keys(encoded).some(key => !["version", "type", "seconds", "nanoseconds"].includes(key)) ||
      !validTimestampParts(encoded.seconds, encoded.nanoseconds)) {
      throw new JsonBackupValidationError(`${path} contains a malformed Timestamp marker.`);
    }
    return timestampFactory(encoded.seconds, encoded.nanoseconds);
  }
  if(encoded.type === "escaped-object") {
    if(Object.keys(encoded).some(key => !["version", "type", "value"].includes(key)) || !plainObject(encoded.value)) {
      throw new JsonBackupValidationError(`${path} contains a malformed escaped-object marker.`);
    }
    const decoded = {};
    for(const key of Object.keys(encoded.value)) {
      decoded[key] = decodeJsonBackupValue(encoded.value[key], {
        timestampFactory,
        path: `${path}.value.${key}`
      });
    }
    return decoded;
  }
  throw new JsonBackupValidationError(`${path} contains an unknown Firestore value marker type.`);
}

export function decodeJsonBackupValue(value, options = {}) {
  const path = options.path || "value";
  const timestampFactory = options.timestampFactory ||
    ((seconds, nanoseconds) => new DecodedBackupTimestamp(seconds, nanoseconds));
  if(value === null || typeof value === "string" || typeof value === "boolean") return value;
  if(typeof value === "number") {
    if(!Number.isFinite(value)) throw new JsonBackupValidationError(`${path} contains a non-finite number.`);
    return value;
  }
  if(Array.isArray(value)) {
    return value.map((item, index) => decodeJsonBackupValue(item, {
      timestampFactory,
      path: `${path}[${index}]`
    }));
  }
  if(plainObject(value)) {
    if(Object.prototype.hasOwnProperty.call(value, CODEC_KEY)) {
      return decodeMarker(value, path, timestampFactory);
    }
    const decoded = {};
    for(const key of Object.keys(value)) {
      decoded[key] = decodeJsonBackupValue(value[key], {
        timestampFactory,
        path: `${path}.${key}`
      });
    }
    return decoded;
  }
  throw new JsonBackupValidationError(`${path} contains an unsupported value.`);
}

export function selectJsonBackupAccountSettings(account = {}) {
  const selected = {};
  for(const field of JSON_BACKUP_ACCOUNT_FIELDS) {
    if(Object.prototype.hasOwnProperty.call(account, field) && typeof account[field] !== "undefined") {
      selected[field] = account[field];
    }
  }
  return selected;
}

function safeRecord(record, collectionName, index) {
  if(!plainObject(record) || typeof record.id !== "string" || !record.id || record.id.includes("/") || !plainObject(record.data)) {
    throw new TypeError(`${collectionName}[${index}] is not a valid Firestore backup record.`);
  }
  return {
    id: record.id,
    data: encodeJsonBackupValue(record.data)
  };
}

export function createJsonBackupV2(options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  if(Number.isNaN(new Date(exportedAt).getTime())) throw new TypeError("The backup export timestamp is invalid.");
  const sourceCollections = options.collections || {};
  const collections = {};
  const collectionCounts = {};
  for(const name of JSON_BACKUP_COLLECTIONS) {
    const records = Array.isArray(sourceCollections[name]) ? sourceCollections[name] : [];
    collections[name] = records
      .map((record, index) => safeRecord(record, name, index))
      .sort((left, right) => left.id.localeCompare(right.id));
    collectionCounts[name] = collections[name].length;
  }
  const account = encodeJsonBackupValue(selectJsonBackupAccountSettings(options.account));
  return {
    app: JSON_BACKUP_APP,
    schemaVersion: JSON_BACKUP_SCHEMA_VERSION,
    exportedAt,
    manifest: {
      codecVersion: JSON_BACKUP_CODEC_VERSION,
      collectionCounts,
      accountFields: Object.keys(account).sort(),
      storageBinariesIncluded: false,
      omissions: JSON_BACKUP_OMISSIONS.map(item => item.id)
    },
    account,
    collections
  };
}

function addError(errors, condition, message) {
  if(!condition) errors.push(message);
}

function validateRelationships(collections, errors) {
  const ids = name => new Set((collections[name] || []).map(record => record.id));
  const projects = ids("projects");
  const customers = ids("customers");
  const clients = ids("clients");
  const bankAccounts = ids("bankAccounts");
  const bankTransactions = ids("bankTransactions");
  const decoded = name => (collections[name] || []).map(record => ({
    id: record.id,
    data: decodeJsonBackupValue(record.data, { path: `collections.${name}.${record.id}.data` })
  }));

  for(const name of ["invoices", "bills", "expenses", "mileage", "budgets", "bankIncome"]) {
    for(const record of decoded(name)) {
      const projectId = String(record.data.projectId || "");
      if(projectId && !projects.has(projectId)) errors.push(`${name}/${record.id} references missing project ${projectId}.`);
      const settlementId = String(record.data.bankSettlement?.transactionId || "");
      if(settlementId && !bankTransactions.has(settlementId)) errors.push(`${name}/${record.id} references missing bank transaction ${settlementId}.`);
    }
  }
  for(const record of decoded("projects")) {
    const customerId = String(record.data.customerId || "");
    if(customerId && !customers.has(customerId) && !clients.has(customerId)) {
      errors.push(`projects/${record.id} references missing client or customer ${customerId}.`);
    }
  }
  for(const name of ["bankTransactions", "bankIncome", "bankReconciliations", "bankExceptionResolutions"]) {
    for(const record of decoded(name)) {
      const bankAccountId = String(record.data.bankAccountId || "");
      if(bankAccountId && !bankAccounts.has(bankAccountId)) errors.push(`${name}/${record.id} references missing bank account ${bankAccountId}.`);
    }
  }
  for(const name of ["bankTransfers", "bankTransferLinks"]) {
    for(const record of decoded(name)) {
      for(const field of ["sourceBankAccountId", "destinationBankAccountId"]) {
        const bankAccountId = String(record.data[field] || "");
        if(bankAccountId && !bankAccounts.has(bankAccountId)) errors.push(`${name}/${record.id} references missing bank account ${bankAccountId}.`);
      }
    }
  }
  const matchedCollections = {
    invoice:"invoices",
    bill:"bills",
    expense:"expenses",
    bankIncome:"bankIncome",
    bankTransfer:"bankTransfers",
    bankException:"bankExceptionResolutions"
  };
  for(const record of decoded("bankTransactions")) {
    const type = String(record.data.matchedRecordType || "");
    const matchedId = String(record.data.matchedRecordId || "");
    const targetCollection = matchedCollections[type];
    if(record.data.status === "matched" && targetCollection && matchedId && !ids(targetCollection).has(matchedId)) {
      errors.push(`bankTransactions/${record.id} references missing ${targetCollection} record ${matchedId}.`);
    }
  }
  for(const name of ["bankIncome", "bankExceptionResolutions"]) {
    for(const record of decoded(name)) {
      const transactionId = String(record.data.bankTransactionId || "");
      if(transactionId && !bankTransactions.has(transactionId)) errors.push(`${name}/${record.id} references missing bank transaction ${transactionId}.`);
    }
  }
  const sourceIds = { invoice:ids("invoices"),bill:ids("bills") };
  for(const record of decoded("referenceKeys")) {
    const type = String(record.data.recordType || "");
    const sourceId = String(record.data.sourceId || "");
    if(record.data.state === "active" && sourceIds[type] && sourceId && !sourceIds[type].has(sourceId)) {
      errors.push(`referenceKeys/${record.id} references missing ${type} record ${sourceId}.`);
    }
  }
}

export function preflightJsonBackupV2(backup) {
  const errors = [];
  addError(errors, plainObject(backup), "Backup root must be a JSON object.");
  if(errors.length) throw new JsonBackupValidationError(errors);
  const rootFields = new Set(["app", "schemaVersion", "exportedAt", "manifest", "account", "collections"]);
  for(const field of Object.keys(backup)) {
    if(!rootFields.has(field)) errors.push(`Unknown top-level backup field: ${field}.`);
  }
  addError(errors, backup.app === JSON_BACKUP_APP, `Backup app must be ${JSON_BACKUP_APP}.`);
  addError(errors, backup.schemaVersion === JSON_BACKUP_SCHEMA_VERSION, `Only schema version ${JSON_BACKUP_SCHEMA_VERSION} is supported.`);
  addError(errors, typeof backup.exportedAt === "string" && !Number.isNaN(new Date(backup.exportedAt).getTime()), "Backup exportedAt must be a valid date-time string.");
  addError(errors, plainObject(backup.manifest), "Backup manifest is missing or invalid.");
  addError(errors, plainObject(backup.account), "Backup account settings must be an object.");
  addError(errors, plainObject(backup.collections), "Backup collections must be an object.");
  if(errors.length) throw new JsonBackupValidationError(errors);

  const manifest = backup.manifest;
  const manifestFields = new Set(["codecVersion", "collectionCounts", "accountFields", "storageBinariesIncluded", "omissions"]);
  for(const field of Object.keys(manifest)) {
    if(!manifestFields.has(field)) errors.push(`Unknown backup manifest field: ${field}.`);
  }
  addError(errors, manifest.codecVersion === JSON_BACKUP_CODEC_VERSION, `Backup codec version must be ${JSON_BACKUP_CODEC_VERSION}.`);
  addError(errors, manifest.storageBinariesIncluded === false, "V2 JSON backups must declare Storage binaries as excluded.");
  addError(errors, plainObject(manifest.collectionCounts), "Manifest collectionCounts must be an object.");
  addError(errors, Array.isArray(manifest.accountFields), "Manifest accountFields must be an array.");
  addError(errors, Array.isArray(manifest.omissions), "Manifest omissions must be an array.");
  if(errors.length) throw new JsonBackupValidationError(errors);

  const allowed = new Set(JSON_BACKUP_COLLECTIONS);
  for(const name of Object.keys(backup.collections)) {
    if(!allowed.has(name)) errors.push(`Unknown backup collection: ${name}.`);
  }
  for(const name of Object.keys(manifest.collectionCounts)) {
    if(!allowed.has(name)) errors.push(`Unknown manifest collection: ${name}.`);
  }
  for(const name of JSON_BACKUP_COLLECTIONS) {
    const records = backup.collections[name];
    if(!Array.isArray(records)) {
      errors.push(`Collection ${name} must be an array.`);
      continue;
    }
    const seen = new Set();
    records.forEach((record, index) => {
      const path = `collections.${name}[${index}]`;
      if(!plainObject(record) || Object.keys(record).some(key => !["id", "data"].includes(key)) ||
        typeof record.id !== "string" || !record.id || record.id.includes("/") || !plainObject(record.data)) {
        errors.push(`${path} must have the shape {id, data}.`);
        return;
      }
      if(seen.has(record.id)) errors.push(`Collection ${name} contains duplicate document ID ${record.id}.`);
      seen.add(record.id);
      try { decodeJsonBackupValue(record.data, { path: `${path}.data` }); }
      catch(error) { errors.push(...(error.errors || [error.message])); }
    });
    if(manifest.collectionCounts[name] !== records.length) {
      errors.push(`Manifest count for ${name} does not match its records.`);
    }
  }

  const accountKeys = Object.keys(backup.account).sort();
  for(const field of accountKeys) {
    if(!JSON_BACKUP_ACCOUNT_FIELDS.includes(field)) errors.push(`Unknown or unsafe account setting: ${field}.`);
  }
  const declaredAccountFields = [...manifest.accountFields].sort();
  if(JSON.stringify(declaredAccountFields) !== JSON.stringify(accountKeys)) errors.push("Manifest accountFields does not match the account settings present.");
  try { decodeJsonBackupValue(backup.account, { path: "account" }); }
  catch(error) { errors.push(...(error.errors || [error.message])); }

  const expectedOmissions = JSON_BACKUP_OMISSIONS.map(item => item.id).sort();
  const actualOmissions = [...manifest.omissions].sort();
  if(JSON.stringify(actualOmissions) !== JSON.stringify(expectedOmissions)) errors.push("Manifest omissions do not match the V2 schema.");
  if(!errors.length) validateRelationships(backup.collections, errors);
  if(errors.length) throw new JsonBackupValidationError(errors);

  const totalRecords = JSON_BACKUP_COLLECTIONS.reduce((total, name) => total + backup.collections[name].length, 0);
  return Object.freeze({
    valid: true,
    app: backup.app,
    schemaVersion: backup.schemaVersion,
    exportedAt: backup.exportedAt,
    collectionCounts: Object.freeze({ ...manifest.collectionCounts }),
    totalRecords,
    accountFields: Object.freeze([...accountKeys]),
    omissions: Object.freeze(JSON_BACKUP_OMISSIONS.map(item => Object.freeze({ ...item })))
  });
}

export function backupAccountStateFromCounts(collectionCounts = {}) {
  const counts = {};
  let totalRecords = 0;
  for(const name of JSON_BACKUP_COLLECTIONS) {
    const count = Number(collectionCounts[name] || 0);
    if(!Number.isInteger(count) || count < 0) throw new TypeError(`Invalid current-account count for ${name}.`);
    counts[name] = count;
    totalRecords += count;
  }
  return Object.freeze({
    empty: totalRecords === 0,
    totalRecords,
    collectionCounts: Object.freeze(counts)
  });
}
