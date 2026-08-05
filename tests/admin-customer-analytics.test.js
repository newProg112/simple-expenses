import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "vitest";
import {
  createCustomerAnalyticsLoader,
  normalizeCustomerAnalyticsPayload
} from "../assets/admin-customer-analytics-view.js";

const require = createRequire(import.meta.url);
const {
  CUSTOMER_ACCOUNT_LIMIT,
  CUSTOMER_ACTIVITY_LIMIT,
  aggregateCustomerAnalytics,
  buildAdminCustomerAnalytics,
  normalizeEventName,
  normalizePlan,
  parseCustomerAnalyticsRange,
  utcRangeStart
} = require("../functions/lib/admin-customer-analytics.js");
const {createAdminCustomerAnalyticsHandler} = require("../functions/lib/admin-customer-analytics-handler.js");
const {parseDemoIdentifiers} = require("../functions/lib/admin-authorization.js");

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("admin.html");
const dashboard = read("assets/admin-dashboard.js");
const functionsIndex = read("functions/index.js");
const demoAnalyticsSource = read("functions/lib/admin-demo-analytics.js");
const customerAnalyticsView = read("assets/admin-customer-analytics-view.js");
const NOW = new Date("2026-08-05T12:00:00.000Z");
const user = (uid, creationTime, plan = "Starter") => ({
  user: {uid, metadata: {creationTime}},
  account: {},
  profile: {currentPlan: plan}
});
const action = (uid, eventType, iso) => ({uid, eventType, createdAt: new Date(iso)});

