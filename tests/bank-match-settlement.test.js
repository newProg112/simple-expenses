import { describe, expect, it } from "vitest";
import { confirmBankMatch, unmatchBankTransaction } from "../resources/js/bank-match-confirmation.js";
import { normaliseBankTransaction } from "../resources/js/bank-transaction-import.js";
import {
  buildTrialBalance,
  createBankSettlementJournal,
  normaliseBankTransactionDate
} from "../resources/js/ledger-engine.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const timestamp = "2026-08-12T12:00:00.000Z";

const CASES = Object.freeze({
  invoice:Object.freeze({
    recordType:"invoice",collection:"invoices",recordId:"invoice-1",sourceType:"salesInvoice",
    source:{ invoiceNo:"INV-1",client:"Customer",date:"2026-08-07",total:120,status:"Unpaid",notes:"Original" },
    transaction:{ transactionDate:"2026-08-07",description:"Customer",moneyIn:120,moneyOut:null },
    accrualLines:[
      { accountCode:"1100",description:"Invoice",debit:120,credit:0 },
      { accountCode:"4000",description:"Invoice",debit:0,credit:120 }
    ],
    settlementLines:[
      { accountCode:"1000",description:"Invoice receipt invoice-1",debit:120,credit:0 },
      { accountCode:"1100",description:"Invoice receipt invoice-1",debit:0,credit:120 }
    ]
  }),
  bill:Object.freeze({
    recordType:"bill",collection:"bills",recordId:"bill-1",sourceType:"supplierBill",
    source:{ billNumber:"BILL-1",supplier:"Supplier",billDate:"2026-07-17",dueDate:"2026-07-31",total:120,status:"Unpaid",notes:"Original" },
    transaction:{ transactionDate:"2026-08-07",description:"Supplier",moneyIn:null,moneyOut:120 },
    accrualLines:[
      { accountCode:"5000",description:"Bill",debit:120,credit:0 },
      { accountCode:"2000",description:"Bill",debit:0,credit:120 }
    ],
    settlementLines:[
      { accountCode:"2000",description:"Supplier bill payment bill-1",debit:120,credit:0 },
      { accountCode:"1000",description:"Supplier bill payment bill-1",debit:0,credit:120 }
    ]
  }),
  expense:Object.freeze({
    recordType:"expense",collection:"expenses",recordId:"expense-1",sourceType:"expenseClaim",
    source:{ type:"expense",merchant:"Merchant",date:"2026-08-07",gross:120,status:"Approved",notes:"Original" },
    transaction:{ transactionDate:"2026-08-07",description:"Merchant",moneyIn:null,moneyOut:120 },
    accrualLines:[
      { accountCode:"5000",description:"Expense",debit:120,credit:0 },
      { accountCode:"2200",description:"Expense",debit:0,credit:120 }
    ],
    settlementLines:[
      { accountCode:"2200",description:"Expense reimbursement expense-1",debit:120,credit:0 },
      { accountCode:"1000",description:"Expense reimbursement expense-1",debit:0,credit:120 }
    ]
  }),
  mileage:Object.freeze({
    recordType:"expense",collection:"expenses",recordId:"mileage-1",sourceType:"mileageClaim",
    source:{ type:"mileage",businessPurpose:"Client visit",date:"2026-08-07",amount:45,gross:45,status:"Approved",notes:"Original" },
    transaction:{ transactionDate:"2026-08-07",description:"Mileage",moneyIn:null,moneyOut:45 },
    accrualLines:[
      { accountCode:"5200",description:"Mileage",debit:45,credit:0 },
      { accountCode:"2200",description:"Mileage",debit:0,credit:45 }
    ],
    settlementLines:[
      { accountCode:"2200",description:"Mileage reimbursement mileage-1",debit:45,credit:0 },
      { accountCode:"1000",description:"Mileage reimbursement mileage-1",debit:0,credit:45 }
    ]
  })
});

