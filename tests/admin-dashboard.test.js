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
  adminUserActionErrorState,
  adminUserDetailsErrorState,
  adminUserSearchErrorState,
  buildAdminChartModel,
  buildCustomerSummary,
  chartSummaryItems,
  filterSignupsByEmail,
  formatAdminDate,
  formatEstimatedMrr,
  formatSubscriptionStatus,
  normalizeAdminNotesSavePayload,
  normalizeAdminUserDetailsPayload,
  safeMetricCount,
  supportDiagnosticMessages,
  validateAdminUserSearchQuery
} from "../assets/admin-metrics-view.js";

const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const javascript = readFileSync(new URL("../assets/admin-dashboard.js", import.meta.url), "utf8");
const metricsViewJavascript = readFileSync(
  new URL("../assets/admin-metrics-view.js", import.meta.url),
  "utf8"
);
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
  it("exports every admin metrics view helper named by the dashboard import", () => {
    const viewImport = javascript.match(
      /import\s*\{([^{}]*)\}\s*from\s*["']\.\/admin-metrics-view\.js(?:\?[^"']+)?["']/
    );
    expect(viewImport).not.toBeNull();
    const importedNames = viewImport[1]
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);
    const exportedNames = new Set(
      [...metricsViewJavascript.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)]
        .map(match => match[1])
    );
    expect(importedNames).toContain("buildAdminChartModel");
    expect(importedNames).toContain("chartSummaryItems");
    expect(importedNames.filter(name => !exportedNames.has(name))).toEqual([]);
    expect(javascript).toContain('from "./admin-metrics-view.js?v=20260805-admin-users-phase2-fix1"');
    expect(html).toContain('/assets/admin-dashboard.js?v=20260805-admin-polish1');
  });

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
      "Customer", "Business", "Email", "Plan", "Status", "Signed up", "Last activity", "Details"
    ]){
      expect(html).toContain(`<th scope="col">${heading}</th>`);
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

  it("standardizes dense admin cards, tables, and narrow-screen drawer controls", () => {
    expect(html).toMatch(/\.kpi-card\{display:flex;min-height:146px;flex-direction:column\}/);
    expect(html).toContain("font-variant-numeric:tabular-nums");
    expect(html).toContain("table-empty-row");
    expect(html).toContain("customer-usage-control");
    expect(html).toMatch(/\.customer-panel-header\{position:sticky/);
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.admin-confirm-actions\{flex-direction:column-reverse\}/);
  });

  it("provides truthful empty states and isolated retry actions", () => {
    expect(html).toContain("Choose another event type or refresh to check for newer safe activity.");
    expect(html).toContain("Choose a longer time range to check earlier safe activity.");
    expect(html).toContain("Current plan, retention and cohort snapshots remain visible below.");
    expect(javascript).toContain("No reliably tracked product actions are available in this time range.");
    expect(javascript).toContain("No non-demo customer sign-ups are available for the last 12 months.");
    for(const id of [
      "retryActivityButton", "retryFeatureUsageButton", "retryDemoAnalyticsButton",
      "retryCustomerAnalyticsButton"
    ]) expect(html).toContain(`id="${id}"`);
  });

  it("announces busy states and exposes chart data without relying on colour", () => {
    expect(javascript).toContain('customerSearchForm.setAttribute("aria-busy", "true")');
    expect(javascript).toContain('customerSearchButton.textContent = "Searching…"');
    expect(javascript).toContain('customerAdminNotesSave.textContent = "Saving…"');
    expect(javascript).toContain('customerUsageConfirmSubmit.textContent = "Resetting…"');
    expect(html).toContain('id="demoActivitySummary" aria-label="Demo activity over time data"');
    expect(html).toContain('id="customerActivitySummary" aria-label="Customer activity over time data"');
    expect(html).toMatch(/select:focus-visible,textarea:focus-visible,summary:focus-visible/);
  });

  it("keeps existing admin features and routes privileged actions through callables", () => {
    expect(javascript).toContain('httpsCallable(functions, "getAdminMetrics")');
    expect(javascript).toContain('httpsCallable(functions, "seedAdminDemoEnvironment")');
    expect(javascript).not.toMatch(/getDocs|collection\(|fetch\(/);
    expect(html).not.toMatch(/Delete user|Manage subscription/);
    expect(javascript).not.toMatch(/stripeCustomerId|stripeSubscriptionId|billingOverrideReason/);
  });

  it("keeps the three existing Chart.js growth charts", () => {
    const growthPosition = html.indexOf('id="growthOverview"');
    expect(growthPosition).toBeGreaterThan(html.indexOf('class="kpi-grid"'));
    expect(html).toContain("https://cdn.jsdelivr.net/npm/chart.js");
    for(const id of ["monthlySignupsChart", "cumulativeUsersChart", "planDistributionChart"]){
      expect(html).toContain(`id="${id}"`);
    }
    expect(javascript).toContain('type: "bar"');
    expect(javascript).toContain('type: "line"');
    expect(javascript).toContain('type: "doughnut"');
    expect(javascript).toContain("tension: 0");
  });

  it("directly tests buildAdminChartModel against KPI totals and builds accessible summaries", () => {
    const monthlySignups = Array.from({ length: 12 }, (_, index) => ({
      monthKey: `2025-${String(index + 1).padStart(2, "0")}`,
      label: `Month ${index + 1}`,
      count: index === 11 ? 2 : 0
    }));
    const cumulativeUsers = monthlySignups.map((point, index) => ({
      ...point,
      count: index === 11 ? 2 : 0
    }));
    const metrics = { totalUsers: 2, starterUsers: 1, proUsers: 1 };
    const model = buildAdminChartModel({
      rangeMonths: 12,
      monthlySignups,
      cumulativeUsers,
      planDistribution: { starter: 1, pro: 1 }
    }, metrics);
    expect(model.labels).toHaveLength(12);
    expect(model.monthlyValues.at(-1)).toBe(2);
    expect(model.planValues).toEqual([1, 1]);
    expect(chartSummaryItems(["Jan 2026"], [3], "new accounts"))
      .toEqual(["Jan 2026: 3 new accounts"]);
    expect(buildAdminChartModel({ rangeMonths: 12 }, metrics)).toBeNull();
    expect(buildAdminChartModel({
      rangeMonths: 12,
      monthlySignups,
      cumulativeUsers,
      planDistribution: { starter: 2, pro: 1 }
    }, metrics)).toBeNull();
  });

  it("clears stale charts, prevents duplicate refreshes, and handles empty or malformed data", () => {
    expect(javascript).toContain("destroyAdminCharts();");
    expect(javascript).toContain("clearGrowthChartContent();");
    expect(javascript).toContain("adminCharts.get(canvasId)?.destroy()");
    expect(javascript).toContain('if(metricsRequest || !currentAdminUser) return metricsRequest;');
    expect(javascript).toContain("Growth data is unavailable for this snapshot.");
    expect(javascript).toContain("No new sign-ups in the displayed months.");
    expect(javascript).toContain("No current plan data yet.");
    expect(javascript.indexOf("if(model.totalUsers === 0)")).toBeLessThan(
      javascript.indexOf("model.planValues[0] / model.totalUsers")
    );
  });

  it("provides non-colour text equivalents and responsive chart resizing", () => {
    expect(html).toContain('id="monthlySignupsSummary" aria-label="New sign-ups data"');
    expect(html).toContain('id="cumulativeUsersSummary" aria-label="Cumulative user growth data"');
    expect(html).toContain('id="planDistributionSummary" aria-label="Current plan distribution data"');
    expect(html).toContain("Current plan status, not subscription-payment status");
    expect(html).toMatch(/\.chart-shell\{[^}]*overflow:hidden/);
    expect(html).toMatch(/@media\(max-width:1000px\)[\s\S]*?\.growth-grid\{grid-template-columns:1fr\}/);
    expect(javascript).toContain('new ResizeObserver(() =>');
    expect(javascript).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(javascript).toContain("Starter ${model.planValues[0]}");
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

  it("does not issue user-management searches on every keystroke", () => {
    const signups = [
      { email: "Alice@example.test" },
      { email: "bob@example.test" }
    ];
    expect(filterSignupsByEmail(signups, "ALI")).toEqual([signups[0]]);
    expect(filterSignupsByEmail(signups, "example")).toHaveLength(2);
    expect(filterSignupsByEmail(signups, "missing")).toEqual([]);
    expect(javascript).not.toContain('customerSearch.addEventListener("input"');
    expect(javascript).toContain('customerSearchForm.addEventListener("submit"');
  });

  it("provides a read-only customer summary with loading and error states", () => {
    expect(html).toContain('placeholder="Email, full name or exact UID"');
    expect(html).toContain('id="customerPanelLoading"');
    expect(html).toContain('id="customerPanelFailure"');
    expect(html).toContain('id="customerPanelData"');
    expect(html).toContain("User details");
    expect(javascript).toContain('httpsCallable(functions, "getAdminUserDetails")');
    expect(javascript).toContain('callGetAdminUserDetails(selector)');
    expect(javascript).not.toMatch(/resetPassword|impersonat|deleteUser|updatePlan/);
  });

  it("normalizes the callable detail payload before rendering and tolerates optional fields", () => {
    const current = normalizeAdminUserDetailsPayload({
      account: {
        uid: "customer-uid", email: "user@example.test", fullName: "Ada Customer",
        businessName: "Ada Books", signupDate: "2026-01-02T10:00:00.000Z",
        lastSignInDate: "2026-07-30T14:15:00.000Z", emailVerified: true,
        badges: ["Active"]
      },
      plan: { currentPlan: "Pro", subscriptionStatus: "active", activePaidSubscription: true },
      usage: { aiAssistantSuccessfulUses: 7, aiAssistantAllowance: 500 },
      recentActivity: [{ summary: "Invoice created", timestamp: "2026-07-30T12:00:00.000Z" }]
    });
    expect(current.account.email).toBe("user@example.test");
    expect(current.plan.currentPlan).toBe("Pro");
    expect(current.usage.aiAssistantAllowance).toBe(500);
    expect(current.recentActivity).toHaveLength(1);

    const legacy = normalizeAdminUserDetailsPayload({
      uid: "legacy-uid", email: "legacy@example.test", plan: "Starter",
      createdDate: "2026-01-01T00:00:00.000Z", lastSignInTime: null,
      aiAssistantSuccessfulUses: 2
    });
    expect(legacy.account).toMatchObject({ uid: "legacy-uid", email: "legacy@example.test" });
    expect(legacy.plan.currentPlan).toBe("Starter");
    expect(legacy.usage.aiAssistantSuccessfulUses).toBe(2);
    expect(legacy.account.lastSignInDate).toBeNull();
    expect(javascript).toContain("normalizeAdminUserDetailsPayload(details)");
    expect(javascript).toContain('setCustomerPanelState("data")');
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
    expect(validateAdminUserSearchQuery("x").valid).toBe(true);
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
    expect(html).toContain('id="customerSearchButton" type="submit">Search');
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
    expect(html).toContain('<th scope="col">Last activity</th>');
    expect(javascript).toContain('createTableCell("Last activity"');
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
      account: {
        uid: "user-uid", email: "user@example.test", fullName: "User Name",
        businessName: "User Books", badges: ["Active"],
        signupDate: "2026-07-31T00:00:00.000Z",
        lastSignInDate: "2026-07-31T00:00:00.000Z"
      },
      plan: { currentPlan: "Starter", subscriptionStatus: "" },
      usage: { aiAssistantSuccessfulUses: 0, aiAssistantAllowance: 10,
        invoiceScanningSuccessfulUses: 0, invoiceScanningAllowance: 10, activeProjects: 0 },
      recentActivity: [{summary: "An invoice was created.", timestamp: "2026-07-31T10:00:00.000Z"}],
      adminNotes: {text: "Follow up on Friday."},
      stripeCustomerId: "cus_must_not_copy"
    });
    expect(summary).toContain("Simple Books customer summary");
    expect(summary).toContain("Email: user@example.test");
    expect(summary).toContain("Firebase UID: user-uid");
    expect(summary).toContain("AI Assistant usage this month: 0 of 10");
    expect(summary).toContain("Recent activity:");
    expect(summary).toContain("An invoice was created.");
    expect(summary).toContain("Admin notes:\nFollow up on Friday.");
    expect(summary).not.toMatch(/cus_must_not_copy|stripe/i);
  });

  it("provides Phase 2 notes, confirmed usage resets, and a paginated timeline", () => {
    for(const id of [
      "customerAdminNotes", "customerAdminNotesSave", "customerAdminNotesFeedback",
      "customerResetAiUsage", "customerResetScanUsage", "customerUsageConfirmDialog",
      "customerTimelineDetails", "customerTimelineList", "customerTimelineMore"
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Copy Support Summary");
    expect(html).toContain("Full Activity Timeline");
    expect(javascript).toContain('httpsCallable(functions, "updateAdminUserNotes")');
    expect(javascript).toContain('httpsCallable(functions, "resetAdminUserUsage")');
    expect(javascript).toContain('httpsCallable(functions, "getAdminUserTimeline")');
    expect(javascript).toContain("customerUsageConfirmDialog.showModal()");
    expect(javascript).toContain("await loadCustomerDetails(currentCustomerSelector)");
    expect(javascript).toContain("customerTimelineRecords.length >= 100");
    expect(javascript).toContain("setCustomerActionsRunning(true)");
  });

  it("updates saved notes immediately only from a complete persisted callable response", () => {
    expect(normalizeAdminNotesSavePayload({
      saved: true,
      notes: "Persisted support note",
      updatedAt: "2026-08-05T12:00:00.000Z",
      updatedByAdminUid: "owner-uid"
    })).toEqual({
      text: "Persisted support note",
      updatedAt: "2026-08-05T12:00:00.000Z",
      updatedByAdminUid: "owner-uid"
    });
    expect(normalizeAdminNotesSavePayload({saved: true, notes: "Not verified"})).toBeNull();
    expect(javascript.indexOf("if(!savedNotes) throw")).toBeLessThan(
      javascript.indexOf('customerAdminNotesFeedback.textContent = "Admin notes saved."')
    );
    expect(javascript).toContain("customerAdminNotes.value = savedNotes.text");
    expect(javascript).toContain("adminNotes: savedNotes");
  });

  it("maps Phase 2 callable failures without exposing backend details", () => {
    expect(adminUserActionErrorState({code: "functions/unauthenticated"}, "save")).toEqual({kind: "unauthenticated"});
    expect(adminUserActionErrorState({code: "functions/permission-denied"}, "save")).toEqual({kind: "permission-denied"});
    expect(adminUserActionErrorState({code: "functions/internal", message: "private/path"}, "save admin notes"))
      .toEqual({kind: "general", message: "Could not save admin notes. Try again in a moment."});
  });

  it("supports copy feedback, customer refresh, Escape, and focus return", () => {
    expect(html).toContain('id="customerCopyEmail"');
    expect(html).toContain('id="customerCopySummary"');
    expect(html).toContain('id="customerRefresh"');
    expect(html).toContain('id="customerClipboardStatus" role="status"');
    expect(javascript).toContain('navigator.clipboard.writeText(text)');
    expect(javascript).toContain('customerClipboardStatus.textContent = "Copied"');
    expect(javascript).toContain("Copy failed.");
    expect(javascript).toContain('customerRefresh.addEventListener("click", () => loadCustomerDetails(currentCustomerSelector))');
    expect(javascript).toContain('event.key === "Escape"');
    expect(javascript).toContain("returnFocus?.isConnected");
    expect(javascript).toContain("returnFocus.focus()");
  });
});
