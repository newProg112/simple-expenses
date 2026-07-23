import { describe, expect, it } from "vitest";
import { validateJournal } from "../resources/js/ledger-engine.js";
import {
  mileageJournalDocumentId,
  prepareExpenseJournal,
  prepareMileageJournal,
  replaceMileageJournal,
  saveMileageJournal,
  toFirestoreSafeObject
} from "../resources/js/ledger-firestore.js";

function mileage(overrides = {}) {
  return {
    type: "mileage",
    date: "2026-07-23",
    from: "Home",
    to: "Client",
    businessPurpose: "Client meeting",
    miles: 100,
    ratePerMile: 0.55,
    amount: 55,
    gross: 55,
    status: "Draft",
    projectId: "project-1",
    attachmentUrl: "https://example.test/mileage.pdf",
    ...overrides
  };
}

function createMockFirestore() {
  const documents = new Map();
  const calls = { getDoc: 0, setDoc: 0 };
  const api = {
    doc: (_db, collectionName, documentId) => ({
      path: `${collectionName}/${documentId}`
    }),
    getDoc: async reference => {
      calls.getDoc += 1;
      return {
        exists: () => documents.has(reference.path),
        data: () => documents.get(reference.path)
      };
    },
    setDoc: async (reference, data) => {
      calls.setDoc += 1;
      documents.set(reference.path, structuredClone(data));
    }
  };

  return { api, calls, documents };
}

describe("mileage journal identity", () => {
  it("uses one deterministic ID for the same user and mileage document", () => {
    expect(mileageJournalDocumentId("user-1", "mileage-document-1"))
      .toBe("mileage_user-1_mileage-document-1");
    expect(mileageJournalDocumentId("user-1", "mileage-document-1"))
      .toBe(mileageJournalDocumentId("user-1", "mileage-document-1"));
  });

  it("includes the user ID to prevent cross-user collisions", () => {
    expect(mileageJournalDocumentId("user-1", "mileage-1"))
      .not.toBe(mileageJournalDocumentId("user-2", "mileage-1"));
  });

  it("rejects missing user and mileage IDs", () => {
    expect(() => mileageJournalDocumentId("", "mileage-1"))
      .toThrow("User ID is required");
    expect(() => mileageJournalDocumentId("user-1", ""))
      .toThrow("Source ID is required");
  });
});

describe("mileage journal preparation", () => {
  it("converts a £55 mileage claim to a valid no-VAT journal", () => {
    const prepared = prepareMileageJournal(
      "user-1",
      "mileage-document-1",
      mileage(),
      {
        createdAt: "2026-07-23T09:00:00.000Z",
        updatedAt: "2026-07-23T09:00:00.000Z"
      }
    );

    expect(prepared).toEqual(expect.objectContaining({
      userId: "user-1",
      journalId: "mileage_user-1_mileage-document-1",
      sourceType: "mileageClaim",
      sourceId: "mileage-document-1",
      sourceNumber: "mileage-document-1"
    }));
    expect(prepared.description).toContain("Home to Client");
    expect(prepared.description).toContain("Client meeting");
    expect(prepared.description).toContain("100 miles at £0.55");
    expect(prepared.lines).toEqual([
      expect.objectContaining({ accountCode: "5200", debit: 55, credit: 0 }),
      expect.objectContaining({ accountCode: "2200", debit: 0, credit: 55 })
    ]);
    expect(prepared.lines.some(line => line.accountCode === "1200")).toBe(false);
    expect(validateJournal({ date: prepared.date, lines: prepared.lines }).valid)
      .toBe(true);
  });

  it("uses a stored calculated claim amount when miles and rate are absent", () => {
    const prepared = prepareMileageJournal(
      "user-1",
      "stored-amount",
      mileage({
        miles: undefined,
        ratePerMile: undefined,
        amount: 55,
        gross: undefined
      })
    );
    expect(prepared.lines[0].debit).toBe(55);
  });

  it("derives the claim with the current production miles-times-rate logic", () => {
    const prepared = prepareMileageJournal(
      "user-1",
      "derived-amount",
      mileage({ amount: undefined, gross: undefined })
    );
    expect(prepared.lines[0].debit).toBe(55);
  });

  it("uses the saved production rate instead of inventing a rate", () => {
    const prepared = prepareMileageJournal(
      "user-1",
      "custom-rate",
      mileage({
        miles: 100,
        ratePerMile: 0.45,
        amount: 45,
        gross: 45
      })
    );
    expect(prepared.lines[0].debit).toBe(45);
    expect(prepared.description).toContain("£0.45");
  });

  it("rounds fractional mileage safely to two decimal places", () => {
    const prepared = prepareMileageJournal(
      "user-1",
      "fractional",
      mileage({
        miles: 12.5,
        ratePerMile: 0.55,
        amount: undefined,
        gross: undefined
      })
    );
    expect(prepared.lines[0].debit).toBe(6.88);
    expect(prepared.lines[1].credit).toBe(6.88);
  });

  it.each([
    ["zero", { miles: 0, ratePerMile: 0.55, amount: 0, gross: 0 }],
    ["negative", { amount: -1 }],
    ["NaN", { amount: Number.NaN }],
    ["infinite", { amount: Number.POSITIVE_INFINITY }]
  ])("rejects a %s claim amount", (_label, values) => {
    expect(() => prepareMileageJournal(
      "user-1",
      `invalid-${_label}`,
      mileage(values)
    )).toThrow();
  });

  it("rejects a stored amount inconsistent with miles and rate", () => {
    expect(() => prepareMileageJournal(
      "user-1",
      "inconsistent",
      mileage({ amount: 54, gross: 54 })
    )).toThrow("does not equal miles multiplied by rate");
  });

  it.each(["Draft", "Submitted", "Approved", "Paid"])(
    "recognises an explicitly saved %s claim without a bank posting",
    status => {
      const prepared = prepareMileageJournal(
        "user-1",
        `status-${status}`,
        mileage({ status })
      );
      expect(prepared.lines.some(line => line.accountCode === "1000")).toBe(false);
      expect(prepared.lines.map(line => line.accountCode)).toEqual(["5200", "2200"]);
    }
  );
});