function fixture(caseName,overrides = {}){
  const definition = CASES[caseName];
  const transactionId = overrides.transactionId || "bank-1";
  const transactionPath = `users/user-1/bankTransactions/${transactionId}`;
  const sourcePath = `users/user-1/${definition.collection}/${definition.recordId}`;
  const sourcePrefix = definition.sourceType === "salesInvoice" ? "invoice"
    : definition.sourceType === "supplierBill" ? "bill"
      : definition.sourceType === "mileageClaim" ? "mileage" : "expense";
  const accrualPath = `journals/${sourcePrefix}_user-1_${definition.recordId}`;
  const settlementPath = `journals/bank-settlement_user-1_${transactionId}`;
  const documents = new Map([
    [transactionPath,{ bankAccountId:"account-1",status:"unmatched",...definition.transaction,...(overrides.transaction || {}) }],
    [sourcePath,{ ...definition.source,...(overrides.source || {}) }],
    [accrualPath,{
      userId:"user-1",journalId:accrualPath.slice("journals/".length),date:definition.source.date || definition.source.billDate,
      sourceType:definition.sourceType,sourceId:definition.recordId,description:"Accrual",lines:definition.accrualLines
    }]
  ]);
  if(overrides.missingAccrual) documents.delete(accrualPath);
  if(overrides.existingSettlement){
    documents.set(settlementPath,{ userId:"user-1",sourceType:"manual",sourceId:"other" });
  }
  const removed = Symbol("deleteField");
  const writes = [];
  const services = {
    doc:(_db,...parts) => ({ path:parts.join("/") }),
    serverTimestamp:() => timestamp,
    deleteField:() => removed,
    runTransaction:async (_db,execute) => execute({
      get:async reference => ({
        exists:() => documents.has(reference.path),
        data:() => documents.get(reference.path)
      }),
      set:(reference,data) => {
        writes.push({ operation:"set",path:reference.path });
        documents.set(reference.path,{ ...data });
      },
      update:(reference,update) => {
        writes.push({ operation:"update",path:reference.path });
        const next = { ...(documents.get(reference.path) || {}) };
        Object.entries(update).forEach(([key,value]) => value === removed ? delete next[key] : next[key] = value);
        documents.set(reference.path,next);
      },
      delete:reference => {
        writes.push({ operation:"delete",path:reference.path });
        documents.delete(reference.path);
      }
    })
  };
  return {
    definition,documents,writes,services,transactionId,transactionPath,sourcePath,accrualPath,settlementPath,
    confirmOptions:{
      db:{},userId:"user-1",transactionId,
      matchedRecordType:definition.recordType,matchedRecordId:definition.recordId,services
    },
    unmatchOptions:{ db:{},userId:"user-1",transactionId,services }
  };
}

function journalsFromFixture(testFixture){
  return [testFixture.accrualPath,testFixture.settlementPath]
    .filter(path => testFixture.documents.has(path))
    .map(path => journalFromFirestoreData(path.slice("journals/".length),testFixture.documents.get(path)));
}

function stableValue(value){
  if(value === null || value === undefined || typeof value !== "object") return value;
  if(Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key,stableValue(value[key])]));
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

async function createLegacyMisparsedSettlement(testFixture){
  await confirmBankMatch(testFixture.confirmOptions);
  const source = testFixture.documents.get(testFixture.sourcePath);
  const transaction = testFixture.documents.get(testFixture.transactionPath);
  const journal = testFixture.documents.get(testFixture.settlementPath);
  journal.date = "2026-04-08";
  source.paidAt = "2026-04-08T00:00:00.000Z";
  source.bankSettlement.paymentDate = "2026-04-08T00:00:00.000Z";
  transaction.settlementStateFingerprint = valueFingerprint(source.bankSettlement);
  testFixture.writes.length = 0;
}

