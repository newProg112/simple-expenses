import { normaliseBankTransactionDate,validateJournal } from "./ledger-engine.js";
import {
  bankExceptionJournalDocumentId,
  prepareBankExceptionJournal
} from "./ledger-firestore.js";

export const BANK_EXCEPTION_VERSION = 1;

export const BANK_EXCEPTION_TYPES = Object.freeze([
  Object.freeze({
    value:"ownerContribution",label:"Owner contribution",direction:"moneyIn",
    accountCode:"3000",accountName:"Owner's Equity",posting:"journal",
    explanation:"Money introduced by the owner. This increases Bank and owner's equity, with no income or VAT."
  }),
  Object.freeze({
    value:"ownerDrawing",label:"Owner drawing",direction:"moneyOut",
    accountCode:"3200",accountName:"Owner's Drawings",posting:"journal",
    explanation:"A personal withdrawal by the owner. This reduces Bank and equity, not business profit."
  }),
  Object.freeze({
    value:"loanReceived",label:"Loan received",direction:"moneyIn",
    accountCode:"2400",accountName:"Business Loan",posting:"journal",
    explanation:"Business loan proceeds. This increases Bank and a loan liability, not income."
  }),
  Object.freeze({
    value:"loanRepaymentPrincipal",label:"Loan repayment - principal only",direction:"moneyOut",
    accountCode:"2400",accountName:"Business Loan",posting:"journal",
    explanation:"Principal-only repayment. Any interest must be handled later through split-transaction support."
  }),
  Object.freeze({
    value:"taxPayment",label:"Tax payment",direction:"moneyOut",
    accountCode:"2300",accountName:"Tax Control",posting:"journal",
    explanation:"Reduces the generic Tax Control liability. It does not identify the tax type or create a VAT return settlement."
  }),
  Object.freeze({
    value:"personalNonBusinessIn",label:"Personal / non-business",direction:"moneyIn",
    accountCode:"3000",accountName:"Owner's Equity",posting:"journal",
    explanation:"Personal money entering the business bank is treated as owner funding, not sales income."
  }),
  Object.freeze({
    value:"personalNonBusinessOut",label:"Personal / non-business",direction:"moneyOut",
    accountCode:"3200",accountName:"Owner's Drawings",posting:"journal",
    explanation:"Personal money leaving the business bank is treated as drawings, not a business expense."
  }),
  Object.freeze({
    value:"ignoredReviewed",label:"Ignored - reviewed",direction:"both",
    accountCode:"",accountName:"No accounting posting",posting:"none",
    explanation:"Retains the imported row for audit but creates no journal. Some reasons continue to block reconciliation."
  })
]);

export const BANK_EXCEPTION_IGNORE_REASONS = Object.freeze([
  Object.freeze({
    value:"duplicateProviderArtifact",label:"Duplicate / provider artefact",
    explanation:"The retained row duplicates a genuine statement movement already accounted for.",
    blocksReconciliation:false
  }),
  Object.freeze({
    value:"informationalRow",label:"Informational statement row",
    explanation:"The row is retained for review but is not accepted as an accounting movement.",
    blocksReconciliation:true
  }),
  Object.freeze({
    value:"unsupportedStatementRecord",label:"Unsupported statement record",
    explanation:"The row needs a later accounting workflow and must continue to block reconciliation sign-off.",
    blocksReconciliation:true
  })
]);

