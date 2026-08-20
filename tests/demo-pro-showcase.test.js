import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_SEED } from "../assets/demo-seed.js";
import { effectiveProductPlan } from "../resources/js/plan-entitlements.js";

const read = relativePath => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  "utf8"
);

describe("demo Pro showcase integration contracts", () => {
  it.each([
    ["Trial Balance", "resources/tools/trial-balance.html", "TRIAL_BALANCE"],
    ["General Ledger", "resources/tools/general-ledger.html", "GENERAL_LEDGER"],
    ["Profit & Loss", "resources/tools/profit-loss.html", "PROFIT_LOSS"],
    ["Balance Sheet", "resources/tools/balance-sheet.html", "BALANCE_SHEET"]
  ])("authorises demo mode through the shared %s report gate", (_name, file, reportId) => {
    const page = read(file);
    expect(page).toContain('getDoc(doc(db, "users", user.uid))');
    expect(page).toContain("account.exists() && account.data().demoMode === true");
    expect(page).toMatch(new RegExp(
      `getFinancialReportAccess\\(\\s*profilePlan,\\s*REPORT_IDS\\.${reportId},\\s*` +
      "account\\.exists\\(\\) && account\\.data\\(\\)\\.demoMode === true"
    ));
  });

  it("authorises the Accountant Pack through the shared demo entitlement", () => {
    const page = read("exports.html");
    expect(page).toContain('getDoc(doc(db, "users", user.uid))');
    expect(page).toContain("getAccountantPackAccess(profilePlan, demoMode)");
  });

  it("keeps normal plan gates intact while demo mode resolves to Pro", () => {
    expect(effectiveProductPlan("Starter", false)).toBe("Starter");
    expect(effectiveProductPlan("Pro", false)).toBe("Pro");
    expect(effectiveProductPlan("Starter", true)).toBe("Pro");
  });

  it("keeps project actions neutral until authoritative access is loaded", () => {
    const page = read("resources/tools/projects.html");
    expect(page).toContain("let productAccessLoaded = false;");
    expect(page).toContain("productAccessLoaded = true;");
    expect(page).toContain("Checking project access…");
    expect(page).toContain("canUseAnotherActiveProject(currentPlan, projects, currentDemoMode)");
  });

  it("starts subscription controls hidden and blocks demo calls before fetch", () => {
    const page = read("account.html");
    expect(page).toMatch(/id="upgradePlanBtn"[^>]*hidden[^>]*display:none/);
    expect(page).toMatch(/id="manageSubscriptionBtn"[^>]*hidden[^>]*display:none/);
    expect(page.indexOf("if(demoSettingsLocked())"))
      .toBeLessThan(page.indexOf("fetch(CHECKOUT_FUNCTION_URL"));
    expect(page.indexOf("if(demoSettingsLocked())", page.indexOf("async function openBillingPortal")))
      .toBeLessThan(page.indexOf("fetch(BILLING_PORTAL_FUNCTION_URL"));
  });

  it("locks protected profile and logo writes without locking nested transactions", () => {
    const account = read("account.html");
    const rules = read("firestore.rules");
    expect(account).toContain("const protectedDemoFieldIds = [");
    for (const field of [
      "email", "businessName", "addressLine1", "vatNumber", "companyNumber",
      "paymentTermsDefault", "businessWebsite", "phoneNumber", "sortCode",
      "accountNumber"
    ]) expect(account).toContain(`"${field}"`);
    expect(account).toContain("Shared demo account settings are locked and were not changed.");
    expect(account).toContain("Shared demo logo settings are locked.");
    expect(rules).toContain("allow update, delete: if isOwner(uid) && resource.data.demoMode != true;");
    expect(rules).toContain("match /users/{uid}/{collectionName}/{document=**}");
    expect(rules).toContain("collectionName != 'referenceKeys'");
  });

  it("rejects authoritative demo checkout, portal, and webhook billing updates", () => {
    const functions = read("functions/index.js");
    expect(functions).toContain("const accountSnapshot = await users.doc(decodedToken.uid).get();");
    expect(functions).toContain('error: "Subscription changes are unavailable in the shared " +');
    expect(functions).toContain('error: "Subscription management is unavailable in the shared " +');
    expect(functions).toContain("Ignoring subscription update for demo account");
    expect(functions.indexOf("accountSnapshot.data().demoMode === true"))
      .toBeLessThan(functions.indexOf("stripe.checkout.sessions.create"));
    expect(functions.indexOf("accountSnap.data().demoMode === true"))
      .toBeLessThan(functions.indexOf("stripe.billingPortal.sessions.create"));
  });

  it("keeps the canonical seed billing-neutral and independently demo-entitled", () => {
    expect(DEMO_SEED.businessProfile.demoMode).toBe(true);
    expect(DEMO_SEED.businessProfile).not.toHaveProperty("currentPlan");
    expect(JSON.stringify(DEMO_SEED.businessProfile)).not.toMatch(/stripe|subscription/i);
    expect(effectiveProductPlan(undefined, DEMO_SEED.businessProfile.demoMode)).toBe("Pro");
  });

  it("keeps Reset Demo available and refreshes shell assets everywhere", () => {
    expect(read("assets/app-shell.js")).toContain('resetButton.textContent = "Reset Demo"');
    const authenticatedPages = [
      "account.html", "admin.html", "dashboard.html", "exports.html",
      "resources/tools/ai-assistant.html", "resources/tools/balance-sheet.html",
      "resources/tools/bills.html", "resources/tools/budgets.html",
      "resources/tools/cashflow.html", "resources/tools/client-tracker.html",
      "resources/tools/expenses.html", "resources/tools/general-ledger.html",
      "resources/tools/invoice-generator.html", "resources/tools/profit-loss.html",
      "resources/tools/project-details.html", "resources/tools/projects.html",
      "resources/tools/trial-balance.html"
    ];
    for (const file of authenticatedPages) {
      expect(read(file), file).toContain("app-shell.js?v=20260806-demo-pro2");
      expect(read(file), file).toContain("app-shell.css?v=20260806-demo-pro2");
    }
  });
});
