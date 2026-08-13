import {
  MATCH_CONFIDENCE_MINIMUM,
  buildMatchCandidates,
  scoreBankMatch
} from "./bank-match-suggestions.js";
import {
  createBankSettlementJournal,
  normaliseBankTransactionDate,
  validateJournal
} from "./ledger-engine.js";
import {
  bankSettlementJournalDocumentId,
  journalDocumentId,
  prepareBankSettlementJournal
} from "./ledger-firestore.js";

export const BANK_MATCH_RECORD_COLLECTIONS = Object.freeze({
  invoice:"invoices",
  bill:"bills",
  expense:"expenses"
});

const BANK_SETTLEMENT_VERSION = 1;

function requiredText(value,label){
  const text = String(value || "").trim();
  if(!text) throw new Error(`${label} is required.`);
  return text;
}

function requireServices(services,names){
  names.forEach(name => {
    if(typeof services?.[name] !== "function") throw new Error(`Firestore ${name} helper is required.`);
  });
}

function exists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function hasOwn(value,key){
  return Boolean(value && Object.prototype.hasOwnProperty.call(value,key));
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

function sourcesFor(recordType,targetId,targetData,statusOverride){
  const key = BANK_MATCH_RECORD_COLLECTIONS[recordType];
  return { [key]:[{ ...targetData,id:targetId,...(statusOverride ? { status:statusOverride } : {}) }] };
}

function candidateFor(recordType,targetId,targetData,statusOverride){
  return buildMatchCandidates(sourcesFor(recordType,targetId,targetData,statusOverride))[0] || null;
}

function exactMatch(transaction,recordType,targetId,targetData,statusOverride){
  const candidate = candidateFor(recordType,targetId,targetData,statusOverride);
  if(!candidate) throw new Error("Matched record is no longer eligible.");
  const score = scoreBankMatch({ ...transaction,status:"unmatched" },candidate);
  if(score.confidence < MATCH_CONFIDENCE_MINIMUM) throw new Error("Suggested match is no longer valid.");
  const amount = Math.abs(Number(candidate.direction === "in" ? transaction.moneyIn : transaction.moneyOut));
  if(!Number.isFinite(amount) || amount <= 0) throw new Error("Bank transaction amount is invalid.");
  return { candidate,amount };
}

function sourceTypeFor(recordType,targetData){
  if(recordType === "invoice") return "salesInvoice";
  if(recordType === "bill") return "supplierBill";
  return String(targetData?.type || "").trim().toLowerCase() === "mileage"
    ? "mileageClaim"
    : "expenseClaim";
}

function accrualAccountFor(recordType){
  if(recordType === "invoice") return { code:"1100",normalSide:"debit" };
  if(recordType === "bill") return { code:"2000",normalSide:"credit" };
  return { code:"2200",normalSide:"credit" };
}

function moneyInCents(value){
  return Math.round(Number(value) * 100);
}

function validateAccrualJournal(journal,userId,sourceType,sourceId,recordType,amount){
  if(!journal || String(journal.userId || "") !== userId ||
    String(journal.sourceType || "") !== sourceType || String(journal.sourceId || "") !== sourceId){
    throw new Error("The source accrual journal is missing or does not belong to this record.");
  }
  const validation = validateJournal(journal);
  if(!validation.valid) throw new Error("The source accrual journal is invalid.");
  const account = accrualAccountFor(recordType);
  const balance = journal.lines.filter(line => String(line.accountCode) === account.code)
    .reduce((total,line) => total + (account.normalSide === "debit"
      ? Number(line.debit || 0) - Number(line.credit || 0)
      : Number(line.credit || 0) - Number(line.debit || 0)),0);
  if(moneyInCents(balance) !== moneyInCents(amount)){
    throw new Error("The source accrual journal no longer matches the record total.");
  }
}

function paymentDateSupported(recordType){
  return recordType === "bill" || recordType === "expense";
}

function previousStatus(recordType,targetData){
  const status = String(targetData?.status || "").trim();
  if(status) return status;
  return recordType === "expense" ? "Draft" : "Unpaid";
}

function settlementMarker(transactionId,journalId,recordType,targetData,paymentDate,amount){
  return {
    version:BANK_SETTLEMENT_VERSION,
    transactionId,
    journalId,
    previousStatus:previousStatus(recordType,targetData),
    hadPaidAt:hasOwn(targetData,"paidAt"),
    previousPaidAt:hasOwn(targetData,"paidAt") ? targetData.paidAt : null,
    paymentDateApplied:paymentDateSupported(recordType),
    paymentDate:paymentDateSupported(recordType) ? paymentDate : null,
    amount,
    sourceFingerprint:sourceFingerprint(targetData)
  };
}

function legacyRecoveryError(reason,details = {}){
  const error = new Error("The source record no longer has the expected Banking settlement marker.");
  error.code = "BANK_LEGACY_SETTLEMENT_RECOVERY_FAILED";
  error.bankMatchDiagnostic = Object.freeze({ reason,...details });
  return error;
}

function legacyMissingExpenseMarkerEligibility(transaction,targetData,recordType){
  if(recordType !== "expense") return { eligible:false,reason:"source-record-type-not-eligible" };
  if(hasOwn(targetData,"bankSettlement")) return { eligible:false,reason:"bank-settlement-field-present" };
  if(hasOwn(targetData,"paidAt")) return { eligible:false,reason:"paid-at-field-present" };
  if(!["expense","mileage"].includes(String(targetData?.type || "").trim().toLowerCase())){
    return { eligible:false,reason:"source-type-not-eligible" };
  }
  if(!["Draft","Submitted","Approved"].includes(String(targetData?.status || ""))){
    return { eligible:false,reason:"current-status-not-eligible" };
  }
  if(!hasOwn(transaction,"matchedAt") || !transaction.matchedAt){
    return { eligible:false,reason:"transaction-matched-at-missing" };
  }
  if(!String(transaction.settlementStateFingerprint || "")){
    return { eligible:false,reason:"transaction-settlement-fingerprint-missing" };
  }
  return { eligible:true,reason:"eligible" };
}

const HISTORICAL_EXPENSE_DEFAULTS = Object.freeze({
  type:"expense",from:"",to:"",businessPurpose:"",miles:0,ratePerMile:0,amount:0,
  attachmentName:"",attachmentUrl:"",attachmentPath:"",attachmentSize:0,attachmentType:"",
  projectId:"",projectName:"",projectReference:""
});

const HISTORICAL_EXPENSE_SCHEMA_VARIANTS = Object.freeze([
  Object.freeze({
    name:"before-project-allocation",
    absentFields:Object.freeze(["projectId","projectName","projectReference"])
  }),
  Object.freeze({
    name:"before-mileage-attachment-type",
    absentFields:Object.freeze(["attachmentType","projectId","projectName","projectReference"])
  }),
  Object.freeze({
    name:"before-mileage-claims",
    absentFields:Object.freeze([
      "type","from","to","businessPurpose","miles","ratePerMile","amount","attachmentType",
      "projectId","projectName","projectReference"
    ])
  }),
  Object.freeze({
    name:"initial-expenses-schema",
    absentFields:Object.freeze([
      "type","from","to","businessPurpose","miles","ratePerMile","amount",
      "attachmentName","attachmentUrl","attachmentPath","attachmentSize","attachmentType",
      "projectId","projectName","projectReference"
    ])
  })
]);

function reconstructedMarker(transaction,journal,journalId,amount,previousStatus,sourceHash){
  return {
    version:BANK_SETTLEMENT_VERSION,
    transactionId:String(transaction.id || ""),
    journalId,
    previousStatus,
    hadPaidAt:false,
    previousPaidAt:null,
    paymentDateApplied:true,
    paymentDate:`${journal.date}T00:00:00.000Z`,
    amount,
    sourceFingerprint:sourceHash
  };
}

function recoverLegacyMissingExpenseMarker({ transaction,targetData,journal,journalId,amount }){
  const sourceHash = sourceFingerprint(targetData);
  const candidates = ["Draft","Submitted","Approved"]
    .map(status => reconstructedMarker(transaction,journal,journalId,amount,status,sourceHash))
    .filter(marker => valueFingerprint(marker) === String(transaction.settlementStateFingerprint));
  return { marker:candidates.length === 1 ? candidates[0] : null,matchCount:candidates.length };
}

function diagnoseHistoricalMarkerMismatch({ transaction,targetData,journal,journalId,amount }){
  const persisted = String(transaction.settlementStateFingerprint || "");
  const historicalSourceShapeMatches = [];
  HISTORICAL_EXPENSE_SCHEMA_VARIANTS.forEach(variant => {
    if(!variant.absentFields.every(field => hasOwn(targetData,field) &&
      sameValue(targetData[field],HISTORICAL_EXPENSE_DEFAULTS[field]))) return;
    const historicalSource = { ...targetData };
    variant.absentFields.forEach(field => delete historicalSource[field]);
    const sourceHash = sourceFingerprint(historicalSource);
    ["Draft","Submitted","Approved"].forEach(status => {
      const marker = reconstructedMarker(transaction,journal,journalId,amount,status,sourceHash);
      if(valueFingerprint(marker) === persisted){
        historicalSourceShapeMatches.push({
          schemaVariant:variant.name,previousStatus:status,
          fieldsMaterialisedByLegacySave:[...variant.absentFields]
        });
      }
    });
  });
  const currentSourceHash = sourceFingerprint(targetData);
  const nonstandardPreviousStatusMatches = ["Unpaid"].filter(status =>
    valueFingerprint(reconstructedMarker(transaction,journal,journalId,amount,status,currentSourceHash)) === persisted
  );
  return { historicalSourceShapeMatches,nonstandardPreviousStatusMatches };
}

function legacyMisparsedBankTransactionDate(value){
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if(!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]) + 2000;
  const check = new Date(Date.UTC(year,month - 1,day));
  if(check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day){
    return "";
  }
  const legacyDate = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  return legacyDate === normaliseBankTransactionDate(raw) ? "" : legacyDate;
}

