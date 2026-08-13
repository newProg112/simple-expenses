import { describe,expect,it } from "vitest";
import {
  bankReconciliationDocumentId,
  calculateBankReconciliation,
  isCompletedBankTransaction,
  normaliseBankReconciliation,
  reconciliationHistory,
  signOffBankReconciliation,
  validateBankReconciliationInput
} from "../resources/js/bank-reconciliation.js";
import { bankOpeningBalanceJournalDocumentId } from "../resources/js/ledger-firestore.js";

const userId = "user-1";
const timestamp = Object.freeze({ serverTimestamp:true });

function account(id = "account-a",amount = 100,date = "2026-01-01",status = "Active"){
  const openingId = amount === 0 ? "" : bankOpeningBalanceJournalDocumentId(userId,id);
  return {
    id,accountName:id,bankName:"Bank",openingBalance:amount,openingBalanceDate:date,status,
    openingBalanceAccounting:{
      version:1,bankAccountId:id,openingBalance:amount,openingBalanceDate:date,
      state:amount === 0 ? "not-required" : "posted",journalId:openingId,
      fingerprint:openingFingerprint(id,amount,date)
    }
  };
}

function openingFingerprint(bankAccountId,openingBalance,openingBalanceDate){
  const input = JSON.stringify({
    bankAccountId,openingBalance,openingBalanceDate,version:1
  });
  let hash = 14695981039346656037n;
  for(let index = 0; index < input.length; index += 1){
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64,hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16,"0");
}

function bankJournal(id,bankAccountId,date,amount,sourceType = "bankSettlement"){
  const positive = amount >= 0;
  return {
    id,journalId:id,userId,date,sourceType,sourceId:id,bankAccountId,description:id,
    lines:positive ? [
      { accountCode:"1000",description:id,debit:amount,credit:0 },
      { accountCode:"3100",description:id,debit:0,credit:amount }
    ] : [
      { accountCode:"3100",description:id,debit:-amount,credit:0 },
      { accountCode:"1000",description:id,debit:0,credit:-amount }
    ]
  };
}

function openingJournal(bankAccountId,amount,date = "2026-01-01"){
  return {
    ...bankJournal(bankOpeningBalanceJournalDocumentId(userId,bankAccountId),bankAccountId,date,amount,"bankOpeningBalance"),
    sourceId:bankAccountId
  };
}

function resolvedTransaction(id,bankAccountId,date,journalId,overrides = {}){
  return {
    id,bankAccountId,transactionDate:date,status:"matched",matchedRecordType:"invoice",
    matchedRecordId:`invoice-${id}`,matchedAmount:20,settlementJournalId:journalId,
    settlementVersion:1,settlementStateFingerprint:"settled",moneyIn:20,moneyOut:null,...overrides
  };
}

function position(overrides = {}){
  const selected = overrides.account || account();
  const journals = overrides.journals || [openingJournal(selected.id,selected.openingBalance,selected.openingBalanceDate)];
  return calculateBankReconciliation({
    userId,bankAccountId:selected.id,account:selected,statementClosingDate:"2026-01-31",
    statementClosingBalance:selected.openingBalance,journals,transactions:[],...overrides
  });
}

