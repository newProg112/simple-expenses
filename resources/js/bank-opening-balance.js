import {
  normaliseOpeningBalanceDate,
  validateBankAccountInput
} from "./bank-account-view.js";
import { validateJournal } from "./ledger-engine.js";
import {
  bankOpeningBalanceJournalDocumentId,
  prepareBankOpeningBalanceJournal
} from "./ledger-firestore.js";

export const BANK_OPENING_BALANCE_VERSION = 1;

function requiredText(value,label,maximum = 1400){
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

function currency(value,label = "Opening balance"){
  const amount = Number(value);
  if(!Number.isFinite(amount)) throw new Error(`${label} must be a finite amount.`);
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  if(Math.abs(amount - rounded) > 1e-8) throw new Error(`${label} must have no more than two decimal places.`);
  return rounded;
}

function accountingCore(bankAccountId,openingBalance,openingBalanceDate){
  return Object.freeze({
    version:BANK_OPENING_BALANCE_VERSION,
    bankAccountId,
    openingBalance:currency(openingBalance),
    openingBalanceDate:requiredDate(openingBalanceDate)
  });
}

function requiredDate(value){
  const date = normaliseOpeningBalanceDate(value);
  if(!date) throw new Error("A valid opening balance effective date is required.");
  return date;
}

function accountingMarker(userId,bankAccountId,openingBalance,openingBalanceDate){
  const core = accountingCore(bankAccountId,openingBalance,openingBalanceDate);
  const journalId = core.openingBalance === 0
    ? ""
    : bankOpeningBalanceJournalDocumentId(userId,bankAccountId);
  return Object.freeze({
    ...core,
    state:core.openingBalance === 0 ? "not-required" : "posted",
    journalId,
    fingerprint:valueFingerprint(core)
  });
}

function validateMarker(userId,bankAccountId,account){
  const marker = account?.openingBalanceAccounting;
  if(!marker || Number(marker.version) !== BANK_OPENING_BALANCE_VERSION){
    throw new Error("Bank account does not have supported opening-balance accounting metadata.");
  }
  const expected = accountingMarker(
    userId,bankAccountId,account.openingBalance,account.openingBalanceDate
  );
  if(!sameValue(marker,expected)){
    throw new Error("The bank account opening-balance marker changed; no accounting data was overwritten.");
  }
  return expected;
}

function expectedJournal(userId,bankAccountId,account,journal){
  const marker = validateMarker(userId,bankAccountId,account);
  if(marker.state === "not-required"){
    if(journal) throw new Error("An unexpected opening-balance journal exists for this zero balance.");
    return null;
  }
  if(!journal || String(journal.userId || "") !== userId || String(journal.journalId || "") !== marker.journalId){
    throw new Error("The bank opening-balance journal is missing or belongs to another user.");
  }
  const expected = prepareBankOpeningBalanceJournal(userId,bankAccountId,account,{
    createdAt:journal.createdAt,updatedAt:journal.updatedAt
  });
  if(!validateJournal(journal).valid || !sameValue(journal,expected)){
    throw new Error("The bank opening-balance journal changed or is invalid.");
  }
  return expected;
}

function validatedAccountInput(input){
  const validation = validateBankAccountInput(input);
  if(!validation.valid){
    throw new Error(Object.values(validation.errors)[0] || "Check the bank account details.");
  }
  return validation.value;
}

function hasActivityMarker(account){
  return Number(account?.bankingActivity?.version) === 1;
}

async function importedActivityExists(db,services,userId,bankAccountId){
  requireServices(services,["collection","query","where","getDocs"]);
  const snapshot = await services.getDocs(services.query(
    services.collection(db,"users",userId,"bankTransactions"),
    services.where("bankAccountId","==",bankAccountId)
  ));
  return !snapshot.empty && (Array.isArray(snapshot.docs) ? snapshot.docs.length > 0 : true);
}

function references(db,services,userId,bankAccountId){
  return {
    accountRef:services.doc(db,"users",userId,"bankAccounts",bankAccountId),
    journalRef:services.doc(db,"journals",bankOpeningBalanceJournalDocumentId(userId,bankAccountId))
  };
}

function accountData(input,timestamp){
  return {
    accountName:input.accountName,
    bankName:input.bankName,
    openingBalance:input.openingBalance,
    openingBalanceDate:input.openingBalanceDate,
    status:"Active",
    createdAt:timestamp,
    updatedAt:timestamp
  };
}

export async function createBankAccountWithOpeningBalance(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const bankAccountId = requiredText(options.bankAccountId,"Bank account ID");
  if(bankAccountId.includes("/")) throw new Error("Bank account ID is invalid.");
  const input = validatedAccountInput(options.input);
  requireServices(services,["doc","runTransaction","serverTimestamp"]);
  const { accountRef,journalRef } = references(db,services,userId,bankAccountId);

  return services.runTransaction(db,async transaction => {
    const [accountSnapshot,journalSnapshot] = await Promise.all([
      transaction.get(accountRef),transaction.get(journalRef)
    ]);
    if(exists(accountSnapshot)){
      const account = accountSnapshot.data();
      const marker = validateMarker(userId,bankAccountId,account);
      if(account.accountName !== input.accountName || account.bankName !== input.bankName ||
        currency(account.openingBalance) !== input.openingBalance || account.openingBalanceDate !== input.openingBalanceDate){
        throw new Error("Bank account ID already exists with different details.");
      }
      expectedJournal(userId,bankAccountId,account,exists(journalSnapshot) ? journalSnapshot.data() : null);
      return Object.freeze({ status:"already-created",bankAccountId,journalId:marker.journalId });
    }
    if(exists(journalSnapshot)) throw new Error("A deterministic opening-balance journal already exists.");
    if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
    const timestamp = services.serverTimestamp();
    const marker = accountingMarker(userId,bankAccountId,input.openingBalance,input.openingBalanceDate);
    const account = { ...accountData(input,timestamp),openingBalanceAccounting:marker };
    transaction.set(accountRef,account);
    if(marker.state === "posted"){
      transaction.set(journalRef,prepareBankOpeningBalanceJournal(userId,bankAccountId,account,{
        createdAt:timestamp,updatedAt:timestamp
      }));
    }
    return Object.freeze({ status:"created",bankAccountId,journalId:marker.journalId });
  });
}

export async function updateBankAccountWithOpeningBalance(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const bankAccountId = requiredText(options.bankAccountId,"Bank account ID");
  const input = validatedAccountInput(options.input);
  requireServices(services,["doc","runTransaction","serverTimestamp"]);
  const importedActivity = await importedActivityExists(db,services,userId,bankAccountId);
  const { accountRef,journalRef } = references(db,services,userId,bankAccountId);

  return services.runTransaction(db,async transaction => {
    const [accountSnapshot,journalSnapshot] = await Promise.all([
      transaction.get(accountRef),transaction.get(journalRef)
    ]);
    if(!exists(accountSnapshot)) throw new Error("Bank account no longer exists.");
    const account = accountSnapshot.data();
    const existingJournal = exists(journalSnapshot) ? journalSnapshot.data() : null;
    const isLegacy = !account.openingBalanceAccounting;
    if(!isLegacy) expectedJournal(userId,bankAccountId,account,existingJournal);
    else if(existingJournal) throw new Error("A legacy account has an unexpected opening-balance journal.");

    const currentBalance = currency(account.openingBalance);
    const currentDate = String(account.openingBalanceDate || "");
    const accountingChanged = currentBalance !== input.openingBalance || currentDate !== input.openingBalanceDate;
    const locked = importedActivity || hasActivityMarker(account);
    if(accountingChanged && locked){
      throw new Error("Opening balance and effective date are locked because Banking activity exists for this account.");
    }
    if(typeof transaction.update !== "function") throw new Error("Firestore transaction update helper is required.");
    const timestamp = services.serverTimestamp();
    const displayUpdate = {
      accountName:input.accountName,bankName:input.bankName,updatedAt:timestamp
    };

    if(isLegacy){
      transaction.update(accountRef,{
        ...displayUpdate,
        ...(accountingChanged ? {
          openingBalance:input.openingBalance,
          openingBalanceDate:input.openingBalanceDate
        } : {})
      });
      return Object.freeze({ status:"updated-legacy-unposted",bankAccountId,locked });
    }
    if(!accountingChanged){
      transaction.update(accountRef,displayUpdate);
      return Object.freeze({ status:"updated",bankAccountId,locked });
    }

    const marker = accountingMarker(userId,bankAccountId,input.openingBalance,input.openingBalanceDate);
    const accountingUpdate = {
      ...displayUpdate,
      openingBalance:input.openingBalance,
      openingBalanceDate:input.openingBalanceDate,
      openingBalanceAccounting:marker
    };
    transaction.update(accountRef,accountingUpdate);
    if(marker.state === "posted"){
      if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
      transaction.set(journalRef,prepareBankOpeningBalanceJournal(userId,bankAccountId,{
        ...account,...accountingUpdate
      },{
        createdAt:existingJournal?.createdAt || timestamp,updatedAt:timestamp
      }));
    }else if(existingJournal){
      if(typeof transaction.delete !== "function") throw new Error("Firestore transaction delete helper is required.");
      transaction.delete(journalRef);
    }
    return Object.freeze({ status:"opening-balance-corrected",bankAccountId,journalId:marker.journalId });
  });
}

export async function postLegacyBankOpeningBalance(options = {}){
  const { db,services = {} } = options;
  const userId = requiredText(options.userId,"User ID");
  const bankAccountId = requiredText(options.bankAccountId,"Bank account ID");
  const openingBalanceDate = requiredDate(options.openingBalanceDate);
  requireServices(services,["doc","runTransaction","serverTimestamp"]);
  const { accountRef,journalRef } = references(db,services,userId,bankAccountId);

  return services.runTransaction(db,async transaction => {
    const [accountSnapshot,journalSnapshot] = await Promise.all([
      transaction.get(accountRef),transaction.get(journalRef)
    ]);
    if(!exists(accountSnapshot)) throw new Error("Bank account no longer exists.");
    const account = accountSnapshot.data();
    if(account.openingBalanceAccounting){
      const marker = validateMarker(userId,bankAccountId,account);
      expectedJournal(userId,bankAccountId,account,exists(journalSnapshot) ? journalSnapshot.data() : null);
      return Object.freeze({ status:"already-posted",bankAccountId,journalId:marker.journalId });
    }
    if(exists(journalSnapshot)) throw new Error("A deterministic opening-balance journal already exists.");
    if(typeof transaction.update !== "function") throw new Error("Firestore transaction update helper is required.");
    const timestamp = services.serverTimestamp();
    const openingBalance = currency(account.openingBalance);
    const marker = accountingMarker(userId,bankAccountId,openingBalance,openingBalanceDate);
    const updatedAccount = {
      ...account,openingBalanceDate,openingBalanceAccounting:marker,updatedAt:timestamp
    };
    transaction.update(accountRef,{
      openingBalanceDate,openingBalanceAccounting:marker,updatedAt:timestamp
    });
    if(marker.state === "posted"){
      if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
      transaction.set(journalRef,prepareBankOpeningBalanceJournal(userId,bankAccountId,updatedAccount,{
        createdAt:timestamp,updatedAt:timestamp
      }));
    }
    return Object.freeze({ status:"posted",bankAccountId,journalId:marker.journalId });
  });
}

export function bankAccountOpeningBalanceLocked(account,transactions = []){
  return hasActivityMarker(account) || (Array.isArray(transactions) && transactions.some(transaction =>
    String(transaction?.bankAccountId || "") === String(account?.id || "")
  ));
}
