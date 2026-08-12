import { describe, expect, it } from "vitest";
import { suggestBankMatches } from "../resources/js/bank-match-suggestions.js";

const transaction = Object.freeze({
  id:"bank-1",
  transactionDate:"2026-08-04",
  description:"Onestream Limited",
  moneyIn:null,
  moneyOut:8.08,
  status:"unmatched"
});

const bill = Object.freeze({
  id:"bill-1",
  billNumber:"OS-1",
  supplier:"Onestream Limited",
  billDate:"2026-07-17",
  dueDate:"2026-07-31",
  total:8.08,
  status:"Unpaid"
});

function suggestions(transactionOverrides = {},billOverrides = {}){
  return suggestBankMatches(
    [{ ...transaction,...transactionOverrides }],
    { bills:[{ ...bill,...billOverrides }] }
  );
}

describe("supplier bill bank-match suggestions", () => {
  it("suggests the Onestream payment against its unpaid bill", () => {
    expect(suggestions()).toMatchObject([{
      confidence:90,
      candidate:{ recordType:"bill",label:"OS-1" },
      reasons:["Amount matches","Payment date is near bill due date","Supplier name found"]
    }]);
  });

  it("suggests an exact-amount payment up to seven days before the due date without requiring the supplier name", () => {
    expect(suggestions({ transactionDate:"2026-07-24",description:"Bank transfer" })).toMatchObject([{
      confidence:75,
      reasons:["Amount matches","Payment date is near bill due date"]
    }]);
  });

  it("suggests an exact-amount payment up to 30 days after the due date", () => {
    expect(suggestions({ transactionDate:"2026-08-30",description:"Bank transfer" })).toHaveLength(1);
  });

  it("does not suggest a payment more than 30 days after the due date", () => {
    expect(suggestions({ transactionDate:"2026-08-31" })).toEqual([]);
  });

  it("falls back to bill date and rejects a payment before it when the due date is invalid", () => {
    expect(suggestions(
      { transactionDate:"2026-07-16" },
      { dueDate:"not-a-date" }
    )).toEqual([]);
    expect(suggestions(
      { transactionDate:"2026-08-16",description:"Bank transfer" },
      { dueDate:"not-a-date" }
    )).toMatchObject([{
      confidence:75,
      reasons:["Amount matches","Payment date is on or after bill date"]
    }]);
  });

  it("keeps paid bills excluded", () => {
    expect(suggestions({}, { status:"Paid" })).toEqual([]);
  });

  it("keeps wrong amounts and the wrong money direction excluded", () => {
    expect(suggestions({}, { total:8.09 })).toEqual([]);
    expect(suggestions({ moneyIn:8.08,moneyOut:null })).toEqual([]);
  });

  it("keeps invoice matching on its existing absolute seven-day document-date rule", () => {
    const invoice = {
      id:"invoice-1",invoiceNo:"INV-1",client:"Customer",date:"2026-08-11",total:8.08,status:"Unpaid"
    };
    expect(suggestBankMatches([
      { ...transaction,description:"Bank receipt",moneyIn:8.08,moneyOut:null }
    ],{ invoices:[invoice] })).toMatchObject([{
      confidence:75,
      reasons:["Amount matches","Date within 7 days"]
    }]);
    expect(suggestBankMatches([
      { ...transaction,description:"Bank receipt",moneyIn:8.08,moneyOut:null }
    ],{ invoices:[{ ...invoice,date:"2026-08-12" }] })).toEqual([]);
  });
});
