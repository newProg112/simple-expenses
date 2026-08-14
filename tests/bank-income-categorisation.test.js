import { describe,expect,it } from "vitest";
import {
  BANK_INCOME_CATEGORIES,
  bankIncomeDocumentId,
  categoriseMoneyIn,
  moneyInCategorisationEligibility,
  uncategoriseMoneyIn
} from "../resources/js/bank-income-categorisation.js";
import { BANK_VAT_TREATMENTS } from "../resources/js/bank-transaction-categorisation.js";
import { confirmBankMatch,unmatchBankTransaction } from "../resources/js/bank-match-confirmation.js";
import { normaliseBankTransaction } from "../resources/js/bank-transaction-import.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const timestamp = Object.freeze({ serverTimestamp:true });
const now = "2026-08-13T09:30:00.000Z";
const transactionPath = "users/user-1/bankTransactions/bank-1";
const sourcePath = "users/user-1/bankIncome/bank-income_bank-1";
const journalPath = "journals/bank-income_user-1_bank-income_bank-1";
const imported = Object.freeze({
  bankAccountId:"account-1",transactionDate:"13/08/2026",description:"ACME RECEIPT",
  moneyIn:120,moneyOut:null,balance:1550,status:"unmatched",source:"csv",importId:"import-1",
  createdAt:"2026-08-13T08:00:00.000Z",updatedAt:"2026-08-13T08:00:00.000Z"
});
const input = Object.freeze({
  payer:"Acme Ltd",category:"Sales / Trading income",description:"Consulting receipt",
  vatTreatment:BANK_VAT_TREATMENTS.INCLUDED_20,projectId:"project-1"
});

