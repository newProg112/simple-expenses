import { normaliseBankTransactionDate, validateJournal } from "./ledger-engine.js";
import {
  bankIncomeJournalDocumentId,
  prepareBankIncomeJournal
} from "./ledger-firestore.js";
import {
  BANK_VAT_TREATMENTS,
  calculateMoneyOutCategorisationAmounts
} from "./bank-transaction-categorisation.js";
import { requireOwnedBankAccountInTransaction } from "./bank-account-integrity.js";

export const BANK_INCOME_CATEGORISATION_VERSION = 1;
export const BANK_INCOME_CATEGORIES = Object.freeze([
  Object.freeze({ value:"Sales / Trading income",accountCode:"4000" }),
  Object.freeze({ value:"Interest received",accountCode:"4100" }),
  Object.freeze({ value:"Other income",accountCode:"4200" })
]);

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
  const immutable = Object.fromEntries(Object.entries(source || {}).filter(([key]) =>
    !["bankCategorisation","updatedAt"].includes(key)
  ));
  return valueFingerprint(immutable);
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

function moneyInDetails(transaction = {}){
  if(!populatedAmount(transaction.moneyIn) || Number(transaction.moneyIn) <= 0){
    throw new Error("Money In must be greater than zero.");
  }
  if(populatedAmount(transaction.moneyOut)) throw new Error("A transaction containing both Money In and Money Out cannot be categorised.");
  const gross = positiveCurrency(Number(transaction.moneyIn),"Money In");
  const date = normaliseBankTransactionDate(transaction.transactionDate);
  if(!date) throw new Error("A valid bank transaction date is required.");
  const bankAccountId = String(transaction.bankAccountId || "").trim();
  if(!bankAccountId) throw new Error("A valid bank account is required.");
  return { gross,date,bankAccountId };
}

export function moneyInCategorisationEligibility(transaction = {}){
  if(String(transaction.status || "") !== "unmatched"){
    return Object.freeze({ eligible:false,reason:"Only an unmatched bank transaction can be categorised." });
  }
  try{
    return Object.freeze({ eligible:true,reason:"",...moneyInDetails(transaction) });
  }catch(error){
    return Object.freeze({ eligible:false,reason:String(error?.message || "This bank transaction cannot be categorised.") });
  }
}

export function bankIncomeDocumentId(transactionId){
  const sourceId = requiredText(transactionId,"Bank transaction ID",1400);
  return `bank-income_${encodeURIComponent(sourceId)}`;
}

export function incomeAccountForCategory(category){
  const selected = BANK_INCOME_CATEGORIES.find(item => item.value === String(category || "").trim());
  if(!selected) throw new Error("Select a supported income category.");
  return selected.accountCode;
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
  const category = requiredText(input.category,"Income category",80);
  const description = String(input.description || "").trim();
  if(description.length > 500) throw new Error("Description is too long.");
  return {
    payer:requiredText(input.payer,"Payer / source",160),
    category,
    incomeAccountCode:incomeAccountForCategory(category),
    description,
    vatTreatment:String(input.vatTreatment || ""),
    exactVat:input.exactVat,
    projectId:validatedProjectId(input.projectId)
  };
}

function incomeSource(userId,transactionId,transaction,input,project,createdAt){
  const { gross,date,bankAccountId } = moneyInDetails(transaction);
  const values = calculateMoneyOutCategorisationAmounts(gross,input.vatTreatment,input.exactVat);
  const incomeId = bankIncomeDocumentId(transactionId);
  const journalId = bankIncomeJournalDocumentId(userId,incomeId);
  const base = {
    id:incomeId,
    userId,
    sourceType:"bankIncome",
    sourceVersion:BANK_INCOME_CATEGORISATION_VERSION,
    bankTransactionId:transactionId,
    bankAccountId,
    date,
    payer:input.payer,
    category:input.category,
    incomeAccountCode:input.incomeAccountCode,
    description:input.description,
    net:values.net,
    vatRate:values.vatRate,
    vat:values.vat,
    gross:values.gross,
    vatTreatment:input.vatTreatment,
    projectId:input.projectId,
    projectName:input.projectId ? String(project?.name || "") : "",
    projectReference:input.projectId ? String(project?.reference || "") : "",
    createdAt,
    updatedAt:createdAt
  };
  const marker = {
    version:BANK_INCOME_CATEGORISATION_VERSION,
    transactionId,
    journalId,
    sourceFingerprint:sourceFingerprint(base)
  };
  return { ...base,bankCategorisation:marker };
}

