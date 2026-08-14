import { roundMoney } from "./business-logic.js";
import { normaliseBankTransactionDate,validateJournal } from "./ledger-engine.js";

export const BANK_RECONCILIATION_VERSION = 1;
export const BANK_RECONCILIATION_STATUS = Object.freeze({ RECONCILED:"reconciled" });

function requiredText(value,label,maximum = 1400){
  const result = String(value || "").trim();
  if(!result) throw new Error(`${label} is required.`);
  if(result.length > maximum) throw new Error(`${label} is too long.`);
  return result;
}

function exists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function currency(value,label){
  const amount = Number(value);
  if(!Number.isFinite(amount)) throw new Error(`${label} must be a finite amount.`);
  const rounded = roundMoney(amount);
  if(Math.abs(amount - rounded) > 1e-8) throw new Error(`${label} must have no more than two decimal places.`);
  return rounded;
}

function dateValue(value,label = "Statement closing date"){
  const date = normaliseBankTransactionDate(value);
  if(!date) throw new Error(`${label} must be a valid calendar date.`);
  return date;
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

function sourceId(source){
  return String(source?.id || source?.journalId || "").trim();
}

function journalCore(journal){
  return {
    id:sourceId(journal),userId:String(journal?.userId || ""),date:String(journal?.date || ""),
    sourceType:String(journal?.sourceType || ""),sourceId:String(journal?.sourceId || ""),
    bankAccountId:String(journal?.bankAccountId || ""),
    lines:(Array.isArray(journal?.lines) ? journal.lines : []).map(line => ({
      accountCode:String(line?.accountCode || ""),description:String(line?.description || ""),
      debit:Number(line?.debit),credit:Number(line?.credit),
      bankAccountId:String(line?.bankAccountId || "")
    }))
  };
}

function transactionCore(transaction){
  return {
    id:sourceId(transaction),bankAccountId:String(transaction?.bankAccountId || ""),
    transactionDate:String(transaction?.transactionDate || ""),description:String(transaction?.description || ""),
    balance:transaction?.balance === null ? null : Number(transaction?.balance),
    source:String(transaction?.source || ""),importId:String(transaction?.importId || ""),
    status:String(transaction?.status || ""),
    moneyIn:transaction?.moneyIn === null ? null : Number(transaction?.moneyIn),
    moneyOut:transaction?.moneyOut === null ? null : Number(transaction?.moneyOut),
    matchedRecordType:String(transaction?.matchedRecordType || ""),
    matchedRecordId:String(transaction?.matchedRecordId || ""),
    matchedAmount:Number(transaction?.matchedAmount || 0),
    settlementJournalId:String(transaction?.settlementJournalId || ""),
    settlementVersion:Number(transaction?.settlementVersion || 0),
    settlementStateFingerprint:String(transaction?.settlementStateFingerprint || ""),
    matchOrigin:String(transaction?.matchOrigin || ""),
    categorisationVersion:Number(transaction?.categorisationVersion || 0),
    categorisationJournalId:String(transaction?.categorisationJournalId || ""),
    categorisationStateFingerprint:String(transaction?.categorisationStateFingerprint || ""),
    transferVersion:Number(transaction?.transferVersion || 0),
    transferId:String(transaction?.transferId || ""),
    transferJournalId:String(transaction?.transferJournalId || ""),
    transferRole:String(transaction?.transferRole || ""),
    pairedBankTransactionId:String(transaction?.pairedBankTransactionId || ""),
    transferStateFingerprint:String(transaction?.transferStateFingerprint || "")
  };
}

function accountOpeningCore(account){
  const marker = account?.openingBalanceAccounting;
  return marker ? {
    version:Number(marker.version || 0),bankAccountId:String(marker.bankAccountId || ""),
    openingBalance:Number(marker.openingBalance),openingBalanceDate:String(marker.openingBalanceDate || ""),
    state:String(marker.state || ""),journalId:String(marker.journalId || ""),fingerprint:String(marker.fingerprint || "")
  } : null;
}

export function bankReconciliationDocumentId(bankAccountId,closingDate){
  const accountId = requiredText(bankAccountId,"Bank account ID");
  const date = dateValue(closingDate);
  return `bank-reconciliation_${encodeURIComponent(accountId)}_${date}`;
}

export function validateBankReconciliationInput(input = {}){
  const errors = {};
  const bankAccountId = String(input.bankAccountId || "").trim();
  const statementClosingDate = normaliseBankTransactionDate(input.statementClosingDate);
  let statementClosingBalance = null;
  try{ statementClosingBalance = currency(input.statementClosingBalance,"Statement closing balance"); }
  catch{ errors.statementClosingBalance = "Enter a valid statement closing balance with no more than two decimal places."; }
  if(!bankAccountId) errors.bankAccountId = "Choose a bank account.";
  if(!statementClosingDate) errors.statementClosingDate = "Enter a valid statement closing date.";
  return Object.freeze({
    valid:Object.keys(errors).length === 0,
    errors:Object.freeze(errors),
    value:Object.freeze({ bankAccountId,statementClosingDate,statementClosingBalance:statementClosingBalance ?? 0 })
  });
}

export function isCompletedBankTransaction(transaction,journalIds = null){
  if(String(transaction?.status || "") !== "matched") return false;
  const matchedType = String(transaction?.matchedRecordType || "");
  const matchedId = String(transaction?.matchedRecordId || "").trim();
  const matchedAmount = Number(transaction?.matchedAmount);
  if(!matchedId || !Number.isFinite(matchedAmount) || matchedAmount <= 0) return false;

  let journalId = "";
  if(matchedType === "bankIncome"){
    if(transaction.matchOrigin !== "categorisation" || Number(transaction.categorisationVersion) !== 1 ||
      !String(transaction.categorisationStateFingerprint || "").trim()) return false;
    journalId = String(transaction.categorisationJournalId || "").trim();
  }else if(matchedType === "bankTransfer"){
    if(transaction.matchOrigin !== "bankTransfer" || Number(transaction.transferVersion) !== 1 ||
      String(transaction.transferId || "") !== matchedId ||
      !["source","destination"].includes(String(transaction.transferRole || "")) ||
      !String(transaction.transferStateFingerprint || "").trim()) return false;
    journalId = String(transaction.transferJournalId || "").trim();
  }else if(["invoice","bill","expense"].includes(matchedType)){
    if(Number(transaction.settlementVersion) !== 1 ||
      !String(transaction.settlementStateFingerprint || "").trim()) return false;
    if(transaction.matchOrigin === "categorisation" && Number(transaction.categorisationVersion) !== 1) return false;
    journalId = String(transaction.settlementJournalId || "").trim();
  }else{
    return false;
  }
  if(!journalId) return false;
  return journalIds instanceof Set ? journalIds.has(journalId) : true;
}

function openingPosition(userId,account,closingDate,journalsById){
  const marker = accountOpeningCore(account);
  if(!marker){
    return { legacyOpeningUnposted:true,openingBalance:0,integrityJournalIds:[] };
  }
  if(marker.version !== 1 || marker.bankAccountId !== String(account.id || "") ||
    !normaliseBankTransactionDate(marker.openingBalanceDate) || !["posted","not-required"].includes(marker.state)){
    throw new Error("The bank account opening-balance accounting marker is invalid.");
  }
  const expectedMarkerFingerprint = fingerprint({
    version:1,bankAccountId:marker.bankAccountId,
    openingBalance:currency(marker.openingBalance,"Opening balance"),
    openingBalanceDate:marker.openingBalanceDate
  });
  if(marker.fingerprint !== expectedMarkerFingerprint){
    throw new Error("The bank account opening-balance accounting marker fingerprint is invalid.");
  }
  if(marker.state === "not-required"){
    if(currency(marker.openingBalance,"Opening balance") !== 0 || marker.journalId){
      throw new Error("The zero opening-balance marker is inconsistent.");
    }
    return { legacyOpeningUnposted:false,openingBalance:0,integrityJournalIds:[] };
  }
  if(!marker.journalId) throw new Error("The posted opening-balance journal reference is missing.");
  const openingJournal = journalsById.get(marker.journalId);
  if(!openingJournal || String(openingJournal.userId || "") !== userId ||
    String(openingJournal.bankAccountId || "") !== String(account.id || "") ||
    String(openingJournal.sourceType || "") !== "bankOpeningBalance" ||
    String(openingJournal.sourceId || "") !== String(account.id || "") ||
    normaliseBankTransactionDate(openingJournal.date) !== marker.openingBalanceDate){
    throw new Error("The posted bank opening-balance journal is missing or invalid.");
  }
  const openingBankMovement = roundMoney(openingJournal.lines
    .filter(line => String(line.accountCode) === "1000")
    .reduce((sum,line) => sum + Number(line.debit) - Number(line.credit),0));
  if(openingBankMovement !== currency(marker.openingBalance,"Opening balance")){
    throw new Error("The posted bank opening-balance journal does not match its accounting marker.");
  }
  return {
    legacyOpeningUnposted:false,
    openingBalance:marker.openingBalanceDate <= closingDate ? currency(marker.openingBalance,"Opening balance") : 0,
    integrityJournalIds:[marker.journalId]
  };
}

export function calculateBankReconciliation(options = {}){
  const userId = requiredText(options.userId,"User ID");
  const account = options.account;
  const bankAccountId = requiredText(options.bankAccountId || account?.id,"Bank account ID");
  if(!account || String(account.id || "") !== bankAccountId) throw new Error("The selected bank account does not exist.");
  const statementClosingDate = dateValue(options.statementClosingDate);
  const statementClosingBalance = currency(options.statementClosingBalance,"Statement closing balance");
  const journals = Array.isArray(options.journals) ? options.journals : [];
  const transactions = Array.isArray(options.transactions) ? options.transactions : [];

  const journalAttributedToAccount = journal =>
    String(journal?.bankAccountId || "") === bankAccountId ||
    (Array.isArray(journal?.lines) && journal.lines.some(line =>
      String(line?.accountCode || "") === "1000" && String(line?.bankAccountId || "") === bankAccountId
    ));
  const attributedJournals = journals.filter(journalAttributedToAccount);
  attributedJournals.forEach(journal => {
    if(String(journal?.userId || "") !== userId) throw new Error("An attributed journal does not belong to the authenticated user.");
    if(!sourceId(journal)) throw new Error("An attributed journal ID is required.");
    if(!validateJournal(journal).valid) throw new Error("An attributed bank journal is invalid.");
    if(!normaliseBankTransactionDate(journal.date)) throw new Error("An attributed bank journal has an invalid date.");
  });
  const journalsById = new Map(attributedJournals.map(journal => [sourceId(journal),journal]));
  const opening = openingPosition(userId,account,statementClosingDate,journalsById);
  const relevantJournals = attributedJournals
    .filter(journal => normaliseBankTransactionDate(journal.date) <= statementClosingDate)
    .sort((left,right) => sourceId(left).localeCompare(sourceId(right)));
  const relevantJournalIds = new Set(relevantJournals.map(sourceId));
  const bookBalance = roundMoney(relevantJournals.reduce((balance,journal) =>
    balance + journal.lines.filter(line => String(line.accountCode) === "1000" &&
      (String(line.bankAccountId || "")
        ? String(line.bankAccountId) === bankAccountId
        : String(journal.bankAccountId || "") === bankAccountId))
      .reduce((sum,line) => sum + Number(line.debit) - Number(line.credit),0),0));

  const accountTransactions = transactions.filter(transaction => String(transaction?.bankAccountId || "") === bankAccountId);
  const relevantTransactions = accountTransactions.filter(transaction => {
    const date = normaliseBankTransactionDate(transaction?.transactionDate);
    return !date || date <= statementClosingDate;
  }).sort((left,right) => sourceId(left).localeCompare(sourceId(right)));
  const unresolvedTransactions = relevantTransactions.filter(transaction =>
    !normaliseBankTransactionDate(transaction?.transactionDate) ||
    !isCompletedBankTransaction(transaction,relevantJournalIds)
  );
  const difference = roundMoney(bookBalance - statementClosingBalance);
  const blockers = [];
  if(opening.legacyOpeningUnposted) blockers.push("Post or confirm the legacy opening balance before reconciling this account.");
  if(difference !== 0) blockers.push("Book balance and statement balance must agree exactly.");
  if(unresolvedTransactions.length) blockers.push(`${unresolvedTransactions.length} transaction${unresolvedTransactions.length === 1 ? "" : "s"} still need review.`);
  const sourceSnapshot = {
    version:BANK_RECONCILIATION_VERSION,userId,bankAccountId,statementClosingDate,
    openingBalanceAccounting:accountOpeningCore(account),
    journals:relevantJournals.map(journalCore),
    transactions:relevantTransactions.map(transactionCore)
  };

  return Object.freeze({
    version:BANK_RECONCILIATION_VERSION,userId,bankAccountId,statementClosingDate,statementClosingBalance,
    openingBalance:opening.openingBalance,bookBalance,difference,
    unresolvedCount:unresolvedTransactions.length,
    unresolvedTransactionIds:Object.freeze(unresolvedTransactions.map(sourceId)),
    legacyOpeningUnposted:opening.legacyOpeningUnposted,
    eligible:blockers.length === 0,blockers:Object.freeze(blockers),
    sourceFingerprint:fingerprint(sourceSnapshot),
    relevantJournalIds:Object.freeze(relevantJournals.map(sourceId)),
    integrityJournalIds:Object.freeze([...new Set([...relevantJournals.map(sourceId),...opening.integrityJournalIds])]),
    relevantTransactionIds:Object.freeze(relevantTransactions.map(sourceId))
  });
}

function recordCore(position,reconciliationId){
  return {
    version:BANK_RECONCILIATION_VERSION,userId:position.userId,reconciliationId,
    bankAccountId:position.bankAccountId,statementClosingDate:position.statementClosingDate,
    statementClosingBalance:position.statementClosingBalance,bookBalance:position.bookBalance,
    difference:position.difference,unresolvedCount:position.unresolvedCount,
    status:BANK_RECONCILIATION_STATUS.RECONCILED,sourceFingerprint:position.sourceFingerprint
  };
}

function assertExistingRecord(existing,expected){
  if(String(existing?.userId || "") !== expected.userId){
    throw new Error("The reconciliation record belongs to another user.");
  }
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key,existing?.[key]]));
  if(!sameValue(actual,expected)) throw new Error("A different reconciliation already exists for this account and date.");
}

