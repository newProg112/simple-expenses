import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDemoAnalyticsLoader,
  formatDemoSessionDuration,
  normalizeDemoAnalyticsPayload
} from "../assets/admin-demo-analytics-view.js";

const require = createRequire(import.meta.url);
const {
  DEMO_ANALYTICS_COLLECTION,
  DEMO_ANALYTICS_QUERY_LIMIT,
  SESSION_TIMEOUT_MS,
  aggregateDemoAnalytics,
  buildAdminDemoAnalytics,
  normalizePagePath,
  parseDemoAnalyticsRange,
  readablePageLabel,
  sessionizeEvents,
  utcRangeStart
} = require("../functions/lib/admin-demo-analytics.js");
const {
  createAdminDemoAnalyticsHandler
} = require("../functions/lib/admin-demo-analytics-handler.js");

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("admin.html");
const dashboard = read("assets/admin-dashboard.js");
const functionsIndex = read("functions/index.js");

function storedTimestamp(iso){
  return {toDate: () => new Date(iso)};
}

function document(data){
  return {data: () => data};
}

function event(eventName, iso, page = "/dashboard.html", uid = "shared-demo"){
  return {eventName, timestamp: new Date(iso), page: normalizePagePath(page), uid};
}

function queryFirestore(docs){
  const calls = [];
  const query = {
    where(...args){ calls.push(["where", ...args]); return this; },
    orderBy(...args){ calls.push(["orderBy", ...args]); return this; },
    limit(...args){ calls.push(["limit", ...args]); return this; },
    select(...args){ calls.push(["select", ...args]); return this; },
    async get(){ calls.push(["get"]); return {docs}; }
  };
  return {
    calls,
    firestore: {
      collection(name){ calls.push(["collection", name]); return query; }
    }
  };
}

const NOW = new Date("2026-08-05T12:00:00.000Z");

describe("Demo Analytics ranges and secure callable", () => {
  it("accepts only 7d, 30d, and all while defaulting to 30d", () => {
    expect(parseDemoAnalyticsRange()).toBe("30d");
    expect(["7d", "30d", "all"].map(parseDemoAnalyticsRange)).toEqual(["7d", "30d", "all"]);
    for(const value of ["90d", "1d", "", null, 30]){
      expect(() => parseDemoAnalyticsRange(value)).toThrow();
    }
  });

  it("uses inclusive UTC calendar-day boundaries", () => {
    expect(utcRangeStart("7d", new Date("2026-08-05T23:59:59Z")).toISOString())
      .toBe("2026-07-30T00:00:00.000Z");
    expect(utcRangeStart("30d", NOW).toISOString()).toBe("2026-07-07T00:00:00.000Z");
    expect(utcRangeStart("all", NOW)).toBeNull();
  });

  it("rejects unauthenticated and non-admin callers before aggregation", async () => {
    const analyticsBuilder = vi.fn();
    const handler = createAdminDemoAnalyticsHandler({
      adminUidConfiguration: "owner-uid",
      analyticsBuilder
    });
    await expect(handler({data: {range: "30d"}})).rejects.toMatchObject({code: "unauthenticated"});
    await expect(handler({auth: {uid: "customer"}, data: {range: "30d"}}))
      .rejects.toMatchObject({code: "permission-denied"});
    expect(analyticsBuilder).not.toHaveBeenCalled();
  });

  it("rejects unsupported ranges and unknown request fields", async () => {
    const handler = createAdminDemoAnalyticsHandler({
      adminUidConfiguration: "owner-uid",
      analyticsBuilder: vi.fn()
    });
    await expect(handler({auth: {uid: "owner-uid"}, data: {range: "90d"}}))
      .rejects.toMatchObject({code: "invalid-argument"});
    await expect(handler({auth: {uid: "owner-uid"}, data: {range: "30d", uid: "demo"}}))
      .rejects.toMatchObject({code: "invalid-argument"});
  });

  it("passes only server dependencies to the aggregate builder", async () => {
    const response = {range: "7d", metrics: {demoSessions: 0}};
    const analyticsBuilder = vi.fn(async () => response);
    const handler = createAdminDemoAnalyticsHandler({
      firestore: {server: true},
      adminUidConfiguration: "owner-uid",
      timestampFactory: {server: true},
      now: () => NOW,
      analyticsBuilder
    });
    await expect(handler({auth: {uid: "owner-uid"}, data: {range: "7d"}})).resolves.toBe(response);
    expect(analyticsBuilder).toHaveBeenCalledWith({
      firestore: {server: true},
      range: "7d",
      now: NOW,
      timestampFactory: {server: true}
    });
    expect(analyticsBuilder.mock.calls[0][0]).not.toHaveProperty("auth");
  });
});

