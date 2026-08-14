import { describe,expect,it } from "vitest";
import {
  BANK_TRANSFER_ARCHIVED_ACCOUNT_POLICY,
  bankTransferCandidates,
  bankTransferDocumentId,
  bankTransferEligibility,
  transferBankTransaction,
  untransferBankTransaction
} from "../resources/js/bank-transfer.js";
import { calculateBankReconciliation,reconciliationHistory } from "../resources/js/bank-reconciliation.js";
import { bankAccountOpeningBalanceLocked } from "../resources/js/bank-opening-balance.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";
import { normaliseBankTransaction } from "../resources/js/bank-transaction-import.js";
import { unmatchBankTransaction } from "../resources/js/bank-match-confirmation.js";

const userId = "user-1";
const timestamp = Object.freeze({ serverTimestamp:true });
const sourcePath = "users/user-1/bankTransactions/source-row";
const destinationPath = "users/user-1/bankTransactions/destination-row";
const accountAPath = "users/user-1/bankAccounts/account-a";
const accountBPath = "users/user-1/bankAccounts/account-b";
const sourceRow = Object.freeze({
  bankAccountId:"account-a",transactionDate:"2026-08-10",description:"TRANSFER TO SAVINGS",
  moneyIn:null,moneyOut:500,balance:1000,status:"unmatched",source:"csv",importId:"import-a"
});
const destinationRow = Object.freeze({
  bankAccountId:"account-b",transactionDate:"2026-08-11",description:"TRANSFER FROM CURRENT",
  moneyIn:500,moneyOut:null,balance:700,status:"unmatched",source:"csv",importId:"import-b"
});

function mockFirestore(overrides = {}){
  const removed = Symbol("deleteField");
  const documents = new Map([
    [accountAPath,{ accountName:"Current",bankName:"Bank",status:"Active" }],
    [accountBPath,{ accountName:"Savings",bankName:"Bank",status:"Active" }],
    [sourcePath,{ ...sourceRow }],
    ...(overrides.includeDestination === false ? [] : [[destinationPath,{ ...destinationRow }]]),
    ...(overrides.documents || [])
  ]);
  const writes = [];
  let queue = Promise.resolve();
  const doc = (_db,...segments) => ({ path:segments.join("/") });
  const execute = async callback => {
    const staged = [];
    const transaction = {
      get:async reference => ({
        exists:() => documents.has(reference.path),
        data:() => structuredClone(documents.get(reference.path))
      }),
      set:(reference,data) => staged.push({ operation:"set",path:reference.path,data:structuredClone(data) }),
      update:(reference,data) => staged.push({ operation:"update",path:reference.path,data }),
      delete:reference => staged.push({ operation:"delete",path:reference.path })
    };
    const result = await callback(transaction);
    staged.forEach(write => {
      writes.push({ operation:write.operation,path:write.path });
      if(write.operation === "delete") documents.delete(write.path);
      else if(write.operation === "set") documents.set(write.path,write.data);
      else{
        const current = { ...(documents.get(write.path) || {}) };
        Object.entries(write.data).forEach(([key,value]) => {
          if(value === removed) delete current[key];
          else current[key] = structuredClone(value);
        });
        documents.set(write.path,current);
      }
    });
    return result;
  };
  const services = {
    doc,serverTimestamp:() => timestamp,deleteField:() => removed,
    runTransaction:(_db,callback) => {
      const result = queue.then(() => execute(callback));
      queue = result.catch(() => {});
      return result;
    }
  };
  return { documents,writes,services };
}

function transferOptions(fixture,overrides = {}){
  return {
    db:{},userId,transactionId:"source-row",otherBankAccountId:"account-b",
    services:fixture.services,...overrides
  };
}

function journalEntries(documents){
  return [...documents.entries()].filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => journalFromFirestoreData(path.slice(9),data));
}

function rawJournals(documents){
  return [...documents.entries()].filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => ({ id:path.slice(9),...data }));
}

