import {
  MATCH_CONFIDENCE_MINIMUM,
  buildMatchCandidates,
  scoreBankMatch
} from "./bank-match-suggestions.js";

export const BANK_MATCH_RECORD_COLLECTIONS = Object.freeze({
  invoice:"invoices",
  bill:"bills",
  expense:"expenses"
});

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

function sourcesFor(recordType,target){
  const key = BANK_MATCH_RECORD_COLLECTIONS[recordType];
  return { [key]:[{ ...target.data,id:target.id }] };
}

function freshCandidate(recordType,targetSnapshot,targetId){
  return buildMatchCandidates(sourcesFor(recordType,{ id:targetId,data:targetSnapshot.data() }))[0] || null;
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

  return services.runTransaction(db,async transaction => {
    const [transactionSnapshot,targetSnapshot] = await Promise.all([
      transaction.get(transactionRef),
      transaction.get(targetRef)
    ]);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists.");
    if(!exists(targetSnapshot)) throw new Error("Matched record no longer exists.");

    const bankTransaction = transactionSnapshot.data();
    if(bankTransaction.status === "matched"){
      if(bankTransaction.matchedRecordType !== matchedRecordType ||
        String(bankTransaction.matchedRecordId || "") !== matchedRecordId){
        throw new Error("Bank transaction is already matched to a different record.");
      }
    }
    if(bankTransaction.status !== undefined && !["unmatched","matched"].includes(bankTransaction.status)){
      throw new Error("Bank transaction has an invalid match state.");
    }

    const candidate = freshCandidate(matchedRecordType,targetSnapshot,matchedRecordId);
    if(!candidate) throw new Error("Matched record is no longer eligible.");
    const score = scoreBankMatch({ ...bankTransaction,status:"unmatched" },candidate);
    if(score.confidence < MATCH_CONFIDENCE_MINIMUM) throw new Error("Suggested match is no longer valid.");
    if(bankTransaction.status === "matched"){
      return Object.freeze({ status:"already-confirmed",transactionId,matchedRecordType,matchedRecordId });
    }
    const amount = Math.abs(Number(candidate.direction === "in" ? bankTransaction.moneyIn : bankTransaction.moneyOut));
    if(!Number.isFinite(amount) || amount <= 0) throw new Error("Bank transaction amount is invalid.");
    const timestamp = services.serverTimestamp();
    const update = {
      status:"matched",
      matchedRecordType,
      matchedRecordId,
      matchedAt:timestamp,
      matchedAmount:amount,
      updatedAt:timestamp
    };
    transaction.update(transactionRef,update);
    return Object.freeze({ status:"confirmed",transactionId,matchedRecordType,matchedRecordId,matchedAmount:amount });
  });
}

export async function unmatchBankTransaction(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  requireServices(services,["doc","runTransaction","serverTimestamp","deleteField"]);
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);

  return services.runTransaction(db,async transaction => {
    const snapshot = await transaction.get(transactionRef);
    if(!exists(snapshot)) throw new Error("Bank transaction no longer exists.");
    if(snapshot.data().status !== "matched") throw new Error("Bank transaction is not currently matched.");
    const removed = services.deleteField();
    transaction.update(transactionRef,{
      status:"unmatched",
      matchedRecordType:removed,
      matchedRecordId:removed,
      matchedAt:removed,
      matchedAmount:removed,
      updatedAt:services.serverTimestamp()
    });
    return Object.freeze({ status:"unmatched",transactionId });
  });
}
