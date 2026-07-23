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

  it("keeps the requested desktop and mobile navigation without a Tools link", () => {
    const desktopNavigation = html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || "";
    const mobileNavigation = html.match(/<div class="mobile" id="mobileNav"[\s\S]*?>([\s\S]*?)<\/div>/)?.[1] || "";

    expect(textContent(desktopNavigation)).toBe("Features Pricing Contact");
    expect(textContent(mobileNavigation)).toBe("Features Pricing Contact Login Sign Up");
    expect(`${desktopNavigation}${mobileNavigation}`).not.toContain("/resources/tools/");
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

  it("offers only Starter Free and Pro at £15 per month", () => {
    const pricing = section("pricing");
    const planNames = [...pricing.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]);
    const amounts = [...pricing.matchAll(/<div class="amount">(.*?)<\/div>/g)].map(match => match[1]);

    expect(planNames).toEqual(["Starter", "Pro"]);
    expect(amounts).toEqual(["Free", "£15"]);
    expect(pricing).toContain("<li>Core business features</li>");
    expect(pricing).toContain("<li>Limited AI usage</li>");
    expect(pricing).toContain("<li>Limited invoice scanning</li>");
    expect(pricing).toContain("<li>Limited live projects</li>");
    expect(pricing).toContain("<li>Everything in Starter</li>");
    expect(pricing).toContain("<li>Unlimited AI</li>");
    expect(pricing).toContain("<li>Unlimited invoice scanning</li>");
    expect(pricing).toContain("<li>Unlimited live projects</li>");
    expect(pricing).toContain("<li>Accountant Pack</li>");
    expect(pricing).toContain("<li>Advanced reporting</li>");
    expect(pricing.match(/£\d+/g)).toEqual(["£15"]);
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
