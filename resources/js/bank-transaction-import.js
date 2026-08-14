export const BANK_TRANSACTION_STATUS = Object.freeze({ UNMATCHED:"unmatched",MATCHED:"matched" });
export const BANK_TRANSACTION_SOURCE = Object.freeze({ CSV:"csv" });
export const BANK_TRANSACTION_BATCH_LIMIT = 449;

function transactionDateValue(value){
  const raw = String(value || "").trim();
  const uk = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let day;
  let month;
  let year;
  if(uk){
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]);
    if(uk[3].length === 2) year += 2000;
  }else if(iso){
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  }else{
    return null;
  }
  const timestamp = Date.UTC(year,month - 1,day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? timestamp
    : null;
}

function nullableMoney(value){
  if(value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function readyMappedTransactions(mappedResult = {}){
  const rows = Array.isArray(mappedResult.allRows) ? mappedResult.allRows : [];
  return rows.filter(row => row?.status === "Ready");
}

export function prepareBankTransactionRecords(mappedResult = {}, options = {}){
  const bankAccountId = String(options.bankAccountId || "").trim();
  const importId = String(options.importId || "").trim();
  if(!bankAccountId) throw new Error("A bank account is required for transaction import.");
  if(!importId) throw new Error("An import ID is required for transaction import.");
  const timestamp = options.timestamp;
  return Object.freeze(readyMappedTransactions(mappedResult).map(row => Object.freeze({
    bankAccountId,
    transactionDate:String(row.transactionDate || "").trim(),
    description:String(row.description || "").trim(),
    moneyIn:nullableMoney(row.moneyIn),
    moneyOut:nullableMoney(row.moneyOut),
    balance:nullableMoney(row.balance),
    status:BANK_TRANSACTION_STATUS.UNMATCHED,
    source:BANK_TRANSACTION_SOURCE.CSV,
    importId,
    createdAt:timestamp,
    updatedAt:timestamp
  })));
}

export function bankTransactionDuplicateKey(transaction = {}){
  return JSON.stringify([
    String(transaction.bankAccountId || "").trim(),
    String(transaction.transactionDate || "").trim(),
    String(transaction.description || "").trim(),
    nullableMoney(transaction.moneyIn),
    nullableMoney(transaction.moneyOut),
    nullableMoney(transaction.balance)
  ]);
}

async function bankTransactionDocumentId(transaction){
  const encoded = new TextEncoder().encode(bankTransactionDuplicateKey(transaction));
  const digest = await globalThis.crypto.subtle.digest("SHA-256",encoded);
  return `csv-${Array.from(new Uint8Array(digest),byte => byte.toString(16).padStart(2,"0")).join("")}`;
}

export async function persistBankTransactions(options = {}){
  const { db,services = {},userId } = options;
  const ownerId = String(userId || "").trim();
  if(!ownerId) throw new Error("An authenticated user is required for transaction import.");
  for(const helper of ["collection","doc","getDocs","query","where","runTransaction"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const records = prepareBankTransactionRecords(options.mappedResult,options);
  if(records.length > BANK_TRANSACTION_BATCH_LIMIT){
    throw new Error(`A statement import cannot contain more than ${BANK_TRANSACTION_BATCH_LIMIT} Ready rows.`);
  }
  const transactionCollection = services.collection(db,"users",ownerId,"bankTransactions");
  const bankAccountCollection = services.collection(db,"users",ownerId,"bankAccounts");
  const bankAccountRef = services.doc(bankAccountCollection,String(options.bankAccountId || "").trim());
  const existingSnapshot = await services.getDocs(services.query(
    transactionCollection,
    services.where("bankAccountId","==",String(options.bankAccountId || "").trim())
  ));
  const knownKeys = new Set();
  for(const document of existingSnapshot.docs){
    const data = document.data();
    if(document.id !== await bankTransactionDocumentId(data)) knownKeys.add(bankTransactionDuplicateKey(data));
  }
  const candidates = records.filter(record => {
    const key = bankTransactionDuplicateKey(record);
    if(knownKeys.has(key)) return false;
    knownKeys.add(key);
    return true;
  });
  const documentIds = await Promise.all(candidates.map(bankTransactionDocumentId));
  const references = documentIds.map(id => services.doc(transactionCollection,id));

  return services.runTransaction(db,async firestoreTransaction => {
    const snapshots = await Promise.all([
      firestoreTransaction.get(bankAccountRef),
      ...references.map(reference => firestoreTransaction.get(reference))
    ]);
    const [accountSnapshot,...transactionSnapshots] = snapshots;
    if(!accountSnapshot.exists()) throw new Error("The selected bank account no longer exists.");
    const accountStatus = String(accountSnapshot.data()?.status || "Active");
    if(accountStatus !== "Active") throw new Error("The selected bank account is no longer active.");

    const newRecords = candidates.filter((record,index) => {
      const snapshot = transactionSnapshots[index];
      if(!snapshot.exists()) return true;
      if(bankTransactionDuplicateKey(snapshot.data()) !== bankTransactionDuplicateKey(record)){
        throw new Error("A bank transaction identity collision was detected; nothing was imported.");
      }
      return false;
    });
    if(newRecords.length){
      if(typeof firestoreTransaction.set !== "function" || typeof firestoreTransaction.update !== "function"){
        throw new Error("Firestore transaction write helpers are required.");
      }
      candidates.forEach((record,index) => {
        if(!transactionSnapshots[index].exists()) firestoreTransaction.set(references[index],record);
      });
      firestoreTransaction.update(bankAccountRef,{
        bankingActivity:{ version:1,type:"importedTransaction" },
        updatedAt:options.timestamp
      });
    }
    return Object.freeze({
      importedCount:newRecords.length,
      skippedDuplicateCount:records.length - newRecords.length,
      committedBatches:newRecords.length ? 1 : 0
    });
  });
}

export function createSingleFlightImport(execute){
  if(typeof execute !== "function") throw new Error("An import function is required.");
  let active = null;
  return (...args) => {
    if(active) return active;
    active = Promise.resolve().then(() => execute(...args)).finally(() => { active = null; });
    return active;
  };
}

export function normaliseBankTransaction(id,data = {}){
  const hasValidMatchedType = ["invoice","bill","expense"].includes(data.matchedRecordType) ||
    (data.matchedRecordType === "bankIncome" && data.matchOrigin === "categorisation" &&
      Number(data.categorisationVersion) === 1 && Boolean(String(data.categorisationJournalId || "").trim()) &&
      Boolean(String(data.categorisationStateFingerprint || "").trim())) ||
    (data.matchedRecordType === "bankTransfer" && data.matchOrigin === "bankTransfer" &&
      Number(data.transferVersion) === 1 && Boolean(String(data.transferId || "").trim()) &&
      String(data.transferId || "").trim() === String(data.matchedRecordId || "").trim() &&
      Boolean(String(data.transferJournalId || "").trim()) &&
      ["source","destination"].includes(String(data.transferRole || "")) &&
      Boolean(String(data.transferStateFingerprint || "").trim()));
  const hasValidException = data.matchedRecordType === "bankException" &&
    data.matchOrigin === "bankException" && Number(data.exceptionVersion) === 1 &&
    Boolean(String(data.exceptionResolutionId || "").trim()) &&
    String(data.exceptionResolutionId || "").trim() === String(data.matchedRecordId || "").trim() &&
    Boolean(String(data.exceptionResolutionType || "").trim()) &&
    ["journal","none"].includes(String(data.exceptionPosting || "")) &&
    Boolean(String(data.exceptionStateFingerprint || "").trim()) &&
    (data.exceptionPosting === "none" || Boolean(String(data.exceptionJournalId || "").trim()));
  const hasValidMatch = data.status === BANK_TRANSACTION_STATUS.MATCHED && (hasValidMatchedType || hasValidException) &&
    Boolean(String(data.matchedRecordId || "").trim()) &&
    Number.isFinite(Number(data.matchedAmount)) && Number(data.matchedAmount) > 0;
  return Object.freeze({
    id:String(id || ""),
    bankAccountId:String(data.bankAccountId || ""),
    transactionDate:String(data.transactionDate || "").trim(),
    description:String(data.description || "").trim(),
    moneyIn:nullableMoney(data.moneyIn),
    moneyOut:nullableMoney(data.moneyOut),
    balance:nullableMoney(data.balance),
    status:hasValidMatch ? BANK_TRANSACTION_STATUS.MATCHED : BANK_TRANSACTION_STATUS.UNMATCHED,
    source:BANK_TRANSACTION_SOURCE.CSV,
    importId:String(data.importId || ""),
    createdAt:data.createdAt || null,
    updatedAt:data.updatedAt || null,
    ...(hasValidMatch ? {
      matchedRecordType:data.matchedRecordType,
      matchedRecordId:String(data.matchedRecordId).trim(),
      matchedAt:data.matchedAt || null,
      matchedAmount:nullableMoney(data.matchedAmount),
      ...(String(data.settlementJournalId || "").trim() ? {
        settlementJournalId:String(data.settlementJournalId).trim(),
        settlementVersion:Number(data.settlementVersion) || null,
        ...(String(data.settlementStateFingerprint || "").trim() ? {
          settlementStateFingerprint:String(data.settlementStateFingerprint).trim()
        } : {})
      } : {}),
      ...(data.matchOrigin === "categorisation" && Number(data.categorisationVersion) === 1 ? {
        matchOrigin:"categorisation",
        categorisationVersion:1,
        ...(String(data.categorisationJournalId || "").trim() ? {
          categorisationJournalId:String(data.categorisationJournalId).trim()
        } : {}),
        ...(String(data.categorisationStateFingerprint || "").trim() ? {
          categorisationStateFingerprint:String(data.categorisationStateFingerprint).trim()
        } : {})
      } : {}),
      ...(data.matchOrigin === "bankTransfer" && Number(data.transferVersion) === 1 ? {
        matchOrigin:"bankTransfer",
        transferVersion:1,
        transferId:String(data.transferId).trim(),
        transferJournalId:String(data.transferJournalId).trim(),
        transferRole:String(data.transferRole).trim(),
        transferStateFingerprint:String(data.transferStateFingerprint).trim(),
        ...(String(data.pairedBankTransactionId || "").trim() ? {
          pairedBankTransactionId:String(data.pairedBankTransactionId).trim()
        } : {})
      } : {}),
      ...(data.matchOrigin === "bankException" && Number(data.exceptionVersion) === 1 ? {
        matchOrigin:"bankException",exceptionVersion:1,
        exceptionResolutionId:String(data.exceptionResolutionId).trim(),
        exceptionResolutionType:String(data.exceptionResolutionType).trim(),
        exceptionPosting:String(data.exceptionPosting).trim(),
        exceptionJournalId:String(data.exceptionJournalId || "").trim(),
        exceptionReasonCode:String(data.exceptionReasonCode || "").trim(),
        exceptionBlocksReconciliation:data.exceptionBlocksReconciliation === true,
        exceptionStateFingerprint:String(data.exceptionStateFingerprint).trim()
      } : {})
    } : {})
  });
}

export function newestBankTransactions(transactions = []){
  return (Array.isArray(transactions) ? transactions : []).slice().sort((left,right) =>
    (transactionDateValue(right.transactionDate) === null ? -1 : transactionDateValue(right.transactionDate)) -
      (transactionDateValue(left.transactionDate) === null ? -1 : transactionDateValue(left.transactionDate)) ||
    String(right.transactionDate || "").localeCompare(String(left.transactionDate || "")) ||
    String(right.id || "").localeCompare(String(left.id || ""))
  );
}
