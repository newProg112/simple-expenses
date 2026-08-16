import { readFileSync } from "node:fs";
import { describe,expect,it,vi } from "vitest";
import {
  BANK_SETTLED_BILL_MUTATION_ERROR_CODE,
  BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_PROTECTED_ACTIONS_MESSAGE,
  deleteBillRecordWithSettlementGuard,
  isBankingSettledSource,
  readBillRecordWithSettlementGuard,
  saveBillRecordWithSettlementGuard
} from "../resources/js/bank-settlement-source-state.js";

const html = readFileSync(new URL("../resources/tools/bills.html",import.meta.url),"utf8");
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

const editDeclaration = declarationBetween("async function editBill(id) {","async function markBillPaid(id) {");
const lockDeclaration = declarationBetween(
  "const bankSettledBillEditControlIds = Object.freeze([",
  "async function saveBill() {"
);
const saveDeclaration = declarationBetween("async function saveBill() {","function clearForm() {");

function control(value = ""){
  return {
    value,disabled:false,hidden:true,textContent:"",title:"",attributes:{},
    options:[{ value:"0.20" },{ value:"0.05" },{ value:"0" }],
    setAttribute(name,next){ this.attributes[name] = next; },
    scrollIntoView:vi.fn()
  };
}

function compileEditBill(bill){
  const elements = new Proxy({}, {
    get(target,id){
      if(!(id in target)) target[id] = control();
      return target[id];
    }
  });
  const alert = vi.fn();
  const setBankSettledBillEditLock = vi.fn();
  const context = {
    currentBills:[bill],pendingScannedBillFile:null,selectedAttachment:null,
    isBankingSettledSource,BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE,
    BANK_SETTLED_BILL_MUTATION_ERROR_CODE,alert,getCurrentUser:vi.fn(async () => null),
    readBillRecordWithSettlementGuard,db:{},doc:vi.fn(),getDoc:vi.fn(),
    saveBills:vi.fn(),loadBills:vi.fn(),renderBills:vi.fn(),
    clearPendingScannedBillFile:vi.fn(),clearBillAiApplyFeedback:vi.fn(),
    setBankSettledBillEditLock,normaliseVatRateOptionValue:vi.fn(() => "0.20"),
    renderProjectDropdown:vi.fn(),setAttachmentStatus:vi.fn(),document:{ getElementById:id => elements[id] }
  };
  const compiled = Function(
    ...Object.keys(context),
    `"use strict";let editingBillId=null;${editDeclaration};` +
      "return {editBill,getEditingBillId:()=>editingBillId};"
  )(...Object.values(context));
  return { ...compiled,alert,elements,setBankSettledBillEditLock };
}

function compileSaveBill({ persistedRead,transactionSave }){
  const elements = new Proxy({
    supplier:control("Supplier"),saveBillButton:control(),netAmount:control("100"),
    vatRate:control("0.20"),status:control("Unpaid")
  },{
    get(target,id){
      if(!(id in target)) target[id] = control();
      return target[id];
    }
  });
  const existingBill = {
    id:"bill-1",supplier:"Supplier",status:"Unpaid",attachmentName:"original.pdf",
    attachmentPath:"users/user-1/attachments/bills/bill-1/original.pdf"
  };
  const uploaded = {
    attachmentName:"replacement.pdf",attachmentUrl:"https://example.test/replacement",
    attachmentPath:"users/user-1/attachments/bills/bill-1/staged-replacement.pdf",
    attachmentSize:100,attachmentType:"application/pdf"
  };
  const mocks = {
    rejectBankSettledBillEdit:vi.fn(),loadBills:vi.fn(async () => []),renderBills:vi.fn(),
    uploadAttachment:vi.fn(async () => uploaded),deleteAttachment:vi.fn(async () => {}),
    postBillJournalAfterSave:vi.fn(),setAttachmentStatus:vi.fn()
  };
  const context = {
    editingBillId:"bill-1",currentBills:[existingBill],selectedAttachment:{ name:"replacement.pdf" },
    pendingScannedBillFile:null,isBankingSettledSource,BANK_SETTLED_BILL_MUTATION_ERROR_CODE,
    readBillRecordWithSettlementGuard:vi.fn(persistedRead),
    saveBillRecordWithSettlementGuard:vi.fn(transactionSave),sourceStatusForSave:(_record,status) => status,
    document:{ getElementById:id => elements[id] },alert:vi.fn(),getCurrentUser:vi.fn(async () => ({ uid:"user-1" })),
    db:{},doc:vi.fn(),getDoc:vi.fn(),runTransaction:vi.fn(),calculateBillAmounts:vi.fn(() => ({
      net:100,vatRate:0.2,vat:20,total:120
    })),createActivityIdempotencyKey:vi.fn(),createRequestId:vi.fn(() => "stage-token"),
    selectedBillProject:vi.fn(() => ({ projectId:"",projectName:"",projectReference:"" })),
    ...mocks
  };
  const compiled = Function(
    ...Object.keys(context),
    `"use strict";${saveDeclaration};return {saveBill};`
  )(...Object.values(context));
  return { ...compiled,elements,mocks,uploaded };
}

