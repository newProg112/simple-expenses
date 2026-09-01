import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as frontend from "../resources/js/plan-entitlements.js";

const require = createRequire(import.meta.url);
const backend = require("../functions/lib/plan-entitlements.js");
const adapters = [
  ["frontend", frontend],
  ["backend", backend]
];
const liveBillingConfiguration = {
  expectedMode: "live",
  proPriceId: "price_1UAwaZQwA8Uui39wNgjE9zNh"
};
const liveProProfile = {
  currentPlan: "Pro",
  subscriptionStatus: "active",
  stripeMode: "live",
  stripePriceId: liveBillingConfiguration.proPriceId,
  stripeCustomerId: "cus_live",
  stripeSubscriptionId: "sub_live"
};

const starterEntitlements = {
  aiAssistantMonthlyLimit: 10,
  invoiceScanningMonthlyLimit: 10,
  activeProjectsLimit: 5,
  accountantPack: false,
  reports: {
    trialBalance: false,
    generalLedger: false,
    profitLoss: false,
    balanceSheet: false
  }
};

const proEntitlements = {
  aiAssistantMonthlyLimit: 500,
  invoiceScanningMonthlyLimit: 500,
  activeProjectsLimit: null,
  accountantPack: true,
  reports: {
    trialBalance: true,
    generalLedger: true,
    profitLoss: true,
    balanceSheet: true
  }
};

