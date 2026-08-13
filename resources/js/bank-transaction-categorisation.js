import { normaliseBankTransactionDate, validateJournal } from "./ledger-engine.js";
import {
  bankSettlementJournalDocumentId,
  expenseJournalDocumentId,
  prepareBankSettlementJournal,
  prepareExpenseJournal
} from "./ledger-firestore.js";

export const BANK_CATEGORISATION_VERSION = 1;
export const BANK_CATEGORISED_EXPENSE_CATEGORIES = Object.freeze([
  "General",
  "Travel",
  "Meals",
  "Office",
  "Software",
  "Utilities",
  "Professional fees",
  "Other"
]);
export const BANK_VAT_TREATMENTS = Object.freeze({
  NONE:"none",
  INCLUDED_20:"included-20",
  INCLUDED_5:"included-5",
  EXACT:"exact"
});

const BANK_SETTLEMENT_VERSION = 1;

function requiredText(value,label,maximum = 500){
  const result = String(value || "").trim();
  if(!result) throw new Error(`${label} is required.`);
  if(result.length > maximum) throw new Error(`${label} is too long.`);
  return result;
}

function requireServices(services,names){
  names.forEach(name => {
    if(typeof services?.[name] !== "function") throw new Error(`Firestore ${name} helper is required.`);
  });
}

function exists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function stableValue(value){
  if(value === null || value === undefined || typeof value !== "object") return value;
  if(value instanceof Date) return value.toISOString();
  if(typeof value.toMillis === "function") return { timestampMillis:value.toMillis() };
  if(Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key,stableValue(value[key])]));
}

