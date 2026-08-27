import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "../resources/js/plan-entitlements.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/home.css", import.meta.url), "utf8");

function section(id) {
  const match = html.match(
    new RegExp('<section[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/section>'),
  );
  return match ? match[1] : "";
}

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&rsquo;|&#39;/g, "’")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

describe("redesigned public homepage", () => {
  it("opens with the approved audience, proposition, and primary actions", () => {
    const hero = textContent(
      html.match(/<section class="hero"[\s\S]*?<\/section>/)?.[0] ?? "",
    );
    expect(hero).toContain("freelancers, sole traders and small businesses");
    expect(hero).toContain(
      "Simple business software, without the unnecessary complexity.",
    );
    expect(hero).toContain(
      "Bring invoices, spending, projects, planning and useful financial insight together",
    );
    expect(html).toContain('href="/login.html?demo=1">Try Demo</a>');
    expect(html).toContain('href="/signup.html">Start Free</a>');
    expect(html).toContain('href="/features">Explore Features');
    expect(hero).toContain(
      "Move to Pro only when the extra tools become useful.",
    );
    expect(hero).not.toContain("extra capacity becomes useful");
  });

  it("keeps the existing public navigation and destinations", () => {
    const desktopNavigation =
      html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    const mobileNavigation =
      html.match(/<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/)?.[1] ?? "";

    expect(textContent(desktopNavigation)).toBe(
      "Features Pricing About What's New Security FAQ Guides Contact",
    );
    expect(textContent(mobileNavigation)).toBe(
      "Features Pricing About What's New Security Guides FAQ Contact Login Sign Up",
    );

    [
      "/features",
      "/pricing",
      "/about",
      "/whats-new",
      "/security",
      "/faq",
      "/guides",
      "/login.html",
      "/signup.html",
    ].forEach((href) => expect(html).toContain('href="' + href + '"'));

    expect(desktopNavigation + mobileNavigation).not.toContain("/resources/tools/");
    expect(
      existsSync(new URL("../resources/tools/index.html", import.meta.url)),
    ).toBe(true);
  });

  it("uses the approved narrative order", () => {
    const markers = [
      'class="hero"',
      'id="helps"',
      'id="progression"',
      'id="ownership"',
      'id="connected"',
      'id="mobile-workflow"',
      'id="proof"',
      'id="fit"',
      'id="plans"',
      'id="trust"',
      'id="contact"',
    ];
    let previous = -1;
    markers.forEach((marker) => {
      const position = html.indexOf(marker);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    });
  });

  it("replaces the feature catalogue with six concise outcome groups", () => {
    const helps = section("helps");
    [
      "Get paid",
      "Keep spending organised",
      "Manage your work",
      "Plan ahead",
      "Understand your numbers",
      "Work with your accountant",
    ].forEach((heading) => expect(helps).toContain("<h3>" + heading + "</h3>"));

    expect(helps.match(/<li>/g)).toHaveLength(6);
    expect(helps).toContain("with Pro");
    expect(helps).toContain('href="/features"');
  });

  it("states the Spreadsheet, Starter, and Pro progression accurately", () => {
    const progression = section("progression");
    const progressionText = textContent(progression);
    const starter = PLAN_ENTITLEMENTS.Starter;
    const pro = PLAN_ENTITLEMENTS.Pro;

    expect(progressionText).toContain("Spreadsheet");
    expect(progressionText).toContain("£0 / month");
    expect(progressionText).toContain("£15 / month");
    expect(progressionText).toContain("currently no time limit");
    expect(progressionText).toContain("no card-entry step");
    expect(progressionText).toContain("A free starting plan you don’t have to leave.");
    expect(progressionText).toContain(
      starter.aiAssistantMonthlyLimit + " AI Assistant questions",
    );
    expect(progressionText).toContain(
      starter.invoiceScanningMonthlyLimit + " AI document scans",
    );
    expect(progressionText).toContain(
      "Up to " + starter.activeProjectsLimit + " active projects",
    );
    expect(progressionText).toContain(
      pro.aiAssistantMonthlyLimit + " AI Assistant questions",
    );
    expect(progressionText).toContain(
      pro.invoiceScanningMonthlyLimit + " AI document scans",
    );
    expect(progressionText).toContain("Unlimited active projects");
    expect(progressionText).toContain("complete Business Insights");
    expect(progressionText).toContain(
      "Trial Balance, General Ledger, Profit & Loss and Balance Sheet",
    );
    expect(progressionText).toContain("Accountant Pack");
    expect(progressionText).toContain(
      "More Simple Books, not a different Simple Books.",
    );
    expect(progression).toContain('href="/pricing"');
  });

  it("explains workbook portability with the exact supported scope", () => {
    const ownership = section("ownership");
    const ownershipText = textContent(ownership);

    [
      "Clients",
      "Invoices",
      "Invoice Items",
      "Bills",
      "Expenses",
      "Mileage",
      "Projects",
      "Budgets",
    ].forEach((record) => expect(ownershipText).toContain(record));

    expect(ownershipText).toContain("supported business records");
    expect(ownershipText).toContain("The exported Summary is not imported");
    expect(ownershipText).toContain("Banking");
    expect(ownershipText).toContain("attachments and logos");
    expect(ownershipText).toContain("payment or settlement history");
    expect(ownershipText).toContain("generated reports");
    expect(ownershipText).toContain(
      "Paid invoices and bills need their missing payment history",
    );
    expect(ownershipText.toLowerCase()).not.toContain("all your data");
    expect(ownershipText).toContain(
      "create a test invoice, export your workbook and open it yourself",
    );
  });

  it("offers the same enabled public workbook download in both sections", () => {
    const workbookUrl = "/downloads/simple-books-workbook.xlsx";
    const links = [...html.matchAll(
      /<a[^>]*href="\/downloads\/simple-books-workbook\.xlsx"[^>]*>Download the workbook<\/a>/g,
    )];

    expect(links).toHaveLength(2);
    links.forEach((match) => {
      expect(match[0]).toContain(
        'download="simple-books-workbook.xlsx"',
      );
      expect(match[0]).not.toContain("disabled");
    });
    expect(section("ownership")).toContain(workbookUrl);
    expect(section("proof")).toContain(workbookUrl);
    expect(html).not.toContain("Workbook download coming next");
    expect(html).not.toContain("Public download coming next");
    expect(html).not.toMatch(/<button[^>]*workbook/i);
  });

  it("describes the shared populated Demo without claiming isolation", () => {
    const proof = textContent(section("proof"));
    expect(proof).toContain("populated Demo");
    expect(proof).toContain("without creating your own account");
    expect(proof).toContain("Normal nested business records can be changed");
    expect(proof).toContain("visible in the shared Demo");
    expect(proof).toContain("don’t enter real information");
    expect(proof.toLowerCase()).not.toMatch(
      /private demo|read-only demo|isolated demo|your own demo/,
    );
  });

  it("keeps the mobile document workflow within verified behavior", () => {
    const mobile = textContent(section("mobile-workflow"));
    expect(mobile).toContain("mobile browser");
    expect(mobile).toContain("JPG, PNG, WEBP or PDF");
    expect(mobile).toContain("AI scanning can suggest");
    expect(mobile).toContain("You decide whether to use those suggestions");
    expect(mobile).toContain("Saving the record remains a separate, deliberate action");
    expect(mobile).toContain("Choose it");
    expect(mobile).toContain("Check it");
    expect(mobile).toContain("Save it");
    expect(mobile.toLowerCase()).not.toMatch(
      /\bsnap\b|camera capture|take a photo|offline operation|installable|install as an app/,
    );
    expect(html).not.toMatch(/\bcapture(?:=|\s)/i);
  });

  it("uses the three real responsive WebP product screenshots", () => {
    const screenshots = [
      ["dashboard-overview.webp", "1894", "1080"],
      ["projects-portfolio.webp", "1522", "1081"],
      ["mobile-document-review.webp", "1480", "1059"],
    ];

    screenshots.forEach(([filename, width, height]) => {
      const assetUrl = new URL(
        "../assets/home/" + filename,
        import.meta.url,
      );
      const asset = readFileSync(assetUrl);
      const tag = html.match(
        new RegExp(
          '<img[^>]*src="/assets/home/' +
            filename.replace(".", "\\.") +
            '"[^>]*>',
        ),
      )?.[0] ?? "";

      expect(existsSync(assetUrl)).toBe(true);
      expect(asset.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(asset.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(tag).toContain('width="' + width + '"');
      expect(tag).toContain('height="' + height + '"');
      expect(tag).toMatch(/alt="[^"]+"/);
      expect(tag).toContain('decoding="async"');
    });

    const heroImage = html.match(
      /<img[^>]*src="\/assets\/home\/dashboard-overview\.webp"[^>]*>/,
    )?.[0] ?? "";
    const projectsImage = html.match(
      /<img[^>]*src="\/assets\/home\/projects-portfolio\.webp"[^>]*>/,
    )?.[0] ?? "";
    const aiReviewImage = html.match(
      /<img[^>]*src="\/assets\/home\/mobile-document-review\.webp"[^>]*>/,
    )?.[0] ?? "";

    expect(heroImage).toContain('fetchpriority="high"');
    expect(heroImage).not.toContain('loading="lazy"');
    expect(projectsImage).toContain('loading="lazy"');
    expect(aiReviewImage).toContain('loading="lazy"');
    expect(css).toMatch(
      /\.product-shot\{[^}]*width:100%;height:auto/,
    );
    expect(css).toContain("@media(max-width:360px)");
  });

  it("removes screenshot placeholder wording and describes the real views", () => {
    expect(html).not.toMatch(
      /Product image reserved|future product view|future populated|data-future-asset|placeholder-surface/i,
    );
    expect(html).toContain(
      "The populated Simple Books Dashboard brings navigation, business health and financial context into one view.",
    );
    expect(html).toContain(
      "Projects bring invoicing, bills, expenses, mileage, profit and budgets into one portfolio view.",
    );
    expect(html).toContain(
      "AI-suggested bill details remain highlighted for review before the record and scanned document are saved.",
    );
  });

  it("uses the restrained Phase 1B header and heading scale", () => {
    expect(css).toMatch(/\.site-nav\{[^}]*min-height:66px/);
    expect(css).toMatch(/\.logo\{width:146px/);
    expect(css).toMatch(
      /h1\{[^}]*font-size:clamp\(38px,5\.2vw,62px\)/,
    );
    expect(css).toMatch(
      /h2\{[^}]*font-size:clamp\(30px,3\.6vw,46px\)/,
    );
    expect(css).toMatch(/\.section\{padding:88px 0/);
  });

  it("keeps plan and trust summaries concise and precise", () => {
    const plans = textContent(section("plans"));
    const trust = textContent(section("trust"));

    expect(plans).toMatch(/£0\s*\/month/);
    expect(plans).toMatch(/£15\s*\/month/);
    expect(section("plans").match(/<article/g)).toHaveLength(2);
    expect(section("plans")).toContain('href="/pricing"');
    expect(trust).toContain("No card for Starter");
    expect(trust).toContain("Shared Demo first");
    expect(trust).toContain("Export supported records");
    expect(trust).toContain(
      "Pro checkout and subscription management open on Stripe’s pages.",
    );
    expect(trust.toLowerCase()).not.toMatch(
      /never sees card|stripe handles all|cancel anytime|refund|proration|unused time/,
    );
  });

  it("removes duplicated catalogue, comparison-table, and FAQ content", () => {
    expect(html).not.toContain('id="features"');
    expect(html).not.toContain('id="pricing"');
    expect(html).not.toContain('id="faq"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("How Simple Books works");
    expect(html).not.toContain("Built for real business work");
  });

  it("retains accessibility, contact, privacy, and legal essentials", () => {
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Have a look before you decide.");
    expect(html).toContain('href="mailto:adam@simple-books.co.uk"');
    expect(html).toContain('href="#privacy">Privacy</a>');
    expect(html).toContain('id="privacy"');
    expect(html).toContain(
      "is not a substitute for professional financial or tax advice",
    );
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });
});
