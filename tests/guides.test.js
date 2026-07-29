import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GUIDE_CATEGORIES,
  GUIDES,
  guideUrl,
  relatedGuides
} from "../assets/guides/guide-data.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const guidesIndex = readFileSync(projectFile("guide-pages/index.html"), "utf8");
const createInvoiceGuide = readFileSync(
  projectFile("guide-pages/how-to-create-an-invoice.html"),
  "utf8"
);
const markInvoicePaidGuide = readFileSync(
  projectFile("guide-pages/how-to-mark-an-invoice-as-paid.html"),
  "utf8"
);
const recordBillGuide = readFileSync(
  projectFile("guide-pages/how-to-record-a-bill.html"),
  "utf8"
);
const recordBusinessExpenseGuide = readFileSync(
  projectFile("guide-pages/how-to-record-a-business-expense.html"),
  "utf8"
);
const indexScript = readFileSync(projectFile("assets/guides/guides-index.js"), "utf8");
const guideScript = readFileSync(projectFile("assets/guides/guide-page.js"), "utf8");
const hosting = JSON.parse(readFileSync(projectFile("firebase.json"), "utf8"));

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

describe("public Guides data and index", () => {
  it("keeps all 22 unique guides in the seven requested categories", () => {
    expect(GUIDES).toHaveLength(22);
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(22);
    expect(new Set(GUIDES.map((guide) => guide.category))).toEqual(new Set(GUIDE_CATEGORIES));
    expect(GUIDES.filter((guide) => guide.featured).map((guide) => guide.title)).toEqual([
      "How to create an invoice",
      "Recording business expenses",
      "Understanding Profit & Loss",
      "What is VAT?"
    ]);

    for (const guide of GUIDES) {
      expect(guide.description.length).toBeGreaterThan(30);
      expect(guide.keywords.length).toBeGreaterThan(2);
      expect(guide.readTime).toBeGreaterThan(0);
      expect(["article", "how-to"]).toContain(guide.format);
    }
  });

  it("pre-renders the guide catalogue and accessible filtering controls", () => {
    expect(guidesIndex).toContain("<h1>Simple Books Guides</h1>");
    expect(guidesIndex).toContain('<label class="search-label" for="guide-search">');
    expect(guidesIndex).toContain('aria-label="Filter guides by category"');
    expect(guidesIndex).toContain('id="empty-state" hidden');
    expect(guidesIndex).toContain('id="clear-filters"');
    expect(occurrences(guidesIndex, / data-guide-card/g)).toBe(22);

    for (const category of ["All guides", ...GUIDE_CATEGORIES]) {
      expect(guidesIndex).toContain(`data-category-filter="${category.replace(/&/g, "&amp;")}"`);
    }
    for (const guide of GUIDES) {
      expect(guidesIndex).toContain(`href="${guideUrl(guide)}"`);
      expect(guidesIndex).toContain(guide.title.replace(/&/g, "&amp;"));
    }
  });

  it("combines category and keyword search and provides a clear action", () => {
    expect(indexScript).toContain("categoryMatches && searchMatches");
    expect(indexScript).toContain("card.dataset.search");
    expect(indexScript).toContain('activeCategory = "All guides"');
    expect(indexScript).toContain('searchInput.value = ""');
    expect(indexScript).toContain("aria-pressed");
  });

  it("has complete homepage SEO metadata and collection structured data", () => {
    expect(guidesIndex).toContain("<title>Simple Books Guides | Product help and accounting basics</title>");
    expect(guidesIndex).toContain('<link rel="canonical" href="https://simple-books.co.uk/guides">');
    expect(guidesIndex).toContain('<meta property="og:url" content="https://simple-books.co.uk/guides">');
    expect(guidesIndex).toContain('"@type":"CollectionPage"');
    expect(occurrences(guidesIndex, /<h1>/g)).toBe(1);
  });
});

