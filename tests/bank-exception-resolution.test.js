import { describe,expect,it } from "vitest";
import {
  BANK_EXCEPTION_IGNORE_REASONS,
  BANK_EXCEPTION_TYPES,
  bankExceptionEligibility,
  bankExceptionOptions,
  bankExceptionResolutionDocumentId,
  resolveBankException,
  unresolveBankException
} from "../resources/js/bank-exception-resolution.js";
import { calculateBankReconciliation,reconciliationHistory } from "../resources/js/bank-reconciliation.js";
import { bankAccountOpeningBalanceLocked } from "../resources/js/bank-opening-balance.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { buildTrialBalance,DEFAULT_CHART_OF_ACCOUNTS } from "../resources/js/ledger-engine.js";
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { normaliseBankTransaction } from "../resources/js/bank-transaction-import.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const userId = "user-1";
const timestamp = Object.freeze({ serverTimestamp:true });
const transactionPath = "users/user-1/bankTransactions/bank-row";
const accountPath = "users/user-1/bankAccounts/account-1";
const moneyIn = Object.freeze({
  bankAccountId:"account-1",transactionDate:"2026-08-12",description:"OTHER RECEIPT",
  moneyIn:100,moneyOut:null,balance:500,status:"unmatched",source:"csv",importId:"import-1",
  createdAt:"created",updatedAt:"created"
});
const moneyOut = Object.freeze({
  ...moneyIn,description:"OTHER PAYMENT",moneyIn:null,moneyOut:100,balance:300
});

function mockFirestore(overrides = {}){
  const removed = Symbol("deleteField");
  const documents = new Map([
    [accountPath,{ accountName:"Current",bankName:"Bank",status:"Active" }],
    [transactionPath,{ ...(overrides.direction === "out" ? moneyOut : moneyIn) }],
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

function options(fixture,resolutionType,overrides = {}){
  return {
    db:{},userId,transactionId:"bank-row",services:fixture.services,
    input:{ resolutionType,reasonCode:"",notes:"",...(overrides.input || {}) },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "input"))
  };
}

function rawJournals(documents){
  return [...documents.entries()].filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => ({ id:path.slice(9),...data }));
}

function reportJournals(documents){
  return [...documents.entries()].filter(([path]) => path.startsWith("journals/"))
    .map(([path,data]) => journalFromFirestoreData(path.slice(9),data));
}

function account(id = "account-1",status = "Active"){
  const input = JSON.stringify({ bankAccountId:id,openingBalance:0,openingBalanceDate:"2026-08-01",version:1 });
  let hash = 14695981039346656037n;
  for(let index = 0; index < input.length; index += 1){
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64,hash * 1099511628211n);
  }
  return {
    id,accountName:"Current",bankName:"Bank",status,openingBalance:0,openingBalanceDate:"2026-08-01",
    openingBalanceAccounting:{
      version:1,bankAccountId:id,openingBalance:0,openingBalanceDate:"2026-08-01",
      state:"not-required",journalId:"",fingerprint:hash.toString(16).padStart(16,"0")
    }
  };
}

function reconciliation(fixture,statementClosingBalance,overrides = {}){
  return calculateBankReconciliation({
    userId,bankAccountId:"account-1",account:account(),statementClosingDate:"2026-08-31",
    statementClosingBalance,journals:rawJournals(fixture.documents),
    transactions:[{ id:"bank-row",...fixture.documents.get(transactionPath) }],...overrides
  });
}

