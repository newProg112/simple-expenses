import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bills = read("resources/tools/bills.html");
const expenses = read("resources/tools/expenses.html");
const clients = read("resources/tools/client-tracker.html");
const account = read("account.html");
const exportsPage = read("exports.html");
const legacyExpenses = read("expenses/webapp/index.html");
const firebase = JSON.parse(read("firebase.json"));
const rules = read("storage.rules");

describe("UID-scoped Firebase Storage integration", () => {
  it("sources Storage rules from firebase.json with local Auth and Storage emulators", () => {
    expect(firebase.storage).toEqual({ rules: "storage.rules" });
    expect(firebase.emulators.auth.port).toBe(9099);
    expect(firebase.emulators.storage.port).toBe(9199);
  });

  it("uses owner UID namespaces for every main-app attachment upload", () => {
    expect(bills).toContain(
      "`users/${userId}/attachments/bills/${billId}/${storedFileName}`"
    );
    expect(bills).toContain('const storedFileName = safePathToken ? `${safePathToken}-${safeFileName}` : safeFileName');
    expect(expenses).toContain(
      "`users/${userId}/attachments/expenses/${expenseId}/${safeFileName}`"
    );
    expect(clients).toContain(
      "`users/${userId}/attachments/clients/${clientId}/${safeFileName}`"
    );

    expect(bills).not.toContain("`bills/${billId}/${safeFileName}`");
    expect(expenses).not.toContain("`expenses/${expenseId}/${safeFileName}`");
    expect(clients).not.toContain("`clients/${clientId}/${safeFileName}`");
  });

  it("passes the authenticated UID and retains paths for reads, replacement and deletion", () => {
    expect(bills).toMatch(/uploadAttachment\(\s*selectedAttachment,\s*billId,\s*user\.uid,/);
    expect(bills).toContain("uploadAttachment(scannedAttachment, billId, user.uid)");
    expect(bills).toContain('existingBill ? createRequestId() : ""');
    expect(bills).toContain("attachmentPath: attachment.attachmentPath || \"\"");
    expect(bills).toContain("await deleteAttachment(billToDelete.attachmentPath)");
    expect(bills).toContain("await deleteAttachment(replacedAttachmentPath)");

    expect(expenses).toContain("uploadAttachment(selectedAttachment, expenseId, user.uid)");
    expect(expenses).toContain("uploadAttachment(scannedAttachment, expenseId, user.uid)");
    expect(expenses).toContain("await deleteAttachment(expenseToDelete.attachmentPath)");

    expect(clients).toContain("uploadAttachment(selectedAttachment, client.id, user.uid)");
    expect(clients).toContain("await deleteAttachment(clientToDelete.attachmentPath)");
  });

  it("opens main-app attachments through the shared path-first resolver", () => {
    for (const page of [bills, expenses, clients]) {
      expect(page).toContain('import { openAttachment } from "../js/attachment-opening.js');
      expect(page).toContain("openAttachment(");
    }

    expect(bills).not.toContain('href="${escapeHtml(bill.attachmentUrl)}"');
    expect(expenses).not.toContain('href="${escapeHtml(expense.attachmentUrl)}"');
    expect(clients).not.toContain('href="${escapeHtml(client.attachmentUrl)}"');
  });

  it("keeps company logos UID-scoped and Accountant Pack path-aware", () => {
    expect(account).toContain("`users/${uid}/branding/company-logo`");
    expect(exportsPage).toContain("confirmedAttachmentStoragePath");
    expect(exportsPage).toContain("services.storageRef(services.storage, attachment.storagePath)");
  });

  it("recognises the separate legacy Expenses app already uses its own UID-scoped paths", () => {
    expect(legacyExpenses).toContain("`users/${user.uid}/receipts/${Date.now()}_${safeName}`");
    expect(legacyExpenses).toContain("`users/${user.uid}/mileage-attachments/${Date.now()}_${safeName}`");
  });

  it("denies legacy and unmatched paths by omission and applies exact-owner checks", () => {
    expect(rules).toContain("request.auth.uid == userId");
    expect(rules).toContain("match /users/{userId}/attachments/bills/{billId}/{fileName}");
    expect(rules).toContain("match /users/{userId}/attachments/expenses/{expenseId}/{fileName}");
    expect(rules).toContain("match /users/{userId}/attachments/clients/{clientId}/{fileName}");
    expect(rules).toContain("match /users/{userId}/branding/company-logo");
    expect(rules).not.toMatch(/allow\s+(?:read|write|read,\s*write):\s*if\s+request\.auth\s*!=\s*null/);
    expect(rules).not.toMatch(/match\s+\/(?:bills|expenses|clients)\//);
  });
});