function settlementJournalValidation(
  journal,userId,journalId,transaction,targetData,recordType,recordId,amount,
  { allowLegacyDate = false } = {}
){
  if(!journal) return { valid:false,legacyDate:"",reason:"journal-missing" };
  if(String(journal.userId || "") !== userId) return { valid:false,legacyDate:"",reason:"journal-owner-mismatch" };
  if(String(journal.journalId || "") !== journalId) return { valid:false,legacyDate:"",reason:"journal-id-mismatch" };
  if(String(journal.sourceType || "") !== "bankSettlement") return { valid:false,legacyDate:"",reason:"journal-source-type-mismatch" };
  if(String(journal.sourceId || "") !== String(transaction.id || "") ||
    String(journal.bankTransactionId || "") !== String(transaction.id || "")){
    return { valid:false,legacyDate:"",reason:"journal-transaction-mismatch" };
  }
  if(String(journal.bankAccountId || "") !== String(transaction.bankAccountId || "")){
    return { valid:false,legacyDate:"",reason:"journal-bank-account-mismatch" };
  }
  if(String(journal.matchedRecordType || "") !== recordType || String(journal.matchedRecordId || "") !== recordId){
    return { valid:false,legacyDate:"",reason:"journal-source-record-mismatch" };
  }
  const expected = createBankSettlementJournal({
    transactionId:transaction.id,
    transactionDate:transaction.transactionDate,
    recordType,
    recordId,
    isMileage:String(targetData?.type || "").trim().toLowerCase() === "mileage",
    amount
  });
  if(String(journal.sourceNumber || "") !== recordId) return { valid:false,legacyDate:"",reason:"journal-source-number-mismatch" };
  if(String(journal.description || "") !== expected.description) return { valid:false,legacyDate:"",reason:"journal-description-mismatch" };
  if(!sameValue(journal.lines,expected.lines)) return { valid:false,legacyDate:"",reason:"journal-lines-mismatch" };
  if(!validateJournal(journal).valid) return { valid:false,legacyDate:"",reason:"journal-invalid" };
  if(journal.date === expected.date) return { valid:true,legacyDate:"",reason:"valid" };
  const legacyDate = allowLegacyDate
    ? legacyMisparsedBankTransactionDate(transaction.transactionDate)
    : "";
  return {
    valid:Boolean(legacyDate && journal.date === legacyDate),
    legacyDate:journal.date === legacyDate ? legacyDate : "",
    reason:legacyDate && journal.date === legacyDate ? "valid-legacy-date" : "journal-date-mismatch"
  };
}

