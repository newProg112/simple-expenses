import { readFileSync } from "node:fs";
import { describe,expect,it,vi } from "vitest";
import {
  BANK_CATEGORISATION_STATUS_MESSAGE,
  BANK_SETTLED_EXPENSE_DELETE_ERROR_CODE,
  BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  deleteExpenseRecordWithSettlementGuard,
  isBankCategorisedExpense,
  isBankingSettledSource
} from "../resources/js/bank-settlement-source-state.js";

const html = readFileSync(new URL("../resources/tools/expenses.html",import.meta.url),"utf8");
const moduleScript = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1)?.[1] || "";
const settlementMarker = Object.freeze({
  version:1,transactionId:"bank-1",journalId:"bank-settlement_user-1_bank-1"
});

function declarationBetween(start,next){
  const startIndex = moduleScript.indexOf(start);
  const endIndex = moduleScript.indexOf(next,startIndex);
  if(startIndex < 0 || endIndex < 0) throw new Error(`Could not extract ${start}`);
  return moduleScript.slice(startIndex,endIndex).trim();
}

const deleteDeclaration = declarationBetween("async function deleteExpense(id) {","function statusPillClass(status) {");
const renderDeclaration = declarationBetween("function renderExpenses() {","function subscribeToExpenses(user) {");

function firestoreFixture(source,{ beforeCommit } = {}){
  const expensePath = "users/user-1/expenses/expense-1";
  const documents = new Map([
    [expensePath,structuredClone(source)],
    ["journals/expense_user-1_expense-1",{ id:"expense_user-1_expense-1",lines:[{ accountCode:"5000",debit:20 }]}],
    ["journals/mileage_user-1_expense-1",{ id:"mileage_user-1_expense-1",lines:[{ accountCode:"5200",debit:24 }]}],
    ["journals/bank-settlement_user-1_bank-1",{ id:settlementMarker.journalId,lines:[{ accountCode:"1000",credit:24 }]}],
    ["users/user-1/bankTransactions/bank-1",{ id:"bank-1",status:"matched",matchedRecordId:"expense-1" }],
    ["users/user-1/reconciliations/reconciliation-1",{ id:"reconciliation-1",sourceFingerprint:"signed" }]
  ]);
  const attachments = new Map([
    ["users/user-1/attachments/expenses/expense-1/receipt.pdf",{ bytes:"unchanged" }]
  ]);
  const writes = [];
  let transactionCount = 0;
  const snapshot = reference => ({
    exists:() => documents.has(reference.path),
    data:() => structuredClone(documents.get(reference.path))
  });
  const services = {
    doc:(_db,...parts) => ({ path:parts.join("/") }),
    runTransaction:async (_db,execute) => {
      transactionCount += 1;
      const pendingDeletes = [];
      const result = await execute({
        get:async reference => snapshot(reference),
        delete:reference => pendingDeletes.push(reference.path)
      });
      if(beforeCommit?.({ documents,expensePath,transactionCount })){
        return services.runTransaction(_db,execute);
      }
      pendingDeletes.forEach(path => {
        writes.push({ operation:"delete",path });
        documents.delete(path);
      });
      return result;
    }
  };
  return { attachments,documents,expensePath,services,writes };
}

function deleteOptions(testFixture){
  return {
    db:{},userId:"user-1",expenseId:"expense-1",services:testFixture.services
  };
}

function pageControls(){
  return new Proxy({
    recentExpensesSearch:{ value:"" },
    recentProjectFilter:{ value:"all" },
    expensesList:{ innerHTML:"" }
  },{
    get(target,id){
      if(!(id in target)) target[id] = { value:"",textContent:"",innerHTML:"",style:{} };
      return target[id];
    }
  });
}

