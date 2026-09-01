import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  isDemoAuthUser,
  parseAdminUidAllowList,
  parseDemoIdentifiers
} = require("../functions/lib/admin-authorization.js");
const {
  AUTH_PAGE_SIZE,
  GROWTH_RANGE_MONTHS,
  PRO_MONTHLY_PRICE_PENCE,
  RECENT_SIGNUP_LIMIT,
  buildAdminMetrics,
  listAllAuthUsers,
  qualifiesAsActivePaidSubscription
} = require("../functions/lib/admin-metrics.js");
const {
  createAdminMetricsHandler
} = require("../functions/lib/admin-metrics-handler.js");

const PRO_PRICE_ID = "price_pro_test";
const NOW = new Date("2026-07-31T20:00:00.000Z");
const DEMO_CONFIGURATION = "uid:demo-user,email:demo@simple-books.test";

function authUser(uid, options = {}) {
  return {
    uid,
    email: options.email ?? `${uid}@example.test`,
    disabled: options.disabled === true,
    metadata: {
      creationTime: Object.hasOwn(options, "creationTime")
        ? options.creationTime
        : "2026-07-01T12:00:00.000Z"
    }
  };
}

function createAuthPages(pages) {
  const listUsers = vi.fn(async (pageSize, pageToken) => {
    expect(pageSize).toBe(AUTH_PAGE_SIZE);
    const pageIndex = pageToken ? Number(pageToken) : 0;
    return {
      users: pages[pageIndex] || [],
      pageToken: pageIndex + 1 < pages.length ? String(pageIndex + 1) : undefined
    };
  });
  return { listUsers };
}

