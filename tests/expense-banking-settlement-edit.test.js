import { readFileSync } from "node:fs";
import { describe,expect,it,vi } from "vitest";
import {
  BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE,
  BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE,
  isBankCategorisedExpense,
  isBankingSettledSource,
  saveExpenseRecordWithSettlementGuard
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

const editDeclaration = declarationBetween("function editExpense(id) {","function cancelEdit() {");
const lockDeclaration = declarationBetween(
  "const bankSettledExpenseEditControlIds = Object.freeze([",
  "function clearForm() {"
);

function control(value = ""){
  return {
    value,disabled:false,hidden:true,textContent:"",title:"",attributes:{},
    setAttribute(name,next){ this.attributes[name] = next; },
    focus:vi.fn()
  };
}

function compileEditExpense(expense){
  const elements = new Proxy({
    saveExpenseButton:control(),cancelEditButton:control(),expenseEditLockMessage:control()
  },{
    get(target,id){
      if(!(id in target)) target[id] = control();
      return target[id];
    }
  });
  const alert = vi.fn();
  const setClaimType = vi.fn();
  const context = {
    expenses:[expense],pendingScannedReceiptFile:null,
    isBankCategorisedExpense,isBankingSettledSource,
    BANK_CATEGORISATION_STATUS_MESSAGE:"Categorised",
    BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE,
    alert,clearPendingScannedReceiptFile:vi.fn(),clearReceiptAiApplyFeedback:vi.fn(),
    setBankSettledExpenseEditLock:vi.fn(),setClaimType,
    document:{ getElementById:id => elements[id] },
    renderProjectDropdown:vi.fn(),resetAttachmentUI:vi.fn(),showExistingAttachment:vi.fn(),
    setAttachmentStatus:vi.fn()
  };
  const compiled = Function(
    ...Object.keys(context),
    `"use strict";let editingExpenseId=null;let vatManuallyEdited=false;${editDeclaration};` +
      "return {editExpense,getEditingExpenseId:()=>editingExpenseId};"
  )(...Object.values(context));
  return { ...compiled,alert,elements,setClaimType };
}

function firestoreFixture(persisted){
  const writes = [];
  const expensePath = "users/user-1/expenses/expense-1";
  const documents = new Map([[expensePath,structuredClone(persisted)]]);
  const services = {
    doc:(_db,...parts) => ({ path:parts.join("/") }),
    runTransaction:async (_db,execute) => execute({
      get:async reference => ({
        exists:() => documents.has(reference.path),
        data:() => documents.get(reference.path)
      }),
      set:(reference,data) => {
        writes.push({ operation:"set",path:reference.path });
        documents.set(reference.path,structuredClone(data));
      }
    })
  };
  return { documents,expensePath,services,writes };
}

function saveOptions(testFixture,expense){
  return {
    db:{},userId:"user-1",expenseId:"expense-1",expense,requireExisting:true,
    services:testFixture.services
  };
}

describe("bank-settled Expense and Mileage edit lock",() => {
  it.each([
    ["Expense",{ id:"expense-1",type:"expense",merchant:"SHELL",bankSettlement:settlementMarker }],
    ["Mileage",{ id:"expense-1",type:"mileage",from:"Office",to:"Client",bankSettlement:settlementMarker }]
  ])("does not let a settled %s enter edit mode",(_label,expense) => {
    const compiled = compileEditExpense(expense);

    compiled.editExpense("expense-1");

    expect(compiled.getEditingExpenseId()).toBeNull();
    expect(compiled.setClaimType).not.toHaveBeenCalled();
    expect(compiled.elements.saveExpenseButton.textContent).toBe("");
    expect(compiled.alert).toHaveBeenCalledWith(BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE);
  });

  it.each([
    ["Expense",{ type:"expense",merchant:"Supplier",gross:120 }],
    ["Mileage",{ type:"mileage",from:"Office",to:"Client",miles:20,ratePerMile:0.55,amount:11,gross:11 }]
  ])("keeps an ordinary unmatched %s editable",(_label,expense) => {
    const compiled = compileEditExpense({ id:"expense-1",status:"Approved",...expense });

    compiled.editExpense("expense-1");

    expect(compiled.getEditingExpenseId()).toBe("expense-1");
    expect(compiled.setClaimType).toHaveBeenCalledWith(expense.type);
    expect(compiled.elements.saveExpenseButton.textContent).toBe("Update expense");
    expect(compiled.elements.cancelEditButton.hidden).toBe(false);
    expect(compiled.alert).not.toHaveBeenCalled();
  });

  it("locks every source field and the Save action if a stale editor becomes settled",() => {
    const elements = new Proxy({ expenseEditLockMessage:control() },{
      get(target,id){
        if(!(id in target)) target[id] = control();
        return target[id];
      }
    });
    const compiled = Function(
      "document",
      `"use strict";${lockDeclaration};return {ids:bankSettledExpenseEditControlIds,lock:setBankSettledExpenseEditLock};`
    )({ getElementById:id => elements[id] });

    compiled.lock(true,BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE);

    expect(compiled.ids).toEqual(expect.arrayContaining([
      "expenseModeButton","mileageModeButton","expenseDate","merchant","category",
      "expenseProjectSelect","netAmount","vatRate","vatAmount","grossAmount","status","description",
      "mileageDate","mileageFrom","mileageTo","mileageProjectSelect","mileageMiles","mileageRate",
      "mileageAmount","mileageStatus","mileagePurpose","notes","expenseAttachment","saveExpenseButton"
    ]));
    compiled.ids.forEach(id => expect(elements[id].disabled).toBe(true));
    expect(elements.expenseEditLockMessage).toMatchObject({
      hidden:false,textContent:BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE
    });
  });

  it.each(["expense","mileage"])("rejects a direct settled %s save with zero writes",async type => {
    const persisted = { id:"expense-1",type,status:"Paid",bankSettlement:settlementMarker };
    const testFixture = firestoreFixture(persisted);
    const sourceBefore = structuredClone(testFixture.documents.get(testFixture.expensePath));
    const artifacts = {
      settlementJournal:{ id:"bank-settlement_user-1_bank-1",lines:[{ accountCode:"1000" }] },
      accrualJournal:{ id:`${type}_user-1_expense-1`,lines:[{ accountCode:"5000" }] },
      reconciliation:{ id:"account-1_2026-08-31",sourceFingerprint:"signed" }
    };
    const artifactsBefore = structuredClone(artifacts);

    const error = await saveExpenseRecordWithSettlementGuard(
      saveOptions(testFixture,{ ...persisted,gross:999 })
    ).then(() => null,failure => failure);

    expect(error).toMatchObject({
      code:BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE,
      message:BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE
    });
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.documents.get(testFixture.expensePath)).toEqual(sourceBefore);
    expect(artifacts).toEqual(artifactsBefore);
  });

  it("rejects a stale editor when Banking settles after the form opened",async () => {
    const cachedEditorRecord = { id:"expense-1",type:"expense",merchant:"SHELL",gross:78.2 };
    const testFixture = firestoreFixture({ ...cachedEditorRecord,bankSettlement:settlementMarker,status:"Paid" });

    await expect(saveExpenseRecordWithSettlementGuard(
      saveOptions(testFixture,{ ...cachedEditorRecord,gross:80 })
    )).rejects.toMatchObject({ code:BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE });

    expect(testFixture.writes).toEqual([]);
  });

  it.each(["expense","mileage"])("saves an ordinary unmatched %s normally",async type => {
    const persisted = { id:"expense-1",type,status:"Approved",gross:type === "mileage" ? 11 : 120 };
    const testFixture = firestoreFixture(persisted);
    const updated = { ...persisted,notes:"Updated" };

    await expect(saveExpenseRecordWithSettlementGuard(saveOptions(testFixture,updated)))
      .resolves.toEqual({ status:"updated",expenseId:"expense-1" });

    expect(testFixture.writes).toEqual([{ operation:"set",path:testFixture.expensePath }]);
    expect(testFixture.documents.get(testFixture.expensePath)).toEqual(updated);
  });

  it("restores normal editing and saving after Unmatch removes the marker",async () => {
    const afterUnmatch = {
      id:"expense-1",type:"expense",merchant:"SHELL",gross:78.2,status:"Draft",
      previousBankSettlement:settlementMarker
    };
    const compiled = compileEditExpense(afterUnmatch);
    compiled.editExpense("expense-1");
    expect(compiled.getEditingExpenseId()).toBe("expense-1");

    const testFixture = firestoreFixture(afterUnmatch);
    await expect(saveExpenseRecordWithSettlementGuard(
      saveOptions(testFixture,{ ...afterUnmatch,notes:"Editable again" })
    )).resolves.toMatchObject({ status:"updated" });
    expect(testFixture.writes).toHaveLength(1);
  });

  it("wires both the list and authoritative page save to the shared lock",() => {
    expect(html).toContain("BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE");
    expect(html).toContain("saveExpenseRecordWithSettlementGuard({");
    expect(html).toContain("services:{ doc,runTransaction }");
    expect(html).toContain("const editLocked = bankCategorised || bankingSettled");
    expect(html).toContain('editLocked ? ` disabled title="${editLockMessage}" aria-describedby="${protectionNoteId}"`');
    expect(html).toMatch(/function editExpense[\s\S]*?isBankingSettledSource\(expense\)[\s\S]*?BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE/);
    expect(html).toMatch(/onSnapshot[\s\S]*?currentEditingExpense[\s\S]*?setBankSettledExpenseEditLock\(true,BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE\)/);
  });
});
