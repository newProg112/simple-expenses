import { describe,expect,it } from "vitest";
import {
  BANK_VAT_TREATMENTS,
  bankCategorisedExpenseDocumentId,
  calculateMoneyOutCategorisationAmounts,
  categoriseMoneyOut,
  moneyOutCategorisationEligibility,
  uncategoriseMoneyOut
} from "../resources/js/bank-transaction-categorisation.js";
import { confirmBankMatch,unmatchBankTransaction } from "../resources/js/bank-match-confirmation.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const timestamp = Object.freeze({ serverTimestamp:true });
const now = "2026-08-13T09:30:00.000Z";
const transactionPath = "users/user-1/bankTransactions/bank-1";
const imported = Object.freeze({
  bankAccountId:"account-1",
  transactionDate:"13/08/2026",
  description:"SMITH & CO",
  moneyIn:null,
  moneyOut:450,
  balance:1550,
  status:"unmatched",
  source:"csv",
  importId:"import-1",
  createdAt:"2026-08-13T08:00:00.000Z",
  updatedAt:"2026-08-13T08:00:00.000Z"
});
const input = Object.freeze({
  merchant:"Smith & Co",
  category:"Professional fees",
  description:"Accountancy support",
  vatTreatment:BANK_VAT_TREATMENTS.INCLUDED_20,
  projectId:"project-1"
});

