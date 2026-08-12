import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { openAttachment, resolveAttachmentUrl } from "../resources/js/attachment-opening.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bills = read("resources/tools/bills.html");
const expenses = read("resources/tools/expenses.html");
const clients = read("resources/tools/client-tracker.html");

function services() {
  const pendingWindow = {
    opener: {},
    location: { replace: vi.fn() },
    close: vi.fn()
  };
  return {
    storage: { name: "storage" },
    storageRef: vi.fn((_storage, path) => ({ path })),
    getDownloadURL: vi.fn(async reference => `https://fresh.test/${reference.path}`),
    openWindow: vi.fn(() => pendingWindow),
    pendingWindow
  };
}

describe("attachment opening", () => {
  it("prefers attachmentPath and resolves a fresh Storage URL", async () => {
    const api = services();
    const url = await resolveAttachmentUrl({
      attachmentPath: "users/user-a/attachments/bills/bill-a/file.pdf",
      attachmentUrl: "https://legacy.test/bills/bill-a/file.pdf"
    }, api);

    expect(api.storageRef).toHaveBeenCalledWith(
      api.storage,
      "users/user-a/attachments/bills/bill-a/file.pdf"
    );
    expect(api.getDownloadURL).toHaveBeenCalledOnce();
    expect(url).toBe("https://fresh.test/users/user-a/attachments/bills/bill-a/file.pdf");
  });

  it("does not let a legacy attachmentUrl override or rescue a valid attachmentPath", async () => {
    const api = services();
    api.getDownloadURL.mockRejectedValue(new Error("permission denied"));

    await expect(openAttachment({
      attachmentPath: "users/user-a/attachments/bills/bill-a/file.pdf",
      attachmentUrl: "https://legacy.test/bills/bill-a/file.pdf"
    }, api)).rejects.toThrow("permission denied");

    expect(api.openWindow).toHaveBeenCalledTimes(1);
    expect(api.openWindow).toHaveBeenCalledWith("about:blank", "_blank");
    expect(api.pendingWindow.location.replace).not.toHaveBeenCalled();
    expect(api.pendingWindow.close).toHaveBeenCalledOnce();
  });

  it("falls back to attachmentUrl only when attachmentPath is absent", async () => {
    const api = services();
    const legacyUrl = "https://legacy.test/clients/client-a/file.pdf";

    await expect(openAttachment({ attachmentUrl: legacyUrl }, api)).resolves.toBe(legacyUrl);
    expect(api.storageRef).not.toHaveBeenCalled();
    expect(api.getDownloadURL).not.toHaveBeenCalled();
    expect(api.openWindow).toHaveBeenCalledWith(legacyUrl, "_blank", "noopener");
  });

  it("wires Bills, Expenses/mileage, and Clients through the same path-first opener", () => {
    for (const page of [bills, expenses, clients]) {
      expect(page).toContain('import { openAttachment } from "../js/attachment-opening.js');
      expect(page).toContain("storageRef,");
      expect(page).toContain("getDownloadURL,");
      expect(page).toContain("openWindow: (...args) => window.open(...args)");
    }

    expect(bills).toContain('data-bill-action="open-attachment"');
    expect(expenses).toContain("data-expense-attachment");
    expect(clients).toContain("data-client-attachment");
    expect(expenses).toContain('const isMileage = expense.type === "mileage"');
  });

  it("refreshes the Bills cache after a successful Firestore load", () => {
    expect(bills).toMatch(/currentBills = snapshot\.docs\.map[\s\S]*?billsLoadError = false;\s*saveBills\(currentBills\);/);
  });

  it("does not silently retain stale local Bills after authenticated Firestore failure", () => {
    expect(bills).toMatch(/catch \(error\) \{\s*console\.error\("Firestore bills load failed", error\);\s*currentBills = \[\];\s*billsLoadError = true;/);
    expect(bills).toContain("Bills could not be loaded. Refresh the page to try again.");
  });
});
