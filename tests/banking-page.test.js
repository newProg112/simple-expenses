import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BANK_ACCOUNT_STATUS,
  activeBankAccounts,
  normaliseBankAccount,
  validateBankAccountInput
} from "../resources/js/bank-account-view.js";
import { CSV_PREVIEW_LIMIT, formatFileSize, parseCsvPreview } from "../resources/js/csv-preview.js";
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

  it("retains Phase 1 KPIs and makes the active-account count dynamic", () => {
    expect(html).toContain('<div class="kpi-label">Bank accounts</div><div class="kpi-value" id="bankAccountCount">0</div>');
    for(const label of ["Transactions","Needs review","Matched"]){
      expect(html).toContain(`<div class="kpi-label">${label}</div><div class="kpi-value">0</div>`);
    }
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
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.kpi-grid,\.form-grid,\.preview-meta\{grid-template-columns:1fr\}/);
    expect(html).toContain(".app-content{min-width:0}");
    expect(html).toContain(".card{min-width:0");
  });

  it("adds no transaction importing, matching, reconciliation, journals, or accounting changes", () => {
    expect(html).not.toMatch(/open banking|plaid|truelayer|reconcil|journal|general ledger|trial balance|profit & loss|balance sheet/i);
    expect(html).not.toMatch(/bankTransactions|matchTransaction|transactionImport/);
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
    expect(parseCsvPreview('\uFEFFDate,Description,Amount\r\n2026-08-01,"Coffee, lunch",-12.50\r\n2026-08-02,"He said ""thanks""",\r\n')).toEqual({
      rowCount:3,
      columnCount:3,
      rows:[
        ["Date","Description","Amount"],
        ["2026-08-01","Coffee, lunch","-12.50"],
        ["2026-08-02",'He said "thanks"',""]
      ]
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
    expect(html).toContain('<button class="btn" type="button" disabled>Continue to column mapping</button>');
  });

  it("keeps the raw table responsive and displays parsing failures without crashing", () => {
    expect(html).toContain(".preview-table-wrap{width:100%;overflow-x:auto");
    expect(html).toContain('aria-label="CSV statement preview table, horizontally scrollable"');
    expect(html).toContain("This CSV could not be previewed. Check the file formatting and try again.");
    expect(html).toContain('id="importFeedback" role="alert" hidden');
  });
});
