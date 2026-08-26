import {
  createFirestorePhase4APersistence,
  executePhase4A,
  planPhase4AExecution
} from "./canonical-workbook-phase4a.js";
import { isTrustedWorkbookPreflightResult } from "./canonical-workbook-preflight.js";
import {
  expenseJournalDocumentId,
  mileageJournalDocumentId,
  prepareBillJournal,
  prepareExpenseJournal,
  prepareInvoiceJournal,
  prepareMileageJournal
} from "./ledger-firestore.js";

export const PHASE4B_MODULE_ORDER = Object.freeze([
  "clients", "projects", "budgets", "invoices", "bills", "expenses", "mileage"
]);

const ACCOUNTING_MODULES = Object.freeze(["invoices", "bills", "expenses", "mileage"]);
const JOURNAL_SOURCE_TYPES = Object.freeze({
  invoices: "salesInvoice",
  bills: "supplierBill",
  expenses: "expenseClaim",
  mileage: "mileageClaim"
});
const LEGACY_INVOICE_WARNING_CODES = new Set([
  "legacy-invoice-item-created", "legacy-invoice-item-synthesized"
]);

function text(value) {
  return String(value ?? "").trim();
}

function identity(value) {
  return text(value).toLocaleLowerCase("en-GB");
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sourceOf(record, fallbackSheet) {
  return {
    sheet: text(record?.source?.sheet) || fallbackSheet,
    row: Number(record?.source?.row) || 0
  };
}

function problem(code, module, record, message, details = {}) {
  return { code, module, ...sourceOf(record, module), message, ...details };
}

function requireService(source, name, label = "Phase 4B persistence") {
  if(typeof source?.[name] !== "function"){
    throw new TypeError(`${label} requires ${name}().`);
  }
  return source[name];
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map(documentSnapshot => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data()
  }));
}

function callableData(response) {
  return response && typeof response === "object" && "data" in response
    ? response.data
    : response;
}

async function protectedCreate(callable, request) {
  try{
    return await callable(request);
  }catch(error){
    if(!["functions/unavailable", "functions/deadline-exceeded"].includes(error?.code)) throw error;
    return callable(request);
  }
}

function randomRequestId(services) {
  if(typeof services.createRequestId === "function") return services.createRequestId();
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("A UUID request ID provider is required for accounting source creation.");
}

function timestamp(services) {
  return typeof services.now === "function"
    ? services.now()
    : new Date().toISOString();
}

async function createExpenseUnit({ services, user, payload, mileage }) {
  const collection = requireService(services, "collection", "Firestore Phase 4B persistence");
  const doc = requireService(services, "doc", "Firestore Phase 4B persistence");
  const runTransaction = requireService(services, "runTransaction", "Firestore Phase 4B persistence");
  const sourceReference = doc(collection(services.db, "users", user.uid, "expenses"));
  const sourceId = text(sourceReference.id);
  if(!sourceId) throw new Error("Firestore did not allocate an expense document ID.");
  const createdAt = timestamp(services);
  const source = {
    ...payload,
    id: sourceId,
    createdAt,
    updatedAt: ""
  };
  const journalId = mileage
    ? mileageJournalDocumentId(user.uid, sourceId)
    : expenseJournalDocumentId(user.uid, sourceId);
  const journalReference = doc(services.db, "journals", journalId);
  const journal = mileage
    ? prepareMileageJournal(user.uid, sourceId, source, { createdAt, updatedAt: createdAt })
    : prepareExpenseJournal(user.uid, sourceId, source, { createdAt, updatedAt: createdAt });

  await runTransaction(services.db, async transaction => {
    const [sourceSnapshot, journalSnapshot] = await Promise.all([
      transaction.get(sourceReference), transaction.get(journalReference)
    ]);
    if(sourceSnapshot.exists() || journalSnapshot.exists()){
      throw new Error("The allocated accounting source or journal already exists.");
    }
    transaction.set(sourceReference, source);
    transaction.set(journalReference, journal);
  });
  return { id: sourceId, journalId, status: "created" };
}