describe("Banking exact-payment settlement", () => {
  it.each([
    ["04/08/26","2026-08-04"],
    ["07/08/26","2026-08-07"],
    ["17/07/26","2026-07-17"],
    ["2026-08-04","2026-08-04"]
  ])("normalises bank transaction date %s as %s",(input,expected) => {
    expect(normaliseBankTransactionDate(input)).toBe(expected);
  });

  it("uses the UK-normalised bank transaction date on the settlement journal", () => {
    expect(createBankSettlementJournal({
      transactionId:"bank-uk-date",
      transactionDate:"04/08/26",
      recordType:"bill",
      recordId:"bill-1",
      amount:8.08
    }).date).toBe("2026-08-04");
  });

  it("persists the corrected UK date through Confirm Match settlement",async () => {
    const testFixture = fixture("bill",{
      transaction:{ transactionDate:"04/08/26",moneyOut:120 }
    });
    await confirmBankMatch(testFixture.confirmOptions);
    expect(testFixture.documents.get(testFixture.settlementPath).date).toBe("2026-08-04");
    expect(testFixture.documents.get(testFixture.sourcePath).paidAt).toBe("2026-08-04T00:00:00.000Z");
  });

  it.each(Object.keys(CASES))("posts the correct %s settlement and marks the source Paid",async caseName => {
    const testFixture = fixture(caseName);
    const result = await confirmBankMatch(testFixture.confirmOptions);
    const source = testFixture.documents.get(testFixture.sourcePath);
    const journal = testFixture.documents.get(testFixture.settlementPath);

    expect(result).toMatchObject({ status:"confirmed",settled:true,settlementJournalId:testFixture.settlementPath.slice(9) });
    expect(source).toMatchObject({ status:"Paid",bankSettlement:{ transactionId:"bank-1",previousStatus:CASES[caseName].source.status } });
    expect(journal.lines).toEqual(CASES[caseName].settlementLines);
    expect(journal).toMatchObject({
      userId:"user-1",sourceType:"bankSettlement",sourceId:"bank-1",
      matchedRecordType:CASES[caseName].recordType,matchedRecordId:CASES[caseName].recordId
    });
    if(caseName === "invoice") expect(source).not.toHaveProperty("paidAt");
    else expect(source.paidAt).toBe(`${CASES[caseName].transaction.transactionDate}T00:00:00.000Z`);
  });

  it("requires an exact full amount, correct direction, eligible source, and matching accrual",async () => {
    for(const testFixture of [
      fixture("invoice",{ transaction:{ moneyIn:119 } }),
      fixture("invoice",{ transaction:{ moneyIn:null,moneyOut:120 } }),
      fixture("invoice",{ source:{ total:121 } }),
      fixture("invoice",{ source:{ status:"Paid" } }),
      fixture("invoice",{ missingAccrual:true })
    ]){
      await expect(confirmBankMatch(testFixture.confirmOptions)).rejects.toThrow();
      expect(testFixture.writes).toEqual([]);
    }
  });

  it("makes duplicate confirmation idempotent and cannot duplicate the deterministic journal",async () => {
    const testFixture = fixture("invoice");
    await confirmBankMatch(testFixture.confirmOptions);
    const writesAfterFirstConfirmation = testFixture.writes.length;
    await expect(confirmBankMatch(testFixture.confirmOptions)).resolves.toMatchObject({
      status:"already-confirmed",settled:true
    });
    expect(testFixture.writes).toHaveLength(writesAfterFirstConfirmation);
    expect([...testFixture.documents.keys()].filter(path => path.includes("bank-settlement"))).toEqual([
      testFixture.settlementPath
    ]);

    const collision = fixture("invoice",{ existingSettlement:true });
    await expect(confirmBankMatch(collision.confirmOptions)).rejects.toThrow(/already exists/i);
    expect(collision.writes).toEqual([]);
  });

  it("prevents another bank transaction from settling the same source",async () => {
    const first = fixture("invoice");
    await confirmBankMatch(first.confirmOptions);
    const secondPath = "users/user-1/bankTransactions/bank-2";
    first.documents.set(secondPath,{
      bankAccountId:"account-1",status:"unmatched",...CASES.invoice.transaction
    });
    await expect(confirmBankMatch({
      ...first.confirmOptions,transactionId:"bank-2"
    })).rejects.toThrow(/already settled|no longer eligible/i);
    expect(first.documents.has("journals/bank-settlement_user-1_bank-2")).toBe(false);
  });

  it("reload preserves the matched and settled relationship",async () => {
    const testFixture = fixture("bill");
    await confirmBankMatch(testFixture.confirmOptions);
    const reloaded = normaliseBankTransaction("bank-1",testFixture.documents.get(testFixture.transactionPath));
    expect(reloaded).toMatchObject({
      status:"matched",matchedRecordType:"bill",matchedRecordId:"bill-1",
      settlementJournalId:"bank-settlement_user-1_bank-1",settlementVersion:1
    });
    expect(testFixture.documents.get(testFixture.sourcePath).status).toBe("Paid");
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(true);
  });
});

