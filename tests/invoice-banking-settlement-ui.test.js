import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BANK_SETTLEMENT_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  isBankingSettledSource
} from "../resources/js/bank-settlement-source-state.js";

const invoiceHtml = readFileSync(
  new URL("../resources/tools/invoice-generator.html", import.meta.url),
  "utf8"
);

const inlineScripts = [...invoiceHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]);
const invoiceModuleScript = inlineScripts.find(source =>
  source.includes("replaceInvoiceJournal")
);
const invoiceClassicScript = inlineScripts.find(source =>
  source.includes("async function renderRecentInvoices()")
);

function declarationBetween(source, start, next){
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(next, startIndex);

  if(startIndex < 0 || endIndex < 0){
    throw new Error(`Could not extract ${start}`);
  }

  return source.slice(startIndex, endIndex).trim();
}

function compileDeclaration(declaration, name, context){
  return Function(
    ...Object.keys(context),
    `"use strict";\n${declaration}\nreturn ${name};`
  )(...Object.values(context));
}

const renderRecentInvoicesDeclaration = declarationBetween(
  invoiceClassicScript,
  "async function renderRecentInvoices(){",
  "async function toggleInvoiceStatus(invoiceId){"
);
const toggleInvoiceStatusDeclaration = declarationBetween(
  invoiceClassicScript,
  "async function toggleInvoiceStatus(invoiceId){",
  "async function populateInvoiceForm(invoice){"
);
const updateInvoiceStatusDeclaration = declarationBetween(
  invoiceModuleScript,
  "window.updateInvoiceStatusInFirestore = async function(invoiceId, newStatus){",
  "window.importInvoicesToFirestore = async function(invoices, existingInvoices){"
);

const bankSettlementSourceStatePromise = Promise.resolve({
  BANK_SETTLEMENT_ACCOUNTING_MESSAGE,
  BANK_SETTLEMENT_STATUS_MESSAGE,
  isBankingSettledSource
});