export function createFirestorePhase4BPersistence({ services, user, callables = {} }) {
  if(!user?.uid) throw new TypeError("Firestore Phase 4B persistence requires an authenticated user.");
  const base = createFirestorePhase4APersistence({ services, user });
  const collection = requireService(services, "collection", "Firestore Phase 4B persistence");
  const doc = requireService(services, "doc", "Firestore Phase 4B persistence");
  const getDocs = requireService(services, "getDocs", "Firestore Phase 4B persistence");
  const query = requireService(services, "query", "Firestore Phase 4B persistence");
  const where = requireService(services, "where", "Firestore Phase 4B persistence");
  const createInvoice = requireService(
    callables,
    "createInvoiceWithReference",
    "Firestore Phase 4B persistence callables"
  );
  const createBill = requireService(
    callables,
    "createBillWithReference",
    "Firestore Phase 4B persistence callables"
  );
  const userCollection = name => collection(services.db, "users", user.uid, name);
  let lastBillId = 0;

  return Object.freeze({
    ...base,
    async readExecutionContext() {
      const [baseContext, invoices, bills, claims, journals] = await Promise.all([
        base.readExecutionContext(),
        getDocs(userCollection("invoices")),
        getDocs(userCollection("bills")),
        getDocs(userCollection("expenses")),
        getDocs(query(
          collection(services.db, "journals"),
          where("userId", "==", user.uid)
        ))
      ]);
      const expenseRecords = snapshotRecords(claims);
      return {
        ...baseContext,
        invoices: snapshotRecords(invoices),
        bills: snapshotRecords(bills),
        expenses: expenseRecords.filter(record => identity(record.type) !== "mileage"),
        mileage: expenseRecords.filter(record => identity(record.type) === "mileage"),
        journals: snapshotRecords(journals)
      };
    },
    async createInvoiceAccounting(payload) {
      if(text(payload?.status) !== "Unpaid"){
        throw new Error("Canonical Paid Invoice creation requires payment or Banking settlement history.");
      }
      const sourceId = text(doc(userCollection("invoices")).id);
      const request = {
        sourceId,
        payload,
        requestId: randomRequestId(services)
      };
      const response = callableData(await protectedCreate(createInvoice, request));
      return {
        id: sourceId,
        journalId: text(response?.journalId),
        status: text(response?.status) || "created"
      };
    },
    async createBillAccounting(payload) {
      if(text(payload?.status) !== "Unpaid"){
        throw new Error("Canonical Paid Bill creation requires payment or Banking settlement history.");
      }
      const candidate = typeof services.nextBillId === "function"
        ? Number(services.nextBillId())
        : Date.now();
      const numericId = Math.max(candidate, lastBillId + 1);
      if(!Number.isSafeInteger(numericId) || numericId <= 0){
        throw new Error("A valid numeric Bill ID could not be allocated.");
      }
      lastBillId = numericId;
      const sourceId = String(numericId);
      const request = {
        sourceId,
        payload: { ...payload, id: numericId },
        requestId: randomRequestId(services)
      };
      const response = callableData(await protectedCreate(createBill, request));
      return {
        id: sourceId,
        journalId: text(response?.journalId),
        status: text(response?.status) || "created"
      };
    },
    createExpenseAccounting(payload) {
      return createExpenseUnit({ services, user, payload, mileage: false });
    },
    createMileageAccounting(payload) {
      return createExpenseUnit({ services, user, payload, mileage: true });
    }
  });
}

function normalizeDate(value) {
  const input = text(value);
  let match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return input;
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      lineNumber: Number(item.lineNumber ?? index + 1),
      description: text(item.description),
      amount: roundMoney(item.amount ?? item.netAmount ?? 0)
    }))
    .filter(item => item.description && item.amount > 0)
    .sort((left, right) => left.lineNumber - right.lineNumber);
}