describe("Banking exception definitions and eligibility",() => {
  it("adds only the required balance-sheet accounts and reuses Owner's Equity",() => {
    expect(DEFAULT_CHART_OF_ACCOUNTS).toEqual(expect.arrayContaining([
      { code:"3000",name:"Owner's Equity",type:"Equity" },
      { code:"3200",name:"Owner's Drawings",type:"Equity" },
      { code:"2300",name:"Tax Control",type:"Liability" },
      { code:"2400",name:"Business Loan",type:"Liability" }
    ]));
  });

  it("offers only direction-valid concise resolution choices",() => {
    expect(bankExceptionEligibility(moneyIn)).toMatchObject({ eligible:true,direction:"moneyIn",amount:100 });
    expect(bankExceptionEligibility(moneyOut)).toMatchObject({ eligible:true,direction:"moneyOut",amount:100 });
    expect(bankExceptionOptions("moneyIn").map(item => item.value)).toEqual([
      "ownerContribution","loanReceived","personalNonBusinessIn","ignoredReviewed"
    ]);
    expect(bankExceptionOptions("moneyOut").map(item => item.value)).toEqual([
      "ownerDrawing","loanRepaymentPrincipal","taxPayment","personalNonBusinessOut","ignoredReviewed"
    ]);
    expect(bankExceptionEligibility({ ...moneyIn,status:"matched" }).eligible).toBe(false);
    expect(bankExceptionResolutionDocumentId("bank/row")).toBe("bank-exception_bank%2Frow");
  });

  it("defines constrained ignore reasons with explicit reconciliation behaviour",() => {
    expect(BANK_EXCEPTION_IGNORE_REASONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ value:"duplicateProviderArtifact",blocksReconciliation:false }),
      expect.objectContaining({ value:"informationalRow",blocksReconciliation:true }),
      expect.objectContaining({ value:"unsupportedStatementRecord",blocksReconciliation:true })
    ]));
  });
});

describe.each([
  ["owner contribution","in","ownerContribution","3000",100,0,{ assets:100,equity:100,liabilities:0 }],
  ["personal money in","in","personalNonBusinessIn","3000",100,0,{ assets:100,equity:100,liabilities:0 }],
  ["loan received","in","loanReceived","2400",100,0,{ assets:100,equity:0,liabilities:100 }],
  ["owner drawing","out","ownerDrawing","3200",0,100,{ assets:-100,equity:-100,liabilities:0 }],
  ["personal money out","out","personalNonBusinessOut","3200",0,100,{ assets:-100,equity:-100,liabilities:0 }],
  ["principal loan repayment","out","loanRepaymentPrincipal","2400",0,100,{ assets:-100,equity:0,liabilities:-100 }],
  ["tax payment","out","taxPayment","2300",0,100,{ assets:-100,equity:0,liabilities:-100 }]
])("accounting-posted exception: %s",(_label,direction,resolutionType,accountCode,bankDebit,bankCredit,expected) => {
  it("posts the exact bank/control movement with no P&L or VAT",async () => {
    const fixture = mockFirestore({ direction });
    const original = structuredClone(fixture.documents.get(transactionPath));
    const result = await resolveBankException(options(fixture,resolutionType));
    const resolutionPath = `users/${userId}/bankExceptionResolutions/bank-exception_bank-row`;
    const journalPath = `journals/bank-exception_${userId}_bank-exception_bank-row`;
    expect(result).toMatchObject({ status:"resolved",resolutionId:"bank-exception_bank-row",journalId:journalPath.slice(9) });
    expect(fixture.documents.get(resolutionPath)).toMatchObject({
      version:1,userId,bankTransactionId:"bank-row",bankAccountId:"account-1",
      resolutionType,nominalAccountCode:accountCode,posting:"journal",status:"posted"
    });
    const journal = fixture.documents.get(journalPath);
    expect(journal.lines.find(line => line.accountCode === "1000")).toMatchObject({
      bankAccountId:"account-1",debit:bankDebit,credit:bankCredit
    });
    expect(journal.lines.find(line => line.accountCode === accountCode)).toMatchObject({
      debit:bankCredit,credit:bankDebit
    });
    const transaction = fixture.documents.get(transactionPath);
    expect(transaction).toMatchObject({
      status:"matched",matchedRecordType:"bankException",matchOrigin:"bankException",
      exceptionResolutionType:resolutionType,exceptionPosting:"journal"
    });
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(transaction[field]).toEqual(original[field]);
    }
    const journals = reportJournals(fixture.documents);
    const trialBalance = buildTrialBalance(journals);
    const balanceSheet = buildBalanceSheetReport(journals);
    const profitLoss = buildProfitLossReport(journals);
    const bankLedger = generalLedgerViewFromJournals(journals,{ accountCode:"1000" });
    const counterLedger = generalLedgerViewFromJournals(journals,{ accountCode });
    expect(trialBalance.balanced).toBe(true);
    expect(balanceSheet).toMatchObject({
      totalAssets:expected.assets,totalEquity:expected.equity,totalLiabilities:expected.liabilities,difference:0
    });
    expect(profitLoss).toMatchObject({ totalIncome:0,totalExpenses:0,netResult:0 });
    expect(bankLedger).toMatchObject({ state:"loaded",entriesCount:1,closingBalance:bankDebit - bankCredit });
    expect(bankLedger.rows[0]).toMatchObject({ bankAccountId:"account-1" });
    expect(counterLedger).toMatchObject({ state:"loaded",entriesCount:1 });
    expect(journals.flatMap(item => item.lines).some(line => ["1200","2100"].includes(line.accountCode))).toBe(false);
    expect(reconciliation(fixture,direction === "in" ? 100 : -100))
      .toMatchObject({ bookBalance:direction === "in" ? 100 : -100,unresolvedCount:0,eligible:true });
  });
});

