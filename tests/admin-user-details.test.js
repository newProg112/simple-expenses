import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { AdminUserNotFoundError, buildAdminUserDetails } = require("../functions/lib/admin-user-details.js");
const { readRecentSafeActivity } = require("../functions/lib/admin-user-details.js");
const { createAdminUserDetailsHandler, requestedUserSelector } = require("../functions/lib/admin-user-details-handler.js");

const NOW = new Date("2026-07-31T20:00:00.000Z");
const DEMO_CONFIGURATION = "uid:demo-user,email:demo@example.test";
const snapshot = value => ({ exists: value !== undefined, data: () => value });

function firestoreFor({ account, profile, usage, adminNotes, projectCount = 0, activity = [] } = {}) {
  return {
    collection(name) {
      if(name === "users") return {
        doc: () => ({
          get: async () => snapshot(account),
          collection: () => ({
            where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: projectCount }) }) }) })
          })
        })
      };
      if(name === "userProfiles") return {
        doc: () => ({
          get: async () => snapshot(profile),
          collection: () => ({ doc: () => ({ get: async () => snapshot(usage) }) })
        })
      };
      if(name === "adminActivityEvents") return {
        where: () => ({ orderBy: () => ({ limit: () => ({
          select: () => ({ get: async () => ({ docs: activity.map(value => ({ data: () => value })) }) })
        }) }) })
      };
      if(name === "adminUserNotes") return {
        doc: () => ({ get: async () => snapshot(adminNotes) })
      };
      throw new Error(`Unexpected collection ${name}`);
    }
  };
}

const authUser = {
  uid: "customer-uid", email: "customer@example.test", displayName: "Ada Customer",
  emailVerified: true, disabled: false,
  metadata: { creationTime: "2026-01-02T10:00:00.000Z", lastSignInTime: "2026-07-30T14:15:00.000Z" }
};

describe("Admin User Management detail authorization", () => {
  it("requires backend authentication and the admin UID allow-list", async () => {
    const detailsBuilder = vi.fn();
    const handler = createAdminUserDetailsHandler({
      adminUidConfiguration: "owner-uid", demoConfiguration: DEMO_CONFIGURATION, detailsBuilder
    });
    await expect(handler({ data: { uid: "customer-uid" } })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handler({ auth: { uid: "other" }, data: { uid: "customer-uid" } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(detailsBuilder).not.toHaveBeenCalled();
  });

  it("accepts exactly one valid UID or normalized email selector", async () => {
    expect(requestedUserSelector({ uid: " customer-uid " })).toEqual({ uid: "customer-uid" });
    expect(requestedUserSelector({ email: " USER@EXAMPLE.TEST " })).toEqual({ email: "user@example.test" });
    expect(requestedUserSelector({ uid: "x", email: "x@example.test" })).toBeNull();
    const detailsBuilder = vi.fn(async () => ({ account: {} }));
    const handler = createAdminUserDetailsHandler({
      auth: {}, firestore: {}, adminUidConfiguration: "owner-uid",
      demoConfiguration: DEMO_CONFIGURATION, detailsBuilder, now: () => NOW
    });
    await handler({ auth: { uid: "owner-uid" }, data: { uid: "customer-uid" } });
    expect(detailsBuilder).toHaveBeenCalledWith(expect.objectContaining({
      selector: { uid: "customer-uid" }, adminUids: new Set(["owner-uid"]), now: NOW
    }));
  });

  it("returns not-found without exposing identifiers", async () => {
    const handler = createAdminUserDetailsHandler({
      adminUidConfiguration: "owner-uid", demoConfiguration: DEMO_CONFIGURATION,
      detailsBuilder: async () => { throw new AdminUserNotFoundError(); }
    });
    await expect(handler({ auth: { uid: "owner-uid" }, data: { email: "missing@example.test" } }))
      .rejects.toMatchObject({ code: "not-found", message: "User was not found." });
  });
});

describe("read-only account detail projection", () => {
  it("intentionally keeps admin support actions out of Recent Safe Activity", async () => {
    const activity = [
      {eventType: "admin_ai_usage_reset", createdAt: NOW},
      {eventType: "admin_invoice_scanning_usage_reset", createdAt: NOW},
      {eventType: "invoice_created", createdAt: NOW}
    ];
    const result = await readRecentSafeActivity(firestoreFor({activity}), "customer-uid");
    expect(result.map(event => event.eventType)).toEqual(["invoice_created"]);
  });

  it("maps Firebase Auth misses to the safe lookup error", async () => {
    const auth = { getUser: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); }) };
    await expect(buildAdminUserDetails({
      auth, firestore: firestoreFor(), selector: { uid: "missing" },
      adminUids: new Set(), demoIdentifiers: { uids: new Set(), emails: new Set() }, now: NOW
    })).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });

  it("returns account, plan, allowances, project count and only safe recent activity", async () => {
    const auth = { getUser: vi.fn(async () => authUser) };
    const result = await buildAdminUserDetails({
      auth,
      firestore: firestoreFor({
        account: { businessName: "Ada Books", privateNote: "secret" },
        profile: {
          currentPlan: "Pro", subscriptionStatus: "active", stripePriceId: "price_pro",
          stripeCustomerId: "cus_private", stripeSubscriptionId: "sub_private",
          subscriptionCurrentPeriodEnd: { toDate: () => new Date("2026-08-31T00:00:00.000Z") }
        },
        usage: { aiAssistantSuccessfulUses: 7, invoiceScanningSuccessfulUses: 3, token: "private" },
        adminNotes: {notes: "Customer called about scanning.", updatedAt: new Date("2026-07-30T13:00:00.000Z"), updatedByAdminUid: "owner-uid"},
        projectCount: 4,
        activity: [
          { eventType: "invoice_created", createdAt: new Date("2026-07-30T12:00:00.000Z"), metadata: { secret: true } },
          { eventType: "unknown_private_event", createdAt: new Date("2026-07-30T11:00:00.000Z") }
        ]
      }),
      selector: { uid: authUser.uid }, adminUids: new Set(),
      demoIdentifiers: { uids: new Set(), emails: new Set() }, proPriceId: "price_pro", now: NOW
    });
    expect(result).toMatchObject({
      account: {
        uid: "customer-uid", email: "customer@example.test", fullName: "Ada Customer",
        businessName: "Ada Books", emailVerified: true, disabled: false, badges: ["Active"]
      },
      plan: { currentPlan: "Pro", subscriptionStatus: "active", activePaidSubscription: true },
      usage: {
        monthKey: "2026-07", aiAssistantSuccessfulUses: 7, aiAssistantAllowance: 500,
        invoiceScanningSuccessfulUses: 3, invoiceScanningAllowance: 500, activeProjects: 4
      },
      recentActivity: [{
        eventType: "invoice_created", summary: "An invoice was successfully created.",
        timestamp: "2026-07-30T12:00:00.000Z"
      }],
      adminNotes: {text: "Customer called about scanning.", updatedAt: "2026-07-30T13:00:00.000Z", updatedByAdminUid: "owner-uid"}
    });
    expect(JSON.stringify(result)).not.toMatch(/privateNote|secret|cus_private|sub_private|stripePriceId|metadata|token/);
  });
});
