import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../features.html", import.meta.url), "utf8");
const firebase = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function section(id) {
  return html.match(new RegExp(`<section[^>]+aria-labelledby="${id}"[\\s\\S]*?<\\/section>`))?.[0] || "";
}

describe("public features page", () => {
  it("has unique metadata, one clear H1 and a clean public route", () => {
    expect(html).toContain("<title>Features | Simple Books small business software</title>");
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>Everything you need to keep your business organised</h1>");
    expect(firebase.hosting[0].rewrites).toContainEqual({
      source: "/features",
      destination: "/features.html"
    });
  });

  it("uses the existing public navigation and calls to action", () => {
    expect(html).toContain('href="/features" aria-current="page">Features</a>');
    expect(html).toContain('href="/pricing">Pricing</a>');
    expect(html).toContain('href="/about">About</a>');
    expect(html).toContain('href="/login.html?demo=1">Try the demo</a>');
    expect(html).toContain('href="/signup.html">Try Simple Books</a>');
    expect(html).toContain('id="menu-button" type="button" aria-expanded="false"');
  });

  it("has no broken local links or clean routes", () => {
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

  it("covers the verified everyday and reporting features", () => {
    for (const feature of [
      "Invoices", "Bills", "Expenses", "Mileage", "Clients", "Projects",
      "Dashboard", "Budgets", "Cashflow", "Business Insights",
      "Profit &amp; Loss", "Balance Sheet", "Trial Balance &amp; General Ledger"
    ]) {
      expect(html).toContain(`<h3>${feature}</h3>`);
    }

    for (const label of ["INVOICE", "BILL", "EXPENSE", "MILEAGE", "CLIENT", "PROJECT"]) {
      expect(html).toContain(`<span class="feature-icon" aria-hidden="true">${label}</span>`);
    }
  });

  it("describes AI and banking within their current implemented limits", () => {
    const ai = section("ai-title");
    const banking = section("banking-title");

    expect(ai).toContain("supplier bill or expense receipt");
    expect(ai).toContain("does not create, edit or delete");
    expect(banking).toContain("Import a CSV bank statement");
    expect(banking).toContain("suggest possible matches");
    expect(banking).toContain("not a live Open Banking feed or completed reconciliation workflow");
    expect(banking).not.toMatch(/automatically (?:apply|match)/i);
  });

  it("covers the current accountant and user-controlled export options", () => {
    const exports = section("exports-title");

    expect(exports).toContain("Accountant Pack");
    expect(exports).toContain("Excel export");
    expect(exports).toContain("Data backup");
  });
});
