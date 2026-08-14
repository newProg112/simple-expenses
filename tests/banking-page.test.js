import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_ACCOUNT_STATUS,
  activeBankAccounts,
  normaliseBankAccount,
  validateBankAccountInput
} from "../resources/js/bank-account-view.js";
import { CSV_PREVIEW_LIMIT, formatFileSize, parseCsvPreview } from "../resources/js/csv-preview.js";
import {
  MAPPED_PREVIEW_LIMIT,
  normaliseStatementRows,
  parseMoneyValue,
  statementMappingData,
  suggestColumnMappings,
  validateColumnMappings
} from "../resources/js/bank-statement-mapping.js";
import {
  BANK_TRANSACTION_SOURCE,
  BANK_TRANSACTION_STATUS,
  bankTransactionDuplicateKey,
  createSingleFlightImport,
  newestBankTransactions,
  normaliseBankTransaction,
  persistBankTransactions,
  prepareBankTransactionRecords,
  readyMappedTransactions
} from "../resources/js/bank-transaction-import.js";
import {
  MATCH_CONFIDENCE_MINIMUM,
  buildMatchCandidates,
  scoreBankMatch,
  suggestBankMatches
} from "../resources/js/bank-match-suggestions.js";
import {
  BANK_MATCH_RECORD_COLLECTIONS,
  confirmBankMatch,
  unmatchBankTransaction
} from "../resources/js/bank-match-confirmation.js";
import { DEMO_MANAGED_USER_COLLECTIONS } from "../assets/demo-seed-engine.js";
import { DEMO_SEED } from "../assets/demo-seed.js";

const html = readFileSync(new URL("../resources/tools/banking.html", import.meta.url), "utf8");

describe("Banking Phase 2 account model", () => {
  it("requires account and bank names, a valid effective date, and defaults opening balance to zero", () => {
    expect(validateBankAccountInput({})).toEqual({
      valid:false,
      errors:{ accountName:"Enter an account name.", bankName:"Enter a bank name.", openingBalanceDate:"Enter a valid opening balance effective date." },
      value:{ accountName:"", bankName:"", openingBalance:0, openingBalanceDate:"" }
    });
    expect(validateBankAccountInput({ accountName:"  Business Current Account ", bankName:" Barclays ", openingBalance:"", openingBalanceDate:"2026-08-01" }))
      .toEqual({ valid:true, errors:{}, value:{ accountName:"Business Current Account", bankName:"Barclays", openingBalance:0, openingBalanceDate:"2026-08-01" } });
  });

  it("accepts negative currency balances, rounds safely, and rejects non-numeric values", () => {
    expect(validateBankAccountInput({ accountName:"Current", bankName:"Bank", openingBalance:"-123.456", openingBalanceDate:"2026-08-01" }).value.openingBalance).toBe(-123.46);
    expect(validateBankAccountInput({ accountName:"Current", bankName:"Bank", openingBalance:"not money", openingBalanceDate:"2026-08-01" }))
      .toMatchObject({ valid:false, errors:{ openingBalance:"Enter a valid opening balance." } });
  });

  it("normalises statuses and returns only active accounts in deterministic order", () => {
    const accounts = [
      normaliseBankAccount("older", { accountName:"Older", bankName:"Bank", openingBalance:10, status:"Active", createdAt:"2026-01-01" }),
      normaliseBankAccount("archived", { accountName:"Archived", bankName:"Bank", status:"Archived", createdAt:"2026-03-01" }),
      normaliseBankAccount("newer", { accountName:"Newer", bankName:"Bank", status:"unexpected", createdAt:"2026-02-01" })
    ];
    expect(accounts[1].status).toBe(BANK_ACCOUNT_STATUS.ARCHIVED);
    expect(accounts[2].status).toBe(BANK_ACCOUNT_STATUS.ACTIVE);
    expect(activeBankAccounts(accounts).map(account => account.id)).toEqual(["newer","older"]);
  });
});
describe("Banking Phase 2 page", () => {
  it("uses the authenticated shared application shell without subscription gating", () => {
    expect(html).toContain('<script type="module" src="/auth-guard.js"></script>');
    expect(html).toContain('<div data-app-navigation></div>');
    expect(html).toContain('class="app-content"');
    expect(html.match(/\/assets\/app-shell\.css/g)).toHaveLength(1);
    expect(html.match(/\/assets\/app-shell\.js/g)).toHaveLength(1);
    expect(html).not.toMatch(/plan-entitlements|financial-report-access|upgrade to pro|starterPreview/i);
  });

  it("retains Phase 1 KPIs and makes Banking counts dynamic", () => {
    expect(html).toContain('<div class="kpi-label">Bank accounts</div><div class="kpi-value" id="bankAccountCount">0</div>');
    expect(html).toContain('<div class="kpi-label">Transactions</div><div class="kpi-value" id="bankTransactionCount">0</div>');
    expect(html).toContain('<div class="kpi-label">Needs review</div><div class="kpi-value" id="bankNeedsReviewCount">0</div>');
    expect(html).toContain('<div class="kpi-label">Matched</div><div class="kpi-value" id="bankMatchedCount">0</div>');
    expect(html).toContain("elements.count.textContent = String(active.length)");
  });

  it("provides accessible create/edit and archive dialogs with the required fields", () => {
    expect(html).toContain('id="addAccountButton" type="button">+ Add account</button>');
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="accountModalTitle"');
    expect(html).toContain('role="alertdialog" aria-modal="true" aria-labelledby="archiveModalTitle"');
    expect(html).toContain('id="accountName" name="accountName" type="text" maxlength="160" required');
    expect(html).toContain('id="bankName" name="bankName" type="text" maxlength="160" required');
    expect(html).toContain('id="openingBalance" name="openingBalance" type="number" step="0.01" inputmode="decimal" value="0.00"');
    expect(html).toContain('id="openingBalanceDate" name="openingBalanceDate" type="date" required');
    expect(html).toContain('id="cancelAccountButton" type="button">Cancel</button>');
    expect(html).toContain('id="saveAccountButton" type="submit">Save</button>');
    expect(html).toContain('role="alert" hidden');
    expect(html).toContain('aria-invalid');
  });

  it("uses the authenticated user bankAccounts subcollection and archives without deletion", () => {
    expect(html).toContain('collection(db,"users",user.uid,"bankAccounts")');
    expect(html).toContain('collection(db,"users",currentUser.uid,"bankAccounts")');
    expect(html).toContain("createBankAccountWithOpeningBalance({");
    expect(html).toContain("updateBankAccountWithOpeningBalance({");
    expect(html).toContain('updateDoc(doc(db,"users",currentUser.uid,"bankAccounts",accountId),{ status:BANK_ACCOUNT_STATUS.ARCHIVED })');
    expect(html).not.toMatch(/deleteDoc|sortCode|accountNumber|openBankingConnection/i);
  });

  it("renders active account details and actions while hiding archived accounts", () => {
    expect(html).toContain('activeBankAccounts(accounts)');
    expect(html).toContain("No bank accounts yet.");
    for(const marker of ["account.accountName","account.bankName","account.openingBalance","account.status",'data-action="edit"','data-action="archive"']){
      expect(html).toContain(marker);
    }
  });

  it("keeps Demo accounts editable and resettable without fake banking seed data", () => {
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankAccounts");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankReconciliations");
    expect(DEMO_SEED).not.toHaveProperty("bankAccounts");
    expect(html).not.toMatch(/demoMode|isDemoMode|paidSubscription/);
  });

  it("remains responsive without horizontal fixed-width content", () => {
    expect(html).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(html).toMatch(/@media\(max-width:820px\)[\s\S]*?\.kpi-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.kpi-grid,\.form-grid,\.preview-meta,\.mapping-grid,\.mapped-summary\{grid-template-columns:1fr\}/);
    expect(html).toContain(".app-content{min-width:0}");
    expect(html).toContain(".card{min-width:0");
  });

  it("does not add Open Banking, full reconciliation, or financial-report UI", () => {
    expect(html).not.toMatch(/open banking|plaid|truelayer|automatic reconciliation|general ledger|trial balance|profit & loss|balance sheet/i);
  });

  it("keeps the inline module syntactically valid", () => {
    const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
    const withoutImports = source.replace(/^\s*import .*?;\s*$/gm, "");
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    expect(source).not.toBe("");
    expect(() => new AsyncFunction(withoutImports)).not.toThrow();
  });
});

