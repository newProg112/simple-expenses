import { describe, expect, it } from "vitest";
import { validateJournal } from "../resources/js/ledger-engine.js";
import {
  expenseJournalDocumentId,
  isMileageExpenseRecord,
  prepareExpenseJournal,
  replaceExpenseJournal,
  saveExpenseJournal,
  toFirestoreSafeObject
} from "../resources/js/ledger-firestore.js";

function expense(overrides = {}) {
  return {
    type: "expense",
    date: "2026-07-23",
    merchant: "Test Merchant",
    category: "General",
    description: "Client supplies",
    net: 100,
    vatRate: 0.2,
    vat: 20,
    gross: 120,
    status: "Draft",
    projectId: "project-1",
    attachmentUrl: "https://example.test/receipt.pdf",
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

describe("expense journal identity", () => {
  it("uses one deterministic journal ID for the same user and expense document", () => {
    expect(expenseJournalDocumentId("user-1", "expense-document-1"))
      .toBe("expense_user-1_expense-document-1");
    expect(expenseJournalDocumentId("user-1", "expense-document-1"))
      .toBe(expenseJournalDocumentId("user-1", "expense-document-1"));
  });

  it("includes the user ID to prevent cross-user collisions", () => {
    expect(expenseJournalDocumentId("user-1", "expense-1"))
      .not.toBe(expenseJournalDocumentId("user-2", "expense-1"));
  });

  it("rejects missing user and expense IDs", () => {
    expect(() => expenseJournalDocumentId("", "expense-1"))
      .toThrow("User ID is required");
    expect(() => expenseJournalDocumentId("user-1", ""))
      .toThrow("Source ID is required");
  });
});

describe("ordinary expense preparation", () => {
  it("converts £100 net plus £20 VAT to a valid reimbursement journal", () => {
    const prepared = prepareExpenseJournal(
      "user-1",
      "expense-document-1",
      expense(),
      {
        createdAt: "2026-07-23T09:00:00.000Z",
        updatedAt: "2026-07-23T09:00:00.000Z"
      }
    );

    expect(prepared).toEqual(expect.objectContaining({
      userId: "user-1",
      journalId: "expense_user-1_expense-document-1",
      sourceType: "expenseClaim",
      sourceId: "expense-document-1",
      sourceNumber: "expense-document-1"
    }));
    expect(prepared.description).toContain("Test Merchant");
    expect(prepared.description).toContain("Client supplies");
    expect(prepared.lines).toEqual([
      expect.objectContaining({ accountCode: "5000", debit: 100, credit: 0 }),
      expect.objectContaining({ accountCode: "1200", debit: 20, credit: 0 }),
      expect.objectContaining({ accountCode: "2200", debit: 0, credit: 120 })
    ]);
    expect(validateJournal({ date: prepared.date, lines: prepared.lines }).valid)
      .toBe(true);
  });

  it.each([
    [0, 0, 100, 2],
    [0.05, 5, 105, 3],
    [0.2, 20, 120, 3]
  ])("supports production VAT rate %s", (vatRate, vat, gross, lineCount) => {
    const prepared = prepareExpenseJournal(
      "user-1",
      `expense-${vatRate}`,
      expense({ vatRate, vat: undefined, gross })
    );

    expect(prepared.lines).toHaveLength(lineCount);
    expect(prepared.lines.at(-1)).toEqual(
      expect.objectContaining({ accountCode: "2200", credit: gross })
    );
    if (vat) {
      expect(prepared.lines[1]).toEqual(
        expect.objectContaining({ accountCode: "1200", debit: vat })
      );
    } else {
      expect(prepared.lines.some(line => line.accountCode === "1200")).toBe(false);
    }
  });

  it("supports a gross-only production-shaped expense", () => {
    const prepared = prepareExpenseJournal(
      "user-1",
      "gross-only",
      expense({ net: undefined, vat: undefined, vatRate: 0.2, gross: 120 })
    );

    expect(prepared.lines).toEqual([
      expect.objectContaining({ accountCode: "5000", debit: 100 }),
      expect.objectContaining({ accountCode: "1200", debit: 20 }),
      expect.objectContaining({ accountCode: "2200", credit: 120 })
    ]);
  });

  it.each([
    ["General", "5000"],
    ["Travel", "5200"],
    ["Meals", "5000"],
    ["Office", "5000"],
    ["Software", "5500"],
    ["Utilities", "5300"],
    ["Professional fees", "5400"],
    ["Other", "5000"],
    ["  PROFESSIONAL   FEES  ", "5400"],
    ["Unknown production category", "5000"]
  ])("maps production category %s to %s", (category, accountCode) => {
    const prepared = prepareExpenseJournal(
      "user-1",
      `category-${accountCode}-${category}`,
      expense({ category, vat: 0, vatRate: 0, gross: 100 })
    );
    expect(prepared.lines[0].accountCode).toBe(accountCode);
  });

  it("refuses inconsistent totals", () => {
    expect(() => prepareExpenseJournal(
      "user-1",
      "invalid-total",
      expense({ gross: 119 })
    )).toThrow("does not equal net plus VAT");
  });

  it.each(["Draft", "Submitted", "Approved", "Paid"])(
    "recognises an explicitly saved %s expense without a bank posting",
    status => {
      const prepared = prepareExpenseJournal(
        "user-1",
        `status-${status}`,
        expense({ status })
      );
      expect(prepared.lines.some(line => line.accountCode === "1000")).toBe(false);
      expect(prepared.lines.at(-1).accountCode).toBe("2200");
    }
  );
});

describe("mileage exclusion", () => {
  it("identifies the production mileage discriminator", () => {
    expect(isMileageExpenseRecord({ type: "mileage", miles: 12 })).toBe(true);
    expect(isMileageExpenseRecord({ type: " MILEAGE " })).toBe(true);
    expect(isMileageExpenseRecord({ type: "expense" })).toBe(false);
  });

  it("does not call Firestore for a mileage-shaped record", async () => {
    const mock = createMockFirestore();
    const result = await saveExpenseJournal(
      {},
      "user-1",
      "mileage-1",
      { type: "mileage", date: "2026-07-23", miles: 10, amount: 5.5 },
      mock.api
    );

    expect(result).toEqual(expect.objectContaining({
      skipped: true,
      reason: "mileage"
    }));
    expect(mock.calls).toEqual({ getDoc: 0, setDoc: 0 });
    expect(mock.documents.size).toBe(0);
  });

  it("refuses direct preparation of mileage as an expense", () => {
    expect(() => prepareExpenseJournal(
      "user-1",
      "mileage-1",
      { type: "mileage" }
    )).toThrow("Mileage records are not eligible");
  });
});

describe("expense journal replacement", () => {
  it("creates then replaces the same document, preserving createdAt", async () => {
    const mock = createMockFirestore();
    const times = [
      "2026-07-23T10:00:00.000Z",
      "2026-07-23T11:00:00.000Z"
    ];

    const created = await saveExpenseJournal(
      {},
      "user-1",
      "expense-1",
      expense(),
      mock.api,
      { now: () => times[0] }
    );
    const replaced = await replaceExpenseJournal(
      {},
      "user-1",
      "expense-1",
      expense({ net: 200, vat: 40, gross: 240 }),
      mock.api,
      { now: () => times[1] }
    );

    expect(created.documentId).toBe(replaced.documentId);
    expect(created.replaced).toBe(false);
    expect(replaced.replaced).toBe(true);
    expect(replaced.journal.createdAt).toBe(times[0]);
    expect(replaced.journal.updatedAt).toBe(times[1]);
    expect(replaced.journal.lines).toEqual([
      expect.objectContaining({ accountCode: "5000", debit: 200 }),
      expect.objectContaining({ accountCode: "1200", debit: 40 }),
      expect.objectContaining({ accountCode: "2200", credit: 240 })
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