describe("Banking settlement Unmatch safety", () => {
  it("safely Unmatches the proven legacy 04/08/26-as-2026-04-08 settlement",async () => {
    const testFixture = fixture("bill",{
      transaction:{ transactionDate:"04/08/26",moneyOut:120 }
    });
    testFixture.documents.set("journals/manual_user-1_keep",{
      userId:"user-1",journalId:"manual_user-1_keep",date:"2026-08-01",sourceType:"manual",sourceId:"keep",
      lines:[
        { accountCode:"1000",description:"Keep",debit:1,credit:0 },
        { accountCode:"3000",description:"Keep",debit:0,credit:1 }
      ]
    });
    await createLegacyMisparsedSettlement(testFixture);

    await expect(unmatchBankTransaction(testFixture.unmatchOptions)).resolves.toMatchObject({
      status:"unmatched",settlementReversed:true,restoredStatus:"Unpaid"
    });
    expect(testFixture.documents.get(testFixture.sourcePath)).toMatchObject({ status:"Unpaid",notes:"Original" });
    expect(testFixture.documents.get(testFixture.sourcePath)).not.toHaveProperty("paidAt");
    expect(testFixture.documents.get(testFixture.sourcePath)).not.toHaveProperty("bankSettlement");
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(false);
    expect(testFixture.documents.has(testFixture.accrualPath)).toBe(true);
    expect(testFixture.documents.has("journals/manual_user-1_keep")).toBe(true);
  });

  it("still rejects a tampered journal even when it uses the known legacy date",async () => {
    const testFixture = fixture("bill",{
      transaction:{ transactionDate:"04/08/26",moneyOut:120 }
    });
    await createLegacyMisparsedSettlement(testFixture);
    const journal = testFixture.documents.get(testFixture.settlementPath);
    journal.lines = journal.lines.map(line => ({ ...line }));
    journal.lines[0].debit = 119;
    journal.lines[1].credit = 119;

    await expect(unmatchBankTransaction(testFixture.unmatchOptions))
      .rejects.toThrow(/settlement journal changed or is invalid/i);
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(true);
    expect(testFixture.documents.get(testFixture.transactionPath).status).toBe("matched");
    expect(testFixture.documents.get(testFixture.sourcePath).status).toBe("Paid");
  });

  it("rejects an arbitrary wrong settlement date outside the known legacy parse",async () => {
    const testFixture = fixture("bill",{
      transaction:{ transactionDate:"04/08/26",moneyOut:120 }
    });
    await createLegacyMisparsedSettlement(testFixture);
    testFixture.documents.get(testFixture.settlementPath).date = "2026-03-08";

    await expect(unmatchBankTransaction(testFixture.unmatchOptions))
      .rejects.toThrow(/settlement journal changed or is invalid/i);
    expect(testFixture.writes).toEqual([]);
  });

  it.each(Object.keys(CASES))("restores only Banking-created %s state and removes only its settlement journal",async caseName => {
    const previousPaidAt = caseName === "invoice" ? undefined : "2026-01-01T00:00:00.000Z";
    const source = previousPaidAt ? { paidAt:previousPaidAt } : {};
    const testFixture = fixture(caseName,{ source });
    testFixture.documents.set("journals/manual_user-1_keep",{
      userId:"user-1",journalId:"manual_user-1_keep",date:"2026-08-01",sourceType:"manual",sourceId:"keep",
      lines:[
        { accountCode:"1000",description:"Keep",debit:1,credit:0 },
        { accountCode:"3000",description:"Keep",debit:0,credit:1 }
      ]
    });
    await confirmBankMatch(testFixture.confirmOptions);
    await expect(unmatchBankTransaction(testFixture.unmatchOptions)).resolves.toMatchObject({
      status:"unmatched",settlementReversed:true,restoredStatus:CASES[caseName].source.status
    });
    const restored = testFixture.documents.get(testFixture.sourcePath);
    expect(restored.status).toBe(CASES[caseName].source.status);
    expect(restored).not.toHaveProperty("bankSettlement");
    if(previousPaidAt) expect(restored.paidAt).toBe(previousPaidAt);
    else expect(restored).not.toHaveProperty("paidAt");
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(false);
    expect(testFixture.documents.has(testFixture.accrualPath)).toBe(true);
    expect(testFixture.documents.has("journals/manual_user-1_keep")).toBe(true);
  });

  it("fails safely instead of overwriting a later source edit or payment change",async () => {
    for(const mutation of [
      source => { source.notes = "Changed elsewhere"; },
      source => { source.status = "Unpaid"; },
      source => { source.paidAt = "2026-08-08T00:00:00.000Z"; },
      source => { source.bankSettlement.previousStatus = "Draft"; }
    ]){
      const testFixture = fixture("bill");
      await confirmBankMatch(testFixture.confirmOptions);
      mutation(testFixture.documents.get(testFixture.sourcePath));
      const writesBeforeUnmatch = testFixture.writes.length;
      await expect(unmatchBankTransaction(testFixture.unmatchOptions)).rejects.toThrow(/changed|payment/i);
      expect(testFixture.writes).toHaveLength(writesBeforeUnmatch);
      expect(testFixture.documents.has(testFixture.settlementPath)).toBe(true);
      expect(testFixture.documents.get(testFixture.transactionPath).status).toBe("matched");
    }
  });
});

