import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectFile = path => new URL(`../${path}`, import.meta.url);
const html = readFileSync(projectFile("faq.html"), "utf8");
const css = readFileSync(projectFile("assets/faq.css"), "utf8");
const sharedCss = readFileSync(projectFile("assets/guides/guides.css"), "utf8");
const firebase = JSON.parse(readFileSync(projectFile("firebase.json"), "utf8"));
const pricing = readFileSync(projectFile("pricing.html"), "utf8");
const entitlements = readFileSync(projectFile("resources/js/plan-entitlements.js"), "utf8");
const security = readFileSync(projectFile("security.html"), "utf8");
const banking = readFileSync(projectFile("resources/tools/banking.html"), "utf8");
const bankImport = readFileSync(projectFile("resources/js/bank-transaction-import.js"), "utf8");
const bankMatches = readFileSync(projectFile("resources/js/bank-match-suggestions.js"), "utf8");
const exportsPage = readFileSync(projectFile("exports.html"), "utf8");
const projectRoot = fileURLToPath(projectFile(""));

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("public FAQ page", () => {
  it("has accurate metadata, one H1 and the clean route", () => {
    expect(html).toContain("<title>Frequently asked questions | Simple Books</title>");
    expect(html).toContain('<meta name="description" content="Answers to common questions about Simple Books features, pricing, plans, banking imports, AI tools, security and getting started.">');
    expect(html).toContain('<link rel="canonical" href="https://simple-books.co.uk/faq">');
    expect(html).toContain('<meta property="og:url" content="https://simple-books.co.uk/faq">');
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).toContain("<h1 id=\"faq-title\">Questions before you get started?</h1>");
    expect(firebase.hosting[0].rewrites).toContainEqual({ source: "/faq", destination: "/faq.html" });
  });

  it("keeps the desktop header restrained and adds FAQ to mobile and footer navigation", () => {
    const desktopNavigation = html.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || "";
    const mobileNavigation = html.match(/<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/)?.[1] || "";
    const footerNavigation = html.match(/<nav class="footer-links"[\s\S]*?>([\s\S]*?)<\/nav>/)?.[1] || "";

    expect(textContent(desktopNavigation)).toBe("Features Pricing About What's New Security FAQ Guides Contact");
    expect(desktopNavigation).toContain('href="/faq" aria-current="page"');
    expect(textContent(mobileNavigation)).toBe("Features Pricing About What's New Security Guides FAQ Contact Login Sign Up");
    expect(mobileNavigation).toContain('href="/faq" aria-current="page"');
    expect(footerNavigation).toContain('href="/faq" aria-current="page"');
    expect(html).toContain('id="menu-button" type="button" aria-expanded="false" aria-controls="mobile-navigation"');
  });

  it("answers the requested getting-started and product questions", () => {
    for (const question of [
      "Can I try Simple Books without creating an account?",
      "Do I need to be an accountant to use Simple Books?",
      "What if I currently use Excel or spreadsheets?",
      "Can I keep using my accountant?",
      "What records can I keep in Simple Books?",
      "Can I export my information?",
      "Can Simple Books scan bills or receipts?",
      "What can the AI Assistant do?",
      "Does Simple Books connect directly to my bank?",
      "What can the Banking feature do today?"
    ]) expect(html).toContain(`<h3>${question}</h3>`);

    expect(html).toContain('id="accounting-title">Does Simple Books replace an accountant?</h2>');

    expect(html).toContain("Do not enter real personal or business information into the demo.");
    expect(html).toContain("does not create, edit or delete them");
    expect(html).toContain("not a completed automatic reconciliation workflow");
  });

  it("matches verified plan pricing and entitlement values", () => {
    expect(pricing).toContain('<div class="plan-price"><strong>&pound;0</strong><span>/ month</span></div>');
    expect(pricing).toContain('<div class="plan-price"><strong>&pound;15</strong><span>/ month</span></div>');
    expect(entitlements).toContain("aiAssistantMonthlyLimit: 10");
    expect(entitlements).toContain("invoiceScanningMonthlyLimit: 10");
    expect(entitlements).toContain("activeProjectsLimit: 5");
    expect(entitlements).toContain("aiAssistantMonthlyLimit: 500");
    expect(entitlements).toContain("invoiceScanningMonthlyLimit: 500");
    expect(entitlements).toContain("activeProjectsLimit: null");

    expect(html).toContain("Starter is &pound;0 per month");
    expect(html).toContain("Pro subscription is &pound;15 per month");
    expect(html).toContain("Starter includes up to 5 active projects");
    expect(html).toContain("Pro includes unlimited active projects");
    expect(html).toContain("10 AI Assistant questions and 10 document scans per month");
    expect(html).toContain("500 AI Assistant questions and 500 document scans per month");
  });

  it("describes exports, banking, AI and payment handling within implemented boundaries", () => {
    expect(exportsPage).toContain("buildFirestoreBackupData");
    expect(exportsPage).toContain("downloadExcelExport");
    expect(exportsPage).toContain("generateAccountantPackZip");
    expect(banking).toContain("parseCsvPreview(await file.text())");
    expect(bankImport).toContain("bankTransactionDuplicateKey");
    expect(bankMatches).toContain("suggestBankMatches");
    expect(security).toContain("Card entry takes place on Stripe's pages");

    expect(html).toContain("JSON download covers core account, invoice, bill and client or customer records");
    expect(html).toContain("Excel export covers invoices, bills, expenses and mileage");
    expect(html).toContain("Matching suggestions are review-only and are not applied automatically");
    expect(html).toContain("it does not store the full card number in its business records");
  });

  it("avoids unsupported commercial, security and tax claims", () => {
    expect(html).not.toMatch(/free trial|annual billing|money-back|refund|minimum term|cancel any time|VAT inclusive|VAT exclusive/i);
    expect(html).not.toMatch(/bank-grade|military-grade|ISO\s*27001|SOC\s*2|PCI\s*DSS|independently audited|penetration tested|guaranteed backups|automatic backups|99\.\d+% uptime/i);
    expect(html).not.toMatch(/HMRC approved|MTD compatible|can submit (?:tax|VAT)|files? (?:tax|VAT) returns/i);
    expect(html).toContain("does not currently submit tax returns or VAT returns to HMRC");
  });

  it("links FAQ from public desktop, mobile and footer navigation", () => {
    for (const file of [
      "index.html", "features.html", "pricing.html", "about.html",
      "whats-new.html", "security.html", "guide-pages/index.html",
      "guide-pages/welcome-to-simple-books.html"
    ]) {
      const page = readFileSync(projectFile(file), "utf8");
      const mobile = page.match(/(?:<nav class="mobile-navigation"|<div class="mobile")[\s\S]*?>([\s\S]*?)<\/(?:nav|div)>/)?.[1] || "";
      const footer = page.match(/(?:<nav class="footer-links"[\s\S]*?>|<footer[\s\S]*?)([\s\S]*?)<\/(?:nav|footer)>/)?.[1] || "";
      const desktop = page.match(/<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/)?.[1] || "";
      expect(mobile, `${file} mobile navigation`).toContain('href="/faq"');
      expect(footer, `${file} footer`).toContain('href="/faq"');
      expect(desktop, `${file} desktop navigation`).toContain('href="/faq"');
    }
  });

  it("has no broken local links or assets and uses responsive shared navigation", () => {
    const rewrites = new Set(firebase.hosting[0].rewrites.map(({ source }) => source));
    for (const link of [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1])) {
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const pathname = link.split(/[?#]/)[0];
      if (pathname === "/" || pathname === "") continue;
      if (rewrites.has(pathname)) continue;
      expect(existsSync(`${projectRoot}${pathname}`), `${link} should resolve`).toBe(true);
    }

    expect(html).toContain('<link rel="stylesheet" href="/assets/guides/guides.css">');
    expect(html).toContain('<script type="module" src="/assets/guides/public-shell.js"></script>');
    expect(sharedCss).toMatch(/@media \(max-width: 1020px\)[\s\S]*?\.site-links[\s\S]*?display: none/);
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.faq-list-two-column \{ grid-template-columns: 1fr;/);
  });
});
