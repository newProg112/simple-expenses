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
  CUSTOMER_ANALYTICS_SCHEMA_VERSION,
  aggregateCustomerAnalytics,
  businessIntelligenceAnalytics,
  businessTrendBuckets,
  buildAdminCustomerAnalytics,
  normalizeEventName,
  normalizePlan,
  phaseTwoCustomerAnalytics,
  parseCustomerAnalyticsRange,
  readTopCustomerUsage,
  TOP_ENGAGED_CUSTOMER_LIMIT,
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
    expect(result.schemaVersion).toBe(CUSTOMER_ANALYTICS_SCHEMA_VERSION);
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
      usageDocumentLimit: CUSTOMER_ACCOUNT_LIMIT, usageDocumentsRead: 0,
      activityTruncated: true, accountsTruncated: false, incomplete: true
    });
    expect(result.businessIntelligence).toMatchObject({
      upgradeCandidates: [], inactiveProAccounts: [], recentlyActiveBusinesses: [], engagementLeaders: []
    });
  });
});

describe("Customer Analytics Phase 2 aggregation", () => {
  it("builds 12-month cohorts independently of the selected activity range", () => {
    const result = aggregateCustomerAnalytics({
      entries: [user("older-signup", "2026-05-10T10:00:00Z")],
      events: [], range: "7d", now: NOW
    });
    expect(result.summary.newSignUps).toBe(0);
    expect(result.signupCohorts.find(item => item.monthKey === "2026-05")?.count).toBe(1);
  });

  it("calculates rolling retention, dormancy, monthly returning users and 12 signup cohorts", () => {
    const entries = [
      user("today", "2026-01-01T00:00:00Z"),
      user("week", "2026-02-01T00:00:00Z"),
      user("month", "2026-03-01T00:00:00Z"),
      user("dormant", "2026-01-01T00:00:00Z"),
      user("never-old", "2026-01-01T00:00:00Z"),
      user("new", "2026-08-02T00:00:00Z")
    ];
    const result = phaseTwoCustomerAnalytics({
      entries,
      events: [
        action("today", "user_logged_in", "2026-08-05T11:00:00Z"),
        action("week", "invoice_created", "2026-08-01T10:00:00Z"),
        action("month", "invoice_scanned", "2026-07-15T10:00:00Z"),
        action("dormant", "user_logged_in", "2026-06-01T10:00:00Z")
      ],
      now: NOW
    });
    expect(result.retention).toEqual({active24Hours: 1, active7Days: 2, active30Days: 3, dormant30Days: 2});
    expect(result.returningUsers).toEqual({
      newUsersThisMonth: 1, returningUsersThisMonth: 2, returningUserPercentage: 66.7
    });
    expect(result.signupCohorts).toHaveLength(12);
    expect(result.signupCohorts.at(-1)).toMatchObject({monthKey: "2026-08", count: 1});
    expect(result.signupCohorts[7]).toMatchObject({monthKey: "2026-04", count: 0});
  });

  it("uses unique customers for six adoption rates and builds a monotonic conversion journey", () => {
    const entries = [
      user("complete", "2026-01-01T00:00:00Z", "Pro"),
      user("partial", "2026-01-01T00:00:00Z", "Starter"),
      user("account-only", "2026-01-01T00:00:00Z", "Starter")
    ];
    entries[0].account.businessName = "Complete Books";
    entries[0].account.balance = 999999;
    entries[0].profile.stripeCustomerId = "cus_private";
    const events = [
      action("complete", "user_logged_in", "2026-02-01T00:00:00Z"),
      action("complete", "invoice_created", "2026-02-02T00:00:00Z"),
      action("complete", "invoice_created", "2026-02-03T00:00:00Z"),
      action("complete", "bill_created", "2026-02-04T00:00:00Z"),
      action("complete", "expense_created", "2026-02-05T00:00:00Z"),
      action("complete", "project_created", "2026-02-06T00:00:00Z"),
      action("complete", "ai_question_asked", "2026-02-07T00:00:00Z"),
      action("complete", "invoice_scanned", "2026-02-08T00:00:00Z"),
      action("partial", "user_logged_in", "2026-03-01T00:00:00Z"),
      action("partial", "invoice_created", "2026-03-02T00:00:00Z")
    ];
    const usageByUid = new Map([["complete", {aiAssistantSuccessfulUses: 4, invoiceScanningSuccessfulUses: 2}]]);
    const result = phaseTwoCustomerAnalytics({entries, events, now: NOW, usageByUid});
    expect(result.featureAdoption.map(item => [item.key, item.customers, item.percentageOfCustomers])).toEqual([
      ["first_invoice", 2, 66.7], ["first_bill", 1, 33.3], ["first_expense", 1, 33.3],
      ["first_project", 1, 33.3], ["ai_assistant", 1, 33.3], ["invoice_scanning", 1, 33.3]
    ]);
    expect(result.conversionJourney.map(item => item.count)).toEqual([3, 2, 2, 1, 1, 1]);
    expect(result.conversionJourney.map(item => item.percentageFromPrevious)).toEqual([100, 66.7, 100, 50, 100, 100]);
    expect(result.topEngagedCustomers[0]).toEqual({
      businessName: "Complete Books", plan: "pro", lastActive: "2026-02-08T00:00:00.000Z",
      totalSafeActivityEvents: 8, aiAssistantSuccessfulUses: 4, invoiceScanningSuccessfulUses: 2
    });
    expect(JSON.stringify(result)).not.toMatch(/uid|invoiceNumber|balance|amount|journal|cus_private|stripe/i);
  });

  it("reads current-month usage for no more than the internally ranked top 20", async () => {
    const entries = Array.from({length: 25}, (_value, index) => user(`user-${index}`, "2026-01-01T00:00:00Z"));
    const events = entries.flatMap((entry, index) => Array.from({length: index + 1}, (_value, eventIndex) =>
      action(entry.user.uid, "invoice_created", `2026-08-04T${String(eventIndex % 24).padStart(2, "0")}:00:00Z`)));
    const reads = [];
    const firestore = {collection: () => ({doc: uid => ({collection: () => ({doc: monthKey => ({get: async () => {
      reads.push({uid, monthKey});
      return {exists: true, data: () => ({aiAssistantSuccessfulUses: 1})};
    }})})})})};
    const usage = await readTopCustomerUsage(firestore, entries, events, NOW);
    expect(reads).toHaveLength(TOP_ENGAGED_CUSTOMER_LIMIT);
    expect(usage.size).toBe(TOP_ENGAGED_CUSTOMER_LIMIT);
    expect(reads.every(item => item.monthKey === "2026-08")).toBe(true);
  });
});

