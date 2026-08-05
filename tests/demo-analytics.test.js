import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DEMO_ANALYTICS_COLLECTION,
  DEMO_ANALYTICS_EVENTS,
  createDemoAnalyticsTracker,
  demoPageViewEvent
} from "../assets/demo-analytics.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function memoryStorage(){
  const values = new Map();
  return {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value))
  };
}

function trackerServices(overrides = {}){
  const timestamp = { serverTimestamp: true };
  const services = {
    db: { name: "firestore" },
    addDoc: vi.fn().mockResolvedValue({ id: "event-1" }),
    collection: vi.fn((_db, name) => ({ name })),
    doc: vi.fn((_db, name, uid) => ({ name, uid })),
    getDoc: vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({ demoMode: true })
    }),
    serverTimestamp: vi.fn(() => timestamp),
    runtime: {
      location: { pathname: "/dashboard.html" },
      navigator: { userAgent: "Test Browser/1.0" },
      sessionStorage: memoryStorage()
    },
    ...overrides
  };
  return { services, timestamp };
}

describe("Demo Analytics event policy", () => {
  it("contains exactly the Phase 1 event names", () => {
    expect(DEMO_ANALYTICS_EVENTS).toEqual([
      "Login",
      "Logout",
      "Dashboard viewed",
      "Invoices page viewed",
      "Clients page viewed",
      "Bills page viewed",
      "Expenses page viewed",
      "Projects page viewed",
      "Budgets page viewed",
      "Cashflow page viewed",
      "Trial Balance viewed",
      "General Ledger viewed",
      "Profit & Loss viewed",
      "Balance Sheet viewed"
    ]);
  });

  it.each([
    ["dashboard", "Dashboard viewed"],
    ["invoices", "Invoices page viewed"],
    ["clients", "Clients page viewed"],
    ["bills", "Bills page viewed"],
    ["expenses", "Expenses page viewed"],
    ["projects", "Projects page viewed"],
    ["budgets", "Budgets page viewed"],
    ["cashflow", "Cashflow page viewed"],
    ["trial-balance", "Trial Balance viewed"],
    ["general-ledger", "General Ledger viewed"],
    ["profit-loss", "Profit & Loss viewed"],
    ["balance-sheet", "Balance Sheet viewed"]
  ])("maps %s to its page-view event", (key, eventName) => {
    expect(demoPageViewEvent(key)).toBe(eventName);
  });

  it("does not create events that are outside the allowlist", async () => {
    const { services } = trackerServices();
    const track = createDemoAnalyticsTracker(services);

    await expect(track("Private arbitrary event", {
      user: { uid: "demo-user" },
      accountData: { demoMode: true }
    })).resolves.toBe(false);
    expect(services.addDoc).not.toHaveBeenCalled();
  });
});

