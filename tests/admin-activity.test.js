import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_FILTERS,
  ACTIVITY_PRESENTATION,
  activityErrorState,
  filterActivityEvents,
  formatActivityExactTime,
  formatActivityRelativeTime
} from "../assets/admin-activity-view.js";

const require = createRequire(import.meta.url);
const {
  EVENT_PRESENTATION,
  activityDocumentId,
  getRecentActivity,
  normalizeEmail,
  normalizePlan,
  parseActivityLimit,
  safeTimestamp,
  validateFrontendActivityRequest,
  writeActivityEvent
} = require("../functions/lib/admin-activity.js");
const {parseDemoIdentifiers} = require("../functions/lib/admin-authorization.js");
const {
  createActivityLoggerHandler,
  createAdminRecentActivityHandler
} = require("../functions/lib/admin-activity-handlers.js");

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("admin.html");
const dashboard = read("assets/admin-dashboard.js");
const logger = read("assets/activity-logger.js");
const functionsIndex = read("functions/index.js");
const rules = read("firestore.rules");

function authUser(uid, email = `${uid}@example.test`){
  return {uid, email};
}

function profileSnapshot(profile = {currentPlan: "Starter"}){
  return {exists: true, data: () => profile};
}

function loggerDependencies({create = vi.fn(async () => {}), account = {demoMode: false}} = {}){
  return {
    auth: {getUser: vi.fn(async uid => authUser(uid))},
    firestore: {
      collection(name){
        if(name === "userProfiles") return {doc: () => ({get: async () => profileSnapshot()})};
        if(name === "users") return {doc: () => ({get: async () => ({exists: true, data: () => account})})};
        if(name === "adminActivityEvents") return {doc: id => ({create: value => create(id, value)})};
        throw new Error(`Unexpected collection ${name}`);
      }
    },
    fieldValue: {serverTimestamp: () => ({server: "timestamp"})}
  };
}