describe("Banking Phase 3 CSV preview parser", () => {
  it("parses commas, quoted values, escaped quotes, empty cells, and CRLF rows", () => {
    const records = [
      ["Date","Description","Amount"],
      ["2026-08-01","Coffee, lunch","-12.50"],
      ["2026-08-02",'He said "thanks"',""]
    ];
    expect(parseCsvPreview('\uFEFFDate,Description,Amount\r\n2026-08-01,"Coffee, lunch",-12.50\r\n2026-08-02,"He said ""thanks""",\r\n')).toEqual({
      rowCount:3,
      columnCount:3,
      rows:records,
      records
    });
  });

  it("ignores trailing blank lines, preserves embedded newlines, and limits the preview only", () => {
    const rows = Array.from({ length:25 }, (_, index) => `${index},"line ${index}\ncontinued"`).join("\n") + "\n\n";
    const preview = parseCsvPreview(rows);
    expect(preview.rowCount).toBe(25);
    expect(preview.columnCount).toBe(2);
    expect(preview.rows).toHaveLength(CSV_PREVIEW_LIMIT);
    expect(preview.rows[0][1]).toBe("line 0\ncontinued");
  });

  it("reports malformed or empty CSV content without returning a partial preview", () => {
    expect(() => parseCsvPreview('Date,"Unclosed')).toThrow(/unclosed quoted value/i);
    expect(() => parseCsvPreview("\r\n\n")).toThrow(/does not contain any rows/i);
  });

  it("formats common file sizes for preview metadata", () => {
    expect(formatFileSize(850)).toBe("850 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("Banking Phase 3 statement preview page", () => {
  it("offers only CSV selection after active accounts load and keeps files local", () => {
    expect(html).toContain('id="statementFileInput" type="file" accept=".csv,text/csv" hidden');
    expect(html).toContain('elements.fileInput.click()');
    expect(html).toContain('activeBankAccounts(accounts).length');
    expect(html).toContain("Please create a bank account before importing a statement.");
    expect(html).toContain("await file.text()");
    expect(html).not.toMatch(/uploadBytes|storageRef|FileReader\([^)]*readAsDataURL/);
  });

  it("renders raw preview metadata, at most 20 rows, a notice, and a disabled next-step button", () => {
    for(const label of ["Filename","File size","Rows detected","Columns detected"]){
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(html).toContain('id="previewTableBody"');
    expect(html).toContain("preview.rows.forEach");
    expect(html).toContain("cell.textContent = row[columnIndex]");
    expect(html).toContain("Column mapping will be completed in the next step before any transactions are imported.");
    expect(html).toContain('id="continueMappingButton" type="button" disabled>Continue to column mapping</button>');
  });

  it("keeps the raw table responsive and displays parsing failures without crashing", () => {
    expect(html).toContain(".preview-table-wrap{width:100%;overflow-x:auto");
    expect(html).toContain('aria-label="CSV statement preview table, horizontally scrollable"');
    expect(html).toContain("This CSV could not be previewed. Check the file formatting and try again.");
    expect(html).toContain('id="importFeedback" role="alert" hidden');
  });
});

describe("Banking Phase 4 mapping and normalisation", () => {
  it("uses the first CSV record as headers and all remaining records as transaction data", () => {
    const parsed = parseCsvPreview("Date,Details,Credit\n01/08/26,Sale,100\n02/08/26,Refund,25");
    expect(statementMappingData(parsed)).toEqual({
      headers:["Date","Details","Credit"],
      rows:[["01/08/26","Sale","100"],["02/08/26","Refund","25"]]
    });
  });

  it("auto-maps common headings case-insensitively after trimming whitespace", () => {
    expect(suggestColumnMappings([" BOOKING DATE ","merchant"," PAID IN","Withdrawals","Account Balance"])).toEqual({
      transactionDate:0,
      description:1,
      moneyIn:2,
      moneyOut:3,
      balance:4
    });
  });

  it("leaves unknown or ambiguous headings unselected", () => {
    expect(suggestColumnMappings(["When","Memo text","Amount"])).toEqual({
      transactionDate:null,
      description:null,
      moneyIn:null,
      moneyOut:null,
      balance:null
    });
    expect(suggestColumnMappings(["Date","Posting Date","Description","Credit"])).toMatchObject({ transactionDate:null });
  });

  it("requires date, description, and at least one separate amount column", () => {
    expect(validateColumnMappings({},5)).toMatchObject({
      valid:false,
      errors:{
        transactionDate:"Select the transaction date column.",
        description:"Select the description column.",
        amount:"Select at least one Money in or Money out column."
      }
    });
    expect(validateColumnMappings({ transactionDate:0,description:1,moneyIn:2 },5).valid).toBe(true);
    expect(validateColumnMappings({ transactionDate:0,description:1,moneyOut:3 },5).valid).toBe(true);
  });

  it("rejects assigning one CSV column to incompatible banking fields", () => {
    const result = validateColumnMappings({ transactionDate:0,description:0,moneyIn:2 },3);
    expect(result.valid).toBe(false);
    expect(result.errors.transactionDate).toMatch(/different CSV column/i);
    expect(result.errors.description).toMatch(/different CSV column/i);
  });

  it("parses supported currency formats and preserves empty values as null", () => {
    for(const [source,value] of [["850",850],["850.00",850],["1,250.00",1250],["£850.00",850],[" £1,250.00 ",1250],["-62.50",-62.5]]){
      expect(parseMoneyValue(source)).toEqual({ value,error:null });
    }
    expect(parseMoneyValue("")).toEqual({ value:null,error:null });
    expect(parseMoneyValue("   ")).toEqual({ value:null,error:null });
  });

  it("flags malformed monetary values instead of coercing them", () => {
    expect(parseMoneyValue("12.3.4")).toEqual({ value:null,error:"Invalid monetary value" });
    expect(parseMoneyValue("1,25.00")).toEqual({ value:null,error:"Invalid monetary value" });
    expect(parseMoneyValue("1 250.00")).toEqual({ value:null,error:"Invalid monetary value" });
    expect(parseMoneyValue("free")).toEqual({ value:null,error:"Invalid monetary value" });
  });

  it("marks valid rows Ready while preserving raw dates without interpretation", () => {
    const result = normaliseStatementRows([["07/08/26","Customer payment","£1,250.00","","9000"]],{
      transactionDate:0,description:1,moneyIn:2,moneyOut:3,balance:4
    });
    expect(result).toMatchObject({ transactionCount:1,readyCount:1,attentionCount:0 });
    expect(result.rows[0]).toEqual({
      transactionDate:"07/08/26",
      description:"Customer payment",
      moneyIn:1250,
      moneyOut:null,
      balance:9000,
      status:"Ready",
      errors:[]
    });
  });

  it("marks missing required data and malformed money as Needs attention", () => {
    const result = normaliseStatementRows([["","","bad",""]],{
      transactionDate:0,description:1,moneyIn:2,moneyOut:3,balance:null
    });
    expect(result).toMatchObject({ transactionCount:1,readyCount:0,attentionCount:1 });
    expect(result.rows[0].status).toBe("Needs attention");
    expect(result.rows[0].errors).toEqual(["Missing date","Missing description","Invalid money in"]);
  });

  it("counts every transaction while limiting only the mapped DOM preview data", () => {
    const rows = Array.from({ length:25 },(_,index) => [String(index),`Row ${index}`,"1"]);
    const result = normaliseStatementRows(rows,{ transactionDate:0,description:1,moneyIn:2,moneyOut:null,balance:null });
    expect(result.transactionCount).toBe(25);
    expect(result.readyCount).toBe(25);
    expect(result.rows).toHaveLength(MAPPED_PREVIEW_LIMIT);
  });
});

describe("Banking Phase 4 mapping page", () => {
  it("enables mapping after parsing and displays the chosen active bank account", () => {
    expect(html).toContain('id="columnMapping" aria-labelledby="columnMappingTitle" hidden');
    expect(html).toContain("elements.continueMapping.disabled = false");
    expect(html).toContain('for="mappingBankAccount">Importing into:</label>');
    expect(html).toContain("elements.mappingBankName.textContent = selected?.bankName");
  });

  it("provides all five mapping controls and the mapped preview summary/table", () => {
    for(const field of ["transactionDate","description","moneyIn","moneyOut","balance"]){
      expect(html).toContain(`data-mapping-field="${field}"`);
    }
    for(const label of ["Transactions detected","Ready","Needs attention"]){
      expect(html).toContain(`<span>${label}</span>`);
    }
    expect(html).toContain("normaliseStatementRows(currentMappingData.rows,validation.value)");
    expect(html).toContain('aria-label="Mapped transaction preview table, horizontally scrollable"');
  });

  it("keeps import disabled until a mapped preview contains Ready rows", () => {
    expect(html).toContain('id="importTransactionsButton" type="button" disabled>Import transactions</button>');
    expect(html).toContain("elements.importTransactions.disabled = result.readyCount === 0");
    expect(html).toContain("Only transactions marked Ready will be imported.");
  });

  it("clears stale mapping and mapped preview state when a different file is selected", () => {
    expect(html).toMatch(/async function previewStatementFile[\s\S]*?clearStatementData\(\)/);
    expect(html).toMatch(/function clearStatementData[\s\S]*?currentMappingData = null[\s\S]*?clearMappedPreview\(\)/);
    expect(html).toContain('id="backToStatementButton" type="button">Back to statement preview</button>');
  });

  it("stacks controls and actions on mobile without losing horizontal table scrolling", () => {
    expect(html).toContain(".mapping-grid,.mapped-summary{grid-template-columns:1fr}");
    expect(html).toContain(".mapping-actions{flex-direction:column-reverse}");
    expect(html).toContain(".preview-table-wrap{width:100%;overflow-x:auto");
  });
});

describe("Banking Phase 5 transaction import model", () => {
  const timestamp = Object.freeze({ serverTimestamp:true });
  const ready = Object.freeze({
    transactionDate:"07/08/26",
    description:"Customer payment",
    moneyIn:1250,
    moneyOut:null,
    balance:9000,
    status:"Ready",
    errors:[]
  });
  const attention = Object.freeze({
    transactionDate:"",
    description:"Incomplete",
    moneyIn:null,
    moneyOut:null,
    balance:null,
    status:"Needs attention",
    errors:["Missing date","Missing amount"]
  });
  const mappedResult = Object.freeze({ allRows:Object.freeze([ready,attention]),readyCount:1,attentionCount:1 });

  function memoryFirestore(){
    const documents = new Map();
    documents.set("users/user-1/bankAccounts/account-1",{ accountName:"Current",status:"Active" });
    const commits = [];
    const services = {
      collection:vi.fn((_db,...parts) => ({ path:parts.join("/") })),
      doc:vi.fn((parent,id) => ({ path:`${parent.path}/${id}` })),
      where:vi.fn((field,operator,value) => ({ field,operator,value })),
      query:vi.fn((reference,constraint) => ({ reference,constraint })),
      getDocs:vi.fn(async request => ({
        docs:[...documents.entries()]
          .filter(([path,data]) => path.startsWith(`${request.reference.path}/`) && data[request.constraint.field] === request.constraint.value)
          .map(([path,data]) => ({ id:path.split("/").at(-1),data:() => data }))
      })),
      writeBatch:vi.fn(() => {
        const pending = [];
        return {
          set:(reference,data) => pending.push({ reference,data }),
          update:(reference,data) => pending.push({ reference,data,merge:true }),
          commit:async () => {
            pending.forEach(({ reference,data,merge }) => documents.set(reference.path,
              merge ? { ...documents.get(reference.path),...data } : data));
            commits.push(pending.length);
          }
        };
      })
    };
    return { services,documents,commits };
  }

  it("selects Ready rows and never includes Needs attention rows", () => {
    expect(readyMappedTransactions(mappedResult)).toEqual([ready]);
    expect(readyMappedTransactions({ allRows:[attention] })).toEqual([]);
  });

  it("creates only the required initial CSV transaction fields", () => {
    expect(prepareBankTransactionRecords(mappedResult,{
      bankAccountId:"account-1",importId:"import-1",timestamp
    })).toEqual([{
      bankAccountId:"account-1",
      transactionDate:"07/08/26",
      description:"Customer payment",
      moneyIn:1250,
      moneyOut:null,
      balance:9000,
      status:BANK_TRANSACTION_STATUS.UNMATCHED,
      source:BANK_TRANSACTION_SOURCE.CSV,
      importId:"import-1",
      createdAt:timestamp,
      updatedAt:timestamp
    }]);
  });

  it("requires all six banking values to match before treating a row as duplicate", () => {
    const base = { bankAccountId:"a",transactionDate:"07/08/26",description:"Sale",moneyIn:10,moneyOut:null,balance:50 };
    for(const [field,value] of [["bankAccountId","b"],["transactionDate","06/08/26"],["description","Refund"],["moneyIn",11],["moneyOut",2],["balance",51]]){
      expect(bankTransactionDuplicateKey({ ...base,[field]:value })).not.toBe(bankTransactionDuplicateKey(base));
    }
  });

  it("writes Ready rows successfully to the authenticated user collection", async () => {
    const { services,documents,commits } = memoryFirestore();
    await expect(persistBankTransactions({
      db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult,importId:"import-1",timestamp
    })).resolves.toEqual({ importedCount:1,skippedDuplicateCount:0,committedBatches:1 });
    expect(services.collection).toHaveBeenCalledWith({},"users","user-1","bankTransactions");
    expect(documents.size).toBe(2);
    const transaction = [...documents.entries()].find(([path]) => path.includes("/bankTransactions/"));
    expect(transaction[0]).toMatch(/^users\/user-1\/bankTransactions\/csv-[0-9a-f]{64}$/);
    expect(transaction[1].status).toBe("unmatched");
    expect(documents.get("users/user-1/bankAccounts/account-1").bankingActivity).toEqual({ version:1,type:"importedTransaction" });
    expect(commits).toEqual([2]);
  });

  it("imports a CSV once and writes zero documents when the same CSV is imported again", async () => {
    const { services,documents } = memoryFirestore();
    const options = { db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult,timestamp };
    await expect(persistBankTransactions({ ...options,importId:"first" }))
      .resolves.toEqual({ importedCount:1,skippedDuplicateCount:0,committedBatches:1 });
    await expect(persistBankTransactions({ ...options,importId:"second" }))
      .resolves.toEqual({ importedCount:0,skippedDuplicateCount:1,committedBatches:0 });
    expect(documents.size).toBe(2);
    expect(services.writeBatch).toHaveBeenCalledOnce();
  });

  it("imports only new rows from a mixed statement", async () => {
    const { services,documents } = memoryFirestore();
    await persistBankTransactions({ db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult,importId:"first",timestamp });
    const newReady = Object.freeze({ ...ready,transactionDate:"08/08/26",description:"New payment" });
    const mixedResult = Object.freeze({ allRows:Object.freeze([ready,newReady,attention]),readyCount:2,attentionCount:1 });
    await expect(persistBankTransactions({ db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult:mixedResult,importId:"mixed",timestamp }))
      .resolves.toEqual({ importedCount:1,skippedDuplicateCount:1,committedBatches:1 });
    expect(documents.size).toBe(3);
  });

  it("uses a single-flight guard to prevent double-click writes", async () => {
    let finish;
    const execute = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const guarded = createSingleFlightImport(execute);
    const first = guarded("first");
    const second = guarded("second");
    expect(second).toBe(first);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("first");
    finish({ importedCount:1 });
    await expect(first).resolves.toEqual({ importedCount:1 });
  });

  it("normalises legacy persisted rows as Unmatched and orders newest transaction date first", () => {
    const older = normaliseBankTransaction("older",{ transactionDate:"01/08/26",description:"Older",createdAt:"2026-08-03" });
    const newer = normaliseBankTransaction("newer",{ transactionDate:"02/08/26",description:"Newer",createdAt:"2026-08-01" });
    expect(older.status).toBe(BANK_TRANSACTION_STATUS.UNMATCHED);
    expect(newestBankTransactions([older,newer]).map(row => row.id)).toEqual(["newer","older"]);
  });

  it("sorts UK DD/MM/YY transaction dates in descending calendar order", () => {
    const transactions = ["05/08/26","07/08/26","04/08/26","06/08/26"]
      .map((transactionDate,index) => normaliseBankTransaction(String(index),{ transactionDate,description:transactionDate }));
    expect(newestBankTransactions(transactions).map(row => row.transactionDate))
      .toEqual(["07/08/26","06/08/26","05/08/26","04/08/26"]);
  });
});

describe("Banking Phase 5 import page", () => {
  it("confirms the Ready count and disables controls while importing", () => {
    expect(html).toContain('role="alertdialog" aria-modal="true" aria-labelledby="importModalTitle"');
    expect(html).toContain('id="confirmedImportCount">0</strong> validated transactions?');
    expect(html).toContain("elements.confirmImport.disabled = loading");
    expect(html).toContain("elements.importTransactions.disabled = loading || !readyMappedTransactions(mappedResult).length");
    expect(html).toContain("const runTransactionImport = createSingleFlightImport(importReadyTransactions)");
  });

  it("loads and writes the authenticated bankTransactions subcollection", () => {
    expect(html).toContain('collection(db,"users",user.uid,"bankTransactions")');
    expect(html).toContain("persistBankTransactions({");
    expect(html).toContain("services:{ collection,doc,getDocs,query,where,writeBatch }");
    expect(html).toContain("serverTimestamp()");
  });

  it("updates transaction KPIs and renders a responsive newest-first list", () => {
    expect(html).toContain("newestBankTransactions(transactions)");
    expect(html).toContain("elements.transactionCount.textContent = String(ordered.length)");
    expect(html).toContain("elements.needsReviewCount.textContent = String(ordered.filter(transaction => transaction.status === BANK_TRANSACTION_STATUS.UNMATCHED).length)");
    expect(html).toContain("elements.matchedCount.textContent = String(ordered.filter(transaction => transaction.status === BANK_TRANSACTION_STATUS.MATCHED).length)");
    expect(html).toContain('id="transactionList" tabindex="0" aria-label="Imported bank transactions table, horizontally scrollable"');
    expect(html).toContain('badge.textContent = exceptionResolved ? (exceptionDefinition?.label || "Other resolved") : transferred ? "Bank transfer" : categorised ? "Categorised" : matched ? "Matched" : "Unmatched"');
    expect(html).not.toMatch(/deleteBankTransaction|editBankTransaction/);
  });

  it("clears temporary CSV state only after successful import", () => {
    expect(html).toMatch(/await persistBankTransactions\([\s\S]*?resetStatementPreview\(\)[\s\S]*?Skipped duplicates/);
    expect(html).toMatch(/function resetStatementPreview[\s\S]*?elements\.fileInput\.value = ""[\s\S]*?clearStatementData\(\)/);
  });

  it("reports imported and skipped duplicate counts, including the all-duplicate case", () => {
    expect(html).toContain("`Imported: ${result.importedCount}. Skipped duplicates: ${result.skippedDuplicateCount}.`");
    expect(html).toContain("No new transactions were imported. Everything in this statement already exists.");
  });

  it("includes imported bank transactions in canonical Demo reset storage", () => {
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankTransactions");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankIncome");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankTransfers");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankTransferLinks");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankExceptionResolutions");
    expect(DEMO_SEED).not.toHaveProperty("bankTransactions");
    expect(DEMO_SEED).not.toHaveProperty("bankIncome");
    expect(DEMO_SEED).not.toHaveProperty("bankExceptionResolutions");
  });

  it("does not add matching, accounting, Open Banking, or subscription behavior", () => {
    expect(html).not.toMatch(/matchInvoice|matchBill|matchExpense|createJournal|ledgerEntry|plaid|truelayer|plan-entitlements|starterPreview/);
  });
});

describe("Banking internal transfer page",() => {
  it("offers explicit account selection and user-confirmed statement pairing",() => {
    for(const marker of [
      'id="transferOtherAccount"','id="transferPairing"',
      'transfer.dataset.matchAction = "transfer"',
      'bankTransferCandidates({ transaction,otherBankAccountId,transactions,transfers:bankTransfers })',
      'getDocs(collection(db,"users",user.uid,"bankTransfers"))'
    ]) expect(html).toContain(marker);
    expect(html).toContain("Archived accounts are shown only so historical transfers can remain correctly attributed.");
  });

  it("dispatches posting, later-side linking, and Untransfer through atomic helpers",() => {
    expect(html).toContain("await transferBankTransaction({");
    expect(html).toContain("existingTransferId:pairingId");
    expect(html).toContain("oppositeTransactionId:pairingId");
    expect(html).toContain("await untransferBankTransaction({");
    expect(html).toContain('button.dataset.matchAction === "untransfer"');
    expect(html).toContain("No second journal was posted.");
  });
});

describe("Banking exception resolution page",() => {
  it("offers direction-specific Other / Resolve choices with plain-English explanations",() => {
    for(const marker of [
      'id="exceptionType"','id="exceptionExplanation"','id="exceptionReason"',
      'resolve.textContent = "Other / Resolve"',
      'bankExceptionOptions(eligibility.direction)',
      'getDocs(collection(db,"users",user.uid,"bankExceptionResolutions"))'
    ]) expect(html).toContain(marker);
    expect(html).toContain("BANK_EXCEPTION_TYPES.find(item => item.value === elements.exceptionType.value)");
    expect(html).toContain("definition?.explanation");
  });

  it("dispatches only to atomic Resolve and Unresolve helpers",() => {
    expect(html).toContain("await resolveBankException({");
    expect(html).toContain("await unresolveBankException({");
    expect(html).toContain('button.dataset.matchAction === "unresolve"');
    expect(html).toContain("Statement row marked reviewed with no accounting journal.");
  });
});

describe("Banking Phase 7A matching suggestions", () => {
  const incoming = Object.freeze({
    id:"bank-in",
    transactionDate:"07/08/26",
    description:"Payment from ACME LTD",
    moneyIn:850,
    moneyOut:null,
    status:"unmatched"
  });
  const invoice = Object.freeze({
    id:"invoice-1",
    invoiceNo:"INV-1023",
    client:"ACME LTD",
    date:"07/08/2026",
    total:850,
    status:"Unpaid"
  });

  it("creates a 100% exact amount, date, and customer-name match", () => {
    const [suggestion] = suggestBankMatches([incoming],{ invoices:[invoice] });
    expect(suggestion).toMatchObject({
      confidence:100,
      candidate:{ documentType:"Invoice",label:"INV-1023" },
      reasons:["Amount matches","Date matches","Customer name found"]
    });
  });

  it("does not suggest an amount-only match outside the seven-day window", () => {
    const candidates = buildMatchCandidates({ invoices:[{ ...invoice,date:"20/08/2026" }] });
    expect(scoreBankMatch(incoming,candidates[0])).toEqual({ confidence:0,reasons:["Amount matches"] });
    expect(suggestBankMatches([incoming],{ invoices:[{ ...invoice,date:"20/08/2026" }] })).toEqual([]);
  });

  it("does not suggest a date-only match when the amount differs", () => {
    expect(suggestBankMatches([incoming],{ invoices:[{ ...invoice,total:851 }] })).toEqual([]);
  });

  it("returns no match for paid documents, invalid dates, or non-Unmatched transactions", () => {
    expect(suggestBankMatches([incoming],{ invoices:[{ ...invoice,status:"Paid" }] })).toEqual([]);
    expect(suggestBankMatches([incoming],{ invoices:[{ ...invoice,date:"ambiguous" }] })).toEqual([]);
    expect(suggestBankMatches([{ ...incoming,status:"matched" }],{ invoices:[invoice] })).toEqual([]);
  });

  it("returns every qualifying candidate when multiple documents could match", () => {
    const suggestions = suggestBankMatches([incoming],{
      invoices:[invoice,{ ...invoice,id:"invoice-2",invoiceNo:"INV-1024",client:"Other customer",date:"09/08/2026" }]
    });
    expect(suggestions.map(suggestion => [suggestion.candidate.label,suggestion.confidence]))
      .toEqual([["INV-1023",100],["INV-1024",90]]);
  });

  it("calculates 90% within three days and 75% within seven days", () => {
    const candidates = buildMatchCandidates({
      invoices:[
        { id:"invoice-3",invoiceNo:"I-3",client:"Customer",date:"2026-08-10",total:62.5,status:"Unpaid" },
        { id:"invoice-7",invoiceNo:"I-7",client:"Customer",date:"2026-08-14",total:62.5,status:"Unpaid" }
      ]
    });
    const incomingPayment = { transactionDate:"07/08/26",description:"Bank receipt",moneyIn:62.5,moneyOut:null,status:"unmatched" };
    expect(scoreBankMatch(incomingPayment,candidates[0]).confidence).toBe(90);
    expect(scoreBankMatch(incomingPayment,candidates[1]).confidence).toBe(MATCH_CONFIDENCE_MINIMUM);
  });

  it("supports expenses and mileage claims as outgoing candidates", () => {
    const suggestions = suggestBankMatches([
      { transactionDate:"07/08/26",description:"Paper Shop",moneyOut:24,status:"unmatched" },
      { transactionDate:"08/08/26",description:"Mileage",moneyOut:44,status:"unmatched" }
    ],{
      expenses:[
        { id:"expense-1",type:"expense",date:"2026-08-07",merchant:"Paper Shop",gross:24 },
        { id:"mileage-1",type:"mileage",date:"2026-08-08",businessPurpose:"Client visit",amount:44 }
      ]
    });
    expect(suggestions.map(suggestion => suggestion.candidate.documentType)).toEqual(["Expense","Mileage claim"]);
  });
});

describe("Banking Phase 7A suggestions page", () => {
  it("loads existing documents and renders read-only suggestion details", () => {
    expect(html).toContain('<h2 id="suggestedMatchesTitle">Suggested matches</h2>');
    for(const collectionName of ["invoices","bills","expenses"]){
      expect(html).toContain(`getDocs(collection(db,"users",user.uid,"${collectionName}"))`);
    }
    expect(html).toContain("suggestBankMatches(transactions,matchSources)");
    expect(html).toContain('transactionLabel.textContent = "Bank transaction"');
    expect(html).toContain('documentLabel.textContent = "Suggested document"');
    expect(html).toContain('confidence.textContent = `Confidence ${suggestion.confidence}%`');
    expect(html).toContain("suggestion.reasons.forEach");
  });

  it("adds explicit settlement-aware Confirm match and reversible Unmatch actions", () => {
    expect(html).toContain('confirm.textContent = confirm.disabled ? "Confirming..." : "Confirm match"');
    expect(html).toContain('(exceptionResolved ? "Unresolve" : transferred ? "Untransfer" : categorised ? "Uncategorise" : "Unmatch")');
    expect(html).toContain('services:{ doc,runTransaction,serverTimestamp }');
    expect(html).toContain('services:{ doc,runTransaction,serverTimestamp,deleteField }');
    expect(html).toContain("The source record was marked Paid and its settlement journal was posted.");
    expect(html).toContain("The Banking settlement was reversed and the source record was restored.");
    expect(html).toContain("bankMatchDiagnostic:error?.bankMatchDiagnostic || null");
    expect(html).not.toMatch(/createJournal|replaceJournal|saveJournal|updateInvoiceStatus|markBillPaid|markExpensePaid/);
  });

  it("keeps suggestion cards usable on mobile", () => {
    expect(html).toContain(".suggestion-record{grid-template-columns:1fr auto}");
    expect(html).toContain(".suggestion-reasons,.suggestion-action{grid-column:1/-1}");
  });
});

describe("Banking Confirm Match settlement model", () => {
  const timestamp = Object.freeze({ serverTimestamp:true });
  const transactionPath = "users/user-1/bankTransactions/bank-1";
  const invoicePath = "users/user-1/invoices/invoice-1";
  const invoiceJournalPath = "journals/invoice_user-1_invoice-1";
  const settlementJournalPath = "journals/bank-settlement_user-1_bank-1";
  const baseTransaction = Object.freeze({
    transactionDate:"07/08/26",description:"Payment from ACME LTD",moneyIn:850,moneyOut:null,status:"unmatched"
  });
  const baseInvoice = Object.freeze({
    invoiceNo:"INV-1023",client:"ACME LTD",date:"07/08/2026",total:850,status:"Unpaid"
  });

  function transactionFirestore(overrides = {}){
    const removed = Symbol("deleteField");
    const documents = new Map([
      [transactionPath,{ ...baseTransaction,...(overrides.transaction || {}) }],
      [invoicePath,{ ...baseInvoice,...(overrides.invoice || {}) }],
      [invoiceJournalPath,{
        userId:"user-1",journalId:"invoice_user-1_invoice-1",date:"2026-08-07",
        sourceType:"salesInvoice",sourceId:"invoice-1",lines:[
          { accountCode:"1100",description:"Invoice",debit:850,credit:0 },
          { accountCode:"4000",description:"Invoice",debit:0,credit:850 }
        ]
      }]
    ]);
    if(overrides.missingTransaction) documents.delete(transactionPath);
    if(overrides.missingInvoice) documents.delete(invoicePath);
    const writes = [];
    const services = {
      doc:vi.fn((_db,...parts) => ({ path:parts.join("/") })),
      serverTimestamp:vi.fn(() => timestamp),
      deleteField:vi.fn(() => removed),
      runTransaction:vi.fn(async (_db,execute) => execute({
        get:async reference => ({ exists:() => documents.has(reference.path),data:() => documents.get(reference.path) }),
        update:(reference,update) => {
          writes.push({ path:reference.path,update });
          const next = { ...(documents.get(reference.path) || {}) };
          Object.entries(update).forEach(([key,value]) => value === removed ? delete next[key] : next[key] = value);
          documents.set(reference.path,next);
        },
        set:(reference,data) => {
          writes.push({ path:reference.path,set:data });
          documents.set(reference.path,{ ...data });
        },
        delete:reference => {
          writes.push({ path:reference.path,delete:true });
          documents.delete(reference.path);
        }
      }))
    };
    return { documents,writes,services };
  }

  function confirmOptions(fixture,overrides = {}){
    return {
      db:{},userId:"user-1",transactionId:"bank-1",matchedRecordType:"invoice",matchedRecordId:"invoice-1",
      services:fixture.services,...overrides
    };
  }

  it("preserves valid matched state across normalisation and safely rejects incomplete or arbitrary states", () => {
    const matched = normaliseBankTransaction("bank-1",{
      ...baseTransaction,status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",
      matchedAt:timestamp,matchedAmount:850
    });
    expect(matched).toMatchObject({ status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",matchedAt:timestamp,matchedAmount:850 });
    expect(normaliseBankTransaction("categorised",{
      ...baseTransaction,status:"matched",matchedRecordType:"expense",matchedRecordId:"bank-expense_bank-1",
      matchedAmount:850,matchOrigin:"categorisation",categorisationVersion:1
    })).toMatchObject({ status:"matched",matchOrigin:"categorisation",categorisationVersion:1 });
    expect(normaliseBankTransaction("legacy",baseTransaction).status).toBe("unmatched");
    expect(normaliseBankTransaction("bad",{ ...baseTransaction,status:"reconciled",matchedRecordId:"x" })).not.toHaveProperty("matchedRecordId");
    expect(normaliseBankTransaction("incomplete",{ ...baseTransaction,status:"matched",matchedRecordType:"invoice" }).status).toBe("unmatched");
  });

  it("uses only the three canonical record types and maps mileage to expense", () => {
    expect(BANK_MATCH_RECORD_COLLECTIONS).toEqual({ invoice:"invoices",bill:"bills",expense:"expenses" });
    const candidates = buildMatchCandidates({
      invoices:[{ id:"i",date:"2026-08-07",total:1 }],
      bills:[{ id:"b",date:"2026-08-07",total:1 }],
      expenses:[{ id:"m",type:"mileage",date:"2026-08-07",amount:1 }]
    });
    expect(candidates.map(candidate => candidate.recordType)).toEqual(["invoice","bill","expense"]);
  });

  it("excludes paid invoices, bills, expenses, and mileage claims", () => {
    expect(buildMatchCandidates({
      invoices:[{ id:"i",status:"Paid",total:1 }],
      bills:[{ id:"b",status:"Paid",total:1 }],
      expenses:[{ id:"e",status:"Paid",gross:1 },{ id:"m",type:"mileage",status:"Paid",amount:1 }]
    })).toEqual([]);
  });

  it("confirms a fresh valid match by settling the source and posting one settlement journal", async () => {
    const fixture = transactionFirestore();
    await expect(confirmBankMatch(confirmOptions(fixture))).resolves.toMatchObject({
      status:"confirmed",transactionId:"bank-1",matchedRecordType:"invoice",matchedRecordId:"invoice-1",
      matchedAmount:850,settled:true,settlementJournalId:"bank-settlement_user-1_bank-1"
    });
    expect(fixture.documents.get(invoicePath)).toMatchObject({ status:"Paid",bankSettlement:{ transactionId:"bank-1" } });
    expect(fixture.documents.get(settlementJournalPath)).toMatchObject({
      sourceType:"bankSettlement",sourceId:"bank-1",matchedRecordType:"invoice",matchedRecordId:"invoice-1"
    });
    expect(fixture.writes).toHaveLength(3);
    expect(fixture.services.doc).toHaveBeenCalledWith({},"users","user-1","invoices","invoice-1");
  });

  it.each([
    ["stale amount",{ invoice:{ total:851 } }],
    ["wrong direction",{ transaction:{ moneyIn:null,moneyOut:850 } }],
    ["stale date",{ invoice:{ date:"20/08/2026" } }],
    ["target now Paid",{ invoice:{ status:"Paid" } }],
    ["missing target",{ missingInvoice:true }],
    ["missing bank transaction",{ missingTransaction:true }]
  ])("rejects %s without writing",async (_label,fixtureOptions) => {
    const fixture = transactionFirestore(fixtureOptions);
    await expect(confirmBankMatch(confirmOptions(fixture))).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  it("treats the same confirmed relationship as idempotent", async () => {
    const fixture = transactionFirestore({ transaction:{
      status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",matchedAmount:850
    } });
    await expect(confirmBankMatch(confirmOptions(fixture))).resolves.toMatchObject({ status:"already-confirmed" });
    expect(fixture.writes).toEqual([]);
  });

  it("rejects competing and invalid persisted match states", async () => {
    const competing = transactionFirestore({ transaction:{ status:"matched",matchedRecordType:"bill",matchedRecordId:"bill-2",matchedAmount:850 } });
    await expect(confirmBankMatch(confirmOptions(competing))).rejects.toThrow(/different record/i);
    expect(competing.writes).toEqual([]);
    const invalid = transactionFirestore({ transaction:{ status:"reconciled" } });
    await expect(confirmBankMatch(confirmOptions(invalid))).rejects.toThrow(/invalid match state/i);
    expect(invalid.writes).toEqual([]);
  });

  it("unmatches transactionally and clears every match field without touching the target", async () => {
    const fixture = transactionFirestore({ transaction:{
      status:"matched",matchedRecordType:"invoice",matchedRecordId:"invoice-1",matchedAt:"then",matchedAmount:850
    } });
    await expect(unmatchBankTransaction({
      db:{},userId:"user-1",transactionId:"bank-1",services:fixture.services
    })).resolves.toEqual({ status:"unmatched",transactionId:"bank-1",settlementReversed:false });
    expect(fixture.documents.get(transactionPath)).toEqual({ ...baseTransaction,status:"unmatched",updatedAt:timestamp });
    expect(fixture.documents.get(invoicePath)).toEqual(baseInvoice);
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0].path).toBe(transactionPath);
  });

  it("renders confirmed, missing-target, amount-change, duplicate-target, and reversible states", () => {
    for(const marker of [
      'badge.textContent = exceptionResolved ? (exceptionDefinition?.label || "Other resolved") : transferred ? "Bank transfer" : categorised ? "Categorised" : matched ? "Matched" : "Unmatched"',
      '"Matched record no longer available"',
      '" — amount has changed"',
      '"Another bank transaction is already matched to this record."',
      '" — settled"',
      'unmatch.dataset.matchAction = exceptionResolved ? "unresolve" : transferred ? "untransfer" : categorised ? "uncategorise" : "unmatch"'
    ]) expect(html).toContain(marker);
  });
});

describe("Banking Money Out and Money In categorisation page",() => {
  it("shows Categorise only through the strict direction-specific eligibility helpers",() => {
    expect(html).toContain("moneyOutCategorisationEligibility(transaction).eligible");
    expect(html).toContain("moneyInCategorisationEligibility(transaction).eligible");
    expect(html).toContain('categorise.dataset.matchAction = "categorise"');
    expect(html).toContain('categorise.dataset.categorisationType = categorisationType');
    expect(html).toContain('categorise.textContent = categorise.disabled ? "Categorising..." : "Categorise"');
  });

  it("renders the fixed date/gross and controlled Expense fields",() => {
    for(const marker of [
      'id="categorisationDate"','id="categorisationGross"','id="categorisationMerchant"',
      'id="categorisationCategory"','id="categorisationDescription"','id="categorisationVatTreatment"',
      '<option value="none">No VAT</option>','<option value="included-20">20% included</option>',
      '<option value="included-5">5% included</option>','<option value="exact">Exact VAT amount</option>',
      'id="categorisationProject"'
    ]) expect(html).toContain(marker);
    expect(html).toContain('collection(db,"users",user.uid,"projects")');
  });

  it("dispatches only to the dedicated atomic Money Out or Money In operations",() => {
    expect(html).toContain("const categorise = isMoneyIn ? categoriseMoneyIn : categoriseMoneyOut;");
    expect(html).toContain("const uncategorise = isMoneyIn ? uncategoriseMoneyIn : uncategoriseMoneyOut;");
    expect(html).toContain('services:{ doc,runTransaction,serverTimestamp }');
    expect(html).toContain('services:{ doc,runTransaction,serverTimestamp,deleteField }');
    expect(html).toContain('matchOrigin === "categorisation"');
    expect(html).toContain('Categorisation removed. The Banking-created Expense and its two journals were removed.');
    expect(html).toContain('Categorisation removed. The Banking-created income record and journal were removed.');
  });

  it("loads and describes the Banking-created income source without creating an invoice",() => {
    expect(html).toContain('collection(db,"users",user.uid,"bankIncome")');
    expect(html).toContain('Income: ${matchedRecordLabel(transaction,record)} — received');
    expect(html).toContain('BANK_INCOME_CATEGORIES.map(category => category.value)');
    expect(html).toContain('"Sales / Trading income"');
    expect(html).not.toContain('matchedRecordType:"invoice"');
  });
});

describe("Banking per-account reconciliation page",() => {
  it("provides the narrow account, closing-date, statement-balance, calculation, and sign-off workflow",() => {
    for(const marker of [
      'id="bankReconciliationTitle"','id="reconciliationAccount"','id="reconciliationDate"',
      'id="reconciliationBalance"','id="calculateReconciliationButton"','id="reconciliationBookBalance"',
      'id="reconciliationStatementBalance"','id="reconciliationDifference"','id="reconciliationUnresolved"',
      'id="signOffReconciliationButton"'
    ]) expect(html).toContain(marker);
    expect(html).toContain("calculateBankReconciliation(currentReconciliationOptions(validation.value))");
    expect(html).toContain("signOffBankReconciliation({");
    expect(html).toContain('services:{ doc,runTransaction,serverTimestamp }');
  });

  it("loads owned journals and nested reconciliation history without creating a reconciliation journal",() => {
    expect(html).toContain('getDocs(query(collection(db,"journals"),where("userId","==",user.uid)))');
    expect(html).toContain('getDocs(collection(db,"users",user.uid,"bankReconciliations"))');
    expect(html).toContain('id="reconciliationHistoryTable"');
    expect(html).toContain('record.displayStatus === "reconciled" ? "Reconciled" : "Needs review"');
    expect(html).toContain("No accounting journal was created.");
    expect(html).not.toMatch(/reopenReconciliation|deleteReconciliation/);
  });

  it("keeps archived accounts available for historical reconciliation review",() => {
    expect(html).toContain('account.status === BANK_ACCOUNT_STATUS.ARCHIVED ? " (Archived)" : ""');
    expect(html).toContain("reconciliationHistory(reconciliations,currentReconciliationOptions())");
  });
});
