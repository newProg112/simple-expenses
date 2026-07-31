import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADMIN_UIDS,
  adminAccessDecision,
  isAdminUid,
  isConfiguredAdminUid
} from "../assets/admin-access.js";
import {
  adminMetricsErrorState,
  adminUserDetailsErrorState,
  adminUserSearchErrorState,
  buildCustomerSummary,
  filterSignupsByEmail,
  formatAdminDate,
  formatEstimatedMrr,
  formatSubscriptionStatus,
  safeMetricCount,
  supportDiagnosticMessages,
  validateAdminUserSearchQuery
} from "../assets/admin-metrics-view.js";

const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const javascript = readFileSync(new URL("../assets/admin-dashboard.js", import.meta.url), "utf8");
const shellJavascript = readFileSync(new URL("../assets/app-shell.js", import.meta.url), "utf8");
const publicHomepage = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const hostingSmokeTest = readFileSync(
  new URL("../scripts/smoke-guides-hosting.mjs", import.meta.url),
  "utf8"
);
const firebaseHosting = JSON.parse(
  readFileSync(new URL("../firebase.json", import.meta.url), "utf8")
);
const firebaseConfigSource = readFileSync(
  new URL("../firebase-config.js", import.meta.url),
  "utf8"
);

describe("Admin Dashboard Phase 1 and Phase 2A", () => {
  it("provides the admin page and exact clean hosting route", () => {
    expect(html).toContain("<title>Admin Dashboard | Simple Books</title>");
    const mainHosting = firebaseHosting.hosting.find(site => site.target === "main");
    expect(mainHosting.rewrites).toContainEqual({
      source: "/admin",
      destination: "/admin.html"
    });
    expect(hostingSmokeTest).toContain('expectPage("/admin", "<h1>Admin Dashboard</h1>")');
  });

  it("contains a configured owner UID and rejects an unrelated UID", () => {
    expect(ADMIN_UIDS.length).toBeGreaterThan(0);
    expect(isConfiguredAdminUid(ADMIN_UIDS[0])).toBe(true);
    expect(isAdminUid(ADMIN_UIDS[0])).toBe(true);
    expect(isAdminUid("random-non-admin-uid")).toBe(false);
  });

  it("distinguishes signed-out, non-admin, and admin users", () => {
    const ownerUid = "owner-firebase-uid-1234567890";
    const allowList = [ownerUid];

    expect(adminAccessDecision(null, allowList)).toBe("signed-out");
    expect(adminAccessDecision({ uid: "normal-firebase-uid-123456" }, allowList)).toBe("denied");
    expect(adminAccessDecision({ uid: ownerUid }, allowList)).toBe("allowed");
  });

  it("keeps content and navigation hidden while authentication resolves", () => {
    expect(html).toContain('id="checkingState"');
    expect(html).toContain('data-app-navigation data-auth-controlled hidden');
    expect(html).toContain('id="adminContent" hidden');
    expect(javascript).toContain('window.location.replace("/login.html")');
    expect(javascript).toContain('showState("deniedState")');
    expect(javascript).toContain('showState("errorState")');
  });

  it("only adds Admin navigation after an allow-list match", () => {
    expect(shellJavascript).toContain("shouldShowAdminNavigation(user)");
    expect(shellJavascript).toContain('section.dataset.adminNavigation = "true"');
    expect(shellJavascript).toMatch(/if\(!shouldShowAdminNavigation\(user\)\)[\s\S]*?existingSection\?\.remove\(\)/);
    expect(publicHomepage).not.toContain("data-admin-navigation");
    expect(publicHomepage).not.toContain('href="/admin"');
  });

  it("renders every requested Phase 2A metric without placeholder values", () => {
    for(const label of [
      "Total Users",
      "Starter Users",
      "Pro Users",
      "Estimated MRR",
      "Active paid subscriptions",
      "AI Assistant uses this month",
      "Invoice scans this month"
    ]){
      expect(html).toContain(label);
    }

    expect(html).not.toContain("Metrics coming in Phase 2");
    for(const heading of [
      "User",
      "Plan",
      "Joined",
      "Subscription status",
      "AI usage",
      "Scan usage"
    ]){
      expect(html).toContain(`<th>${heading}</th>`);
    }
    for(const service of ["Firebase", "Stripe", "OpenAI", "Sentry"]){
      expect(html).toContain(`<h3>${service}</h3>`);
    }
    expect(html.match(/Live health monitoring is not connected in Phase 2A/g)).toHaveLength(4);
  });

  it("makes the mobile layout collapse without horizontal overflow", () => {
    expect(html).toContain("overflow-x:hidden");
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.kpi-grid,\.status-grid\{grid-template-columns:1fr\}/);
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.signup-table[\s\S]*?display:block/);
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("calls only the protected metrics function and adds no admin actions", () => {
    expect(javascript).toContain('httpsCallable(functions, "getAdminMetrics")');
    expect(javascript).not.toMatch(/getDocs|collection\(|fetch\(/);
    expect(html).not.toMatch(/<canvas|Delete user|Manage subscription/);
    expect(javascript).not.toMatch(/stripeCustomerId|stripeSubscriptionId|billingOverrideReason/);
  });

  it("provides loading, empty, refresh, and backend error states", () => {
    for(const id of [
      "metricsLoading",
      "metricsData",
      "metricsFailure",
      "metricsFailureTitle",
      "metricsFailureMessage",
      "refreshMetricsButton",
      "recentSignupsBody"
    ]){
      expect(html).toContain(`id="${id}"`);
    }
    expect(javascript).toContain("No non-demo users are available yet.");
    expect(javascript).toContain('if(metricsRequest || !currentAdminUser)');
    expect(javascript).toContain("clearRenderedMetrics();");
    expect(javascript).toContain('state.kind === "permission-denied"');
    expect(javascript).toContain('state.kind === "unauthenticated"');
  });

  it("provides an explicit localhost-only emulator integration switch", () => {
    expect(firebaseConfigSource).toContain('window.location.hostname === "127.0.0.1"');
    expect(firebaseConfigSource).toContain('window.location.hostname === "localhost"');
    expect(firebaseConfigSource).toContain('sessionStorage.getItem("simpleBooksUseFirebaseEmulators")');
    expect(firebaseConfigSource).toContain("connectAuthEmulator(auth");
    expect(firebaseConfigSource).toContain("connectFirestoreEmulator(db");
    expect(firebaseConfigSource).toContain("connectFunctionsEmulator(functions");
  });

  it("formats safe metrics, GBP MRR, dates, and statuses", () => {
    expect(safeMetricCount(4.9)).toBe(4);
    expect(safeMetricCount(-1)).toBe(0);
    expect(formatEstimatedMrr(4500)).toBe("£45.00");
    expect(formatEstimatedMrr(-1, "USD")).toBe("£0.00");
    expect(formatAdminDate("2026-07-30T10:00:00.000Z")).toContain("30 Jul 2026");
    expect(formatAdminDate("invalid")).toBe("Not available");
    expect(formatSubscriptionStatus("past_due")).toBe("Past Due");
    expect(formatSubscriptionStatus("")).toBe("Not set");
  });

  it("maps callable failures to the intended UI states", () => {
    expect(adminMetricsErrorState({ code: "functions/unauthenticated" }))
      .toEqual({ kind: "unauthenticated" });
    expect(adminMetricsErrorState({ code: "functions/permission-denied" }))
      .toEqual({ kind: "permission-denied" });
    expect(adminMetricsErrorState({ code: "functions/failed-precondition" }).kind)
      .toBe("configuration");
    expect(adminMetricsErrorState({ code: "functions/internal" }).kind)
      .toBe("general");
  });

  it("filters recent signups locally with partial case-insensitive matches", () => {
    const signups = [
      { email: "Alice@example.test" },
      { email: "bob@example.test" }
    ];
    expect(filterSignupsByEmail(signups, "ALI")).toEqual([signups[0]]);
    expect(filterSignupsByEmail(signups, "example")).toHaveLength(2);
    expect(filterSignupsByEmail(signups, "missing")).toEqual([]);
    expect(javascript).toContain('customerSearch.addEventListener("input", handleSearchInput)');
    expect(javascript).not.toMatch(/customerSearch\.addEventListener\("input"[\s\S]*?callSearchAdminUsers/);
  });

  it("provides a read-only customer summary with loading and error states", () => {
    expect(html).toContain('placeholder="Search by email..."');
    expect(html).toContain('id="customerPanelLoading"');
    expect(html).toContain('id="customerPanelFailure"');
    expect(html).toContain('id="customerPanelData"');
    expect(html).toContain("Customer Summary");
    expect(javascript).toContain('httpsCallable(functions, "getAdminUserDetails")');
    expect(javascript).toContain('callGetAdminUserDetails({ email })');
    expect(javascript).not.toMatch(/resetPassword|impersonat|deleteUser|updatePlan/);
  });

  it("maps customer lookup errors to signed-out, denied, missing, and unavailable states", () => {
    expect(adminUserDetailsErrorState({ code: "functions/unauthenticated" }))
      .toEqual({ kind: "unauthenticated" });
    expect(adminUserDetailsErrorState({ code: "functions/permission-denied" }))
      .toEqual({ kind: "permission-denied" });
    expect(adminUserDetailsErrorState({ code: "functions/not-found" }).kind)
      .toBe("not-found");
    expect(adminUserDetailsErrorState({ code: "functions/internal" }).kind)
      .toBe("general");
  });

  it("validates full-user queries and maps structured search errors", () => {
    expect(validateAdminUserSearchQuery("x").valid).toBe(false);
    expect(validateAdminUserSearchQuery("  alice ")).toEqual({
      valid: true,
      query: "alice",
      message: ""
    });
    expect(validateAdminUserSearchQuery("x".repeat(321)).valid).toBe(false);
    expect(adminUserSearchErrorState({ code: "functions/unauthenticated" }).kind)
      .toBe("unauthenticated");
    expect(adminUserSearchErrorState({ code: "functions/permission-denied" }).kind)
      .toBe("permission-denied");
    expect(adminUserSearchErrorState({ code: "functions/failed-precondition" }).kind)
      .toBe("configuration");
    expect(adminUserSearchErrorState({ code: "functions/internal" }).kind)
      .toBe("general");
  });

  it("uses an explicit, single-request all-user search workflow", () => {
    expect(html).toContain('id="customerSearchForm"');
    expect(html).toContain('id="customerSearchButton" type="submit">Search all users');
    expect(html).toContain('id="customerSearchClear"');
    expect(javascript).toContain('httpsCallable(functions, "searchAdminUsers")');
    expect(javascript).toContain('if(searchRequest || !currentAdminUser) return searchRequest;');
    expect(javascript).toContain('callSearchAdminUsers({ query: validation.query })');
    expect(javascript).toContain('customerSearchForm.addEventListener("submit"');
    expect(javascript).toContain("No matching users found");
    expect(javascript).toContain('customerSearch.value = ""');
    expect(javascript).toContain("renderFilteredRecentSignups();");
  });

  it("renders search results through semantic customer buttons", () => {
    expect(javascript).toContain('button.className = "customer-open-button"');
    expect(javascript).toContain('button.type = "button"');
    expect(javascript).toContain("openCustomerSummary");
    expect(html).toContain("<th>Last sign in</th>");
    expect(javascript).toContain('createTableCell("Last sign in"');
  });

  it("groups the customer summary and renders only supported diagnostics", () => {
    for(const heading of ["Account", "Subscription", "Usage this month", "Support diagnostics"]){
      expect(html).toContain(`>${heading}<`);
    }
    expect(supportDiagnosticMessages([
      "plan-not-set",
      "unknown-diagnostic",
      "stripe-customer-not-linked"
    ])).toEqual([
      "No plan has been recorded for this account.",
      "A Stripe customer is not linked to this account."
    ]);
    expect(supportDiagnosticMessages(["unknown-diagnostic"])).toEqual([]);
    expect(javascript).toContain("customerDiagnosticsSection.hidden = messages.length === 0");
  });

  it("builds a clipboard summary from approved visible fields only", () => {
    const summary = buildCustomerSummary({
      email: "user@example.test",
      plan: "Starter",
      subscriptionStatus: "",
      createdDate: "2026-07-31T00:00:00.000Z",
      lastSignInTime: "2026-07-31T00:00:00.000Z",
      aiAssistantSuccessfulUses: 0,
      invoiceScanningSuccessfulUses: 0,
      stripeCustomerPresent: false,
      uid: "must-not-copy",
      stripeCustomerId: "cus_must_not_copy"
    });
    expect(summary).toContain("Simple Books customer summary");
    expect(summary).toContain("Email: user@example.test");
    expect(summary).toContain("Stripe customer linked: No");
    expect(summary).not.toMatch(/must-not-copy|cus_must_not_copy|uid/i);
  });

  it("supports copy feedback, customer refresh, Escape, and focus return", () => {
    expect(html).toContain('id="customerCopyEmail"');
    expect(html).toContain('id="customerCopySummary"');
    expect(html).toContain('id="customerRefresh"');
    expect(html).toContain('id="customerClipboardStatus" role="status"');
    expect(javascript).toContain('navigator.clipboard.writeText(text)');
    expect(javascript).toContain('customerClipboardStatus.textContent = "Copied"');
    expect(javascript).toContain("Copy failed.");
    expect(javascript).toContain('customerRefresh.addEventListener("click", () => loadCustomerDetails(currentCustomerEmail))');
    expect(javascript).toContain('event.key === "Escape"');
    expect(javascript).toContain("returnFocus?.isConnected");
    expect(javascript).toContain("returnFocus.focus()");
  });
});
