import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { parseDemoIdentifiers } = require("../functions/lib/admin-authorization.js");
const {
  ADMIN_USER_SEARCH_PAGE_SIZE,
  ADMIN_USER_SEARCH_RESULT_LIMIT,
  findMatchingAuthUsers,
  searchAdminUsers
} = require("../functions/lib/admin-user-search.js");
const {
  ADMIN_USER_SEARCH_QUERY_MAX_LENGTH,
  createAdminUserSearchHandler,
  validSearchQuery
} = require("../functions/lib/admin-user-search-handler.js");

const NOW = new Date("2026-07-31T20:00:00.000Z");
const DEMO_CONFIGURATION = "uid:demo-user,email:demo@example.test";
const DEMO_IDENTIFIERS = parseDemoIdentifiers(DEMO_CONFIGURATION);

function authUser(uid, email, metadata = {}) {
  return {
    uid,
    email,
    metadata: {
      creationTime: metadata.creationTime || "2026-01-02T10:00:00.000Z",
      lastSignInTime: metadata.lastSignInTime || "2026-07-30T14:15:00.000Z"
    }
  };
}

function pagedAuth(pages) {
  return {
    listUsers: vi.fn(async (pageSize, pageToken) => {
      expect(pageSize).toBe(ADMIN_USER_SEARCH_PAGE_SIZE);
      const index = pageToken ? Number(pageToken) : 0;
      return {
        users: pages[index] || [],
        pageToken: index + 1 < pages.length ? String(index + 1) : undefined
      };
    })
  };
}

function snapshot(value) {
  return { exists: value !== undefined, data: () => value };
}