describe("Demo Analytics sessionisation", () => {
  it("starts a session at login and closes it at logout", () => {
    const sessions = sessionizeEvents([
      event("Login", "2026-08-05T09:00:00Z", "/login.html"),
      event("Dashboard viewed", "2026-08-05T09:02:00Z"),
      event("Logout", "2026-08-05T09:05:00Z", "/account.html")
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({pageViews: 1});
    expect(sessions[0].start.toISOString()).toBe("2026-08-05T09:00:00.000Z");
    expect(sessions[0].end.toISOString()).toBe("2026-08-05T09:05:00.000Z");
  });

  it("splits sessions only when inactivity is longer than 30 minutes", () => {
    const sessions = sessionizeEvents([
      event("Dashboard viewed", "2026-08-05T09:00:00Z"),
      event("Invoices page viewed", new Date(Date.parse("2026-08-05T09:00:00Z") + SESSION_TIMEOUT_MS).toISOString()),
      event("Clients page viewed", "2026-08-05T10:00:01Z")
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions.map(item => item.pageViews)).toEqual([2, 1]);
  });

  it("uses the final event when logout is missing and never creates negative duration", () => {
    const sessions = sessionizeEvents([
      event("Login", "2026-08-05T10:00:00Z", "/login.html"),
      event("Dashboard viewed", "2026-08-05T10:04:00Z")
    ]);
    expect(sessions[0].end.toISOString()).toBe("2026-08-05T10:04:00.000Z");
    expect(sessions[0].end - sessions[0].start).toBe(4 * 60 * 1000);
  });

  it("calculates averages and single-page sessions across login boundaries", () => {
    const result = aggregateDemoAnalytics([
      event("Login", "2026-08-05T09:00:00Z", "/login.html"),
      event("Dashboard viewed", "2026-08-05T09:02:00Z"),
      event("Logout", "2026-08-05T09:04:00Z", "/account.html"),
      event("Login", "2026-08-05T10:00:00Z", "/login.html"),
      event("Invoices page viewed", "2026-08-05T10:02:00Z", "/resources/tools/invoice-generator.html"),
      event("Clients page viewed", "2026-08-05T10:04:00Z", "/resources/tools/client-tracker.html"),
      event("Logout", "2026-08-05T10:06:00Z", "/account.html")
    ], "7d", NOW);
    expect(result.metrics).toEqual({
      demoLogins: 2,
      demoSessions: 2,
      totalPageViews: 3,
      averagePagesPerSession: 1.5,
      averageSessionDurationSeconds: 300,
      singlePageSessions: 1
    });
  });
});

describe("Demo Analytics page and event aggregation", () => {
  it.each([
    ["/dashboard.html?source=demo#top", "/dashboard", "Dashboard"],
    ["/dashboard/", "/dashboard", "Dashboard"],
    ["/resources/tools/invoice-generator.html", "/resources/tools/invoice-generator", "Invoices"],
    ["/invoices/", "/resources/tools/invoice-generator", "Invoices"],
    ["https://simple-books.co.uk/resources/tools/general-ledger?x=1", "/resources/tools/general-ledger", "General Ledger"],
    ["/account.html", "/account", "Account"]
  ])("normalizes %s", (raw, normalized, label) => {
    expect(normalizePagePath(raw)).toBe(normalized);
    expect(readablePageLabel(raw)).toBe(label);
  });

  it("uses a safe readable fallback for unknown paths", () => {
    expect(readablePageLabel("/resources/tools/custom-report.html?private=1#x")).toBe("Custom Report");
    expect(readablePageLabel("/<script>alert(1)</script>")).not.toMatch(/[<>]/);
    expect(readablePageLabel(42)).toBe("Unknown Page");
  });

  it("ranks pages, calculates percentages, and includes arbitrary valid events generically", () => {
    const result = aggregateDemoAnalytics([
      event("Dashboard viewed", "2026-08-05T09:00:00Z"),
      event("Dashboard viewed", "2026-08-05T09:01:00Z", "/dashboard/?refresh=1"),
      event("Invoices page viewed", "2026-08-05T09:02:00Z", "/resources/tools/invoice-generator.html"),
      event("Future AI Assistant usage", "2026-08-05T09:03:00Z", "/resources/tools/ai-assistant.html")
    ], "7d", NOW);
    expect(result.pages).toEqual([
      {path: "/dashboard", label: "Dashboard", count: 2, percentage: 66.7},
      {path: "/resources/tools/invoice-generator", label: "Invoices", count: 1, percentage: 33.3}
    ]);
    expect(result.eventBreakdown).toContainEqual({eventName: "Future AI Assistant usage", count: 1});
  });

  it("creates zero-activity dates for fixed ranges", () => {
    const result = aggregateDemoAnalytics([
      event("Dashboard viewed", "2026-08-05T09:00:00Z")
    ], "7d", NOW);
    expect(result.daily).toHaveLength(7);
    expect(result.daily[0]).toEqual({date: "2026-07-30", sessions: 0, pageViews: 0});
    expect(result.daily.at(-1)).toEqual({date: "2026-08-05", sessions: 1, pageViews: 1});
  });
});

describe("Demo Analytics bounded Firestore aggregation", () => {
  it("queries only the protected analytics collection with selected non-UA fields", async () => {
    const store = queryFirestore([
      document({
        timestamp: storedTimestamp("2026-08-05T09:00:00Z"),
        uid: "shared-demo",
        eventName: "Login",
        page: "/login.html",
        userAgent: "must never be returned"
      })
    ]);
    const result = await buildAdminDemoAnalytics({
      firestore: store.firestore,
      range: "7d",
      now: NOW,
      timestampFactory: {fromDate: date => ({iso: date.toISOString()})}
    });
    expect(store.calls[0]).toEqual(["collection", DEMO_ANALYTICS_COLLECTION]);
    expect(store.calls).toContainEqual(["orderBy", "timestamp", "desc"]);
    expect(store.calls).toContainEqual(["limit", DEMO_ANALYTICS_QUERY_LIMIT + 1]);
    expect(store.calls).toContainEqual(["select", "timestamp", "uid", "eventName", "page"]);
    expect(JSON.stringify(result)).not.toMatch(/shared-demo|userAgent|must never be returned/i);
  });

  it("excludes events outside the selected range and malformed stored values", async () => {
    const store = queryFirestore([
      document({timestamp: storedTimestamp("2026-07-29T23:59:59Z"), uid: "demo", eventName: "Login", page: "/login.html"}),
      document({timestamp: storedTimestamp("2026-07-30T00:00:00Z"), uid: "demo", eventName: "Login", page: "/login.html"}),
      document({timestamp: storedTimestamp("2026-08-06T00:00:00Z"), uid: "demo", eventName: "Login", page: "/login.html"}),
      document({timestamp: "invalid", uid: "demo", eventName: "Login", page: "/login.html"}),
      document({timestamp: storedTimestamp("2026-08-05T10:00:00Z"), uid: "", eventName: "Login", page: "/login.html"})
    ]);
    const result = await buildAdminDemoAnalytics({
      firestore: store.firestore,
      range: "7d",
      now: NOW,
      timestampFactory: {fromDate: date => date}
    });
    expect(result.eventsProcessed).toBe(1);
    expect(result.metrics.demoLogins).toBe(1);
  });

  it("returns a valid empty result with zero-filled fixed daily buckets", async () => {
    const store = queryFirestore([]);
    const result = await buildAdminDemoAnalytics({
      firestore: store.firestore,
      range: "30d",
      now: NOW,
      timestampFactory: {fromDate: date => date}
    });
    expect(result.metrics).toEqual({
      demoLogins: 0,
      demoSessions: 0,
      totalPageViews: 0,
      averagePagesPerSession: 0,
      averageSessionDurationSeconds: 0,
      singlePageSessions: 0
    });
    expect(result.daily).toHaveLength(30);
    expect(result.pages).toEqual([]);
    expect(result.eventBreakdown).toEqual([]);
  });
});

describe("Demo Analytics Admin Dashboard frontend", () => {
  it("adds the section inside the existing admin-only dashboard without weakening denied state", () => {
    expect(html).toContain('id="demoAnalyticsSection"');
    expect(html).toContain('id="demoAnalyticsTitle">Demo Analytics');
    expect(html).toContain("Understand how visitors explore the Simple Books demo environment.");
    expect(html.indexOf('id="demoAnalyticsSection"')).toBeGreaterThan(html.indexOf('id="adminContent"'));
    expect(html).toContain('id="deniedState" hidden');
    expect(dashboard).toContain('adminAccessDecision(user)');
  });

  it("renders all six KPIs, two charts, generic events, loading, empty, and error states", () => {
    for(const id of [
      "demoLoginsValue", "demoSessionsValue", "demoPageViewsValue",
      "demoAveragePagesValue", "demoAverageDurationValue", "demoSinglePageValue",
      "demoActivityChart", "demoPagesChart", "demoEventsTableBody",
      "demoAnalyticsLoading", "demoAnalyticsEmpty", "demoAnalyticsError"
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('<option value="30d" selected>Last 30 days</option>');
    expect(html).toContain("shared account");
    expect(html).not.toMatch(/unique visitors|geographic/i);
  });

  it("normalizes payload values and formats non-negative durations", () => {
    const model = normalizeDemoAnalyticsPayload({
      metrics: {demoSessions: -1, averagePagesPerSession: 1.25},
      pages: [{label: "Dashboard", count: 2, percentage: 150}],
      eventBreakdown: [{eventName: "Login", count: 2}],
      userAgent: "must be ignored"
    });
    expect(model.metrics.demoSessions).toBe(0);
    expect(model.metrics.averagePagesPerSession).toBe(1.25);
    expect(model.pages[0].percentage).toBe(100);
    expect(model).not.toHaveProperty("userAgent");
    expect(formatDemoSessionDuration(-5)).toBe("0s");
    expect(formatDemoSessionDuration(3660)).toBe("1h 1m");
  });

  it("prevents concurrent refreshes and reuses cached ranges", async () => {
    let resolveRequest;
    const request = vi.fn(() => new Promise(resolve => { resolveRequest = resolve; }));
    const onSuccess = vi.fn();
    const loader = createDemoAnalyticsLoader({request, onSuccess});
    const first = loader.load("30d");
    const duplicate = loader.load("30d", {force: true});
    expect(first).toBe(duplicate);
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
    resolveRequest({range: "30d"});
    await first;
    await loader.load("30d");
    expect(request).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenLastCalledWith({range: "30d"}, {cached: true});
  });

  it("isolates request failures from existing dashboard features", async () => {
    const existingDashboardState = {metricsVisible: true, featureUsageVisible: true};
    const onError = vi.fn();
    const loader = createDemoAnalyticsLoader({
      request: () => Promise.reject(new Error("analytics unavailable")),
      onError
    });
    await expect(loader.load("30d")).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(existingDashboardState).toEqual({metricsVisible: true, featureUsageVisible: true});
    expect(dashboard).toContain('setDemoAnalyticsState("error")');
    expect(dashboard).toContain("const demoAnalyticsCharts = new Map()");
    expect(dashboard).toContain("demoAnalyticsCharts.get(canvasId)?.destroy()");
  });

  it("exports the protected callable and joins the existing Refresh action", () => {
    expect(functionsIndex).toContain("exports.getAdminDemoAnalytics = onCall");
    expect(functionsIndex).toContain("adminUidConfiguration: adminUidsSecret.value()");
    expect(dashboard).toContain('httpsCallable(functions, "getAdminDemoAnalytics")');
    expect(dashboard).toMatch(/refreshMetricsButton\.addEventListener[\s\S]*loadDemoAnalytics\(\{force: true\}\)/);
  });
});