describe("per-account reconciliation calculation",() => {
  it("reconciles positive and overdraft opening positions with an exact zero difference",() => {
    expect(position()).toMatchObject({ openingBalance:100,bookBalance:100,statementClosingBalance:100,difference:0,eligible:true });
    const overdraft = account("overdraft",-250);
    expect(position({ account:overdraft,journals:[openingJournal("overdraft",-250)],statementClosingBalance:-250 }))
      .toMatchObject({ openingBalance:-250,bookBalance:-250,difference:0,eligible:true });
  });

  it("blocks non-zero differences after deterministic money rounding",() => {
    expect(position({ statementClosingBalance:99.99 })).toMatchObject({ difference:0.01,eligible:false });
    const selected = account("rounding",0);
    const journals = [bankJournal("one","rounding","2026-01-02",0.1),bankJournal("two","rounding","2026-01-03",0.2)];
    expect(position({ account:selected,journals,statementClosingBalance:0.3 }))
      .toMatchObject({ bookBalance:0.3,difference:0,eligible:true });
  });

  it("counts unmatched, invalid, legacy-matched, and incomplete matches as unresolved",() => {
    const settlement = bankJournal("settlement","account-a","2026-01-10",20);
    const transactions = [
      { id:"unmatched",bankAccountId:"account-a",transactionDate:"2026-01-05",status:"unmatched" },
      { id:"invalid-date",bankAccountId:"account-a",transactionDate:"not-a-date",status:"unmatched" },
      { id:"legacy",bankAccountId:"account-a",transactionDate:"2026-01-06",status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",matchedAmount:20 },
      resolvedTransaction("incomplete","account-a","2026-01-07","settlement",{ settlementStateFingerprint:"" })
    ];
    expect(position({ journals:[openingJournal("account-a",100),settlement],transactions,statementClosingBalance:120 }))
      .toMatchObject({ bookBalance:120,unresolvedCount:4,eligible:false });
  });

  it("does not count valid matched or Money Out/Money In categorised transactions as unresolved",() => {
    const journals = [
      openingJournal("account-a",100),
      bankJournal("settled-invoice","account-a","2026-01-05",20),
      bankJournal("settled-expense","account-a","2026-01-06",-10),
      bankJournal("categorised-income","account-a","2026-01-07",5,"bankIncome")
    ];
    const transactions = [
      resolvedTransaction("invoice","account-a","2026-01-05","settled-invoice"),
      resolvedTransaction("expense","account-a","2026-01-06","settled-expense",{
        matchedRecordType:"expense",matchOrigin:"categorisation",categorisationVersion:1,moneyIn:null,moneyOut:10
      }),
      resolvedTransaction("income","account-a","2026-01-07","",{
        matchedRecordType:"bankIncome",matchOrigin:"categorisation",categorisationVersion:1,
        categorisationJournalId:"categorised-income",categorisationStateFingerprint:"categorised",moneyIn:5
      })
    ];
    expect(transactions.every(transaction => isCompletedBankTransaction(transaction,new Set(journals.map(journal => journal.id))))).toBe(true);
    expect(position({ journals,transactions,statementClosingBalance:115 }))
      .toMatchObject({ bookBalance:115,unresolvedCount:0,eligible:true });
  });

  it("isolates multiple accounts rather than using the combined 1000 balance",() => {
    const journals = [
      openingJournal("account-a",3000),openingJournal("account-b",500),
      bankJournal("a-income","account-a","2026-01-10",100),
      bankJournal("b-payment","account-b","2026-01-11",-50)
    ];
    const selected = account("account-b",500);
    expect(position({ account:selected,journals,statementClosingBalance:450 })).toMatchObject({ bookBalance:450,difference:0 });
  });

  it("applies closing-date cutoffs to opening balances, journals, and transactions",() => {
    const futureOpening = account("future",100,"2026-02-01");
    expect(position({ account:futureOpening,journals:[openingJournal("future",100,"2026-02-01")],statementClosingBalance:0 }))
      .toMatchObject({ openingBalance:0,bookBalance:0,eligible:true });
    const journals = [openingJournal("account-a",100),bankJournal("future","account-a","2026-02-01",50)];
    const transactions = [{ id:"future",bankAccountId:"account-a",transactionDate:"2026-02-01",status:"unmatched" }];
    expect(position({ journals,transactions,statementClosingBalance:100 }))
      .toMatchObject({ bookBalance:100,unresolvedCount:0,eligible:true });
  });

  it("warns and blocks when a legacy opening position has not been explicitly posted",() => {
    const legacy = { id:"legacy",accountName:"Legacy",openingBalance:100,status:"Active" };
    expect(position({ account:legacy,journals:[],statementClosingBalance:0 })).toMatchObject({
      openingBalance:0,bookBalance:0,legacyOpeningUnposted:true,eligible:false
    });
  });

  it("validates owner, calendar date, and signed statement amount",() => {
    expect(validateBankReconciliationInput({ bankAccountId:"a",statementClosingDate:"2026-02-30",statementClosingBalance:"x" }))
      .toMatchObject({ valid:false,errors:{ statementClosingDate:expect.any(String),statementClosingBalance:expect.any(String) } });
    expect(validateBankReconciliationInput({ bankAccountId:"a",statementClosingDate:"2026-01-31",statementClosingBalance:"-25.50" }))
      .toMatchObject({ valid:true,value:{ statementClosingBalance:-25.5 } });
    const wrongOwner = openingJournal("account-a",100);
    wrongOwner.userId = "user-2";
    expect(() => position({ journals:[wrongOwner] })).toThrow(/authenticated user/i);
  });
});

function firestoreFixture(seed = []){
  const documents = new Map(seed.map(([path,data]) => [path,structuredClone(data)]));
  const writes = [];
  let queue = Promise.resolve();
  const services = {
    doc:(_db,...segments) => ({ path:segments.join("/") }),
    serverTimestamp:() => timestamp,
    runTransaction:(_db,callback) => {
      const operation = queue.then(async () => {
        const staged = [];
        const transaction = {
          get:async reference => ({ exists:() => documents.has(reference.path),data:() => structuredClone(documents.get(reference.path)) }),
          set:(reference,data) => staged.push({ path:reference.path,data:structuredClone(data) })
        };
        const result = await callback(transaction);
        staged.forEach(write => { documents.set(write.path,write.data); writes.push(write.path); });
        return result;
      });
      queue = operation.catch(() => {});
      return operation;
    }
  };
  return { documents,writes,services };
}

function signOffFixture(){
  const selected = account();
  const opening = openingJournal("account-a",100);
  return {
    selected,opening,
    fixture:firestoreFixture([
      [`users/${userId}/bankAccounts/account-a`,selected],
      [`journals/${opening.id}`,opening]
    ])
  };
}

function signOffOptions(context,overrides = {}){
  return {
    db:{},userId,bankAccountId:"account-a",account:context.selected,
    statementClosingDate:"2026-01-31",statementClosingBalance:100,
    journals:[context.opening],transactions:[],services:context.fixture.services,...overrides
  };
}

describe("reconciliation sign-off and immutable history",() => {
  it("creates one owned, versioned reconciliation record without a journal",async () => {
    const context = signOffFixture();
    const expectedId = bankReconciliationDocumentId("account-a","2026-01-31");
    await expect(signOffBankReconciliation(signOffOptions(context))).resolves.toMatchObject({ status:"reconciled",reconciliationId:expectedId });
    const path = `users/${userId}/bankReconciliations/${expectedId}`;
    expect(context.fixture.documents.get(path)).toMatchObject({
      version:1,userId,reconciliationId:expectedId,bankAccountId:"account-a",
      statementClosingDate:"2026-01-31",statementClosingBalance:100,bookBalance:100,
      difference:0,unresolvedCount:0,status:"reconciled",createdAt:timestamp,signedOffAt:timestamp
    });
    expect([...context.fixture.documents.keys()].filter(key => key.startsWith("journals/"))).toHaveLength(1);
  });

  it("blocks dirty positions and revalidates source ownership inside the write transaction",async () => {
    const context = signOffFixture();
    await expect(signOffBankReconciliation(signOffOptions(context,{ statementClosingBalance:99 }))).rejects.toThrow(/agree exactly/i);
    expect(context.fixture.writes).toEqual([]);
    context.fixture.documents.get(`journals/${context.opening.id}`).userId = "user-2";
    await expect(signOffBankReconciliation(signOffOptions(context))).rejects.toThrow(/authenticated user/i);
    expect(context.fixture.writes).toEqual([]);
  });

  it("is idempotent for a retry and concurrent two-tab sign-off",async () => {
    const context = signOffFixture();
    const results = await Promise.all([
      signOffBankReconciliation(signOffOptions(context)),signOffBankReconciliation(signOffOptions(context))
    ]);
    expect(results.map(result => result.status).sort()).toEqual(["already-reconciled","reconciled"]);
    expect(context.fixture.writes).toHaveLength(1);
    await expect(signOffBankReconciliation(signOffOptions(context))).resolves.toMatchObject({ status:"already-reconciled" });
    expect(context.fixture.writes).toHaveLength(1);
  });

  it("preserves signed values and flags history when underlying historical data later changes",async () => {
    const context = signOffFixture();
    const result = await signOffBankReconciliation(signOffOptions(context));
    const saved = normaliseBankReconciliation(result.reconciliationId,result.record);
    expect(reconciliationHistory([saved],signOffOptions(context))[0].displayStatus).toBe("reconciled");
    const laterTransaction = { id:"late-import",bankAccountId:"account-a",transactionDate:"2026-01-20",status:"unmatched" };
    const reviewed = reconciliationHistory([saved],signOffOptions(context,{ transactions:[laterTransaction] }))[0];
    expect(reviewed).toMatchObject({ displayStatus:"needs-review",bookBalance:100,difference:0,unresolvedCount:0 });
    expect(reviewed.reviewReason).toMatch(/changed/i);
    expect(saved).toMatchObject({ status:"reconciled",bookBalance:100,difference:0,unresolvedCount:0 });
  });

  it("keeps reconciliation history readable when its bank account is archived",async () => {
    const context = signOffFixture();
    const result = await signOffBankReconciliation(signOffOptions(context));
    const archived = { ...context.selected,status:"Archived" };
    const history = reconciliationHistory([
      normaliseBankReconciliation(result.reconciliationId,result.record)
    ],signOffOptions(context,{ account:archived }));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ displayStatus:"reconciled",bankAccountId:"account-a" });
  });
});
