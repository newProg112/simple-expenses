import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_SETTLEMENT_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  isBankingSettledSource
} from "../resources/js/bank-settlement-source-state.js";
import { calculateInvoiceTotals } from "../resources/js/business-logic.js";

const invoiceHtml = readFileSync(
  new URL("../resources/tools/invoice-generator.html", import.meta.url),
  "utf8"
);
const inlineScripts = [...invoiceHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]);
const invoiceModuleScript = inlineScripts.find(source =>
  source.includes("window.updateInvoiceInFirestore")
);
const invoiceClassicScript = inlineScripts.find(source =>
  source.includes("async function updateExistingInvoice()")
);
const bankSettlementSourceStatePromise = Promise.resolve({
  BANK_SETTLEMENT_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  isBankingSettledSource
});
const invoiceBusinessLogicPromise = Promise.resolve({ calculateInvoiceTotals });
const settlementMarker = Object.freeze({
  version:1,
  transactionId:"bank-transaction-1",
  journalId:"bank-settlement_user-1_bank-transaction-1"
});

function declarationBetween(source,start,next){
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(next,startIndex);

  if(startIndex < 0 || endIndex < 0){
    throw new Error(`Could not extract ${start}`);
  }

  return source.slice(startIndex,endIndex).trim();
}

function compileDeclaration(declaration,name,context){
  return Function(
    ...Object.keys(context),
    `"use strict";\n${declaration}\nreturn ${name};`
  )(...Object.values(context));
}

const editLockSource = declarationBetween(
  invoiceClassicScript,
  "const bankSettledInvoiceEditControlIds = Object.freeze([",
  "window.trackInvoiceCreated = async function(parameters){"
);
const reopenInvoiceDeclaration = declarationBetween(
  invoiceClassicScript,
  "async function reopenInvoice(invoiceId){",
  "async function duplicateInvoice(invoiceId){"
);
const updateExistingInvoiceDeclaration = declarationBetween(
  invoiceClassicScript,
  "async function updateExistingInvoice(){",
  "function cancelInvoiceEdit(){"
);
const updateInvoiceFirestoreDeclaration = declarationBetween(
  invoiceModuleScript,
  "window.updateInvoiceInFirestore = async function(invoiceId, updatedInvoice, expectedState){",
  "window.deleteInvoiceFromFirestore = async function(invoiceId){"
);

function createControl(value = ""){
  return {
    value,
    disabled:false,
    title:"",
    attributes:{},
    setAttribute(name,nextValue){
      this.attributes[name] = nextValue;
    }
  };
}

function compileEditLock(document){
  return Function(
    "document",
    `"use strict";\n${editLockSource}\nreturn {\n` +
      "  ids:bankSettledInvoiceEditControlIds,\n" +
      "  lock:setBankSettledInvoiceEditLock\n" +
      "};"
  )(document);
}

function editableInvoiceElements(overrides = {}){
  const values = {
    clientName:"Customer Ltd",
    clientEmail:"customer@example.com",
    invoiceNumber:"INV-001",
    description1:"Services",
    amount1:"100",
    description2:"",
    amount2:"0",
    description3:"",
    amount3:"0",
    vatRate:"0.20",
    businessName:"Simple Books Ltd",
    businessEmail:"hello@example.com",
    businessWebsite:"https://example.com",
    businessVat:"GB123456789",
    clientAddress:"1 High Street",
    paymentTerms:"14 days",
    dueDate:"2026-08-28",
    recurringInvoice:"No",
    recurringFrequency:"",
    nextInvoiceDate:"",
    reminderDate:"",
    invoiceDate:"2026-08-14",
    projectSelect:"project-1",
    savedCustomerSelect:"customer-1",
    ...overrides
  };
  const elements = Object.fromEntries(
    Object.entries(values).map(([id,value]) => [id,createControl(value)])
  );

  elements.updateInvoiceBtn = createControl();
  elements.editModeStatus = { textContent:"" };
  return elements;
}

