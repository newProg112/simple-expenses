import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProductAccess } from "../assets/demo-mode.js";
import { createBillingProfilePoller, createBillingPortalReturnTracker } from "../assets/account-access-state.js";
import { configuration, pageFunctions } from "./helpers/billing-lifecycle-fixture.js";

const html = readFileSync(new URL("../account.html", import.meta.url), "utf8");
function harness() {
  const nodes = new Map();
  const element = id => {
    if(!nodes.has(id)) nodes.set(id, {textContent: "", hidden: false, disabled: false,
      style: {}, classList: {toggle: vi.fn()}});
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: {getElementById: element},
    currentUser: {uid: "owner"}, accountAccessError: false,
    productAccess: null, checkoutOpening: false, billingPortalOpening: false,
    ACCOUNT_CHECKOUT_ENABLED: false, EXPECTED_STRIPE_BILLING: configuration,
    upgradePlanBtn: element("upgrade"), manageSubscriptionBtn: element("manage"),
    checkoutStatus: element("checkoutStatus")
  });
  vm.runInContext(pageFunctions(html, ["normalizeSubscriptionStatus", "hasValue", "billingDateValue", "formatBillingDate",
    "formatCardBrand", "renderSubscriptionMeta", "setText", "setCheckoutStatus", "renderSubscriptionCard"]), context);
  return {
    context,
    element,
    render: (status, overrides = {}, account = {}) => {
      const profile = {
        currentPlan: ["active", "trialing", "past_due"].includes(status) ? "Pro" : "Starter",
        subscriptionStatus: status, stripeMode: "live", stripePriceId: configuration.proPriceId,
        stripeCustomerId: "cus_owned", stripeSubscriptionId: "sub_owned",
        subscriptionCurrentPeriodEnd: "2026-10-01T00:00:00Z", ...overrides
      };
      context.productAccess = resolveProductAccess(account, profile);
      context.profile = profile;
      vm.runInContext("renderSubscriptionCard(profile)", context);
    }
  };
}

describe("executed Account subscription rendering", () => {
  it("renders failed payment with temporary Pro, actionable management and no stale renewal date", () => {
    const h = harness(); h.render("past_due");
    expect(h.element("subscriptionPlan").textContent).toBe("Pro");
    expect(h.element("subscriptionMessage").textContent).toBe("Your payment is overdue. Pro remains available for now.");
    expect(h.element("checkoutStatus").textContent).toContain("Use Manage Subscription");
    expect(h.element("checkoutStatus").textContent).toContain("a refresh may be required");
    expect(h.element("manage").hidden).toBe(false);
    expect(h.element("upgrade").hidden).toBe(true);
    expect(h.element("subscriptionRenewal").hidden).toBe(true);
  });

  it.each(["incomplete", "unpaid", "paused"])("renders %s as Starter while preserving records/exports", status => {
    const h = harness(); h.render(status);
    expect(h.element("subscriptionPlan").textContent).toBe("Starter");
    expect(h.element("checkoutStatus").textContent).toContain("Existing records and standard Excel and JSON exports remain available");
    expect(h.element("checkoutStatus").textContent).toContain("Successful recovery restores Pro");
    expect(h.element("manage").hidden).toBe(false);
    expect(h.element("subscriptionRenewal").hidden).toBe(true);
  });

  it.each(["canceled", "incomplete_expired"])("renders terminal %s accurately with checkout unavailable", status => {
    const h = harness(); h.render(status);
    expect(h.element("subscriptionKicker").textContent).toBe(status === "canceled" ? "Subscription cancelled" : "Payment setup expired");
    expect(h.element("checkoutStatus").textContent).toContain("Pro checkout is currently unavailable");
    expect(h.element("checkoutStatus").textContent).not.toMatch(/upgrade again|Manage Subscription/);
    expect(h.element("manage").hidden).toBe(true);
    expect(h.element("upgrade").hidden).toBe(true);
    expect(h.element("subscriptionRenewal").hidden).toBe(true);
  });

  it("renders recovery and scheduled cancellation without premature downgrade", () => {
    const h = harness();
    h.render("unpaid"); h.render("active");
    expect(h.element("subscriptionPlan").textContent).toBe("Pro");
    expect(h.element("subscriptionMessage").textContent).toBe("Subscription active");
    expect(h.element("subscriptionRenewal").textContent).toContain("Renews on");
    h.render("active", {cancelAtPeriodEnd: true});
    expect(h.element("subscriptionPlan").textContent).toBe("Pro");
    expect(h.element("subscriptionRenewal").textContent).toContain("Ends on");
    expect(h.element("checkoutStatus").textContent).toContain("until the end");
    h.render("canceled");
    expect(h.element("subscriptionPlan").textContent).toBe("Starter");
  });

  it("does not give portal instructions when billing linkage is unavailable", () => {
    const h = harness(); h.render("unpaid", {stripeMode: "test"});
    expect(h.element("manage").hidden).toBe(true);
    expect(h.element("checkoutStatus").textContent).not.toContain("Use Manage Subscription");
    expect(h.element("checkoutStatus").textContent).toContain("Contact adam@");
  });

  it("preserves manual and Demo access without paid recovery instructions", () => {
    const h = harness(); h.render("canceled", {currentPlan: "Pro", billingOverride: true});
    expect(h.element("subscriptionPrice").textContent).toBe("Free Pro");
    h.render("active", {currentPlan: "Pro", billingOverride: true});
    expect(h.element("subscriptionPrice").textContent).toBe("Free Pro");
    expect(h.element("manage").hidden).toBe(true);
    h.render("unpaid", {}, {demoMode: true});
    expect(h.element("subscriptionPlan").textContent).toBe("Pro Demo");
  });
});