function account(id,openingBalance = 0,status = "Active"){
  return {
    id,accountName:id,bankName:"Bank",status,openingBalance,openingBalanceDate:"2026-08-01",
    openingBalanceAccounting:{
      version:1,bankAccountId:id,openingBalance,openingBalanceDate:"2026-08-01",
      state:"not-required",journalId:"",fingerprint:""
    }
  };
}

function zeroOpeningAccount(id,status = "Active"){
  const result = account(id,0,status);
  const input = JSON.stringify({ bankAccountId:id,openingBalance:0,openingBalanceDate:"2026-08-01",version:1 });
  let hash = 14695981039346656037n;
  for(let index = 0; index < input.length; index += 1){
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64,hash * 1099511628211n);
  }
  result.openingBalanceAccounting.fingerprint = hash.toString(16).padStart(16,"0");
  return result;
}

describe("internal bank transfer identity and candidates",() => {
  it("recognises only unresolved one-direction imported rows and uses deterministic IDs",() => {
    expect(bankTransferEligibility(sourceRow)).toMatchObject({ eligible:true,role:"source",amount:500 });
    expect(bankTransferEligibility(destinationRow)).toMatchObject({ eligible:true,role:"destination",amount:500 });
    expect(bankTransferEligibility({ ...sourceRow,status:"matched" }).eligible).toBe(false);
    expect(bankTransferEligibility({ ...sourceRow,moneyIn:500 }).eligible).toBe(false);
    expect(bankTransferDocumentId(["source-row","destination-row"]))
      .toBe("bank-transfer_destination-row_source-row");
  });

  it("normalises only a complete transfer relationship as resolved",() => {
    const complete = normaliseBankTransaction("source-row",{
      ...sourceRow,status:"matched",matchedRecordType:"bankTransfer",
      matchedRecordId:"bank-transfer_source-row",matchedAmount:500,matchOrigin:"bankTransfer",
      transferVersion:1,transferId:"bank-transfer_source-row",
      transferJournalId:"bank-transfer_user-1_bank-transfer_source-row",
      transferRole:"source",transferStateFingerprint:"fingerprint"
    });
    expect(complete).toMatchObject({
      status:"matched",matchedRecordType:"bankTransfer",transferRole:"source",matchOrigin:"bankTransfer"
    });
    expect(normaliseBankTransaction("incomplete",{
      ...sourceRow,status:"matched",matchedRecordType:"bankTransfer",
      matchedRecordId:"transfer",matchedAmount:500
    }).status).toBe("unmatched");
  });

  it("offers strong candidates but never auto-selects them",() => {
    const transfer = {
      id:"existing",version:1,status:"posted",sourceBankAccountId:"account-a",
      destinationBankAccountId:"account-b",amount:500,effectiveDate:"2026-08-09",
      sourceTransactionId:"old-source",destinationTransactionId:""
    };
    expect(bankTransferCandidates({
      transaction:{ id:"source-row",...sourceRow },otherBankAccountId:"account-b",
      transactions:[{ id:"destination-row",...destinationRow }],transfers:[]
    })).toEqual([expect.objectContaining({ type:"transaction",id:"destination-row" })]);
    expect(bankTransferCandidates({
      transaction:{ id:"destination-row",...destinationRow },otherBankAccountId:"account-a",transactions:[],transfers:[transfer]
    })).toEqual([expect.objectContaining({ type:"transfer",id:"existing" })]);
  });
});

