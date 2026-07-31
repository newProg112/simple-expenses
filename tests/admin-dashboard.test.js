import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADMIN_UIDS,
  adminAccessDecision,
  isAdminUid,
  isConfiguredAdminUid
} from "../assets/admin-access.js";

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

describe("Admin Dashboard Phase 1", () => {
  it("provides the admin page and exact clean hosting route", () => {
    expect(html).toContain("<title>Admin Dashboard | Simple Books</title>");
    const mainHosting = firebaseHosting.hosting.find(site => site.target === "main");
    expect(mainHosting.rewrites).toContainEqual({
      source: "/admin",
      destination: "/admin.html"
    });
    expect(hostingSmokeTest).toContain('expectPage("/admin", "<h1>Admin Dashboard</h1>")');
  });

  it("fails closed until the owner UID is configured", () => {
    expect(ADMIN_UIDS).toEqual(["REPLACE_WITH_OWNER_FIREBASE_UID"]);
    expect(isConfiguredAdminUid(ADMIN_UIDS[0])).toBe(false);
    expect(isAdminUid("REPLACE_WITH_OWNER_FIREBASE_UID")).toBe(false);
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

  it("renders every requested Phase 1 placeholder without fake metrics", () => {
    for(const label of ["Total Users", "Starter Users", "Pro Users", "Estimated MRR"]){
      expect(html).toContain(label);
    }

    expect(html.match(/Metrics coming in Phase 2/g)).toHaveLength(4);
    expect(html).toContain("Recent sign-up data will appear here after the admin metrics service is connected.");
    for(const heading of ["User", "Plan", "Joined", "AI Usage", "Scan Usage"]){
      expect(html).toContain(`<th>${heading}</th>`);
    }
    for(const service of ["Firebase", "Stripe", "OpenAI", "Sentry"]){
      expect(html).toContain(`<h3>${service}</h3>`);
    }
    expect(html.match(/Not connected in Phase 1/g)).toHaveLength(4);
  });

  it("makes the mobile layout collapse without horizontal overflow", () => {
    expect(html).toContain("overflow-x:hidden");
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.kpi-grid,\.status-grid\{grid-template-columns:1fr\}/);
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.signup-table[\s\S]*?display:block/);
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("does not add metrics APIs, cross-user reads, or admin actions", () => {
    expect(javascript).not.toMatch(/getDocs|collection|httpsCallable|fetch\(/);
    expect(html).not.toMatch(/<canvas|Delete user|Manage subscription/);
    expect(javascript).toContain("must also be authorised server-side");
  });
});