describe("Invoice Banking settlement UI", () => {
  it("loads settlement state in the classic script that owns the invoice guards", () => {
    expect(invoiceModuleScript).toContain("bank-settlement-source-state.js");
    expect(invoiceModuleScript).toContain("window.updateInvoiceInFirestore");
    expect(invoiceClassicScript).toContain(
      'const bankSettlementSourceStatePromise =\n  import("../js/bank-settlement-source-state.js?v=20260816-banking25");'
    );
    expect(invoiceClassicScript).toMatch(
      /async function renderRecentInvoices\(\)\{[\s\S]*?\} = await bankSettlementSourceStatePromise;[\s\S]*?isBankingSettledSource\(invoice\)/
    );
    expect(invoiceClassicScript).toMatch(
      /async function toggleInvoiceStatus\(invoiceId\)\{[\s\S]*?\} = await bankSettlementSourceStatePromise;[\s\S]*?isBankingSettledSource\(invoice\)/
    );
  });

  it("renders two invoices and protects only the Banking-settled payment action", async () => {
    const recentInvoices = { innerHTML:"No invoices saved yet." };
    const invoiceResultsCount = { textContent:"" };
    const invoiceSort = { value:"newest" };
    const invoices = [
      {
        id:"ordinary",
        invoiceNo:"INV-ORDINARY",
        date:"2026-08-13",
        client:"Ordinary Customer",
        total:120,
        status:"Unpaid"
      },
      {
        id:"settled",
        invoiceNo:"INV-SETTLED",
        date:"2026-08-14",
        client:"Settled Customer",
        total:240,
        status:"Paid",
        bankSettlement:{
          version:1,
          transactionId:"bank-transaction-1",
          journalId:"bank-settlement_user-1_bank-transaction-1"
        }
      }
    ];
    const elements = { recentInvoices, invoiceResultsCount, invoiceSort };
    const context = {
      bankSettlementSourceStatePromise,
      getInvoiceUser:vi.fn().mockResolvedValue(null),
      window:{},
      localStorage:{
        getItem:vi.fn(() => JSON.stringify(invoices))
      },
      normaliseInvoiceDate:value => ({
        date:new Date(`${value}T00:00:00`),
        display:value
      }),
      renderDashboardTotals:vi.fn(),
      renderRevenueChart:vi.fn(),
      renderStatusChart:vi.fn(),
      renderMonthlyRevenueBarChart:vi.fn(),
      renderAgeingChart:vi.fn(),
      filterInvoices:value => value,
      document:{
        getElementById:id => elements[id] || null
      },
      isInvoiceOverdue:() => false,
      getInvoiceAgeingText:() => "Not overdue",
      escapeInvoiceHtml:value => String(value)
    };
    const renderRecentInvoices = compileDeclaration(
      renderRecentInvoicesDeclaration,
      "renderRecentInvoices",
      context
    );

    await expect(renderRecentInvoices()).resolves.toBeUndefined();

    expect(invoiceResultsCount.textContent).toBe("Showing 2 invoices");
    expect(recentInvoices.innerHTML).not.toContain("No invoices saved yet.");
    expect(recentInvoices.innerHTML.match(/<div class="invoice-row">/g)).toHaveLength(2);
    expect(recentInvoices.innerHTML).toContain(
      `onclick="toggleInvoiceStatus('settled')" disabled title="${BANK_SETTLEMENT_STATUS_MESSAGE}" aria-describedby="invoice-settlement-note-settled"`
    );
    expect(recentInvoices.innerHTML).toContain(
      `onclick="toggleInvoiceStatus('ordinary')">`
    );
    expect(recentInvoices.innerHTML).toContain(
      `onclick="reopenInvoice('settled')" aria-describedby="invoice-settlement-note-settled"`
    );
    expect(recentInvoices.innerHTML).toContain(
      `${BANK_SETTLEMENT_ACCOUNTING_MESSAGE} ${BANK_SETTLEMENT_STATUS_MESSAGE}</span>`
    );
  });

  it("keeps the Banking-settled toggle guard and existing message", async () => {
    const alert = vi.fn();
    const renderRecentInvoices = vi.fn();
    const settledInvoice = {
      id:"settled",
      status:"Paid",
      bankSettlement:{
        version:1,
        transactionId:"bank-transaction-1",
        journalId:"bank-settlement_user-1_bank-transaction-1"
      }
    };
    const toggleInvoiceStatus = compileDeclaration(
      toggleInvoiceStatusDeclaration,
      "toggleInvoiceStatus",
      {
        window:{},
        localStorage:{
          getItem:vi.fn(() => JSON.stringify([settledInvoice]))
        },
        alert,
        bankSettlementSourceStatePromise,
        renderRecentInvoices
      }
    );

    await expect(toggleInvoiceStatus("settled")).resolves.toBeUndefined();

    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(BANK_SETTLEMENT_STATUS_MESSAGE);
    expect(renderRecentInvoices).not.toHaveBeenCalled();
  });

  it.each([
    ["Unpaid", "Paid"],
    ["Paid", "Unpaid"]
  ])("changes an ordinary Invoice from %s to %s through the status-only path", async (status, expected) => {
    const updateInvoiceStatusInFirestore = vi.fn();
    const toggleInvoiceStatus = compileDeclaration(
      toggleInvoiceStatusDeclaration,
      "toggleInvoiceStatus",
      {
        window:{
          getInvoicesFromFirestore:vi.fn(async () => [{ id:"ordinary",status }]),
          updateInvoiceStatusInFirestore
        },
        localStorage:{ getItem:vi.fn() },
        alert:vi.fn(),
        bankSettlementSourceStatePromise,
        renderRecentInvoices:vi.fn()
      }
    );

    await toggleInvoiceStatus("ordinary");

    expect(updateInvoiceStatusInFirestore).toHaveBeenCalledWith("ordinary", expected);
  });

  it("persists manual Invoice Paid/Unpaid as status only, without paidAt or a journal mutation", () => {
    expect(updateInvoiceStatusDeclaration).toContain("updateDoc(");
    expect(updateInvoiceStatusDeclaration).toContain("status: newStatus");
    expect(updateInvoiceStatusDeclaration).not.toContain("paidAt");
    expect(updateInvoiceStatusDeclaration).not.toMatch(/replaceInvoiceJournal|createBankSettlementJournal|bankSettlement/);
  });
});