function testFirestore({ profiles = {}, usage = {}, reads = [] } = {}) {
  return {
    collection(name) {
      reads.push(`collection:${name}`);
      if(name !== "userProfiles") throw new Error(`Unexpected collection ${name}`);
      return {
        doc(uid) {
          return {
            get: async () => {
              reads.push(`userProfiles/${uid}`);
              return snapshot(profiles[uid]);
            },
            collection(subcollection) {
              if(subcollection !== "usage") throw new Error(`Unexpected subcollection ${subcollection}`);
              return {
                doc(monthKey) {
                  return {
                    get: async () => {
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

describe("searchAdminUsers callable authorization and validation", () => {
  it("rejects unauthenticated and non-admin callers before searching", async () => {
    const searchBuilder = vi.fn();
    const handler = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION,
      searchBuilder
    });
    await expect(handler({ data: { query: "customer" } }))
      .rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handler({
      auth: { uid: "not-owner" },
      data: { query: "customer", admin: true, uid: "owner-uid" }
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(searchBuilder).not.toHaveBeenCalled();
  });

  it("allows a configured admin, trims the query, and ignores browser admin flags", async () => {
    const response = { results: [] };
    const searchBuilder = vi.fn(async () => response);
    const handler = createAdminUserSearchHandler({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION,
      now: () => NOW,
      searchBuilder
    });
    await expect(handler({
      auth: { uid: "owner-uid" },
      data: { query: "  CUSTOMER  ", admin: false, uid: "someone-else" }
    })).resolves.toBe(response);
    expect(searchBuilder).toHaveBeenCalledWith(expect.objectContaining({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      query: "CUSTOMER",
      now: NOW
    }));
    expect(searchBuilder.mock.calls[0][0]).not.toHaveProperty("admin");
  });

  it("fails closed when either backend configuration value is missing", async () => {
    const missingAdmin = createAdminUserSearchHandler({
      adminUidConfiguration: "",
      demoConfiguration: DEMO_CONFIGURATION
    });
    const missingDemo = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid",
      demoConfiguration: ""
    });
    await expect(missingAdmin({ auth: { uid: "owner-uid" } }))
      .rejects.toMatchObject({ code: "failed-precondition" });
    await expect(missingDemo({ auth: { uid: "owner-uid" } }))
      .rejects.toMatchObject({ code: "failed-precondition" });
  });

  it.each([
    [undefined],
    [{}],
    [{ query: 12 }],
    [{ query: "   " }],
    [{ query: "a" }],
    [{ query: "a".repeat(ADMIN_USER_SEARCH_QUERY_MAX_LENGTH + 1) }]
  ])("rejects malformed search input: %j", async data => {
    const handler = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION
    });
    await expect(handler({ auth: { uid: "owner-uid" }, data }))
      .rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("normalises only valid bounded string queries", () => {
    expect(validSearchQuery({ query: "  Ab " })).toBe("Ab");
    expect(validSearchQuery({ query: "x" })).toBe("");
    expect(validSearchQuery({ query: "x".repeat(321) })).toBe("");
    expect(validSearchQuery({ query: 22 })).toBe("");
  });

  it("uses privacy-safe logging for search failures", async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const handler = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION,
      searchBuilder: async () => {
        throw new Error("private.customer@example.test cus_private");
      },
      logger
    });
    await expect(handler({
      auth: { uid: "owner-uid" },
      data: { query: "private.customer" }
    })).rejects.toMatchObject({ code: "internal" });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("private.customer@example.test");
    expect(logged).not.toContain("cus_private");
  });
});

describe("secure all-user search", () => {
  it("matches partial emails case-insensitively across Auth pages", async () => {
    const auth = pagedAuth([
      [authUser("first", "other@example.test")],
      [authUser("match", "Alice.Customer@Example.test")]
    ]);
    const matches = await findMatchingAuthUsers(auth, "CUSTOMER@exa", DEMO_IDENTIFIERS);
    expect(matches.map(user => user.email)).toEqual(["Alice.Customer@Example.test"]);
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
  });

  it("excludes demo users and safely ignores accounts without email", async () => {
    const auth = pagedAuth([[
      authUser("demo-user", "matching@example.test"),
      authUser("demo-email", "DEMO@example.test"),
      authUser("no-email", undefined),
      authUser("customer", "matching.customer@example.test")
    ]]);
    const matches = await findMatchingAuthUsers(auth, "example", DEMO_IDENTIFIERS);
    expect(matches.map(user => user.uid)).toEqual(["customer"]);
  });

  it("limits matching Auth users to 20", async () => {
    const users = Array.from({ length: 25 }, (_, index) =>
      authUser(`customer-${index}`, `customer-${index}@example.test`)
    );
    const matches = await findMatchingAuthUsers(
      pagedAuth([users]),
      "customer",
      DEMO_IDENTIFIERS
    );
    expect(matches).toHaveLength(ADMIN_USER_SEARCH_RESULT_LIMIT);
  });

  it("normalises missing profiles and returns only approved fields", async () => {
    const reads = [];
    const result = await searchAdminUsers({
      auth: pagedAuth([[authUser("customer", "customer@example.test")]]),
      firestore: testFirestore({
        profiles: { orphan: { currentPlan: "Pro" } },
        reads
      }),
      demoIdentifiers: DEMO_IDENTIFIERS,
      query: "CUSTOMER",
      now: NOW
    });
    expect(result.results).toEqual([{
      email: "customer@example.test",
      plan: "Starter",
      joinedAt: "2026-01-02T10:00:00.000Z",
      lastSignInAt: "2026-07-30T14:15:00.000Z",
      subscriptionStatus: "",
      aiAssistantSuccessfulUses: 0,
      invoiceScanningSuccessfulUses: 0,
      stripeCustomerLinked: false
    }]);
    expect(reads).not.toContain("userProfiles/orphan");
    expect(JSON.stringify(result)).not.toMatch(/uid|stripeCustomerId|stripeSubscriptionId|stripePriceId|path|token/);
  });

  it("projects approved profile and usage values without private identifiers", async () => {
    const result = await searchAdminUsers({
      auth: pagedAuth([[authUser("customer", "customer@example.test")]]),
      firestore: testFirestore({
        profiles: { customer: {
          currentPlan: "Pro",
          subscriptionStatus: "active",
          stripeCustomerId: "cus_private",
          stripeSubscriptionId: "sub_private",
          paymentMethodLast4: "4242",
          billingAddress: "private"
        } },
        usage: { customer: {
          aiAssistantSuccessfulUses: 5,
          invoiceScanningSuccessfulUses: 2,
          token: "private"
        } }
      }),
      demoIdentifiers: DEMO_IDENTIFIERS,
      query: "example",
      now: NOW
    });
    expect(result.results[0]).toMatchObject({
      plan: "Pro",
      subscriptionStatus: "active",
      aiAssistantSuccessfulUses: 5,
      invoiceScanningSuccessfulUses: 2,
      stripeCustomerLinked: true
    });
    expect(Object.keys(result.results[0])).toEqual([
      "email",
      "plan",
      "joinedAt",
      "lastSignInAt",
      "subscriptionStatus",
      "aiAssistantSuccessfulUses",
      "invoiceScanningSuccessfulUses",
      "stripeCustomerLinked"
    ]);
    expect(JSON.stringify(result)).not.toMatch(/cus_private|sub_private|4242|billingAddress|token/);
  });
});
