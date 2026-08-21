import { describe, expect, it, vi } from "vitest";
import {
  importInvoicesWithProtectedCreate,
  invoiceCreatePayloadFromBackup
} from "../resources/js/invoice-import.js";

function invoice(overrides = {}){
  return {
    id: "untrusted-backup-id",
    invoiceNo: "INV-IMPORT-001",
    invoiceNumber: "legacy-alias",
    client: "Import Customer",
    clientEmail: "customer@example.test",
    clientAddress: "1 Import Road",
    paymentTerms: "14 days",
    dueDate: "2026-09-04",
    amount: 100,
    vat: 20,
    total: 120,
    items: [{ description: "Services", amount: 100, untrusted: true }],
    status: "Unpaid",
    date: "21/08/2026",
    recurringInvoice: "No",
    recurringFrequency: "",
    nextInvoiceDate: "",
    reminderDate: "",
    projectId: "",
    projectName: "",
    projectReference: "",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-02T00:00:00.000Z",
    paidAt: "2020-01-03T00:00:00.000Z",
    bankSettlement: { transactionId: "must-not-import" },
    ...overrides
  };
}

describe("protected Invoice backup import", () => {
  it("projects backup data onto the existing protected create schema", () => {
    const payload = invoiceCreatePayloadFromBackup(invoice({ status: "Paid" }));
    expect(payload).toMatchObject({
      invoiceNo: "INV-IMPORT-001",
      status: "Unpaid",
      items: [{ description: "Services", amount: 100 }]
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("invoiceNumber");
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("paidAt");
    expect(payload).not.toHaveProperty("bankSettlement");
    expect(payload.items[0]).not.toHaveProperty("untrusted");
  });

  it("uses protected create for every successful record and restores only Paid status", async () => {
    const createInvoice = vi.fn()
      .mockResolvedValueOnce("source-unpaid")
      .mockResolvedValueOnce("source-paid");
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const result = await importInvoicesWithProtectedCreate({
      invoices: [invoice(), invoice({ invoiceNo: "INV-IMPORT-002", status: "Paid" })],
      existingInvoices: [],
      createInvoice,
      updateStatus
    });

    expect(result).toMatchObject({
      importedCount: 2,
      skippedDuplicateCount: 0,
      failedCount: 0,
      statusRestoreFailedCount: 0
    });
    expect(createInvoice).toHaveBeenCalledTimes(2);
    expect(createInvoice.mock.calls.every(([payload]) => payload.status === "Unpaid")).toBe(true);
    expect(updateStatus).toHaveBeenCalledOnce();
    expect(updateStatus).toHaveBeenCalledWith("source-paid", "Paid");
  });

  it("skips local duplicates and canonical conflicts rejected by the server", async () => {
    const canonicalConflict = Object.assign(new Error("reserved"), {
      code: "functions/already-exists"
    });
    const createInvoice = vi.fn().mockRejectedValue(canonicalConflict);
    const result = await importInvoicesWithProtectedCreate({
      invoices: [
        invoice({ invoiceNo: " inv-existing " }),
        invoice({ invoiceNo: "INV / 500" })
      ],
      existingInvoices: [invoice({ invoiceNo: "INV-EXISTING" })],
      createInvoice,
      updateStatus: vi.fn()
    });

    expect(result).toMatchObject({
      importedCount: 0,
      skippedDuplicateCount: 2,
      failedCount: 0
    });
    expect(createInvoice).toHaveBeenCalledOnce();
  });

  it("does not reinterpret a retired-reference rejection as a reusable duplicate", async () => {
    const retired = Object.assign(new Error("permanent tombstone"), {
      code: "functions/failed-precondition",
      details: { reason: "retired-reference" }
    });
    const result = await importInvoicesWithProtectedCreate({
      invoices: [invoice()],
      existingInvoices: [],
      createInvoice: vi.fn().mockRejectedValue(retired),
      updateStatus: vi.fn()
    });

    expect(result).toMatchObject({
      importedCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 1
    });
    expect(result.failures[0].error).toBe(retired);
  });
});