export async function signOffBankReconciliation(options = {}){
  const { db,services = {} } = options;
  for(const helper of ["doc","runTransaction","serverTimestamp"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const initial = calculateBankReconciliation(options);
  if(!initial.eligible) throw new Error(initial.blockers.join(" "));
  const reconciliationId = bankReconciliationDocumentId(initial.bankAccountId,initial.statementClosingDate);
  const accountRef = services.doc(db,"users",initial.userId,"bankAccounts",initial.bankAccountId);
  const reconciliationRef = services.doc(db,"users",initial.userId,"bankReconciliations",reconciliationId);
  const journalRefs = initial.integrityJournalIds.map(id => services.doc(db,"journals",id));
  const transactionRefs = initial.relevantTransactionIds.map(id => services.doc(db,"users",initial.userId,"bankTransactions",id));

  return services.runTransaction(db,async transaction => {
    const snapshots = await Promise.all([
      transaction.get(accountRef),transaction.get(reconciliationRef),
      ...journalRefs.map(reference => transaction.get(reference)),
      ...transactionRefs.map(reference => transaction.get(reference))
    ]);
    const [accountSnapshot,reconciliationSnapshot,...sourceSnapshots] = snapshots;
    if(!exists(accountSnapshot)) throw new Error("The selected bank account no longer exists.");
    const journalSnapshots = sourceSnapshots.slice(0,journalRefs.length);
    const transactionSnapshots = sourceSnapshots.slice(journalRefs.length);
    if(journalSnapshots.some(snapshot => !exists(snapshot)) || transactionSnapshots.some(snapshot => !exists(snapshot))){
      throw new Error("Banking data changed before reconciliation sign-off. Recalculate and try again.");
    }
    const current = calculateBankReconciliation({
      userId:initial.userId,bankAccountId:initial.bankAccountId,account:{ id:initial.bankAccountId,...accountSnapshot.data() },
      statementClosingDate:initial.statementClosingDate,statementClosingBalance:initial.statementClosingBalance,
      journals:journalSnapshots.map((snapshot,index) => ({ id:initial.integrityJournalIds[index],...snapshot.data() })),
      transactions:transactionSnapshots.map((snapshot,index) => ({ id:initial.relevantTransactionIds[index],...snapshot.data() }))
    });
    if(!current.eligible) throw new Error(current.blockers.join(" "));
    if(current.sourceFingerprint !== initial.sourceFingerprint){
      throw new Error("Banking data changed before reconciliation sign-off. Recalculate and try again.");
    }
    const expected = recordCore(current,reconciliationId);
    if(exists(reconciliationSnapshot)){
      assertExistingRecord(reconciliationSnapshot.data(),expected);
      return Object.freeze({ status:"already-reconciled",reconciliationId,record:reconciliationSnapshot.data() });
    }
    if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
    const timestamp = services.serverTimestamp();
    const record = { ...expected,createdAt:timestamp,signedOffAt:timestamp };
    transaction.set(reconciliationRef,record);
    return Object.freeze({ status:"reconciled",reconciliationId,record });
  });
}

export function normaliseBankReconciliation(id,data = {}){
  return Object.freeze({
    id:String(id || data.reconciliationId || ""),version:Number(data.version || 0),
    userId:String(data.userId || ""),bankAccountId:String(data.bankAccountId || ""),
    statementClosingDate:String(data.statementClosingDate || ""),
    statementClosingBalance:Number(data.statementClosingBalance),bookBalance:Number(data.bookBalance),
    difference:Number(data.difference),unresolvedCount:Number(data.unresolvedCount),
    status:String(data.status || ""),sourceFingerprint:String(data.sourceFingerprint || ""),
    createdAt:data.createdAt || null,signedOffAt:data.signedOffAt || null
  });
}

export function reconciliationHistory(records = [],options = {}){
  const userId = requiredText(options.userId,"User ID");
  const bankAccountId = requiredText(options.bankAccountId,"Bank account ID");
  return (Array.isArray(records) ? records : [])
    .filter(record => record.userId === userId && record.bankAccountId === bankAccountId)
    .map(record => {
      let current;
      try{
        current = calculateBankReconciliation({ ...options,
          statementClosingDate:record.statementClosingDate,
          statementClosingBalance:record.statementClosingBalance
        });
      }catch(error){
        return Object.freeze({ ...record,displayStatus:"needs-review",reviewReason:error.message });
      }
      const stale = record.version !== BANK_RECONCILIATION_VERSION ||
        record.status !== BANK_RECONCILIATION_STATUS.RECONCILED ||
        record.sourceFingerprint !== current.sourceFingerprint ||
        record.bookBalance !== current.bookBalance || record.difference !== current.difference ||
        record.unresolvedCount !== current.unresolvedCount || !current.eligible;
      return Object.freeze({
        ...record,displayStatus:stale ? "needs-review" : "reconciled",
        reviewReason:stale ? "Underlying Banking data has changed since sign-off." : ""
      });
    })
    .sort((left,right) => right.statementClosingDate.localeCompare(left.statementClosingDate) || right.id.localeCompare(left.id));
}