describe("Demo Analytics collection writes", () => {
  it("writes the exact required payload using a server timestamp", async () => {
    const { services, timestamp } = trackerServices();
    const track = createDemoAnalyticsTracker(services);

    await expect(track("Login", {
      user: { uid: "demo-user" },
      accountData: { demoMode: true },
      page: "/login.html"
    })).resolves.toBe(true);

    expect(services.collection).toHaveBeenCalledWith(
      services.db,
      DEMO_ANALYTICS_COLLECTION
    );
    expect(services.addDoc).toHaveBeenCalledWith(
      { name: DEMO_ANALYTICS_COLLECTION },
      {
        timestamp,
        uid: "demo-user",
        eventName: "Login",
        page: "/login.html",
        userAgent: "Test Browser/1.0"
      }
    );
  });

  it.each([
    ["false", { demoMode: false }],
    ["missing", {}],
    ["truthy string", { demoMode: "true" }]
  ])("does not write for a normal account with a %s flag", async (_label, accountData) => {
    const { services } = trackerServices();
    const track = createDemoAnalyticsTracker(services);

    await expect(track("Login", {
      user: { uid: "customer-user" },
      accountData
    })).resolves.toBe(false);
    expect(services.addDoc).not.toHaveBeenCalled();
  });

  it("loads the signed-in account when no account data is supplied", async () => {
    const { services } = trackerServices();
    const track = createDemoAnalyticsTracker(services);

    await expect(track("Login", { user: { uid: "demo-user" } })).resolves.toBe(true);
    expect(services.doc).toHaveBeenCalledWith(services.db, "users", "demo-user");
    expect(services.getDoc).toHaveBeenCalledOnce();
  });

  it("fails closed when there is no authenticated user", async () => {
    const { services } = trackerServices();
    const track = createDemoAnalyticsTracker(services);

    await expect(track("Login", {
      accountData: { demoMode: true }
    })).resolves.toBe(false);
    expect(services.getDoc).not.toHaveBeenCalled();
    expect(services.addDoc).not.toHaveBeenCalled();
  });

  it("swallows account lookup, storage, and Firestore write failures", async () => {
    const lookup = trackerServices({
      getDoc: vi.fn().mockRejectedValue(new Error("account unavailable"))
    }).services;
    await expect(createDemoAnalyticsTracker(lookup)("Login", {
      user: { uid: "demo-user" }
    })).resolves.toBe(false);

    const write = trackerServices({
      addDoc: vi.fn().mockRejectedValue(new Error("write unavailable"))
    }).services;
    await expect(createDemoAnalyticsTracker(write)("Dashboard viewed", {
      user: { uid: "demo-user" },
      accountData: { demoMode: true }
    })).resolves.toBe(false);
  });

  it("deduplicates repeated initialisation and refreshes for the same page session", async () => {
    const sessionStorage = memoryStorage();
    const first = trackerServices({
      runtime: {
        location: { pathname: "/dashboard.html" },
        navigator: { userAgent: "Browser" },
        sessionStorage
      }
    }).services;
    const firstTracker = createDemoAnalyticsTracker(first);
    const options = {
      user: { uid: "demo-user" },
      accountData: { demoMode: true }
    };

    expect(await firstTracker("Dashboard viewed", options)).toBe(true);
    expect(await firstTracker("Dashboard viewed", options)).toBe(false);

    const afterRefresh = trackerServices({
      runtime: first.runtime,
      addDoc: first.addDoc
    }).services;
    expect(await createDemoAnalyticsTracker(afterRefresh)("Dashboard viewed", options)).toBe(false);
    expect(first.addDoc).toHaveBeenCalledOnce();
  });

  it("does not suppress distinct page views or repeated action events", async () => {
    const { services } = trackerServices();
    const track = createDemoAnalyticsTracker(services);
    const options = {
      user: { uid: "demo-user" },
      accountData: { demoMode: true }
    };

    expect(await track("Dashboard viewed", options)).toBe(true);
    expect(await track("Invoices page viewed", {
      ...options,
      page: "/resources/tools/invoice-generator.html"
    })).toBe(true);
    expect(await track("Login", options)).toBe(true);
    expect(await track("Login", options)).toBe(true);
    expect(services.addDoc).toHaveBeenCalledTimes(4);
  });
});

describe("Demo Analytics integration", () => {
  const shellPages = [
    "dashboard.html",
    "resources/tools/invoice-generator.html",
    "resources/tools/client-tracker.html",
    "resources/tools/bills.html",
    "resources/tools/expenses.html",
    "resources/tools/projects.html",
    "resources/tools/budgets.html",
    "resources/tools/cashflow.html",
    "resources/tools/trial-balance.html",
    "resources/tools/general-ledger.html",
    "resources/tools/profit-loss.html",
    "resources/tools/balance-sheet.html"
  ];

  it("uses the shared authenticated shell on every tracked page", () => {
    for(const page of shellPages){
      expect(read(page)).toContain("/assets/app-shell.js");
    }
    const shell = read("assets/app-shell.js");
    expect(shell).toContain("trackDemoPageView(activeKey, { user, accountData })");
  });

  it("tracks both login paths after authentication and logout before sign-out", () => {
    const login = read("login.html");
    const account = read("account.html");
    expect(login.match(/trackDemoAnalyticsEvent\("Login"/g)).toHaveLength(2);
    expect(login.indexOf('trackDemoAnalyticsEvent("Login"'))
      .toBeGreaterThan(login.indexOf("signInWithEmailAndPassword"));
    expect(account.indexOf('trackDemoAnalyticsEvent("Logout"'))
      .toBeLessThan(account.indexOf("await signOut(auth)"));
  });

  it("enforces demo-only, owner-only creates and denies client reads in rules", () => {
    const rules = read("firestore.rules");
    expect(rules).toContain("match /demoAnalyticsEvents/{eventId}");
    expect(rules).toContain("request.resource.data.uid == request.auth.uid");
    expect(rules).toContain(".data.demoMode == true");
    expect(rules).toContain("request.resource.data.timestamp == request.time");
    expect(rules).toContain("allow read, update, delete: if false");
  });
});