describe("Banking settlement financial reports", () => {
  it.each(Object.keys(CASES))("keeps the trial balance balanced and P&L unchanged for %s",async caseName => {
    const testFixture = fixture(caseName);
    const before = journalsFromFixture(testFixture);
    const profitLossBefore = buildProfitLossReport(before);
    await confirmBankMatch(testFixture.confirmOptions);
    const after = journalsFromFixture(testFixture);
    const trialBalance = buildTrialBalance(after);
    const profitLossAfter = buildProfitLossReport(after);

    expect(trialBalance.balanced).toBe(true);
    expect(profitLossAfter).toMatchObject({
      totalIncome:profitLossBefore.totalIncome,
      totalExpenses:profitLossBefore.totalExpenses,
      netResult:profitLossBefore.netResult
    });
  });

  it("moves an invoice receivable into Bank on the Balance Sheet",async () => {
    const testFixture = fixture("invoice");
    await confirmBankMatch(testFixture.confirmOptions);
    const report = buildBalanceSheetReport(journalsFromFixture(testFixture));
    expect(report.assetRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode:"1000",amount:120 })
    ]));
    expect(report.assetRows.some(row => row.accountCode === "1100")).toBe(false);
  });

  it.each(["bill","expense","mileage"])("clears the %s payable and credits Bank on the Balance Sheet",async caseName => {
    const testFixture = fixture(caseName);
    await confirmBankMatch(testFixture.confirmOptions);
    const report = buildBalanceSheetReport(journalsFromFixture(testFixture));
    const payableCode = caseName === "bill" ? "2000" : "2200";
    expect(report.liabilityRows.some(row => row.accountCode === payableCode)).toBe(false);
    expect(report.assetRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode:"1000",amount:-CASES[caseName].transaction.moneyOut })
    ]));
  });
});