function mockFirestore(overrides = {}){
  const removed = Symbol("deleteField");
  const documents = new Map([
    [transactionPath,{ ...imported,...(overrides.transaction || {}) }],
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
      if(write.operation === "delete"){
        documents.delete(write.path);
      }else if(write.operation === "set"){
        documents.set(write.path,write.data);
      }else{
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
    doc,
    serverTimestamp:() => timestamp,
    deleteField:() => removed,
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

function journalSet(documents){
  return [...documents.entries()]
    .filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => journalFromFirestoreData(path.slice("journals/".length),data));
}

describe("Money Out categorisation eligibility and values",() => {
  it("allows only an unmatched, dated, non-zero Money Out transaction",() => {
    expect(moneyOutCategorisationEligibility(imported)).toMatchObject({ eligible:true,gross:450,date:"2026-08-13" });
    expect(moneyOutCategorisationEligibility({ ...imported,moneyIn:450,moneyOut:null }).eligible).toBe(false);
    expect(moneyOutCategorisationEligibility({ ...imported,moneyOut:0 }).eligible).toBe(false);
    expect(moneyOutCategorisationEligibility({ ...imported,moneyIn:1 }).reason).toMatch(/both Money In and Money Out/i);
    expect(moneyOutCategorisationEligibility({ ...imported,transactionDate:"invalid" }).reason).toMatch(/valid bank transaction date/i);
    expect(moneyOutCategorisationEligibility({ ...imported,status:"matched" }).eligible).toBe(false);
  });

  it.each([
    [BANK_VAT_TREATMENTS.NONE,null,{ net:450,vatRate:0,vat:0,gross:450 }],
    [BANK_VAT_TREATMENTS.INCLUDED_5,null,{ net:428.57,vatRate:0.05,vat:21.43,gross:450 }],
    [BANK_VAT_TREATMENTS.INCLUDED_20,null,{ net:375,vatRate:0.2,vat:75,gross:450 }],
    [BANK_VAT_TREATMENTS.EXACT,37.25,{ net:412.75,vatRate:0,vat:37.25,gross:450 }]
  ])("calculates %s VAT without changing gross",(treatment,exactVat,expected) => {
    expect(calculateMoneyOutCategorisationAmounts(450,treatment,exactVat)).toEqual(expected);
  });

  it("rejects invalid exact VAT and non-currency amounts",() => {
    expect(() => calculateMoneyOutCategorisationAmounts(450,BANK_VAT_TREATMENTS.EXACT,"")).toThrow(/exact VAT amount/i);
    expect(() => calculateMoneyOutCategorisationAmounts(450,BANK_VAT_TREATMENTS.EXACT,450)).toThrow(/less than/i);
    expect(() => calculateMoneyOutCategorisationAmounts(450.001,BANK_VAT_TREATMENTS.NONE)).toThrow(/two decimal/i);
  });

  it("uses one encoded deterministic Expense identity",() => {
    expect(bankCategorisedExpenseDocumentId("bank-1")).toBe("bank-expense_bank-1");
    expect(bankCategorisedExpenseDocumentId("bank/1")).toBe("bank-expense_bank%2F1");
  });
});

describe("atomic Money Out categorisation",() => {
  it("creates the normal Expense, accrual, settlement and match state together",async () => {
    const fixture = mockFirestore();
    const originalImported = structuredClone(fixture.documents.get(transactionPath));
    await expect(categoriseMoneyOut(options(fixture))).resolves.toMatchObject({
      status:"categorised",expenseId:"bank-expense_bank-1",
      accrualJournalId:"expense_user-1_bank-expense_bank-1",
      settlementJournalId:"bank-settlement_user-1_bank-1",gross:450
    });
    expect(fixture.writes).toEqual([
      { operation:"set",path:"users/user-1/expenses/bank-expense_bank-1" },
      { operation:"set",path:"journals/expense_user-1_bank-expense_bank-1" },
      { operation:"set",path:"journals/bank-settlement_user-1_bank-1" },
      { operation:"update",path:transactionPath }
    ]);
    const expense = fixture.documents.get("users/user-1/expenses/bank-expense_bank-1");
    expect(expense).toMatchObject({
      id:"bank-expense_bank-1",type:"expense",date:"2026-08-13",merchant:"Smith & Co",
      category:"Professional fees",description:"Accountancy support",net:375,vat:75,gross:450,
      status:"Paid",paidAt:"2026-08-13T00:00:00.000Z",
      projectId:"project-1",projectName:"Launch",projectReference:"PR-1",
      bankCategorisation:{ version:1,transactionId:"bank-1" },
      bankSettlement:{ version:1,transactionId:"bank-1",previousStatus:"Draft",amount:450 }
    });
    expect(expense.attachmentPath).toBe("");
    const accrual = fixture.documents.get("journals/expense_user-1_bank-expense_bank-1");
    expect(accrual.lines).toEqual([
      expect.objectContaining({ accountCode:"5400",debit:375,credit:0 }),
      expect.objectContaining({ accountCode:"1200",debit:75,credit:0 }),
      expect.objectContaining({ accountCode:"2200",debit:0,credit:450 })
    ]);
    const settlement = fixture.documents.get("journals/bank-settlement_user-1_bank-1");
    expect(settlement.lines).toEqual([
      expect.objectContaining({ accountCode:"2200",debit:450,credit:0 }),
      expect.objectContaining({ accountCode:"1000",debit:0,credit:450 })
    ]);
    const matched = fixture.documents.get(transactionPath);
    expect(matched).toMatchObject({
      status:"matched",matchedRecordType:"expense",matchedRecordId:"bank-expense_bank-1",
      matchedAmount:450,matchOrigin:"categorisation",categorisationVersion:1,
      settlementJournalId:"bank-settlement_user-1_bank-1",settlementVersion:1
    });
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(matched[field]).toEqual(originalImported[field]);
    }
  });

  it("maps every supported category through the existing Expense journal",async () => {
    const expected = { General:"5000",Travel:"5200",Meals:"5000",Office:"5000",Software:"5500",Utilities:"5300","Professional fees":"5400",Other:"5000" };
    for(const [category,accountCode] of Object.entries(expected)){
      const fixture = mockFirestore();
      await categoriseMoneyOut(options(fixture,{ input:{ category,vatTreatment:BANK_VAT_TREATMENTS.NONE,projectId:"" } }));
      expect(fixture.documents.get("journals/expense_user-1_bank-expense_bank-1").lines[0].accountCode).toBe(accountCode);
    }
  });

  it("keeps Trial Balance balanced and produces the correct P&L and Balance Sheet net effects",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyOut(options(fixture));
    const journals = journalSet(fixture.documents);
    const trialBalance = buildTrialBalance(journals);
    const profitLoss = buildProfitLossReport(journals);
    const balanceSheet = buildBalanceSheetReport(journals);
    expect(trialBalance.balanced).toBe(true);
    expect(profitLoss).toMatchObject({ totalIncome:0,totalExpenses:375,netResult:-375 });
    expect(balanceSheet.assetRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode:"1000",amount:-450 }),
      expect.objectContaining({ accountCode:"1200",amount:75 })
    ]));
    expect(balanceSheet.liabilityRows.some(row => row.accountCode === "2200")).toBe(false);
  });

  it("validates the optional project in the authenticated user path",async () => {
    const missing = mockFirestore();
    await expect(categoriseMoneyOut(options(missing,{ input:{ projectId:"missing" } }))).rejects.toThrow(/project no longer exists/i);
    expect(missing.writes).toEqual([]);
    const invalid = mockFirestore();
    await expect(categoriseMoneyOut(options(invalid,{ input:{ projectId:"users/user-2/projects/x" } }))).rejects.toThrow(/project ID is invalid/i);
    expect(invalid.writes).toEqual([]);
  });

  it("is idempotent for repeat clicks and serialised two-tab attempts",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyOut(options(fixture));
    await expect(categoriseMoneyOut(options(fixture))).resolves.toMatchObject({ status:"already-categorised" });
    expect(fixture.writes).toHaveLength(4);

    const twoTabs = mockFirestore();
    const results = await Promise.all([categoriseMoneyOut(options(twoTabs)),categoriseMoneyOut(options(twoTabs))]);
    expect(results.map(result => result.status).sort()).toEqual(["already-categorised","categorised"]);
    expect(twoTabs.writes).toHaveLength(4);
  });

  it("blocks deterministic collisions, already matched rows and altered categorised state",async () => {
    const collision = mockFirestore({ documents:[["journals/bank-settlement_user-1_bank-1",{ userId:"user-1" }]] });
    await expect(categoriseMoneyOut(options(collision))).rejects.toThrow(/already exists/i);
    expect(collision.writes).toEqual([]);

    const matched = mockFirestore({ transaction:{ status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1" } });
    await expect(categoriseMoneyOut(options(matched))).rejects.toThrow(/already matched/i);
    expect(matched.writes).toEqual([]);

    const altered = mockFirestore();
    await categoriseMoneyOut(options(altered));
    altered.documents.get(transactionPath).categorisationVersion = 2;
    const writeCount = altered.writes.length;
    await expect(categoriseMoneyOut(options(altered))).rejects.toThrow(/supported categorised/i);
    expect(altered.writes).toHaveLength(writeCount);
  });

  it("allows only one winner in a Categorise versus Confirm Match race",async () => {
    const fixture = mockFirestore({ documents:[
      ["users/user-1/bills/bill-1",{ billNumber:"BILL-1",supplier:"SMITH & CO",billDate:"2026-08-01",dueDate:"2026-08-13",total:450,status:"Unpaid" }],
      ["journals/bill_user-1_bill-1",{
        userId:"user-1",journalId:"bill_user-1_bill-1",date:"2026-08-01",sourceType:"supplierBill",sourceId:"bill-1",
        description:"Bill",lines:[
          { accountCode:"5000",description:"Bill",debit:450,credit:0 },
          { accountCode:"2000",description:"Bill",debit:0,credit:450 }
        ]
      }]
    ] });
    const confirm = confirmBankMatch({
      db:{},userId:"user-1",transactionId:"bank-1",matchedRecordType:"bill",matchedRecordId:"bill-1",services:fixture.services
    });
    const categorise = categoriseMoneyOut(options(fixture));
    const results = await Promise.allSettled([confirm,categorise]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(fixture.documents.get(transactionPath).status).toBe("matched");
  });
});

describe("atomic Money Out uncategorisation",() => {
  it("removes exactly the created Expense and two journals while preserving imported bank fields",async () => {
    const fixture = mockFirestore();
    const original = structuredClone(fixture.documents.get(transactionPath));
    await categoriseMoneyOut(options(fixture));
    fixture.writes.length = 0;
    await expect(uncategoriseMoneyOut({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).resolves.toMatchObject({ status:"uncategorised",expenseId:"bank-expense_bank-1" });
    expect(fixture.writes).toEqual([
      { operation:"delete",path:"journals/bank-settlement_user-1_bank-1" },
      { operation:"delete",path:"journals/expense_user-1_bank-expense_bank-1" },
      { operation:"delete",path:"users/user-1/expenses/bank-expense_bank-1" },
      { operation:"update",path:transactionPath }
    ]);
    expect([...fixture.documents.keys()].some(path => path.includes("bank-expense"))).toBe(false);
    const restored = fixture.documents.get(transactionPath);
    expect(restored.status).toBe("unmatched");
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(restored[field]).toEqual(original[field]);
    }
    for(const field of ["matchedRecordType","matchedRecordId","matchedAt","matchedAmount","settlementJournalId","settlementVersion","settlementStateFingerprint","matchOrigin","categorisationVersion"]){
      expect(restored).not.toHaveProperty(field);
    }
  });

  it("cannot be routed through ordinary Unmatch",async () => {
    const fixture = mockFirestore();
    await categoriseMoneyOut(options(fixture));
    fixture.writes.length = 0;
    await expect(unmatchBankTransaction({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).rejects.toThrow(/Use Uncategorise/i);
    expect(fixture.writes).toEqual([]);
    expect(fixture.documents.has("users/user-1/expenses/bank-expense_bank-1")).toBe(true);
  });

  it.each([
    ["source",fixture => { fixture.documents.get("users/user-1/expenses/bank-expense_bank-1").merchant = "Changed"; }],
    ["accrual journal",fixture => { fixture.documents.get("journals/expense_user-1_bank-expense_bank-1").lines[0].debit = 374; }],
    ["settlement journal",fixture => { fixture.documents.get("journals/bank-settlement_user-1_bank-1").lines[0].debit = 449; }],
    ["amount",fixture => { fixture.documents.get(transactionPath).matchedAmount = 449; }],
    ["ownership",fixture => { fixture.documents.get("journals/expense_user-1_bank-expense_bank-1").userId = "user-2"; }],
    ["relationship",fixture => { fixture.documents.get(transactionPath).matchedRecordId = "expense-other"; }]
  ])("refuses to remove an altered %s",async (_label,mutate) => {
    const fixture = mockFirestore();
    await categoriseMoneyOut(options(fixture));
    mutate(fixture);
    fixture.writes.length = 0;
    await expect(uncategoriseMoneyOut({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
    expect(fixture.documents.has("users/user-1/expenses/bank-expense_bank-1")).toBe(true);
    expect(fixture.documents.has("journals/expense_user-1_bank-expense_bank-1")).toBe(true);
    expect(fixture.documents.has("journals/bank-settlement_user-1_bank-1")).toBe(true);
  });
});