function preparedIncomeState(userId,transactionId,transaction,input,project,createdAt){
  const source = incomeSource(userId,transactionId,transaction,input,project,createdAt);
  const journal = prepareBankIncomeJournal(userId,source.id,source,{
    createdAt,updatedAt:createdAt
  });
  return { source,journal,incomeId:source.id,journalId:journal.journalId,marker:source.bankCategorisation };
}

function validateCategorisedIncome(userId,transactionId,transaction,source,journal){
  const { gross,date,bankAccountId } = moneyInDetails(transaction);
  const incomeId = bankIncomeDocumentId(transactionId);
  const journalId = bankIncomeJournalDocumentId(userId,incomeId);
  if(transaction.status !== "matched" || transaction.matchOrigin !== "categorisation" ||
    Number(transaction.categorisationVersion) !== BANK_INCOME_CATEGORISATION_VERSION){
    throw new Error("Bank transaction is not a supported categorised Money In transaction.");
  }
  if(transaction.matchedRecordType !== "bankIncome" || String(transaction.matchedRecordId || "") !== incomeId ||
    String(transaction.categorisationJournalId || "") !== journalId ||
    currencyCents(transaction.matchedAmount) !== currencyCents(gross)){
    throw new Error("The bank transaction income relationship changed; it was not removed.");
  }
  if(!source || !journal) throw new Error("A Banking-created income categorisation record is missing.");
  if(source.id !== incomeId || source.sourceType !== "bankIncome" ||
    Number(source.sourceVersion) !== BANK_INCOME_CATEGORISATION_VERSION ||
    source.userId !== userId || source.bankTransactionId !== transactionId ||
    source.bankAccountId !== bankAccountId || source.date !== date ||
    currencyCents(source.gross) !== currencyCents(gross) || source.createdAt !== source.updatedAt){
    throw new Error("The Banking-created income source changed; it was not removed.");
  }
  const expectedMarker = {
    version:BANK_INCOME_CATEGORISATION_VERSION,
    transactionId,
    journalId,
    sourceFingerprint:sourceFingerprint(source)
  };
  if(!sameValue(source.bankCategorisation,expectedMarker) ||
    valueFingerprint(expectedMarker) !== String(transaction.categorisationStateFingerprint || "")){
    throw new Error("The Banking-created income marker or fingerprint changed; it was not removed.");
  }
  const expectedJournal = prepareBankIncomeJournal(userId,incomeId,source,{
    createdAt:source.createdAt,updatedAt:source.updatedAt
  });
  if(String(journal.userId || "") !== userId){
    throw new Error("The Banking-created income journal does not belong to the authenticated user.");
  }
  if(!validateJournal(journal).valid || !sameValue(journal,expectedJournal)){
    throw new Error("The Banking-created income journal changed or is invalid; it was not removed.");
  }
  return { incomeId,journalId };
}