function firestoreFixture(persisted,{ beforeTransaction } = {}){
  const billPath = "users/user-1/bills/bill-1";
  const documents = new Map([[billPath,structuredClone(persisted)]]);
  const writes = [];
  const deletes = [];
  let transactionCount = 0;
  const snapshot = reference => ({
    exists:() => documents.has(reference.path),
    data:() => structuredClone(documents.get(reference.path))
  });
  const services = {
    doc:(_db,...parts) => ({ path:parts.join("/") }),
    getDoc:async reference => snapshot(reference),
    runTransaction:async (_db,execute) => {
      transactionCount += 1;
      if(beforeTransaction) beforeTransaction({ documents,billPath,transactionCount });
      return execute({
        get:async reference => snapshot(reference),
        set:(reference,data) => {
          writes.push({ operation:"set",path:reference.path });
          documents.set(reference.path,structuredClone(data));
        },
        delete:reference => {
          deletes.push(reference.path);
          documents.delete(reference.path);
        }
      });
    }
  };
  return { billPath,deletes,documents,services,writes };
}

function saveOptions(testFixture,bill){
  return {
    db:{},userId:"user-1",billId:"bill-1",bill,requireExisting:true,
    services:testFixture.services
  };
}

function deleteOptions(testFixture){
  return {
    db:{},userId:"user-1",billId:"bill-1",services:testFixture.services
  };
}