describe("Customer Analytics core aggregation", () => {
  it("accepts only 7d, 30d and all, defaulting to 30d with UTC day boundaries", () => {
    expect(parseCustomerAnalyticsRange()).toBe("30d");
    expect(["7d", "30d", "all"].map(parseCustomerAnalyticsRange)).toEqual(["7d", "30d", "all"]);
    for(const value of ["90d", "1d", "", null, 30]) expect(() => parseCustomerAnalyticsRange(value)).toThrow();
    expect(utcRangeStart("7d", NOW).toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("range-filters sign-ups and events, counts active accounts, groups current plans and fills zero dates", () => {
    const result = aggregateCustomerAnalytics({
      entries: [
        user("starter", "2026-08-01T10:00:00Z", "Starter"),
        user("pro", "2026-07-01T10:00:00Z", "PRO"),
        user("unknown", "2026-08-05T10:00:00Z", "legacy"),
        user("outside", "2026-07-29T23:59:59Z", "Starter")
      ],
      events: [
        action("starter", "invoice_created", "2026-08-05T09:00:00Z"),
        action("starter", "ai_question_asked", "2026-08-05T10:00:00Z"),
        action("pro", "invoice_scanned", "2026-08-04T10:00:00Z"),
        action("unknown", "user_logged_in", "2026-08-03T10:00:00Z"),
        action("outside", "invoice_created", "2026-07-29T23:59:59Z")
      ],
      range: "7d", now: NOW, activityTruncated: false, accountsTruncated: false
    });
    expect(result.summary).toMatchObject({
      activeCustomerAccounts: 3, newSignUps: 2, activeStarterAccounts: 1,
      activeProAccounts: 1, activeUnknownPlanAccounts: 1,
      starterToProConversionRate: 33.3, totalTrackedCustomerActions: 4
    });
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0]).toEqual({date: "2026-07-30", activeAccounts: 0, trackedActions: 0});
    expect(result.daily.at(-1)).toEqual({date: "2026-08-05", activeAccounts: 1, trackedActions: 2});
  });

  it("normalizes equivalent feature names and calculates adoption counts and feature shares", () => {
    expect(normalizeEventName(" Invoice-Saved ")).toBe("invoice_saved");
    expect(normalizeEventName("<script>")).toBe("");
    const result = aggregateCustomerAnalytics({
      entries: [user("customer", "2026-01-01T00:00:00Z")],
      events: [
        action("customer", "invoice_created", "2026-08-05T09:00:00Z"),
        action("customer", "invoice_saved", "2026-08-05T09:01:00Z"),
        action("customer", "ai_assistant_used", "2026-08-05T09:02:00Z"),
        action("customer", "user_logged_in", "2026-08-05T09:03:00Z")
      ], range: "30d", now: NOW
    });
    expect(result.adoption).toContainEqual({key: "invoices", label: "Invoices", count: 2});
    expect(result.features[0]).toEqual({key: "invoices", label: "Invoices", count: 2, share: 66.7});
    expect(result.measuredFeatureActions).toBe(3);
    expect(result.summary.totalTrackedCustomerActions).toBe(4);
  });

  it("handles unknown plans and zero known plans without division errors", () => {
    expect(normalizePlan("enterprise")).toBe("unknown");
    const result = aggregateCustomerAnalytics({
      entries: [user("unknown", "2026-01-01T00:00:00Z", "enterprise")],
      events: [], range: "all", now: NOW
    });
    expect(result.planAdoption).toMatchObject({knownAccounts: 0, conversionRate: 0});
    expect(result.planAdoption.unknown.count).toBe(1);
    expect(Number.isFinite(result.summary.starterToProConversionRate)).toBe(true);
  });

  it("returns a privacy-safe valid empty result and accurate caps", () => {
    const result = aggregateCustomerAnalytics({entries: [], events: [], range: "30d", now: NOW, activityTruncated: true, accountsTruncated: false});
    expect(result.summary.activeCustomerAccounts).toBe(0);
    expect(result.daily).toHaveLength(30);
    expect(result.caps).toEqual({
      activityLimit: CUSTOMER_ACTIVITY_LIMIT, accountLimit: CUSTOMER_ACCOUNT_LIMIT,
      activityTruncated: true, accountsTruncated: false, incomplete: true
    });
    expect(JSON.stringify(result)).not.toMatch(/uid|email|business(name)?|useragent/i);
  });
});

function backendServices(){
  const accountData = new Map([
    ["real", {demoMode: false}], ["flagged-demo", {demoMode: true}], ["official-demo", {}], ["owner", {}]
  ]);
  const profiles = new Map([...accountData.keys()].map(uid => [uid, {currentPlan: "Starter"}]));
  const docs = [
    {data: () => ({uid: "real", eventType: "invoice_created", createdAt: {toDate: () => new Date("2026-08-05T09:00:00Z")}})},
    {data: () => ({uid: "flagged-demo", eventType: "invoice_created", createdAt: {toDate: () => new Date("2026-08-05T09:00:00Z")}})},
    {data: () => ({uid: "official-demo", eventType: "invoice_created", createdAt: {toDate: () => new Date("2026-08-05T09:00:00Z")}})},
    {data: () => ({uid: "owner", eventType: "invoice_created", createdAt: {toDate: () => new Date("2026-08-05T09:00:00Z")}})}
  ];
  const query = {
    where(){return this;}, orderBy(){return this;}, limit(){return this;}, select(){return this;}, async get(){return {docs};}
  };
  const firestore = {collection(name){
    if(name === "adminActivityEvents") return query;
    const values = name === "users" ? accountData : profiles;
    return {doc: uid => ({get: async () => ({exists: values.has(uid), data: () => values.get(uid)})})};
  }};
  const users = [...accountData.keys()].map(uid => ({uid, email: uid === "official-demo" ? "demo@example.test" : `${uid}@example.test`, metadata: {creationTime: "2026-08-01T00:00:00Z"}}));
  return {firestore, auth: {listUsers: vi.fn(async () => ({users}))}};
}

describe("Customer Analytics protected data access", () => {
  it("excludes demoMode, configured demo and admin testing accounts server-side", async () => {
    const services = backendServices();
    const result = await buildAdminCustomerAnalytics({
      ...services, demoIdentifiers: parseDemoIdentifiers("uid:official-demo,email:demo@example.test"),
      adminUids: new Set(["owner"]), range: "30d", now: NOW,
      timestampFactory: {fromDate: date => date}
    });
    expect(result.summary).toMatchObject({activeCustomerAccounts: 1, newSignUps: 1, totalTrackedCustomerActions: 1});
    expect(JSON.stringify(result)).not.toMatch(/real|flagged-demo|official-demo|owner@example/i);
  });

  it("rejects non-admins, unsupported ranges and unknown fields before reading", async () => {
    const analyticsBuilder = vi.fn();
    const handler = createAdminCustomerAnalyticsHandler({
      adminUidConfiguration: "owner", demoConfiguration: "uid:demo", analyticsBuilder
    });
    await expect(handler({data: {range: "30d"}})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(handler({auth: {uid: "customer"}, data: {range: "30d"}})).rejects.toMatchObject({code: "permission-denied"});
    await expect(handler({auth: {uid: "owner"}, data: {range: "90d"}})).rejects.toMatchObject({code: "invalid-argument"});
    await expect(handler({auth: {uid: "owner"}, data: {range: "30d", uid: "x"}})).rejects.toMatchObject({code: "invalid-argument"});
    expect(analyticsBuilder).not.toHaveBeenCalled();
  });
});

describe("Customer Analytics Admin Dashboard", () => {
  it("appears for the authorised dashboard directly below unchanged Demo Analytics", () => {
    expect(html).toContain('id="customerAnalyticsTitle">Customer Analytics');
    expect(html).toContain("Understand how real customers are adopting and using Simple Books.");
    expect(html.indexOf('id="customerAnalyticsSection"')).toBeGreaterThan(html.indexOf('id="demoAnalyticsSection"'));
    expect(html).toContain('id="deniedState" hidden');
    expect(demoAnalyticsSource).toBe(read("functions/lib/admin-demo-analytics.js"));
  });

  it("contains range, KPIs, tables, chart, loading, empty, error and retry states", () => {
    for(const id of ["customerActiveAccountsValue", "customerNewSignupsValue", "customerActiveStarterValue",
      "customerActiveProValue", "customerConversionValue", "customerActionsValue", "customerActivityChart",
      "customerAdoptionTableBody", "customerFeaturesTableBody", "customerPlanTableBody",
      "customerAnalyticsLoading", "customerAnalyticsEmpty", "customerAnalyticsError", "retryCustomerAnalyticsButton"]){
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/Customer Analytics[\s\S]{0,500}unique people/i);
  });

  it("normalizes hostile payloads without retaining customer identifiers", () => {
    const model = normalizeCustomerAnalyticsPayload({
      summary: {activeCustomerAccounts: -2, starterToProConversionRate: 900},
      features: [{key: "invoices", label: "Invoices\u0000", count: 2, share: 150}],
      uid: "secret", email: "secret@example.test"
    });
    expect(model.summary.activeCustomerAccounts).toBe(0);
    expect(model.summary.starterToProConversionRate).toBe(100);
    expect(model.features[0]).toMatchObject({label: "Invoices", share: 100});
    expect(model).not.toHaveProperty("uid");
  });

  it("prevents duplicate requests, caches ranges and isolates failures", async () => {
    let resolve;
    const request = vi.fn(() => new Promise(done => {resolve = done;}));
    const onError = vi.fn();
    const loader = createCustomerAnalyticsLoader({request, onError});
    const first = loader.load("30d");
    const duplicate = loader.load("30d", {force: true});
    expect(first).toBe(duplicate);
    await Promise.resolve();
    resolve({summary: {}});
    await first;
    await loader.load("30d");
    expect(request).toHaveBeenCalledOnce();
    const failing = createCustomerAnalyticsLoader({request: () => Promise.reject(new Error("offline")), onError});
    await expect(failing.load("7d")).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("exports the secure callable and joins range, retry and main Refresh flows", () => {
    expect(functionsIndex).toContain("exports.getAdminCustomerAnalytics = onCall");
    expect(functionsIndex).toContain("createAdminCustomerAnalyticsHandler");
    expect(dashboard).toContain('httpsCallable(functions, "getAdminCustomerAnalytics")');
    expect(dashboard).toContain('customerAnalyticsRange.addEventListener("change"');
    expect(dashboard).toMatch(/refreshMetricsButton\.addEventListener[\s\S]*loadCustomerAnalytics\(\{force: true\}\)/);
    expect(customerAnalyticsView).toContain("if(pending) return pending");
  });
});