export async function categoriseMoneyIn(options = {}){
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
    const validatedAccount = await requireOwnedBankAccountInTransaction({
      db,services,userId,firestoreTransaction,bankTransaction
    });
    bankTransaction.bankAccountId = validatedAccount.bankAccountId;
    const incomeId = bankIncomeDocumentId(transactionId);
    const sourceRef = services.doc(db,"users",userId,"bankIncome",incomeId);
    const journalRef = services.doc(db,"journals",bankIncomeJournalDocumentId(userId,incomeId));
    const projectRef = input.projectId ? services.doc(db,"users",userId,"projects",input.projectId) : null;
    const snapshots = await Promise.all([
      firestoreTransaction.get(sourceRef),
      firestoreTransaction.get(journalRef),
      ...(projectRef ? [firestoreTransaction.get(projectRef)] : [])
    ]);
    const [sourceSnapshot,journalSnapshot,projectSnapshot] = snapshots;

    if(bankTransaction.status === "matched"){
      if(bankTransaction.matchOrigin !== "categorisation" || bankTransaction.matchedRecordType !== "bankIncome"){
        throw new Error("Bank transaction is already matched or categorised to another record.");
      }
      validateCategorisedIncome(
        userId,transactionId,bankTransaction,
        exists(sourceSnapshot) ? sourceSnapshot.data() : null,
        exists(journalSnapshot) ? journalSnapshot.data() : null
      );
      return Object.freeze({ status:"already-categorised",transactionId,incomeId });
    }
    const eligibility = moneyInCategorisationEligibility(bankTransaction);
    if(!eligibility.eligible) throw new Error(eligibility.reason);
    if(exists(sourceSnapshot) || exists(journalSnapshot)){
      throw new Error("A deterministic income categorisation record already exists; nothing was overwritten.");
    }
    if(projectRef && !exists(projectSnapshot)) throw new Error("Selected project no longer exists.");
    if(typeof firestoreTransaction.set !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction write helpers are required.");
    }
    const state = preparedIncomeState(
      userId,transactionId,bankTransaction,input,
      projectRef ? projectSnapshot.data() : null,createdAt
    );
    const timestamp = services.serverTimestamp();
    firestoreTransaction.set(sourceRef,state.source);
    firestoreTransaction.set(journalRef,state.journal);
    firestoreTransaction.update(transactionRef,{
      status:"matched",
      matchedRecordType:"bankIncome",
      matchedRecordId:state.incomeId,
      matchedAt:timestamp,
      matchedAmount:state.source.gross,
      categorisationJournalId:state.journalId,
      categorisationStateFingerprint:valueFingerprint(state.marker),
      matchOrigin:"categorisation",
      categorisationVersion:BANK_INCOME_CATEGORISATION_VERSION,
      updatedAt:timestamp
    });
    return Object.freeze({
      status:"categorised",transactionId,incomeId:state.incomeId,
      journalId:state.journalId,gross:state.source.gross
    });
  });
}

export async function uncategoriseMoneyIn(options = {}){
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
      bankTransaction.matchedRecordType !== "bankIncome" ||
      Number(bankTransaction.categorisationVersion) !== BANK_INCOME_CATEGORISATION_VERSION){
      throw new Error("Bank transaction is not currently categorised as Money In.");
    }
    const incomeId = bankIncomeDocumentId(transactionId);
    if(String(bankTransaction.matchedRecordId || "") !== incomeId){
      throw new Error("The deterministic income source identity changed; it was not removed.");
    }
    const sourceRef = services.doc(db,"users",userId,"bankIncome",incomeId);
    const journalRef = services.doc(db,"journals",bankIncomeJournalDocumentId(userId,incomeId));
    const [sourceSnapshot,journalSnapshot] = await Promise.all([
      firestoreTransaction.get(sourceRef),
      firestoreTransaction.get(journalRef)
    ]);
    const validated = validateCategorisedIncome(
      userId,transactionId,bankTransaction,
      exists(sourceSnapshot) ? sourceSnapshot.data() : null,
      exists(journalSnapshot) ? journalSnapshot.data() : null
    );
    if(typeof firestoreTransaction.delete !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction delete helpers are required.");
    }
    const removed = services.deleteField();
    firestoreTransaction.delete(journalRef);
    firestoreTransaction.delete(sourceRef);
    firestoreTransaction.update(transactionRef,{
      status:"unmatched",
      matchedRecordType:removed,
      matchedRecordId:removed,
      matchedAt:removed,
      matchedAmount:removed,
      categorisationJournalId:removed,
      categorisationStateFingerprint:removed,
      matchOrigin:removed,
      categorisationVersion:removed,
      updatedAt:services.serverTimestamp()
    });
    return Object.freeze({
      status:"uncategorised",transactionId,incomeId:validated.incomeId,
      removedJournalId:validated.journalId
    });
  });
}
