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
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { buildProfitLossReport } from "../resources/js/profit-loss-view.js";
import { journalFromFirestoreData } from "../resources/js/trial-balance-view.js";

const userId = "user-1";
const date = "2026-08-14";
const bankAccounts = Object.freeze([
  { id:"source",accountName:"tetttt",status:"Active" },
  { id:"destination",accountName:"Test Current Account",status:"Active" },
  { id:"archived",accountName:"Old Savings",status:"Archived" }
]);
const generalLedgerHtml = readFileSync(
  new URL("../resources/tools/general-ledger.html",import.meta.url),
  "utf8"
);

function storedJournal(journal){
  return journalFromFirestoreData(journal.journalId,journal);
}

function bankView(journals,accounts = bankAccounts){
  return generalLedgerViewFromJournals(journals.map(storedJournal),{
    accountCode:"1000",
    bankAccounts:accounts
  });
}

describe("General Ledger bank-account attribution",() => {
  it("shows the £62.50 transfer debit as To destination and credit as From source",() => {
    const transfer = prepareBankTransferJournal(userId,"transfer-1",{
      sourceBankAccountId:"source",
      destinationBankAccountId:"destination",
      amount:62.5,
      effectiveDate:date
    });
    const view = bankView([transfer]);

    expect(view).toMatchObject({ state:"loaded",entriesCount:2,closingBalance:0 });
    expect(view.rows).toEqual([
      expect.objectContaining({
        bankAccountId:"destination",
        bankAccountDisplay:"To Test Current Account",
        debit:62.5,
        credit:0
      }),
      expect.objectContaining({
        bankAccountId:"source",
        bankAccountDisplay:"From tetttt",
        debit:0,
        credit:62.5
      })
    ]);
  });

  it("prefers line-level attribution over a conflicting journal fallback",() => {
    const transfer = {
      ...prepareBankTransferJournal(userId,"transfer-priority",{
        sourceBankAccountId:"source",
        destinationBankAccountId:"destination",
        amount:62.5,
        effectiveDate:date
      }),
      bankAccountId:"wrong-fallback"
    };

    expect(bankView([transfer]).rows.map(row => row.bankAccountId))
      .toEqual(["destination","source"]);
  });

  it("retains settlement journal-level attribution for its Bank row only",() => {
    const settlement = prepareBankSettlementJournal(userId,"settlement-row",{
      recordId:"invoice-1",
      recordType:"invoice",
      amount:120,
      transactionDate:date,
      bankAccountId:"destination"
    });
    const stored = storedJournal(settlement);
    const bank = generalLedgerViewFromJournals([stored],{
      accountCode:"1000",bankAccounts
    });
    const receivable = generalLedgerViewFromJournals([stored],{
      accountCode:"1100",bankAccounts
    });

    expect(stored.bankAccountId).toBe("destination");
    expect(bank.rows[0].bankAccountDisplay).toBe("Bank account: Test Current Account");
    expect(receivable.rows[0]).not.toHaveProperty("bankAccountId");
    expect(receivable.rows[0]).not.toHaveProperty("bankAccountDisplay");
  });

  it("retains Money In categorisation attribution",() => {
    const income = prepareBankIncomeJournal(userId,"income-1",{
      bankTransactionId:"income-row",
      bankAccountId:"destination",
      date,
      payer:"Customer Ltd",
      gross:120,
      net:100,
      vat:20,
      incomeAccountCode:"4000",
      category:"sales"
    });

    expect(bankView([income]).rows[0]).toEqual(expect.objectContaining({
      bankAccountId:"destination",
      bankAccountDisplay:"Bank account: Test Current Account",
      debit:120
    }));
  });

  it("retains opening-balance attribution and resolves archived names",() => {
    const opening = prepareBankOpeningBalanceJournal(userId,"archived",{
      openingBalance:250,
      openingBalanceDate:date
    });

    expect(bankView([opening]).rows[0]).toEqual(expect.objectContaining({
      bankAccountId:"archived",
      bankAccountDisplay:"Bank account: Old Savings (Archived)"
    }));
  });

  it("displays exception Bank attribution but not its non-Bank counter-line",() => {
    const exception = prepareBankExceptionJournal(userId,"exception-1",{
      bankTransactionId:"exception-row",
      bankAccountId:"source",
      resolutionType:"ownerContribution",
      nominalAccountCode:"3000",
      direction:"moneyIn",
      amount:75,
      effectiveDate:date
    });
    const stored = storedJournal(exception);

    expect(generalLedgerViewFromJournals([stored],{
      accountCode:"1000",bankAccounts
    }).rows[0].bankAccountDisplay).toBe("Bank account: tetttt");
    expect(generalLedgerViewFromJournals([stored],{
      accountCode:"3000",bankAccounts
    }).rows[0]).not.toHaveProperty("bankAccountDisplay");
  });

  it("attributes Money Out settlement Bank only and leaves its accrual lines unlabelled",() => {
    const settlement = prepareBankSettlementJournal(userId,"expense-payment",{
      recordId:"expense-1",
      recordType:"expense",
      amount:60,
      transactionDate:date,
      bankAccountId:"source"
    });
    const accrual = prepareExpenseJournal(userId,"expense-1",{
      date,
      merchant:"Supplier",
      category:"General",
      net:50,
      vat:10,
      gross:60
    });
    const stored = [storedJournal(accrual),storedJournal(settlement)];

    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"1000",bankAccounts
    }).rows[0].bankAccountDisplay).toBe("Bank account: tetttt");
    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"5000",bankAccounts
    }).rows[0]).not.toHaveProperty("bankAccountDisplay");
    expect(generalLedgerViewFromJournals(stored,{
      accountCode:"2200",bankAccounts
    }).rows.every(row => !row.bankAccountDisplay)).toBe(true);
  });

  it("uses active names and falls back to a missing account's stable ID",() => {
    const known = prepareBankOpeningBalanceJournal(userId,"source",{
      openingBalance:10,openingBalanceDate:date
    });
    const missing = prepareBankOpeningBalanceJournal(userId,"missing-account",{
      openingBalance:20,openingBalanceDate:date
    });
    const displays = bankView([known,missing]).rows.map(row => row.bankAccountDisplay);

    expect(displays).toContain("Bank account: tetttt");
    expect(displays).toContain("Bank account: missing-account");
  });

  it("keeps transfer Trial Balance, Balance Sheet, P&L, and VAT outcomes unchanged",() => {
    const transfer = storedJournal(prepareBankTransferJournal(userId,"transfer-reports",{
      sourceBankAccountId:"source",
      destinationBankAccountId:"destination",
      amount:62.5,
      effectiveDate:date
    }));
    const trialBalance = buildTrialBalance([transfer]);
    const balanceSheet = buildBalanceSheetReport([transfer]);
    const profitLoss = buildProfitLossReport([transfer]);

    expect(trialBalance).toMatchObject({ balanced:true,totalDebits:0,totalCredits:0 });
    expect(trialBalance.accounts.find(row => row.accountCode === "1000"))
      .toMatchObject({ balance:0 });
    expect(balanceSheet).toMatchObject({ totalAssets:0 });
    expect(profitLoss).toMatchObject({ totalIncome:0,totalExpenses:0,netResult:0 });
    expect(transfer.lines.some(line => ["1200","2100"].includes(line.accountCode)))
      .toBe(false);
  });

  it("loads owned bank accounts and renders only supplied Bank sublines",() => {
    expect(generalLedgerHtml).toContain('collection(db,"users",ownerId,"bankAccounts")');
    expect(generalLedgerHtml).toContain("normaliseBankAccount(documentSnapshot.id,documentSnapshot.data())");
    expect(generalLedgerHtml).toContain("if(entry.bankAccountDisplay)");
    expect(generalLedgerHtml).toContain('bankAccount.className = "ledger-bank-account"');
    expect(generalLedgerHtml).not.toContain('id="bankAccountFilter"');
  });
});
