export const BANK_MATCH_CANDIDATE_CLASSIFICATION = Object.freeze({
  HIGH_CONFIDENCE:"highConfidence",
  SUGGESTED:"suggested",
  NONE:"none"
});

function moneyInCents(value){
  if(value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if(!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > 0 ? cents : null;
}

function dateValue(value){
  const raw = String(value || "").trim();
  const uk = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let day;
  let month;
  let year;
  if(uk){
    day = Number(uk[1]);
    month = Number(uk[2]);
    year = Number(uk[3]) + (uk[3].length === 2 ? 2000 : 0);
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

function sourceId(source){
  return String(source?.id || "").trim();
}

function isUnsettled(source){
  return String(source?.status || "Unpaid").trim().toLowerCase() !== "paid" &&
    !source?.bankSettlement;
}

function matchedSourceKeys(transactions){
  return new Set((Array.isArray(transactions) ? transactions : [])
    .filter(transaction => String(transaction?.status || "").trim().toLowerCase() === "matched")
    .map(transaction => `${String(transaction?.matchedRecordType || "").trim()}:${String(transaction?.matchedRecordId || "").trim()}`));
}

function transactionDirection(transaction){
  const moneyIn = moneyInCents(transaction?.moneyIn);
  const moneyOut = moneyInCents(transaction?.moneyOut);
  if(moneyIn !== null && moneyOut === null) return { direction:"in",amountCents:moneyIn };
  if(moneyOut !== null && moneyIn === null) return { direction:"out",amountCents:moneyOut };
  return null;
}

function invoiceDateCompatible(transactionDate,invoice){
  const bankDate = dateValue(transactionDate);
  const documentDate = dateValue(invoice?.date || invoice?.invoiceDate || invoice?.dueDate);
  return bankDate !== null && documentDate !== null && Math.abs(bankDate - documentDate) / 86400000 <= 7;
}

function billDateCompatible(transactionDate,bill){
  const bankDate = dateValue(transactionDate);
  const dueDate = dateValue(bill?.dueDate);
  const billDate = dateValue(bill?.billDate || bill?.date);
  if(bankDate === null) return false;
  if(dueDate !== null){
    const daysAfterDueDate = (bankDate - dueDate) / 86400000;
    return daysAfterDueDate >= -7 && daysAfterDueDate <= 30;
  }
  if(billDate === null) return false;
  const daysAfterBillDate = (bankDate - billDate) / 86400000;
  return daysAfterBillDate >= 0 && daysAfterBillDate <= 30;
}

function labelFor(recordType,record){
  if(recordType === "invoice") return record.invoiceNo || record.invoiceNumber || `Invoice ${sourceId(record)}`;
  return record.billNumber || record.invoiceNumber || `Bill ${sourceId(record)}`;
}

function partyFor(recordType,record){
  return recordType === "invoice"
    ? record.client || record.customerName || record.customer
    : record.supplier || record.merchant;
}

function relevantDateFor(recordType,record){
  if(recordType === "invoice") return record.date || record.invoiceDate || record.dueDate;
  return dateValue(record.dueDate) !== null ? record.dueDate : record.billDate || record.date;
}

function eligibleCandidate(recordType,record,transaction,amountCents,alreadyMatched){
  const id = sourceId(record);
  if(!id || !isUnsettled(record) || alreadyMatched.has(`${recordType}:${id}`)) return null;
  const recordAmount = moneyInCents(record?.total);
  if(recordAmount === null || recordAmount !== amountCents) return null;
  const compatible = recordType === "invoice"
    ? invoiceDateCompatible(transaction?.transactionDate,record)
    : billDateCompatible(transaction?.transactionDate,record);
  if(!compatible) return null;
  return Object.freeze({
    candidateType:recordType,
    candidateId:id,
    label:String(labelFor(recordType,record)).trim(),
    partyName:String(partyFor(recordType,record) || "").trim(),
    relevantDate:String(relevantDateFor(recordType,record) || "").trim(),
    amountCents:recordAmount,
    reasons:Object.freeze(["direction-compatible","exact-amount","date-compatible","source-unsettled"])
  });
}

function orderedCandidates(candidates){
  return candidates.sort((left,right) =>
    left.candidateType.localeCompare(right.candidateType) ||
    left.candidateId.localeCompare(right.candidateId) ||
    left.label.localeCompare(right.label)
  );
}

function none(transactionId,reason){
  return Object.freeze({
    transactionId,
    classification:BANK_MATCH_CANDIDATE_CLASSIFICATION.NONE,
    candidateType:null,
    candidateId:null,
    candidates:Object.freeze([]),
    reasons:Object.freeze([reason])
  });
}

export function classifyBankMatchCandidates(transaction = {},sources = {},context = {}){
  const transactionId = String(transaction?.id || "").trim();
  if(String(transaction?.status || "").trim().toLowerCase() !== "unmatched"){
    return none(transactionId,"bank-transaction-not-unmatched");
  }
  const direction = transactionDirection(transaction);
  if(!direction) return none(transactionId,"bank-transaction-direction-or-amount-invalid");

  const recordType = direction.direction === "in" ? "invoice" : "bill";
  const records = direction.direction === "in"
    ? (Array.isArray(sources?.invoices) ? sources.invoices : [])
    : (Array.isArray(sources?.bills) ? sources.bills : []);
  const allTransactions = Array.isArray(context?.transactions) ? context.transactions : [];
  const alreadyMatched = matchedSourceKeys(allTransactions);
  const candidates = Object.freeze(orderedCandidates(records
    .map(record => eligibleCandidate(recordType,record,transaction,direction.amountCents,alreadyMatched))
    .filter(Boolean)));

  if(!candidates.length) return none(transactionId,"no-eligible-candidate");
  if(candidates.length > 1){
    return Object.freeze({
      transactionId,
      classification:BANK_MATCH_CANDIDATE_CLASSIFICATION.SUGGESTED,
      candidateType:recordType,
      candidateId:null,
      candidates,
      reasons:Object.freeze(["multiple-eligible-candidates"])
    });
  }
  return Object.freeze({
    transactionId,
    classification:BANK_MATCH_CANDIDATE_CLASSIFICATION.HIGH_CONFIDENCE,
    candidateType:recordType,
    candidateId:candidates[0].candidateId,
    candidates,
    reasons:Object.freeze([...candidates[0].reasons,"single-eligible-candidate"])
  });
}

export function discoverBankMatchCandidates(transactions = [],sources = {}){
  const records = Array.isArray(transactions) ? transactions : [];
  return Object.freeze(records.map(transaction =>
    classifyBankMatchCandidates(transaction,sources,{ transactions:records })
  ));
}
