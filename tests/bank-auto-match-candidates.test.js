import { describe,expect,it,vi } from "vitest";
import { classifyBankMatchCandidates,discoverBankMatchCandidates } from "../resources/js/bank-auto-match-candidates.js";

const incoming = Object.freeze({
  id:"bank-in",transactionDate:"2026-08-04",description:"BANK PAYMENT",moneyIn:1200,moneyOut:null,status:"unmatched"
});
const outgoing = Object.freeze({
  id:"bank-out",transactionDate:"2026-08-04",description:"BANK PAYMENT",moneyIn:null,moneyOut:1200,status:"unmatched"
});
const invoice = Object.freeze({
  id:"invoice-1",invoiceNo:"INV-001",client:"Acme Trading Limited",date:"2026-08-01",total:1200,status:"Unpaid"
});
const bill = Object.freeze({
  id:"bill-1",billNumber:"BILL-001",supplier:"Supplier Services Ltd",billDate:"2026-07-01",dueDate:"2026-07-31",total:1200,status:"Unpaid"
});

describe("automatic bank-match candidate classification",() => {
  it("classifies one eligible Invoice with a safe unique reference as auto-match eligible",() => {
    expect(classifyBankMatchCandidates(
      { ...incoming,description:"ACME PAYMENT inv/002" },{ invoices:[{ ...invoice,invoiceNo:"INV-002" }] }
    )).toMatchObject({
      classification:"autoMatchEligible",candidateType:"invoice",candidateId:"invoice-1",
      candidates:[{ label:"INV-002",documentReference:"INV-002",amountCents:120000 }],
      evidence:{ amountExact:true,dateCompatible:true,singleEligibleCandidate:true,
        referenceMatch:true,referenceSafe:true,referenceUnique:true }
    });
  });

  it("classifies one eligible Bill with a safe unique reference as auto-match eligible",() => {
    expect(classifyBankMatchCandidates(
      { ...outgoing,description:"PAYMENT bill 001" },{ bills:[bill] }
    )).toMatchObject({
      classification:"autoMatchEligible",candidateType:"bill",candidateId:"bill-1",
      candidates:[{ label:"BILL-001",documentReference:"BILL-001" }]
    });
  });

  it.each([
    ["customer","Acme Trading Limited",incoming,{ invoices:[invoice] }],
    ["supplier","Supplier Services Limited",outgoing,{ bills:[bill] }]
  ])("keeps an exact %s name as a strong suggestion rather than automatic",(_label,description,transaction,sources) => {
    expect(classifyBankMatchCandidates({ ...transaction,description },sources)).toMatchObject({
      classification:"suggested",
      evidence:{ partyNameMatch:true,partyNameStrong:true,referenceMatch:false,singleEligibleCandidate:true }
    });
  });

  it.each(["UNRELATED RECEIPT","JOHN SMITH","STRIPE PAYMENTS","PAYPAL SETTLEMENT"])(
    "keeps a unique amount/date candidate suggested for descriptor %s",
    description => expect(classifyBankMatchCandidates(
      { ...incoming,description },{ invoices:[invoice] }
    ).classification).toBe("suggested")
  );

  it("keeps a Direct Debit descriptor differing from the supplier suggested",() => {
    expect(classifyBankMatchCandidates(
      { ...outgoing,description:"DD COLLECTION GROUP PLC" },{ bills:[bill] }
    ).classification).toBe("suggested");
  });

  it("does not treat a short party-name correspondence as strong identity",() => {
    expect(classifyBankMatchCandidates(
      { ...incoming,description:"ABC LIMITED" },{ invoices:[{ ...invoice,client:"ABC Ltd" }] }
    )).toMatchObject({ classification:"suggested",evidence:{ partyNameMatch:true,partyNameStrong:false } });
  });

  it("never disambiguates multiple base candidates automatically",() => {
    const result = classifyBankMatchCandidates(
      { ...incoming,description:"PAYMENT INV-002" },
      { invoices:[invoice,{ ...invoice,id:"invoice-2",invoiceNo:"INV-002" }] }
    );
    expect(result).toMatchObject({
      classification:"suggested",candidateType:"invoice",candidateId:null,
      evidence:{ singleEligibleCandidate:false,referenceMatch:false }
    });
    expect(result.candidates.map(candidate => candidate.candidateId)).toEqual(["invoice-1","invoice-2"]);
  });

  it("does not promote a duplicate normalized reference",() => {
    const duplicate = { ...invoice,id:"old-invoice",invoiceNo:"inv / 001",date:"2025-01-01",total:99 };
    expect(classifyBankMatchCandidates(
      { ...incoming,description:"PAYMENT INV-001" },{ invoices:[invoice,duplicate] }
    )).toMatchObject({
      classification:"suggested",evidence:{ referenceSafe:true,referenceUnique:false,referenceMatch:true }
    });
  });

  it.each(["002","123456"])("does not promote numeric-only reference %s",invoiceNo => {
    expect(classifyBankMatchCandidates(
      { ...incoming,description:`PAYMENT ${invoiceNo}` },{ invoices:[{ ...invoice,invoiceNo }] }
    )).toMatchObject({ classification:"suggested",evidence:{ referenceSafe:false,referenceMatch:false } });
  });

  it("classifies incompatible dates as none",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,date:"2026-08-12" }] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(outgoing,{ bills:[{ ...bill,dueDate:"2026-09-01" }] }).classification).toBe("none");
  });

  it("excludes source types from the wrong transaction direction",() => {
    expect(classifyBankMatchCandidates(incoming,{ bills:[bill] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(outgoing,{ invoices:[invoice] }).classification).toBe("none");
  });

  it("requires exact equality after conversion to integer cents",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,total:1199.99 }] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(
      { ...incoming,moneyIn:0.1 + 0.2 },{ invoices:[{ ...invoice,total:0.3 }] }
    ).classification).toBe("suggested");
  });

  it.each([
    ["both directions",{ moneyIn:1200,moneyOut:1200 }],
    ["zero",{ moneyIn:0,moneyOut:null }],
    ["invalid",{ moneyIn:"invalid",moneyOut:null }]
  ])("rejects a bank transaction with %s",(_label,override) => {
    expect(classifyBankMatchCandidates({ ...incoming,...override },{ invoices:[invoice] })).toMatchObject({
      classification:"none",reasons:["bank-transaction-direction-or-amount-invalid"]
    });
  });

  it.each([
    ["paid",{ status:"Paid" }],
    ["settled",{ bankSettlement:{ transactionId:"other-bank" } }]
  ])("excludes %s source records",(_label,override) => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,...override }] }).classification).toBe("none");
  });

  it("excludes sources linked by another matched bank transaction",() => {
    const linked = { id:"other-bank",status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1" };
    expect(classifyBankMatchCandidates(incoming,{ invoices:[invoice] },{ transactions:[incoming,linked] }).classification).toBe("none");
  });

  it.each([
    ["matched",{ status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1" }],
    ["categorised",{ status:"matched",matchedRecordType:"bankIncome",matchedRecordId:"income-1" }]
  ])("does not reconsider an already %s bank transaction",(_label,override) => {
    expect(classifyBankMatchCandidates({ ...incoming,...override },{ invoices:[invoice] })).toMatchObject({
      classification:"none",reasons:["bank-transaction-not-unmatched"]
    });
  });

  it("uses deterministic candidate and transaction ordering",() => {
    const transactions = [{ ...outgoing,id:"z-bank" },{ ...incoming,id:"a-bank" }];
    const first = discoverBankMatchCandidates(transactions,{
      invoices:[{ ...invoice,id:"z-invoice" },{ ...invoice,id:"a-invoice",invoiceNo:"INV-002" }],
      bills:[{ ...bill,id:"z-bill" },{ ...bill,id:"a-bill",billNumber:"BILL-002" }]
    });
    const second = discoverBankMatchCandidates(transactions,{
      invoices:[{ ...invoice,id:"a-invoice",invoiceNo:"INV-002" },{ ...invoice,id:"z-invoice" }],
      bills:[{ ...bill,id:"a-bill",billNumber:"BILL-002" },{ ...bill,id:"z-bill" }]
    });
    expect(first).toEqual(second);
    expect(first.map(result => result.transactionId)).toEqual(["z-bank","a-bank"]);
    expect(first[0].candidates.map(candidate => candidate.candidateId)).toEqual(["a-bill","z-bill"]);
  });

  it("is read-only, immutable, and never calls accounting or Firestore operations",() => {
    const write = vi.fn(() => { throw new Error("write attempted"); });
    const transactions = [{ ...incoming,update:write,set:write,delete:write }];
    const sources = { invoices:[{ ...invoice,update:write,set:write,delete:write }] };
    const before = JSON.stringify({ transactions,sources });
    const results = discoverBankMatchCandidates(transactions,sources);
    expect(JSON.stringify({ transactions,sources })).toBe(before);
    expect(write).not.toHaveBeenCalled();
    expect(Object.isFrozen(results)).toBe(true);
    expect(Object.isFrozen(results[0].evidence)).toBe(true);
  });
});