function validatePersistedSettlement({
  transaction,targetData,journal,userId,recordType,recordId,journalId,allowLegacyDate = false
}){
  let marker = targetData?.bankSettlement;
  let recoveredMissingSourceMarker = false;
  let match;
  let journalValidation;
  const recoveryEligibility = !marker
    ? legacyMissingExpenseMarkerEligibility(transaction,targetData,recordType)
    : null;
  if(!marker && recoveryEligibility.eligible){
    try{
      match = exactMatch(transaction,recordType,recordId,targetData,"Draft");
    }catch(error){
      throw legacyRecoveryError("source-match-validation-failed",{
        validationMessage:String(error?.message || "Match validation failed.")
      });
    }
    if(moneyInCents(match.amount) !== moneyInCents(transaction.matchedAmount)){
      throw legacyRecoveryError("matched-amount-mismatch");
    }
    journalValidation = settlementJournalValidation(
      journal,userId,journalId,transaction,targetData,recordType,recordId,match.amount,
      { allowLegacyDate }
    );
    if(!journalValidation.valid){
      throw legacyRecoveryError(journalValidation.reason || "settlement-journal-validation-failed");
    }
    const reconstructed = recoverLegacyMissingExpenseMarker({
      transaction,targetData,journal,journalId,amount:match.amount
    });
    marker = reconstructed.marker;
    recoveredMissingSourceMarker = Boolean(marker);
    if(!marker){
      const mismatch = diagnoseHistoricalMarkerMismatch({
        transaction,targetData,journal,journalId,amount:match.amount
      });
      const reason = reconstructed.matchCount > 1
        ? "multiple-reconstructed-markers-match"
        : mismatch.historicalSourceShapeMatches.length === 1
          ? "historical-source-schema-normalisation-match-found"
          : mismatch.historicalSourceShapeMatches.length > 1
            ? "multiple-historical-source-schema-matches"
            : mismatch.nonstandardPreviousStatusMatches.length === 1
              ? "nonstandard-previous-status-match-found"
              : "no-reconstructed-marker-matches-persisted-fingerprint";
      throw legacyRecoveryError(reconstructed.matchCount > 1
        ? "multiple-reconstructed-markers-match"
        : reason,{
        reconstructedMarkerMatchCount:reconstructed.matchCount,
        attemptedPreviousStatuses:["Draft","Submitted","Approved"],
        assumedPriorPaidAt:false,
        ...mismatch,
        unresolvedPossibilities:Object.freeze([
          "the original marker recorded a paidAt value that the legacy save erased",
          "the legacy save changed or removed source fields outside the known committed schema epochs"
        ])
      });
    }
  }
  if(!marker) throw legacyRecoveryError(recoveryEligibility?.reason || "source-settlement-marker-missing");
  if(Number(marker.version) !== BANK_SETTLEMENT_VERSION) throw legacyRecoveryError("source-marker-version-mismatch");
  if(String(marker.transactionId || "") !== String(transaction.id || "")) throw legacyRecoveryError("source-marker-transaction-mismatch");
  if(String(marker.journalId || "") !== journalId) throw legacyRecoveryError("source-marker-journal-id-mismatch");
  if(String(transaction.settlementStateFingerprint || "") !== valueFingerprint(marker)){
    throw new Error("The source Banking settlement marker changed; it was not overwritten.");
  }
  if(sourceFingerprint(targetData) !== marker.sourceFingerprint){
    throw new Error("The source record changed after it was settled; it was not overwritten.");
  }
  const recoveringManualPaymentState = targetData.status !== "Paid";
  const hasPaidAt = hasOwn(targetData,"paidAt");
  if(!recoveringManualPaymentState && marker.paymentDateApplied){
    if(!hasPaidAt || !sameValue(targetData.paidAt,marker.paymentDate)){
      throw new Error("The source payment date changed after settlement; it was not overwritten.");
    }
  }else if(!recoveringManualPaymentState && (hasPaidAt !== Boolean(marker.hadPaidAt) ||
    (hasPaidAt && !sameValue(targetData.paidAt,marker.previousPaidAt)))){
    throw new Error("The source payment state changed after settlement; it was not overwritten.");
  }
  match = match || exactMatch(transaction,recordType,recordId,targetData,marker.previousStatus);
  if(moneyInCents(match.amount) !== moneyInCents(marker.amount) ||
    moneyInCents(match.amount) !== moneyInCents(transaction.matchedAmount)){
    throw new Error("The settled amount no longer matches the bank transaction.");
  }
  journalValidation = journalValidation || settlementJournalValidation(
    journal,userId,journalId,transaction,targetData,recordType,recordId,match.amount,
    { allowLegacyDate }
  );
  if(!journalValidation.valid){
    throw new Error("The Banking settlement journal changed or is invalid.");
  }
  if(journalValidation.legacyDate && marker.paymentDateApplied &&
    marker.paymentDate !== `${journalValidation.legacyDate}T00:00:00.000Z`){
    throw new Error("The legacy Banking payment date does not match its settlement journal.");
  }
  return {
    marker,amount:match.amount,recoveredManualPaymentState:recoveringManualPaymentState,
    recoveredMissingSourceMarker
  };
}

