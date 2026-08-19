import { describe,expect,it,vi } from "vitest";
import { discoverBankMatchCandidates } from "../resources/js/bank-auto-match-candidates.js";
import {
  automaticMatchProposals,
  createSingleFlightAutomaticMatches,
  executeAutomaticBankMatches,
  revalidateAutomaticBankMatch
} from "../resources/js/bank-auto-match-execution.js";
import { confirmBankMatch,unmatchBankTransaction } from "../resources/js/bank-match-confirmation.js";

const timestamp = "2026-08-19T12:00:00.000Z";

function fixture(type = "invoice"){
  const invoice = type === "invoice";
  const transactionId = invoice ? "bank-in" : "bank-out";
  const sourceId = invoice ? "invoice-1" : "bill-1";
  const collectionName = invoice ? "invoices" : "bills";
  const reference = invoice ? "INV-104" : "VODA-003";
  const transaction = invoice
    ? { bankAccountId:"account-1",status:"unmatched",transactionDate:"2026-08-07",description:"ACME INV-104",moneyIn:850,moneyOut:null }
    : { bankAccountId:"account-1",status:"unmatched",transactionDate:"2026-08-07",description:"VODAFONE VODA-003",moneyIn:null,moneyOut:120 };
  const source = invoice
    ? { invoiceNo:reference,client:"ACME",date:"2026-08-07",total:850,status:"Unpaid",notes:"Original" }
    : { billNumber:reference,supplier:"Vodafone",billDate:"2026-07-07",dueDate:"2026-08-01",total:120,status:"Unpaid",notes:"Original" };
  const amount = invoice ? 850 : 120;
  const sourceType = invoice ? "salesInvoice" : "supplierBill";
  const journalPrefix = invoice ? "invoice" : "bill";
  const accrualAccount = invoice ? "1100" : "2000";
  const documents = new Map([
    [`users/user-1/bankTransactions/${transactionId}`,transaction],
    ["users/user-1/bankAccounts/account-1",{ accountName:"Current",status:"Active" }],
    [`users/user-1/${collectionName}/${sourceId}`,source],
    [`journals/${journalPrefix}_user-1_${sourceId}`,{
      userId:"user-1",journalId:`${journalPrefix}_user-1_${sourceId}`,
      date:source.date || source.billDate,sourceType,sourceId,description:"Accrual",
      lines:invoice
        ? [{ accountCode:accrualAccount,debit:amount,credit:0 },{ accountCode:"4000",debit:0,credit:amount }]
        : [{ accountCode:"5000",debit:amount,credit:0 },{ accountCode:accrualAccount,debit:0,credit:amount }]
    }]
  ]);
  const writes = [];
  const removed = Symbol("delete-field");
  const referenceFor = path => ({ path });
  const snapshot = reference => ({
    exists:() => documents.has(reference.path),
    data:() => structuredClone(documents.get(reference.path))
  });
  const services = {
    collection:(_db,...parts) => referenceFor(parts.join("/")),
    doc:(_db,...parts) => referenceFor(parts.join("/")),
    getDoc:async reference => snapshot(reference),
    getDocs:async reference => {
      const prefix = `${reference.path}/`;
      const docs = [...documents.entries()].filter(([path]) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/")
      ).map(([path]) => ({ id:path.slice(prefix.length),data:() => structuredClone(documents.get(path)) }));
      return { docs };
    },
    serverTimestamp:() => timestamp,
    deleteField:() => removed,
    runTransaction:async (_db,execute) => execute({
      get:async reference => snapshot(reference),
      set:(reference,data) => {
        writes.push({ operation:"set",path:reference.path });
        documents.set(reference.path,structuredClone(data));
      },
      update:(reference,update) => {
        writes.push({ operation:"update",path:reference.path });
        const next = { ...documents.get(reference.path) };
        Object.entries(update).forEach(([key,value]) => {
          if(value === removed) delete next[key];
          else next[key] = structuredClone(value);
        });
        documents.set(reference.path,next);
      },
      delete:reference => {
        writes.push({ operation:"delete",path:reference.path });
        documents.delete(reference.path);
      }
    })
  };
  const transactionPath = `users/user-1/bankTransactions/${transactionId}`;
  const sourcePath = `users/user-1/${collectionName}/${sourceId}`;
  const settlementPath = `journals/bank-settlement_user-1_${transactionId}`;
  const transactions = () => [{ ...documents.get(transactionPath),id:transactionId }];
  const sources = () => invoice
    ? { invoices:[{ ...documents.get(sourcePath),id:sourceId }] }
    : { bills:[{ ...documents.get(sourcePath),id:sourceId }] };
  const proposals = () => automaticMatchProposals(
    discoverBankMatchCandidates(transactions(),sources()),transactions()
  );
  const revalidate = proposal => revalidateAutomaticBankMatch({
    db:{},userId:"user-1",proposal,services
  });
  const confirm = current => confirmBankMatch({
    db:{},userId:"user-1",transactionId:current.proposal.transactionId,
    matchedRecordType:current.proposal.candidateType,matchedRecordId:current.proposal.candidateId,
    automaticExpectedState:{ bankTransaction:current.transaction,source:current.source },
    services
  });
  return {
    type,transactionId,sourceId,collectionName,reference,documents,writes,services,
    transactionPath,sourcePath,settlementPath,transactions,sources,proposals,revalidate,confirm
  };
}

