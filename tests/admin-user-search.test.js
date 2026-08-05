import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { parseDemoIdentifiers } = require("../functions/lib/admin-authorization.js");
const {
  ADMIN_USER_SEARCH_RESULT_LIMIT,
  ADMIN_USER_SEARCH_SCAN_LIMIT,
  findMatchingAuthUsers,
  searchAdminUsers
} = require("../functions/lib/admin-user-search.js");
const {
  createAdminUserSearchHandler,
  validSearchQuery
} = require("../functions/lib/admin-user-search-handler.js");

const DEMO_CONFIGURATION = "uid:demo-user,email:demo@example.test";
const DEMO_IDENTIFIERS = parseDemoIdentifiers(DEMO_CONFIGURATION);
const ADMIN_UIDS = new Set(["owner-uid"]);

function authUser(uid, email, overrides = {}) {
  return {
    uid,
    email,
    emailVerified: true,
    disabled: false,
    metadata: {
      creationTime: "2026-01-02T10:00:00.000Z",
      lastSignInTime: "2026-07-30T14:15:00.000Z"
    },
    ...overrides
  };
}

function pagedAuth(pages, exactUsers = {}) {
  return {
    getUser: vi.fn(async uid => {
      if(exactUsers[uid]) return exactUsers[uid];
      throw Object.assign(new Error("missing"), { code: "auth/user-not-found" });
    }),
    getUserByEmail: vi.fn(async email => {
      const user = Object.values(exactUsers).find(candidate => candidate.email?.toLowerCase() === email);
      if(user) return user;
      throw Object.assign(new Error("missing"), { code: "auth/user-not-found" });
    }),
    listUsers: vi.fn(async (_pageSize, pageToken) => {
      const index = pageToken ? Number(pageToken) : 0;
      return {
        users: pages[index] || [],
        pageToken: index + 1 < pages.length ? String(index + 1) : undefined
      };
    })
  };
}

const snapshot = value => ({ exists: value !== undefined, data: () => value });

function firestoreFor({ accounts = {}, profiles = {} } = {}) {
  return {
    collection(name) {
      if(name === "users") return {
        doc: uid => ({ get: async () => snapshot(accounts[uid]) }),
        where: (field, _operator, value) => ({
          limit: maximum => ({
            select: () => ({
              get: async () => ({
                docs: Object.entries(accounts)
                  .filter(([, account]) => account?.[field] === value)
                  .slice(0, maximum)
                  .map(([id, account]) => ({ id, data: () => account }))
              })
            })
          })
        })
      };
      if(name === "userProfiles") return { doc: uid => ({ get: async () => snapshot(profiles[uid]) }) };
      throw new Error(`Unexpected collection ${name}`);
    }
  };
}

describe("Admin User Management search authorization", () => {
  it("rejects signed-out and non-admin callers before any lookup", async () => {
    const searchBuilder = vi.fn();
    const handler = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION,
      searchBuilder
    });
    await expect(handler({ data: { query: "customer" } })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handler({ auth: { uid: "other" }, data: { query: "customer" } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(searchBuilder).not.toHaveBeenCalled();
  });

  it("trims bounded input, permits short exact UIDs and ignores client admin flags", async () => {
    const searchBuilder = vi.fn(async () => ({ results: [] }));
    const handler = createAdminUserSearchHandler({
      auth: {}, firestore: {}, adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION, searchBuilder
    });
    await handler({ auth: { uid: "owner-uid" }, data: { query: " x " } });
    expect(searchBuilder).toHaveBeenCalledWith(expect.objectContaining({
      query: "x", adminUids: new Set(["owner-uid"])
    }));
    expect(searchBuilder.mock.calls[0][0]).not.toHaveProperty("admin");
    expect(validSearchQuery({ query: " x " })).toBe("x");
    expect(validSearchQuery({ query: " " })).toBe("");
    expect(validSearchQuery({ query: "x".repeat(321) })).toBe("");
  });

  it("returns only privacy-safe failure information", async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const handler = createAdminUserSearchHandler({
      adminUidConfiguration: "owner-uid", demoConfiguration: DEMO_CONFIGURATION,
      searchBuilder: async () => { throw new Error("private@example.test cus_private"); }, logger
    });
    await expect(handler({ auth: { uid: "owner-uid" }, data: { query: "private" } }))
      .rejects.toMatchObject({ code: "internal" });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/private@example|cus_private/);
  });
});

