import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AdminUserNotFoundError,
  buildAdminUserDetails
} = require("../functions/lib/admin-user-details.js");
const {
  createAdminUserDetailsHandler
} = require("../functions/lib/admin-user-details-handler.js");

const NOW = new Date("2026-07-31T20:00:00.000Z");

function snapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value
  };
}

function firestoreFor(profile, usage, reads = []) {
  return {
    collection(name) {
      reads.push(name);
      expect(name).toBe("userProfiles");
      return {
        doc(uid) {
          expect(uid).toBe("customer-uid");
          return {
            get: async () => snapshot(profile),
            collection(subcollection) {
              expect(subcollection).toBe("usage");
              return {
                doc(monthKey) {
                  expect(monthKey).toBe("2026-07");
                  return { get: async () => snapshot(usage) };
                }
              };
            }
          };
        }
      };
    }
  };
}

function authFor(user) {
  return { getUserByEmail: vi.fn(async () => user) };
}

describe("getAdminUserDetails authorization", () => {
  it("requires authentication and the configured backend allow-list", async () => {
    const detailsBuilder = vi.fn();
    const handler = createAdminUserDetailsHandler({
      adminUidConfiguration: "owner-uid",
      detailsBuilder
    });

    await expect(handler({ data: { email: "customer@example.test" } }))
      .rejects.toMatchObject({ code: "unauthenticated" });
    await expect(handler({
      auth: { uid: "not-owner" },
      data: { email: "customer@example.test", admin: true }
    })).rejects.toMatchObject({ code: "permission-denied" });
    expect(detailsBuilder).not.toHaveBeenCalled();
  });

  it("allows an authorised admin and accepts only the email input", async () => {
    const response = { email: "customer@example.test" };
    const detailsBuilder = vi.fn(async () => response);
    const handler = createAdminUserDetailsHandler({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      adminUidConfiguration: "owner-uid",
      now: () => NOW,
      detailsBuilder
    });

    await expect(handler({
      auth: { uid: "owner-uid" },
      data: { email: " customer@example.test " }
    })).resolves.toBe(response);
    expect(detailsBuilder).toHaveBeenCalledWith({
      auth: { server: "auth" },
      firestore: { server: "firestore" },
      email: "customer@example.test",
      now: NOW
    });
    await expect(handler({
      auth: { uid: "owner-uid" },
      data: { email: "customer@example.test", admin: true }
    })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("returns not-found for an unknown email", async () => {
    const handler = createAdminUserDetailsHandler({
      adminUidConfiguration: "owner-uid",
      detailsBuilder: async () => {
        throw new AdminUserNotFoundError();
      }
    });
    await expect(handler({
      auth: { uid: "owner-uid" },
      data: { email: "unknown@example.test" }
    })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("admin customer detail projection", () => {
  const user = {
    uid: "customer-uid",
    email: "customer@example.test",
    metadata: {
      creationTime: "2026-01-02T10:00:00.000Z",
      lastSignInTime: "2026-07-30T14:15:00.000Z"
    }
  };

  it("maps Firebase Auth's unknown-email result to the lookup error", async () => {
    const auth = {
      getUserByEmail: vi.fn(async () => {
        const error = new Error("Firebase user missing");
        error.code = "auth/user-not-found";
        throw error;
      })
    };
    await expect(buildAdminUserDetails({
      auth,
      firestore: firestoreFor(undefined, undefined),
      email: "unknown@example.test",
      now: NOW
    })).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });

  it("returns safe defaults when the Firestore profile is missing", async () => {
    const result = await buildAdminUserDetails({
      auth: authFor(user),
      firestore: firestoreFor(undefined, undefined),
      email: user.email,
      now: NOW
    });
    expect(result).toEqual({
      email: user.email,
      plan: "Starter",
      subscriptionStatus: "",
      createdDate: "2026-01-02T10:00:00.000Z",
      lastSignInTime: "2026-07-30T14:15:00.000Z",
      aiAssistantSuccessfulUses: 0,
      invoiceScanningSuccessfulUses: 0,
      stripeCustomerPresent: false,
      currentPeriodEnd: null
    });
  });

  it("returns only the approved read-only customer summary", async () => {
    const result = await buildAdminUserDetails({
      auth: authFor(user),
      firestore: firestoreFor({
        currentPlan: "Pro",
        subscriptionStatus: "active",
        stripeCustomerId: "cus_private",
        stripeSubscriptionId: "sub_private",
        subscriptionCurrentPeriodEnd: {
          toDate: () => new Date("2026-08-31T00:00:00.000Z")
        },
        billingAddress: { line1: "private" },
        tokens: ["private"]
      }, {
        aiAssistantSuccessfulUses: 7,
        invoiceScanningSuccessfulUses: 3,
        privateReservations: { value: true }
      }),
      email: user.email,
      now: NOW
    });

    expect(result).toEqual({
      email: user.email,
      plan: "Pro",
      subscriptionStatus: "active",
      createdDate: "2026-01-02T10:00:00.000Z",
      lastSignInTime: "2026-07-30T14:15:00.000Z",
      aiAssistantSuccessfulUses: 7,
      invoiceScanningSuccessfulUses: 3,
      stripeCustomerPresent: true,
      currentPeriodEnd: "2026-08-31T00:00:00.000Z"
    });
    expect(JSON.stringify(result)).not.toMatch(/uid|cus_private|sub_private|billingAddress|tokens|Reservations/);
  });
});