function createFirestore({ accounts = {}, profiles = {}, usage = {}, reads = [] } = {}) {
  return {
    collection(collectionName) {
      reads.push(`collection:${collectionName}`);
      if(collectionName === "users"){
        return {
          doc(uid) {
            return {
              async get() {
                reads.push(`users/${uid}`);
                return snapshot(accounts[uid]);
              }
            };
          }
        };
      }
      if(collectionName !== "userProfiles"){
        throw new Error(`Unexpected collection: ${collectionName}`);
      }
      return {
        doc(uid) {
          return {
            async get() {
              reads.push(`userProfiles/${uid}`);
              return snapshot(profiles[uid]);
            },
            collection(subcollection) {
              expect(subcollection).toBe("usage");
              return {
                doc(monthKey) {
                  return {
                    async get() {
                      reads.push(`userProfiles/${uid}/usage/${monthKey}`);
                      return snapshot(usage[uid]);
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

function snapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value
  };
}

async function metricsFor(users, options = {}) {
  const reads = [];
  const result = await buildAdminMetrics({
    auth: createAuthPages([users]),
    firestore: createFirestore({
      accounts: options.accounts,
      profiles: options.profiles,
      usage: options.usage,
      reads
    }),
    demoIdentifiers: parseDemoIdentifiers(
      options.demoConfiguration || DEMO_CONFIGURATION
    ),
    proPriceId: PRO_PRICE_ID,
    expectedMode: "test",
    now: options.now || NOW
  });
  return { result, reads };
}

function activeProfile(overrides = {}) {
  return {
    currentPlan: "Pro",
    subscriptionStatus: "active",
    billingOverride: false,
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    stripePriceId: PRO_PRICE_ID,
    stripeMode: "test",
    ...overrides
  };
}

describe("admin metrics backend authorization", () => {
  it("parses multiple configured admin UIDs and trims whitespace", () => {
    expect([...parseAdminUidAllowList(" owner-one,owner-two ")])
      .toEqual(["owner-one", "owner-two"]);
    expect(adminAuthorizationDecision({ uid: "owner-two" }, "owner-one, owner-two"))
      .toBe("allowed");
  });

  it("rejects unauthenticated and non-admin callers", () => {
    expect(adminAuthorizationDecision(null, "owner-one")).toBe("unauthenticated");
    expect(adminAuthorizationDecision({ uid: "normal-user" }, "owner-one"))
      .toBe("permission-denied");
  });

  it.each([undefined, null, "", "   "])(
    "fails closed for missing or empty admin configuration: %s",
    value => {
      expect(() => parseAdminUidAllowList(value)).toThrow(AdminConfigurationError);
    }
  );

  it.each(["owner,,second", "bad/uid", "white space"])(
    "fails closed for malformed admin configuration: %s",
    value => {
      expect(() => parseAdminUidAllowList(value)).toThrow(AdminConfigurationError);
    }
  );

  it("supports UID-first demo configuration and email fallback", () => {
    const identifiers = parseDemoIdentifiers(DEMO_CONFIGURATION);
    expect(isDemoAuthUser(authUser("demo-user"), identifiers)).toBe(true);
    expect(isDemoAuthUser(authUser("other", { email: "DEMO@simple-books.test" }), identifiers))
      .toBe(true);
    expect(isDemoAuthUser(authUser("customer"), identifiers)).toBe(false);
  });

  it.each([undefined, "", "demo-user", "uid:", "email:not-an-email"])(
    "rejects missing or malformed demo configuration: %s",
    value => {
      expect(() => parseDemoIdentifiers(value)).toThrow(AdminConfigurationError);
    }
  );

  it("maps authorization failures to structured callable errors", async () => {
    const handler = createAdminMetricsHandler({
      adminUidConfiguration: "owner",
      demoConfiguration: DEMO_CONFIGURATION
    });
    await expect(handler({})).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handler({ auth: { uid: "normal" } }))
      .rejects.toMatchObject({ code: "permission-denied" });
  });

  it("ignores browser-supplied admin and UID fields", async () => {
    const metricsBuilder = vi.fn();
    const handler = createAdminMetricsHandler({
      adminUidConfiguration: "owner",
      demoConfiguration: DEMO_CONFIGURATION,
      metricsBuilder
    });
    await expect(handler({
      auth: { uid: "normal" },
      data: { admin: true, uid: "owner" }
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(metricsBuilder).not.toHaveBeenCalled();
  });

  it("allows a configured admin and passes only server dependencies", async () => {
    const response = { metrics: { totalUsers: 0 }, recentSignups: [] };
    const metricsBuilder = vi.fn(async () => response);
    const handler = createAdminMetricsHandler({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      adminUidConfiguration: "owner-one,owner-two",
      demoConfiguration: DEMO_CONFIGURATION,
      proPriceId: PRO_PRICE_ID,
      now: () => NOW,
      metricsBuilder
    });
    await expect(handler({
      auth: { uid: "owner-two" },
      data: { ignored: "browser-value" }
    })).resolves.toBe(response);
    expect(metricsBuilder).toHaveBeenCalledWith(expect.objectContaining({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      proPriceId: PRO_PRICE_ID,
      now: NOW
    }));
    expect(metricsBuilder.mock.calls[0][0]).not.toHaveProperty("data");
  });

  it("returns a backend configuration error without logging private values", async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const handler = createAdminMetricsHandler({
      adminUidConfiguration: "",
      demoConfiguration: DEMO_CONFIGURATION,
      logger
    });
    await expect(handler({ auth: { uid: "owner" } }))
      .rejects.toMatchObject({ code: "failed-precondition" });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("owner");
  });

  it("maps unexpected failures to internal without logging private messages", async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const handler = createAdminMetricsHandler({
      adminUidConfiguration: "owner",
      demoConfiguration: DEMO_CONFIGURATION,
      metricsBuilder: async () => {
        throw new Error("private@example.test cus_private");
      },
      logger
    });
    await expect(handler({ auth: { uid: "owner" } }))
      .rejects.toMatchObject({ code: "internal" });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("private@example.test");
    expect(logged).not.toContain("cus_private");
  });
});

describe("admin metrics aggregation", () => {
  it("returns fixed zero metrics for an empty Auth system", async () => {
    const { result } = await metricsFor([]);
    expect(result).toMatchObject({
      generatedAt: NOW.toISOString(),
      monthKey: "2026-07",
      metrics: {
        totalUsers: 0,
        starterUsers: 0,
        proUsers: 0,
        activePaidSubscriptions: 0,
        estimatedMrrPence: 0,
        currency: "GBP",
        aiAssistantSuccessfulUses: 0,
        invoiceScanningSuccessfulUses: 0
      },
      charts: {
        rangeMonths: 12,
        planDistribution: { starter: 0, pro: 0 }
      },
      recentSignups: []
    });
    expect(result.charts.monthlySignups).toHaveLength(GROWTH_RANGE_MONTHS);
    expect(result.charts.cumulativeUsers).toHaveLength(GROWTH_RANGE_MONTHS);
  });

  it("paginates Firebase Auth beyond 1,000 users", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => authUser(`u${index}`));
    const auth = createAuthPages([firstPage, [authUser("u1000")]]);
    await expect(listAllAuthUsers(auth)).resolves.toHaveLength(1001);
    expect(auth.listUsers).toHaveBeenNthCalledWith(1, 1000, undefined);
    expect(auth.listUsers).toHaveBeenNthCalledWith(2, 1000, "1");
  });

  it("ignores orphan profiles and treats missing profiles as Starter", async () => {
    const { result, reads } = await metricsFor([authUser("current")], {
      profiles: {
        orphan: activeProfile()
      }
    });
    expect(result.metrics).toMatchObject({
      totalUsers: 1,
      starterUsers: 1,
      proUsers: 0
    });
    expect(reads.join("|")).not.toContain("orphan");
  });

  it("includes disabled registered users in user and plan totals", async () => {
    const { result } = await metricsFor([
      authUser("disabled-user", { disabled: true })
    ]);
    expect(result.metrics.totalUsers).toBe(1);
    expect(result.metrics.starterUsers).toBe(1);
  });

  it("excludes demo accounts, their usage, and their recent signup", async () => {
    const { result, reads } = await metricsFor([
      authUser("demo-user", { email: "demo@simple-books.test" }),
      authUser("customer")
    ], {
      profiles: {
        "demo-user": activeProfile(),
        customer: { currentPlan: "Starter" }
      },
      usage: {
        "demo-user": { aiAssistantSuccessfulUses: 500, invoiceScanningSuccessfulUses: 500 },
        customer: { aiAssistantSuccessfulUses: 2, invoiceScanningSuccessfulUses: 3 }
      }
    });
    expect(result.metrics).toMatchObject({
      totalUsers: 1,
      starterUsers: 1,
      proUsers: 0,
      aiAssistantSuccessfulUses: 2,
      invoiceScanningSuccessfulUses: 3
    });
    expect(result.recentSignups).toHaveLength(1);
    expect(reads.join("|")).not.toContain("demo-user");
  });

  it("excludes authoritative demoMode accounts from Pro, paid, and MRR metrics", async () => {
    const { result } = await metricsFor([
      authUser("flagged-demo"),
      authUser("customer")
    ], {
      accounts: { "flagged-demo": { demoMode: true } },
      profiles: {
        "flagged-demo": activeProfile(),
        customer: { currentPlan: "Starter" }
      }
    });

    expect(result.metrics).toMatchObject({
      totalUsers: 1,
      starterUsers: 1,
      proUsers: 0,
      activePaidSubscriptions: 0,
      estimatedMrrPence: 0
    });
    expect(result.recentSignups).toHaveLength(1);
  });

  it.each([undefined, null, "", "pro", "Enterprise", {}, []])(
    "normalises malformed or legacy plan %j to Starter",
    async currentPlan => {
      const { result } = await metricsFor([authUser("customer")], {
        profiles: { customer: { currentPlan } }
      });
      expect(result.metrics.starterUsers).toBe(1);
      expect(result.metrics.proUsers).toBe(0);
    }
  );

  it("counts exact Starter and Pro values without equating Pro to paid", async () => {
    const { result } = await metricsFor([
      authUser("starter"),
      authUser("pro")
    ], {
      profiles: {
        starter: { currentPlan: "Starter" },
        pro: { currentPlan: "Pro", subscriptionStatus: "past_due", billingOverride: true }
      }
    });
    expect(result.metrics).toMatchObject({
      starterUsers: 1,
      proUsers: 1,
      activePaidSubscriptions: 0,
      estimatedMrrPence: 0
    });
  });

  it("uses the same effective plan for aggregate and recent-signup diagnostics", async () => {
    const { result } = await metricsFor([authUser("legacy-pro")], {
      profiles: {
        "legacy-pro": {
          currentPlan: "Pro",
          subscriptionStatus: "active",
          stripePriceId: PRO_PRICE_ID,
          stripeCustomerId: "cus_legacy",
          stripeSubscriptionId: "sub_legacy"
        }
      }
    });
    expect(result.metrics).toMatchObject({ starterUsers: 1, proUsers: 0 });
    expect(result.recentSignups[0].plan).toBe("Starter");
  });

  it("counts only fully qualified active paid subscriptions", async () => {
    const { result } = await metricsFor([
      authUser("paid-one"),
      authUser("paid-two")
    ], {
      profiles: {
        "paid-one": activeProfile(),
        "paid-two": activeProfile({ stripeCustomerId: "cus_second" })
      }
    });
    expect(result.metrics.activePaidSubscriptions).toBe(2);
    expect(result.metrics.estimatedMrrPence).toBe(2 * PRO_MONTHLY_PRICE_PENCE);
    expect(Number.isInteger(result.metrics.estimatedMrrPence)).toBe(true);
  });

  it.each([
    ["trialing", {}],
    ["past_due", {}],
    ["canceled", {}],
    ["incomplete", {}],
    ["incomplete_expired", {}],
    ["unpaid", {}],
    ["paused", {}],
    ["missing status", { subscriptionStatus: undefined }],
    ["billing override", { billingOverride: true }],
    ["missing customer", { stripeCustomerId: "" }],
    ["missing subscription", { stripeSubscriptionId: "" }],
    ["wrong price", { stripePriceId: "price_wrong" }]
  ])("excludes %s from active paid and MRR", async (label, overrides) => {
    const profile = activeProfile(overrides);
    if(!Object.hasOwn(overrides, "subscriptionStatus") &&
      !["billing override", "missing customer", "missing subscription", "wrong price"].includes(label)){
      profile.subscriptionStatus = label;
    }
    const { result } = await metricsFor([authUser("customer")], {
      profiles: { customer: profile }
    });
    expect(result.metrics.activePaidSubscriptions).toBe(0);
    expect(result.metrics.estimatedMrrPence).toBe(0);
  });

  it("requires every active-paid qualification field", () => {
    expect(qualifiesAsActivePaidSubscription(activeProfile(), PRO_PRICE_ID, "test")).toBe(true);
    expect(qualifiesAsActivePaidSubscription({ currentPlan: "Pro" }, PRO_PRICE_ID, "test")).toBe(false);
  });

  it("selects the current UTC month and sums normalized successful usage", async () => {
    const { result, reads } = await metricsFor([
      authUser("one"),
      authUser("two"),
      authUser("three")
    ], {
      now: new Date("2027-01-01T00:30:00+01:00"),
      usage: {
        one: { aiAssistantSuccessfulUses: 2.9, invoiceScanningSuccessfulUses: 4 },
        two: { aiAssistantSuccessfulUses: -5, invoiceScanningSuccessfulUses: "7" }
      }
    });
    expect(result.monthKey).toBe("2026-12");
    expect(result.metrics.aiAssistantSuccessfulUses).toBe(2);
    expect(result.metrics.invoiceScanningSuccessfulUses).toBe(4);
    expect(reads).toContain("userProfiles/three/usage/2026-12");
  });

  it("reads only authoritative account, profile, and current usage documents", async () => {
    const { reads } = await metricsFor([authUser("customer")]);
    expect(reads).toEqual([
      "collection:users",
      "collection:userProfiles",
      "users/customer",
      "userProfiles/customer",
      "userProfiles/customer/usage/2026-07"
    ]);
  });
});

describe("admin growth chart data", () => {
  it("returns 12 chronological UTC months including the current month and zero months", async () => {
    const { result } = await metricsFor([
      authUser("august", { creationTime: "2025-08-31T23:59:59.999Z" }),
      authUser("september", { creationTime: "2025-09-01T00:00:00.000Z" }),
      authUser("current", { creationTime: "2026-07-15T12:00:00.000Z" })
    ]);
    const monthly = result.charts.monthlySignups;
    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ monthKey: "2025-08", label: "Aug 2025", count: 1 });
    expect(monthly.at(-1)).toEqual({ monthKey: "2026-07", label: "Jul 2026", count: 1 });
    expect(monthly.find(point => point.monthKey === "2025-10").count).toBe(0);
    expect(monthly.map(point => point.monthKey)).toEqual(
      [...monthly].map(point => point.monthKey).sort()
    );
  });

  it("uses pre-range and undated accounts as the opening cumulative baseline", async () => {
    const { result } = await metricsFor([
      authUser("old", { creationTime: "2020-01-01T00:00:00.000Z" }),
      authUser("malformed", { creationTime: "not-a-date" }),
      authUser("missing", { creationTime: null }),
      authUser("new", { creationTime: "2026-07-01T00:00:00.000Z" })
    ]);
    expect(result.charts.monthlySignups.reduce((sum, point) => sum + point.count, 0)).toBe(1);
    expect(result.charts.cumulativeUsers[0].count).toBe(3);
    expect(result.charts.cumulativeUsers.at(-1).count).toBe(result.metrics.totalUsers);
    for(let index = 1; index < result.charts.cumulativeUsers.length; index += 1){
      expect(result.charts.cumulativeUsers[index].count)
        .toBeGreaterThanOrEqual(result.charts.cumulativeUsers[index - 1].count);
    }
  });

  it("excludes demo identities and keeps plan distribution equal to KPI totals", async () => {
    const { result } = await metricsFor([
      authUser("demo-user", { creationTime: "2026-07-02T00:00:00.000Z" }),
      authUser("starter", { creationTime: "2026-06-02T00:00:00.000Z" }),
      authUser("pro", { creationTime: "2026-07-02T00:00:00.000Z" })
    ], { profiles: { pro: { currentPlan: "Pro", billingOverride: true } } });
    expect(result.charts.planDistribution).toEqual({ starter: 1, pro: 1 });
    expect(result.charts.planDistribution.starter).toBe(result.metrics.starterUsers);
    expect(result.charts.planDistribution.pro).toBe(result.metrics.proUsers);
    expect(Object.values(result.charts.planDistribution).reduce((sum, count) => sum + count, 0))
      .toBe(result.metrics.totalUsers);
    expect(result.charts.monthlySignups.at(-1).count).toBe(1);
  });

  it("derives chart totals after paging beyond one Auth page", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => authUser(`paged-${index}`));
    const auth = createAuthPages([firstPage, [authUser("paged-1000")]]);
    const result = await buildAdminMetrics({
      auth,
      firestore: createFirestore(),
      demoIdentifiers: parseDemoIdentifiers(DEMO_CONFIGURATION),
      proPriceId: PRO_PRICE_ID,
      expectedMode: "test",
      now: NOW
    });
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
    expect(result.metrics.totalUsers).toBe(1001);
    expect(result.charts.monthlySignups.at(-1).count).toBe(1001);
    expect(result.charts.cumulativeUsers.at(-1).count).toBe(1001);
  });

  it("returns only aggregate chart fields and reads no accounting collections", async () => {
    const { result, reads } = await metricsFor([authUser("private-user")]);
    const serialized = JSON.stringify(result.charts);
    expect(serialized).not.toMatch(/uid|email|stripe|business|address/i);
    expect(reads.every(read =>
      read.includes("userProfiles") ||
      read.startsWith("collection:userProfiles") ||
      read.includes("users/") ||
      read.startsWith("collection:users")
    )).toBe(true);
  });
});

describe("recent admin signups", () => {
  it("sorts newest first, limits to 10, and puts missing dates last", async () => {
    const users = Array.from({ length: 12 }, (_, index) => authUser(`user-${index}`, {
      creationTime: index === 0 ? "not-a-date" :
        `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
    }));
    const { result } = await metricsFor(users);
    expect(result.recentSignups).toHaveLength(RECENT_SIGNUP_LIMIT);
    expect(result.recentSignups[0].email).toBe("user-11@example.test");
    expect(result.recentSignups.some(record => record.joinedAt === null)).toBe(false);
  });

  it("returns null for missing dates when they enter the result set", async () => {
    const user = authUser("missing-date", { creationTime: null });
    const { result } = await metricsFor([user]);
    expect(result.recentSignups[0].joinedAt).toBeNull();
  });

  it("uses Auth email and returns only approved recent-signup fields", async () => {
    const { result } = await metricsFor([
      authUser("customer", { email: "auth-email@example.test" })
    ], {
      profiles: {
        customer: {
          currentPlan: "Pro",
          billingOverride: true,
          email: "stale-profile@example.test",
          stripeCustomerId: "must-not-return",
          stripeSubscriptionId: "must-not-return",
          billingOverrideReason: "must-not-return"
        }
      },
      usage: {
        customer: {
          aiAssistantSuccessfulUses: 3,
          invoiceScanningSuccessfulUses: 4,
          aiAssistantReservations: { private: true }
        }
      }
    });
    expect(result.recentSignups[0]).toEqual({
      email: "auth-email@example.test",
      plan: "Pro",
      joinedAt: "2026-07-01T12:00:00.000Z",
      subscriptionStatus: "",
      aiAssistantSuccessfulUses: 3,
      invoiceScanningSuccessfulUses: 4
    });
    expect(JSON.stringify(result)).not.toMatch(/uid|stripe|billingOverride|Reservations|must-not-return/);
  });
});