describe.each(adapters)("%s plan entitlements", (_name, entitlements) => {
  it("defines the agreed Starter allowances exactly", () => {
    expect(entitlements.PLAN_ENTITLEMENTS.Starter).toEqual(starterEntitlements);
  });

  it("defines the agreed Pro allowances exactly", () => {
    expect(entitlements.PLAN_ENTITLEMENTS.Pro).toEqual(proEntitlements);
  });

  it("freezes plan identifiers and definitions", () => {
    expect(Object.isFrozen(entitlements.PLAN_IDS)).toBe(true);
    expect(Object.isFrozen(entitlements.FEATURE_IDS)).toBe(true);
    expect(Object.isFrozen(entitlements.REPORT_IDS)).toBe(true);
    expect(Object.isFrozen(entitlements.PLAN_ENTITLEMENTS)).toBe(true);
    expect(Object.isFrozen(entitlements.PLAN_ENTITLEMENTS.Starter)).toBe(true);
    expect(Object.isFrozen(entitlements.PLAN_ENTITLEMENTS.Pro)).toBe(true);
    expect(Object.isFrozen(entitlements.PLAN_ENTITLEMENTS.Pro.reports)).toBe(true);
  });

  it("normalises missing, unknown, and malformed plans to Starter", () => {
    for (const plan of [
      undefined,
      null,
      "",
      "Enterprise",
      {},
      [],
      1
    ]) {
      expect(entitlements.normalisePlan(plan)).toBe(entitlements.PLAN_IDS.STARTER);
      expect(entitlements.getPlanEntitlements(plan)).toEqual(starterEntitlements);
    }
  });

  it("only accepts the exact existing Pro plan identifier", () => {
    expect(entitlements.normalisePlan("Pro")).toBe(entitlements.PLAN_IDS.PRO);

    for (const plan of ["pro", "PRO", "pRo", " Pro", "Pro "]) {
      expect(entitlements.normalisePlan(plan)).toBe(entitlements.PLAN_IDS.STARTER);
      expect(entitlements.hasProAccess(plan, "active")).toBe(false);
    }
  });

  it("layers authoritative demo product access over the stored billing plan", () => {
    expect(entitlements.effectiveProductPlan("Starter", true)).toBe(entitlements.PLAN_IDS.PRO);
    expect(entitlements.effectiveProductPlan("Starter", false)).toBe(entitlements.PLAN_IDS.STARTER);
    expect(entitlements.effectiveProductPlan("Pro", false)).toBe(entitlements.PLAN_IDS.PRO);
    expect(entitlements.effectiveProductPlan("Starter", "true")).toBe(entitlements.PLAN_IDS.STARTER);
  });

  it("retrieves named monthly limits and fails closed for unknown limits", () => {
    expect(entitlements.getMonthlyLimit(
      "Starter",
      entitlements.MONTHLY_LIMIT_IDS.AI_ASSISTANT
    )).toBe(10);
    expect(entitlements.getMonthlyLimit(
      "Pro",
      entitlements.MONTHLY_LIMIT_IDS.INVOICE_SCANNING
    )).toBe(500);
    expect(entitlements.getMonthlyLimit("Pro", "unknownLimit")).toBe(0);
  });

  it("recognises only active and trialing as Pro-eligible statuses", () => {
    expect(entitlements.isProEligibleSubscriptionStatus("active")).toBe(true);
    expect(entitlements.isProEligibleSubscriptionStatus("trialing")).toBe(true);

    for (const status of [
      "past_due",
      "cancelled",
      "canceled",
      "inactive",
      "comped",
      "discounted",
      "",
      undefined,
      null,
      "ACTIVE",
      "unknown"
    ]) {
      expect(entitlements.isProEligibleSubscriptionStatus(status)).toBe(false);
      expect(entitlements.hasProAccess("Pro", status)).toBe(false);
    }
  });

  it("requires both the exact Pro plan and an eligible status", () => {
    expect(entitlements.hasProAccess("Pro", "active")).toBe(true);
    expect(entitlements.hasProAccess("Pro", "trialing")).toBe(true);
    expect(entitlements.hasProAccess("Starter", "active")).toBe(false);
    expect(entitlements.hasProAccess(undefined, "active")).toBe(false);
  });

  it("requires a fully configured Stripe link or an explicit entitlement", () => {
    expect(entitlements.effectiveBillingPlan(
      liveProProfile,
      false,
      liveBillingConfiguration
    )).toBe(entitlements.PLAN_IDS.PRO);
    expect(entitlements.effectiveBillingPlan(
      { ...liveProProfile, subscriptionStatus: "trialing", cancelAtPeriodEnd: true },
      false,
      liveBillingConfiguration
    )).toBe(entitlements.PLAN_IDS.PRO);

    for (const profile of [
      { currentPlan: "Pro", subscriptionStatus: "active" },
      { ...liveProProfile, subscriptionStatus: "past_due" },
      { ...liveProProfile, stripeMode: "test" },
      { ...liveProProfile, stripePriceId: "price_wrong" },
      { ...liveProProfile, stripeCustomerId: "" },
      { ...liveProProfile, stripeSubscriptionId: "" }
    ]) {
      expect(entitlements.effectiveBillingPlan(
        profile,
        false,
        liveBillingConfiguration
      )).toBe(entitlements.PLAN_IDS.STARTER);
    }

    expect(entitlements.effectiveBillingPlan(
      { currentPlan: "Pro", billingOverride: true },
      false,
      liveBillingConfiguration
    )).toBe(entitlements.PLAN_IDS.PRO);
    expect(entitlements.effectiveBillingPlan(
      { currentPlan: "Starter" },
      true,
      liveBillingConfiguration
    )).toBe(entitlements.PLAN_IDS.PRO);
  });

  it("represents unlimited active projects only with null", () => {
    expect(entitlements.PLAN_ENTITLEMENTS.Pro.activeProjectsLimit).toBe(null);
    expect(entitlements.isUnlimited(
      entitlements.PLAN_ENTITLEMENTS.Pro.activeProjectsLimit
    )).toBe(true);

    for (const allowance of [undefined, 0, -1, Infinity, "unlimited", false]) {
      expect(entitlements.isUnlimited(allowance)).toBe(false);
    }
  });

  it("normalises usage and calculates remaining monthly allowance", () => {
    expect(entitlements.normaliseUsageCount(4.9)).toBe(4);
    expect(entitlements.remainingMonthlyAllowance(10, 4.9)).toBe(6);
    expect(entitlements.remainingMonthlyAllowance(10, 11)).toBe(0);
    expect(entitlements.remainingMonthlyAllowance(null, 500)).toBeNull();

    for (const usage of [
      undefined,
      null,
      -1,
      Infinity,
      "4",
      {},
      []
    ]) {
      expect(entitlements.normaliseUsageCount(usage)).toBe(0);
    }
  });

  it("fails closed for unknown feature and report identifiers", () => {
    expect(entitlements.isFeatureIncluded(
      "Pro",
      entitlements.FEATURE_IDS.ACCOUNTANT_PACK
    )).toBe(true);
    expect(entitlements.isFeatureIncluded("Pro", "unknownFeature")).toBe(false);
    expect(entitlements.isFeatureIncluded("Starter", "accountantPack")).toBe(false);

    expect(entitlements.isReportIncluded(
      "Pro",
      entitlements.REPORT_IDS.TRIAL_BALANCE
    )).toBe(true);
    expect(entitlements.isReportIncluded("Pro", "unknownReport")).toBe(false);
    expect(entitlements.isReportIncluded("Starter", "trialBalance")).toBe(false);
  });

  it("creates stable UTC calendar-month keys", () => {
    expect(entitlements.calendarMonthKey(
      new Date("2026-07-01T00:00:00.000Z")
    )).toBe("2026-07");
    expect(entitlements.calendarMonthKey(
      new Date("2026-07-31T23:59:59.999Z")
    )).toBe("2026-07");
    expect(entitlements.calendarMonthKey(
      new Date("2027-01-01T00:30:00+01:00")
    )).toBe("2026-12");
  });

  it("handles the December-to-January UTC rollover", () => {
    expect(entitlements.calendarMonthKey(
      new Date("2026-12-31T23:59:59.999Z")
    )).toBe("2026-12");
    expect(entitlements.calendarMonthKey(
      new Date("2027-01-01T00:00:00.000Z")
    )).toBe("2027-01");
  });

  it("defaults to the current date only when the argument is omitted", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2028-04-15T12:00:00.000Z"));
      expect(entitlements.calendarMonthKey()).toBe("2028-04");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not substitute the current date for an invalid supplied value", () => {
    expect(() => entitlements.calendarMonthKey(new Date("invalid")))
      .toThrow(TypeError);
    expect(() => entitlements.calendarMonthKey(undefined)).toThrow(TypeError);
  });
});

