import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../whats-new.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/whats-new.css", import.meta.url), "utf8");
const sharedCss = readFileSync(
  new URL("../assets/guides/guides.css", import.meta.url),
  "utf8"
);
const firebase = JSON.parse(
  readFileSync(new URL("../firebase.json", import.meta.url), "utf8")
);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("public What's New page", () => {
  it("has unique metadata, one H1 and the clean public route", () => {
    expect(html).toContain("<title>What's New | Simple Books updates</title>");
    expect(html).toContain(
      '<meta name="description" content="See recent Simple Books updates, including practical additions for business records, banking review, insights, reporting and everyday small business workflows.">'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/whats-new">'
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/whats-new">'
    );
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>See what's new in Simple Books</h1>");
    expect(firebase.hosting[0].rewrites).toContainEqual({
      source: "/whats-new",
      destination: "/whats-new.html"
    });
  });

  it("uses the consistent public navigation and current-page state", () => {
    const desktopNavigation = html.match(
      /<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/
    )?.[1] || "";
    const mobileNavigation = html.match(
      /<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/
    )?.[1] || "";

    expect(textContent(desktopNavigation)).toBe(
      "Features Pricing About What's New Security Guides Contact"
    );
    expect(textContent(mobileNavigation)).toBe(
      "Features Pricing About What's New Security Guides Contact Login Sign Up"
    );
    expect(html).toContain(
      'href="/whats-new" aria-current="page">What\'s New</a>'
    );
    expect(html).toContain('href="/features">View Features</a>');
    expect(html).toContain('href="/login.html?demo=1">Explore the demo</a>');
    expect(html).toContain('href="/pricing">View Pricing');
  });

  it("features Banking separately and keeps recent updates newest first", () => {
    expect(html).toContain('<p class="eyebrow">Featured update</p>');
    expect(html).toContain("<h2 id=\"latest-title\">Bring bank statements into Simple Books</h2>");
    expect(html).toContain('<article class="featured-update" data-update-date="2026-08-07">');
    expect(html).toContain('<a class="inline-link" href="/features#banking-title">Explore Banking features');

    const recentStart = html.indexOf('<div class="updates-list">');
    const recentUpdates = html.slice(recentStart, html.indexOf("</section>", recentStart));

    const expectedUpdates = [
      ["2026-08-11", "Monthly AI allowances are now active"],
      ["2026-08-07", "Review imported statements alongside your records"],
      ["2026-08-06", "See priorities, trends and forecasts together"],
      ["2026-08-04", "Explore a fuller sample business"],
      ["2026-07-30", "More help for everyday tasks and accounting reports"],
      ["2026-07-23", "Open the accounting detail behind your records"],
      ["2026-07-19", "Ask about your records and prepare documents for review"]
    ];

    for (const [date, title] of expectedUpdates) {
      expect(recentUpdates).toContain(`data-update-date="${date}"`);
      expect(recentUpdates).toContain(`<h3>${title}</h3>`);
      expect(recentUpdates).toContain(`<time datetime="${date}">`);
    }

    const dates = [...recentUpdates.matchAll(/data-update-date="(\d{4}-\d{2}-\d{2})"/g)]
      .map((match) => match[1]);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("keeps update claims within verified current behaviour", () => {
    expect(html).toContain("Suggestions are for review and are not applied automatically.");
    expect(html).toContain("not a live bank feed");
    expect(html).toContain("ready for you to check before saving them");
    expect(html).toContain("Trial Balance, General Ledger, Profit and Loss and Balance Sheet");
    expect(html).not.toMatch(
      /live Open Banking|automatic bank reconciliation|MTD submission|HMRC approved|award-winning|market-leading|trusted by/i
    );
    expect(html).not.toMatch(/version\s+\d|release\s+\d|commit|pull request|server-side/i);
  });

  it("uses a simple maintainable newest-first static update structure", () => {
    expect(html).toContain(
      "Add new updates directly below this comment, newest first. Keep data-update-date and time datetime values aligned."
    );
    expect(html).not.toContain("<script type=\"application/json\"");
    expect(html).not.toMatch(/fetch\(|innerHTML|document\.write/);
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

  it("uses the shared shell and responsive update layouts", () => {
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/guides/guides.css">'
    );
    expect(html).toContain(
      '<script type="module" src="/assets/guides/public-shell.js"></script>'
    );
    expect(sharedCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.site-links[\s\S]*?display: none[\s\S]*?\.site-actions \.menu-button[\s\S]*?display: inline-flex/
    );
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.update-card[\s\S]*?grid-template-columns: 1fr/
    );
  });
});
