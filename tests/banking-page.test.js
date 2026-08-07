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
import { DEMO_MANAGED_USER_COLLECTIONS } from "../assets/demo-seed-engine.js";
import { DEMO_SEED } from "../assets/demo-seed.js";

const html = readFileSync(new URL("../resources/tools/banking.html", import.meta.url), "utf8");

describe("Banking Phase 2 account model", () => {
  it("requires account and bank names and defaults opening balance to zero", () => {
    expect(validateBankAccountInput({})).toEqual({
      valid:false,
      errors:{ accountName:"Enter an account name.", bankName:"Enter a bank name." },
      value:{ accountName:"", bankName:"", openingBalance:0 }
    });
    expect(validateBankAccountInput({ accountName:"  Business Current Account ", bankName:" Barclays ", openingBalance:"" }))
      .toEqual({ valid:true, errors:{}, value:{ accountName:"Business Current Account", bankName:"Barclays", openingBalance:0 } });
  });

  it("accepts negative currency balances, rounds safely, and rejects non-numeric values", () => {
    expect(validateBankAccountInput({ accountName:"Current", bankName:"Bank", openingBalance:"-123.456" }).value.openingBalance).toBe(-123.46);
    expect(validateBankAccountInput({ accountName:"Current", bankName:"Bank", openingBalance:"not money" }))
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
    expect(html).toContain('id="cancelAccountButton" type="button">Cancel</button>');
    expect(html).toContain('id="saveAccountButton" type="submit">Save</button>');
    expect(html).toContain('role="alert" hidden');
    expect(html).toContain('aria-invalid');
  });

  it("uses the authenticated user bankAccounts subcollection and archives without deletion", () => {
    expect(html).toContain('collection(db,"users",user.uid,"bankAccounts")');
    expect(html).toContain('collection(db,"users",currentUser.uid,"bankAccounts")');
    expect(html).toContain('{ ...data,createdAt:serverTimestamp() }');
    expect(html).toContain('updateDoc(doc(db,"users",currentUser.uid,"bankAccounts",editingAccountId),data)');
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

  it("adds no matching, reconciliation, journals, or accounting changes", () => {
    expect(html).not.toMatch(/open banking|plaid|truelayer|reconcil|journal|general ledger|trial balance|profit & loss|balance sheet/i);
    expect(html).not.toMatch(/matchTransaction|invoiceMatch|billMatch|expenseMatch/);
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
          commit:async () => {
            pending.forEach(({ reference,data }) => documents.set(reference.path,data));
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
    expect(documents.size).toBe(1);
    expect([...documents.keys()][0]).toMatch(/^users\/user-1\/bankTransactions\/csv-[0-9a-f]{64}$/);
    expect([...documents.values()][0].status).toBe("unmatched");
    expect(commits).toEqual([1]);
  });

  it("imports a CSV once and writes zero documents when the same CSV is imported again", async () => {
    const { services,documents } = memoryFirestore();
    const options = { db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult,timestamp };
    await expect(persistBankTransactions({ ...options,importId:"first" }))
      .resolves.toEqual({ importedCount:1,skippedDuplicateCount:0,committedBatches:1 });
    await expect(persistBankTransactions({ ...options,importId:"second" }))
      .resolves.toEqual({ importedCount:0,skippedDuplicateCount:1,committedBatches:0 });
    expect(documents.size).toBe(1);
    expect(services.writeBatch).toHaveBeenCalledOnce();
  });

  it("imports only new rows from a mixed statement", async () => {
    const { services,documents } = memoryFirestore();
    await persistBankTransactions({ db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult,importId:"first",timestamp });
    const newReady = Object.freeze({ ...ready,transactionDate:"08/08/26",description:"New payment" });
    const mixedResult = Object.freeze({ allRows:Object.freeze([ready,newReady,attention]),readyCount:2,attentionCount:1 });
    await expect(persistBankTransactions({ db:{},services,userId:"user-1",bankAccountId:"account-1",mappedResult:mixedResult,importId:"mixed",timestamp }))
      .resolves.toEqual({ importedCount:1,skippedDuplicateCount:1,committedBatches:1 });
    expect(documents.size).toBe(2);
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

  it("normalises persisted rows as Unmatched and orders newest transaction date first", () => {
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
    expect(html).toContain('id="transactionList" tabindex="0" aria-label="Imported bank transactions table, horizontally scrollable"');
    expect(html).toContain('badge.textContent = "Unmatched"');
    expect(html).not.toMatch(/data-transaction-action|deleteBankTransaction|editBankTransaction/);
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
    expect(DEMO_SEED).not.toHaveProperty("bankTransactions");
  });

  it("does not add matching, accounting, Open Banking, or subscription behavior", () => {
    expect(html).not.toMatch(/matchInvoice|matchBill|matchExpense|createJournal|ledgerEntry|plaid|truelayer|plan-entitlements|starterPreview/);
  });
});
