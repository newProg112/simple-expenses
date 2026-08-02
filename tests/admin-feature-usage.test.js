import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  FEATURE_USAGE_DEFINITIONS,
  buildFeatureUsageChartModel,
  featureUsageErrorState,
  normalizeFeatureUsageItems,
  sortFeatureUsageItems
} from "../assets/admin-feature-usage-view.js";

const require = createRequire(import.meta.url);
const {
  FEATURE_USAGE_ITEMS,
  buildAdminFeatureUsage,
  parseFeatureUsageRange,
  rangeStartDate
} = require("../functions/lib/admin-feature-usage.js");
const {
  createAdminFeatureUsageHandler
} = require("../functions/lib/admin-feature-usage-handler.js");
const {parseDemoIdentifiers} = require("../functions/lib/admin-authorization.js");

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("admin.html");
const dashboard = read("assets/admin-dashboard.js");
const functionsIndex = read("functions/index.js");

function timestamp(iso){
  return {toDate: () => new Date(iso)};
}

function activityDocument(id, eventType, iso, overrides = {}){
  return {
    id,
    data: () => ({
      eventType,
      createdAt: timestamp(iso),
      uid: id,
      displayEmail: `${id}@example.test`,
      ...overrides
    })
  };
}

function queryFirestore(docs){
  const calls = [];
  const query = {
    where(...args){ calls.push(["where", ...args]); return this; },
    select(...args){ calls.push(["select", ...args]); return this; },
    async get(){ calls.push(["get"]); return {docs}; }
  };
  return {
    calls,
    firestore: {
      collection(name){
        calls.push(["collection", name]);
        return query;
      }
    }
  };
}