function renderExpense(expense){
  const elements = pageControls();
  const context = {
    expenses:[expense],statuses:["Draft","Submitted","Approved","Paid"],
    recentExpensesFilter:"all",recentStatusFilter:"all",
    sortExpenses:value => value,dedupeExpensesById:value => value,
    claimValue:value => Number(value.amount || value.gross || 0),money:value => `£${Number(value || 0).toFixed(2)}`,
    expenseCountText:count => String(count),updateStatusChart:vi.fn(),updateClaimsTypeChart:vi.fn(),
    updateCategoryChart:vi.fn(),updateMonthlyExpenseTrendChart:vi.fn(),expenseMatchesDateFilter:() => true,
    expenseMatchesSearch:() => true,escapeHtml:value => String(value ?? ""),formatDate:value => String(value || ""),
    statusPillClass:status => `pill-${String(status).toLowerCase()}`,
    isBankCategorisedExpense,isBankingSettledSource,
    BANK_CATEGORISATION_STATUS_MESSAGE,BANK_SETTLEMENT_STATUS_MESSAGE,
    BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE,BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE,
    document:{ getElementById:id => elements[id] }
  };
  const render = Function(
    ...Object.keys(context),
    `"use strict";${renderDeclaration};return renderExpenses;`
  )(...Object.values(context));
  render();
  return elements.expensesList.innerHTML;
}

function deleteButton(markup){
  return markup.match(/<button[^>]*data-expense-action="delete"[^>]*>Delete<\/button>/)?.[0] || "";
}

function compileDeleteExpense(expense,overrides = {}){
  const calls = {
    alert:vi.fn(),confirm:vi.fn(() => true),saveExpenses:vi.fn(),renderExpenses:vi.fn(),
    deleteAttachment:vi.fn(async () => {})
  };
  const context = {
    expenses:[expense],isBankCategorisedExpense,isBankingSettledSource,
    BANK_CATEGORISATION_STATUS_MESSAGE,BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE,
    BANK_SETTLED_EXPENSE_DELETE_ERROR_CODE,alert:calls.alert,confirm:calls.confirm,
    getCurrentUser:vi.fn(async () => ({ uid:"user-1" })),
    deleteExpenseRecordWithSettlementGuard:vi.fn(async () => ({ status:"deleted",expenseId:"expense-1" })),
    db:{},doc:vi.fn(),runTransaction:vi.fn(),saveExpenses:calls.saveExpenses,
    renderExpenses:calls.renderExpenses,deleteAttachment:calls.deleteAttachment,
    ...overrides
  };
  const deleteExpense = Function(
    ...Object.keys(context),
    `"use strict";${deleteDeclaration};return deleteExpense;`
  )(...Object.values(context));
  return { calls,context,deleteExpense };
}