describe("ordinary-expense separation", () => {
  it("does not call Firestore when ordinary expense data reaches the mileage adapter", async () => {
    const mock = createMockFirestore();
    const result = await saveMileageJournal(
      {},
      "user-1",
      "expense-1",
      {
        type: "expense",
        date: "2026-07-23",
        merchant: "Shop",
        net: 100,
        vat: 20,
        gross: 120
      },
      mock.api
    );

    expect(result).toEqual(expect.objectContaining({
      skipped: true,
      reason: "ordinaryExpense"
    }));
    expect(mock.calls).toEqual({ getDoc: 0, setDoc: 0 });
    expect(mock.documents.size).toBe(0);
  });

  it("refuses direct mileage preparation for an ordinary expense", () => {
    expect(() => prepareMileageJournal(
      "user-1",
      "expense-1",
      { type: "expense" }
    )).toThrow("Only mileage records are eligible");
  });

  it("continues to refuse mileage in the ordinary-expense adapter", () => {
    expect(() => prepareExpenseJournal(
      "user-1",
      "mileage-1",
      mileage()
    )).toThrow("Mileage records are not eligible");
  });
});

describe("mileage journal replacement", () => {
  it("regenerates changed values in the same document and preserves createdAt", async () => {
    const mock = createMockFirestore();
    const createdAt = "2026-07-23T10:00:00.000Z";
    const updatedAt = "2026-07-23T11:00:00.000Z";

    const created = await saveMileageJournal(
      {},
      "user-1",
      "mileage-1",
      mileage(),
      mock.api,
      { now: () => createdAt }
    );
    const replaced = await replaceMileageJournal(
      {},
      "user-1",
      "mileage-1",
      mileage({
        miles: 200,
        ratePerMile: 0.55,
        amount: 110,
        gross: 110
      }),
      mock.api,
      { now: () => updatedAt }
    );

    expect(created.documentId).toBe(replaced.documentId);
    expect(created.replaced).toBe(false);
    expect(replaced.replaced).toBe(true);
    expect(replaced.journal.createdAt).toBe(createdAt);
    expect(replaced.journal.updatedAt).toBe(updatedAt);
    expect(replaced.journal.lines).toEqual([
      expect.objectContaining({ accountCode: "5200", debit: 110 }),
      expect.objectContaining({ accountCode: "2200", credit: 110 })
    ]);
    expect(mock.documents.size).toBe(1);
  });

  it("removes unsupported Firestore values safely", () => {
    expect(toFirestoreSafeObject({
      kept: "value",
      missing: undefined,
      callback: () => {},
      symbol: Symbol("not stored"),
      nested: [1, undefined, "two"]
    })).toEqual({
      kept: "value",
      nested: [1, "two"]
    });
  });
});
