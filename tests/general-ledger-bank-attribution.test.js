import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import {
  prepareBankExceptionJournal,
  prepareBankIncomeJournal,
  prepareBankOpeningBalanceJournal,
  prepareBankSettlementJournal,
  prepareBankTransferJournal,
  prepareExpenseJournal
} from "../resources/js/ledger-firestore.js";
import { buildTrialBalance } from "../resources/js/ledger-engine.js";
import { buildBalanceSheetReport } from "../resources/js/balance-sheet-view.js";
import {
  generalLedgerBankAccountFilterState,
  generalLedgerBankAccountOptions,
  generalLedgerViewFromJournals
} from "../resources/js/general-ledger-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const userId = "user-1";
const date = "2026-08-14";
const bankAccounts = Object.freeze([
  { id:"source",accountName:"tetttt",bankName:"Source Bank",status:"Active" },
  { id:"destination",accountName:"Test Current Account",bankName:"Destination Bank",status:"Active" },
  { id:"archived",accountName:"Old Savings",bankName:"Old Bank",status:"Archived" }
]);
const generalLedgerHtml = readFileSync(
  new URL("../resources/tools/general-ledger.html",import.meta.url),
  "utf8"
);

function storedJournal(journal){
  return journalFromFirestoreData(journal.journalId,journal);
}

function bankView(journals,accounts = bankAccounts,options = {}){
  return generalLedgerViewFromJournals(journals.map(storedJournal),{
    accountCode:"1000",bankAccounts:accounts,...options
  });
}

function transferJournal(id = "transfer-1",overrides = {}){
  return prepareBankTransferJournal(userId,id,{
    sourceBankAccountId:"source",destinationBankAccountId:"destination",
    amount:62.5,effectiveDate:date,...overrides
  });
}

function incomeJournal(id,bankAccountId,dateValue,amount,vat = 0){
  return prepareBankIncomeJournal(userId,id,{
    bankTransactionId:`${id}-row`,bankAccountId,date:dateValue,payer:"Customer Ltd",
    gross:amount,net:amount - vat,vat,incomeAccountCode:"4000",category:"sales"
  });
}