describe("bounded read-only user search", () => {
  it("resolves an exact short UID without scanning Auth", async () => {
    const user = authUser("x", "exact@example.test");
    const auth = pagedAuth([], { x: user });
    const result = await findMatchingAuthUsers(auth, "x");
    expect(result).toEqual({ users: [user], truncated: false, exact: true });
    expect(auth.listUsers).not.toHaveBeenCalled();
  });

  it("matches email and Auth display name case-insensitively across pages", async () => {
    const auth = pagedAuth([
      [authUser("one", "other@example.test")],
      [authUser("two", "alice@example.test", { displayName: "Alice Example" })]
    ]);
    const email = await findMatchingAuthUsers(auth, "ALICE@EXA");
    expect(email.users.map(user => user.uid)).toEqual(["two"]);
    const byName = await findMatchingAuthUsers(pagedAuth([[authUser("two", "alice@example.test", { displayName: "Alice Example" })]]), "example");
    expect(byName.users).toHaveLength(1);
  });

  it("uses a bounded indexed equality query for stored full names", async () => {
    const user = authUser("stored-name", "stored@example.test");
    const result = await searchAdminUsers({
      auth: pagedAuth([[]], { "stored-name": user }),
      firestore: firestoreFor({ accounts: { "stored-name": { fullName: "Stored Customer" } } }),
      demoIdentifiers: DEMO_IDENTIFIERS, adminUids: ADMIN_UIDS, query: "Stored Customer"
    });
    expect(result.results[0]).toMatchObject({ uid: "stored-name", fullName: "Stored Customer" });
  });

  it("caps both scanned accounts and returned matches", async () => {
    const users = Array.from({ length: ADMIN_USER_SEARCH_SCAN_LIMIT + 50 }, (_, index) =>
      authUser(`customer-${index}`, `customer-${index}@example.test`));
    const auth = pagedAuth([users.slice(0, 1000), users.slice(1000, 2000)]);
    const result = await findMatchingAuthUsers(auth, "customer");
    expect(result.users).toHaveLength(ADMIN_USER_SEARCH_RESULT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(auth.listUsers).toHaveBeenCalledTimes(1);
  });

  it("projects only approved fields, badges demos, and documents the business-name limitation", async () => {
    const user = authUser("demo-user", "demo@example.test", {
      displayName: "Demo Person", emailVerified: false, disabled: true
    });
    const result = await searchAdminUsers({
      auth: pagedAuth([[user]]), firestore: firestoreFor({
        accounts: { "demo-user": { businessName: "Demo Books", demoMode: true, privateNote: "secret" } },
        profiles: { "demo-user": { currentPlan: "Pro", stripeCustomerId: "cus_private" } }
      }), demoIdentifiers: DEMO_IDENTIFIERS, adminUids: ADMIN_UIDS, query: "demo"
    });
    expect(result).toEqual({
      results: [{
        uid: "demo-user", email: "demo@example.test", fullName: "Demo Person",
        businessName: "Demo Books", plan: "Pro",
        accountStatus: ["Disabled", "Demo", "Email unverified"],
        signupDate: "2026-01-02T10:00:00.000Z",
        lastActivityDate: "2026-07-30T14:15:00.000Z"
      }],
      truncated: false,
      businessNameSearchSupported: false
    });
    expect(JSON.stringify(result)).not.toMatch(/privateNote|secret|cus_private|stripeCustomerId/);
  });
});