describe("atomic internal transfer posting",() => {
  it("posts Money Out A to B once with line-level bank attribution and no report side effects",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    const result = await transferBankTransaction(transferOptions(fixture));
    expect(result).toMatchObject({ status:"transferred",transferId:"bank-transfer_source-row" });
    const transferPath = `users/${userId}/bankTransfers/${result.transferId}`;
    const journalPath = `journals/bank-transfer_${userId}_${result.transferId}`;
    expect(fixture.documents.get(transferPath)).toMatchObject({
      version:1,userId,sourceBankAccountId:"account-a",destinationBankAccountId:"account-b",
      amount:500,effectiveDate:"2026-08-10",sourceTransactionId:"source-row",
      destinationTransactionId:"",status:"posted"
    });
    expect(fixture.documents.get(journalPath).lines).toEqual([
      expect.objectContaining({ accountCode:"1000",bankAccountId:"account-b",debit:500,credit:0 }),
      expect.objectContaining({ accountCode:"1000",bankAccountId:"account-a",debit:0,credit:500 })
    ]);
    expect(fixture.documents.get(sourcePath)).toMatchObject({
      status:"matched",matchedRecordType:"bankTransfer",matchOrigin:"bankTransfer",
      transferRole:"source",transferId:result.transferId
    });
    const journals = journalEntries(fixture.documents);
    const trialBalance = buildTrialBalance(journals);
    const balanceSheet = buildBalanceSheetReport(journals);
    const profitLoss = buildProfitLossReport(journals);
    const generalLedger = generalLedgerViewFromJournals(journals,{
      accountCode:"1000",
      bankAccounts:[
        { id:"account-a",accountName:"tetttt",status:"Active" },
        { id:"account-b",accountName:"Test Current Account",status:"Active" }
      ]
    });
    expect(trialBalance).toMatchObject({ balanced:true,totalDebits:0,totalCredits:0 });
    expect(trialBalance.accounts.find(row => row.accountCode === "1000")).toMatchObject({ balance:0 });
    expect(balanceSheet).toMatchObject({ totalAssets:0 });
    expect(balanceSheet.assetRows.find(row => row.accountCode === "1000")).toBeUndefined();
    expect(profitLoss).toMatchObject({ totalIncome:0,totalExpenses:0,netResult:0 });
    expect(generalLedger).toMatchObject({ state:"loaded",entriesCount:2,closingBalance:0 });
    expect(generalLedger.rows.map(row => row.bankAccountId)).toEqual(["account-b","account-a"]);
    expect(generalLedger.rows.map(row => row.bankAccountDisplay))
      .toEqual(["To Test Current Account","From tetttt"]);
    expect(journals.flatMap(journal => journal.lines).some(line => ["1200","2100"].includes(line.accountCode))).toBe(false);
  });

  it("rejects generic Unmatch without changing transfer artifacts or markers",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    const result = await transferBankTransaction(transferOptions(fixture));
    const transferPath = `users/${userId}/bankTransfers/${result.transferId}`;
    const journalPath = `journals/bank-transfer_${userId}_${result.transferId}`;
    const before = structuredClone({
      transaction:fixture.documents.get(sourcePath),
      transfer:fixture.documents.get(transferPath),
      journal:fixture.documents.get(journalPath)
    });
    fixture.writes.length = 0;

    await expect(unmatchBankTransaction({
      db:{},userId,transactionId:"source-row",services:fixture.services
    })).rejects.toThrow(/Use Untransfer/i);

    expect(fixture.writes).toEqual([]);
    expect(fixture.documents.get(sourcePath)).toEqual(before.transaction);
    expect(fixture.documents.get(transferPath)).toEqual(before.transfer);
    expect(fixture.documents.get(journalPath)).toEqual(before.journal);
  });

  it("derives the same accounting direction when initiated from Money In",async () => {
    const fixture = mockFirestore({ includeDestination:true });
    const result = await transferBankTransaction(transferOptions(fixture,{
      transactionId:"destination-row",otherBankAccountId:"account-a"
    }));
    const journal = fixture.documents.get(`journals/bank-transfer_${userId}_${result.transferId}`);
    expect(journal).toMatchObject({ sourceBankAccountId:"account-a",destinationBankAccountId:"account-b" });
    expect(journal.lines).toEqual([
      expect.objectContaining({ bankAccountId:"account-b",debit:500,credit:0 }),
      expect.objectContaining({ bankAccountId:"account-a",debit:0,credit:500 })
    ]);
  });

  it("attributes one shared journal to both account reconciliations and respects the closing date",async () => {
    const fixture = mockFirestore({ includeDestination:true });
    await transferBankTransaction(transferOptions(fixture,{ oppositeTransactionId:"destination-row" }));
    const journals = rawJournals(fixture.documents);
    const transactions = [
      { id:"source-row",...fixture.documents.get(sourcePath) },
      { id:"destination-row",...fixture.documents.get(destinationPath) }
    ];
    const source = calculateBankReconciliation({
      userId,bankAccountId:"account-a",account:zeroOpeningAccount("account-a"),
      statementClosingDate:"2026-08-31",statementClosingBalance:-500,journals,transactions
    });
    const destination = calculateBankReconciliation({
      userId,bankAccountId:"account-b",account:zeroOpeningAccount("account-b"),
      statementClosingDate:"2026-08-31",statementClosingBalance:500,journals,transactions
    });
    expect(source).toMatchObject({ bookBalance:-500,unresolvedCount:0,eligible:true });
    expect(destination).toMatchObject({ bookBalance:500,unresolvedCount:0,eligible:true });
    expect(calculateBankReconciliation({
      userId,bankAccountId:"account-a",account:zeroOpeningAccount("account-a"),
      statementClosingDate:"2026-08-09",statementClosingBalance:0,journals,transactions
    })).toMatchObject({ bookBalance:0,unresolvedCount:0,eligible:true });
  });

  it("pairs both imported sides into one transfer and one journal",async () => {
    const fixture = mockFirestore();
    const result = await transferBankTransaction(transferOptions(fixture,{ oppositeTransactionId:"destination-row" }));
    expect(fixture.documents.get(sourcePath)).toMatchObject({ transferRole:"source",pairedBankTransactionId:"destination-row" });
    expect(fixture.documents.get(destinationPath)).toMatchObject({ transferRole:"destination",pairedBankTransactionId:"source-row" });
    expect([...fixture.documents.keys()].filter(path => path.includes("/bankTransfers/")).length).toBe(1);
    expect([...fixture.documents.keys()].filter(path => path.startsWith("journals/bank-transfer_")).length).toBe(1);
    await expect(transferBankTransaction(transferOptions(fixture,{ oppositeTransactionId:"destination-row" })))
      .resolves.toMatchObject({ status:"already-transferred",transferId:result.transferId });
  });

  it("links a later opposite statement side without another accounting movement",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    const first = await transferBankTransaction(transferOptions(fixture));
    fixture.documents.set(destinationPath,{ ...destinationRow });
    const second = await transferBankTransaction(transferOptions(fixture,{
      transactionId:"destination-row",otherBankAccountId:"account-a",existingTransferId:first.transferId
    }));
    expect(second).toMatchObject({ status:"linked",transferId:first.transferId,pairedTransactionId:"source-row" });
    expect([...fixture.documents.keys()].filter(path => path.startsWith("journals/bank-transfer_")).length).toBe(1);
    expect(fixture.documents.get(destinationPath)).toMatchObject({
      status:"matched",transferRole:"destination",pairedBankTransactionId:"source-row"
    });
  });

  it("blocks a second posting when a compatible unpaired transfer is already open",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    await transferBankTransaction(transferOptions(fixture));
    fixture.documents.set(destinationPath,{ ...destinationRow });
    await expect(transferBankTransaction(transferOptions(fixture,{
      transactionId:"destination-row",otherBankAccountId:"account-a"
    }))).rejects.toThrow(/matching unpaired transfer already exists/i);
    expect([...fixture.documents.keys()].filter(path => path.startsWith("journals/bank-transfer_")).length).toBe(1);
  });

  it("serialises repeated and concurrent requests without duplicate writes",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    const [first,second] = await Promise.all([
      transferBankTransaction(transferOptions(fixture)),transferBankTransaction(transferOptions(fixture))
    ]);
    expect([first.status,second.status].sort()).toEqual(["already-transferred","transferred"]);
    expect([...fixture.documents.keys()].filter(path => path.startsWith("journals/bank-transfer_")).length).toBe(1);
  });

  it("rejects same-account, missing-owned-account, already matched, and categorised rows",async () => {
    const same = mockFirestore();
    await expect(transferBankTransaction(transferOptions(same,{ otherBankAccountId:"account-a" })))
      .rejects.toThrow(/different bank account/i);
    const missing = mockFirestore();
    await expect(transferBankTransaction(transferOptions(missing,{ otherBankAccountId:"not-owned" })))
      .rejects.toThrow(/not owned/i);
    const matched = mockFirestore({ documents:[[sourcePath,{ ...sourceRow,status:"matched",matchedRecordType:"invoice" }]] });
    await expect(transferBankTransaction(transferOptions(matched))).rejects.toThrow(/undo the existing match/i);
    const categorised = mockFirestore({ documents:[[sourcePath,{
      ...sourceRow,status:"matched",matchedRecordType:"bankIncome",matchOrigin:"categorisation"
    }]] });
    await expect(transferBankTransaction(transferOptions(categorised))).rejects.toThrow(/undo the existing match/i);
  });

  it("allows an archived owned counterpart for historical integrity and locks both opening balances",async () => {
    const fixture = mockFirestore({
      includeDestination:false,
      documents:[[accountBPath,{ accountName:"Old Savings",bankName:"Bank",status:"Archived" }]]
    });
    await transferBankTransaction(transferOptions(fixture));
    expect(BANK_TRANSFER_ARCHIVED_ACCOUNT_POLICY).toMatch(/remain selectable/i);
    expect(fixture.documents.get(accountAPath).bankingActivity).toEqual({ version:1,type:"bankTransfer" });
    expect(fixture.documents.get(accountBPath).bankingActivity).toEqual({ version:1,type:"bankTransfer" });
    expect(bankAccountOpeningBalanceLocked({ id:"account-b",...fixture.documents.get(accountBPath) },[])).toBe(true);
  });
});

