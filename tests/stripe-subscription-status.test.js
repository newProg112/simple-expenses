import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  STRIPE_SUBSCRIPTION_STATUSES,
  isBillingPortalStatus,
  stripeSubscriptionStatus
} = require("../functions/lib/stripe-subscription-status.js");
const {
  hasProAccess
} = require("../functions/lib/plan-entitlements.js");

describe("Stripe subscription status preservation", () => {
  it("preserves every supported Stripe subscription status exactly", () => {
    expect(STRIPE_SUBSCRIPTION_STATUSES).toEqual([
      "incomplete",
      "incomplete_expired",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "paused"
    ]);

    for (const status of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(stripeSubscriptionStatus({ status })).toBe(status);
    }
  });

  it("fails closed for missing, malformed, and unknown statuses", () => {
    for (const subscription of [
      undefined,
      null,
      {},
      { status: "ACTIVE" },
      { status: "unknown" },
      { status: 123 }
    ]) {
      expect(stripeSubscriptionStatus(subscription)).toBe("");
    }
  });

  it("normalises the legacy British spelling to Stripe's canceled status", () => {
    expect(stripeSubscriptionStatus({ status: "cancelled" })).toBe("canceled");
  });

  it("includes past_due in temporary Pro eligibility", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(hasProAccess("Pro", stripeSubscriptionStatus({ status })))
        .toBe(["active", "trialing", "past_due"].includes(status));
    }
  });

  it("retains billing portal access for known non-canceled subscriptions", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(isBillingPortalStatus(status)).toBe(
        status !== "canceled" && status !== "incomplete_expired"
      );
    }
    expect(isBillingPortalStatus("cancelled")).toBe(false);
    expect(isBillingPortalStatus("unknown")).toBe(false);
  });

});