describe("General Ledger bank-account attribution and filtering",() => {
  it("shows the transfer debit as To destination and credit as From source",() => {
    const view = bankView([transferJournal()]);
    expect(view).toMatchObject({ state:"loaded",entriesCount:2,closingBalance:0 });
    expect(view.rows).toEqual([
      expect.objectContaining({
        bankAccountId:"destination",bankAccountDisplay:"To Test Current Account",debit:62.5,credit:0
      }),
      expect.objectContaining({
        bankAccountId:"source",bankAccountDisplay:"From tetttt",debit:0,credit:62.5
      })
    ]);
  });

  it("preserves omitted and explicit All bank-account behaviour exactly",() => {
    const transfer = transferJournal("transfer-all");
    const omitted = bankView([transfer]);
    const explicitAll = bankView([transfer],bankAccounts,{ bankAccountId:"" });
    expect(explicitAll).toEqual(omitted);
    expect(explicitAll).toMatchObject({ entriesCount:2,closingBalance:0 });
  });

  it("builds the source and destination transfer ledgers independently",() => {
    const transfer = transferJournal("transfer-filtered");
    const source = bankView([transfer],bankAccounts,{ bankAccountId:"source" });
    const destination = bankView([transfer],bankAccounts,{ bankAccountId:"destination" });
    expect(source).toMatchObject({
      entriesCount:1,closingBalance:-62.5,closingBalanceDisplay:"\u00a362.50 Cr"
    });
    expect(source.rows[0]).toMatchObject({
      bankAccountDisplay:"From tetttt",debit:0,credit:62.5,runningBalance:-62.5
    });
    expect(destination).toMatchObject({
      entriesCount:1,closingBalance:62.5,closingBalanceDisplay:"\u00a362.50 Dr"
    });
    expect(destination.rows[0]).toMatchObject({
      bankAccountDisplay:"To Test Current Account",debit:62.5,credit:0,runningBalance:62.5
    });
  });

  it("calculates genuine per-account running and closing balances",() => {
    const opening = prepareBankOpeningBalanceJournal(userId,"source",{
      openingBalance:100,openingBalanceDate:"2026-08-10"
    });
    const income = incomeJournal("income-running","source","2026-08-12",25);
    const transfer = transferJournal("transfer-running",{ effectiveDate:"2026-08-14" });
    const view = bankView([transfer,income,opening],bankAccounts,{ bankAccountId:"source" });
    expect(view.rows.map(row => row.runningBalance)).toEqual([100,125,62.5]);
    expect(view.closingBalance).toBe(62.5);
  });

  it("combines exact bank attribution with inclusive Date From and Date To",() => {
    const journals = [
      incomeJournal("before","source","2026-08-09",50),
      incomeJournal("start","source","2026-08-10",20),
      incomeJournal("other","destination","2026-08-11",99),
      transferJournal("end",{ amount:5,effectiveDate:"2026-08-12" }),
      incomeJournal("after","source","2026-08-13",30)
    ];
    const view = bankView(journals,bankAccounts,{
      bankAccountId:"source",dateFrom:"2026-08-10",dateTo:"2026-08-12"
    });
    expect(view.rows.map(row => [row.date,row.debit,row.credit,row.runningBalance])).toEqual([
      ["2026-08-10",20,0,20],
      ["2026-08-12",0,5,15]
    ]);
    expect(view.closingBalance).toBe(15);
  });

  it("prefers line-level attribution over a conflicting journal fallback",() => {
    const transfer = { ...transferJournal("transfer-priority"),bankAccountId:"wrong-fallback" };
    expect(bankView([transfer]).rows.map(row => row.bankAccountId))
      .toEqual(["destination","source"]);
    expect(bankView([transfer],bankAccounts,{ bankAccountId:"source" }).rows)
      .toEqual([expect.objectContaining({ credit:62.5,bankAccountId:"source" })]);
  });

  it.each([
    ["invoice",120,"debit"],
    ["bill",60,"credit"],
    ["expense",45,"credit"]
  ])("filters a %s settlement to its existing bank-account attribution",(recordType,amount,direction) => {
    const settlement = prepareBankSettlementJournal(userId,`${recordType}-settlement`,{
      recordId:`${recordType}-1`,recordType,amount,transactionDate:date,bankAccountId:"source"
    });
    const row = bankView([settlement],bankAccounts,{ bankAccountId:"source" }).rows[0];
    expect(row.bankAccountId).toBe("source");
    expect(row[direction]).toBe(amount);
    expect(bankView([settlement],bankAccounts,{ bankAccountId:"destination" }).state)
      .toBe("noActivity");
  });

  it("keeps settlement attribution on its Bank row only",() => {
    const stored = storedJournal(prepareBankSettlementJournal(userId,"settlement-row",{
      recordId:"invoice-1",recordType:"invoice",amount:120,
      transactionDate:date,bankAccountId:"destination"
    }));
    const bank = generalLedgerViewFromJournals([stored],{
      accountCode:"1000",bankAccountId:"destination",bankAccounts
    });
    const receivable = generalLedgerViewFromJournals([stored],{
      accountCode:"1100",bankAccountId:"source",bankAccounts
    });
    expect(stored.bankAccountId).toBe("destination");
    expect(bank.rows[0].bankAccountDisplay).toBe("Bank account: Test Current Account");
    expect(receivable.rows[0]).not.toHaveProperty("bankAccountId");
    expect(receivable.rows[0]).not.toHaveProperty("bankAccountDisplay");
  });

  it("filters Money In categorisation using its existing attribution",() => {
    const income = incomeJournal("income-1","destination",date,120,20);
    expect(bankView([income],bankAccounts,{ bankAccountId:"destination" }).rows[0])
      .toEqual(expect.objectContaining({
        bankAccountId:"destination",bankAccountDisplay:"Bank account: Test Current Account",debit:120
      }));
  });

  it("filters opening balances and resolves archived account names",() => {
    const opening = prepareBankOpeningBalanceJournal(userId,"archived",{
      openingBalance:250,openingBalanceDate:date
    });
    expect(bankView([opening],bankAccounts,{ bankAccountId:"archived" }).rows[0])
      .toEqual(expect.objectContaining({
        bankAccountId:"archived",bankAccountDisplay:"Bank account: Old Savings (Archived)"
      }));
  });

  it.each([
    ["ownerContribution","3000","moneyIn",75,"debit"],
    ["ownerDrawing","3200","moneyOut",30,"credit"]
  ])("filters %s exception Bank rows",(resolutionType,nominalAccountCode,direction,amount,side) => {
    const exception = prepareBankExceptionJournal(userId,`exception-${direction}`,{
      bankTransactionId:`exception-${direction}-row`,bankAccountId:"source",
      resolutionType,nominalAccountCode,direction,amount,effectiveDate:date
    });
    const stored = storedJournal(exception);
    const bank = generalLedgerViewFromJournals([stored],{
      accountCode:"1000",bankAccountId:"source",bankAccounts
    });
    const counter = generalLedgerViewFromJournals([stored],{
      accountCode:nominalAccountCode,bankAccountId:"destination",bankAccounts
    });
    expect(bank.rows[0]).toMatchObject({ bankAccountId:"source",[side]:amount });
    expect(counter.rows[0]).not.toHaveProperty("bankAccountDisplay");
  });

  it("attributes Money Out settlement Bank only and leaves accrual lines unlabelled",() => {
    const settlement = prepareBankSettlementJournal(userId,"expense-payment",{
      recordId:"expense-1",recordType:"expense",amount:60,
      transactionDate:date,bankAccountId:"source"
    });
    const accrual = prepareExpenseJournal(userId,"expense-1",{
      date,merchant:"Supplier",category:"General",net:50,vat:10,gross:60
    });
    const stored = [storedJournal(accrual),storedJournal(settlement)];
    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"1000",bankAccountId:"source",bankAccounts
    }).rows[0].bankAccountDisplay).toBe("Bank account: tetttt");
    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"5000",bankAccountId:"destination",bankAccounts
    }).rows[0]).not.toHaveProperty("bankAccountDisplay");
    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"2200",bankAccountId:"destination",bankAccounts
    }).rows.every(row => !row.bankAccountDisplay)).toBe(true);
  });

  it("uses active names and handles a missing account document without a synthetic option",() => {
    const known = prepareBankOpeningBalanceJournal(userId,"source",{
      openingBalance:10,openingBalanceDate:date
    });
    const missing = prepareBankOpeningBalanceJournal(userId,"missing-account",{
      openingBalance:20,openingBalanceDate:date
    });
    const displays = bankView([known,missing]).rows.map(row => row.bankAccountDisplay);
    expect(displays).toContain("Bank account: tetttt");
    expect(displays).toContain("Bank account: missing-account");
    expect(generalLedgerBankAccountOptions(bankAccounts).map(option => option.value))
      .not.toContain("missing-account");
    expect(bankView([missing],bankAccounts,{ bankAccountId:"missing-account" }).rows[0])
      .toMatchObject({
        bankAccountId:"missing-account",bankAccountDisplay:"Bank account: missing-account"
      });
  });

  it("includes unattributed legacy Bank rows under All and excludes them specifically",() => {
    const legacy = {
      journalId:"legacy-bank",date,sourceType:"legacy",sourceId:"legacy-bank",
      description:"Legacy Bank posting",lines:[
        { accountCode:"1000",description:"Legacy Bank posting",debit:30,credit:0 },
        { accountCode:"3000",description:"Legacy Bank posting",debit:0,credit:30 }
      ]
    };
    const all = bankView([legacy]);
    const specific = bankView([legacy],bankAccounts,{ bankAccountId:"source" });
    expect(all).toMatchObject({ state:"loaded",entriesCount:1,closingBalance:30 });
    expect(all.rows[0]).not.toHaveProperty("bankAccountId");
    expect(specific).toMatchObject({ state:"noActivity",entriesCount:0,closingBalance:0 });
    expect(specific.emptyTitle).toBe("No journal entries found for the selected filters.");
  });

  it("does not let a supplied bank filter affect a non-1000 ledger",() => {
    const settlement = storedJournal(prepareBankSettlementJournal(userId,"invoice-non-bank",{
      recordId:"invoice-1",recordType:"invoice",amount:120,
      transactionDate:date,bankAccountId:"source"
    }));
    const omitted = generalLedgerViewFromJournals([settlement],{
      accountCode:"1100",bankAccounts
    });
    const supplied = generalLedgerViewFromJournals([settlement],{
      accountCode:"1100",bankAccountId:"destination",bankAccounts
    });
    expect(supplied).toEqual(omitted);
  });

  it("orders active accounts before archived accounts and resets hidden filter state",() => {
    expect(generalLedgerBankAccountOptions([
      { id:"z",accountName:"Zulu",bankName:"B",status:"Active" },
      { id:"archived",accountName:"Alpha",bankName:"A",status:"Archived" },
      { id:"a",accountName:"alpha",bankName:"C",status:"Active" }
    ])).toEqual([
      { value:"a",label:"alpha" },
      { value:"z",label:"Zulu" },
      { value:"archived",label:"Alpha (Archived)" }
    ]);
    expect(generalLedgerBankAccountFilterState("1000"," source "))
      .toEqual({ visible:true,bankAccountId:"source" });
    expect(generalLedgerBankAccountFilterState("1100","source"))
      .toEqual({ visible:false,bankAccountId:"" });
  });

  it("does not mutate journals or change Trial Balance, Balance Sheet, P&L, or VAT outcomes",() => {
    const transfer = storedJournal(transferJournal("transfer-reports"));
    const income = storedJournal(incomeJournal("income-reports","source",date,120,20));
    const expense = storedJournal(prepareExpenseJournal(userId,"expense-reports",{
      date,merchant:"Supplier",category:"General",net:50,vat:10,gross:60
    }));
    const journals = [transfer,income,expense];
    const beforeJournals = structuredClone(journals);
    const before = {
      trialBalance:buildTrialBalance(journals),
      balanceSheet:buildBalanceSheetReport(journals),
      profitLoss:buildProfitLossReport(journals)
    };
    generalLedgerViewFromJournals(journals,{
      accountCode:"1000",bankAccountId:"source",bankAccounts
    });
    expect(journals).toEqual(beforeJournals);
    expect(buildTrialBalance(journals)).toEqual(before.trialBalance);
    expect(buildBalanceSheetReport(journals)).toEqual(before.balanceSheet);
    expect(buildProfitLossReport(journals)).toEqual(before.profitLoss);
    expect(before.trialBalance.accounts.find(row => row.accountCode === "2100"))
      .toMatchObject({ debits:0,credits:20,balance:-20 });
    expect(before.trialBalance.accounts.find(row => row.accountCode === "1200"))
      .toMatchObject({ debits:10,credits:0,balance:10 });
    expect(transfer.lines.some(line => ["1200","2100"].includes(line.accountCode)))
      .toBe(false);
  });

  it("wires the conditional selector, reset, refresh, and non-fatal account loading",() => {
    expect(generalLedgerHtml).toContain('collection(db,"users",ownerId,"bankAccounts")');
    expect(generalLedgerHtml).toContain("normaliseBankAccount(documentSnapshot.id,documentSnapshot.data())");
    expect(generalLedgerHtml).toContain("if(entry.bankAccountDisplay)");
    expect(generalLedgerHtml).toContain('bankAccount.className = "ledger-bank-account"');
    expect(generalLedgerHtml).toContain('id="bankAccountFilterField" hidden');
    expect(generalLedgerHtml).toContain('id="bankAccountFilter"');
    expect(generalLedgerHtml).toContain("All bank accounts");
    expect(generalLedgerHtml).toContain("bankAccountFilterField.hidden = !state.visible");
    expect(generalLedgerHtml).toContain("bankAccountFilter.value = state.bankAccountId");
    expect(generalLedgerHtml).toContain('accountSelect.addEventListener("change", applyCurrentFilters)');
    expect(generalLedgerHtml).toContain('bankAccountFilter.addEventListener("change", applyCurrentFilters)');
    expect(generalLedgerHtml).toContain('refreshButton.addEventListener("click", applyCurrentFilters)');
    expect(generalLedgerHtml).toContain("getDocs(collection(db,\"users\",ownerId,\"bankAccounts\")).catch");
    expect(generalLedgerHtml).toContain("return { docs:[] }");
  });
});