describe("bank-settled Expense and Mileage delete protection",() => {
  it.each([
    ["Expense",{ id:"expense-1",type:"expense",merchant:"Supplier",gross:24 }],
    ["Mileage",{ id:"expense-1",type:"mileage",from:"Office",to:"Client",miles:43.64,ratePerMile:0.55,amount:24,gross:24 }]
  ])("disables and intercepts Delete for a settled %s",async (_label,record) => {
    const settled = { ...record,status:"Paid",bankSettlement:settlementMarker };
    const markup = renderExpense(settled);
    expect(deleteButton(markup)).toContain("disabled");
    expect(deleteButton(markup)).toContain(`title="${BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE}"`);

    const compiled = compileDeleteExpense(settled);
    await compiled.deleteExpense("expense-1");
    expect(compiled.calls.alert).toHaveBeenCalledWith(BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE);
    expect(compiled.calls.confirm).not.toHaveBeenCalled();
    expect(compiled.context.deleteExpenseRecordWithSettlementGuard).not.toHaveBeenCalled();
    expect(compiled.calls.saveExpenses).not.toHaveBeenCalled();
    expect(compiled.calls.deleteAttachment).not.toHaveBeenCalled();
  });

  it.each(["expense","mileage"])("rejects direct deletion of a settled %s with zero writes or artifact changes",async type => {
    const settled = {
      id:"expense-1",type,status:"Paid",gross:24,attachmentPath:"users/user-1/attachments/expenses/expense-1/receipt.pdf",
      bankSettlement:settlementMarker
    };
    const testFixture = firestoreFixture(settled);
    const documentsBefore = structuredClone([...testFixture.documents]);
    const attachmentsBefore = structuredClone([...testFixture.attachments]);

    await expect(deleteExpenseRecordWithSettlementGuard(deleteOptions(testFixture)))
      .rejects.toMatchObject({
        code:BANK_SETTLED_EXPENSE_DELETE_ERROR_CODE,
        message:BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE
      });

    expect(testFixture.writes).toEqual([]);
    expect([...testFixture.documents]).toEqual(documentsBefore);
    expect([...testFixture.attachments]).toEqual(attachmentsBefore);
  });

  it("rejects a stale delete when Banking settles before the delete transaction commits",async () => {
    const cached = {
      id:"expense-1",type:"expense",status:"Approved",gross:24,
      attachmentPath:"users/user-1/attachments/expenses/expense-1/receipt.pdf"
    };
    const testFixture = firestoreFixture(cached,{
      beforeCommit:({ documents,expensePath,transactionCount }) => {
        if(transactionCount !== 1) return false;
        documents.set(expensePath,{ ...cached,status:"Paid",bankSettlement:settlementMarker });
        return true;
      }
    });
    const helper = vi.fn(options => deleteExpenseRecordWithSettlementGuard({
      ...options,services:testFixture.services
    }));
    const compiled = compileDeleteExpense(cached,{
      deleteExpenseRecordWithSettlementGuard:helper
    });

    await compiled.deleteExpense("expense-1");

    expect(helper).toHaveBeenCalledOnce();
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.documents.get(testFixture.expensePath)).toEqual({
      ...cached,status:"Paid",bankSettlement:settlementMarker
    });
    expect(compiled.calls.alert).toHaveBeenCalledWith(BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE);
    expect(compiled.calls.saveExpenses).not.toHaveBeenCalled();
    expect(compiled.calls.renderExpenses).not.toHaveBeenCalled();
    expect(compiled.calls.deleteAttachment).not.toHaveBeenCalled();
  });

  it.each(["expense","mileage"])("keeps an unmatched %s deletable",async type => {
    const unmatched = { id:"expense-1",type,status:"Approved",gross:24 };
    expect(deleteButton(renderExpense(unmatched))).not.toContain("disabled");
    const testFixture = firestoreFixture(unmatched);

    await expect(deleteExpenseRecordWithSettlementGuard(deleteOptions(testFixture)))
      .resolves.toEqual({ status:"deleted",expenseId:"expense-1" });
    expect(testFixture.writes).toEqual([{ operation:"delete",path:testFixture.expensePath }]);
    expect(testFixture.documents.has(testFixture.expensePath)).toBe(false);
  });

  it.each(["expense","mileage"])("makes Delete available after Unmatch and ignores historical markers for %s",async type => {
    const afterUnmatch = {
      id:"expense-1",type,status:"Approved",gross:24,
      previousBankSettlement:settlementMarker,
      bankSettlementHistory:[settlementMarker]
    };
    expect(isBankingSettledSource(afterUnmatch)).toBe(false);
    expect(deleteButton(renderExpense(afterUnmatch))).not.toContain("disabled");

    const testFixture = firestoreFixture(afterUnmatch);
    await expect(deleteExpenseRecordWithSettlementGuard(deleteOptions(testFixture)))
      .resolves.toMatchObject({ status:"deleted" });
  });

  it("keeps the existing Edit and payment-status protections unchanged",() => {
    const markup = renderExpense({
      id:"expense-1",type:"expense",merchant:"Supplier",gross:24,status:"Approved",
      bankSettlement:settlementMarker
    });
    const editButton = markup.match(/<button[^>]*data-expense-action="edit"[^>]*>Edit<\/button>/)?.[0] || "";
    const paidButton = markup.match(/<button[^>]*data-expense-action="mark-paid"[^>]*>Mark paid<\/button>/)?.[0] || "";
    expect(editButton).toContain(`disabled title="${BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE}"`);
    expect(paidButton).toContain(`disabled title="${BANK_SETTLEMENT_STATUS_MESSAGE}"`);
    expect(deleteButton(markup)).toContain(`disabled title="${BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE}"`);
  });

  it("wires the authoritative guard before cache or attachment mutation",() => {
    expect(html).toContain("deleteExpenseRecordWithSettlementGuard({");
    expect(deleteDeclaration.indexOf("deleteExpenseRecordWithSettlementGuard({"))
      .toBeLessThan(deleteDeclaration.indexOf("saveExpenses(expenses.filter"));
    expect(deleteDeclaration.indexOf("deleteExpenseRecordWithSettlementGuard({"))
      .toBeLessThan(deleteDeclaration.indexOf("deleteAttachment(expenseToDelete.attachmentPath)"));
    expect(deleteDeclaration).not.toContain("deleteDoc(");
  });
});