describe("frontend and backend parity", () => {
  it("keeps all public constants and plan definitions identical", () => {
    for (const exportName of [
      "PLAN_IDS",
      "MONTHLY_LIMIT_IDS",
      "FEATURE_IDS",
      "REPORT_IDS",
      "PRO_ELIGIBLE_SUBSCRIPTION_STATUSES",
      "PLAN_ENTITLEMENTS"
    ]) {
      expect(frontend[exportName]).toEqual(backend[exportName]);
    }
  });

  it("keeps helper behaviour identical", () => {
    const calls = [
      ["normalisePlan", []],
      ["normalisePlan", ["Pro"]],
      ["normalisePlan", ["pro"]],
      ["effectiveProductPlan", ["Starter", true]],
      ["effectiveProductPlan", ["Starter", false]],
      ["getPlanEntitlements", ["Enterprise"]],
      ["getMonthlyLimit", ["Starter", "aiAssistantMonthlyLimit"]],
      ["getMonthlyLimit", ["Pro", "unknownLimit"]],
      ["isUnlimited", [null]],
      ["isUnlimited", [Infinity]],
      ["normaliseUsageCount", [4.9]],
      ["normaliseUsageCount", ["4"]],
      ["remainingMonthlyAllowance", [10, 4]],
      ["remainingMonthlyAllowance", [null, 500]],
      ["isFeatureIncluded", ["Pro", "accountantPack"]],
      ["isFeatureIncluded", ["Pro", "unknownFeature"]],
      ["isReportIncluded", ["Pro", "balanceSheet"]],
      ["isReportIncluded", ["Pro", "unknownReport"]],
      ["isProEligibleSubscriptionStatus", ["trialing"]],
      ["isProEligibleSubscriptionStatus", ["past_due"]],
      ["hasProAccess", ["Pro", "active"]],
      ["hasProAccess", ["Pro", "canceled"]],
      ["hasConfiguredStripeProAccess", [liveProProfile, liveBillingConfiguration]],
      ["effectiveBillingPlan", [liveProProfile, false, liveBillingConfiguration]],
      ["calendarMonthKey", [new Date("2027-01-01T00:00:00.000Z")]]
    ];

    for (const [helper, args] of calls) {
      expect(frontend[helper](...args)).toEqual(backend[helper](...args));
    }
  });
});

describe("Phase 1 integration boundary", () => {
  it("does not connect entitlements to unrelated live feature entry points", () => {
    const liveEntryPoints = [
      "../functions/index.js",
      "../account.html",
      "../dashboard.html",
      "../index.html",
      "../resources/tools/ai-assistant.html",
      "../resources/tools/bills.html",
      "../resources/tools/expenses.html"
    ];

    for (const relativePath of liveEntryPoints) {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
      expect(source).not.toContain("plan-entitlements");
    }
  });
});