describe("safe Untransfer",() => {
  it("deletes the shared transfer and journal and restores both paired rows atomically",async () => {
    const fixture = mockFirestore();
    const posted = await transferBankTransaction(transferOptions(fixture,{ oppositeTransactionId:"destination-row" }));
    await expect(untransferBankTransaction({
      db:{},userId,transactionId:"destination-row",services:fixture.services
    })).resolves.toMatchObject({ status:"untransferred",transferId:posted.transferId });
    expect(fixture.documents.has(`users/${userId}/bankTransfers/${posted.transferId}`)).toBe(false);
    expect(fixture.documents.has(`journals/bank-transfer_${userId}_${posted.transferId}`)).toBe(false);
    expect(fixture.documents.get(sourcePath)).toMatchObject({ status:"unmatched" });
    expect(fixture.documents.get(destinationPath)).toMatchObject({ status:"unmatched" });
    expect(fixture.documents.get(sourcePath)).not.toHaveProperty("transferId");
    await expect(untransferBankTransaction({ db:{},userId,transactionId:"source-row",services:fixture.services }))
      .resolves.toMatchObject({ status:"already-untransferred" });
  });

  it("makes a signed reconciliation Needs review without rewriting its snapshot",async () => {
    const fixture = mockFirestore({ includeDestination:false });
    await transferBankTransaction(transferOptions(fixture));
    const beforeTransactions = [{ id:"source-row",...fixture.documents.get(sourcePath) }];
    const beforeJournals = rawJournals(fixture.documents);
    const calculationOptions = {
      userId,bankAccountId:"account-a",account:zeroOpeningAccount("account-a"),
      statementClosingDate:"2026-08-31",statementClosingBalance:-500,
      journals:beforeJournals,transactions:beforeTransactions
    };
    const signed = calculateBankReconciliation(calculationOptions);
    const record = {
      id:"signed",version:1,userId,bankAccountId:"account-a",statementClosingDate:"2026-08-31",
      statementClosingBalance:-500,bookBalance:-500,difference:0,unresolvedCount:0,
      status:"reconciled",sourceFingerprint:signed.sourceFingerprint
    };
    await untransferBankTransaction({ db:{},userId,transactionId:"source-row",services:fixture.services });
    const history = reconciliationHistory([record],{
      ...calculationOptions,journals:rawJournals(fixture.documents),
      transactions:[{ id:"source-row",...fixture.documents.get(sourcePath) }]
    });
    expect(history[0]).toMatchObject({ displayStatus:"needs-review",sourceFingerprint:signed.sourceFingerprint });
  });
});
