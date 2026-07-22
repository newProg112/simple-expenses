import { describe, expect, it } from "vitest";
import {
  calculateBillAmounts,
  normaliseVatRateOptionValue
} from "../resources/js/business-logic.js";
import { validateJournal } from "../resources/js/ledger-engine.js";
import {
  billJournalDocumentId,
  getJournalForSource,
  prepareBillJournal,
  replaceBillJournal,
  saveBillJournal,
  toFirestoreSafeObject
} from "../resources/js/ledger-firestore.js";

function bill(overrides = {}) {
  return {
    billNumber: "BILL-001",
    supplier: "Test Supplier",
    billDate: "2026-07-22",
    dueDate: "2026-08-05",
    category: "General",
    net: 100,
    vatRate: 0.2,
    vat: 20,
    total: 120,
    status: "Unpaid",
    ...overrides
  };
}

function createMockFirestore() {
  const documents = new Map();
  const api = {
    doc: (_db, collectionName, documentId) => ({ path: `${collectionName}/${documentId}` }),
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

describe("bill journal identity", () => {
  it("generates the expected deterministic bill document ID", () => {
    expect(billJournalDocumentId("user-1", "bill-document-1"))
      .toBe("bill_user-1_bill-document-1");
    expect(billJournalDocumentId("user-1", "bill-document-1"))
      .toBe(billJournalDocumentId("user-1", "bill-document-1"));
  });

  it("produces different IDs for different users", () => {
    expect(billJournalDocumentId("user-1", "bill-1"))
      .not.toBe(billJournalDocumentId("user-2", "bill-1"));
  });

  it("rejects missing user and bill IDs", () => {
    expect(() => billJournalDocumentId("", "bill-1")).toThrow("User ID is required");
    expect(() => billJournalDocumentId("user-1", "")).toThrow("Source ID is required");
  });
});

describe("bill journal preparation", () => {
  it("converts a £100 net plus £20 VAT bill into a valid journal", () => {
    const prepared = prepareBillJournal(
      "user-1",
      "bill-document-1",
      bill(),
      { createdAt: "2026-07-22T10:00:00.000Z", updatedAt: "2026-07-22T10:00:00.000Z" }
    );

    expect(prepared).toEqual(expect.objectContaining({
      userId: "user-1",
      journalId: "bill_user-1_bill-document-1",
      sourceType: "supplierBill",
      sourceId: "bill-document-1",
      sourceNumber: "BILL-001",
      description: "Supplier bill BILL-001 - Test Supplier"
    }));
    expect(prepared.lines).toEqual([
      expect.objectContaining({ accountCode: "5000", debit: 100, credit: 0 }),
      expect.objectContaining({ accountCode: "1200", debit: 20, credit: 0 }),
      expect.objectContaining({ accountCode: "2000", debit: 0, credit: 120 })
    ]);
    expect(validateJournal({ date: prepared.date, lines: prepared.lines }).valid).toBe(true);
  });

  it("omits the VAT line for a no-VAT bill", () => {
    const prepared = prepareBillJournal(
      "user-1",
      "bill-no-vat",
      bill({ vatRate: 0, vat: 0, total: 100 })
    );
    expect(prepared.lines.map(line => line.accountCode)).toEqual(["5000", "2000"]);
  });

  it.each([
    [0.05, 5, 105],
    [0.2, 20, 120]
  ])("supports VAT rate %s", (vatRate, vat, total) => {
    const prepared = prepareBillJournal(
      "user-1",
      `bill-vat-${vatRate}`,
      bill({ vatRate, vat, total })
    );
    expect(prepared.lines.find(line => line.accountCode === "1200")?.debit).toBe(vat);
    expect(prepared.lines.find(line => line.accountCode === "2000")?.credit).toBe(total);
  });

  it("derives VAT from the rate when the stored VAT amount is absent", () => {
    const data = bill({ vatRate: 0.2, total: 120 });
    delete data.vat;
    const prepared = prepareBillJournal("user-1", "bill-derived-vat", data);
    expect(prepared.lines.find(line => line.accountCode === "1200")?.debit).toBe(20);
  });

  it.each([
    ["Utilities", "5300"],
    [" Professional fees ", "5400"],
    ["Software/subscriptions", "5500"],
    ["Travel/mileage", "5200"],
    ["Unknown category", "5000"]
  ])("maps %s to expense account %s", (category, accountCode) => {
    const prepared = prepareBillJournal(
      "user-1",
      `bill-category-${accountCode}-${category}`,
      bill({ category })
    );
    expect(prepared.lines[0].accountCode).toBe(accountCode);
  });

  it("matches category labels case-insensitively", () => {
    const prepared = prepareBillJournal(
      "user-1",
      "bill-category-case",
      bill({ category: "  uTiLiTiEs  " })
    );
    expect(prepared.lines[0].accountCode).toBe("5300");
  });

  it("falls back to General Expenses for an older bill without a category", () => {
    const data = bill();
    delete data.category;
    const prepared = prepareBillJournal("user-1", "older-bill", data);
    expect(prepared.lines[0].accountCode).toBe("5000");
  });

  it("refuses inconsistent bill totals", () => {
    expect(() => prepareBillJournal(
      "user-1",
      "invalid-bill",
      bill({ total: 119 })
    )).toThrow("does not equal net plus VAT");
  });

  it("removes unsupported values from Firestore-safe data", () => {
    expect(toFirestoreSafeObject({
      keep: "value",
      remove: undefined,
      callback: () => {},
      nested: { amount: 20, remove: undefined }
    })).toEqual({ keep: "value", nested: { amount: 20 } });
  });
});

describe("bill edit VAT payload", () => {
  it("retains the 20% select option when reopening a stored numeric VAT rate", () => {
    expect(normaliseVatRateOptionValue(0.2, ["0.20", "0.05", "0"]))
      .toBe("0.20");
    expect(normaliseVatRateOptionValue(0.05, ["0.20", "0.05", "0"]))
      .toBe("0.05");
    expect(normaliseVatRateOptionValue(0, ["0.20", "0.05", "0"]))
      .toBe("0");
  });

  it("builds the complete £200 update payload from the reopened 20% value", () => {
    const reopenedVatRate = normaliseVatRateOptionValue(
      0.2,
      ["0.20", "0.05", "0"]
    );

    expect(calculateBillAmounts("200", reopenedVatRate)).toEqual({
      net: 200,
      vatRate: 0.2,
      vat: 40,
      total: 240
    });
  });
});

describe("mocked Firestore bill journal persistence", () => {
  it("saves one bill journal and loads it using the bill source", async () => {
    const { api, documents } = createMockFirestore();
    const result = await saveBillJournal(
      {}, "user-1", "bill-1", bill(), api,
      { now: () => "2026-07-22T10:00:00.000Z" }
    );

    expect(result.replaced).toBe(false);
    expect(documents.size).toBe(1);
    expect(await getJournalForSource(
      {}, "user-1", "supplierBill", "bill-1", api
    )).toEqual(expect.objectContaining({ id: result.documentId, sourceId: "bill-1" }));
  });

  it("replaces the same document and preserves createdAt when totals change", async () => {
    const { api, documents } = createMockFirestore();
    const createdAmounts = calculateBillAmounts("100", "0.20");
    await saveBillJournal(
      {}, "user-1", "bill-1", bill(createdAmounts), api,
      { now: () => "2026-07-22T10:00:00.000Z" }
    );
    const reopenedVatRate = normaliseVatRateOptionValue(
      0.2,
      ["0.20", "0.05", "0"]
    );
    const updatedAmounts = calculateBillAmounts("200", reopenedVatRate);
    const result = await replaceBillJournal(
      {}, "user-1", "bill-1",
      bill(updatedAmounts),
      api,
      { now: () => "2026-07-23T11:00:00.000Z" }
    );

    expect(result.replaced).toBe(true);
    expect(documents.size).toBe(1);
    expect(result.documentId).toBe("bill_user-1_bill-1");
    expect(result.journal.createdAt).toBe("2026-07-22T10:00:00.000Z");
    expect(result.journal.updatedAt).toBe("2026-07-23T11:00:00.000Z");
    expect(result.journal.lines.find(line => line.accountCode === "5000")?.debit).toBe(200);
    expect(result.journal.lines.find(line => line.accountCode === "1200")?.debit).toBe(40);
    expect(result.journal.lines.find(line => line.accountCode === "2000")?.credit).toBe(240);
  });

  it("replaces a taxable bill with a no-VAT update without a VAT line", async () => {
    const { api, documents } = createMockFirestore();
    await saveBillJournal(
      {}, "user-1", "bill-no-vat-update", bill(), api,
      { now: () => "2026-07-22T10:00:00.000Z" }
    );
    const noVatAmounts = calculateBillAmounts("200", "0");
    const result = await replaceBillJournal(
      {}, "user-1", "bill-no-vat-update", bill(noVatAmounts), api,
      { now: () => "2026-07-23T11:00:00.000Z" }
    );

    expect(documents.size).toBe(1);
    expect(result.journal.lines.map(line => line.accountCode)).toEqual(["5000", "2000"]);
    expect(result.journal.lines[0].debit).toBe(200);
    expect(result.journal.lines[1].credit).toBe(200);
  });

  it("never writes an invalid bill journal", async () => {
    const { api, documents } = createMockFirestore();
    await expect(replaceBillJournal(
      {}, "user-1", "bill-1", bill({ total: 999 }), api
    )).rejects.toThrow("does not equal net plus VAT");
    expect(documents.size).toBe(0);
  });
});