describe("Admin Dashboard Phase 5A backend activity policy", () => {
  it("defines the approved event types and fixed neutral summaries", () => {
    expect(Object.keys(EVENT_PRESENTATION)).toEqual([
      "user_signed_up", "user_logged_in", "invoice_created", "invoice_scanned",
      "ai_question_asked", "checkout_started", "upgraded_to_pro", "subscription_cancelled",
      "bill_created", "expense_created", "mileage_created", "project_created",
      "budget_created", "accountant_pack_generated", "trial_balance_viewed",
      "general_ledger_viewed", "profit_and_loss_viewed", "balance_sheet_viewed",
      "business_insights_viewed", "business_insights_actionable_viewed", "business_insights_forecasts_viewed", "business_insights_upgrade_prompt_viewed",
      "business_insights_upgrade_clicked"
    ]);
    expect(Object.values(EVENT_PRESENTATION).map(item => item.summary).join(" "))
      .not.toMatch(/amount|invoice number|prompt|stripe/i);
  });

  it("accepts only frontend-supported types and rejects unknown fields or metadata", () => {
    expect(validateFrontendActivityRequest({eventType: "invoice_created", idempotencyKey: "unique_key_123"}))
      .toEqual({eventType: "invoice_created", idempotencyKey: "unique_key_123"});
    expect(() => validateFrontendActivityRequest({eventType: "upgraded_to_pro"})).toThrow();
    expect(() => validateFrontendActivityRequest({eventType: "invoice_created", metadata: {amount: 20}})).toThrow();
    expect(() => validateFrontendActivityRequest({eventType: "unknown"})).toThrow();
  });

  it("normalises only safe email and plan values", () => {
    expect(normalizeEmail(" Customer@Example.TEST ")).toBe("customer@example.test");
    expect(normalizeEmail("not-an-email")).toBe("");
    expect(normalizePlan("Pro")).toBe("pro");
    expect(normalizePlan("enterprise")).toBe("starter");
  });

  it("uses deterministic keys for retries while preserving distinct action keys", () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    expect(activityDocumentId("uid", "user_logged_in", "", now))
      .toBe(activityDocumentId("uid", "user_logged_in", "", new Date(now.getTime() + 2000)));
    expect(activityDocumentId("uid", "invoice_created", "invoice_one", now))
      .not.toBe(activityDocumentId("uid", "invoice_created", "invoice_two", now));
  });

  it("writes only the approved schema and treats an existing deterministic document as a duplicate", async () => {
    const create = vi.fn(async () => {});
    const deps = loggerDependencies({create});
    await expect(writeActivityEvent({
      firestore: deps.firestore,
      fieldValue: deps.fieldValue,
      identity: {uid: "customer", displayEmail: "customer@example.test", plan: "Pro"},
      eventType: "invoice_created",
      idempotencyKey: "invoice_unique"
    })).resolves.toEqual({created: true});
    expect(create.mock.calls[0][1]).toEqual({
      eventType: "invoice_created",
      createdAt: {server: "timestamp"},
      uid: "customer",
      displayEmail: "customer@example.test",
      plan: "pro",
      summary: EVENT_PRESENTATION.invoice_created.summary,
      metadata: {}
    });
    expect(JSON.stringify(create.mock.calls[0][1])).not.toMatch(/amount|stripe|prompt|invoiceNumber/);

    const duplicateDeps = loggerDependencies({create: vi.fn(async () => { const error = new Error(); error.code = 6; throw error; })});
    await expect(writeActivityEvent({
      firestore: duplicateDeps.firestore,
      fieldValue: duplicateDeps.fieldValue,
      identity: {uid: "customer"},
      eventType: "user_logged_in"
    })).resolves.toEqual({created: false});
  });

  it("requires authentication and derives UID and email from trusted services", async () => {
    const deps = loggerDependencies();
    const handler = createActivityLoggerHandler({
      ...deps,
      adminUidConfiguration: "owner",
      demoConfiguration: "uid:demo",
      now: () => new Date("2026-08-02T12:00:00.000Z")
    });
    await expect(handler({data: {eventType: "user_logged_in"}})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(handler({
      auth: {uid: "trusted-user"},
      data: {eventType: "user_logged_in"}
    })).resolves.toEqual({created: true});
    expect(deps.auth.getUser).toHaveBeenCalledWith("trusted-user");
  });

  it("enforces default/max limits and serialises valid timestamps", () => {
    expect(parseActivityLimit()).toBe(30);
    expect(parseActivityLimit(500)).toBe(100);
    expect(() => parseActivityLimit(0)).toThrow();
    expect(safeTimestamp({toDate: () => new Date("2026-08-02T12:00:00.000Z")}))
      .toBe("2026-08-02T12:00:00.000Z");
  });

  it("orders newest first, excludes demos, paginates with an opaque cursor and strips sensitive fields", async () => {
    const queryCalls = [];
    const timestamp = iso => ({toDate: () => new Date(iso)});
    const document = (id, iso, data = {}) => ({
      id,
      data: () => ({
        eventType: "invoice_created",
        createdAt: timestamp(iso),
        uid: id,
        displayEmail: `${id}@example.test`,
        plan: "Pro",
        stripeCustomerId: "cus_private",
        invoiceDescription: "private",
        ...data
      })
    });
    const docs = [
      document("demo", "2026-08-02T12:04:00.000Z", {displayEmail: "demo@example.test"}),
      document("new", "2026-08-02T12:03:00.000Z"),
      document("old", "2026-08-02T12:02:00.000Z"),
      document("extra", "2026-08-02T12:01:00.000Z")
    ];
    const query = {
      orderBy(...args){ queryCalls.push(["orderBy", ...args]); return this; },
      startAfter(...args){ queryCalls.push(["startAfter", ...args]); return this; },
      limit(value){ queryCalls.push(["limit", value]); return this; },
      async get(){ return {docs}; }
    };
    const firestore = {collection: name => {
      expect(name).toBe("adminActivityEvents");
      return query;
    }};
    const first = await getRecentActivity({
      firestore,
      demoIdentifiers: parseDemoIdentifiers("uid:demo,email:demo@example.test"),
      limit: 2,
      timestampFactory: {fromDate: value => value},
      documentIdField: "__name__"
    });
    expect(first.events.map(event => event.displayEmail)).toEqual([
      "new@example.test", "old@example.test"
    ]);
    expect(first.events.map(event => event.createdAt)).toEqual([
      "2026-08-02T12:03:00.000Z", "2026-08-02T12:02:00.000Z"
    ]);
    expect(JSON.stringify(first.events)).not.toMatch(/uid|stripe|description|cus_private|private/i);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(queryCalls.slice(0, 2)).toEqual([
      ["orderBy", "createdAt", "desc"],
      ["orderBy", "__name__", "desc"]
    ]);

    await getRecentActivity({
      firestore,
      demoIdentifiers: parseDemoIdentifiers("uid:demo"),
      limit: 2,
      cursor: first.nextCursor,
      timestampFactory: {fromDate: value => value},
      documentIdField: "__name__"
    });
    expect(queryCalls.some(call => call[0] === "startAfter" && call[2] === "old")).toBe(true);
  });

  it("fails closed for missing config and rejects unauthenticated/non-admin reads", async () => {
    const base = {firestore: {}, demoConfiguration: "uid:demo", timestampFactory: {fromDate: value => value}, documentIdField: "__name__"};
    await expect(createAdminRecentActivityHandler({...base, adminUidConfiguration: ""})({auth: {uid: "owner"}}))
      .rejects.toMatchObject({code: "failed-precondition"});
    const handler = createAdminRecentActivityHandler({...base, adminUidConfiguration: "owner"});
    await expect(handler({})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(handler({auth: {uid: "customer"}})).rejects.toMatchObject({code: "permission-denied"});
    await expect(handler({auth: {uid: "customer"}, data: {admin: true, uid: "owner"}}))
      .rejects.toMatchObject({code: "permission-denied"});
  });
});

describe("Admin Dashboard Phase 5A activity feed", () => {
  const records = Object.keys(ACTIVITY_PRESENTATION).map(eventType => ({eventType}));

  it("provides all six filters with exact category mappings", () => {
    expect(Object.keys(ACTIVITY_FILTERS)).toEqual(["all", "accounts", "invoices", "ai", "scanning", "billing"]);
    expect(filterActivityEvents(records, "billing").map(item => item.eventType))
      .toEqual(["checkout_started", "upgraded_to_pro", "subscription_cancelled"]);
    expect(filterActivityEvents(records, "all")).toHaveLength(18);
  });

  it("formats relative and exact accessible times", () => {
    const now = new Date("2026-08-02T12:10:00.000Z");
    expect(formatActivityRelativeTime("2026-08-02T12:06:00.000Z", now)).toBe("4 minutes ago");
    expect(formatActivityRelativeTime("2026-08-01T14:32:00.000Z", now)).toMatch(/^Yesterday at/);
    expect(formatActivityExactTime("2026-08-02T12:06:00.000Z")).not.toBe("Date unavailable");
  });

  it("maps safe retryable and authorization error states", () => {
    expect(activityErrorState({code: "functions/permission-denied"}).kind).toBe("permission-denied");
    expect(activityErrorState({code: "functions/internal"})).toMatchObject({kind: "error"});
  });

  it("contains semantic loading, loaded, empty, error, refresh, filter and pagination UI", () => {
    expect(html).toContain('id="recentActivityTitle">Recent activity');
    expect(html).toContain('id="activityLoading" role="status"');
    expect(html).toContain('id="activityError" role="alert"');
    expect(html).toContain('id="activityEmpty" role="status"');
    expect(html).toContain('id="activityFilter"');
    expect(html).toContain('id="refreshActivityButton" type="button"');
    expect(html).toContain('id="retryActivityButton" type="button"');
    expect(html).toContain('id="showMoreActivityButton" type="button"');
    expect(dashboard).toContain('activityFilter.addEventListener("change", renderActivity)');
    expect(dashboard).toContain('loadRecentActivity({append: true})');
    expect(dashboard).toContain('time.title = formatActivityExactTime');
  });

  it("keeps frontend logging failures non-blocking and contains no arbitrary metadata", () => {
    expect(logger).toMatch(/catch\(_error\)[\s\S]*return false/);
    expect(logger).not.toMatch(/metadata|email|uid|summary/);
    expect(functionsIndex).toContain('eventType: "subscription_cancelled"');
    expect(functionsIndex).toContain('eventType: "upgraded_to_pro"');
    expect(functionsIndex).toContain('idempotencyKey: event.id');
  });

  it("leaves the activity collection unavailable to browser Firestore rules", () => {
    expect(rules).not.toContain("adminActivityEvents");
  });
});