function clearMatchUpdate(services,timestamp){
  const removed = services.deleteField();
  return {
    status:"unmatched",
    matchedRecordType:removed,
    matchedRecordId:removed,
    matchedAt:removed,
    matchedAmount:removed,
    settlementJournalId:removed,
    settlementVersion:removed,
    settlementStateFingerprint:removed,
    updatedAt:timestamp
  };
}

export async function confirmBankMatch(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  const matchedRecordType = requiredText(options.matchedRecordType,"Matched record type");
  const matchedRecordId = requiredText(options.matchedRecordId,"Matched record ID");
  const targetCollection = BANK_MATCH_RECORD_COLLECTIONS[matchedRecordType];
  if(!targetCollection) throw new Error("Unsupported matched record type.");
  requireServices(services,["doc","runTransaction","serverTimestamp"]);

  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);
  const targetRef = services.doc(db,"users",userId,targetCollection,matchedRecordId);

  return services.runTransaction(db,async firestoreTransaction => {
    const [transactionSnapshot,targetSnapshot] = await Promise.all([
      firestoreTransaction.get(transactionRef),
      firestoreTransaction.get(targetRef)
    ]);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists.");
    if(!exists(targetSnapshot)) throw new Error("Matched record no longer exists.");

    const bankTransaction = { ...transactionSnapshot.data(),id:transactionId };
    const targetData = targetSnapshot.data();
    const sameRelationship = bankTransaction.status === "matched" &&
      bankTransaction.matchedRecordType === matchedRecordType &&
      String(bankTransaction.matchedRecordId || "") === matchedRecordId;
    if(bankTransaction.status === "matched" && !sameRelationship){
      throw new Error("Bank transaction is already matched to a different record.");
    }
    if(bankTransaction.status !== undefined && !["unmatched","matched"].includes(bankTransaction.status)){
      throw new Error("Bank transaction has an invalid match state.");
    }

    if(sameRelationship && !bankTransaction.settlementJournalId){
      exactMatch(bankTransaction,matchedRecordType,matchedRecordId,targetData);
      return Object.freeze({
        status:"already-confirmed",transactionId,matchedRecordType,matchedRecordId,
        matchedAmount:Number(bankTransaction.matchedAmount),settled:false
      });
    }

    const settlementJournalId = bankSettlementJournalDocumentId(userId,transactionId);
    if(sameRelationship && bankTransaction.settlementJournalId !== settlementJournalId){
      throw new Error("Bank transaction has an unexpected settlement journal reference.");
    }
    if(sameRelationship && Number(bankTransaction.settlementVersion) !== BANK_SETTLEMENT_VERSION){
      throw new Error("Bank transaction has an unsupported settlement version.");
    }
    const settlementRef = services.doc(db,"journals",settlementJournalId);

    if(sameRelationship){
      const settlementSnapshot = await firestoreTransaction.get(settlementRef);
      if(!exists(settlementSnapshot)) throw new Error("The Banking settlement journal is missing.");
      const validated = validatePersistedSettlement({
        transaction:bankTransaction,targetData,journal:settlementSnapshot.data(),userId,
        recordType:matchedRecordType,recordId:matchedRecordId,journalId:settlementJournalId
      });
      return Object.freeze({
        status:"already-confirmed",transactionId,matchedRecordType,matchedRecordId,
        matchedAmount:validated.amount,settled:true,settlementJournalId
      });
    }

    if(targetData.bankSettlement){
      throw new Error("Matched record is already settled by another bank transaction.");
    }
    const match = exactMatch(bankTransaction,matchedRecordType,matchedRecordId,targetData);
    const sourceType = sourceTypeFor(matchedRecordType,targetData);
    const accrualJournalId = journalDocumentId(userId,sourceType,matchedRecordId);
    const accrualRef = services.doc(db,"journals",accrualJournalId);
    const [accrualSnapshot,settlementSnapshot] = await Promise.all([
      firestoreTransaction.get(accrualRef),
      firestoreTransaction.get(settlementRef)
    ]);
    if(!exists(accrualSnapshot)) throw new Error("The source accrual journal is missing; settlement was not posted.");
    validateAccrualJournal(
      accrualSnapshot.data(),userId,sourceType,matchedRecordId,matchedRecordType,match.amount
    );
    if(exists(settlementSnapshot)){
      throw new Error("A settlement journal already exists for this bank transaction.");
    }
    if(typeof firestoreTransaction.set !== "function") throw new Error("Firestore transaction set helper is required.");

    const timestamp = services.serverTimestamp();
    const paymentDate = createBankSettlementJournal({
      transactionId,transactionDate:bankTransaction.transactionDate,
      recordType:matchedRecordType,recordId:matchedRecordId,
      isMileage:String(targetData?.type || "").trim().toLowerCase() === "mileage",
      amount:match.amount
    }).date;
    const marker = settlementMarker(
      transactionId,settlementJournalId,matchedRecordType,targetData,
      `${paymentDate}T00:00:00.000Z`,match.amount
    );
    const journal = prepareBankSettlementJournal(userId,transactionId,{
      transactionDate:bankTransaction.transactionDate,
      bankAccountId:bankTransaction.bankAccountId,
      recordType:matchedRecordType,
      recordId:matchedRecordId,
      isMileage:String(targetData?.type || "").trim().toLowerCase() === "mileage",
      amount:match.amount
    },{ createdAt:timestamp,updatedAt:timestamp });
    const sourceUpdate = {
      status:"Paid",
      bankSettlement:marker,
      updatedAt:timestamp
    };
    if(marker.paymentDateApplied) sourceUpdate.paidAt = marker.paymentDate;

    firestoreTransaction.set(settlementRef,journal);
    firestoreTransaction.update(targetRef,sourceUpdate);
    firestoreTransaction.update(transactionRef,{
      status:"matched",
      matchedRecordType,
      matchedRecordId,
      matchedAt:timestamp,
      matchedAmount:match.amount,
      settlementJournalId,
      settlementVersion:BANK_SETTLEMENT_VERSION,
      settlementStateFingerprint:valueFingerprint(marker),
      updatedAt:timestamp
    });
    return Object.freeze({
      status:"confirmed",transactionId,matchedRecordType,matchedRecordId,
      matchedAmount:match.amount,settled:true,settlementJournalId
    });
  });
}

