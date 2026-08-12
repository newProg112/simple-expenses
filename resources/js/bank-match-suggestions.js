export const MATCH_CONFIDENCE_MINIMUM = 75;

function finiteAmount(value){
  if(value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : null;
}

function safeDateValue(value){
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

function daysBetween(left,right){
  const leftValue = safeDateValue(left);
  const rightValue = safeDateValue(right);
  if(leftValue === null || rightValue === null) return null;
  return Math.abs(leftValue - rightValue) / 86400000;
}

function containsParty(description,partyName){
  const party = String(partyName || "").trim().toLowerCase();
  return Boolean(party && String(description || "").toLowerCase().includes(party));
}

function nonPaid(record){
  return String(record?.status || "Unpaid").trim().toLowerCase() !== "paid";
}

function candidate(id,data,documentType,recordType,options){
  return Object.freeze({
    id:String(id || data?.id || ""),
    documentType,
    recordType,
    label:String(options.label || `${documentType} ${id || ""}`).trim(),
    partyName:String(options.partyName || "").trim(),
    transactionDate:String(options.transactionDate || "").trim(),
    amount:finiteAmount(options.amount),
    direction:options.direction
  });
}

export function buildMatchCandidates(sources = {}){
  const invoices = (Array.isArray(sources.invoices) ? sources.invoices : [])
    .filter(nonPaid)
    .map(invoice => candidate(invoice.id,invoice,"Invoice","invoice",{
      label:invoice.invoiceNo || invoice.invoiceNumber || `Invoice ${invoice.id || ""}`,
      partyName:invoice.client || invoice.customerName || invoice.customer,
      transactionDate:invoice.date || invoice.invoiceDate || invoice.dueDate,
      amount:invoice.total,
      direction:"in"
    }));
  const bills = (Array.isArray(sources.bills) ? sources.bills : [])
    .filter(nonPaid)
    .map(bill => candidate(bill.id,bill,"Bill","bill",{
      label:bill.billNumber || bill.invoiceNumber || `Bill ${bill.id || ""}`,
      partyName:bill.supplier || bill.merchant,
      transactionDate:bill.billDate || bill.date || bill.dueDate,
      amount:bill.total,
      direction:"out"
    }));
  const claims = (Array.isArray(sources.expenses) ? sources.expenses : []).filter(nonPaid).map(expense => {
    const mileage = expense.type === "mileage";
    return candidate(expense.id,expense,mileage ? "Mileage claim" : "Expense","expense",{
      label:mileage
        ? expense.businessPurpose || `Mileage claim ${expense.id || ""}`
        : expense.merchant || expense.description || `Expense ${expense.id || ""}`,
      partyName:mileage ? "" : expense.merchant || expense.supplier,
      transactionDate:expense.date || expense.expenseDate,
      amount:mileage ? expense.amount ?? expense.gross : expense.gross ?? expense.total,
      direction:"out"
    });
  });
  return Object.freeze([...invoices,...bills,...claims]);
}

export function scoreBankMatch(transaction,candidateRecord){
  const transactionAmount = finiteAmount(candidateRecord.direction === "in" ? transaction?.moneyIn : transaction?.moneyOut);
  if(transactionAmount === null || candidateRecord.amount === null || transactionAmount !== candidateRecord.amount){
    return Object.freeze({ confidence:0,reasons:Object.freeze([]) });
  }
  const difference = daysBetween(transaction?.transactionDate,candidateRecord.transactionDate);
  if(difference === null || difference > 7){
    return Object.freeze({ confidence:0,reasons:Object.freeze(["Amount matches"]) });
  }
  const nameFound = containsParty(transaction?.description,candidateRecord.partyName);
  const reasons = ["Amount matches"];
  if(difference === 0) reasons.push("Date matches");
  else if(difference <= 3) reasons.push("Date within 3 days");
  else reasons.push("Date within 7 days");
  if(nameFound) reasons.push(`${candidateRecord.documentType === "Invoice" ? "Customer" : "Supplier"} name found`);
  const confidence = difference === 0 && nameFound ? 100 : difference <= 3 ? 90 : 75;
  return Object.freeze({ confidence,reasons:Object.freeze(reasons) });
}

export function suggestBankMatches(transactions = [],sources = {}){
  const candidates = buildMatchCandidates(sources);
  const suggestions = [];
  (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => String(transaction?.status || "").toLowerCase() === "unmatched")
    .forEach(transaction => {
      candidates.forEach(candidateRecord => {
        const score = scoreBankMatch(transaction,candidateRecord);
        if(score.confidence < MATCH_CONFIDENCE_MINIMUM) return;
        suggestions.push(Object.freeze({ transaction,candidate:candidateRecord,...score }));
      });
    });
  return Object.freeze(suggestions.sort((left,right) =>
    right.confidence - left.confidence ||
    String(left.transaction.transactionDate || "").localeCompare(String(right.transaction.transactionDate || "")) ||
    left.candidate.label.localeCompare(right.candidate.label)
  ));
}
