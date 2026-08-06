import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  isDemoMode,
  resolveProductAccess,
  shouldShowDemoBanner,
  watchDemoMode
} from "../assets/demo-mode.js";
import {
  getPlanEntitlements,
  hasProAccess
} from "../resources/js/plan-entitlements.js";

const user = { uid: "test-user" };

function firestoreSnapshot(accountData, exists = true){
  return {
    exists: () => exists,
    data: () => accountData
  };
}

function demoModeServices({ accountData, authenticatedUser = user, error } = {}){
  return {
    auth: {},
    db: {},
    doc: vi.fn((_db, collection, uid) => ({ collection, uid })),
    getDoc: error
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue(firestoreSnapshot(accountData)),
    onAuthStateChanged: vi.fn((_auth, onUser) => {
      onUser(authenticatedUser);
      return vi.fn();
    })
  };
}

async function flushAsyncWork(){
  await Promise.resolve();
  await Promise.resolve();
}

describe("demo-mode detection", () => {
  it("layers truthful full Pro access over the stored demo billing plan", () => {
    expect(resolveProductAccess(
      { demoMode: true },
      { currentPlan: "Starter", subscriptionStatus: "" }
    )).toEqual({
      demo: true,
      effectivePlan: "Pro",
      accessLabel: "Full Pro demo",
      planLabel: "Pro Demo",
      billingLabel: "Not billed",
      subscriptionLabel: "Demo account",
      source: "demo-entitlement",
      paidSubscription: false
    });
  });

  it("leaves normal Starter and Pro product plans unchanged", () => {
    expect(resolveProductAccess({}, { currentPlan: "Starter" }).effectivePlan)
      .toBe("Starter");
    expect(resolveProductAccess({}, { currentPlan: "Pro" }).effectivePlan)
      .toBe("Pro");
  });

  it("returns true only when demoMode is the literal boolean true", () => {
    expect(isDemoMode(user, { demoMode: true })).toBe(true);
  });

  it("returns false when demoMode is false", () => {
    expect(isDemoMode(user, { demoMode: false })).toBe(false);
  });

  it("returns false when demoMode is missing", () => {
    expect(isDemoMode(user, {})).toBe(false);
  });

  it("returns false when there is no authenticated user", () => {
    expect(isDemoMode(null, { demoMode: true })).toBe(false);
  });

  it("fails closed while account data is unavailable", () => {
    expect(isDemoMode(user, null)).toBe(false);
  });

  it("fails closed when account loading throws", async () => {
    const values = [];
    await watchDemoMode(
      value => values.push(value),
      demoModeServices({ error: new Error("Firestore unavailable") })
    );
    await flushAsyncWork();

    expect(values.at(-1)).toBe(false);
  });
});

describe("demo banner", () => {
  it.each([
    ["Starter", { currentPlan: "Starter", demoMode: false }],
    ["Pro", { currentPlan: "Pro", demoMode: false }],
    ["an older account", { businessName: "Established Books" }]
  ])("does not display for normal %s accounts", (_label, accountData) => {
    expect(shouldShowDemoBanner(user, accountData)).toBe(false);
  });

  it("displays for demo accounts independently of their plan", () => {
    expect(shouldShowDemoBanner(user, {
      currentPlan: "Starter",
      demoMode: true
    })).toBe(true);
  });

  it("loads the flag from the signed-in user's business document", async () => {
    const services = demoModeServices({ accountData: { demoMode: true } });
    const values = [];
    await watchDemoMode(value => values.push(value), services);
    await flushAsyncWork();

    expect(services.doc).toHaveBeenCalledWith(services.db, "users", user.uid);
    expect(values.at(-1)).toBe(true);
  });

  it("keeps the public landing page outside the authenticated shell", () => {
    const landingPage = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(landingPage).not.toContain("data-app-navigation");
    expect(landingPage).not.toContain("/assets/app-shell.js");
  });

  it("renders the shared banner contract in the authenticated shell", () => {
    const shell = readFileSync(new URL("../assets/app-shell.js", import.meta.url), "utf8");

    expect(shell).toContain('label.textContent = "Demo Account"');
    expect(shell).toContain('resetButton.textContent = "Reset Demo"');
    expect(shell).toContain("You are exploring the full Pro version of Simple Books.");
    expect(shell).toContain("Business and subscription settings are locked");
    expect(shell).not.toContain("restrictions will be introduced in later phases");
    expect(shell).toContain("watchDemoMode");
  });
});

describe("existing plan behaviour", () => {
  it("leaves Starter and Pro feature gating unchanged", () => {
    expect(getPlanEntitlements("Starter").accountantPack).toBe(false);
    expect(getPlanEntitlements("Pro").accountantPack).toBe(true);
    expect(hasProAccess("Starter", "active")).toBe(false);
    expect(hasProAccess("Pro", "active")).toBe(true);
    expect(hasProAccess("Pro", "past_due")).toBe(false);
  });
});
