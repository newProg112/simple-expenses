import { normaliseBankTransactionDate,validateJournal } from "./ledger-engine.js";
import {
  bankTransferJournalDocumentId,
  prepareBankTransferJournal
} from "./ledger-firestore.js";

export const BANK_TRANSFER_VERSION = 1;
export const BANK_TRANSFER_STATUS = "posted";
export const BANK_TRANSFER_PAIRING_WINDOW_DAYS = 3;
export const BANK_TRANSFER_ARCHIVED_ACCOUNT_POLICY =
  "Archived owned accounts remain selectable for historical transfers.";

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

function currency(value,label = "Transfer amount"){
  const amount = Number(value);
  if(!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero.`);
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  if(Math.abs(amount - rounded) > 1e-8) throw new Error(`${label} must have no more than two decimal places.`);
  return rounded;
}

function transactionDirection(transaction){
  const moneyIn = transaction?.moneyIn === null || transaction?.moneyIn === undefined || transaction?.moneyIn === ""
    ? 0 : Number(transaction.moneyIn);
  const moneyOut = transaction?.moneyOut === null || transaction?.moneyOut === undefined || transaction?.moneyOut === ""
    ? 0 : Number(transaction.moneyOut);
  if(!Number.isFinite(moneyIn) || !Number.isFinite(moneyOut) ||
    (moneyIn > 0 && moneyOut > 0) || (moneyIn <= 0 && moneyOut <= 0)){
    throw new Error("The bank transaction must contain either positive Money In or positive Money Out.");
  }
  return moneyOut > 0
    ? { role:"source",amount:currency(moneyOut),oppositeRole:"destination" }
    : { role:"destination",amount:currency(moneyIn),oppositeRole:"source" };
}

function transactionDate(transaction){
  const date = normaliseBankTransactionDate(transaction?.transactionDate);
  if(!date) throw new Error("The bank transaction has an invalid date.");
  return date;
}

function dateDistance(left,right){
  const leftDate = normaliseBankTransactionDate(left);
  const rightDate = normaliseBankTransactionDate(right);
  if(!leftDate || !rightDate) return Number.POSITIVE_INFINITY;
  return Math.abs(Date.parse(`${leftDate}T00:00:00Z`) - Date.parse(`${rightDate}T00:00:00Z`)) / 86400000;
}

function safeId(value){
  return encodeURIComponent(requiredText(value,"Identifier"));
}

export function bankTransferDocumentId(transactionIds){
  const ids = (Array.isArray(transactionIds) ? transactionIds : [transactionIds])
    .map(id => requiredText(id,"Bank transaction ID"))
    .sort((left,right) => left.localeCompare(right));
  if(!ids.length || new Set(ids).size !== ids.length) throw new Error("Bank transfer transaction IDs must be unique.");
  return `bank-transfer_${ids.map(safeId).join("_")}`;
}

export function bankTransferLinkDocumentId(sourceBankAccountId,destinationBankAccountId,amount){
  const cents = Math.round(currency(amount) * 100);
  return `bank-transfer-link_${safeId(sourceBankAccountId)}_${safeId(destinationBankAccountId)}_${cents}`;
}

export function bankTransferEligibility(transaction){
  try{
    if(String(transaction?.status || "") !== "unmatched"){
      return Object.freeze({ eligible:false,reason:"Undo the existing match or categorisation before creating a transfer." });
    }
    const bankAccountId = requiredText(transaction?.bankAccountId,"Bank account ID");
    const date = transactionDate(transaction);
    const direction = transactionDirection(transaction);
    return Object.freeze({ eligible:true,bankAccountId,date,...direction });
  }catch(error){
    return Object.freeze({ eligible:false,reason:error.message });
  }
}

function directionAccounts(transaction,otherBankAccountId){
  const currentBankAccountId = requiredText(transaction?.bankAccountId,"Bank account ID");
  const otherId = requiredText(otherBankAccountId,"Other bank account ID");
  if(currentBankAccountId === otherId) throw new Error("Choose a different bank account for the other side of the transfer.");
  const direction = transactionDirection(transaction);
  return {
    ...direction,
    sourceBankAccountId:direction.role === "source" ? currentBankAccountId : otherId,
    destinationBankAccountId:direction.role === "destination" ? currentBankAccountId : otherId
  };
}

function validAccountSnapshot(snapshot,label){
  if(!exists(snapshot)) throw new Error(`${label} no longer exists or is not owned by this user.`);
  const status = String(snapshot.data()?.status || "");
  if(!["Active","Archived"].includes(status)) throw new Error(`${label} is invalid.`);
  return snapshot.data();
}

function transferCore({ userId,transferId,sourceBankAccountId,destinationBankAccountId,amount,effectiveDate,journalId }){
  const date = normaliseBankTransactionDate(effectiveDate);
  if(!date) throw new Error("A valid bank transfer effective date is required.");
  return Object.freeze({
    version:BANK_TRANSFER_VERSION,
    userId,
    transferId,
    sourceBankAccountId,
    destinationBankAccountId,
    amount:currency(amount),
    effectiveDate:date,
    journalId,
    status:BANK_TRANSFER_STATUS
  });
}

function transferRecordCore(record){
  return transferCore({
    userId:String(record?.userId || ""),transferId:String(record?.transferId || ""),
    sourceBankAccountId:String(record?.sourceBankAccountId || ""),
    destinationBankAccountId:String(record?.destinationBankAccountId || ""),
    amount:Number(record?.amount),effectiveDate:String(record?.effectiveDate || ""),
    journalId:String(record?.journalId || "")
  });
}

function transferMarker(core,role,pairedBankTransactionId = ""){
  return {
    status:"matched",matchedRecordType:"bankTransfer",matchedRecordId:core.transferId,
    matchedAmount:core.amount,matchOrigin:"bankTransfer",transferVersion:BANK_TRANSFER_VERSION,
    transferId:core.transferId,transferJournalId:core.journalId,transferRole:role,
    transferStateFingerprint:fingerprint(core),
    ...(pairedBankTransactionId ? { pairedBankTransactionId } : {})
  };
}

function assertTransferRecord(record,core){
  const actual = transferRecordCore(record);
  if(!sameValue(actual,core) || String(record?.fingerprint || "") !== fingerprint(core)){
    throw new Error("The saved bank transfer changed; no Banking data was overwritten.");
  }
  return actual;
}

function assertTransferJournal(journal,core){
  if(!journal || String(journal.userId || "") !== core.userId ||
    String(journal.journalId || "") !== core.journalId || !validateJournal(journal).valid){
    throw new Error("The bank transfer journal is missing, invalid, or belongs to another user.");
  }
  const expected = prepareBankTransferJournal(core.userId,core.transferId,core,{
    createdAt:journal.createdAt,updatedAt:journal.updatedAt
  });
  if(!sameValue(journal,expected)) throw new Error("The bank transfer journal changed; no Banking data was overwritten.");
}

function assertTransferTransaction(transaction,core,role){
  const expected = transferMarker(core,role,String(transaction?.pairedBankTransactionId || ""));
  for(const [key,value] of Object.entries(expected)){
    if(transaction?.[key] !== value) throw new Error("A linked bank transaction changed; no Banking data was overwritten.");
  }
  if(String(transaction?.bankAccountId || "") !==
    (role === "source" ? core.sourceBankAccountId : core.destinationBankAccountId)){
    throw new Error("A linked bank transaction has an unexpected bank account.");
  }
}

function candidateCompatible(candidate,effectiveDate){
  return Number(candidate?.version) === BANK_TRANSFER_VERSION &&
    String(candidate?.transferId || "").trim() &&
    ["source","destination"].includes(String(candidate?.missingRole || "")) &&
    dateDistance(candidate?.effectiveDate,effectiveDate) <= BANK_TRANSFER_PAIRING_WINDOW_DAYS;
}

function linkRecord(userId,sourceBankAccountId,destinationBankAccountId,amount,candidates,timestamp){
  return {
    version:BANK_TRANSFER_VERSION,userId,sourceBankAccountId,destinationBankAccountId,
    amount:currency(amount),candidates,updatedAt:timestamp
  };
}

function removeCandidate(candidates,transferId){
  return (Array.isArray(candidates) ? candidates : []).filter(candidate => candidate?.transferId !== transferId);
}

function normalisedTransfer(id,data = {}){
  return {
    id:String(id || data.transferId || ""),version:Number(data.version || 0),
    userId:String(data.userId || ""),transferId:String(data.transferId || id || ""),
    sourceBankAccountId:String(data.sourceBankAccountId || ""),
    destinationBankAccountId:String(data.destinationBankAccountId || ""),
    amount:Number(data.amount),effectiveDate:String(data.effectiveDate || ""),
    sourceTransactionId:String(data.sourceTransactionId || ""),
    destinationTransactionId:String(data.destinationTransactionId || ""),
    journalId:String(data.journalId || ""),fingerprint:String(data.fingerprint || ""),
    status:String(data.status || "")
  };
}

export function normaliseBankTransfer(id,data = {}){
  return Object.freeze(normalisedTransfer(id,data));
}

export function bankTransferCandidates(options = {}){
  const transaction = options.transaction;
  const otherBankAccountId = String(options.otherBankAccountId || "").trim();
  const eligibility = bankTransferEligibility(transaction);
  if(!eligibility.eligible || !otherBankAccountId || otherBankAccountId === eligibility.bankAccountId) return Object.freeze([]);
  const direction = directionAccounts(transaction,otherBankAccountId);
  const transactionCandidates = (Array.isArray(options.transactions) ? options.transactions : [])
    .filter(candidate => String(candidate?.id || "") !== String(transaction?.id || "") &&
      String(candidate?.bankAccountId || "") === otherBankAccountId && String(candidate?.status || "") === "unmatched")
    .flatMap(candidate => {
      try{
        const candidateDirection = transactionDirection(candidate);
        const distance = dateDistance(transaction.transactionDate,candidate.transactionDate);
        return candidateDirection.role === direction.oppositeRole && candidateDirection.amount === direction.amount &&
          distance <= BANK_TRANSFER_PAIRING_WINDOW_DAYS
          ? [{ type:"transaction",id:String(candidate.id),date:String(candidate.transactionDate || ""),dateDistance:distance,
            label:`Pair ${candidate.transactionDate}: ${candidate.description || candidate.id}` }]
          : [];
      }catch{return [];}
    });
  const transferCandidates = (Array.isArray(options.transfers) ? options.transfers : [])
    .map(item => normalisedTransfer(item?.id,item))
    .filter(transfer => transfer.version === BANK_TRANSFER_VERSION && transfer.status === BANK_TRANSFER_STATUS &&
      transfer.sourceBankAccountId === direction.sourceBankAccountId &&
      transfer.destinationBankAccountId === direction.destinationBankAccountId &&
      transfer.amount === direction.amount && !transfer[`${direction.role}TransactionId`] &&
      dateDistance(transaction.transactionDate,transfer.effectiveDate) <= BANK_TRANSFER_PAIRING_WINDOW_DAYS)
    .map(transfer => ({ type:"transfer",id:transfer.transferId,date:transfer.effectiveDate,
      dateDistance:dateDistance(transaction.transactionDate,transfer.effectiveDate),
      label:`Link existing transfer dated ${transfer.effectiveDate}` }));
  return Object.freeze([...transferCandidates,...transactionCandidates]
    .sort((left,right) => left.dateDistance - right.dateDistance || left.id.localeCompare(right.id))
    .map(candidate => Object.freeze(candidate)));
}

function clearTransferUpdate(services,timestamp){
  const removed = services.deleteField();
  return {
    status:"unmatched",matchedRecordType:removed,matchedRecordId:removed,matchedAmount:removed,
    matchedAt:removed,matchOrigin:removed,transferVersion:removed,transferId:removed,
    transferJournalId:removed,transferRole:removed,pairedBankTransactionId:removed,
    transferStateFingerprint:removed,updatedAt:timestamp
  };
}

export async function transferBankTransaction(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const transactionId = requiredText(options.transactionId,"Bank transaction ID");
  const otherBankAccountId = requiredText(options.otherBankAccountId,"Other bank account ID");
  const oppositeTransactionId = String(options.oppositeTransactionId || "").trim();
  const existingTransferId = String(options.existingTransferId || "").trim();
  if(oppositeTransactionId && existingTransferId) throw new Error("Choose either a statement-side pair or an existing transfer, not both.");
  for(const helper of ["doc","runTransaction","serverTimestamp"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const transactionRef = services.doc(db,"users",userId,"bankTransactions",transactionId);
  const otherAccountRef = services.doc(db,"users",userId,"bankAccounts",otherBankAccountId);
  const oppositeRef = oppositeTransactionId
    ? services.doc(db,"users",userId,"bankTransactions",oppositeTransactionId) : null;

  return services.runTransaction(db,async firestoreTransaction => {
    const transactionSnapshot = await firestoreTransaction.get(transactionRef);
    if(!exists(transactionSnapshot)) throw new Error("Bank transaction no longer exists or is not owned by this user.");
    const bankTransaction = { ...transactionSnapshot.data(),id:transactionId };
    const currentBankAccountId = requiredText(bankTransaction.bankAccountId,"Bank account ID");
    if(currentBankAccountId === otherBankAccountId) throw new Error("Choose a different bank account for the other side of the transfer.");
    const currentAccountRef = services.doc(db,"users",userId,"bankAccounts",currentBankAccountId);
    const [currentAccountSnapshot,otherAccountSnapshot,oppositeSnapshot] = await Promise.all([
      firestoreTransaction.get(currentAccountRef),firestoreTransaction.get(otherAccountRef),
      oppositeRef ? firestoreTransaction.get(oppositeRef) : Promise.resolve(null)
    ]);
    validAccountSnapshot(currentAccountSnapshot,"Current bank account");
    validAccountSnapshot(otherAccountSnapshot,"Other bank account");

    if(bankTransaction.status === "matched"){
      if(bankTransaction.matchedRecordType !== "bankTransfer" || bankTransaction.matchOrigin !== "bankTransfer"){
        throw new Error("Undo the existing match or categorisation before creating a transfer.");
      }
      const savedTransferId = requiredText(bankTransaction.transferId,"Bank transfer ID");
      if(existingTransferId && existingTransferId !== savedTransferId){
        throw new Error("This transaction is already linked to a different bank transfer.");
      }
      if(oppositeTransactionId && String(bankTransaction.pairedBankTransactionId || "") !== oppositeTransactionId){
        throw new Error("This transaction is already paired with a different statement row.");
      }
      const transferRef = services.doc(db,"users",userId,"bankTransfers",savedTransferId);
      const journalRef = services.doc(db,"journals",bankTransferJournalDocumentId(userId,savedTransferId));
      const [transferSnapshot,journalSnapshot] = await Promise.all([
        firestoreTransaction.get(transferRef),firestoreTransaction.get(journalRef)
      ]);
      if(!exists(transferSnapshot) || !exists(journalSnapshot)) throw new Error("The existing bank transfer is incomplete.");
      const core = transferRecordCore(transferSnapshot.data());
      assertTransferRecord(transferSnapshot.data(),core);
      assertTransferJournal(journalSnapshot.data(),core);
      assertTransferTransaction(bankTransaction,core,String(bankTransaction.transferRole || ""));
      const expectedOther = bankTransaction.transferRole === "source"
        ? core.destinationBankAccountId : core.sourceBankAccountId;
      if(expectedOther !== otherBankAccountId) throw new Error("This transaction is already linked to a different bank account.");
      return Object.freeze({ status:"already-transferred",transferId:savedTransferId,journalId:core.journalId });
    }
    if(bankTransaction.status !== "unmatched") throw new Error("This bank transaction is not unresolved.");
    if(String(bankTransaction.source || "") !== "csv") throw new Error("Only imported bank transactions can be transferred.");

    const direction = directionAccounts(bankTransaction,otherBankAccountId);
    const currentDate = transactionDate(bankTransaction);

    if(existingTransferId){
      const transferRef = services.doc(db,"users",userId,"bankTransfers",existingTransferId);
      const journalRef = services.doc(db,"journals",bankTransferJournalDocumentId(userId,existingTransferId));
      const [transferSnapshot,journalSnapshot] = await Promise.all([
        firestoreTransaction.get(transferRef),firestoreTransaction.get(journalRef)
      ]);
      if(!exists(transferSnapshot)) throw new Error("The selected existing transfer no longer exists.");
      if(!exists(journalSnapshot)) throw new Error("The selected existing transfer journal is missing.");
      const record = transferSnapshot.data();
      const core = transferRecordCore(record);
      assertTransferRecord(record,core);
      assertTransferJournal(journalSnapshot.data(),core);
      if(core.userId !== userId || core.sourceBankAccountId !== direction.sourceBankAccountId ||
        core.destinationBankAccountId !== direction.destinationBankAccountId || core.amount !== direction.amount ||
        dateDistance(currentDate,core.effectiveDate) > BANK_TRANSFER_PAIRING_WINDOW_DAYS){
        throw new Error("The selected existing transfer is not a safe match for this statement row.");
      }
      const slot = `${direction.role}TransactionId`;
      if(String(record[slot] || "")) throw new Error("That side of the selected transfer is already linked.");
      const originalRole = direction.oppositeRole;
      const originalTransactionId = requiredText(record[`${originalRole}TransactionId`],"Existing linked bank transaction ID");
      const originalRef = services.doc(db,"users",userId,"bankTransactions",originalTransactionId);
      const linkId = bankTransferLinkDocumentId(core.sourceBankAccountId,core.destinationBankAccountId,core.amount);
      const linkRef = services.doc(db,"users",userId,"bankTransferLinks",linkId);
      const [originalSnapshot,linkSnapshot] = await Promise.all([
        firestoreTransaction.get(originalRef),firestoreTransaction.get(linkRef)
      ]);
      if(!exists(originalSnapshot)) throw new Error("The existing transfer's statement row is missing.");
      const original = { ...originalSnapshot.data(),id:originalTransactionId };
      assertTransferTransaction(original,core,originalRole);
      const linkData = exists(linkSnapshot) ? linkSnapshot.data() : {};
      const candidates = Array.isArray(linkData.candidates) ? linkData.candidates : [];
      if(!candidates.some(candidate => candidate?.transferId === core.transferId && candidateCompatible(candidate,currentDate))){
        throw new Error("The existing transfer pairing index changed; refresh Banking and try again.");
      }
      const timestamp = services.serverTimestamp();
      const remaining = removeCandidate(candidates,core.transferId);
      const currentMarker = { ...transferMarker(core,direction.role,originalTransactionId),matchedAt:timestamp,updatedAt:timestamp };
      const originalMarker = { ...transferMarker(core,originalRole,transactionId),updatedAt:timestamp };
      firestoreTransaction.update(transactionRef,currentMarker);
      firestoreTransaction.update(originalRef,originalMarker);
      firestoreTransaction.update(transferRef,{ [slot]:transactionId,updatedAt:timestamp });
      if(remaining.length){
        firestoreTransaction.set(linkRef,linkRecord(userId,core.sourceBankAccountId,core.destinationBankAccountId,core.amount,remaining,timestamp));
      }else if(exists(linkSnapshot)){
        firestoreTransaction.delete(linkRef);
      }
      firestoreTransaction.update(currentAccountRef,{ bankingActivity:{ version:1,type:"bankTransfer" },updatedAt:timestamp });
      firestoreTransaction.update(otherAccountRef,{ bankingActivity:{ version:1,type:"bankTransfer" },updatedAt:timestamp });
      return Object.freeze({ status:"linked",transferId:core.transferId,journalId:core.journalId,pairedTransactionId:originalTransactionId });
    }

    let opposite = null;
    if(oppositeRef){
      if(!exists(oppositeSnapshot)) throw new Error("The selected opposite bank transaction no longer exists.");
      opposite = { ...oppositeSnapshot.data(),id:oppositeTransactionId };
      if(opposite.status !== "unmatched") throw new Error("The selected opposite bank transaction is no longer unresolved.");
      if(String(opposite.source || "") !== "csv" || String(opposite.bankAccountId || "") !== otherBankAccountId){
        throw new Error("The selected opposite transaction is not from the other owned bank account.");
      }
      const oppositeDirection = transactionDirection(opposite);
      if(oppositeDirection.role !== direction.oppositeRole || oppositeDirection.amount !== direction.amount ||
        dateDistance(currentDate,transactionDate(opposite)) > BANK_TRANSFER_PAIRING_WINDOW_DAYS){
        throw new Error("The selected opposite transaction is not a safe direction, amount, and date match.");
      }
    }

    const transferId = bankTransferDocumentId(opposite ? [transactionId,oppositeTransactionId] : [transactionId]);
    const journalId = bankTransferJournalDocumentId(userId,transferId);
    const effectiveDate = opposite && direction.role === "destination" ? transactionDate(opposite) : currentDate;
    const core = transferCore({ userId,transferId,...direction,amount:direction.amount,effectiveDate,journalId });
    const transferRef = services.doc(db,"users",userId,"bankTransfers",transferId);
    const journalRef = services.doc(db,"journals",journalId);
    const linkId = bankTransferLinkDocumentId(core.sourceBankAccountId,core.destinationBankAccountId,core.amount);
    const linkRef = services.doc(db,"users",userId,"bankTransferLinks",linkId);
    const [transferSnapshot,journalSnapshot,linkSnapshot] = await Promise.all([
      firestoreTransaction.get(transferRef),firestoreTransaction.get(journalRef),firestoreTransaction.get(linkRef)
    ]);
    if(exists(transferSnapshot) || exists(journalSnapshot)){
      throw new Error("A deterministic transfer record or journal already exists while this statement row is unresolved.");
    }
    const linkData = exists(linkSnapshot) ? linkSnapshot.data() : {};
    const openCandidates = Array.isArray(linkData.candidates) ? linkData.candidates : [];
    if(openCandidates.some(candidate => candidateCompatible(candidate,effectiveDate))){
      throw new Error("A matching unpaired transfer already exists. Select it explicitly to link this statement row without posting twice.");
    }
    if(typeof firestoreTransaction.set !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction write helpers are required.");
    }
    const timestamp = services.serverTimestamp();
    const sourceTransactionId = direction.role === "source" ? transactionId : (opposite ? oppositeTransactionId : "");
    const destinationTransactionId = direction.role === "destination" ? transactionId : (opposite ? oppositeTransactionId : "");
    const record = {
      ...core,sourceTransactionId,destinationTransactionId,fingerprint:fingerprint(core),
      createdAt:timestamp,updatedAt:timestamp
    };
    firestoreTransaction.set(transferRef,record);
    firestoreTransaction.set(journalRef,prepareBankTransferJournal(userId,transferId,core,{
      createdAt:timestamp,updatedAt:timestamp
    }));
    const pairedId = opposite ? oppositeTransactionId : "";
    firestoreTransaction.update(transactionRef,{
      ...transferMarker(core,direction.role,pairedId),matchedAt:timestamp,updatedAt:timestamp
    });
    if(opposite){
      firestoreTransaction.update(oppositeRef,{
        ...transferMarker(core,direction.oppositeRole,transactionId),matchedAt:timestamp,updatedAt:timestamp
      });
    }else{
      const candidate = {
        version:BANK_TRANSFER_VERSION,transferId,effectiveDate,missingRole:direction.oppositeRole
      };
      firestoreTransaction.set(linkRef,linkRecord(
        userId,core.sourceBankAccountId,core.destinationBankAccountId,core.amount,
        [...openCandidates,candidate],timestamp
      ));
    }
    firestoreTransaction.update(currentAccountRef,{ bankingActivity:{ version:1,type:"bankTransfer" },updatedAt:timestamp });
    firestoreTransaction.update(otherAccountRef,{ bankingActivity:{ version:1,type:"bankTransfer" },updatedAt:timestamp });
    return Object.freeze({ status:"transferred",transferId,journalId,pairedTransactionId:pairedId });
  });
}

export async function untransferBankTransaction(options = {}){
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
    const bankTransaction = { ...transactionSnapshot.data(),id:transactionId };
    if(bankTransaction.status === "unmatched" && !bankTransaction.transferId){
      return Object.freeze({ status:"already-untransferred",transactionId });
    }
    if(bankTransaction.status !== "matched" || bankTransaction.matchedRecordType !== "bankTransfer" ||
      bankTransaction.matchOrigin !== "bankTransfer"){
      throw new Error("This bank transaction is not currently a bank transfer.");
    }
    const transferId = requiredText(bankTransaction.transferId,"Bank transfer ID");
    const transferRef = services.doc(db,"users",userId,"bankTransfers",transferId);
    const journalId = bankTransferJournalDocumentId(userId,transferId);
    const journalRef = services.doc(db,"journals",journalId);
    const [transferSnapshot,journalSnapshot] = await Promise.all([
      firestoreTransaction.get(transferRef),firestoreTransaction.get(journalRef)
    ]);
    if(!exists(transferSnapshot) || !exists(journalSnapshot)) throw new Error("The bank transfer record or journal is missing.");
    const record = transferSnapshot.data();
    const core = transferRecordCore(record);
    assertTransferRecord(record,core);
    assertTransferJournal(journalSnapshot.data(),core);
    if(core.userId !== userId) throw new Error("The bank transfer belongs to another user.");
    const transactionIds = [record.sourceTransactionId,record.destinationTransactionId].filter(Boolean);
    if(!transactionIds.includes(transactionId)) throw new Error("The bank transfer does not reference this statement row.");
    const transactionRefs = transactionIds.map(id => services.doc(db,"users",userId,"bankTransactions",id));
    const transactionSnapshots = await Promise.all(transactionRefs.map(reference => firestoreTransaction.get(reference)));
    if(transactionSnapshots.some(snapshot => !exists(snapshot))) throw new Error("A linked bank transaction is missing.");
    transactionSnapshots.forEach((snapshot,index) => {
      const role = transactionIds[index] === record.sourceTransactionId ? "source" : "destination";
      assertTransferTransaction({ ...snapshot.data(),id:transactionIds[index] },core,role);
    });
    const linkId = bankTransferLinkDocumentId(core.sourceBankAccountId,core.destinationBankAccountId,core.amount);
    const linkRef = services.doc(db,"users",userId,"bankTransferLinks",linkId);
    const linkSnapshot = await firestoreTransaction.get(linkRef);
    const remaining = removeCandidate(exists(linkSnapshot) ? linkSnapshot.data()?.candidates : [],transferId);
    if(typeof firestoreTransaction.delete !== "function" || typeof firestoreTransaction.update !== "function"){
      throw new Error("Firestore transaction delete and update helpers are required.");
    }
    const timestamp = services.serverTimestamp();
    firestoreTransaction.delete(journalRef);
    firestoreTransaction.delete(transferRef);
    transactionRefs.forEach(reference => firestoreTransaction.update(reference,clearTransferUpdate(services,timestamp)));
    if(exists(linkSnapshot)){
      if(remaining.length){
        firestoreTransaction.set(linkRef,linkRecord(
          userId,core.sourceBankAccountId,core.destinationBankAccountId,core.amount,remaining,timestamp
        ));
      }else{
        firestoreTransaction.delete(linkRef);
      }
    }
    return Object.freeze({
      status:"untransferred",transactionId,transferId,journalId,
      restoredTransactionIds:Object.freeze(transactionIds)
    });
  });
}