function mockFirestore(overrides = {}){
  const removed = Symbol("deleteField");
  const documents = new Map([
    [transactionPath,{ ...imported,...(overrides.transaction || {}) }],
    ["users/user-1/bankAccounts/account-1",{ accountName:"Current",status:"Active" }],
    ["users/user-1/projects/project-1",{ name:"Launch",reference:"PR-1",status:"Active" }],
    ...(overrides.documents || [])
  ]);
  const writes = [];
  let queue = Promise.resolve();
  const doc = (_db,...segments) => ({ path:segments.join("/") });
  const execute = async callback => {
    const staged = [];
    const firestoreTransaction = {
      get:async reference => ({
        exists:() => documents.has(reference.path),
        data:() => structuredClone(documents.get(reference.path))
      }),
      set:(reference,data) => staged.push({ operation:"set",path:reference.path,data:structuredClone(data) }),
      update:(reference,data) => staged.push({ operation:"update",path:reference.path,data }),
      delete:reference => staged.push({ operation:"delete",path:reference.path })
    };
    const result = await callback(firestoreTransaction);
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

function options(fixture,overrides = {}){
  const { input:inputOverrides,...rest } = overrides;
  return {
    db:{},userId:"user-1",transactionId:"bank-1",input:{ ...input,...(inputOverrides || {}) },
    services:fixture.services,now:() => now,...rest
  };
}

function journals(documents){
  return [...documents.entries()]
    .filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => journalFromFirestoreData(path.slice("journals/".length),data));
}

describe("Money In categorisation eligibility and identity",() => {
  it("allows only unmatched positive Money In rows with no Money Out",() => {
    expect(moneyInCategorisationEligibility(imported)).toMatchObject({ eligible:true,gross:120,date:"2026-08-13" });
    expect(moneyInCategorisationEligibility({ ...imported,moneyIn:0 }).eligible).toBe(false);
    expect(moneyInCategorisationEligibility({ ...imported,moneyIn:-120 }).eligible).toBe(false);
    expect(moneyInCategorisationEligibility({ ...imported,moneyOut:1 }).reason).toMatch(/both Money In and Money Out/i);
    expect(moneyInCategorisationEligibility({ ...imported,moneyIn:null,moneyOut:120 }).eligible).toBe(false);
    expect(moneyInCategorisationEligibility({ ...imported,status:"matched" }).eligible).toBe(false);
    expect(moneyInCategorisationEligibility({ ...imported,transactionDate:"invalid" }).eligible).toBe(false);
    expect(moneyInCategorisationEligibility({ ...imported,bankAccountId:"" }).eligible).toBe(false);
  });

  it("uses an encoded deterministic source identity and an explicit income mapping",() => {
    expect(bankIncomeDocumentId("bank-1")).toBe("bank-income_bank-1");
    expect(bankIncomeDocumentId("bank/1")).toBe("bank-income_bank%2F1");
    expect(BANK_INCOME_CATEGORIES).toEqual([
      { value:"Sales / Trading income",accountCode:"4000" },
      { value:"Interest received",accountCode:"4100" },
      { value:"Other income",accountCode:"4200" }
    ]);
  });

  it("normalises only a complete Banking-created income relationship as matched",() => {
    const complete = normaliseBankTransaction("bank-1",{
      ...imported,status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"bank-income_bank-1",matchedAmount:120,
      matchOrigin:"categorisation",categorisationVersion:1,
      categorisationJournalId:"bank-income_user-1_bank-income_bank-1",categorisationStateFingerprint:"abc123"
    });
    expect(complete).toMatchObject({
      status:"matched",matchedRecordType:"bankIncome",matchOrigin:"categorisation",
      categorisationJournalId:"bank-income_user-1_bank-income_bank-1",categorisationStateFingerprint:"abc123"
    });
    expect(normaliseBankTransaction("bank-1",{
      ...imported,status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"bank-income_bank-1",matchedAmount:120
    }).status).toBe("unmatched");
  });
});

describe("atomic Money In categorisation",() => {
  it("creates one source, one direct journal, and the matched row together",async () => {
    const fixture = mockFirestore();
    const original = structuredClone(fixture.documents.get(transactionPath));
    await expect(categoriseMoneyIn(options(fixture))).resolves.toMatchObject({
      status:"categorised",incomeId:"bank-income_bank-1",
      journalId:"bank-income_user-1_bank-income_bank-1",gross:120
    });
    expect(fixture.writes).toEqual([
      { operation:"set",path:sourcePath },
      { operation:"set",path:journalPath },
      { operation:"update",path:transactionPath }
    ]);
    expect(fixture.documents.get(sourcePath)).toMatchObject({
      id:"bank-income_bank-1",userId:"user-1",sourceType:"bankIncome",sourceVersion:1,
      bankTransactionId:"bank-1",bankAccountId:"account-1",date:"2026-08-13",payer:"Acme Ltd",
      category:"Sales / Trading income",incomeAccountCode:"4000",description:"Consulting receipt",
      net:100,vatRate:0.2,vat:20,gross:120,projectId:"project-1",projectName:"Launch",projectReference:"PR-1",
      bankCategorisation:{ version:1,transactionId:"bank-1",journalId:"bank-income_user-1_bank-income_bank-1" }
    });
    expect(fixture.documents.get(journalPath).lines).toEqual([
      expect.objectContaining({ accountCode:"1000",debit:120,credit:0 }),
      expect.objectContaining({ accountCode:"4000",debit:0,credit:100 }),
      expect.objectContaining({ accountCode:"2100",debit:0,credit:20 })
    ]);
    expect(fixture.documents.get(journalPath).bankAccountId).toBe("account-1");
    const matched = fixture.documents.get(transactionPath);
    expect(matched).toMatchObject({
      status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"bank-income_bank-1",
      matchedAmount:120,categorisationJournalId:"bank-income_user-1_bank-income_bank-1",
      matchOrigin:"categorisation",categorisationVersion:1
    });
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(matched[field]).toEqual(original[field]);
    }
  });

  it("allows historical categorisation for an owned Archived bank account",async () => {
    const fixture = mockFirestore({
      documents:[["users/user-1/bankAccounts/account-1",{ accountName:"Current",status:"Archived" }]]
    });

    await expect(categoriseMoneyIn(options(fixture))).resolves.toMatchObject({ status:"categorised" });

    expect(fixture.documents.get(sourcePath).bankAccountId).toBe("account-1");
    expect(fixture.documents.get(journalPath)).toMatchObject({ bankAccountId:"account-1" });
  });

  it.each([
    ["a blank attribution",{ transaction:{ bankAccountId:"" } }],
    ["a missing account",{ transaction:{ bankAccountId:"missing-account" } }],
    ["a foreign-owned account",{
      transaction:{ bankAccountId:"foreign-account" },
      documents:[["users/user-2/bankAccounts/foreign-account",{ accountName:"Foreign",status:"Active" }]]
    }],
    ["an unsupported account status",{
      documents:[["users/user-1/bankAccounts/account-1",{ accountName:"Current",status:"Suspended" }]]
    }],
    ["a malformed attribution",{ transaction:{ bankAccountId:" account-1 " } }]
  ])("rejects %s with zero writes",async (_label,fixtureOptions) => {
    const fixture = mockFirestore(fixtureOptions);
    const before = structuredClone([...fixture.documents.entries()]);

    await expect(categoriseMoneyIn(options(fixture))).rejects.toThrow(/bank account/i);

    expect(fixture.writes).toEqual([]);
    expect([...fixture.documents.entries()]).toEqual(before);
  });

  it("uses the persisted transaction account when UI state supplies another account ID",async () => {
    const fixture = mockFirestore({
      documents:[["users/user-1/bankAccounts/account-2",{ accountName:"Other",status:"Active" }]]
    });

    await categoriseMoneyIn(options(fixture,{ bankAccountId:"account-2" }));

    expect(fixture.documents.get(sourcePath).bankAccountId).toBe("account-1");
    expect(fixture.documents.get(journalPath)).toMatchObject({ bankAccountId:"account-1" });
  });

  it.each([
    ["Sales / Trading income","4000"],["Interest received","4100"],["Other income","4200"]
  ])("posts %s to account %s",async (category,accountCode) => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture,{ input:{ category,vatTreatment:BANK_VAT_TREATMENTS.NONE,projectId:"" } }));
    expect(fixture.documents.get(journalPath).lines).toEqual([
      expect.objectContaining({ accountCode:"1000",debit:120,credit:0 }),
      expect.objectContaining({ accountCode,debit:0,credit:120 })
    ]);
  });

  it.each([
    [BANK_VAT_TREATMENTS.NONE,"",{ net:120,vat:0 }],
    [BANK_VAT_TREATMENTS.INCLUDED_20,"",{ net:100,vat:20 }],
    [BANK_VAT_TREATMENTS.INCLUDED_5,"",{ net:114.29,vat:5.71 }],
    [BANK_VAT_TREATMENTS.EXACT,"17.25",{ net:102.75,vat:17.25 }]
  ])("posts %s VAT while preserving gross",async (vatTreatment,exactVat,expected) => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture,{ input:{ vatTreatment,exactVat,projectId:"" } }));
    expect(fixture.documents.get(sourcePath)).toMatchObject({ ...expected,gross:120 });
    expect(fixture.documents.get(journalPath).lines.reduce((sum,line) => sum + line.debit,0)).toBe(120);
    expect(fixture.documents.get(journalPath).lines.reduce((sum,line) => sum + line.credit,0)).toBe(120);
  });

  it("feeds Trial Balance, Profit & Loss, General Ledger data, and Balance Sheet correctly",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture,{ input:{ category:"Interest received",vatTreatment:BANK_VAT_TREATMENTS.INCLUDED_20,projectId:"" } }));
    const posted = journals(fixture.documents);
    const trialBalance = buildTrialBalance(posted);
    const profitLoss = buildProfitLossReport(posted);
    const balanceSheet = buildBalanceSheetReport(posted);
    const bankLedger = generalLedgerViewFromJournals(posted,{ accountCode:"1000" });
    const incomeLedger = generalLedgerViewFromJournals(posted,{ accountCode:"4100" });
    const vatLedger = generalLedgerViewFromJournals(posted,{ accountCode:"2100" });
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode:"1000",debits:120 }),
      expect.objectContaining({ accountCode:"4100",credits:100 }),
      expect.objectContaining({ accountCode:"2100",credits:20 })
    ]));
    expect(profitLoss).toMatchObject({ totalIncome:100,totalExpenses:0,netResult:100 });
    expect(profitLoss.incomeRows).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode:"4100",amount:100 })]));
    expect(balanceSheet.assetRows).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode:"1000",amount:120 })]));
    expect(balanceSheet.liabilityRows).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode:"2100",amount:20 })]));
    expect(bankLedger).toMatchObject({ state:"loaded",entriesCount:1,closingBalance:120 });
    expect(incomeLedger).toMatchObject({ state:"loaded",entriesCount:1,closingBalance:-100 });
    expect(vatLedger).toMatchObject({ state:"loaded",entriesCount:1,closingBalance:-20 });
  });

  it("validates projects, rejects collisions and already-matched rows",async () => {
    const missingProject = mockFirestore();
    await expect(categoriseMoneyIn(options(missingProject,{ input:{ projectId:"missing" } }))).rejects.toThrow(/project no longer exists/i);
    expect(missingProject.writes).toEqual([]);

    const collision = mockFirestore({ documents:[[sourcePath,{ owner:"someone-else" }]] });
    await expect(categoriseMoneyIn(options(collision))).rejects.toThrow(/already exists/i);
    expect(collision.writes).toEqual([]);

    const journalCollision = mockFirestore({ documents:[[journalPath,{ userId:"someone-else" }]] });
    await expect(categoriseMoneyIn(options(journalCollision))).rejects.toThrow(/already exists/i);
    expect(journalCollision.writes).toEqual([]);

    const matched = mockFirestore({ transaction:{ status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",matchedAmount:120 } });
    await expect(categoriseMoneyIn(options(matched))).rejects.toThrow(/already matched/i);
    expect(matched.writes).toEqual([]);
  });

  it("is idempotent for repeat clicks and serialised two-tab attempts",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture));
    await expect(categoriseMoneyIn(options(fixture))).resolves.toMatchObject({ status:"already-categorised" });
    expect(fixture.writes).toHaveLength(3);

    const twoTabs = mockFirestore();
    const results = await Promise.all([categoriseMoneyIn(options(twoTabs)),categoriseMoneyIn(options(twoTabs))]);
    expect(results.map(result => result.status).sort()).toEqual(["already-categorised","categorised"]);
    expect(twoTabs.writes).toHaveLength(3);
  });

  it("allows only one winner in a Categorise versus Confirm Match race",async () => {
    const fixture = mockFirestore({ documents:[
      ["users/user-1/invoices/invoice-1",{ invoiceNo:"INV-1",client:"Acme Ltd",date:"2026-08-13",total:120,status:"Unpaid" }],
      ["journals/invoice_user-1_invoice-1",{
        userId:"user-1",journalId:"invoice_user-1_invoice-1",date:"2026-08-13",sourceType:"salesInvoice",sourceId:"invoice-1",
        description:"Invoice",lines:[
          { accountCode:"1100",description:"Invoice",debit:120,credit:0 },
          { accountCode:"4000",description:"Invoice",debit:0,credit:120 }
        ]
      }]
    ] });
    const confirm = confirmBankMatch({
      db:{},userId:"user-1",transactionId:"bank-1",matchedRecordType:"invoice",matchedRecordId:"invoice-1",services:fixture.services
    });
    const categorise = categoriseMoneyIn(options(fixture));
    const results = await Promise.allSettled([confirm,categorise]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(fixture.documents.get(transactionPath).status).toBe("matched");
  });
});