function compileUpdateExistingInvoice({ currentInvoice,elements,windowOverrides = {} }){
  const alert = vi.fn();
  const setBankSettledInvoiceEditLock = vi.fn();
  const updateInvoiceInFirestore = vi.fn().mockResolvedValue({ editedAt:"2026-08-20T12:00:00.000Z" });
  const postInvoiceJournalAfterInvoiceSave = vi.fn().mockResolvedValue(true);
  const context = {
    editingInvoiceId:currentInvoice.id,
    editingInvoiceExpectedState:{ expected:true },
    bankSettlementSourceStatePromise,
    invoiceBusinessLogicPromise,
    window:{
      getInvoicesFromFirestore:vi.fn().mockResolvedValue([currentInvoice]),
      updateInvoiceInFirestore,
      ...windowOverrides
    },
    localStorage:{ getItem:vi.fn(() => "[]") },
    alert,
    setBankSettledInvoiceEditLock,
    document:{ getElementById:id => elements[id] || createControl() },
    selectedInvoiceProject:() => ({
      projectId:"project-1",
      projectName:"Alpha",
      projectReference:"P-001"
    }),
    updateDueDateFromInvoiceDate:vi.fn(),
    selectedInvoiceDate:() => ({ display:"14/08/2026" }),
    postInvoiceJournalAfterInvoiceSave,
    generateInvoice:vi.fn().mockResolvedValue(undefined),
    resetInvoiceDateToToday:vi.fn(),
    renderRecentInvoices:vi.fn(),
    console
  };
  const updateExistingInvoice = compileDeclaration(
    updateExistingInvoiceDeclaration,
    "updateExistingInvoice",
    context
  );

  return {
    alert,
    postInvoiceJournalAfterInvoiceSave,
    setBankSettledInvoiceEditLock,
    updateExistingInvoice,
    updateInvoiceInFirestore
  };
}

