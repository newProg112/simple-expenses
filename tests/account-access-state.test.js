import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createAccountAccessRequestTracker,
  resolveAccountAccessSnapshot
} from "../assets/account-access-state.js";

const snapshot = (data, exists = true) => ({
  exists: () => exists,
  data: () => data
});
const accountHtml = readFileSync(new URL("../account.html", import.meta.url), "utf8");
const functionsIndex = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

describe("Account access resolution", () => {
  it("settles an ordinary Starter account even when users/{uid} is missing", () => {
    const result = resolveAccountAccessSnapshot(
      snapshot(undefined, false),
      { currentPlan: "Starter", subscriptionStatus: "" }
    );
    expect(result.accountData).toEqual({});
    expect(result.productAccess).toMatchObject({
      demo: false,
      effectivePlan: "Starter",
      planLabel: "Starter",
      accessLabel: "Starter",
      source: "billing-profile"
    });
  });

  it("settles a Starter account when the optional profile document is missing", () => {
    expect(resolveAccountAccessSnapshot(snapshot({ businessName: "Test Books" }), {}))
      .toMatchObject({
        productAccess: {
          demo: false,
          effectivePlan: "Starter",
          paidSubscription: null
        }
      });
  });

  it("resolves an ordinary Pro plan without claiming a paid subscription", () => {
    expect(resolveAccountAccessSnapshot(
      snapshot({ businessName: "Pro Books" }),
      { currentPlan: "Pro", billingOverride: true }
    ).productAccess).toMatchObject({
      demo: false,
      effectivePlan: "Pro",
      planLabel: "Pro",
      paidSubscription: null
    });
  });

  it("preserves truthful Demo Pro access independently of stored Starter", () => {
    expect(resolveAccountAccessSnapshot(
      snapshot({ demoMode: true }),
      { currentPlan: "Starter", subscriptionStatus: "active" }
    ).productAccess).toMatchObject({
      demo: true,
      effectivePlan: "Pro",
      planLabel: "Pro Demo",
      accessLabel: "Full Pro demo",
      billingLabel: "Not billed",
      paidSubscription: false
    });
  });
});

describe("Account access request ordering", () => {
  it("rejects an older response after a newer auth request begins", () => {
    const tracker = createAccountAccessRequestTracker();
    const first = tracker.begin("first-user");
    const second = tracker.begin("second-user");
    expect(tracker.isCurrent(first, "first-user")).toBe(false);
    expect(tracker.isCurrent(first, "second-user")).toBe(false);
    expect(tracker.isCurrent(second, "second-user")).toBe(true);
  });
});

describe("Account page access lifecycle integration", () => {
  it("does not block Firestore billing reads on optional profile creation", () => {
    expect(accountHtml).toContain("void ensureUserProfile(user);");
    expect(accountHtml).not.toContain("await ensureUserProfile();");
    expect(accountHtml).toContain("resolveAccountAccessSnapshot(");
    expect(accountHtml).not.toMatch(/productAccess\s*=\s*snap\.exists\(\)[\s\S]{0,120}:\s*null/);
    const profileEndpoint = functionsIndex.slice(
      functionsIndex.indexOf("exports.ensureUserProfile = onRequest("),
      functionsIndex.indexOf("exports.createCheckoutSession = onRequest(")
    );
    expect(profileEndpoint).toContain('"https://simple-books-office.web.app"');
    expect(profileEndpoint).toContain('"http://localhost:8000"');
  });

  it("settles genuine lookup failures into a recoverable error state", () => {
    expect(accountHtml).toContain("accountAccessError = true;");
    expect(accountHtml).toContain("Plan and billing details could not be loaded. Refresh to try again.");
    expect(accountHtml).toContain('accountAccessError ? "Unavailable" : "Checking access"');
  });

  it("starts neutral and keeps monthly usage independent of billing access", () => {
    expect(accountHtml).toContain('id="summaryPlan">Checking access</strong>');
    expect(accountHtml).toContain('id="planStatus">Checking access</strong>');
    expect(accountHtml).toContain('id="subscriptionPlan">Checking access</span>');
    expect(accountHtml).toContain('id="subscriptionPrice">Loading</div>');
    expect(accountHtml).toContain("loadMonthlyUsageFromBackend()");
    expect(accountHtml).not.toMatch(/monthlyUsage[\s\S]{0,80}productAccess\s*=/);
  });

  it("labels a scheduled cancellation as ending without revoking active Pro", () => {
    expect(accountHtml).toContain("subscriptionCancelAt: profile.subscriptionCancelAt || null");
    expect(accountHtml).toContain("account.subscriptionCancelAt || account.subscriptionCurrentPeriodEnd");
    expect(accountHtml).toContain('${cancellationScheduled ? "Ends" : "Renews"} on ${renewalDate}');
    expect(accountHtml).toContain('const isActive = isPro && ["active", "trialing"].includes(subscriptionStatus)');
    expect(accountHtml).toContain("statusMessage = cancellationScheduled");
  });
});