describe("Customer Analytics Phase 3 Business Intelligence", () => {
  const businessUser = (uid, plan, creationTime = "2026-01-01T00:00:00Z", email = `${uid}@example.test`) => ({
    user: {uid, email, metadata: {creationTime}},
    account: {businessName: uid === "missing-name" ? undefined : `${uid} Books`},
    profile: {currentPlan: plan}
  });

  it("uses shared Starter allowances, applies 80% KPIs and ranks 70% candidates deterministically", () => {
    const entries = [businessUser("multi", "Starter"), businessUser("scan", "Starter"),
      businessUser("exact-ai", "Starter"), businessUser("exact-scan", "Starter"), businessUser("low", "Starter")];
    const usageByUid = new Map([
      ["multi", {aiAssistantSuccessfulUses: 9, invoiceScanningSuccessfulUses: 7}],
      ["scan", {aiAssistantSuccessfulUses: 1, invoiceScanningSuccessfulUses: 10}],
      ["exact-ai", {aiAssistantSuccessfulUses: 8, invoiceScanningSuccessfulUses: 0}],
      ["exact-scan", {aiAssistantSuccessfulUses: 0, invoiceScanningSuccessfulUses: 8}],
      ["low", {aiAssistantSuccessfulUses: 6, invoiceScanningSuccessfulUses: 6}]
    ]);
    const result = businessIntelligenceAnalytics({entries, events: [], range: "30d", now: NOW, usageByUid});
    expect(result.kpis).toMatchObject({
      starterNearAiLimit: 2, starterNearInvoiceScanningLimit: 2, starterNearActiveProjectLimit: null
    });
    expect(result.availability.activeProjectUsage).toBe(false);
    expect(result.upgradeCandidates.map(item => item.businessName)).toEqual([
      "scan Books", "multi Books", "exact-ai Books", "exact-scan Books"
    ]);
    expect(result.upgradeCandidates[1].suggestedReason).toBe("Multiple Starter limits approaching");
    expect(result.upgradeCandidates[0]).toMatchObject({highestAllowanceUsage: 100, activeProjects: null});
  });

  it("distinguishes inactive Pro accounts, no activity and verified versus missing subscription status", () => {
    const old = businessUser("old-pro", "Pro");
    old.profile.subscriptionStatus = "active";
    const never = businessUser("never-pro", "Pro");
    const recent = businessUser("recent-pro", "Pro");
    const result = businessIntelligenceAnalytics({
      entries: [old, never, recent],
      events: [
        action("old-pro", "user_logged_in", "2026-06-01T00:00:00Z"),
        action("recent-pro", "user_logged_in", "2026-08-05T00:00:00Z")
      ], range: "30d", now: NOW
    });
    expect(result.kpis.inactiveProAccounts).toBe(2);
    expect(result.inactiveProAccounts.map(item => item.businessName)).toEqual(["never-pro Books", "old-pro Books"]);
    expect(result.inactiveProAccounts[0]).toMatchObject({lastActive: null, daysInactive: null, subscriptionStatus: ""});
    expect(result.inactiveProAccounts[1]).toMatchObject({daysInactive: 65, subscriptionStatus: "active"});
    expect(result.inactiveProAccounts.every(item => !Object.hasOwn(item, "stripeSubscriptionId"))).toBe(true);
  });

  it("counts 60-day inactivity using account age for no-activity accounts and safely handles missing fields", () => {
    const oldNever = businessUser("missing-name", undefined, "2026-01-01T00:00:00Z", undefined);
    oldNever.user.email = undefined;
    const newNever = businessUser("new", "Starter", "2026-08-01T00:00:00Z");
    const oldActivity = businessUser("old", "legacy");
    const result = businessIntelligenceAnalytics({
      entries: [oldNever, newNever, oldActivity],
      events: [action("old", "invoice_created", "2026-06-01T00:00:00Z")],
      range: "30d", now: NOW
    });
    expect(result.kpis.customersInactive60Days).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/undefined|NaN|Infinity/);
  });

  it("deduplicates equivalent safe events for BI averages and engagement without changing existing aggregation", () => {
    const entries = [businessUser("a", "Starter"), businessUser("b", "Starter")];
    const duplicate = action("a", "invoice_created", "2026-08-05T10:00:00Z");
    const events = [duplicate, {...duplicate}, action("a", "ai_question_asked", "2026-08-04T10:00:00Z"),
      action("b", "invoice_scanned", "2026-08-05T11:00:00Z")];
    const business = businessIntelligenceAnalytics({entries, events, range: "30d", now: NOW});
    const existing = aggregateCustomerAnalytics({entries, events, range: "30d", now: NOW});
    expect(business.kpis.averageSafeEventsPerActiveCustomer).toBe(1.5);
    expect(business.engagementLeaders[0]).toMatchObject({businessName: "a Books", safeEvents: 2, activeDays: 2});
    expect(existing.summary.totalTrackedCustomerActions).toBe(4);
  });

  it("calculates DAU and trailing WAU/MAU at UTC boundaries with zero-filled selected dates", () => {
    const trends = businessTrendBuckets("7d", NOW, [
      action("a", "user_logged_in", "2026-07-29T23:59:59Z"),
      action("b", "user_logged_in", "2026-08-05T00:00:00Z"),
      action("b", "invoice_created", "2026-08-05T23:59:59Z")
    ]);
    expect(trends).toHaveLength(7);
    expect(trends[0]).toEqual({date: "2026-07-30", dau: 0, wau: 1, mau: 1});
    expect(trends.at(-1)).toEqual({date: "2026-08-05", dau: 1, wau: 1, mau: 2});
    expect(trends.slice(1, -1).every(item => item.dau === 0)).toBe(true);
    expect(businessTrendBuckets("30d", NOW, [])).toHaveLength(30);
  });

  it("normalizes schema v3 BI data and discards unapproved nested customer data", () => {
    const model = normalizeCustomerAnalyticsPayload({schemaVersion: 3, businessIntelligence: {
      kpis: {starterNearAiLimit: 1, starterNearActiveProjectLimit: null},
      upgradeCandidates: [{businessName: "Safe\u0000 Books", email: "owner@example.test", aiAllowanceUsage: 90,
        invoices: [{amount: 1000}], uid: "private", suggestedReason: "AI Assistant usage at 90%"}],
      activeCustomerTrends: [{date: "2026-08-05", dau: 1, wau: 2, mau: 3}]
    }});
    expect(model.businessIntelligence.upgradeCandidates[0]).toMatchObject({businessName: "Safe Books", aiAllowanceUsage: 90});
    expect(model.businessIntelligence.upgradeCandidates[0]).not.toHaveProperty("invoices");
    expect(model.businessIntelligence.upgradeCandidates[0]).not.toHaveProperty("uid");
    expect(model.businessIntelligence.activeCustomerTrends[0]).toEqual({date: "2026-08-05", dau: 1, wau: 2, mau: 3});
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
    return {doc: uid => ({
      get: async () => ({exists: values.has(uid), data: () => values.get(uid)}),
      collection: () => ({doc: () => ({get: async () => ({exists: false, data: () => undefined})})})
    })};
  }};
  const users = [...accountData.keys()].map(uid => ({uid, email: uid === "official-demo" ? "demo@example.test" : `${uid}@example.test`, metadata: {creationTime: "2026-08-01T00:00:00Z"}}));
  return {firestore, auth: {listUsers: vi.fn(async () => ({users}))}};
}