function sameValue(left,right){
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function valueFingerprint(value){
  const input = JSON.stringify(stableValue(value));
  let hash = 14695981039346656037n;
  for(let index = 0; index < input.length; index += 1){
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64,hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16,"0");
}

function sourceFingerprint(source){
  const unmanaged = Object.fromEntries(Object.entries(source || {}).filter(([key]) =>
    !["status","paidAt","updatedAt","bankSettlement"].includes(key)
  ));
  return valueFingerprint(unmanaged);
}

function roundCurrency(value){
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function currencyCents(value){
  return Math.round(Number(value) * 100);
}

function positiveCurrency(value,label){
  const amount = Number(value);
  if(!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero.`);
  const rounded = roundCurrency(amount);
  if(Math.abs(amount - rounded) > 1e-8) throw new Error(`${label} must have no more than two decimal places.`);
  return rounded;
}

function populatedAmount(value){
  if(value === null || value === undefined || value === "") return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount !== 0;
}

function moneyOutDetails(transaction = {}){
  if(!populatedAmount(transaction.moneyOut)) throw new Error("A valid Money Out amount is required.");
  if(populatedAmount(transaction.moneyIn)) throw new Error("A transaction containing both Money In and Money Out cannot be categorised.");
  const gross = positiveCurrency(Math.abs(Number(transaction.moneyOut)),"Money Out");
  const date = normaliseBankTransactionDate(transaction.transactionDate);
  if(!date) throw new Error("A valid bank transaction date is required.");
  return { gross,date };
}

export function moneyOutCategorisationEligibility(transaction = {}){
  if(String(transaction.status || "") !== "unmatched"){
    return Object.freeze({ eligible:false,reason:"Only an unmatched bank transaction can be categorised." });
  }
  try{
    const details = moneyOutDetails(transaction);
    return Object.freeze({ eligible:true,reason:"",...details });
  }catch(error){
    return Object.freeze({ eligible:false,reason:String(error?.message || "This bank transaction cannot be categorised.") });
  }
}

export function calculateMoneyOutCategorisationAmounts(grossValue,vatTreatment,exactVatValue = null){
  const gross = positiveCurrency(grossValue,"Gross amount");
  const treatment = String(vatTreatment || "");
  let vatRate = 0;
  let vat = 0;
  if(treatment === BANK_VAT_TREATMENTS.INCLUDED_20 || treatment === BANK_VAT_TREATMENTS.INCLUDED_5){
    vatRate = treatment === BANK_VAT_TREATMENTS.INCLUDED_20 ? 0.2 : 0.05;
    const net = roundCurrency(gross / (1 + vatRate));
    vat = roundCurrency(gross - net);
    return Object.freeze({ net,vatRate,vat,gross });
  }
  if(treatment === BANK_VAT_TREATMENTS.EXACT){
    if(exactVatValue === null || exactVatValue === undefined || String(exactVatValue).trim() === ""){
      throw new Error("Enter an exact VAT amount.");
    }
    const rawVat = Number(exactVatValue);
    if(!Number.isFinite(rawVat) || rawVat < 0) throw new Error("Enter a valid exact VAT amount.");
    vat = roundCurrency(rawVat);
    if(Math.abs(rawVat - vat) > 1e-8) throw new Error("Exact VAT must have no more than two decimal places.");
    if(vat >= gross) throw new Error("Exact VAT must be less than the gross amount.");
    return Object.freeze({ net:roundCurrency(gross - vat),vatRate:0,vat,gross });
  }
  if(treatment !== BANK_VAT_TREATMENTS.NONE) throw new Error("Select a supported VAT treatment.");
  return Object.freeze({ net:gross,vatRate:0,vat:0,gross });
}

export function bankCategorisedExpenseDocumentId(transactionId){
  const sourceId = requiredText(transactionId,"Bank transaction ID",1400);
  return `bank-expense_${encodeURIComponent(sourceId)}`;
}

function validatedProjectId(value){
  const projectId = String(value || "").trim();
  if(projectId.includes("/")) throw new Error("Selected project ID is invalid.");
  return projectId;
}

function timestampValue(options){
  const value = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const parsed = new Date(value);
  if(!value || Number.isNaN(parsed.getTime())) throw new Error("A valid categorisation timestamp is required.");
  return parsed.toISOString();
}

function categorisationInput(input = {}){
  const category = requiredText(input.category,"Expense category",80);
  if(!BANK_CATEGORISED_EXPENSE_CATEGORIES.includes(category)) throw new Error("Select a supported expense category.");
  const description = String(input.description || "").trim();
  if(description.length > 500) throw new Error("Description is too long.");
  return {
    merchant:requiredText(input.merchant,"Merchant",160),
    category,
    description,
    vatTreatment:String(input.vatTreatment || ""),
    exactVat:input.exactVat,
    projectId:validatedProjectId(input.projectId)
  };
}

function expenseBeforeSettlement(transactionId,transaction,input,project,createdAt){
  const { gross,date } = moneyOutDetails(transaction);
  const values = calculateMoneyOutCategorisationAmounts(gross,input.vatTreatment,input.exactVat);
  const expenseId = bankCategorisedExpenseDocumentId(transactionId);
  return {
    id:expenseId,
    type:"expense",
    date,
    merchant:input.merchant,
    category:input.category,
    description:input.description,
    from:"",
    to:"",
    businessPurpose:"",
    miles:0,
    ratePerMile:0,
    amount:0,
    net:values.net,
    vatRate:values.vatRate,
    vat:values.vat,
    gross:values.gross,
    status:"Draft",
    notes:"",
    projectId:input.projectId,
    projectName:input.projectId ? String(project?.name || "") : "",
    projectReference:input.projectId ? String(project?.reference || "") : "",
    attachmentName:"",
    attachmentUrl:"",
    attachmentPath:"",
    attachmentSize:0,
    attachmentType:"",
    createdAt,
    updatedAt:createdAt,
    bankCategorisation:{ version:BANK_CATEGORISATION_VERSION,transactionId }
  };
}

function settlementMarker(transactionId,journalId,expense,paymentDate){
  return {
    version:BANK_SETTLEMENT_VERSION,
    transactionId,
    journalId,
    previousStatus:"Draft",
    hadPaidAt:false,
    previousPaidAt:null,
    paymentDateApplied:true,
    paymentDate:`${paymentDate}T00:00:00.000Z`,
    amount:expense.gross,
    sourceFingerprint:sourceFingerprint(expense)
  };
}

function categorisedExpenseState(userId,transactionId,transaction,input,project,createdAt){
  const expenseId = bankCategorisedExpenseDocumentId(transactionId);
  const settlementJournalId = bankSettlementJournalDocumentId(userId,transactionId);
  const draft = expenseBeforeSettlement(transactionId,transaction,input,project,createdAt);
  const marker = settlementMarker(transactionId,settlementJournalId,draft,draft.date);
  const expense = {
    ...draft,
    status:"Paid",
    paidAt:marker.paymentDate,
    bankSettlement:marker
  };
  const timestamps = { createdAt,updatedAt:createdAt };
  const accrualJournal = prepareExpenseJournal(userId,expenseId,draft,timestamps);
  const settlementJournal = prepareBankSettlementJournal(userId,transactionId,{
    transactionDate:transaction.transactionDate,
    bankAccountId:transaction.bankAccountId,
    recordType:"expense",
    recordId:expenseId,
    isMileage:false,
    amount:draft.gross
  },timestamps);
  return {
    expenseId,
    settlementJournalId,
    accrualJournalId:expenseJournalDocumentId(userId,expenseId),
    expense,
    accrualJournal,
    settlementJournal,
    marker
  };
}

function assertJournal(actual,expected,label){
  if(!actual || String(actual.userId || "") !== String(expected.userId || "")){
    throw new Error(`${label} does not belong to the authenticated user.`);
  }
  if(!validateJournal(actual).valid || !sameValue(actual,expected)){
    throw new Error(`${label} changed or is invalid; it was not removed.`);
  }
}

function validateCategorisedState(userId,transactionId,transaction,expense,accrualJournal,settlementJournal){
  const { gross,date } = moneyOutDetails(transaction);
  const expenseId = bankCategorisedExpenseDocumentId(transactionId);
  const settlementJournalId = bankSettlementJournalDocumentId(userId,transactionId);
  if(transaction.status !== "matched" || transaction.matchOrigin !== "categorisation" ||
    Number(transaction.categorisationVersion) !== BANK_CATEGORISATION_VERSION){
    throw new Error("Bank transaction is not a supported categorised Money Out transaction.");
  }
  if(transaction.matchedRecordType !== "expense" || String(transaction.matchedRecordId || "") !== expenseId ||
    String(transaction.settlementJournalId || "") !== settlementJournalId ||
    Number(transaction.settlementVersion) !== BANK_SETTLEMENT_VERSION ||
    currencyCents(transaction.matchedAmount) !== currencyCents(gross)){
    throw new Error("The bank transaction categorisation relationship changed; it was not removed.");
  }
  if(!expense || !accrualJournal || !settlementJournal) throw new Error("A Banking-created categorisation record is missing.");
  if(String(expense.id || "") !== expenseId || expense.type !== "expense" || expense.date !== date ||
    currencyCents(expense.gross) !== currencyCents(gross) || expense.status !== "Paid" ||
    expense.paidAt !== `${date}T00:00:00.000Z` || expense.updatedAt !== expense.createdAt ||
    !sameValue(expense.bankCategorisation,{ version:BANK_CATEGORISATION_VERSION,transactionId })){
    throw new Error("The Banking-created expense changed; it was not removed.");
  }
  const marker = expense.bankSettlement;
  const expectedMarker = settlementMarker(transactionId,settlementJournalId,expense,date);
  if(!sameValue(marker,expectedMarker) || sourceFingerprint(expense) !== marker.sourceFingerprint ||
    valueFingerprint(marker) !== String(transaction.settlementStateFingerprint || "")){
    throw new Error("The Banking-created expense marker or fingerprint changed; it was not removed.");
  }
  const timestamps = { createdAt:expense.createdAt,updatedAt:expense.updatedAt };
  const expectedAccrual = prepareExpenseJournal(userId,expenseId,expense,timestamps);
  const expectedSettlement = prepareBankSettlementJournal(userId,transactionId,{
    transactionDate:transaction.transactionDate,
    bankAccountId:transaction.bankAccountId,
    recordType:"expense",
    recordId:expenseId,
    isMileage:false,
    amount:gross
  },timestamps);
  assertJournal(accrualJournal,expectedAccrual,"The Banking-created expense journal");
  assertJournal(settlementJournal,expectedSettlement,"The Banking-created settlement journal");
  return { expenseId,accrualJournalId:expectedAccrual.journalId,settlementJournalId,gross };
}

export async function categoriseMoneyOut(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID",1400);
  const transactionId = requiredText(options.transactionId,"Bank transaction ID",1400);
  if(transactionId.includes("/")) throw new Error("Bank transaction ID is invalid.");
  const input = categorisationInput(options.input);
  const createdAt = timestampValue(options);
  requireServices(services,["doc","runTransaction","serverTimestamp"]);
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);

  return services.runTransaction(db,async firestoreTransaction => {
    const transactionSnapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists.");
    const bankTransaction = { ...transactionSnapshot.data(),id:transactionId };
    const expenseId = bankCategorisedExpenseDocumentId(transactionId);
    const expenseRef = services.doc(db,"users",userId,"expenses",expenseId);
    const accrualRef = services.doc(db,"journals",expenseJournalDocumentId(userId,expenseId));
    const settlementRef = services.doc(db,"journals",bankSettlementJournalDocumentId(userId,transactionId));
    const projectRef = input.projectId
      ? services.doc(db,"users",userId,"projects",input.projectId)
      : null;
    const snapshots = await Promise.all([
      firestoreTransaction.get(expenseRef),
      firestoreTransaction.get(accrualRef),
      firestoreTransaction.get(settlementRef),
      ...(projectRef ? [firestoreTransaction.get(projectRef)] : [])
    ]);
    const [expenseSnapshot,accrualSnapshot,settlementSnapshot,projectSnapshot] = snapshots;

    if(bankTransaction.status === "matched"){
      if(bankTransaction.matchOrigin !== "categorisation"){
        throw new Error("Bank transaction is already matched to another record.");
      }
      validateCategorisedState(
        userId,transactionId,bankTransaction,
        exists(expenseSnapshot) ? expenseSnapshot.data() : null,
        exists(accrualSnapshot) ? accrualSnapshot.data() : null,
        exists(settlementSnapshot) ? settlementSnapshot.data() : null
      );
      return Object.freeze({ status:"already-categorised",transactionId,expenseId });
    }
    const eligibility = moneyOutCategorisationEligibility(bankTransaction);
    if(!eligibility.eligible) throw new Error(eligibility.reason);
    if(exists(expenseSnapshot) || exists(accrualSnapshot) || exists(settlementSnapshot)){
      throw new Error("A deterministic categorisation record already exists; nothing was overwritten.");
    }
    if(projectRef && !exists(projectSnapshot)) throw new Error("Selected project no longer exists.");
    if(typeof firestoreTransaction.set !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction write helpers are required.");
    }
    const state = categorisedExpenseState(
      userId,transactionId,bankTransaction,input,
      projectRef ? projectSnapshot.data() : null,createdAt
    );
    const timestamp = services.serverTimestamp();
    firestoreTransaction.set(expenseRef,state.expense);
    firestoreTransaction.set(accrualRef,state.accrualJournal);
    firestoreTransaction.set(settlementRef,state.settlementJournal);
    firestoreTransaction.update(transactionRef,{
      status:"matched",
      matchedRecordType:"expense",
      matchedRecordId:state.expenseId,
      matchedAt:timestamp,
      matchedAmount:state.expense.gross,
      settlementJournalId:state.settlementJournalId,
      settlementVersion:BANK_SETTLEMENT_VERSION,
      settlementStateFingerprint:valueFingerprint(state.marker),
      matchOrigin:"categorisation",
      categorisationVersion:BANK_CATEGORISATION_VERSION,
      updatedAt:timestamp
    });
    return Object.freeze({
      status:"categorised",transactionId,expenseId:state.expenseId,
      accrualJournalId:state.accrualJournalId,settlementJournalId:state.settlementJournalId,
      gross:state.expense.gross
    });
  });
}

export async function uncategoriseMoneyOut(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID",1400);
  const transactionId = requiredText(options.transactionId,"Bank transaction ID",1400);
  if(transactionId.includes("/")) throw new Error("Bank transaction ID is invalid.");
  requireServices(services,["doc","runTransaction","serverTimestamp","deleteField"]);
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);

  return services.runTransaction(db,async firestoreTransaction => {
    const transactionSnapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists.");
    const bankTransaction = { ...transactionSnapshot.data(),id:transactionId };
    if(bankTransaction.status !== "matched" || bankTransaction.matchOrigin !== "categorisation" ||
      Number(bankTransaction.categorisationVersion) !== BANK_CATEGORISATION_VERSION){
      throw new Error("Bank transaction is not currently categorised.");
    }
    const expenseId = bankCategorisedExpenseDocumentId(transactionId);
    if(String(bankTransaction.matchedRecordId || "") !== expenseId){
      throw new Error("The deterministic categorised expense identity changed; it was not removed.");
    }
    const expenseRef = services.doc(db,"users",userId,"expenses",expenseId);
    const accrualRef = services.doc(db,"journals",expenseJournalDocumentId(userId,expenseId));
    const settlementRef = services.doc(db,"journals",bankSettlementJournalDocumentId(userId,transactionId));
    const [expenseSnapshot,accrualSnapshot,settlementSnapshot] = await Promise.all([
      firestoreTransaction.get(expenseRef),
      firestoreTransaction.get(accrualRef),
      firestoreTransaction.get(settlementRef)
    ]);
    const validated = validateCategorisedState(
      userId,transactionId,bankTransaction,
      exists(expenseSnapshot) ? expenseSnapshot.data() : null,
      exists(accrualSnapshot) ? accrualSnapshot.data() : null,
      exists(settlementSnapshot) ? settlementSnapshot.data() : null
    );
    if(typeof firestoreTransaction.delete !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction delete helpers are required.");
    }
    const removed = services.deleteField();
    firestoreTransaction.delete(settlementRef);
    firestoreTransaction.delete(accrualRef);
    firestoreTransaction.delete(expenseRef);
    firestoreTransaction.update(transactionRef,{
      status:"unmatched",
      matchedRecordType:removed,
      matchedRecordId:removed,
      matchedAt:removed,
      matchedAmount:removed,
      settlementJournalId:removed,
      settlementVersion:removed,
      settlementStateFingerprint:removed,
      matchOrigin:removed,
      categorisationVersion:removed,
      updatedAt:services.serverTimestamp()
    });
    return Object.freeze({
      status:"uncategorised",transactionId,expenseId:validated.expenseId,
      removedJournalIds:Object.freeze([validated.accrualJournalId,validated.settlementJournalId])
    });
  });
}
