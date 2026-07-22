import {
  createSalesInvoiceJournal,
  validateJournal
} from "./ledger-engine.js";

function requiredIdentifier(value, label) {
  const identifier = String(value ?? "").trim();
  if (!identifier) throw new Error(`${label} is required.`);
  return identifier;
}

function sourcePrefix(sourceType) {
  return sourceType === "salesInvoice" ? "invoice" : String(sourceType || "source");
}

function safeIdPart(value) {
  return encodeURIComponent(value);
}

export function journalDocumentId(userId, sourceType, sourceId) {
  const owner = requiredIdentifier(userId, "User ID");
  const source = requiredIdentifier(sourceId, "Source ID");
  const type = requiredIdentifier(sourceType, "Source type");

  return `${safeIdPart(sourcePrefix(type))}_${safeIdPart(owner)}_${safeIdPart(source)}`;
}

export function invoiceJournalDocumentId(userId, invoiceId) {
  return journalDocumentId(userId, "salesInvoice", invoiceId);
}

export function toFirestoreSafeObject(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid Date values cannot be stored.");
    return value.toISOString();
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Non-finite numbers cannot be stored in a journal.");
  }

  if (Array.isArray(value)) {
    return value
      .map(item => toFirestoreSafeObject(item))
      .filter(item => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toFirestoreSafeObject(item)])
        .filter(([, item]) => item !== undefined)
    );
  }

  return value;
}

export function serialiseJournalForFirestore(journal, metadata) {
  const validation = validateJournal(journal);
  if (!validation.valid) {
    throw new Error(`Invalid journal cannot be stored: ${validation.errors.join(" ")}`);
  }

  const userId = requiredIdentifier(metadata?.userId, "User ID");
  const journalId = requiredIdentifier(metadata?.journalId, "Journal ID");

  return toFirestoreSafeObject({
    userId,
    journalId,
    date: journal.date,
    sourceType: journal.sourceType,
    sourceId: journal.sourceId,
    sourceNumber: metadata?.sourceNumber || "",
    description: journal.description,
    createdAt: metadata?.createdAt || "",
    updatedAt: metadata?.updatedAt || "",
    reversedJournalId: journal.reversesJournalId || "",
    lines: journal.lines.map(line => ({
      accountCode: line.accountCode,
      description: line.description,
      debit: line.debit,
      credit: line.credit
    }))
  });
}

export function prepareInvoiceJournal(userId, invoiceId, invoiceData, timestamps = {}) {
  const owner = requiredIdentifier(userId, "User ID");
  const sourceId = requiredIdentifier(invoiceId, "Invoice ID");
  const journalId = invoiceJournalDocumentId(owner, sourceId);
  const journal = createSalesInvoiceJournal({
    ...invoiceData,
    id: sourceId
  });
  const validation = validateJournal(journal);

  if (!validation.valid) {
    throw new Error(`Invalid invoice journal: ${validation.errors.join(" ")}`);
  }

  return serialiseJournalForFirestore(journal, {
    userId: owner,
    journalId,
    sourceNumber: invoiceData?.invoiceNo || "",
    createdAt: timestamps.createdAt || "",
    updatedAt: timestamps.updatedAt || ""
  });
}

function requireFirestoreReadApi(firestoreApi) {
  if (
    !firestoreApi ||
    typeof firestoreApi.doc !== "function" ||
    typeof firestoreApi.getDoc !== "function"
  ) {
    throw new Error("Firestore document read helpers are required.");
  }
}

function requireFirestoreWriteApi(firestoreApi) {
  requireFirestoreReadApi(firestoreApi);
  if (typeof firestoreApi.setDoc !== "function") {
    throw new Error("Firestore document write helpers are required.");
  }
}

function documentExists(snapshot) {
  return Boolean(snapshot && typeof snapshot.exists === "function" && snapshot.exists());
}

export async function getJournalForSource(
  db,
  userId,
  sourceType,
  sourceId,
  firestoreApi
) {
  requireFirestoreReadApi(firestoreApi);
  const documentId = journalDocumentId(userId, sourceType, sourceId);
  const reference = firestoreApi.doc(db, "journals", documentId);
  const snapshot = await firestoreApi.getDoc(reference);

  if (!documentExists(snapshot)) return null;
  return { id: documentId, ...snapshot.data() };
}

export async function hasJournalForSourceInFirestore(
  db,
  userId,
  sourceType,
  sourceId,
  firestoreApi
) {
  return Boolean(
    await getJournalForSource(db, userId, sourceType, sourceId, firestoreApi)
  );
}

export async function replaceInvoiceJournal(
  db,
  userId,
  invoiceId,
  invoiceData,
  firestoreApi,
  options = {}
) {
  requireFirestoreWriteApi(firestoreApi);
  const documentId = invoiceJournalDocumentId(userId, invoiceId);
  const reference = firestoreApi.doc(db, "journals", documentId);
  const existingSnapshot = await firestoreApi.getDoc(reference);
  const existingData = documentExists(existingSnapshot) ? existingSnapshot.data() : null;
  const now = typeof options.now === "function"
    ? options.now()
    : new Date().toISOString();
  const journalData = prepareInvoiceJournal(userId, invoiceId, invoiceData, {
    createdAt: existingData?.createdAt || now,
    updatedAt: now
  });

  await firestoreApi.setDoc(reference, journalData);

  return {
    documentId,
    journal: journalData,
    replaced: Boolean(existingData)
  };
}

export async function saveInvoiceJournal(
  db,
  userId,
  invoiceId,
  invoiceData,
  firestoreApi,
  options = {}
) {
  return replaceInvoiceJournal(
    db,
    userId,
    invoiceId,
    invoiceData,
    firestoreApi,
    options
  );
}