export async function unmatchBankTransaction(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  requireServices(services,["doc","runTransaction","serverTimestamp","deleteField"]);
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);

  return services.runTransaction(db,async firestoreTransaction => {
    const snapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(snapshot)) throw new Error("Bank transaction no longer exists.");
    const bankTransaction = { ...snapshot.data(),id:transactionId };
    if(bankTransaction.status !== "matched") throw new Error("Bank transaction is not currently matched.");
    const timestamp = services.serverTimestamp();

    if(!bankTransaction.settlementJournalId){
      firestoreTransaction.update(transactionRef,clearMatchUpdate(services,timestamp));
      return Object.freeze({ status:"unmatched",transactionId,settlementReversed:false });
    }

    const matchedRecordType = requiredText(bankTransaction.matchedRecordType,"Matched record type");
    const matchedRecordId = requiredText(bankTransaction.matchedRecordId,"Matched record ID");
    const targetCollection = BANK_MATCH_RECORD_COLLECTIONS[matchedRecordType];
    if(!targetCollection) throw new Error("Unsupported matched record type.");
    const expectedJournalId = bankSettlementJournalDocumentId(userId,transactionId);
    if(bankTransaction.settlementJournalId !== expectedJournalId){
      throw new Error("Bank transaction has an unexpected settlement journal reference.");
    }
    if(Number(bankTransaction.settlementVersion) !== BANK_SETTLEMENT_VERSION){
      throw new Error("Bank transaction has an unsupported settlement version.");
    }
    const targetRef = services.doc(db,"users",userId,targetCollection,matchedRecordId);
    const settlementRef = services.doc(db,"journals",expectedJournalId);
    const [targetSnapshot,settlementSnapshot] = await Promise.all([
      firestoreTransaction.get(targetRef),
      firestoreTransaction.get(settlementRef)
    ]);
    if(!exists(targetSnapshot)) throw new Error("Matched record no longer exists.");
    if(!exists(settlementSnapshot)) throw new Error("The Banking settlement journal is missing.");
    const targetData = targetSnapshot.data();
    const validated = validatePersistedSettlement({
      transaction:bankTransaction,targetData,journal:settlementSnapshot.data(),userId,
      recordType:matchedRecordType,recordId:matchedRecordId,journalId:expectedJournalId,
      allowLegacyDate:true
    });
    if(typeof firestoreTransaction.delete !== "function") throw new Error("Firestore transaction delete helper is required.");

    const removed = services.deleteField();
    const sourceUpdate = {
      status:validated.marker.previousStatus,
      bankSettlement:removed,
      updatedAt:timestamp
    };
    if(validated.marker.paymentDateApplied){
      sourceUpdate.paidAt = validated.marker.hadPaidAt
        ? validated.marker.previousPaidAt
        : removed;
    }
    firestoreTransaction.delete(settlementRef);
    firestoreTransaction.update(targetRef,sourceUpdate);
    firestoreTransaction.update(transactionRef,clearMatchUpdate(services,timestamp));
    return Object.freeze({
      status:"unmatched",transactionId,settlementReversed:true,
      restoredStatus:validated.marker.previousStatus,
      recoveredManualPaymentState:validated.recoveredManualPaymentState,
      recoveredMissingSourceMarker:validated.recoveredMissingSourceMarker
    });
  });
}
