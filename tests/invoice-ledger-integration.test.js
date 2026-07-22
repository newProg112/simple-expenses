import { describe, expect, it } from "vitest";
import { validateJournal } from "../resources/js/ledger-engine.js";
import {
  getJournalForSource,
  hasJournalForSourceInFirestore,
  invoiceJournalDocumentId,
  prepareInvoiceJournal,
  replaceInvoiceJournal,
  saveInvoiceJournal,
  toFirestoreSafeObject
} from "../resources/js/ledger-firestore.js";

function invoice(overrides = {}) {
  return {
    invoiceNo: "INV-1004",
    date: "22/07/2026",
    client: "Test Customer",
    items: [{ description: "Bookkeeping", amount: 100 }],
    amount: 100,
    vat: 20,
    total: 120,
    status: "Unpaid",
    ...overrides
  };
}

function createMockFirestore() {
  const documents = new Map();
  const api = {
    doc: (_db, collectionName, documentId) => ({
      path: `${collectionName}/${documentId}`
    }),
    getDoc: async reference => ({
      exists: () => documents.has(reference.path),
      data: () => documents.get(reference.path)
    }),
    setDoc: async (reference, data) => {
      documents.set(reference.path, structuredClone(data));
    }
  };

  return { api, documents };
}

describe("invoice journal identity", () => {
  it("generates a deterministic document ID from user and invoice document IDs", () => {
    expect(invoiceJournalDocumentId("user-1", "firestore-invoice-1"))
      .toBe("invoice_user-1_firestore-invoice-1");
    expect(invoiceJournalDocumentId("user-1", "firestore-invoice-1"))
      .toBe(invoiceJournalDocumentId("user-1", "firestore-invoice-1"));
  });

  it("keeps otherwise identical invoice IDs separate between users", () => {
    expect(invoiceJournalDocumentId("user-1", "invoice-1"))
      .not.toBe(invoiceJournalDocumentId("user-2", "invoice-1"));
  });

  it("safely encodes path separators", () => {
    expect(invoiceJournalDocumentId("user/1", "invoice/1")).not.toContain("/");
  });

  it("rejects missing user and invoice IDs", () => {
    expect(() => invoiceJournalDocumentId("", "invoice-1")).toThrow("User ID is required");
    expect(() => invoiceJournalDocumentId("user-1", "")).toThrow("Source ID is required");
  });
});

describe("invoice journal preparation", () => {
  it("converts existing invoice fields into a valid journal document", () => {
    const prepared = prepareInvoiceJournal(
      "user-1",
      "firestore-invoice-1",
      invoice(),
      { createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" }
    );

    expect(prepared).toEqual(expect.objectContaining({
      userId: "user-1",
      journalId: "invoice_user-1_firestore-invoice-1",
      date: "2026-07-22",
      sourceType: "salesInvoice",
      sourceId: "firestore-invoice-1",
      sourceNumber: "INV-1004",
      description: "Sales invoice INV-1004 - Test Customer",
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z"
    }));
    expect(validateJournal({ date: prepared.date, lines: prepared.lines }).valid).toBe(true);
  });

  it("does not prepare an invalid or unbalanced source invoice", () => {
    expect(() => prepareInvoiceJournal(
      "user-1",
      "invoice-1",
      invoice({ total: 119 })
    )).toThrow("does not equal net plus VAT");
  });

  it("removes unsupported values during Firestore-safe serialization", () => {
    const safe = toFirestoreSafeObject({
      keep: "value",
      remove: undefined,
      callback: () => {},
      nested: { keep: 1, remove: undefined },
      date: new Date("2026-07-22T10:00:00.000Z")
    });

    expect(safe).toEqual({
      keep: "value",
      nested: { keep: 1 },
      date: "2026-07-22T10:00:00.000Z"
    });
  });
});

describe("mocked Firestore invoice journal persistence", () => {
  it("saves one deterministic journal and can load it by source", async () => {
    const { api, documents } = createMockFirestore();
    const result = await saveInvoiceJournal(
      {}, "user-1", "invoice-1", invoice(), api,
      { now: () => "2026-07-22T10:00:00.000Z" }
    );

    expect(result.replaced).toBe(false);
    expect(documents.size).toBe(1);
    expect(await getJournalForSource(
      {}, "user-1", "salesInvoice", "invoice-1", api
    )).toEqual(expect.objectContaining({
      id: result.documentId,
      sourceId: "invoice-1"
    }));
    expect(await hasJournalForSourceInFirestore(
      {}, "user-1", "salesInvoice", "invoice-1", api
    )).toBe(true);
  });

  it("replaces the same document when invoice totals change", async () => {
    const { api, documents } = createMockFirestore();
    await saveInvoiceJournal(
      {}, "user-1", "invoice-1", invoice(), api,
      { now: () => "2026-07-22T10:00:00.000Z" }
    );
    const result = await replaceInvoiceJournal(
      {}, "user-1", "invoice-1",
      invoice({
        items: [{ description: "Bookkeeping", amount: 200 }],
        amount: 200,
        vat: 40,
        total: 240
      }),
      api,
      { now: () => "2026-07-23T11:00:00.000Z" }
    );

    expect(result.replaced).toBe(true);
    expect(documents.size).toBe(1);
    expect(result.journal.createdAt).toBe("2026-07-22T10:00:00.000Z");
    expect(result.journal.updatedAt).toBe("2026-07-23T11:00:00.000Z");
    expect(result.journal.lines[0].debit).toBe(240);
  });

  it("does not call setDoc when journal preparation fails", async () => {
    const { api, documents } = createMockFirestore();

    await expect(replaceInvoiceJournal(
      {}, "user-1", "invoice-1", invoice({ total: 999 }), api
    )).rejects.toThrow("does not equal net plus VAT");
    expect(documents.size).toBe(0);
  });
});
