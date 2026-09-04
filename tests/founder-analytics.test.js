import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_FOUNDER_ACTIVITY_LIMIT,
  FOUNDER_ANALYTICS_SCHEMA_VERSION,
  FounderAnalyticsProjectionError,
  MAX_FOUNDER_ACTIVITY_LIMIT,
  buildFounderAnalyticsSnapshot,
  parseFounderActivityLimit,
  projectFounderAnalyticsSnapshot
} = require("../functions/lib/founder-analytics.js");
const {
  EVENT_PRESENTATION
} = require("../functions/lib/admin-activity.js");

const NOW = new Date("2026-09-30T23:30:00.000Z");
const PRO_PRICE_ID = "price_pro_test";
const ADMIN_CONFIGURATION = "founder-one, founder-two";
const DEMO_CONFIGURATION = "uid:configured-demo,email:demo-fallback@example.test";

function monthSeriesEndingSeptember2026() {
  return Array.from({ length: 12 }, (_value, index) => {
    const date = new Date(Date.UTC(2025, 9 + index, 1));
    return {
      monthKey: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC"
      }),
      count: 0,
      privateChartField: "must-not-escape"
    };
  });
}

function validMetricsResult(overrides = {}) {
  const monthlySignups = overrides.monthlySignups || monthSeriesEndingSeptember2026();
  const metrics = {
    totalUsers: 0,
    starterUsers: 0,
    proUsers: 0,
    activePaidSubscriptions: 0,
    estimatedMrrPence: 0,
    currency: "GBP",
    aiAssistantSuccessfulUses: 999,
    invoiceScanningSuccessfulUses: 888,
    ...overrides.metrics
  };
  return {
    generatedAt: "private-upstream-timestamp",
    monthKey: "2026-09",
    metrics,
    charts: {
      rangeMonths: 12,
      monthlySignups,
      cumulativeUsers: [],
      planDistribution: { starter: metrics.starterUsers, pro: metrics.proUsers },
      privateChartData: "must-not-escape"
    },
    recentSignups: [{ email: "must-not-escape@example.test" }],
    stripeCustomerId: "cus_must_not_escape"
  };
}

function authUser(uid, options = {}) {
  return {
    uid,
    email: options.email ?? `${uid}@example.test`,
    disabled: options.disabled === true,
    metadata: {
      creationTime: options.creationTime ?? "2026-09-01T12:00:00.000Z"
    }
  };
}

function createAuthPages(pages) {
  return {
    listUsers: vi.fn(async (_pageSize, pageToken) => {
      const index = pageToken ? Number(pageToken) : 0;
      return {
        users: pages[index] || [],
        pageToken: index + 1 < pages.length ? String(index + 1) : undefined
      };
    })
  };
}

function snapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value
  };
}