describe("ignored/reviewed exceptions",() => {
  it("retains the imported payload and reason without creating a journal",async () => {
    const fixture = mockFirestore();
    const original = structuredClone(fixture.documents.get(transactionPath));
    await resolveBankException(options(fixture,"ignoredReviewed",{
      input:{ reasonCode:"duplicateProviderArtifact",notes:"Duplicate feed row" }
    }));
    expect(rawJournals(fixture.documents)).toEqual([]);
    expect(fixture.documents.get(transactionPath)).toMatchObject({
      status:"matched",exceptionPosting:"none",exceptionReasonCode:"duplicateProviderArtifact",
      exceptionJournalId:"",exceptionBlocksReconciliation:false
    });
    for(const field of ["bankAccountId","transactionDate","description","moneyIn","moneyOut","balance","source","importId","createdAt"]){
      expect(fixture.documents.get(transactionPath)[field]).toEqual(original[field]);
    }
    expect(fixture.documents.get("users/user-1/bankExceptionResolutions/bank-exception_bank-row"))
      .toMatchObject({ status:"reviewed",posting:"none",reasonCode:"duplicateProviderArtifact",notes:"Duplicate feed row" });
    expect(reconciliation(fixture,0)).toMatchObject({ unresolvedCount:0,blockingIgnoredCount:0,eligible:true });
  });

  it("does not count a constrained unsupported ignore as unresolved but blocks sign-off",async () => {
    const fixture = mockFirestore();
    await resolveBankException(options(fixture,"ignoredReviewed",{
      input:{ reasonCode:"unsupportedStatementRecord" }
    }));
    const result = reconciliation(fixture,0);
    expect(result).toMatchObject({ unresolvedCount:0,blockingIgnoredCount:1,eligible:false });
    expect(result.blockers.join(" ")).toMatch(/require accounting resolution/i);
  });

  it("requires a predefined reason",async () => {
    const fixture = mockFirestore();
    await expect(resolveBankException(options(fixture,"ignoredReviewed"))).rejects.toThrow(/ignore reason/i);
    expect(fixture.writes).toEqual([]);
  });
});