describe("Customer Analytics protected data access", () => {
  it("excludes demoMode, configured demo and admin testing accounts server-side", async () => {
    const services = backendServices();
    const diagnosticsLogger = vi.fn();
    const result = await buildAdminCustomerAnalytics({
      ...services, demoIdentifiers: parseDemoIdentifiers("uid:official-demo,email:demo@example.test"),
      adminUids: new Set(["owner"]), range: "30d", now: NOW,
      timestampFactory: {fromDate: date => date}, diagnosticsLogger
    });
    expect(result.summary).toMatchObject({activeCustomerAccounts: 1, newSignUps: 1, totalTrackedCustomerActions: 1});
    expect(JSON.stringify(result)).not.toMatch(/flagged-demo|official-demo|owner@example/i);
    expect(result.businessIntelligence.recentlyActiveBusinesses[0].businessName).toBe("");
    expect(diagnosticsLogger).toHaveBeenCalledWith({
      authAccountsLoaded: 4,
      excludedAdminAccounts: 1,
      excludedConfiguredDemoAccounts: 1,
      excludedDemoModeAccounts: 1,
      eligibleCustomerAccounts: 1,
      missingCreationTime: 0,
      invalidCreationTime: 0,
      futureCreationTime: 0,
      outsideLast12Months: 0,
      includedInSignupCohorts: 1
    });
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
    for(const id of ["customerActive24HoursValue", "customerActive7DaysValue", "customerActive30DaysValue",
      "customerDormant30DaysValue", "customerNewThisMonthValue", "customerReturningThisMonthValue",
      "customerReturningPercentageValue", "customerSignupCohortsChart", "customerFeatureAdoptionTableBody",
      "customerConversionJourneyTableBody", "customerTopEngagedTableBody"]){
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/Customer Analytics[\s\S]{0,500}unique people/i);
  });

  it("renders responsive accessible Business Intelligence states, KPIs, tables and trend summary", () => {
    for(const id of ["businessIntelligenceSection", "businessIntelligenceStatus", "businessNearAiValue",
      "businessNearScanningValue", "businessNearProjectsValue", "businessInactiveProValue",
      "businessInactive60Value", "businessAverageEventsValue", "businessUpgradeCandidatesBody",
      "businessInactiveProBody", "businessRecentlyActiveBody", "customerTopEngagedTableBody",
      "activeCustomerTrendsChart", "activeCustomerTrendsEmpty", "activeCustomerTrendsSummary"]){
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Identify upgrade opportunities, disengaged customers and account activity patterns.");
    expect(html).toMatch(/class="table-scroll" role="region" aria-label="Top upgrade candidates" tabindex="0"/);
    expect(html).toContain("business-intelligence-table");
    expect(html).toContain("DAU, trailing 7-day WAU and trailing 30-day MAU by UTC date");
    expect(dashboard).toContain("Business Intelligence rendering failed");
    expect(dashboard).toContain("Existing Customer Analytics remains available");
    expect(dashboard).toContain("No recorded activity");
    expect(dashboard).not.toMatch(/confirmed paid|will upgrade|automatically contact/i);
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
    const phaseTwo = normalizeCustomerAnalyticsPayload({
      retention: {active24Hours: 2},
      signupCohorts: [{monthKey: "2026-08", label: "Aug 2026", count: 3}],
      topEngagedCustomers: [{businessName: "Safe Books\u0000", plan: "pro", lastActive: NOW.toISOString(),
        totalSafeActivityEvents: 9, aiAssistantSuccessfulUses: 2, invoiceScanningSuccessfulUses: 1,
        invoices: [{amount: 999}], uid: "private"}]
    });
    expect(phaseTwo.retention.active24Hours).toBe(2);
    expect(phaseTwo.signupCohorts).toEqual([{monthKey: "2026-08", label: "Aug 2026", count: 3}]);
    expect(phaseTwo.topEngagedCustomers[0]).toEqual({
      businessName: "Safe Books", plan: "pro", lastActive: NOW.toISOString(), totalSafeActivityEvents: 9,
      aiAssistantSuccessfulUses: 2, invoiceScanningSuccessfulUses: 1
    });
  });

  it("distinguishes an outdated backend contract from a genuinely empty cohort dataset", () => {
    const legacy = normalizeCustomerAnalyticsPayload({summary: {}, signupCohorts: undefined});
    const currentEmpty = normalizeCustomerAnalyticsPayload({schemaVersion: 3, summary: {}, signupCohorts: []});
    const currentPopulated = normalizeCustomerAnalyticsPayload({
      schemaVersion: 3,
      signupCohorts: [{monthKey: "2026-08", label: "Aug 2026", count: 2}]
    });
    expect(legacy).toMatchObject({schemaVersion: 0, signupCohorts: []});
    expect(currentEmpty).toMatchObject({schemaVersion: 3, signupCohorts: []});
    expect(currentPopulated.signupCohorts).toHaveLength(1);
    expect(dashboard).toContain("if(model.schemaVersion < 2)");
    expect(dashboard).toContain("if(model.schemaVersion < 3)");
    expect(dashboard).toContain("Customer Analytics backend is out of date");
    expect(dashboard.indexOf("model.schemaVersion < 2")).toBeLessThan(dashboard.indexOf("else if(model.signupCohorts.length)"));
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