describe("Bank-settled invoice editing", () => {
  it("uses the trusted penny-normalised totals for new Invoice persistence",() => {
    const generateInvoiceSource = declarationBetween(
      invoiceClassicScript,
      "async function generateInvoice(saveToHistory = true){",
      "function printInvoice(){"
    );

    expect(generateInvoiceSource).toContain(
      "const { calculateInvoiceTotals } = await invoiceBusinessLogicPromise"
    );
    expect(generateInvoiceSource).toContain(
      "const { subtotal:amount,vat,total } = calculateInvoiceTotals(activeItems,vatRate)"
    );
    expect(generateInvoiceSource).toContain(
      "saveInvoiceToHistory(invoiceNo, client, amount, vat, total, activeItems)"
    );
    expect(generateInvoiceSource).not.toContain("const vat = amount * vatRate");
  });

  it("locks every field written by the whole-invoice update path", () => {
    const elements = editableInvoiceElements();
    const document = { getElementById:id => elements[id] || null };
    const { ids,lock } = compileEditLock(document);

    expect(ids).toEqual(expect.arrayContaining([
      "invoiceNumber",
      "invoiceDate",
      "clientName",
      "projectSelect",
      "description1",
      "amount1",
      "amount2",
      "amount3",
      "vatRate",
      "paymentTerms",
      "dueDate"
    ]));

    lock(true,BANK_SETTLEMENT_ACCOUNTING_MESSAGE);

    ids.forEach(id => {
      expect(elements[id].disabled).toBe(true);
      expect(elements[id].attributes["aria-readonly"]).toBe("true");
      expect(elements[id].title).toBe(BANK_SETTLEMENT_ACCOUNTING_MESSAGE);
    });
    expect(elements.updateInvoiceBtn.disabled).toBe(true);
  });

  it.each([
    ["line-item amount and resulting total",{ amount1:"999" }],
    ["line-item composition",{ amount1:"50",amount2:"75" }],
    ["VAT rate",{ vatRate:"0" }],
    ["invoice date",{ invoiceDate:"2026-09-01" }],
    ["client attribution",{ clientName:"Different Customer" }],
    ["project attribution",{ projectSelect:"project-2" }]
  ])("blocks a stale/DevTools save changing %s",async (_label,changes) => {
    const currentInvoice = {
      id:"settled",
      invoiceNo:"INV-SETTLED",
      amount:100,
      vat:20,
      total:120,
      bankSettlement:settlementMarker
    };
    const elements = editableInvoiceElements(changes);
    const {
      alert,
      postInvoiceJournalAfterInvoiceSave,
      updateExistingInvoice,
      updateInvoiceInFirestore
    } = compileUpdateExistingInvoice({ currentInvoice,elements });

    await expect(updateExistingInvoice()).resolves.toBeUndefined();

    expect(alert).toHaveBeenCalledWith(BANK_SETTLEMENT_ACCOUNTING_MESSAGE);
    expect(updateInvoiceInFirestore).not.toHaveBeenCalled();
    expect(postInvoiceJournalAfterInvoiceSave).not.toHaveBeenCalled();
  });

  it("opens a settled invoice read-only with a clear Banking instruction", async () => {
    const invoice = {
      id:"settled",
      invoiceNo:"INV-SETTLED",
      bankSettlement:settlementMarker
    };
    const elements = editableInvoiceElements();
    const alert = vi.fn();
    const populateInvoiceForm = vi.fn().mockResolvedValue(undefined);
    const setBankSettledInvoiceEditLock = vi.fn();
    const reopenInvoice = compileDeclaration(
      reopenInvoiceDeclaration,
      "reopenInvoice",
      {
        bankSettlementSourceStatePromise,
        window:{
          getInvoicesFromFirestore:vi.fn().mockResolvedValue([invoice]),
          captureInvoiceEditExpectedState:vi.fn(() => ({ expected:true }))
        },
        localStorage:{ getItem:vi.fn(() => "[]") },
        editingInvoiceId:null,
        editingInvoiceExpectedState:null,
        document:{ getElementById:id => elements[id] },
        populateInvoiceForm,
        setBankSettledInvoiceEditLock,
        alert
      }
    );

    await reopenInvoice("settled");

    expect(populateInvoiceForm).toHaveBeenCalledWith(invoice);
    expect(elements.updateInvoiceBtn.disabled).toBe(true);
    expect(elements.editModeStatus.textContent).toContain(BANK_SETTLEMENT_ACCOUNTING_MESSAGE);
    expect(setBankSettledInvoiceEditLock).toHaveBeenLastCalledWith(
      true,
      BANK_SETTLEMENT_ACCOUNTING_MESSAGE
    );
    expect(alert).toHaveBeenCalledWith(BANK_SETTLEMENT_ACCOUNTING_MESSAGE);
  });

  it.each([
    ["an ordinary invoice",{ id:"ordinary",invoiceNo:"INV-ORDINARY" }],
    ["an invoice after Unmatch",{
      id:"unmatched",
      invoiceNo:"INV-UNMATCHED",
      previousBankSettlement:settlementMarker
    }]
  ])("allows accounting updates for %s",async (_label,currentInvoice) => {
    const elements = editableInvoiceElements();
    const {
      alert,
      postInvoiceJournalAfterInvoiceSave,
      updateExistingInvoice,
      updateInvoiceInFirestore
    } = compileUpdateExistingInvoice({ currentInvoice,elements });

    await updateExistingInvoice();

    expect(updateInvoiceInFirestore).toHaveBeenCalledOnce();
    expect(updateInvoiceInFirestore).toHaveBeenCalledWith(
      currentInvoice.id,
      expect.objectContaining({
        amount:100,
        vat:20,
        total:120,
        date:"14/08/2026",
        projectId:"project-1"
      }),
      { expected:true }
    );
    expect(postInvoiceJournalAfterInvoiceSave).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith("Invoice updated.");
  });

  it("persists edited Invoice net, VAT and total at penny precision",async () => {
    const currentInvoice = { id:"ordinary",invoiceNo:"INV-ORDINARY" };
    const { updateExistingInvoice,updateInvoiceInFirestore } = compileUpdateExistingInvoice({
      currentInvoice,
      elements:editableInvoiceElements({ amount1:"708.33",vatRate:"0.20" })
    });

    await updateExistingInvoice();

    expect(updateInvoiceInFirestore).toHaveBeenCalledWith(
      "ordinary",expect.objectContaining({amount:708.33,vat:141.67,total:850}),{expected:true}
    );
  });

  it("does not rewrite an already-inconsistent settled invoice", async () => {
    const currentInvoice = {
      id:"settled-inconsistent",
      invoiceNo:"INV-INCONSISTENT",
      amount:999,
      vat:199.8,
      total:1198.8,
      bankSettlement:settlementMarker
    };
    const originalInvoice = structuredClone(currentInvoice);
    const {
      updateExistingInvoice,
      updateInvoiceInFirestore
    } = compileUpdateExistingInvoice({
      currentInvoice,
      elements:editableInvoiceElements({ amount1:"100" })
    });

    await updateExistingInvoice();

    expect(updateInvoiceInFirestore).not.toHaveBeenCalled();
    expect(currentInvoice).toEqual(originalInvoice);
  });

  it("routes a direct save-layer call through the server gateway with expected state", async () => {
    const updateInvoiceWithReference = vi.fn().mockRejectedValue(Object.assign(
      new Error(BANK_SETTLEMENT_ACCOUNTING_MESSAGE),
      { code:"functions/failed-precondition",details:{ reason:"bank-settled-source" } }
    ));
    const window = { currentUser:{ uid:"user-1" } };
    const updateInvoiceInFirestore = compileDeclaration(
      updateInvoiceFirestoreDeclaration,
      "window.updateInvoiceInFirestore",
      {
        window,
        updateInvoiceWithReference,
        createRequestId:vi.fn(() => "123e4567-e89b-42d3-a456-426614174000"),
        console
      }
    );

    await expect(
      updateInvoiceInFirestore("settled",{ total:999 },{ bankSettlement:settlementMarker })
    ).rejects.toMatchObject({ details:{ reason:"bank-settled-source" } });
    expect(updateInvoiceWithReference).toHaveBeenCalledWith(expect.objectContaining({
      sourceId:"settled",payload:{total:999},expectedState:{bankSettlement:settlementMarker}
    }));
  });
});