function createFirestore({ accounts = {}, profiles = {}, usage = {}, reads = [] } = {}) {
  return {
    collection(name) {
      if(name === "users"){
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
      if(name === "userProfiles"){
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
      throw new Error(`Unexpected collection: ${name}`);
    }
  };
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

function buildOptions(overrides = {}) {
  return {
    auth: createAuthPages([[]]),
    firestore: createFirestore(),
    adminUidConfiguration: ADMIN_CONFIGURATION,
    demoConfiguration: DEMO_CONFIGURATION,
    proPriceId: PRO_PRICE_ID,
    expectedMode: "test",
    now: NOW,
    activityReader: vi.fn(async () => ({ events: [], nextCursor: null })),
    ...overrides
  };
}

describe("Founder Analytics V1 snapshot projection", () => {
  it("returns the exact versioned contract and projects only approved fields", () => {
    const metricsResult = validMetricsResult({
      metrics: {
        totalUsers: 3,
        starterUsers: 2,
        proUsers: 1,
        activePaidSubscriptions: 1,
        estimatedMrrPence: 1500
      }
    });
    const activityResult = {
      events: [
        {
          eventType: "invoice_created",
          createdAt: "2026-09-30T22:00:00.000Z",
          summary: "Client-controlled private summary",
          displayEmail: " Customer@Example.TEST ",
          uid: "private-uid",
          plan: "Pro",
          metadata: { invoiceNumber: "INV-PRIVATE" },
          stripeCustomerId: "cus_private"
        },
        {
          eventType: "bill_created",
          createdAt: "2026-09-30T21:00:00.000Z",
          summary: "Another untrusted summary",
          plan: "Starter",
          documentId: "private-document-id"
        }
      ],
      nextCursor: "private-cursor",
      privateNotes: "must-not-escape"
    };

    const result = projectFounderAnalyticsSnapshot({
      generatedAt: NOW.toISOString(),
      metricsResult,
      activityResult
    });

    expect(result).toEqual({
      schemaVersion: 1,
      generatedAt: NOW.toISOString(),
      overview: {
        totalUsers: 3,
        starterUsers: 2,
        proUsers: 1,
        activePaidSubscriptions: 1,
        estimatedMrrMinorUnits: 1500,
        currency: "GBP"
      },
      monthlySignups: monthSeriesEndingSeptember2026().map(({ monthKey, count }) => ({
        monthKey,
        count
      })),
      recentActivity: [
        {
          eventType: "invoice_created",
          createdAt: "2026-09-30T22:00:00.000Z",
          summary: EVENT_PRESENTATION.invoice_created.summary,
          displayEmail: "customer@example.test"
        },
        {
          eventType: "bill_created",
          createdAt: "2026-09-30T21:00:00.000Z",
          summary: EVENT_PRESENTATION.bill_created.summary,
          displayEmail: null
        }
      ]
    });
    expect(Object.keys(result)).toEqual([
      "schemaVersion", "generatedAt", "overview", "monthlySignups", "recentActivity"
    ]);
    expect(result.schemaVersion).toBe(FOUNDER_ANALYTICS_SCHEMA_VERSION);
    expect(JSON.stringify(result)).not.toMatch(
      /private-uid|private-document-id|private-cursor|cus_private|INV-PRIVATE|must-not-escape|untrusted summary|Client-controlled/
    );
    expect(result.recentActivity.every(event => !Object.hasOwn(event, "plan"))).toBe(true);
  });

  it("fails closed for malformed overview, month, timestamp, and event data", () => {
    const base = {
      generatedAt: NOW.toISOString(),
      metricsResult: validMetricsResult(),
      activityResult: { events: [] }
    };
    const invalidOverview = validMetricsResult({
      metrics: { totalUsers: 1, starterUsers: 0, proUsers: 0 }
    });
    expect(() => projectFounderAnalyticsSnapshot({
      ...base,
      metricsResult: invalidOverview
    })).toThrow(FounderAnalyticsProjectionError);

    const invalidMonths = monthSeriesEndingSeptember2026();
    invalidMonths[4] = { ...invalidMonths[4], monthKey: invalidMonths[3].monthKey };
    expect(() => projectFounderAnalyticsSnapshot({
      ...base,
      metricsResult: validMetricsResult({ monthlySignups: invalidMonths })
    })).toThrow(FounderAnalyticsProjectionError);

    expect(() => projectFounderAnalyticsSnapshot({
      ...base,
      activityResult: { events: [{ eventType: "unknown_event", createdAt: NOW.toISOString() }] }
    })).toThrow(FounderAnalyticsProjectionError);
    expect(() => projectFounderAnalyticsSnapshot({
      ...base,
      activityResult: { events: [{ eventType: "user_logged_in", createdAt: "not-a-date" }] }
    })).toThrow(FounderAnalyticsProjectionError);
  });

  it("uses a fixed recent-activity bound and rejects invalid composition limits", () => {
    expect(parseFounderActivityLimit()).toBe(DEFAULT_FOUNDER_ACTIVITY_LIMIT);
    expect(parseFounderActivityLimit(MAX_FOUNDER_ACTIVITY_LIMIT)).toBe(30);
    for(const value of [0, 31, 1.5, "20", null]){
      expect(() => parseFounderActivityLimit(value)).toThrowError(
        expect.objectContaining({ code: "invalid-argument" })
      );
    }
  });
});

describe("Founder Analytics V1 composition", () => {
  it("reuses existing metrics semantics while excluding configured admins", async () => {
    const reads = [];
    const auth = createAuthPages([
      [
        authUser("founder-one", { creationTime: "2026-09-05T12:00:00.000Z" }),
        authUser("disabled-starter", {
          disabled: true,
          creationTime: "2026-09-01T00:00:00.000Z"
        }),
        authUser("starter", { creationTime: "2026-08-31T23:59:59.999Z" }),
        authUser("configured-demo", { creationTime: "2026-09-10T00:00:00.000Z" })
      ],
      [
        authUser("paid-pro", { creationTime: "2026-09-15T00:00:00.000Z" }),
        authUser("trial-pro", { creationTime: "2026-09-16T00:00:00.000Z" }),
        authUser("override-pro", { creationTime: "2026-07-20T00:00:00.000Z" }),
        authUser("flagged-demo", { creationTime: "2026-09-17T00:00:00.000Z" }),
        authUser("email-demo", {
          email: "DEMO-FALLBACK@example.test",
          creationTime: "2026-09-18T00:00:00.000Z"
        })
      ]
    ]);
    const firestore = createFirestore({
      reads,
      accounts: {
        "flagged-demo": { demoMode: true }
      },
      profiles: {
        "paid-pro": activeProfile(),
        "trial-pro": activeProfile({ subscriptionStatus: "trialing" }),
        "override-pro": { currentPlan: "Pro", billingOverride: true },
        "flagged-demo": activeProfile()
      }
    });

    const result = await buildFounderAnalyticsSnapshot(buildOptions({ auth, firestore }));

    expect(result.overview).toEqual({
      totalUsers: 5,
      starterUsers: 2,
      proUsers: 3,
      activePaidSubscriptions: 1,
      estimatedMrrMinorUnits: 1500,
      currency: "GBP"
    });
    expect(result.monthlySignups.find(item => item.monthKey === "2026-07").count).toBe(1);
    expect(result.monthlySignups.find(item => item.monthKey === "2026-08").count).toBe(1);
    expect(result.monthlySignups.find(item => item.monthKey === "2026-09").count).toBe(3);
    expect(reads.join("|")).not.toMatch(/founder-one|configured-demo|email-demo/);
    expect(reads.join("|")).toContain("users/disabled-starter");
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
  });

  it("returns the deterministic twelve-month zero snapshot for an empty system", async () => {
    const result = await buildFounderAnalyticsSnapshot(buildOptions());

    expect(result).toMatchObject({
      schemaVersion: 1,
      generatedAt: NOW.toISOString(),
      overview: {
        totalUsers: 0,
        starterUsers: 0,
        proUsers: 0,
        activePaidSubscriptions: 0,
        estimatedMrrMinorUnits: 0,
        currency: "GBP"
      },
      recentActivity: []
    });
    expect(result.monthlySignups).toHaveLength(12);
    expect(result.monthlySignups.every(item => item.count === 0)).toBe(true);
    expect(result.monthlySignups.at(-1).monthKey).toBe("2026-09");
  });

  it("passes shared demo configuration and the bounded activity request to the existing services", async () => {
    const auth = createAuthPages([[
      authUser("founder-one"),
      authUser("customer-one")
    ]]);
    const metricsBuilder = vi.fn(async options => {
      const page = await options.auth.listUsers(1000);
      expect(page.users.map(user => user.uid)).toEqual(["customer-one"]);
      expect(options.demoIdentifiers.uids.has("configured-demo")).toBe(true);
      expect(options.demoIdentifiers.emails.has("demo-fallback@example.test")).toBe(true);
      expect(options.now).toEqual(NOW);
      return validMetricsResult();
    });
    const activityReader = vi.fn(async options => {
      expect(options.demoIdentifiers.uids.has("configured-demo")).toBe(true);
      expect(options.limit).toBe(7);
      expect(options).not.toHaveProperty("cursor");
      return { events: [], nextCursor: "ignored-by-v1" };
    });

    await expect(buildFounderAnalyticsSnapshot(buildOptions({
      auth,
      metricsBuilder,
      activityReader,
      activityLimit: 7
    }))).resolves.toMatchObject({ schemaVersion: 1 });
    expect(metricsBuilder).toHaveBeenCalledOnce();
    expect(activityReader).toHaveBeenCalledOnce();
  });
});
