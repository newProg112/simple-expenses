import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  cleanNotes,
  readAdminNotes,
  readAdminUserTimeline,
  resetMonthlyUsage,
  updateAdminNotes
} = require("../functions/lib/admin-user-management.js");
const {
  createAdminUserTimelineHandler,
  createResetAdminUserUsageHandler,
  createUpdateAdminUserNotesHandler
} = require("../functions/lib/admin-user-management-handler.js");

const fieldValue = { serverTimestamp: () => "SERVER_TIMESTAMP" };
const NOW = new Date("2026-08-05T12:00:00.000Z");

describe("Admin User Management Phase 2 authorization", () => {
  it("denies notes, reset, and timeline operations to non-admin users", async () => {
    const notesUpdater = vi.fn();
    const usageResetter = vi.fn();
    const timelineReader = vi.fn();
    const notes = createUpdateAdminUserNotesHandler({adminUidConfiguration: "owner", notesUpdater});
    const reset = createResetAdminUserUsageHandler({adminUidConfiguration: "owner", usageResetter});
    const timeline = createAdminUserTimelineHandler({adminUidConfiguration: "owner", timelineReader});

    await expect(notes({data: {uid: "customer", notes: "x"}})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(notes({auth: {uid: "other"}, data: {uid: "customer", notes: "x"}})).rejects.toMatchObject({code: "permission-denied"});
    await expect(reset({auth: {uid: "other"}, data: {uid: "customer", usageType: "aiAssistant"}})).rejects.toMatchObject({code: "permission-denied"});
    await expect(timeline({auth: {uid: "other"}, data: {uid: "customer"}})).rejects.toMatchObject({code: "permission-denied"});
    expect(notesUpdater).not.toHaveBeenCalled();
    expect(usageResetter).not.toHaveBeenCalled();
    expect(timelineReader).not.toHaveBeenCalled();
  });

  it("passes the signed-in admin UID to notes and reset operations", async () => {
    const notesUpdater = vi.fn(async input => ({saved: true, notes: input.notes}));
    const usageResetter = vi.fn(async () => ({reset: true}));
    const notes = createUpdateAdminUserNotesHandler({adminUidConfiguration: "owner", notesUpdater});
    const reset = createResetAdminUserUsageHandler({adminUidConfiguration: "owner", usageResetter, now: () => NOW});
    await notes({auth: {uid: "owner"}, data: {uid: "customer", notes: "Follow up"}});
    await reset({auth: {uid: "owner"}, data: {uid: "customer", usageType: "invoiceScanning"}});
    expect(notesUpdater).toHaveBeenCalledWith(expect.objectContaining({uid: "customer", adminUid: "owner", notes: "Follow up"}));
    expect(usageResetter).toHaveBeenCalledWith(expect.objectContaining({uid: "customer", adminUid: "owner", usageType: "invoiceScanning", now: NOW}));
  });

  it("returns privacy-safe failures and rejects malformed operations", async () => {
    const handler = createUpdateAdminUserNotesHandler({
      adminUidConfiguration: "owner",
      notesUpdater: async () => { throw new Error("projects/private/path"); }
    });
    await expect(handler({auth: {uid: "owner"}, data: {uid: "customer", notes: "x"}}))
      .rejects.toMatchObject({code: "internal", message: "Admin notes could not be saved."});
    await expect(handler({auth: {uid: "owner"}, data: {uid: "bad/uid", notes: "x"}}))
      .rejects.toMatchObject({code: "invalid-argument"});
  });
});

describe("private admin notes storage", () => {
  it("creates, reads, updates and clears only the approved note projection", async () => {
    let stored;
    const reference = {
      set: vi.fn(async value => {
        stored = {...value, updatedAt: value.updatedAt === "SERVER_TIMESTAMP" ? NOW : value.updatedAt};
      }),
      get: vi.fn(async () => ({exists: Boolean(stored), data: () => stored}))
    };
    const firestore = {collection: name => {
      expect(name).toBe("adminUserNotes");
      return {doc: uid => {
        expect(uid).toBe("customer");
        return reference;
      }};
    }};
    await expect(readAdminNotes(firestore, "customer")).resolves.toEqual({
      text: "", updatedAt: null, updatedByAdminUid: ""
    });
    await updateAdminNotes({firestore, fieldValue, uid: "customer", notes: "  First note  ", adminUid: "owner"});
    expect(stored).toEqual({notes: "First note", updatedAt: NOW, updatedByAdminUid: "owner"});
    await expect(readAdminNotes(firestore, "customer")).resolves.toEqual({
      text: "First note", updatedAt: NOW.toISOString(), updatedByAdminUid: "owner"
    });
    // A fresh drawer lookup uses the same collection/document and sees the committed note.
    await expect(readAdminNotes(firestore, "customer")).resolves.toMatchObject({text: "First note"});
    await updateAdminNotes({firestore, fieldValue, uid: "customer", notes: "", adminUid: "owner"});
    expect(stored.notes).toBe("");
    expect(() => cleanNotes("x".repeat(4001))).toThrow(/4000/);
  });

  it("does not report success when the note write or persistence verification fails", async () => {
    const writeFailure = {
      collection: () => ({doc: () => ({
        set: async () => { throw new Error("write failed"); },
        get: async () => ({exists: false, data: () => undefined})
      })})
    };
    await expect(updateAdminNotes({
      firestore: writeFailure, fieldValue, uid: "customer", notes: "Unsaved", adminUid: "owner"
    })).rejects.toThrow("write failed");

    const missingAfterWrite = {
      collection: () => ({doc: () => ({
        set: async () => {},
        get: async () => ({exists: false, data: () => undefined})
      })})
    };
    await expect(updateAdminNotes({
      firestore: missingAfterWrite, fieldValue, uid: "customer", notes: "Unsaved", adminUid: "owner"
    })).rejects.toThrow(/could not be verified/);
  });

  it("keeps the notes collection inaccessible to browser clients", () => {
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    expect(rules).toMatch(/match \/adminUserNotes\/\{uid\}[\s\S]*?allow read, write: if false/);
  });
});

describe("monthly usage reset actions", () => {
  it.each([
    ["aiAssistant", "aiAssistantSuccessfulUses", "admin_ai_usage_reset"],
    ["invoiceScanning", "invoiceScanningSuccessfulUses", "admin_invoice_scanning_usage_reset"]
  ])("resets %s atomically and records an admin activity event", async (usageType, field, eventType) => {
    const writes = [];
    const commit = vi.fn(async () => {});
    const usageReference = {path: "approved usage reference"};
    const eventReference = {path: "approved event reference"};
    const firestore = {
      collection(name){
        if(name === "userProfiles") return {doc: () => ({collection: () => ({doc: () => usageReference})})};
        if(name === "adminActivityEvents") return {doc: () => eventReference};
        throw new Error(`Unexpected collection ${name}`);
      },
      batch: () => ({set: (reference, value, options) => writes.push({reference, value, options}), commit})
    };
    const result = await resetMonthlyUsage({firestore, fieldValue, uid: "customer", usageType, adminUid: "owner", now: NOW});
    expect(result).toEqual({reset: true, usageType, monthKey: "2026-08", auditEventCreated: true});
    expect(writes[0]).toEqual({reference: usageReference, value: {[field]: 0, updatedAt: "SERVER_TIMESTAMP"}, options: {merge: true}});
    expect(writes[1].reference).toBe(eventReference);
    expect(writes[1].value).toMatchObject({eventType, uid: "customer", adminUid: "owner", metadata: {}});
    expect(commit).toHaveBeenCalledOnce();
  });
});

describe("full customer activity timeline", () => {
  it("loads newest-first approved events and returns a pagination cursor", async () => {
    const docs = [
      {id: "event-b", data: () => ({eventType: "invoice_created", createdAt: new Date("2026-08-05T11:00:00.000Z"), metadata: {private: true}})},
      {id: "event-a", data: () => ({eventType: "user_logged_in", createdAt: new Date("2026-08-05T10:00:00.000Z")})}
    ];
    const query = {
      where: vi.fn(() => query), orderBy: vi.fn(() => query), startAfter: vi.fn(() => query),
      limit: vi.fn(() => query), get: vi.fn(async () => ({docs}))
    };
    const result = await readAdminUserTimeline({
      firestore: {collection: () => query}, uid: "customer", limit: 1,
      timestampFactory: {fromDate: date => date}, documentIdField: "__name__"
    });
    expect(result.events).toEqual([{
      eventType: "invoice_created", timestamp: "2026-08-05T11:00:00.000Z",
      summary: "An invoice was successfully created."
    }]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toMatch(/metadata|private|document|path/);
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it("includes both admin reset event types with safe readable summaries", async () => {
    const docs = [
      {id: "reset-ai", data: () => ({eventType: "admin_ai_usage_reset", createdAt: new Date("2026-08-05T12:00:00.000Z"), adminUid: "private-owner"})},
      {id: "reset-scan", data: () => ({eventType: "admin_invoice_scanning_usage_reset", createdAt: new Date("2026-08-05T11:00:00.000Z"), metadata: {unsafe: true}})}
    ];
    const query = {
      where: () => query, orderBy: () => query, limit: () => query,
      get: async () => ({docs})
    };
    const result = await readAdminUserTimeline({
      firestore: {collection: () => query}, uid: "customer", limit: 25,
      timestampFactory: {fromDate: date => date}, documentIdField: "__name__"
    });
    expect(result.events.map(event => [event.eventType, event.summary])).toEqual([
      ["admin_ai_usage_reset", "An administrator reset the monthly AI Assistant usage."],
      ["admin_invoice_scanning_usage_reset", "An administrator reset the monthly invoice scanning usage."]
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-owner|unsafe|adminUid|metadata/);
  });
});