describe("bounded billing-return profile polling", () => {
  afterEach(() => vi.useRealTimers());
  it("executes the Account refresh without overwriting unsaved business fields", async () => {
    const fields = {businessName: "Unsaved name", email: "unsaved@example.test", currentPlan: "Pro"};
    const profile = {currentPlan: "Starter", subscriptionStatus: "unpaid"};
    const renderSubscriptionCard = vi.fn();
    const context = vm.createContext({
      billingProfile: {}, productAccess: null, readBillingProfile: value => value,
      resolveProductAccess, currentAccountSnapshot: () => ({...fields}),
      accountWithBilling: account => ({...account, ...context.billingProfile}),
      setField: (key, value) => {fields[key] = value;}, setText: vi.fn(),
      renderSubscriptionCard, loadMonthlyUsageFromBackend: vi.fn(), profile
    });
    vm.runInContext(pageFunctions(html, ["applyBillingProfileRefresh"]), context);
    await vm.runInContext("applyBillingProfileRefresh(profile)", context);
    expect(fields).toEqual({businessName: "Unsaved name", email: "unsaved@example.test", currentPlan: "Starter"});
    expect(renderSubscriptionCard).toHaveBeenCalledWith(expect.objectContaining({
      businessName: "Unsaved name", subscriptionStatus: "unpaid"
    }));
    expect(context.productAccess.effectivePlan).toBe("Starter");
  });
  it("refreshes six times without overlapping/duplicate starts and stops", async () => {
    vi.useFakeTimers();
    const readProfile = vi.fn(async () => ({subscriptionStatus: "active"}));
    const applyProfile = vi.fn();
    const poller = createBillingProfilePoller({readProfile, applyProfile, isCurrent: () => true});
    poller.start("user"); poller.start("user");
    await vi.runAllTimersAsync();
    expect(readProfile).toHaveBeenCalledTimes(6);
    expect(applyProfile).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("recovers a transient failure and applies only server profiles", async () => {
    vi.useFakeTimers();
    const readProfile = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({currentPlan: "Starter", subscriptionStatus: "unpaid"});
    const applyProfile = vi.fn();
    const poller = createBillingProfilePoller({readProfile, applyProfile, isCurrent: () => true});
    poller.start("user"); await vi.runAllTimersAsync();
    expect(applyProfile).toHaveBeenCalledTimes(5);
    expect(applyProfile).toHaveBeenLastCalledWith({currentPlan: "Starter", subscriptionStatus: "unpaid"}, expect.any(Function));
  });
  it("does not overlap profile polls while the Account usage refresh is pending", async () => {
    vi.useFakeTimers(); let release;
    const readProfile = vi.fn(async () => ({}));
    const applyProfile = vi.fn(() => new Promise(resolve => {release = resolve;}));
    const poller = createBillingProfilePoller({readProfile, applyProfile, isCurrent: () => true});
    poller.start("user"); await vi.advanceTimersByTimeAsync(5000);
    expect(readProfile).toHaveBeenCalledTimes(1);
    poller.stop(); release(); await vi.runAllTimersAsync();
    expect(readProfile).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["auth-change", "stopped"])("does not apply a late monthly-usage result after %s", async reason => {
    let release, current = true;
    let ready;
    const entered = new Promise(resolve => {ready = resolve;});
    const context = vm.createContext({
      currentUser: {uid: "owner", getIdToken: async () => "fixture-token"},
      monthlyUsage: {unchanged: true}, MONTHLY_USAGE_FUNCTION_URL: "/usage",
      fetch: () => new Promise(resolve => {release = resolve; ready();}),
      renderMonthlyUsage: vi.fn(), resetMonthlyUsage: vi.fn(), console,
      isCurrent: () => current
    });
    vm.runInContext(pageFunctions(html, ["loadMonthlyUsageFromBackend"]), context);
    const pending = vm.runInContext("loadMonthlyUsageFromBackend(isCurrent)", context);
    await entered;
    if(reason === "auth-change") context.currentUser = {uid: "other"};
    else current = false;
    release({ok: true, json: async () => ({effectivePlan: "Pro"})});
    await pending;
    expect(context.monthlyUsage).toEqual({unchanged: true});
    expect(context.renderMonthlyUsage).not.toHaveBeenCalled();
  });
  it.each(["stop", "deadline", "auth"])("ignores an in-flight response after %s", async reason => {
    vi.useFakeTimers(); let release; let current = true;
    const applyProfile = vi.fn();
    const readProfile = vi.fn(() => new Promise(resolve => {release = resolve;}));
    const poller = createBillingProfilePoller({readProfile, applyProfile, isCurrent: () => current});
    poller.start("user");
    if(reason === "stop") poller.stop();
    if(reason === "deadline") await vi.advanceTimersByTimeAsync(20000);
    if(reason === "auth") current = false;
    release({currentPlan: "Pro"});
    await vi.runAllTimersAsync();
    expect(applyProfile).not.toHaveBeenCalled();
    expect(readProfile).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("portal-return provenance", () => {
  function trackerFixture(){
    const values = new Map();
    const storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
    let now = 1000000;
    return {tracker: createBillingPortalReturnTracker(storage, () => now), advance: value => {now += value;}};
  }
  it("rejects a query marker alone and consumes a matching successful-portal marker once", () => {
    const {tracker} = trackerFixture();
    expect(tracker.consume("owner", "?billing=return")).toBe(false);
    tracker.mark("owner");
    expect(tracker.consume("owner", "")).toBe(false);
    expect(tracker.consume("owner", "?billing=return")).toBe(true);
    expect(tracker.consume("owner", "?billing=return")).toBe(false);
  });
  it.each(["expired", "wrong-user", "cleared", "future"])("rejects a %s marker", reason => {
    const {tracker, advance} = trackerFixture(); tracker.mark("owner");
    if(reason === "expired") advance(900001);
    if(reason === "future") advance(-1);
    if(reason === "cleared") tracker.clear();
    expect(tracker.consume(reason === "wrong-user" ? "other" : "owner", "?billing=return")).toBe(false);
  });
  it.each(["success", "failure", "foreign-url", "auth-change"])("actual portal request handles %s before marking return", async scenario => {
    const h = harness(); h.render("unpaid");
    const {tracker} = trackerFixture();
    const location = {href: "https://simple-books.co.uk/account.html"};
    Object.assign(h.context, {
      URL, billingPortalReturn: tracker, demoSettingsLocked: () => false,
      BILLING_PORTAL_FUNCTION_URL: "/portal", window: {location}, console: {error() {}},
      currentUser: {uid: "owner", getIdToken: async () => "test-token"},
      fetch: vi.fn(async () => {
        if(scenario === "auth-change") h.context.currentUser = {uid: "other"};
        return {ok: scenario !== "failure", json: async () => ({url: scenario === "foreign-url" ? "https://other.test" : "https://billing.stripe.com/p/session"})};
      })
    });
    vm.runInContext(pageFunctions(html, ["openBillingPortal"]), h.context);
    await vm.runInContext("openBillingPortal()", h.context);
    expect(tracker.consume("owner", "?billing=return")).toBe(scenario === "success");
    expect(location.href).toBe(scenario === "success" ? "https://billing.stripe.com/p/session" : "https://simple-books.co.uk/account.html");
  });
});