describe("atomic Money In uncategorisation",() => {
  it("removes exactly the created source and journal while preserving imported fields",async () => {
    const fixture = mockFirestore();
    const original = structuredClone(fixture.documents.get(transactionPath));
    await categoriseMoneyIn(options(fixture));
    const categorisedReports = {
      trialBalance:buildTrialBalance(journals(fixture.documents)),
      profitLoss:buildProfitLossReport(journals(fixture.documents)),
      balanceSheet:buildBalanceSheetReport(journals(fixture.documents))
    };
    expect(categorisedReports).toMatchObject({
      trialBalance:{ balanced:true },profitLoss:{ totalIncome:100,netResult:100 }
    });
    fixture.writes.length = 0;
    await expect(uncategoriseMoneyIn({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).resolves.toMatchObject({ status:"uncategorised",incomeId:"bank-income_bank-1" });
    expect(fixture.writes).toEqual([
      { operation:"delete",path:journalPath },
      { operation:"delete",path:sourcePath },
      { operation:"update",path:transactionPath }
    ]);
    expect(fixture.documents.has(sourcePath)).toBe(false);
    expect(fixture.documents.has(journalPath)).toBe(false);
    expect(buildTrialBalance(journals(fixture.documents))).toEqual({ accounts:[],totalDebits:0,totalCredits:0,balanced:true });
    expect(buildProfitLossReport(journals(fixture.documents))).toMatchObject({ totalIncome:0,totalExpenses:0,netResult:0 });
    expect(buildBalanceSheetReport(journals(fixture.documents))).toMatchObject({ totalAssets:0,totalLiabilities:0,totalEquity:0 });
    const restored = fixture.documents.get(transactionPath);
    expect(restored.status).toBe("unmatched");
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(restored[field]).toEqual(original[field]);
    }
    for(const field of ["matchedRecordType","matchedRecordId","matchedAt","matchedAmount","categorisationJournalId","categorisationStateFingerprint","matchOrigin","categorisationVersion"]){
      expect(restored).not.toHaveProperty(field);
    }
  });

  it("cannot be routed through ordinary Unmatch",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture));
    fixture.writes.length = 0;
    await expect(unmatchBankTransaction({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).rejects.toThrow(/Use Uncategorise/i);
    expect(fixture.writes).toEqual([]);
  });

  it.each([
    ["source",fixture => { fixture.documents.get(sourcePath).payer = "Changed"; }],
    ["journal",fixture => { fixture.documents.get(journalPath).lines[0].debit = 119; }],
    ["matched amount",fixture => { fixture.documents.get(transactionPath).matchedAmount = 119; }],
    ["stored bank amount",fixture => { fixture.documents.get(transactionPath).moneyIn = 119; }],
    ["stored bank date",fixture => { fixture.documents.get(transactionPath).transactionDate = "12/08/2026"; }],
    ["stored bank direction",fixture => { fixture.documents.get(transactionPath).moneyOut = 1; }],
    ["owner",fixture => { fixture.documents.get(sourcePath).userId = "user-2"; }],
    ["bank account",fixture => { fixture.documents.get(transactionPath).bankAccountId = "account-2"; }],
    ["relationship",fixture => { fixture.documents.get(transactionPath).matchedRecordId = "bank-income_other"; }]
  ])("refuses to remove an altered %s",async (_label,mutate) => {
    const fixture = mockFirestore();
    await categoriseMoneyIn(options(fixture));
    mutate(fixture);
    fixture.writes.length = 0;
    await expect(uncategoriseMoneyIn({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
    expect(fixture.documents.has(sourcePath)).toBe(true);
    expect(fixture.documents.has(journalPath)).toBe(true);
  });
});
