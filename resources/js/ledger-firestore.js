import {
  createBillJournal,
  createExpenseJournal,
  createMileageJournal,
  createSalesInvoiceJournal,
  validateJournal
} from "./ledger-engine.js";

function requiredIdentifier(value, label) {
  const identifier = String(value ?? "").trim();
  if (!identifier) throw new Error(`${label} is required.`);
  return identifier;
}

function sourcePrefix(sourceType) {
  if (sourceType === "salesInvoice") return "invoice";
  if (sourceType === "supplierBill") return "bill";
  if (sourceType === "expenseClaim") return "expense";
  if (sourceType === "mileageClaim") return "mileage";
  return String(sourceType || "source");
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

export function billJournalDocumentId(userId, billId) {
  return journalDocumentId(userId, "supplierBill", billId);
}

export function expenseJournalDocumentId(userId, expenseId) {
  return journalDocumentId(userId, "expenseClaim", expenseId);
}

export function mileageJournalDocumentId(userId, mileageId) {
  return journalDocumentId(userId, "mileageClaim", mileageId);
}

export function isMileageExpenseRecord(expenseData) {
  return String(expenseData?.type || "").trim().toLowerCase() === "mileage";
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

function prepareSourceJournal({
  userId,
  sourceId,
  sourceLabel,
  sourceNumber,
  journalId,
  journal,
  timestamps
}) {
  const owner = requiredIdentifier(userId, "User ID");
  requiredIdentifier(sourceId, `${sourceLabel} ID`);
  const validation = validateJournal(journal);

  if (!validation.valid) {
    throw new Error(`Invalid ${sourceLabel.toLowerCase()} journal: ${validation.errors.join(" ")}`);
  }

  return serialiseJournalForFirestore(journal, {
    userId: owner,
    journalId,
    sourceNumber: sourceNumber || "",
    createdAt: timestamps.createdAt || "",
    updatedAt: timestamps.updatedAt || ""
  });
}

export function prepareInvoiceJournal(userId, invoiceId, invoiceData, timestamps = {}) {
  const owner = requiredIdentifier(userId, "User ID");
  const sourceId = requiredIdentifier(invoiceId, "Invoice ID");
  const journalId = invoiceJournalDocumentId(owner, sourceId);
  const journal = createSalesInvoiceJournal({ ...invoiceData, id: sourceId });

  return prepareSourceJournal({
    userId: owner,
    sourceId,
    sourceLabel: "Invoice",
    sourceNumber: invoiceData?.invoiceNo,
    journalId,
    journal,
    timestamps
  });
}

export function prepareBillJournal(userId, billId, billData, timestamps = {}) {
  const owner = requiredIdentifier(userId, "User ID");
  const sourceId = requiredIdentifier(billId, "Bill ID");
  const journalId = billJournalDocumentId(owner, sourceId);
  const journal = createBillJournal({ ...billData, id: sourceId });

  return prepareSourceJournal({
    userId: owner,
    sourceId,
    sourceLabel: "Bill",
    sourceNumber: billData?.billNumber,
    journalId,
    journal,
    timestamps
  });
}

export function prepareExpenseJournal(userId, expenseId, expenseData, timestamps = {}) {
  const owner = requiredIdentifier(userId, "User ID");
  const sourceId = requiredIdentifier(expenseId, "Expense ID");

  if (isMileageExpenseRecord(expenseData)) {
    throw new Error("Mileage records are not eligible for expense journal persistence.");
  }

  const journalId = expenseJournalDocumentId(owner, sourceId);
  const journal = createExpenseJournal({ ...expenseData, id: sourceId });

  return prepareSourceJournal({
    userId: owner,
    sourceId,
    sourceLabel: "Expense",
    sourceNumber: expenseData?.expenseNumber || expenseData?.reference || sourceId,
    journalId,
    journal,
    timestamps
  });
}

export function prepareMileageJournal(userId, mileageId, mileageData, timestamps = {}) {
  const owner = requiredIdentifier(userId, "User ID");
  const sourceId = requiredIdentifier(mileageId, "Mileage ID");

  if (!isMileageExpenseRecord(mileageData)) {
    throw new Error("Only mileage records are eligible for mileage journal persistence.");
  }

  const journalId = mileageJournalDocumentId(owner, sourceId);
  const journal = createMileageJournal({ ...mileageData, id: sourceId });

  return prepareSourceJournal({
    userId: owner,
    sourceId,
    sourceLabel: "Mileage",
    sourceNumber: mileageData?.reference || sourceId,
    journalId,
    journal,
    timestamps
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
  return replaceSourceJournal(
    db,
    userId,
    invoiceId,
    invoiceData,
    firestoreApi,
    options,
    {
      documentId: invoiceJournalDocumentId(userId, invoiceId),
      prepare: prepareInvoiceJournal
    }
  );
}

async function replaceSourceJournal(
  db,
  userId,
  sourceId,
  sourceData,
  firestoreApi,
  options,
  sourceAdapter
) {
  requireFirestoreWriteApi(firestoreApi);
  const documentId = sourceAdapter.documentId;
  const reference = firestoreApi.doc(db, "journals", documentId);
  const existingSnapshot = await firestoreApi.getDoc(reference);
  const existingData = documentExists(existingSnapshot) ? existingSnapshot.data() : null;
  const now = typeof options.now === "function"
    ? options.now()
    : new Date().toISOString();
  const journalData = sourceAdapter.prepare(userId, sourceId, sourceData, {
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

export async function replaceBillJournal(
  db,
  userId,
  billId,
  billData,
  firestoreApi,
  options = {}
) {
  return replaceSourceJournal(
    db,
    userId,
    billId,
    billData,
    firestoreApi,
    options,
    {
      documentId: billJournalDocumentId(userId, billId),
      prepare: prepareBillJournal
    }
  );
}

export async function saveBillJournal(
  db,
  userId,
  billId,
  billData,
  firestoreApi,
  options = {}
) {
  return replaceBillJournal(
    db,
    userId,
    billId,
    billData,
    firestoreApi,
    options
  );
}

export async function replaceExpenseJournal(
  db,
  userId,
  expenseId,
  expenseData,
  firestoreApi,
  options = {}
) {
  if (isMileageExpenseRecord(expenseData)) {
    return {
      documentId: null,
      journal: null,
      replaced: false,
      skipped: true,
      reason: "mileage"
    };
  }

  return replaceSourceJournal(
    db,
    userId,
    expenseId,
    expenseData,
    firestoreApi,
    options,
    {
      documentId: expenseJournalDocumentId(userId, expenseId),
      prepare: prepareExpenseJournal
    }
  );
}

export async function saveExpenseJournal(
  db,
  userId,
  expenseId,
  expenseData,
  firestoreApi,
  options = {}
) {
  return replaceExpenseJournal(
    db,
    userId,
    expenseId,
    expenseData,
    firestoreApi,
    options
  );
}

export async function replaceMileageJournal(
  db,
  userId,
  mileageId,
  mileageData,
  firestoreApi,
  options = {}
) {
  if (!isMileageExpenseRecord(mileageData)) {
    return {
      documentId: null,
      journal: null,
      replaced: false,
      skipped: true,
      reason: "ordinaryExpense"
    };
  }

  return replaceSourceJournal(
    db,
    userId,
    mileageId,
    mileageData,
    firestoreApi,
    options,
    {
      documentId: mileageJournalDocumentId(userId, mileageId),
      prepare: prepareMileageJournal
    }
  );
}

export async function saveMileageJournal(
  db,
  userId,
  mileageId,
  mileageData,
  firestoreApi,
  options = {}
) {
  return replaceMileageJournal(
    db,
    userId,
    mileageId,
    mileageData,
    firestoreApi,
    options
  );
}
