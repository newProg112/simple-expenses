import { describe,expect,it,vi } from "vitest";
import {
  classifyBankMatchCandidates,
  discoverBankMatchCandidates
} from "../resources/js/bank-auto-match-candidates.js";

const incoming = Object.freeze({
  id:"bank-in",transactionDate:"2026-08-04",moneyIn:1200,moneyOut:null,status:"unmatched"
});
const outgoing = Object.freeze({
  id:"bank-out",transactionDate:"2026-08-04",moneyIn:null,moneyOut:1200,status:"unmatched"
});
const invoice = Object.freeze({
  id:"invoice-1",invoiceNo:"INV-1",date:"2026-08-01",total:1200,status:"Unpaid"
});
const bill = Object.freeze({
  id:"bill-1",billNumber:"BILL-1",billDate:"2026-07-01",dueDate:"2026-07-31",total:1200,status:"Unpaid"
});

describe("automatic bank-match candidate classification",() => {
  it("classifies one eligible incoming Invoice as high confidence",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[invoice] })).toMatchObject({
      classification:"highConfidence",candidateType:"invoice",candidateId:"invoice-1",
      reasons:["direction-compatible","exact-amount","date-compatible","source-unsettled","single-eligible-candidate"]
    });
  });

  it("classifies multiple eligible incoming Invoices as suggested",() => {
    const result = classifyBankMatchCandidates(incoming,{ invoices:[
      { ...invoice,id:"invoice-2",invoiceNo:"INV-2" },invoice
    ] });
    expect(result).toMatchObject({ classification:"suggested",candidateType:"invoice",candidateId:null });
    expect(result.candidates.map(candidate => candidate.candidateId)).toEqual(["invoice-1","invoice-2"]);
  });

  it("classifies an incoming transaction with no eligible Invoice as none",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[] }).classification).toBe("none");
  });

  it("classifies one eligible outgoing Bill as high confidence",() => {
    expect(classifyBankMatchCandidates(outgoing,{ bills:[bill] })).toMatchObject({
      classification:"highConfidence",candidateType:"bill",candidateId:"bill-1"
    });
  });

  it("classifies multiple eligible outgoing Bills as suggested",() => {
    const result = classifyBankMatchCandidates(outgoing,{ bills:[
      { ...bill,id:"bill-2",billNumber:"BILL-2" },bill
    ] });
    expect(result.classification).toBe("suggested");
    expect(result.candidates.map(candidate => candidate.candidateId)).toEqual(["bill-1","bill-2"]);
  });

  it("classifies an outgoing transaction with no eligible Bill as none",() => {
    expect(classifyBankMatchCandidates(outgoing,{ bills:[] }).classification).toBe("none");
  });

  it("excludes source types from the wrong transaction direction",() => {
    expect(classifyBankMatchCandidates(incoming,{ bills:[bill] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(outgoing,{ invoices:[invoice] }).classification).toBe("none");
  });

  it("requires exact equality after conversion to integer cents",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,total:1199.99 }] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(
      { ...incoming,moneyIn:0.1 + 0.2 },
      { invoices:[{ ...invoice,total:0.3 }] }
    ).classification).toBe("highConfidence");
  });

  it.each([
    ["paid",{ status:"Paid" }],
    ["settled",{ bankSettlement:{ transactionId:"other-bank" } }]
  ])("excludes %s source records",(_label,override) => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,...override }] }).classification).toBe("none");
  });

  it("excludes source records already linked by another matched bank transaction",() => {
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

  it("does not promote date-incompatible or invalidly dated records",() => {
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,date:"2026-08-12" }] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(outgoing,{ bills:[{ ...bill,dueDate:"2026-09-01" }] }).classification).toBe("none");
    expect(classifyBankMatchCandidates(incoming,{ invoices:[{ ...invoice,date:"invalid" }] }).classification).toBe("none");
  });

  it("uses deterministic candidate and transaction ordering",() => {
    const transactions = [{ ...outgoing,id:"z-bank" },{ ...incoming,id:"a-bank" }];
    const first = discoverBankMatchCandidates(transactions,{
      invoices:[{ ...invoice,id:"z-invoice" },{ ...invoice,id:"a-invoice" }],
      bills:[{ ...bill,id:"z-bill" },{ ...bill,id:"a-bill" }]
    });
    const second = discoverBankMatchCandidates(transactions,{
      invoices:[{ ...invoice,id:"a-invoice" },{ ...invoice,id:"z-invoice" }],
      bills:[{ ...bill,id:"a-bill" },{ ...bill,id:"z-bill" }]
    });
    expect(first).toEqual(second);
    expect(first.map(result => result.transactionId)).toEqual(["z-bank","a-bank"]);
    expect(first[0].candidates.map(candidate => candidate.candidateId)).toEqual(["a-bill","z-bill"]);
  });

  it("is read-only and never calls accounting or Firestore operations",() => {
    const write = vi.fn(() => { throw new Error("write attempted"); });
    const transactions = [{ ...incoming,update:write,set:write,delete:write }];
    const sources = { invoices:[{ ...invoice,update:write,set:write,delete:write }] };
    const before = JSON.stringify({ transactions,sources });
    expect(() => discoverBankMatchCandidates(transactions,sources)).not.toThrow();
    expect(JSON.stringify({ transactions,sources })).toBe(before);
    expect(write).not.toHaveBeenCalled();
  });
});