async function executeFixture(testFixture){
  return executeAutomaticBankMatches({
    proposals:testFixture.proposals(),revalidate:testFixture.revalidate,confirm:testFixture.confirm
  });
}

describe("controlled automatic bank-match execution",() => {
  it.each(["invoice","bill"])("executes one valid auto-match eligible %s through trusted settlement",async type => {
    const testFixture = fixture(type);
    const result = await executeFixture(testFixture);

    expect(result).toMatchObject({ processedCount:1,completedCount:1,skippedCount:0 });
    expect(testFixture.documents.get(testFixture.transactionPath)).toMatchObject({
      status:"matched",matchedRecordType:type,matchedRecordId:testFixture.sourceId,
      settlementJournalId:`bank-settlement_user-1_${testFixture.transactionId}`
    });
    expect(testFixture.documents.get(testFixture.sourcePath)).toMatchObject({ status:"Paid" });
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(true);
    expect(testFixture.documents.get(testFixture.transactionPath)).not.toHaveProperty("candidateClassification");
    expect(testFixture.documents.get(testFixture.transactionPath)).not.toHaveProperty("candidateResults");
    expect(testFixture.documents.get(testFixture.transactionPath)).not.toHaveProperty("matchMethod");
  });

  it("produces the same persisted settlement as manual confirmation",async () => {
    const automatic = fixture("invoice");
    const manual = fixture("invoice");
    await executeFixture(automatic);
    await confirmBankMatch({
      db:{},userId:"user-1",transactionId:manual.transactionId,
      matchedRecordType:"invoice",matchedRecordId:manual.sourceId,services:manual.services
    });
    expect(automatic.documents.get(automatic.transactionPath)).toEqual(manual.documents.get(manual.transactionPath));
    expect(automatic.documents.get(automatic.sourcePath)).toEqual(manual.documents.get(manual.sourcePath));
    expect(automatic.documents.get(automatic.settlementPath)).toEqual(manual.documents.get(manual.settlementPath));
  });

  it("supports normal Unmatch after an automatic settlement",async () => {
    const testFixture = fixture("bill");
    await executeFixture(testFixture);
    await unmatchBankTransaction({
      db:{},userId:"user-1",transactionId:testFixture.transactionId,services:testFixture.services
    });
    expect(testFixture.documents.get(testFixture.transactionPath).status).toBe("unmatched");
    expect(testFixture.documents.get(testFixture.sourcePath)).toMatchObject({ status:"Unpaid" });
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(false);
  });

  it("derives proposals only from Invoice/Bill auto-match eligible results without writes",() => {
    const testFixture = fixture("invoice");
    const results = [
      ...discoverBankMatchCandidates(testFixture.transactions(),testFixture.sources()),
      { transactionId:"strong",classification:"suggested",candidateType:"invoice",candidateId:"invoice-2" },
      { transactionId:"multiple",classification:"suggested",candidateType:"bill",candidateId:null },
      { transactionId:"none",classification:"none",candidateType:null,candidateId:null },
      { transactionId:"expense",classification:"autoMatchEligible",candidateType:"expense",candidateId:"expense-1" }
    ];
    expect(automaticMatchProposals(results,testFixture.transactions())).toHaveLength(1);
    expect(testFixture.writes).toEqual([]);
  });

  it.each([
    ["source becomes Paid",testFixture => { testFixture.documents.get(testFixture.sourcePath).status = "Paid"; }],
    ["source amount changes",testFixture => { testFixture.documents.get(testFixture.sourcePath).total += 1; }],
    ["source date changes",testFixture => { testFixture.documents.get(testFixture.sourcePath).date = "2026-09-01"; }],
    ["source reference changes",testFixture => { testFixture.documents.get(testFixture.sourcePath).invoiceNo = "INV-999"; }],
    ["bank description changes",testFixture => { testFixture.documents.get(testFixture.transactionPath).description = "UNRELATED"; }],
    ["duplicate reference appears",testFixture => {
      testFixture.documents.set("users/user-1/invoices/invoice-2",{
        invoiceNo:"inv / 104",client:"Other",date:"2025-01-01",total:1,status:"Paid"
      });
    }],
    ["bank transaction becomes matched",testFixture => {
      Object.assign(testFixture.documents.get(testFixture.transactionPath),{
        status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"income-1",matchedAmount:850
      });
    }]
  ])("skips safely when %s before execution",async (_label,change) => {
    const testFixture = fixture("invoice");
    const proposals = testFixture.proposals();
    change(testFixture);
    const result = await executeAutomaticBankMatches({
      proposals,revalidate:testFixture.revalidate,confirm:testFixture.confirm
    });
    expect(result).toMatchObject({ completedCount:0,skippedCount:1 });
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(false);
  });

  it("keeps invalid bank-account state protected by trusted confirmation",async () => {
    const testFixture = fixture("invoice");
    testFixture.documents.get("users/user-1/bankAccounts/account-1").status = "Suspended";
    const result = await executeFixture(testFixture);
    expect(result).toMatchObject({ completedCount:0,skippedCount:1 });
    expect(testFixture.writes).toEqual([]);
  });

  it("rejects a source change between persisted revalidation and the settlement transaction",async () => {
    const testFixture = fixture("invoice");
    const result = await executeAutomaticBankMatches({
      proposals:testFixture.proposals(),
      revalidate:testFixture.revalidate,
      confirm:current => {
        testFixture.documents.get(testFixture.sourcePath).invoiceNo = "INV-CHANGED";
        return testFixture.confirm(current);
      }
    });
    expect(result).toMatchObject({ completedCount:0,skippedCount:1 });
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.documents.has(testFixture.settlementPath)).toBe(false);
  });

  it("processes candidates independently so one stale item does not block another",async () => {
    const proposals = [{ transactionId:"stale" },{ transactionId:"valid" }];
    const confirm = vi.fn(async current => ({ status:"confirmed",transactionId:current.proposal.transactionId }));
    const result = await executeAutomaticBankMatches({
      proposals,
      revalidate:vi.fn(async proposal => proposal.transactionId === "stale"
        ? { eligible:false,reason:"details-changed-review-required" }
        : { eligible:true,proposal }),
      confirm
    });
    expect(result).toMatchObject({ processedCount:2,completedCount:1,skippedCount:1 });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0].proposal.transactionId).toBe("valid");
  });

  it("uses single-flight execution to prevent double-click duplicate settlement",async () => {
    let release;
    const execute = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const singleFlight = createSingleFlightAutomaticMatches(execute);
    const first = singleFlight();
    const second = singleFlight();
    await Promise.resolve();
    expect(first).toBe(second);
    expect(execute).toHaveBeenCalledOnce();
    release({ completedCount:1 });
    await first;
  });
});
