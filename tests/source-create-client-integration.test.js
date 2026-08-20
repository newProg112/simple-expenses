import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = path => readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const invoice=read("resources/tools/invoice-generator.html");
const bills=read("resources/tools/bills.html");
const functions=read("functions/index.js");
const invoiceScripts=[...invoice.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const invoiceModule=invoiceScripts.find(source=>source.includes("window.updateInvoiceInFirestore"));
const invoiceClassic=invoiceScripts.find(source=>source.includes("async function reopenInvoice"));
const billModule=[...bills.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1)?.[1] || "";

function between(source,start,end){
  const from=source.indexOf(start);
  const to=source.indexOf(end,from + start.length);
  return source.slice(from,to);
}

describe("create-only callable integration",() => {
  it("routes authenticated Invoice creates through the atomic callable without a direct-create fallback",() => {
    const save=between(invoice,"window.saveInvoiceToFirestore = async function(invoice){","window.saveInvoiceJournalToFirestore");
    expect(invoice).toContain('"createInvoiceWithReference"');
    expect(save).toContain("createInvoiceWithReference({ sourceId:invoiceId, payload, requestId })");
    const callableBody=between(save,"window.saveInvoiceToFirestore = async function(invoice){","window.saveInvoiceJournalToFirestore");
    expect(callableBody).not.toContain("addDoc(");
    const history=between(invoice,"async function saveInvoiceToHistory(","async function postInvoiceJournalAfterInvoiceSave");
    expect(history).not.toContain("postInvoiceJournalAfterInvoiceSave(");
  });

  it("leaves Invoice backup import on its existing direct Firestore path",() => {
    const restore=between(invoice,"function importInvoiceBackup(event){","function clearInvoiceHistory");
    expect(restore).toContain("saveInvoiceDirectToFirestore({");
    expect(restore).not.toContain("window.saveInvoiceToFirestore({");
  });

  it("routes new Bills through create and normal edits through edit callables",() => {
    const save=between(bills,"async function saveBill() {","function clearForm() {");
    expect(save).toContain("if (existingBill) {");
    expect(save).toContain("updateBillWithReference({");
    expect(save).toContain("sourceId:String(billId),payload:billEditPayload");
    const editPayload=between(save,"const billEditPayload = existingBill ? {","} : null;");
    expect(editPayload).not.toMatch(/\bid\s*:/);
    expect(save).toContain("createBillWithReference({");
    expect(save).not.toContain("postBillJournalAfterSave(");
  });

  it("exports only the two create callables, not standalone registry lifecycle operations",() => {
    expect(functions).toContain("exports.createInvoiceWithReference = onCall(");
    expect(functions).toContain("exports.createBillWithReference = onCall(");
    expect(functions).not.toMatch(/exports\.(claimReference|changeReference|retireReferenceForDelete)\s*=/);
  });
});

describe("edit-only callable integration",() => {
  it("routes normal Invoice edit Save through its callable with expected state and no direct or journal fallback",() => {
    const update=between(invoice,"window.updateInvoiceInFirestore = async function","window.deleteInvoiceFromFirestore");
    const save=between(invoice,"async function updateExistingInvoice(){","function cancelInvoiceEdit(){");
    expect(invoice).toContain('"updateInvoiceWithReference"');
    expect(update).toContain("updateInvoiceWithReference({");
    expect(update).toContain("expectedState");
    expect(update).not.toContain("transaction.update(");
    expect(save).not.toContain("postInvoiceJournalAfterInvoiceSave(");
  });

  it("captures edit-open state and leaves delete, status, import, and Demo paths unchanged",() => {
    expect(invoiceModule).toContain('import { sourceEditExpectedState } from "../js/source-edit-state.js');
    expect(invoiceModule).toContain('window.captureInvoiceEditExpectedState = invoice =>');
    expect(invoiceModule).toContain('sourceEditExpectedState("invoice",invoice)');
    expect(invoiceClassic).toContain("window.captureInvoiceEditExpectedState(invoice)");
    expect(invoiceClassic).not.toMatch(/(^|[^.])\bsourceEditExpectedState\s*\(/);
    expect(billModule).toContain('import { sourceEditExpectedState } from "../js/source-edit-state.js');
    expect(billModule).toContain('sourceEditExpectedState("bill",bill)');
    expect(billModule).toContain("sourceId: snap.id");
    expect(billModule).toContain("editingBillId = billEditSourceId(bill)");
    expect(between(invoice,"async function deleteInvoice(","async function generateStatement")).not.toContain("updateInvoiceWithReference");
    expect(between(invoice,"function importInvoiceBackup(event){","function clearInvoiceHistory")).toContain("saveInvoiceDirectToFirestore");
    expect(between(bills,"async function markBillPaid(","async function deleteBill(")).not.toContain("updateBillWithReference");
    expect(between(bills,"async function deleteBill(","function billSortDateValue")).not.toContain("updateBillWithReference");
  });

  it("exports only the narrow create and edit gateways, not raw registry lifecycle operations",() => {
    expect(functions).toContain("exports.updateInvoiceWithReference = onCall(");
    expect(functions).toContain("exports.updateBillWithReference = onCall(");
    expect(functions).not.toMatch(/exports\.(claimReference|changeReference|retireReferenceForDelete)\s*=/);
  });
});