describe("bank-settled Bill edit and delete protection",() => {
  it("does not let a settled Bill enter writable edit mode",async () => {
    const compiled = compileEditBill({ id:"bill-1",supplier:"Supplier",bankSettlement:settlementMarker });

    await compiled.editBill("bill-1");

    expect(compiled.getEditingBillId()).toBeNull();
    expect(compiled.setBankSettledBillEditLock).not.toHaveBeenCalled();
    expect(compiled.alert).toHaveBeenCalledWith(BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE);
  });

  it("keeps an ordinary unmatched Bill editable and restores editing after Unmatch",async () => {
    const compiled = compileEditBill({
      id:"bill-1",supplier:"Supplier",status:"Unpaid",net:100,vatRate:0.2,
      previousBankSettlement:settlementMarker
    });

    await compiled.editBill("bill-1");

    expect(compiled.getEditingBillId()).toBe("bill-1");
    expect(compiled.elements.saveBillButton.textContent).toBe("Update bill");
    expect(compiled.elements.cancelEditButton.hidden).toBe(false);
    expect(compiled.setBankSettledBillEditLock).toHaveBeenCalledWith(false);
    expect(compiled.alert).not.toHaveBeenCalled();
  });

  it("locks every persisted Bill input, attachment action and Update action",() => {
    const elements = new Proxy({ billEditLockMessage:control() },{
      get(target,id){
        if(!(id in target)) target[id] = control();
        return target[id];
      }
    });
    const compiled = Function(
      "document",
      `"use strict";${lockDeclaration};return {ids:bankSettledBillEditControlIds,lock:setBankSettledBillEditLock};`
    )({ getElementById:id => elements[id] });

    compiled.lock(true,BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE);

    expect(compiled.ids).toEqual(expect.arrayContaining([
      "openBillScanButton","supplier","billNumber","billDate","dueDate","category",
      "netAmount","vatRate","status","projectSelect","notes","billAttachment",
      "removePendingScannedBillFileButton","saveBillButton"
    ]));
    compiled.ids.forEach(id => expect(elements[id].disabled).toBe(true));
    expect(elements.billEditLockMessage).toMatchObject({
      hidden:false,textContent:BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE
    });
  });

  it("rejects a persisted settled Bill before an edit can proceed",async () => {
    const settled = { id:"bill-1",supplier:"Supplier",status:"Paid",bankSettlement:settlementMarker };
    const testFixture = firestoreFixture(settled);

    await expect(readBillRecordWithSettlementGuard({
      db:{},userId:"user-1",billId:"bill-1",
      services:{ doc:testFixture.services.doc,getDoc:testFixture.services.getDoc }
    })).rejects.toMatchObject({
      code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE,
      message:BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE
    });
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.deletes).toEqual([]);
  });

  it("rejects a stale settled Bill before uploading or changing an attachment",async () => {
    const error = Object.assign(new Error(BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE),{
      code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE
    });
    const compiled = compileSaveBill({
      persistedRead:async () => { throw error; },
      transactionSave:async () => { throw new Error("should not save"); }
    });

    await compiled.saveBill();

    expect(compiled.mocks.uploadAttachment).not.toHaveBeenCalled();
    expect(compiled.mocks.deleteAttachment).not.toHaveBeenCalled();
    expect(compiled.mocks.postBillJournalAfterSave).not.toHaveBeenCalled();
    expect(compiled.mocks.rejectBankSettledBillEdit).toHaveBeenCalledOnce();
  });

  it("cleans only the staged replacement if settlement wins during the save transaction",async () => {
    const error = Object.assign(new Error(BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE),{
      code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE
    });
    const compiled = compileSaveBill({
      persistedRead:async () => ({
        id:"bill-1",supplier:"Supplier",status:"Unpaid",attachmentName:"original.pdf",
        attachmentPath:"users/user-1/attachments/bills/bill-1/original.pdf"
      }),
      transactionSave:async () => { throw error; }
    });

    await compiled.saveBill();

    expect(compiled.mocks.uploadAttachment).toHaveBeenCalledWith(
      expect.anything(),"bill-1","user-1","stage-token"
    );
    expect(compiled.mocks.deleteAttachment).toHaveBeenCalledOnce();
    expect(compiled.mocks.deleteAttachment).toHaveBeenCalledWith(compiled.uploaded.attachmentPath);
    expect(compiled.mocks.deleteAttachment).not.toHaveBeenCalledWith(
      "users/user-1/attachments/bills/bill-1/original.pdf"
    );
    expect(compiled.mocks.postBillJournalAfterSave).not.toHaveBeenCalled();
    expect(compiled.mocks.rejectBankSettledBillEdit).toHaveBeenCalledOnce();
  });

  it("rejects a direct settled-Bill save with every related record byte-for-byte unchanged",async () => {
    const settled = { id:"bill-1",supplier:"Supplier",total:120,status:"Paid",bankSettlement:settlementMarker };
    const testFixture = firestoreFixture(settled);
    const sourceBefore = structuredClone(testFixture.documents.get(testFixture.billPath));
    const artifacts = {
      accrualJournal:{ id:"bill_user-1_bill-1",lines:[{ accountCode:"2000",credit:120 }] },
      settlementJournal:{ id:settlementMarker.journalId,lines:[{ accountCode:"1000",credit:120 }] },
      bankTransaction:{ id:"bank-1",status:"matched",matchedRecordId:"bill-1" },
      reconciliation:{ id:"account-1_2026-08-31",sourceFingerprint:"signed" },
      attachment:{ path:"users/user-1/attachments/bills/bill-1/original.pdf",bytes:"unchanged" }
    };
    const artifactsBefore = structuredClone(artifacts);

    await expect(saveBillRecordWithSettlementGuard(
      saveOptions(testFixture,{ ...settled,total:999 })
    )).rejects.toMatchObject({ code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE });

    expect(testFixture.writes).toEqual([]);
    expect(testFixture.deletes).toEqual([]);
    expect(testFixture.documents.get(testFixture.billPath)).toEqual(sourceBefore);
    expect(artifacts).toEqual(artifactsBefore);
  });

  it("rejects a stale editor when Banking settles inside the authoritative save transaction",async () => {
    const cached = { id:"bill-1",supplier:"Supplier",total:120,status:"Unpaid" };
    const testFixture = firestoreFixture(cached,{
      beforeTransaction:({ documents,billPath }) => documents.set(
        billPath,{ ...cached,status:"Paid",bankSettlement:settlementMarker }
      )
    });

    await expect(saveBillRecordWithSettlementGuard(
      saveOptions(testFixture,{ ...cached,total:180 })
    )).rejects.toMatchObject({ code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE });
    expect(testFixture.writes).toEqual([]);
    expect(testFixture.deletes).toEqual([]);
  });

  it("saves an ordinary unmatched Bill and permits saving after Unmatch",async () => {
    const afterUnmatch = {
      id:"bill-1",supplier:"Supplier",total:120,status:"Unpaid",
      previousBankSettlement:settlementMarker
    };
    const testFixture = firestoreFixture(afterUnmatch);
    const updated = { ...afterUnmatch,notes:"Editable again" };

    await expect(saveBillRecordWithSettlementGuard(saveOptions(testFixture,updated)))
      .resolves.toEqual({ status:"updated",billId:"bill-1" });
    expect(testFixture.writes).toEqual([{ operation:"set",path:testFixture.billPath }]);
    expect(testFixture.documents.get(testFixture.billPath)).toEqual(updated);
  });

  it("rejects direct settled-Bill deletion with zero deletes or related mutations",async () => {
    const settled = { id:"bill-1",supplier:"Supplier",status:"Paid",bankSettlement:settlementMarker };
    const testFixture = firestoreFixture(settled);
    const sourceBefore = structuredClone(testFixture.documents.get(testFixture.billPath));
    const artifacts = {
      accrualJournal:{ id:"bill_user-1_bill-1" },
      settlementJournal:{ id:settlementMarker.journalId },
      bankTransaction:{ id:"bank-1",status:"matched" },
      reconciliation:{ id:"reconciliation-1" },
      attachment:{ path:"original.pdf" }
    };
    const artifactsBefore = structuredClone(artifacts);

    await expect(deleteBillRecordWithSettlementGuard(deleteOptions(testFixture)))
      .rejects.toMatchObject({ code:BANK_SETTLED_BILL_MUTATION_ERROR_CODE });

    expect(testFixture.writes).toEqual([]);
    expect(testFixture.deletes).toEqual([]);
    expect(testFixture.documents.get(testFixture.billPath)).toEqual(sourceBefore);
    expect(artifacts).toEqual(artifactsBefore);
  });

  it("restores ordinary deletion after Unmatch removes the current marker",async () => {
    const afterUnmatch = { id:"bill-1",supplier:"Supplier",previousBankSettlement:settlementMarker };
    const testFixture = firestoreFixture(afterUnmatch);

    await expect(deleteBillRecordWithSettlementGuard(deleteOptions(testFixture)))
      .resolves.toEqual({ status:"deleted",billId:"bill-1" });
    expect(testFixture.deletes).toEqual([testFixture.billPath]);
    expect(testFixture.documents.has(testFixture.billPath)).toBe(false);
  });

  it("wires persisted preflight, transactional mutation guards and attachment staging in safe order",() => {
    expect(saveDeclaration.indexOf("readBillRecordWithSettlementGuard({"))
      .toBeLessThan(saveDeclaration.indexOf("uploadAttachment(\n            selectedAttachment"));
    expect(saveDeclaration).toContain("existingBill ? createRequestId() : \"\"");
    expect(saveDeclaration).toMatch(/uploadedReplacementPath[\s\S]*?saveBillRecordWithSettlementGuard\([\s\S]*?deleteAttachment\(uploadedReplacementPath\)/);
    expect(saveDeclaration.indexOf("saveBillRecordWithSettlementGuard({"))
      .toBeLessThan(saveDeclaration.indexOf("postBillJournalAfterSave("));
    expect(html).toContain("deleteBillRecordWithSettlementGuard({");
    expect(html).toMatch(/deleteBillRecordWithSettlementGuard\([\s\S]*?currentBills = currentBills\.filter[\s\S]*?deleteAttachment\(billToDelete\.attachmentPath\)/);
  });

  it("disables settled Edit and Delete while preserving the existing payment-status lock",() => {
    expect(html).toMatch(/data-bill-action="edit"[\s\S]*?bankingSettled \? ` disabled title="\$\{BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE\}" aria-describedby="\$\{settlementNoteId\}"`/);
    expect(html).toMatch(/data-bill-action="delete"[\s\S]*?bankingSettled \? ` disabled title="\$\{BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE\}" aria-describedby="\$\{settlementNoteId\}"`/);
    expect(html).toMatch(/data-bill-action="toggle-paid"[\s\S]*?BANK_SETTLEMENT_STATUS_MESSAGE/);
    expect(html).toContain('aria-describedby="${settlementNoteId}"');
    expect(html).toContain('${BANK_SETTLEMENT_PROTECTED_ACTIONS_MESSAGE}</span>');
    expect(BANK_SETTLEMENT_PROTECTED_ACTIONS_MESSAGE).toContain(
      "Unmatch it in Banking before editing, changing its payment status or deleting it."
    );
    expect(html).toMatch(/async function deleteBill[\s\S]*?isBankingSettledSource\(billToDelete\)[\s\S]*?BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE/);
  });
});
