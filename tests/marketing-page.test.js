import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function section(id){
  const match = html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)<\\/section>`));
  return match ? match[1] : "";
}

function textContent(fragment){
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("marketing landing page", () => {
  it("uses the current business-software positioning", () => {
    expect(html).toContain("<title>Simple Books | Simple business software</title>");
    expect(html).toContain("Business management software for freelancers, sole traders and small businesses.");
    expect(html).toContain("<h1>Simple business software, all in one place.</h1>");
  });

  it("keeps the public navigation, including Guides, without a Tools link", () => {
    const desktopNavigation = html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || "";
    const mobileNavigation = html.match(/<div class="mobile" id="mobileNav"[\s\S]*?>([\s\S]*?)<\/div>/)?.[1] || "";

    expect(textContent(desktopNavigation)).toBe("Features Pricing About What's New Security Guides Contact");
    expect(textContent(mobileNavigation)).toBe("Features Pricing About What's New Security Guides Contact Login Sign Up");
    expect(`${desktopNavigation}${mobileNavigation}`).not.toContain("/resources/tools/");
    expect(`${desktopNavigation}${mobileNavigation}`).toContain('href="/guides"');
    expect(`${desktopNavigation}${mobileNavigation}`).toContain('href="/about"');
    expect(`${desktopNavigation}${mobileNavigation}`).toContain('href="/whats-new"');
    expect(`${desktopNavigation}${mobileNavigation}`).toContain('href="/security"');
    expect(html).toContain('href="/login.html"');
    expect(html).toContain('href="/signup.html"');
  });

  it("leaves the standalone Tools page in the project", () => {
    expect(existsSync(new URL("../resources/tools/index.html", import.meta.url))).toBe(true);
  });

  it("describes the current application features", () => {
    const features = section("features");
    const requiredFeatures = [
      "Dashboard",
      "Invoices",
      "Bills",
      "Expenses",
      "Projects",
      "Budgets",
      "Cashflow",
      "AI Assistant",
      "Trial Balance",
      "General Ledger",
      "Profit &amp; Loss",
      "Balance Sheet",
      "Accountant Pack"
    ];

    for(const feature of requiredFeatures){
      expect(features).toContain(`<h3>${feature}</h3>`);
    }
  });

  it("shows the current Starter and Pro prices, allowances, and feature access", () => {
    const pricing = section("pricing");
    const planNames = [...pricing.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]);
    const amounts = [...pricing.matchAll(/<div class="amount">(.*?)<\/div>/g)].map(match => match[1]);

    expect(planNames).toEqual(["Starter", "Pro"]);
    expect(amounts).toEqual(["Free", "&pound;15"]);
    expect(pricing).toContain("10 questions/month");
    expect(pricing).toContain("500 questions/month");
    expect(pricing).toContain("10 scans/month");
    expect(pricing).toContain("500 scans/month");
    expect(pricing).toContain("Up to 5");
    expect(pricing).toContain("Unlimited");

    for(const feature of [
      "Invoices",
      "Bills",
      "Expenses",
      "Mileage",
      "Budgets",
      "Cashflow",
      "Business Insights",
      "Accountant Pack",
      "Trial Balance",
      "General Ledger",
      "Profit &amp; Loss",
      "Balance Sheet"
    ]){
      expect(pricing).toContain(`<th scope="row">${feature}</th>`);
    }

    const proCard = pricing.match(/<article class="card plan-card plan-card-pro">([\s\S]*?)<\/article>/)?.[1] || "";
    expect(proCard).toContain("<li>Business Insights dashboard</li>");
    expect(proCard.indexOf("Business Insights dashboard")).toBeLessThan(proCard.indexOf("Advanced accounting reports"));

    const advancedAccounting = pricing.slice(pricing.indexOf('<th colspan="3" scope="colgroup">Advanced accounting</th>'));
    expect([...advancedAccounting.matchAll(/<th scope="row">(.*?)<\/th>/g)].slice(0, 6).map(match => match[1])).toEqual([
      "Business Insights",
      "Accountant Pack",
      "Trial Balance",
      "General Ledger",
      "Profit &amp; Loss",
      "Balance Sheet"
    ]);
    expect(advancedAccounting).toMatch(/<th scope="row">Business Insights<\/th>\s*<td class="comparison-value not-included" data-plan="Starter">Not included<\/td>\s*<td class="comparison-value included" data-plan="Pro">Included<\/td>/);

    expect(pricing).toContain('href="/signup.html">Get Started Free</a>');
    expect(pricing).toContain('href="/signup.html">Upgrade to Pro</a>');
    expect(pricing).not.toMatch(/Unlimited AI|Unlimited invoice scanning|Limited AI usage|Limited invoice scanning|Limited live projects/i);
  });

  it("places the plan comparison before the longer feature catalogue", () => {
    expect(html.indexOf('<section id="pricing">')).toBeLessThan(html.indexOf('<section id="features">'));
  });

  it("removes legacy service and product wording", () => {
    expect(html).not.toMatch(/bookkeeping software/i);
    expect(html).not.toMatch(/bookkeeping support/i);
    expect(html).not.toMatch(/bookkeeping enquiries/i);
    expect(html).not.toMatch(/catch-up bookkeeping/i);
    expect(html).not.toMatch(/accountant services/i);
    expect(html).not.toContain("Simple Expenses");
    expect(html).not.toContain("CRM-lite");
  });

  it("preserves accessible mobile-menu and authentication controls", () => {
    expect(html).toContain('id="menuBtn" aria-expanded="false" aria-controls="mobileNav"');
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('menuBtn.setAttribute("aria-expanded", String(open))');
  });
});
