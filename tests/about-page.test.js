import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../about.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/about.css", import.meta.url), "utf8");
const firebase = JSON.parse(
  readFileSync(new URL("../firebase.json", import.meta.url), "utf8")
);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function section(id) {
  return html.match(
    new RegExp(`<section[^>]+aria-labelledby="${id}"[\\s\\S]*?<\\/section>`)
  )?.[0] || "";
}

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("public About page", () => {
  it("has unique metadata, one H1 and a clean public route", () => {
    expect(html).toContain(
      "<title>About Simple Books | Practical small business software</title>"
    );
    expect(html).toContain(
      '<meta name="description" content="Learn why Simple Books brings invoices, expenses, business records and reporting tools together for UK sole traders, freelancers and small businesses.">'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/about">'
    );
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain(
      "<h1>Business software built to keep things understandable</h1>"
    );
    expect(firebase.hosting[0].rewrites).toContainEqual({
      source: "/about",
      destination: "/about.html"
    });
  });

  it("uses consistent public navigation and low-pressure calls to action", () => {
    const desktopNavigation = html.match(
      /<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/
    )?.[1] || "";
    const mobileNavigation = html.match(
      /<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/
    )?.[1] || "";

    expect(textContent(desktopNavigation)).toBe(
      "Features Pricing About Guides Contact"
    );
    expect(textContent(mobileNavigation)).toBe(
      "Features Pricing About Guides Contact Login Sign Up"
    );
    expect(html).toContain('href="/about" aria-current="page">About</a>');
    expect(html).toContain('href="/features">View Features</a>');
    expect(html).toContain('href="/login.html?demo=1">Explore the demo</a>');
    expect(html).toContain('href="/signup.html">Start free</a>');
    expect(html).toContain('href="/pricing">View Pricing');
    expect(html).toContain(
      'id="menu-button" type="button" aria-expanded="false"'
    );
  });

  it("explains the product story and intended small-business audience", () => {
    const why = section("why-title");
    const audience = section("audience-title");

    expect(why).toContain("started as a practical project");
    expect(why).toContain(
      "invoices, bills, receipts, spreadsheets and separate files"
    );
    expect(why).toContain(
      "not to make people learn accounting software for its own sake"
    );
    for (const audienceName of [
      "Sole traders",
      "Freelancers",
      "Owner-managed businesses"
    ]) {
      expect(audience).toContain(`<h3>${audienceName}</h3>`);
    }
    for (const label of ["SOLE TRADER", "FREELANCER", "SMALL BUSINESS"]) {
      expect(audience).toContain(`<span aria-hidden="true">${label}</span>`);
    }
    expect(audience).not.toContain('<span aria-hidden="true">FREE</span>');
    expect(audience).toContain("without already knowing the language");
  });

  it("describes the product philosophy in clear customer-facing language", () => {
    const principles = section("principles-title");

    expect(principles).toContain(
      "As Simple Books grows, the aim is to keep it easy to navigate: familiar wording, practical tools and enough context to understand what each area is for."
    );
    expect(principles).not.toContain(
      "the intention is to keep the route through it clear"
    );
  });

  it("shows the intended capability progression without duplicating Features", () => {
    const progression = section("progression-title");
    const stages = [
      "Everyday records",
      "Planning and visibility",
      "Accounting and reporting"
    ];

    for (const stage of stages) expect(progression).toContain(stage);
    expect(stages.map((stage) => progression.indexOf(stage)))
      .toEqual([...stages].map((stage) => progression.indexOf(stage)).sort((a, b) => a - b));
    expect(progression).toContain("when useful");
  });

  it("positions Simple Books alongside an accountant with an advice disclaimer", () => {
    const accountant = section("accountant-title");

    for (const capability of [
      "Structured records",
      "Reports",
      "Accountant Pack",
      "Exports"
    ]) {
      expect(accountant).toContain(`<strong>${capability}</strong>`);
    }
    expect(accountant).toContain("can sit alongside professional support");
    expect(accountant).toContain("does not replace professional judgement");
    expect(accountant).toContain(
      "is not a substitute for professional financial or tax advice"
    );
  });

  it("avoids unsupported company, accounting and banking claims", () => {
    expect(html).not.toMatch(
      /trusted by|award-winning|built by accountants|industry-leading|market-leading|HMRC approved|MTD submission|live Open Banking|automatic bank reconciliation/i
    );
    expect(html).not.toMatch(
      /thousands of (?:customers|users)|years in business|our (?:team|investors)|founder/i
    );
  });

  it("has no broken local links or assets", () => {
    const rewrites = new Set(
      firebase.hosting[0].rewrites.map(({ source }) => source)
    );
    const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => match[1]);

    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;

      const [pathname, fragment] = link.split(/[?#]/);
      if (pathname === "/" && fragment) {
        const landingPage = readFileSync(
          new URL("../index.html", import.meta.url),
          "utf8"
        );
        expect(landingPage, `${link} should point to a homepage section`)
          .toContain(`id="${fragment}"`);
        continue;
      }
      if (pathname === "/" || pathname === "") continue;
      if (rewrites.has(pathname)) continue;
      expect(
        existsSync(`${projectRoot}${pathname}`),
        `${link} should resolve to a local file`
      ).toBe(true);
    }
  });

  it("uses the shared responsive shell and About-specific breakpoints", () => {
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/guides/guides.css">'
    );
    expect(html).toContain(
      '<script type="module" src="/assets/guides/public-shell.js"></script>'
    );
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.site-actions \.menu-button[\s\S]*?display: inline-flex/
    );
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.product-progression,[\s\S]*?grid-template-columns: 1fr/
    );
  });
});
