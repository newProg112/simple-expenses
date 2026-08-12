export const BANK_TRANSACTION_STATUS = Object.freeze({ UNMATCHED:"unmatched",MATCHED:"matched" });
export const BANK_TRANSACTION_SOURCE = Object.freeze({ CSV:"csv" });
export const BANK_TRANSACTION_BATCH_LIMIT = 450;

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
  for(const helper of ["collection","doc","getDocs","query","where","writeBatch"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const records = prepareBankTransactionRecords(options.mappedResult,options);
  const transactionCollection = services.collection(db,"users",ownerId,"bankTransactions");
  const existingSnapshot = await services.getDocs(services.query(
    transactionCollection,
    services.where("bankAccountId","==",String(options.bankAccountId || "").trim())
  ));
  const knownKeys = new Set(existingSnapshot.docs.map(document => bankTransactionDuplicateKey(document.data())));
  const newRecords = records.filter(record => {
    const key = bankTransactionDuplicateKey(record);
    if(knownKeys.has(key)) return false;
    knownKeys.add(key);
    return true;
  });
  let committedBatches = 0;
  for(let start = 0; start < newRecords.length; start += BANK_TRANSACTION_BATCH_LIMIT){
    const batch = services.writeBatch(db);
    const chunk = newRecords.slice(start,start + BANK_TRANSACTION_BATCH_LIMIT);
    const references = await Promise.all(chunk.map(record => bankTransactionDocumentId(record)));
    chunk.forEach((record,index) => {
      const reference = services.doc(transactionCollection,references[index]);
      batch.set(reference,record);
    });
    await batch.commit();
    committedBatches += 1;
  }
  return Object.freeze({
    importedCount:newRecords.length,
    skippedDuplicateCount:records.length - newRecords.length,
    committedBatches
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
  const hasValidMatch = data.status === BANK_TRANSACTION_STATUS.MATCHED &&
    ["invoice","bill","expense"].includes(data.matchedRecordType) &&
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
        settlementVersion:Number(data.settlementVersion) || null
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