function stable(value) {
  if(Array.isArray(value)) return value.map(stable);
  if(value && typeof value === "object"){
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  if(typeof right === "number") return Number(left) === right;
  if(Array.isArray(right)) return JSON.stringify(stable(left || [])) === JSON.stringify(stable(right));
  return text(left) === text(right);
}

function materialDifference(existing, desired, fields) {
  return fields.some(field => !sameValue(existing[field], desired[field]));
}

function normalizedExistingInvoice(record) {
  return {
    ...record,
    id: text(record.id),
    invoiceNo: text(record.invoiceNo ?? record.invoiceNumber),
    invoiceNoKey: identity(record.invoiceNo ?? record.invoiceNumber),
    client: text(record.client ?? record.clientName),
    clientKey: identity(record.client ?? record.clientName),
    date: normalizeDate(record.date ?? record.invoiceDate),
    paymentTerms: text(record.paymentTerms),
    dueDate: normalizeDate(record.dueDate),
    amount: roundMoney(record.amount ?? record.net ?? 0),
    vatRate: record.vatRate === undefined ? null : Number(record.vatRate),
    vat: roundMoney(record.vat ?? 0),
    total: roundMoney(record.total ?? 0),
    status: text(record.status) || "Unpaid",
    recurringInvoice: text(record.recurringInvoice ?? record.recurring) || "No",
    recurringFrequency: text(record.recurringFrequency),
    nextInvoiceDate: normalizeDate(record.nextInvoiceDate),
    reminderDate: normalizeDate(record.reminderDate),
    projectReference: text(record.projectReference),
    projectReferenceKey: identity(record.projectReference),
    items: normalizeItems(record.items)
  };
}

function normalizedExistingBill(record) {
  return {
    ...record,
    id: text(record.id),
    supplier: text(record.supplier),
    supplierKey: identity(record.supplier),
    billNumber: text(record.billNumber),
    billNumberKey: identity(record.billNumber),
    billDate: normalizeDate(record.billDate ?? record.date),
    dueDate: normalizeDate(record.dueDate),
    category: text(record.category),
    projectReference: text(record.projectReference),
    projectReferenceKey: identity(record.projectReference),
    net: roundMoney(record.net ?? 0),
    vatRate: Number(record.vatRate ?? 0),
    vat: roundMoney(record.vat ?? 0),
    total: roundMoney(record.total ?? 0),
    status: text(record.status) || "Unpaid",
    notes: text(record.notes)
  };
}

function normalizedExistingExpense(record, mileage) {
  return mileage ? {
    ...record,
    id: text(record.id),
    type: "mileage",
    date: normalizeDate(record.date),
    from: text(record.from),
    fromKey: identity(record.from),
    to: text(record.to),
    toKey: identity(record.to),
    businessPurpose: text(record.businessPurpose),
    projectReference: text(record.projectReference),
    projectReferenceKey: identity(record.projectReference),
    miles: Number(record.miles),
    ratePerMile: Number(record.ratePerMile),
    amount: roundMoney(record.amount ?? record.gross ?? 0),
    status: text(record.status) || "Draft",
    notes: text(record.notes)
  } : {
    ...record,
    id: text(record.id),
    type: "expense",
    date: normalizeDate(record.date),
    merchant: text(record.merchant),
    merchantKey: identity(record.merchant),
    category: text(record.category),
    description: text(record.description),
    projectReference: text(record.projectReference),
    projectReferenceKey: identity(record.projectReference),
    net: roundMoney(record.net ?? 0),
    vatRate: Number(record.vatRate ?? 0),
    vat: roundMoney(record.vat ?? 0),
    gross: roundMoney(record.gross ?? 0),
    status: text(record.status) || "Draft",
    notes: text(record.notes)
  };
}

function billKey(record) {
  const number = identity(record.billNumber);
  if(number) return `number:${number}`;
  const supplier = identity(record.supplier);
  const date = normalizeDate(record.billDate);
  const total = Number(record.total);
  return supplier && date && Number.isFinite(total)
    ? `fallback:${supplier}|${date}|${roundMoney(total).toFixed(2)}`
    : "";
}

function expenseKey(record) {
  const merchant = identity(record.merchant);
  return merchant && record.date && Number.isFinite(Number(record.gross))
    ? `${normalizeDate(record.date)}|${merchant}|${roundMoney(record.gross).toFixed(2)}`
    : "";
}

function mileageKey(record) {
  return record.date && record.from && record.to && Number.isFinite(Number(record.miles))
    ? `${normalizeDate(record.date)}|${identity(record.from)}|${identity(record.to)}|${Number(record.miles).toFixed(1)}`
    : "";
}

function projectPayload(record) {
  return {
    projectId: text(record?.id),
    projectName: text(record?.name ?? record?.projectName),
    projectReference: text(record?.reference ?? record?.projectReference)
  };
}

function clientPayload(record, client) {
  return {
    client: text(record.clientName),
    clientEmail: text(client?.email),
    clientAddress: text(client?.address)
  };
}

function combinedClient(context, clientKey, resolved) {
  if(!resolved) return null;
  const customer = (context.customers || []).find(record =>
    identity(record.name ?? record.clientName) === clientKey ||
    (resolved.email && identity(record.email) === identity(resolved.email))
  );
  return customer ? {
    ...customer,
    ...resolved,
    email: text(resolved.email || customer.email),
    address: text(customer.address || resolved.address),
    paymentTerms: text(customer.paymentTerms || resolved.paymentTerms)
  } : resolved;
}

function invoicePayload(record, items, client, project) {
  return {
    invoiceNo: text(record.invoiceNumber),
    ...clientPayload(record, client),
    paymentTerms: text(record.paymentTerms),
    dueDate: normalizeDate(record.dueDate),
    amount: roundMoney(record.net),
    vatRate: Number(record.vatRate ?? 0),
    vat: roundMoney(record.vat),
    total: roundMoney(record.total),
    items: normalizeItems(items).map(item => ({
      description: item.description,
      amount: item.amount
    })),
    status: text(record.status) || "Unpaid",
    date: normalizeDate(record.invoiceDate),
    recurringInvoice: text(record.recurring) || "No",
    recurringFrequency: text(record.recurringFrequency),
    nextInvoiceDate: normalizeDate(record.nextInvoiceDate),
    reminderDate: normalizeDate(record.reminderDate),
    ...projectPayload(project)
  };
}

function billPayload(record, project) {
  return {
    supplier: text(record.supplier),
    billNumber: text(record.billNumber),
    billDate: normalizeDate(record.billDate),
    dueDate: normalizeDate(record.dueDate),
    category: text(record.category) || "General",
    net: roundMoney(record.net),
    vatRate: Number(record.vatRate ?? 0),
    vat: roundMoney(record.vat),
    total: roundMoney(record.total),
    status: text(record.status) || "Unpaid",
    notes: text(record.notes),
    ...projectPayload(project),
    attachmentName: "",
    attachmentUrl: "",
    attachmentPath: "",
    attachmentSize: 0,
    attachmentType: ""
  };
}

function expensePayload(record, project) {
  return {
    type: "expense",
    date: normalizeDate(record.date),
    merchant: text(record.merchant),
    category: text(record.category) || "General",
    description: text(record.description),
    from: "",
    to: "",
    businessPurpose: "",
    miles: 0,
    ratePerMile: 0,
    amount: 0,
    net: roundMoney(record.net),
    vatRate: Number(record.vatRate ?? 0),
    vat: roundMoney(record.vat),
    gross: roundMoney(record.gross),
    status: text(record.status) || "Draft",
    notes: text(record.notes),
    ...projectPayload(project),
    attachmentName: "",
    attachmentUrl: "",
    attachmentPath: "",
    attachmentSize: 0,
    attachmentType: ""
  };
}

function mileagePayload(record, project) {
  return {
    type: "mileage",
    date: normalizeDate(record.date),
    merchant: "",
    category: "Mileage",
    description: "",
    from: text(record.from),
    to: text(record.to),
    businessPurpose: text(record.businessPurpose),
    miles: Number(record.miles),
    ratePerMile: Number(record.ratePerMile),
    amount: roundMoney(record.amount),
    net: 0,
    vatRate: 0,
    vat: 0,
    gross: roundMoney(record.amount),
    status: text(record.status) || "Draft",
    notes: text(record.notes),
    ...projectPayload(project),
    attachmentName: "",
    attachmentUrl: "",
    attachmentPath: "",
    attachmentSize: 0,
    attachmentType: ""
  };
}

function journalFor(context, moduleName, sourceId) {
  const sourceType = JOURNAL_SOURCE_TYPES[moduleName];
  return (context.journals || []).find(journal =>
    text(journal.sourceType) === sourceType && text(journal.sourceId) === text(sourceId)
  ) || null;
}

function journalContent(journal) {
  return {
    date: text(journal?.date),
    sourceType: text(journal?.sourceType),
    sourceId: text(journal?.sourceId),
    sourceNumber: text(journal?.sourceNumber),
    description: text(journal?.description),
    lines: journal?.lines || []
  };
}

function validLinkedJournal(journal, moduleName, source) {
  const sourceId = text(source?.id);
  if(!journal || text(journal.sourceType) !== JOURNAL_SOURCE_TYPES[moduleName] ||
    text(journal.sourceId) !== text(sourceId) || !Array.isArray(journal.lines) || !journal.lines.length){
    return false;
  }
  const totals = journal.lines.reduce((result, line) => ({
    debit: roundMoney(result.debit + Number(line.debit || 0)),
    credit: roundMoney(result.credit + Number(line.credit || 0))
  }), { debit: 0, credit: 0 });
  if(totals.debit !== totals.credit) return false;
  const prepare = {
    invoices: prepareInvoiceJournal,
    bills: prepareBillJournal,
    expenses: prepareExpenseJournal,
    mileage: prepareMileageJournal
  }[moduleName];
  try{
    const expected = prepare(text(journal.userId) || "journal-owner", sourceId, source, {
      createdAt: journal.createdAt || "",
      updatedAt: journal.updatedAt || journal.createdAt || ""
    });
    return JSON.stringify(stable(journalContent(journal))) ===
      JSON.stringify(stable(journalContent(expected)));
  }catch(_error){
    return false;
  }
}

function validPaidSettlement(context, moduleName, source) {
  if(!["invoices", "bills"].includes(moduleName)) return true;
  const marker = source?.bankSettlement;
  const transactionId = text(marker?.transactionId);
  const journalId = text(marker?.journalId);
  const sourceId = text(source?.id);
  if(Number(marker?.version) !== 1 || !transactionId || !journalId || !sourceId) return false;
  const journal = (context.journals || []).find(candidate =>
    text(candidate.id ?? candidate.journalId) === journalId
  );
  if(!journal || text(journal.sourceType) !== "bankSettlement" ||
    text(journal.sourceId) !== transactionId || text(journal.bankTransactionId) !== transactionId ||
    text(journal.matchedRecordType) !== (moduleName === "invoices" ? "invoice" : "bill") ||
    text(journal.matchedRecordId) !== sourceId || !Array.isArray(journal.lines) || journal.lines.length !== 2){
    return false;
  }
  const amount = roundMoney(source.total);
  const expected = moduleName === "invoices"
    ? [["1000", amount, 0], ["1100", 0, amount]]
    : [["2000", amount, 0], ["1000", 0, amount]];
  return expected.every(([accountCode, debit, credit]) => journal.lines.some(line =>
    text(line.accountCode) === accountCode && roundMoney(line.debit) === debit &&
    roundMoney(line.credit) === credit
  )) && roundMoney(journal.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)) ===
    roundMoney(journal.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
}

function accountingSkipRows(preflight, moduleName) {
  return new Set(preflight.duplicateCandidates
    .filter(candidate => candidate.module === moduleName && candidate.proposedAction === "skip")
    .map(candidate => Number(candidate.row)));
}

function gateErrors(preflight) {
  if(!isTrustedWorkbookPreflightResult(preflight)){
    return [problem("untrusted-preflight", "preflight", null, "Execution requires the original immutable canonical workbook preflight result.")];
  }
  const errors = [];
  if(preflight.safeToProceed !== true || preflight.errors.length || preflight.unresolvedRelationships.length){
    errors.push(problem("unsafe-preflight", "preflight", null, "Phase 4B requires a safe preflight with no validation or relationship errors."));
  }
  const required = [...PHASE4B_MODULE_ORDER, "invoiceItems"];
  if(!preflight.records || !required.every(moduleName => Array.isArray(preflight.records[moduleName]))){
    errors.push(problem("invalid-preflight-contract", "preflight", null, "Preflight does not contain every required Phase 4B record group."));
  }
  return errors;
}

function emptyAccountingPlan(phase4APlan) {
  return {
    eligible: false,
    phase4APlan,
    moduleOrder: [...PHASE4B_MODULE_ORDER],
    operations: { invoices: [], bills: [], expenses: [], mileage: [] },
    skipped: {
      clients: [...(phase4APlan?.skipped?.clients || [])],
      projects: [...(phase4APlan?.skipped?.projects || [])],
      budgets: [...(phase4APlan?.skipped?.budgets || [])],
      invoices: [], bills: [], expenses: [], mileage: []
    },
    conflicts: [...(phase4APlan?.conflicts || [])],
    errors: [...(phase4APlan?.errors || [])]
  };
}

function addExistingDecision(plan, preflight, context, moduleName, record, key, desired, matches, fields) {
  if(matches.length > 1){
    plan.conflicts.push(problem(
      `ambiguous-${moduleName}-match`, moduleName, record,
      `More than one existing ${moduleName.slice(0, -1)} matches the canonical duplicate identity.`
    ));
    return { handled: true };
  }
  const existing = matches[0] || null;
  if(existing){
    if(materialDifference(existing, desired, fields)){
      plan.conflicts.push(problem(
        `${moduleName}-details-conflict`, moduleName, record,
        `An existing ${moduleName.slice(0, -1)} has the same business identity but materially different data; it will not be overwritten.`
      ));
    }else{
      const journal = journalFor(context, moduleName, existing.id);
      if(!validLinkedJournal(journal, moduleName, existing)){
        plan.conflicts.push(problem(
          `${moduleName}-journal-integrity-conflict`, moduleName, record,
          "The matching source does not have its required balanced accounting journal; the existing record will not be altered."
        ));
      }else if(desired.status === "Paid" && !validPaidSettlement(context, moduleName, existing)){
        plan.conflicts.push(problem(
          `${moduleName}-paid-settlement-integrity-conflict`, moduleName, record,
          "The matching Paid source does not have a valid Banking settlement marker and clearing journal; it cannot be treated as a safe imported match."
        ));
      }else{
        plan.skipped[moduleName].push({
          record, reason: "existing-match", existingId: existing.id,
          journalId: text(journal.id ?? journal.journalId)
        });
      }
    }
    return { handled: true, existing };
  }
  if(accountingSkipRows(preflight, moduleName).has(Number(record.source?.row))){
    plan.conflicts.push(problem(
      `stale-${moduleName}-duplicate`, moduleName, record,
      "Preflight marked this record as existing, but the execution-time snapshot no longer contains it. Run preflight again."
    ));
    return { handled: true };
  }
  return { handled: false, key };
}

export function planPhase4BExecution(preflight, executionContext = {}) {
  const phase4APlan = planPhase4AExecution(preflight, executionContext);
  const plan = emptyAccountingPlan(phase4APlan);
  plan.errors.unshift(...gateErrors(preflight));
  if(plan.errors.length || plan.conflicts.length) return plan;

  const currentInvoices = (executionContext.invoices || []).map(normalizedExistingInvoice);
  const currentBills = (executionContext.bills || []).map(normalizedExistingBill);
  const currentExpenses = (executionContext.expenses || []).map(record => normalizedExistingExpense(record, false));
  const currentMileage = (executionContext.mileage || []).map(record => normalizedExistingExpense(record, true));
  const itemsByInvoice = new Map();
  for(const item of preflight.records.invoiceItems){
    const key = identity(item.invoiceNumber);
    const items = itemsByInvoice.get(key) || [];
    items.push(item);
    itemsByInvoice.set(key, items);
  }

  for(const record of preflight.records.invoices){
    const key = identity(record.invoiceNumber);
    const clientKey = identity(record.clientName);
    const projectKey = identity(record.projectReference);
    const resolvedClient = clientKey ? phase4APlan.resolutions.clients.get(clientKey) : null;
    const client = combinedClient(executionContext, clientKey, resolvedClient);
    const project = projectKey ? phase4APlan.resolutions.projects.get(projectKey) : null;
    if(!client){
      plan.errors.push(problem("missing-client-relationship", "invoices", record, "The invoice Client is no longer resolvable at execution time."));
      continue;
    }
    if(projectKey && !project){
      plan.errors.push(problem("missing-project-relationship", "invoices", record, "The invoice Project is no longer resolvable at execution time."));
      continue;
    }
    const items = itemsByInvoice.get(key) || [];
    if(!items.length){
      plan.errors.push(problem("invoice-items-required", "invoices", record, "Every executable invoice requires at least one validated invoice item."));
      continue;
    }
    const desired = normalizedExistingInvoice(invoicePayload(record, items, client, project));
    const matches = currentInvoices.filter(existing => identity(existing.invoiceNo) === key);
    const decision = addExistingDecision(
      plan, preflight, executionContext, "invoices", record, key, desired, matches,
      ["invoiceNoKey", "clientKey", "date", "paymentTerms", "dueDate", "amount", "vat", "total", "status",
        "recurringInvoice", "recurringFrequency", "nextInvoiceDate", "reminderDate", "projectReferenceKey", "items"]
    );
    if(!decision.handled){
      if(desired.status === "Paid"){
        plan.errors.push(problem(
          "paid-accounting-history-required", "invoices", record,
          "A new Paid Invoice cannot be restored safely without its payment or Banking settlement history. No Invoice was created."
        ));
      }else{
        plan.operations.invoices.push({ record, key, clientKey, projectKey, items, client });
      }
    }
  }

  for(const record of preflight.records.bills){
    const projectKey = identity(record.projectReference);
    const project = projectKey ? phase4APlan.resolutions.projects.get(projectKey) : null;
    if(projectKey && !project){
      plan.errors.push(problem("missing-project-relationship", "bills", record, "The Bill Project is no longer resolvable at execution time."));
      continue;
    }
    const desired = normalizedExistingBill(billPayload(record, project));
    const key = billKey(desired);
    const matches = currentBills.filter(existing => billKey(existing) === key);
    const decision = addExistingDecision(
      plan, preflight, executionContext, "bills", record, key, desired, matches,
      ["supplierKey", "billNumberKey", "billDate", "dueDate", "category", "projectReferenceKey", "net", "vatRate", "vat", "total", "status", "notes"]
    );
    if(!decision.handled){
      if(desired.status === "Paid"){
        plan.errors.push(problem(
          "paid-accounting-history-required", "bills", record,
          "A new Paid Bill cannot be restored safely without its payment or Banking settlement history. No Bill was created."
        ));
      }else{
        plan.operations.bills.push({ record, key, projectKey });
      }
    }
  }

  for(const record of preflight.records.expenses){
    const projectKey = identity(record.projectReference);
    const project = projectKey ? phase4APlan.resolutions.projects.get(projectKey) : null;
    if(projectKey && !project){
      plan.errors.push(problem("missing-project-relationship", "expenses", record, "The Expense Project is no longer resolvable at execution time."));
      continue;
    }
    const desired = normalizedExistingExpense(expensePayload(record, project), false);
    const key = expenseKey(desired);
    const matches = currentExpenses.filter(existing => expenseKey(existing) === key);
    const decision = addExistingDecision(
      plan, preflight, executionContext, "expenses", record, key, desired, matches,
      ["date", "merchantKey", "category", "description", "projectReferenceKey", "net", "vatRate", "vat", "gross", "status", "notes"]
    );
    if(!decision.handled) plan.operations.expenses.push({ record, key, projectKey });
  }

  for(const record of preflight.records.mileage){
    const projectKey = identity(record.projectReference);
    const project = projectKey ? phase4APlan.resolutions.projects.get(projectKey) : null;
    if(projectKey && !project){
      plan.errors.push(problem("missing-project-relationship", "mileage", record, "The Mileage Project is no longer resolvable at execution time."));
      continue;
    }
    const desired = normalizedExistingExpense(mileagePayload(record, project), true);
    const key = mileageKey(desired);
    const matches = currentMileage.filter(existing => mileageKey(existing) === key);
    const decision = addExistingDecision(
      plan, preflight, executionContext, "mileage", record, key, desired, matches,
      ["date", "fromKey", "toKey", "businessPurpose", "projectReferenceKey", "miles", "ratePerMile", "amount", "status", "notes"]
    );
    if(!decision.handled) plan.operations.mileage.push({ record, key, projectKey });
  }

  plan.eligible = plan.errors.length === 0 && plan.conflicts.length === 0;
  return plan;
}

function initialResult(preflight) {
  const groups = Object.fromEntries(PHASE4B_MODULE_ORDER.map(moduleName => [moduleName, 0]));
  const records = Object.fromEntries(PHASE4B_MODULE_ORDER.map(moduleName => [moduleName, []]));
  return {
    success: false,
    status: "failed",
    modulesAttempted: [],
    created: { ...groups },
    skipped: { ...groups },
    createdRecords: structuredClone(records),
    skippedRecords: structuredClone(records),
    conflicts: [],
    errors: [],
    warnings: [...(preflight?.warnings || [])],
    fidelityWarnings: (preflight?.warnings || []).filter(warning => LEGACY_INVOICE_WARNING_CODES.has(warning.code)),
    stoppedEarly: false,
    partialWrites: false
  };
}

function assertPersistence(persistence) {
  for(const method of [
    "readExecutionContext", "ensureClientRepresentations", "createProject", "createBudget",
    "createInvoiceAccounting", "createBillAccounting", "createExpenseAccounting", "createMileageAccounting"
  ]) requireService(persistence, method);
}

function applySkipped(result, plan, moduleNames = PHASE4B_MODULE_ORDER) {
  for(const moduleName of moduleNames){
    const skipped = plan.skipped[moduleName] || [];
    result.skipped[moduleName] = skipped.length;
    result.skippedRecords[moduleName] = skipped.map(item => ({
      source: sourceOf(item.record, moduleName),
      reason: item.reason,
      existingId: text(item.existingId),
      ...(item.customerId ? { customerId: text(item.customerId) } : {}),
      ...(item.journalId ? { journalId: text(item.journalId) } : {})
    }));
  }
}

function mergePhase4AResult(result, phase4AResult) {
  for(const moduleName of ["clients", "projects", "budgets"]){
    result.created[moduleName] = phase4AResult.created[moduleName];
    result.skipped[moduleName] = phase4AResult.skipped[moduleName];
    result.createdRecords[moduleName] = phase4AResult.createdRecords[moduleName];
    result.skippedRecords[moduleName] = phase4AResult.skippedRecords[moduleName];
  }
  result.modulesAttempted.push(...phase4AResult.modulesAttempted);
  result.conflicts.push(...phase4AResult.conflicts);
  result.errors.push(...phase4AResult.errors);
}

function anyCreated(result) {
  return Object.values(result.created).some(count => count > 0);
}

export async function executePhase4B(preflight, { persistence } = {}) {
  const result = initialResult(preflight);
  const gates = gateErrors(preflight);
  if(gates.length){
    result.errors.push(...gates);
    result.stoppedEarly = true;
    return result;
  }
  try{
    assertPersistence(persistence);
  }catch(error){
    result.errors.push(problem("invalid-persistence", "execution", null, error.message));
    result.stoppedEarly = true;
    return result;
  }

  let context;
  try{
    context = await persistence.readExecutionContext();
  }catch(error){
    result.errors.push(problem("execution-context-read-failed", "execution", null, error?.message || "Could not refresh execution context."));
    result.stoppedEarly = true;
    return result;
  }
  let plan = planPhase4BExecution(preflight, context || {});
  result.conflicts.push(...plan.conflicts);
  result.errors.push(...plan.errors);
  applySkipped(result, plan);
  if(!plan.eligible){
    result.stoppedEarly = true;
    return result;
  }

  const phase4AResult = await executePhase4A(preflight, { persistence });
  mergePhase4AResult(result, phase4AResult);
  if(!phase4AResult.success){
    result.stoppedEarly = true;
    result.partialWrites = phase4AResult.partialWrites;
    return result;
  }

  try{
    context = await persistence.readExecutionContext();
  }catch(error){
    result.errors.push(problem("post-phase4a-context-read-failed", "execution", null, error?.message || "Could not refresh relationships after Phase 4A."));
    result.stoppedEarly = true;
    result.partialWrites = anyCreated(result);
    return result;
  }
  plan = planPhase4BExecution(preflight, context || {});
  result.conflicts.push(...plan.conflicts);
  result.errors.push(...plan.errors);
  applySkipped(result, plan, ACCOUNTING_MODULES);
  if(!plan.eligible){
    result.stoppedEarly = true;
    result.partialWrites = anyCreated(result);
    return result;
  }

  const methods = {
    invoices: "createInvoiceAccounting",
    bills: "createBillAccounting",
    expenses: "createExpenseAccounting",
    mileage: "createMileageAccounting"
  };
  try{
    for(const moduleName of ACCOUNTING_MODULES){
      for(const operation of plan.operations[moduleName]){
        result.modulesAttempted.push(moduleName);
        const client = operation.client || null;
        const project = operation.projectKey
          ? plan.phase4APlan.resolutions.projects.get(operation.projectKey)
          : null;
        const payload = moduleName === "invoices"
          ? invoicePayload(operation.record, operation.items, client, project)
          : moduleName === "bills"
            ? billPayload(operation.record, project)
            : moduleName === "expenses"
              ? expensePayload(operation.record, project)
              : mileagePayload(operation.record, project);
        const created = await persistence[methods[moduleName]](payload, {
          identity: operation.key,
          source: sourceOf(operation.record, moduleName)
        });
        const id = text(created?.id);
        const journalId = text(created?.journalId);
        if(!id || !journalId){
          throw new Error("Accounting persistence did not confirm both source and journal IDs.");
        }
        result.created[moduleName] += 1;
        result.createdRecords[moduleName].push({
          id,
          journalId,
          source: sourceOf(operation.record, moduleName),
          ...(moduleName === "invoices" ? {
            itemCount: payload.items.length,
            fidelityWarnings: result.fidelityWarnings.filter(warning =>
              warning.sheet === "Invoices" && Number(warning.row) === Number(operation.record.source?.row)
            )
          } : {})
        });
      }
    }
  }catch(error){
    const failedModule = result.modulesAttempted.at(-1) || "execution";
    result.errors.push(problem(
      "accounting-persistence-failure",
      failedModule,
      null,
      error?.message || "Accounting source and journal persistence failed.",
      { accountingUnit: "source-and-required-journal" }
    ));
    result.stoppedEarly = true;
    result.partialWrites = anyCreated(result);
    return result;
  }

  result.success = true;
  result.status = "success";
  result.modulesAttempted = [...new Set(result.modulesAttempted)];
  result.partialWrites = false;
  return result;
}