function requiredText(value,label,maximum = 1400){
  const result = String(value || "").trim();
  if(!result) throw new Error(`${label} is required.`);
  if(result.length > maximum) throw new Error(`${label} is too long.`);
  return result;
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

function fingerprint(value){
  const input = JSON.stringify(stableValue(value));
  let hash = 14695981039346656037n;
  for(let index = 0; index < input.length; index += 1){
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64,hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16,"0");
}

function currency(value,label = "Resolution amount"){
  const amount = Number(value);
  if(!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero.`);
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  if(Math.abs(amount - rounded) > 1e-8) throw new Error(`${label} must have no more than two decimal places.`);
  return rounded;
}

function transactionDetails(transaction){
  const moneyIn = transaction?.moneyIn === null || transaction?.moneyIn === undefined || transaction?.moneyIn === ""
    ? 0 : Number(transaction.moneyIn);
  const moneyOut = transaction?.moneyOut === null || transaction?.moneyOut === undefined || transaction?.moneyOut === ""
    ? 0 : Number(transaction.moneyOut);
  if(!Number.isFinite(moneyIn) || !Number.isFinite(moneyOut) ||
    (moneyIn > 0 && moneyOut > 0) || (moneyIn <= 0 && moneyOut <= 0)){
    throw new Error("The bank transaction must contain either positive Money In or positive Money Out.");
  }
  const date = normaliseBankTransactionDate(transaction?.transactionDate);
  if(!date) throw new Error("The bank transaction has an invalid date.");
  const bankAccountId = requiredText(transaction?.bankAccountId,"Bank account ID");
  return moneyIn > 0
    ? { direction:"moneyIn",amount:currency(moneyIn),date,bankAccountId }
    : { direction:"moneyOut",amount:currency(moneyOut),date,bankAccountId };
}

export function bankExceptionEligibility(transaction){
  if(String(transaction?.status || "") !== "unmatched"){
    return Object.freeze({ eligible:false,reason:"Use the existing undo action before resolving this transaction another way." });
  }
  try{
    return Object.freeze({ eligible:true,...transactionDetails(transaction) });
  }catch(error){
    return Object.freeze({ eligible:false,reason:error.message });
  }
}

export function bankExceptionOptions(direction){
  return Object.freeze(BANK_EXCEPTION_TYPES.filter(item =>
    item.value !== "taxPayment" && (item.direction === direction || item.direction === "both")
  ));
}

export function bankExceptionResolutionDocumentId(transactionId){
  return `bank-exception_${encodeURIComponent(requiredText(transactionId,"Bank transaction ID"))}`;
}

function validatedInput(input,direction){
  const resolutionType = requiredText(input?.resolutionType,"Resolution type",80);
  const definition = BANK_EXCEPTION_TYPES.find(item => item.value === resolutionType);
  if(!definition || ![direction,"both"].includes(definition.direction)){
    throw new Error("Choose a supported resolution for this transaction direction.");
  }
  const notes = String(input?.notes || "").trim();
  if(notes.length > 500) throw new Error("Resolution notes are too long.");
  let reasonCode = "";
  let blocksReconciliation = false;
  if(definition.posting === "none"){
    reasonCode = requiredText(input?.reasonCode,"Ignore reason",80);
    const reason = BANK_EXCEPTION_IGNORE_REASONS.find(item => item.value === reasonCode);
    if(!reason) throw new Error("Choose a supported reason for ignoring this statement row.");
    blocksReconciliation = reason.blocksReconciliation;
  }
  return Object.freeze({ definition,notes,reasonCode,blocksReconciliation });
}

function resolutionCore({ userId,resolutionId,bankTransactionId,bankAccountId,resolutionType,
  direction,amount,effectiveDate,journalId,nominalAccountCode,reasonCode,notes,posting,
  blocksReconciliation,status }){
  const date = normaliseBankTransactionDate(effectiveDate);
  if(!date) throw new Error("A valid exception resolution date is required.");
  const core = {
    version:BANK_EXCEPTION_VERSION,userId,resolutionId,bankTransactionId,bankAccountId,
    resolutionType,direction,amount:currency(amount),effectiveDate:date,journalId,
    nominalAccountCode,reasonCode,notes,posting,
    blocksReconciliation:blocksReconciliation === true,status
  };
  for(const [value,label] of [[userId,"User ID"],[resolutionId,"Resolution ID"],
    [bankTransactionId,"Bank transaction ID"],[bankAccountId,"Bank account ID"]]) requiredText(value,label);
  const definition = BANK_EXCEPTION_TYPES.find(item => item.value === resolutionType);
  if(!definition || ![direction,"both"].includes(definition.direction)){
    throw new Error("The exception resolution type and direction are inconsistent.");
  }
  if(posting !== definition.posting || nominalAccountCode !== definition.accountCode){
    throw new Error("The exception resolution posting or counter-account is inconsistent.");
  }
  if(posting === "journal"){
    if(!journalId || status !== "posted" || reasonCode || core.blocksReconciliation){
      throw new Error("The posted exception resolution metadata is inconsistent.");
    }
  }else{
    const reason = BANK_EXCEPTION_IGNORE_REASONS.find(item => item.value === reasonCode);
    if(journalId || status !== "reviewed" || !reason || reason.blocksReconciliation !== core.blocksReconciliation){
      throw new Error("The reviewed no-posting resolution metadata is inconsistent.");
    }
  }
  return Object.freeze(core);
}

function coreFromRecord(record){
  return resolutionCore({
    userId:String(record?.userId || ""),resolutionId:String(record?.resolutionId || ""),
    bankTransactionId:String(record?.bankTransactionId || ""),bankAccountId:String(record?.bankAccountId || ""),
    resolutionType:String(record?.resolutionType || ""),direction:String(record?.direction || ""),
    amount:Number(record?.amount),effectiveDate:String(record?.effectiveDate || ""),
    journalId:String(record?.journalId || ""),nominalAccountCode:String(record?.nominalAccountCode || ""),
    reasonCode:String(record?.reasonCode || ""),notes:String(record?.notes || ""),
    posting:String(record?.posting || ""),blocksReconciliation:record?.blocksReconciliation === true,
    status:String(record?.status || "")
  });
}

function expectedCore(userId,transactionId,details,input){
  const resolutionId = bankExceptionResolutionDocumentId(transactionId);
  const journalId = input.definition.posting === "journal"
    ? bankExceptionJournalDocumentId(userId,resolutionId) : "";
  return resolutionCore({
    userId,resolutionId,bankTransactionId:transactionId,bankAccountId:details.bankAccountId,
    resolutionType:input.definition.value,direction:details.direction,amount:details.amount,
    effectiveDate:details.date,journalId,nominalAccountCode:input.definition.accountCode,
    reasonCode:input.reasonCode,notes:input.notes,posting:input.definition.posting,
    blocksReconciliation:input.blocksReconciliation,
    status:input.definition.posting === "journal" ? "posted" : "reviewed"
  });
}

function marker(core){
  return {
    status:"matched",matchedRecordType:"bankException",matchedRecordId:core.resolutionId,
    matchedAmount:core.amount,matchOrigin:"bankException",exceptionVersion:BANK_EXCEPTION_VERSION,
    exceptionResolutionId:core.resolutionId,exceptionResolutionType:core.resolutionType,
    exceptionPosting:core.posting,exceptionJournalId:core.journalId,
    exceptionReasonCode:core.reasonCode,exceptionBlocksReconciliation:core.blocksReconciliation,
    exceptionStateFingerprint:fingerprint(core)
  };
}

function assertRecord(record,core){
  if(!sameValue(coreFromRecord(record),core) || String(record?.fingerprint || "") !== fingerprint(core)){
    throw new Error("The saved exception resolution changed; no Banking data was overwritten.");
  }
}

function assertTransaction(transaction,core){
  for(const [key,value] of Object.entries(marker(core))){
    if(transaction?.[key] !== value) throw new Error("The resolved bank transaction changed; no Banking data was overwritten.");
  }
}

function assertJournal(journal,core){
  if(core.posting === "none"){
    if(journal) throw new Error("An ignored transaction has an unexpected accounting journal.");
    return;
  }
  if(!journal || String(journal.userId || "") !== core.userId ||
    String(journal.journalId || "") !== core.journalId || !validateJournal(journal).valid){
    throw new Error("The exception-resolution journal is missing, invalid, or belongs to another user.");
  }
  const expected = prepareBankExceptionJournal(core.userId,core.resolutionId,core,{
    createdAt:journal.createdAt,updatedAt:journal.updatedAt
  });
  if(!sameValue(journal,expected)) throw new Error("The exception-resolution journal changed; no Banking data was overwritten.");
}

function clearMarker(services,timestamp){
  const removed = services.deleteField();
  return {
    status:"unmatched",matchedRecordType:removed,matchedRecordId:removed,matchedAmount:removed,
    matchedAt:removed,matchOrigin:removed,exceptionVersion:removed,exceptionResolutionId:removed,
    exceptionResolutionType:removed,exceptionPosting:removed,exceptionJournalId:removed,
    exceptionReasonCode:removed,exceptionBlocksReconciliation:removed,
    exceptionStateFingerprint:removed,updatedAt:timestamp
  };
}

export function normaliseBankExceptionResolution(id,data = {}){
  return Object.freeze({
    id:String(id || data.resolutionId || ""),version:Number(data.version || 0),
    userId:String(data.userId || ""),resolutionId:String(data.resolutionId || id || ""),
    bankTransactionId:String(data.bankTransactionId || ""),bankAccountId:String(data.bankAccountId || ""),
    resolutionType:String(data.resolutionType || ""),direction:String(data.direction || ""),
    amount:Number(data.amount),effectiveDate:String(data.effectiveDate || ""),
    journalId:String(data.journalId || ""),nominalAccountCode:String(data.nominalAccountCode || ""),
    reasonCode:String(data.reasonCode || ""),notes:String(data.notes || ""),posting:String(data.posting || ""),
    blocksReconciliation:data.blocksReconciliation === true,status:String(data.status || ""),
    fingerprint:String(data.fingerprint || "")
  });
}

export async function resolveBankException(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  for(const helper of ["doc","runTransaction","serverTimestamp"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);
  const resolutionId = bankExceptionResolutionDocumentId(transactionId);
  const resolutionRef = services.doc(db,"users",userId,"bankExceptionResolutions",resolutionId);
  const deterministicJournalId = bankExceptionJournalDocumentId(userId,resolutionId);
  const journalRef = services.doc(db,"journals",deterministicJournalId);

  return services.runTransaction(db,async firestoreTransaction => {
    const transactionSnapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists or is not owned by this user.");
    const transaction = { ...transactionSnapshot.data(),id:transactionId };
    const details = transactionDetails(transaction);
    const input = validatedInput(options.input || {},details.direction);
    if(transaction.status === "unmatched" && input.definition.value === "taxPayment"){
      throw new Error("New generic Tax payment resolutions are not supported because Simple Books does not currently track the underlying tax liability.");
    }
    const core = expectedCore(userId,transactionId,details,input);
    const accountRef = services.doc(db,"users",userId,"bankAccounts",details.bankAccountId);
    const [accountSnapshot,resolutionSnapshot,journalSnapshot] = await Promise.all([
      firestoreTransaction.get(accountRef),firestoreTransaction.get(resolutionRef),firestoreTransaction.get(journalRef)
    ]);
    if(!exists(accountSnapshot)) throw new Error("Bank account no longer exists or is not owned by this user.");
    if(!["Active","Archived"].includes(String(accountSnapshot.data()?.status || ""))){
      throw new Error("Bank account is invalid.");
    }

    if(transaction.status === "matched"){
      if(transaction.matchedRecordType !== "bankException" || transaction.matchOrigin !== "bankException"){
        throw new Error("Use the existing undo action before resolving this transaction another way.");
      }
      if(!exists(resolutionSnapshot)) throw new Error("The existing exception resolution record is missing.");
      assertRecord(resolutionSnapshot.data(),core);
      assertJournal(exists(journalSnapshot) ? journalSnapshot.data() : null,core);
      assertTransaction(transaction,core);
      return Object.freeze({ status:"already-resolved",resolutionId,journalId:core.journalId });
    }
    if(transaction.status !== "unmatched") throw new Error("This bank transaction is not unresolved.");
    if(String(transaction.source || "") !== "csv") throw new Error("Only imported bank transactions can use exception resolution.");
    if(exists(resolutionSnapshot) || exists(journalSnapshot)){
      throw new Error("A deterministic exception record or journal already exists while this row is unresolved.");
    }
    if(typeof firestoreTransaction.set !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction write helpers are required.");
    }
    const timestamp = services.serverTimestamp();
    firestoreTransaction.set(resolutionRef,{ ...core,fingerprint:fingerprint(core),createdAt:timestamp,updatedAt:timestamp });
    if(core.posting === "journal"){
      firestoreTransaction.set(journalRef,prepareBankExceptionJournal(userId,resolutionId,core,{
        createdAt:timestamp,updatedAt:timestamp
      }));
    }
    firestoreTransaction.update(transactionRef,{ ...marker(core),matchedAt:timestamp,updatedAt:timestamp });
    firestoreTransaction.update(accountRef,{
      bankingActivity:{ version:1,type:"bankExceptionResolution" },updatedAt:timestamp
    });
    return Object.freeze({ status:"resolved",resolutionId,journalId:core.journalId });
  });
}

export async function unresolveBankException(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  for(const helper of ["doc","runTransaction","serverTimestamp","deleteField"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);
  return services.runTransaction(db,async firestoreTransaction => {
    const transactionSnapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists or is not owned by this user.");
    const transaction = { ...transactionSnapshot.data(),id:transactionId };
    if(transaction.status === "unmatched" && !transaction.exceptionResolutionId){
      return Object.freeze({ status:"already-unresolved",transactionId });
    }
    if(transaction.status !== "matched" || transaction.matchedRecordType !== "bankException" ||
      transaction.matchOrigin !== "bankException"){
      throw new Error("This bank transaction is not currently exception-resolved.");
    }
    const resolutionId = requiredText(transaction.exceptionResolutionId,"Exception resolution ID");
    const resolutionRef = services.doc(db,"users",userId,"bankExceptionResolutions",resolutionId);
    const journalRef = services.doc(db,"journals",bankExceptionJournalDocumentId(userId,resolutionId));
    const [resolutionSnapshot,journalSnapshot] = await Promise.all([
      firestoreTransaction.get(resolutionRef),firestoreTransaction.get(journalRef)
    ]);
    if(!exists(resolutionSnapshot)) throw new Error("The exception resolution record is missing.");
    const core = coreFromRecord(resolutionSnapshot.data());
    assertRecord(resolutionSnapshot.data(),core);
    assertJournal(exists(journalSnapshot) ? journalSnapshot.data() : null,core);
    assertTransaction(transaction,core);
    if(core.userId !== userId || core.bankTransactionId !== transactionId){
      throw new Error("The exception resolution belongs to another user or transaction.");
    }
    if(typeof firestoreTransaction.delete !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction delete and update helpers are required.");
    }
    const timestamp = services.serverTimestamp();
    if(core.posting === "journal") firestoreTransaction.delete(journalRef);
    firestoreTransaction.delete(resolutionRef);
    firestoreTransaction.update(transactionRef,clearMarker(services,timestamp));
    return Object.freeze({
      status:"unresolved",transactionId,resolutionId,journalId:core.journalId
    });
  });
}