describe("generated guide pages", () => {
  it("creates a static, indexable page with complete SEO metadata for every slug", () => {
    GUIDES.forEach((guide) => {
      const path = `guide-pages/${guide.slug}.html`;
      expect(existsSync(projectFile(path))).toBe(true);
      const html = readFileSync(projectFile(path), "utf8");
      const canonical = `https://simple-books.co.uk${guideUrl(guide)}`;

      expect(html).toContain(`<title>${guide.title.replace(/&/g, "&amp;")} | Simple Books Guides</title>`);
      expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
      expect(html).toContain(`<meta property="og:url" content="${canonical}">`);
      expect(html).toContain(`<h1>${guide.title.replace(/&/g, "&amp;")}</h1>`);
      expect(html).toContain(guide.description.replace(/&/g, "&amp;"));
      expect(html).toContain("<h2>Introduction</h2>");
      expect(html).toContain("<h2>Summary</h2>");
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('id="table-of-contents-list"');
      expect(html).toContain("Related guides");
      expect(html).toContain("Back to all Simple Books guides");
      expect(html).toContain(guide.format === "how-to" ? '"@type":"TechArticle"' : '"@type":"Article"');
      expect(occurrences(html, /<h1>/g)).toBe(1);
    });
  });

  it("derives related, previous and next navigation from the central ordering", () => {
    GUIDES.forEach((guide, index) => {
      const html = readFileSync(projectFile(`guide-pages/${guide.slug}.html`), "utf8");
      for (const related of relatedGuides(guide)) {
        expect(html).toContain(`href="${guideUrl(related)}"`);
      }
      if (index > 0) {
        expect(html).toContain(`<span>Previous guide</span><strong>${GUIDES[index - 1].title.replace(/&/g, "&amp;")}</strong>`);
      }
      if (index < GUIDES.length - 1) {
        expect(html).toContain(`<span>Next guide</span><strong>${GUIDES[index + 1].title.replace(/&/g, "&amp;")}</strong>`);
      }
    });
  });

  it("builds stable table-of-contents anchors from article H2 headings", () => {
    expect(guideScript).toContain('document.querySelectorAll(".guide-article h2")');
    expect(guideScript).toContain("heading.id = heading.id || stableAnchorId");
    expect(guideScript).toContain('link.href = `#${heading.id}`');
  });

  it("publishes the complete create-invoice article and its guide-specific metadata", () => {
    const expectedHeadings = [
      "Introduction",
      "Before you create an invoice",
      "Create a new invoice in Simple Books",
      "Choose or enter the customer",
      "Check the invoice number and date",
      "Add products or services",
      "Add VAT where applicable",
      "Set payment terms and the due date",
      "Add payment details and any agreed wording",
      "Review and save the invoice",
      "Download, print or send the invoice",
      "Mark the invoice as paid",
      "Worked example",
      "Common invoice mistakes",
      "Summary"
    ];

    expect(createInvoiceGuide).toContain(
      "<title>How to create an invoice | Simple Books Guides</title>"
    );
    expect(createInvoiceGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/how-to-create-an-invoice">'
    );
    expect(createInvoiceGuide).toContain("<span>10 minute read</span>");
    expect(createInvoiceGuide).toContain(
      '<time datetime="2026-07-29">29 July 2026</time>'
    );
    expect(createInvoiceGuide).toContain('"articleSection":"Invoicing"');
    expect(createInvoiceGuide).toContain('"keywords":"how to create an invoice');
    expect(createInvoiceGuide).not.toMatch(/Coming soon|currently being prepared|placeholder/i);
    expect(occurrences(createInvoiceGuide, /<h1>/g)).toBe(1);
    expect(occurrences(createInvoiceGuide, /<h2>/g)).toBe(expectedHeadings.length);

    for (const heading of expectedHeadings) {
      expect(createInvoiceGuide).toContain(`<h2>${heading}</h2>`);
    }

    for (const slug of [
      "setting-up-your-business",
      "how-to-mark-an-invoice-as-paid",
      "understanding-overdue-invoices",
      "what-is-vat",
      "input-vat-and-output-vat"
    ]) {
      expect(createInvoiceGuide).toContain(`href="/guides/${slug}"`);
    }
  });

  it("publishes the complete mark-invoice-paid article without unsupported payment claims", () => {
    const expectedHeadings = [
      "Introduction",
      "When should you mark an invoice as paid?",
      "Find the invoice in Simple Books",
      "Mark the invoice as paid",
      "What changes after you mark it paid?",
      "How paid invoices affect totals, statements and reports",
      "Correct a mistake with Mark Unpaid",
      "What Simple Books does not record",
      "Worked example",
      "Common mistakes",
      "Summary"
    ];

    expect(markInvoicePaidGuide).toContain(
      "<title>How to mark an invoice as paid | Simple Books Guides</title>"
    );
    expect(markInvoicePaidGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/how-to-mark-an-invoice-as-paid">'
    );
    expect(markInvoicePaidGuide).toContain("<span>7 minute read</span>");
    expect(markInvoicePaidGuide).toContain(
      '<time datetime="2026-07-29">29 July 2026</time>'
    );
    expect(markInvoicePaidGuide).toContain('"articleSection":"Invoicing"');
    expect(markInvoicePaidGuide).toContain(
      '"keywords":"how to mark an invoice as paid'
    );
    expect(markInvoicePaidGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(markInvoicePaidGuide, /<h1>/g)).toBe(1);
    expect(occurrences(markInvoicePaidGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(markInvoicePaidGuide).toContain(`<h2>${heading}</h2>`);
    }

    for (const slug of [
      "how-to-create-an-invoice",
      "understanding-overdue-invoices",
      "understanding-the-dashboard",
      "understanding-profit-and-loss"
    ]) {
      expect(markInvoicePaidGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const unsupportedFeature of [
      "A separate paid date",
      "The payment amount",
      "The payment method",
      "Partial payments are therefore not supported",
      "There is no automatic bank matching or reconciliation"
    ]) {
      expect(markInvoicePaidGuide).toContain(unsupportedFeature);
    }

    expect(markInvoicePaidGuide).toContain(
      "Marking it Paid changes only its status and does not create, replace or reverse that posting."
    );
  });

  it("publishes the complete record-bill article with accurate accounting and status guidance", () => {
    const expectedHeadings = [
      "Introduction",
      "When should you record a bill?",
      "Open the Bills page",
      "Enter the supplier details",
      "Add bill items, VAT and totals",
      "Save the bill",
      "Mark a bill as paid",
      "How bills affect the dashboard, reports and financial statements",
      "Edit or delete a bill",
      "Worked example",
      "Common mistakes",
      "Summary"
    ];

    expect(recordBillGuide).toContain(
      "<title>How to record a bill | Simple Books Guides</title>"
    );
    expect(recordBillGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/how-to-record-a-bill">'
    );
    expect(recordBillGuide).toContain("<span>10 minute read</span>");
    expect(recordBillGuide).toContain(
      '<time datetime="2026-07-29">29 July 2026</time>'
    );
    expect(recordBillGuide).toContain('"articleSection":"Bills"');
    expect(recordBillGuide).toContain('"keywords":"how to record a bill');
    expect(recordBillGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(recordBillGuide, /<h1>/g)).toBe(1);
    expect(occurrences(recordBillGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(recordBillGuide).toContain(`<h2>${heading}</h2>`);
    }

    for (const slug of [
      "how-to-create-an-invoice",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet",
      "input-vat-and-output-vat",
      "understanding-the-general-ledger"
    ]) {
      expect(recordBillGuide).toContain(`href="/guides/${slug}"`);
    }

    expect(recordBillGuide).toContain(
      "Marking a bill as paid changes its status only. It does not create, replace or reverse the accounting journal"
    );
    expect(recordBillGuide).toContain(
      "select <strong>Mark unpaid</strong>"
    );
  });

  it("publishes the complete business-expense article with current product behaviour", () => {
    const expectedHeadings = [
      "Introduction",
      "When should you record an expense?",
      "Bills vs Expenses",
      "Open the Expenses page",
      "Enter the expense details",
      "Add VAT and totals",
      "Attach receipts",
      "Add notes and project allocation",
      "Save the expense",
      "AI Scan Expense",
      "How expenses affect the Dashboard, Profit & Loss, Balance Sheet and General Ledger",
      "Edit or delete an expense",
      "Worked example",
      "Common mistakes",
      "Summary"
    ];

    expect(recordBusinessExpenseGuide).toContain(
      "<title>How to record a business expense | Simple Books Guides</title>"
    );
    expect(recordBusinessExpenseGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/how-to-record-a-business-expense">'
    );
    expect(recordBusinessExpenseGuide).toContain("<span>11 minute read</span>");
    expect(recordBusinessExpenseGuide).toContain(
      '<time datetime="2026-07-29">29 July 2026</time>'
    );
    expect(recordBusinessExpenseGuide).toContain(
      '"articleSection":"Expenses & Mileage"'
    );
    expect(recordBusinessExpenseGuide).toContain(
      '"keywords":"how to record a business expense'
    );
    expect(recordBusinessExpenseGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(recordBusinessExpenseGuide, /<h1>/g)).toBe(1);
    expect(occurrences(recordBusinessExpenseGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(recordBusinessExpenseGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "how-to-record-a-bill",
      "uploading-receipts",
      "using-ai-invoice-scanning",
      "input-vat-and-output-vat",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet",
      "understanding-the-general-ledger"
    ]) {
      expect(recordBusinessExpenseGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "Manual expense attachments currently accept PDF files up to 10 MB.",
      "Mark paid updates the expense’s status only",
      "credits Employee Reimbursements Payable",
      "deleting an expense does not create an accounting reversal"
    ]) {
      expect(recordBusinessExpenseGuide).toContain(currentBehaviour);
    }
  });
});

describe("Firebase Hosting guide routes", () => {
  it("rewrites only the index and intended clean guide paths to static HTML", () => {
    const mainHosting = hosting.hosting.find((site) => site.target === "main");
    const guideRewrites = mainHosting.rewrites.filter((rewrite) => rewrite.source.startsWith("/guides"));
    const expectedRoutes = [
      { source: "/guides", destination: "/guide-pages/index.html" },
      ...GUIDES.map((guide) => ({
        source: guideUrl(guide),
        destination: `/guide-pages/${guide.slug}.html`
      }))
    ];

    expect(guideRewrites).toEqual(expectedRoutes);
    expect(guideRewrites).toHaveLength(23);
    expect(guideRewrites.some((rewrite) => rewrite.source.includes("**"))).toBe(false);
  });

  it("keeps invalid guide paths on the real 404 page with a guide-specific message", () => {
    const notFound = readFileSync(projectFile("404.html"), "utf8");
    expect(notFound).toContain('<meta name="robots" content="noindex">');
    expect(notFound).toContain('window.location.pathname.startsWith("/guides/")');
    expect(notFound).toContain("We couldn’t find that guide");
    expect(notFound).toContain('href="/guides"');
  });
});
