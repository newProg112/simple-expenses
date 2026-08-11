import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "../resources/js/plan-entitlements.js";
import { businessInsightsVisibility } from "../assets/business-insights-access.js";

const html = readFileSync(new URL("../pricing.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/pricing.css", import.meta.url), "utf8");
const accountHtml = readFileSync(new URL("../account.html", import.meta.url), "utf8");
const functionsSource = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const adminMetricsSource = readFileSync(new URL("../functions/lib/admin-metrics.js", import.meta.url), "utf8");
const aiAssistantSource = readFileSync(new URL("../functions/ai-assistant.js", import.meta.url), "utf8");
const documentScanSource = readFileSync(new URL("../functions/business-document-scan.js", import.meta.url), "utf8");
const firebase = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function section(id) {
  return html.match(new RegExp(`<section[^>]+aria-labelledby="${id}"[\\s\\S]*?<\\/section>`))?.[0] || "";
}

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, "→")
    .replace(/\s+/g, " ")
    .trim();
}

describe("public pricing page", () => {
  it("has unique metadata, one H1 and the clean /pricing route", () => {
    expect(html).toContain("<title>Pricing | Simple Books small business software</title>");
    expect(html).toContain('<meta name="description" content="Compare Simple Books Starter and Pro pricing');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>Start simple. Upgrade when you need more.</h1>");
    expect(firebase.hosting[0].rewrites).toContainEqual({
      source: "/pricing",
      destination: "/pricing.html"
    });
  });

  it("uses consistent public navigation and working product CTAs", () => {
    const desktopNavigation = html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || "";
    const mobileNavigation = html.match(/<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/)?.[1] || "";

    expect(textContent(desktopNavigation)).toBe("Features Pricing About Guides Contact");
    expect(textContent(mobileNavigation)).toBe("Features Pricing About Guides Contact Login Sign Up");
    expect(html).toContain('href="/pricing" aria-current="page">Pricing</a>');
    expect(html).toContain('href="/features">See everything Simple Books can do');
    expect(html).toContain('href="/signup.html">Start with Starter</a>');
    expect(html).toContain('href="/login.html?demo=1">Explore the demo</a>');
    expect(html).toContain('id="menu-button" type="button" aria-expanded="false"');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.site-actions \.menu-button\s*{[\s\S]*?display: inline-flex/);
  });

  it("shows prices supported by the active billing implementation", () => {
    expect(html).toContain('<div class="plan-price"><strong>&pound;0</strong><span>/ month</span></div>');
    expect(html).toContain('<div class="plan-price"><strong>&pound;15</strong><span>/ month</span></div>');
    expect(functionsSource).toContain('currentPlan: "Starter"');
    expect(functionsSource).toContain('mode: "subscription"');
    expect(accountHtml).toContain('price = "£15/month"');
    expect(adminMetricsSource).toContain("const PRO_MONTHLY_PRICE_PENCE = 1500;");
  });

  it("matches the configured Starter and Pro allowances and feature gates", () => {
    expect(PLAN_ENTITLEMENTS.Starter).toMatchObject({
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
    });
    expect(PLAN_ENTITLEMENTS.Pro).toMatchObject({
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
    });

    const comparison = section("comparison-title");
    expect(comparison).toContain("10 questions / month");
    expect(comparison).toContain("500 questions / month");
    expect(comparison).toContain("10 scans / month");
    expect(comparison).toContain("500 scans / month");
    expect(comparison).toContain("Up to 5");
    expect(comparison).toContain("Unlimited");
    expect(comparison).toContain("Trial Balance, General Ledger, Profit &amp; Loss and Balance Sheet");
    expect(html).toContain(
      "10 AI Assistant questions and 10 document scans per month"
    );
    expect(html).toContain(
      "500 AI Assistant questions and 500 document scans per month"
    );
  });

  it("describes Business Insights as a Starter preview and complete Pro view", () => {
    const starter = businessInsightsVisibility({ fullAccess: false, starterPreview: true, demo: false });
    const pro = businessInsightsVisibility({ fullAccess: true, starterPreview: false, demo: false });
    const comparison = section("comparison-title");

    expect(starter).toMatchObject({ priorityLimit: 2, fullSnapshot: false, upgradePrompt: true });
    expect(pro).toMatchObject({ priorityLimit: 5, fullSnapshot: true, upgradePrompt: false });
    expect(comparison).toContain('<span role="cell" data-plan-label="Starter">Practical preview</span>');
    expect(comparison).toContain('<span role="cell" data-plan-label="Pro">Complete view</span>');
  });

  it("states enforced AI allowances without stale implementation wording", () => {
    expect(aiAssistantSource).toContain("const AI_USAGE_COUNTING_ENABLED = true;");
    expect(aiAssistantSource).toContain("const AI_USAGE_ENFORCEMENT_ENABLED = true;");
    expect(documentScanSource).toContain("const INVOICE_SCANNING_USAGE_COUNTING_ENABLED = true;");
    expect(documentScanSource).toContain("const INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED = true;");
    expect(html).not.toMatch(/not (?:presently )?enforced|configured monthly allowances/i);
  });

  it("limits subscription reassurance to the implemented Stripe portal flow", () => {
    const reassurance = section("reassurance-title");

    expect(functionsSource).toContain("stripe.billingPortal.sessions.create");
    expect(functionsSource).toContain("isBillingPortalStatus(profile.subscriptionStatus)");
    expect(reassurance).toContain("Eligible Pro subscriptions");
    expect(html).not.toMatch(/cancel anytime|no contract|no card required|money-back|refund|free trial/i);
  });

  it("keeps equally available tools out of the key-differences comparison", () => {
    const comparison = section("comparison-title");

    expect(comparison).not.toMatch(/bank statement|VAT|Excel export|data backup/i);
  });

  it("has no broken local links, assets, homepage fragments or clean routes", () => {
    const rewrites = new Set(firebase.hosting[0].rewrites.map(({ source }) => source));
    const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;

      const [pathname, fragment] = link.split(/[?#]/);
      if (pathname === "/" && fragment) {
        const landingPage = readFileSync(new URL("../index.html", import.meta.url), "utf8");
        expect(landingPage, `${link} should point to a homepage section`).toContain(`id="${fragment}"`);
        continue;
      }
      if (pathname === "/" || pathname === "") continue;
      if (rewrites.has(pathname)) continue;

      expect(existsSync(`${projectRoot}${pathname}`), `${link} should resolve to a local file`).toBe(true);
    }
  });
});
