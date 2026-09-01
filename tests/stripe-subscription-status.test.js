import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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

  it("keeps Pro eligibility limited to active and trialing", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUSES) {
      expect(hasProAccess("Pro", stripeSubscriptionStatus({ status })))
        .toBe(status === "active" || status === "trialing");
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

  it("connects the preserving mapper to checkout and subscription webhooks", () => {
    const source = readFileSync(
      new URL("../functions/lib/stripe-webhook-processor.js", import.meta.url),
      "utf8"
    );

    expect(source.match(
      /subscriptionStatus:\s*stripeSubscriptionStatus\(subscription\)/g
    )).toHaveLength(2);
    expect(source).not.toMatch(
      /subscriptionStatus:\s*subscription\s*\?\s*"active"/
    );
    expect(source).not.toMatch(
      /subscriptionStatus:\s*data\.status\s*===\s*"canceled"/
    );
  });
});