describe("Admin Dashboard Phase 5B backend aggregation", () => {
  it("accepts only the four approved ranges and defaults to 30d", () => {
    expect(parseFeatureUsageRange()).toBe("30d");
    expect(["7d", "30d", "90d", "all"].map(parseFeatureUsageRange))
      .toEqual(["7d", "30d", "90d", "all"]);
    for(const value of ["1d", "365d", "", null, 30]){
      expect(() => parseFeatureUsageRange(value)).toThrow();
    }
  });

  it("calculates exact UTC-duration boundaries", () => {
    const now = new Date("2026-08-02T19:00:00.000Z");
    expect(rangeStartDate("7d", now).toISOString()).toBe("2026-07-26T19:00:00.000Z");
    expect(rangeStartDate("30d", now).toISOString()).toBe("2026-07-03T19:00:00.000Z");
    expect(rangeStartDate("90d", now).toISOString()).toBe("2026-05-04T19:00:00.000Z");
    expect(rangeStartDate("all", now)).toBeNull();
  });

  it("aggregates approved events, excludes demos, and ignores malformed or unknown records", async () => {
    const docs = [
      activityDocument("invoice", "invoice_created", "2026-08-02T18:00:00.000Z"),
      activityDocument("invoice-two", "invoice_created", "2026-08-02T17:00:00.000Z"),
      activityDocument("ai", "ai_question_asked", "2026-08-02T16:00:00.000Z"),
      activityDocument("demo", "invoice_scanned", "2026-08-02T15:00:00.000Z", {displayEmail: "demo@example.test"}),
      activityDocument("unknown", "private_unknown_event", "2026-08-02T14:00:00.000Z"),
      activityDocument("malformed", "user_logged_in", "invalid"),
      activityDocument("string-date", "user_logged_in", "2026-08-02T13:00:00.000Z", {
        createdAt: "2026-08-02T13:00:00.000Z"
      })
    ];
    const store = queryFirestore(docs);
    const result = await buildAdminFeatureUsage({
      firestore: store.firestore,
      demoIdentifiers: parseDemoIdentifiers("uid:demo,email:demo@example.test"),
      range: "30d",
      now: new Date("2026-08-02T19:00:00.000Z"),
      timestampFactory: {fromDate: value => ({boundary: value.toISOString()})}
    });
    expect(result).toEqual({
      range: "30d",
      generatedAt: "2026-08-02T19:00:00.000Z",
      totalTrackedActions: 3,
      items: [
        {key: "invoice_created", label: "Invoices created", count: 2},
        {key: "invoice_scanned", label: "Invoice scans", count: 0},
        {key: "ai_question_asked", label: "AI Assistant", count: 1},
        {key: "user_logged_in", label: "Customer logins", count: 0},
        {key: "user_signed_up", label: "New accounts", count: 0},
        {key: "checkout_started", label: "Checkout started", count: 0},
        {key: "upgraded_to_pro", label: "Upgrades to Pro", count: 0},
        {key: "subscription_cancelled", label: "Subscription cancellations", count: 0}
      ]
    });
    expect(store.calls).toContainEqual([
      "where", "createdAt", ">=", {boundary: "2026-07-03T19:00:00.000Z"}
    ]);
    expect(store.calls).toContainEqual([
      "select", "eventType", "createdAt", "uid", "displayEmail"
    ]);
    expect(JSON.stringify(result)).not.toMatch(/email|uid|document|private|demo/i);
  });

  it("returns every category as zero in stable order and does not range-filter all time", async () => {
    const store = queryFirestore([]);
    const result = await buildAdminFeatureUsage({
      firestore: store.firestore,
      demoIdentifiers: parseDemoIdentifiers("uid:demo"),
      range: "all",
      now: new Date("2026-08-02T19:00:00.000Z"),
      timestampFactory: {fromDate: value => value}
    });
    expect(result.totalTrackedActions).toBe(0);
    expect(result.items).toEqual(FEATURE_USAGE_ITEMS.map(item => ({...item, count: 0})));
    expect(store.calls.some(call => call[0] === "where")).toBe(false);
  });

  it("rejects unauthenticated/non-admin callers and fails closed without configuration", async () => {
    const base = {
      firestore: {},
      demoConfiguration: "uid:demo",
      timestampFactory: {fromDate: value => value},
      usageBuilder: vi.fn()
    };
    await expect(createAdminFeatureUsageHandler({...base, adminUidConfiguration: ""})({auth: {uid: "owner"}}))
      .rejects.toMatchObject({code: "failed-precondition"});
    const handler = createAdminFeatureUsageHandler({...base, adminUidConfiguration: "owner"});
    await expect(handler({})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(handler({auth: {uid: "customer"}})).rejects.toMatchObject({code: "permission-denied"});
    expect(base.usageBuilder).not.toHaveBeenCalled();
  });

  it("rejects invalid ranges and unknown request fields", async () => {
    const handler = createAdminFeatureUsageHandler({
      adminUidConfiguration: "owner",
      demoConfiguration: "uid:demo",
      usageBuilder: vi.fn()
    });
    await expect(handler({auth: {uid: "owner"}, data: {range: "365d"}}))
      .rejects.toMatchObject({code: "invalid-argument"});
    await expect(handler({auth: {uid: "owner"}, data: {range: "30d", uid: "demo"}}))
      .rejects.toMatchObject({code: "invalid-argument"});
  });

  it("passes only server dependencies and returns a serialisable aggregate response", async () => {
    const response = {range: "7d", generatedAt: "2026-08-02T19:00:00.000Z", totalTrackedActions: 0, items: []};
    const usageBuilder = vi.fn(async () => response);
    const handler = createAdminFeatureUsageHandler({
      firestore: {server: true},
      adminUidConfiguration: "owner",
      demoConfiguration: "uid:demo",
      timestampFactory: {server: true},
      now: () => new Date("2026-08-02T19:00:00.000Z"),
      usageBuilder
    });
    await expect(handler({auth: {uid: "owner"}, data: {range: "7d"}})).resolves.toBe(response);
    expect(usageBuilder).toHaveBeenCalledWith(expect.objectContaining({
      firestore: {server: true}, range: "7d", now: new Date("2026-08-02T19:00:00.000Z")
    }));
    expect(usageBuilder.mock.calls[0][0]).not.toHaveProperty("auth");
  });
});

describe("Admin Dashboard Phase 5B frontend", () => {
  it("retains zero categories and sorts highest-first with stable ties", () => {
    const normalized = normalizeFeatureUsageItems([
      {key: "ai_question_asked", count: 4},
      {key: "invoice_created", count: 4},
      {key: "unknown", count: 999}
    ]);
    expect(normalized).toHaveLength(8);
    expect(normalized.find(item => item.key === "invoice_scanned").count).toBe(0);
    expect(sortFeatureUsageItems(normalized).slice(0, 2).map(item => item.key))
      .toEqual(["invoice_created", "ai_question_asked"]);
  });

  it("builds exact chart counts, total and most-used summary", () => {
    const model = buildFeatureUsageChartModel([
      {key: "invoice_scanned", count: 2},
      {key: "user_logged_in", count: 7}
    ]);
    expect(model.labels[0]).toBe("Customer logins");
    expect(model.counts[0]).toBe(7);
    expect(model.totalTrackedActions).toBe(9);
    expect(model.mostUsedFeature).toBe("Customer logins");
    expect(model.items).toHaveLength(FEATURE_USAGE_DEFINITIONS.length);
  });

  it("omits most-used when all counts are zero and maps retryable errors", () => {
    expect(buildFeatureUsageChartModel([]).mostUsedFeature).toBe("");
    expect(featureUsageErrorState({code: "functions/internal"})).toMatchObject({kind: "error"});
    expect(featureUsageErrorState({code: "functions/permission-denied"}).kind).toBe("permission-denied");
  });

  it("provides semantic range, loading, zero, unavailable, error and fallback states", () => {
    expect(html).toContain('id="featureUsageTitle">Top feature usage');
    expect(html).toContain("See which Simple Books features customers are using most.");
    expect(html).toContain('<option value="30d" selected>Last 30 days</option>');
    expect(html).toContain('id="featureUsageLoading" role="status"');
    expect(html).toContain('id="featureUsageError" role="alert"');
    expect(html).toContain('id="retryFeatureUsageButton" type="button"');
    expect(html).toContain('id="featureUsageZero" role="status"');
    expect(html).toContain('id="featureUsageUnavailable" role="status"');
    expect(html).toContain('id="featureUsageTable"');
    expect(html).toContain('aria-labelledby="featureUsageTitle featureUsageDescription"');
  });

  it("uses a responsive horizontal Chart.js bar with exact labels and reduced motion", () => {
    expect(dashboard).toContain('type: "bar"');
    expect(dashboard).toContain('indexAxis: "y"');
    expect(dashboard).toContain("maintainAspectRatio: false");
    expect(dashboard).toContain('ticks: {precision: 0, stepSize: 1}');
    expect(dashboard).toContain('id: "featureUsageValueLabels"');
    expect(dashboard).toContain('prefers-reduced-motion: reduce');
  });

  it("reloads only feature usage on range change, prevents concurrent requests, and joins refresh", () => {
    expect(dashboard).toContain('if(featureUsageRequest || !currentAdminUser) return featureUsageRequest');
    expect(dashboard).toContain('featureUsageRange.addEventListener("change", loadFeatureUsage)');
    expect(dashboard).toContain('retryFeatureUsageButton.addEventListener("click", loadFeatureUsage)');
    expect(dashboard).toMatch(/refreshMetricsButton\.addEventListener[\s\S]*loadFeatureUsage\(\)/);
    const rangeHandler = dashboard.match(/featureUsageRange\.addEventListener\("change",\s*([^\)]+)\)/)?.[1];
    expect(rangeHandler).toBe("loadFeatureUsage");
  });

  it("exports and deploys the owner-only aggregate callable", () => {
    expect(functionsIndex).toContain("exports.getAdminFeatureUsage = onCall");
    expect(functionsIndex).toContain("adminUidConfiguration: adminUidsSecret.value()");
    expect(functionsIndex).toContain("demoConfiguration: demoIdentifiersSecret.value()");
  });
});