describe("exception integrity, exclusivity and Unresolve",() => {
  it.each([
    ["matched",{ status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1" }],
    ["categorised",{ status:"matched",matchedRecordType:"bankIncome",matchOrigin:"categorisation" }],
    ["transferred",{ status:"matched",matchedRecordType:"bankTransfer",matchOrigin:"bankTransfer" }]
  ])("rejects an already %s row",async (_label,state) => {
    const fixture = mockFirestore({ documents:[[transactionPath,{ ...moneyIn,...state }]] });
    await expect(resolveBankException(options(fixture,"ownerContribution"))).rejects.toThrow(/existing undo action/i);
    expect(fixture.writes).toEqual([]);
  });

  it("protects ownership and supports archived historical accounts",async () => {
    const missing = mockFirestore({ documents:[[accountPath,undefined]] });
    missing.documents.delete(accountPath);
    await expect(resolveBankException(options(missing,"ownerContribution"))).rejects.toThrow(/not owned/i);
    const archived = mockFirestore({ documents:[[accountPath,{ accountName:"Old",bankName:"Bank",status:"Archived" }]] });
    await expect(resolveBankException(options(archived,"ownerContribution"))).resolves.toMatchObject({ status:"resolved" });
    expect(archived.documents.get(accountPath).status).toBe("Archived");
  });

  it("is deterministic and idempotent across repeat and concurrent requests",async () => {
    const fixture = mockFirestore();
    const [first,second] = await Promise.all([
      resolveBankException(options(fixture,"ownerContribution")),
      resolveBankException(options(fixture,"ownerContribution"))
    ]);
    expect([first.status,second.status].sort()).toEqual(["already-resolved","resolved"]);
    expect(rawJournals(fixture.documents)).toHaveLength(1);
    expect([...fixture.documents.keys()].filter(path => path.includes("/bankExceptionResolutions/"))).toHaveLength(1);
  });

  it("normalises only complete exception markers",async () => {
    const fixture = mockFirestore();
    await resolveBankException(options(fixture,"ownerContribution"));
    expect(normaliseBankTransaction("bank-row",fixture.documents.get(transactionPath)))
      .toMatchObject({ status:"matched",matchedRecordType:"bankException",exceptionPosting:"journal" });
    expect(normaliseBankTransaction("bad",{
      ...moneyIn,status:"matched",matchedRecordType:"bankException",matchedRecordId:"x",matchedAmount:100
    }).status).toBe("unmatched");
  });

  it("locks opening balances and safely removes a posted resolution",async () => {
    const fixture = mockFirestore();
    const posted = await resolveBankException(options(fixture,"ownerContribution"));
    expect(fixture.documents.get(accountPath).bankingActivity).toEqual({ version:1,type:"bankExceptionResolution" });
    expect(bankAccountOpeningBalanceLocked({ id:"account-1",...fixture.documents.get(accountPath) },[])).toBe(true);
    await expect(unresolveBankException({ db:{},userId,transactionId:"bank-row",services:fixture.services }))
      .resolves.toMatchObject({ status:"unresolved",resolutionId:posted.resolutionId });
    expect(rawJournals(fixture.documents)).toEqual([]);
    expect(fixture.documents.has(`users/${userId}/bankExceptionResolutions/${posted.resolutionId}`)).toBe(false);
    expect(fixture.documents.get(transactionPath)).toMatchObject({ status:"unmatched" });
    expect(fixture.documents.get(transactionPath)).not.toHaveProperty("exceptionResolutionId");
    await expect(unresolveBankException({ db:{},userId,transactionId:"bank-row",services:fixture.services }))
      .resolves.toMatchObject({ status:"already-unresolved" });
  });

  it("safely removes a no-journal reviewed resolution",async () => {
    const fixture = mockFirestore();
    await resolveBankException(options(fixture,"ignoredReviewed",{
      input:{ reasonCode:"duplicateProviderArtifact" }
    }));
    await expect(unresolveBankException({ db:{},userId,transactionId:"bank-row",services:fixture.services }))
      .resolves.toMatchObject({ status:"unresolved",journalId:"" });
    expect(rawJournals(fixture.documents)).toEqual([]);
  });

  it("makes historical reconciliation Needs review without rewriting the signed record",async () => {
    const fixture = mockFirestore();
    await resolveBankException(options(fixture,"ownerContribution"));
    const signed = reconciliation(fixture,100);
    const record = {
      id:"signed",version:1,userId,bankAccountId:"account-1",statementClosingDate:"2026-08-31",
      statementClosingBalance:100,bookBalance:100,difference:0,unresolvedCount:0,
      status:"reconciled",sourceFingerprint:signed.sourceFingerprint
    };
    await unresolveBankException({ db:{},userId,transactionId:"bank-row",services:fixture.services });
    const history = reconciliationHistory([record],{
      userId,bankAccountId:"account-1",account:account(),statementClosingBalance:100,
      journals:rawJournals(fixture.documents),transactions:[{ id:"bank-row",...fixture.documents.get(transactionPath) }]
    });
    expect(history[0]).toMatchObject({ displayStatus:"needs-review",sourceFingerprint:signed.sourceFingerprint });
  });
});
