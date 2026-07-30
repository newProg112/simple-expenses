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
const dashboardGuide = readFileSync(
  projectFile("guide-pages/understanding-the-dashboard.html"),
  "utf8"
);
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
const claimBusinessMileageGuide = readFileSync(
  projectFile("guide-pages/how-to-claim-business-mileage.html"),
  "utf8"
);
const uploadingReceiptsGuide = readFileSync(
  projectFile("guide-pages/uploading-receipts.html"),
  "utf8"
);
const usingAiInvoiceScanningGuide = readFileSync(
  projectFile("guide-pages/using-ai-invoice-scanning.html"),
  "utf8"
);
const trackingProjectProfitabilityGuide = readFileSync(
  projectFile("guide-pages/tracking-project-profitability.html"),
  "utf8"
);
const doubleEntryBookkeepingGuide = readFileSync(
  projectFile("guide-pages/what-is-double-entry-bookkeeping.html"),
  "utf8"
);
const trialBalanceGuide = readFileSync(
  projectFile("guide-pages/understanding-the-trial-balance.html"),
  "utf8"
);
const generalLedgerGuide = readFileSync(
  projectFile("guide-pages/understanding-the-general-ledger.html"),
  "utf8"
);
const indexScript = readFileSync(projectFile("assets/guides/guides-index.js"), "utf8");
const guideScript = readFileSync(projectFile("assets/guides/guide-page.js"), "utf8");
const hosting = JSON.parse(readFileSync(projectFile("firebase.json"), "utf8"));

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

describe("public Guides data and index", () => {
  it("keeps all 23 unique guides in the seven requested categories", () => {
    expect(GUIDES).toHaveLength(23);
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(23);
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
    expect(occurrences(guidesIndex, / data-guide-card/g)).toBe(23);

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

  it("publishes the complete Dashboard article with current operational calculations", () => {
    const expectedHeadings = [
      "Introduction",
      "What the Dashboard is for",
      "Dashboard KPIs",
      "Dashboard charts",
      "Recent activity",
      "Dashboard reminders and alerts",
      "How dashboard figures are calculated",
      "When dashboard values update",
      "Why dashboard totals may differ from accounting reports",
      "Worked examples",
      "Common mistakes and misunderstandings",
      "Summary"
    ];

    expect(dashboardGuide).toContain(
      "<title>Understanding the Dashboard in Simple Books | Simple Books Guides</title>"
    );
    expect(dashboardGuide).toContain(
      '<meta name="description" content="Learn how the Simple Books Dashboard calculates invoice, bill and overdue figures, charts, alerts and recent activity, and how they differ from accounting reports.">'
    );
    expect(dashboardGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/understanding-the-dashboard">'
    );
    expect(dashboardGuide).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/guides/understanding-the-dashboard">'
    );
    expect(dashboardGuide).toContain("<span>12 minute read</span>");
    expect(dashboardGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(dashboardGuide).toContain('"@type":"BreadcrumbList"');
    expect(dashboardGuide).toContain('"@type":"TechArticle"');
    expect(dashboardGuide).toContain('"articleSection":"Getting Started"');
    expect(dashboardGuide).toContain(
      '"keywords":"Simple Books Dashboard, outstanding invoices'
    );
    expect(dashboardGuide).toContain('id="table-of-contents-list"');
    expect(dashboardGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(dashboardGuide, /<h1>/g)).toBe(1);
    expect(occurrences(dashboardGuide, /<h2>/g)).toBe(expectedHeadings.length);

    for (const heading of expectedHeadings) {
      expect(dashboardGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "understanding-the-trial-balance",
      "understanding-the-general-ledger",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet",
      "what-is-double-entry-bookkeeping"
    ]) {
      expect(dashboardGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "The current Dashboard does not display a separate <strong>Paid invoices</strong> KPI.",
      "The current card is labelled <strong>Overdue items</strong>, not Overdue invoices.",
      "The current Dashboard does not display separate <strong>Expenses this month</strong> or <strong>Mileage this month</strong> KPIs.",
      "<strong>Net position</strong> is Outstanding invoices minus Unpaid bills.",
      "For each month it is all invoice totals minus all bill totals for that month.",
      "Expenses and mileage claims do not contribute to Outstanding invoices, Unpaid bills, Net position, Overdue items or either chart.",
      "They do not update live while the page remains open in another tab.",
      "marking an invoice Paid removes it from the Dashboard’s Outstanding invoices figure, but the existing sales journal still debits Trade Receivables."
    ]) {
      expect(dashboardGuide).toContain(currentBehaviour);
    }

    expect(dashboardGuide).toContain(
      '<span>Previous guide</span><strong>Setting up your business</strong>'
    );
    expect(dashboardGuide).toContain(
      '<span>Next guide</span><strong>How to create an invoice</strong>'
    );
    expect(guidesIndex).toContain(
      'data-search="Understanding the Dashboard in Simple Books'
    );
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

  it("publishes the complete business-mileage article with current product behaviour", () => {
    const expectedHeadings = [
      "Introduction",
      "When should you claim business mileage?",
      "Open the Expenses page and switch to Mileage",
      "Enter the journey details",
      "Mileage calculation",
      "Attach supporting evidence",
      "Save the mileage claim",
      "How mileage affects the Dashboard, Profit & Loss, Balance Sheet and General Ledger",
      "Edit or delete a mileage claim",
      "Worked example",
      "Common mistakes",
      "Summary"
    ];

    expect(claimBusinessMileageGuide).toContain(
      "<title>How to claim business mileage | Simple Books Guides</title>"
    );
    expect(claimBusinessMileageGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/how-to-claim-business-mileage">'
    );
    expect(claimBusinessMileageGuide).toContain("<span>9 minute read</span>");
    expect(claimBusinessMileageGuide).toContain(
      '<time datetime="2026-07-29">29 July 2026</time>'
    );
    expect(claimBusinessMileageGuide).toContain(
      '"articleSection":"Expenses & Mileage"'
    );
    expect(claimBusinessMileageGuide).toContain(
      '"keywords":"how to claim business mileage'
    );
    expect(claimBusinessMileageGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(claimBusinessMileageGuide, /<h1>/g)).toBe(1);
    expect(occurrences(claimBusinessMileageGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(claimBusinessMileageGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "how-to-record-a-business-expense",
      "uploading-receipts",
      "tracking-project-profitability",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet",
      "understanding-the-general-ledger"
    ]) {
      expect(claimBusinessMileageGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "starts at £0.55 per mile",
      "debits Travel &amp; Mileage",
      "credits Employee Reimbursements Payable",
      "does not create a VAT journal line",
      "deleting a mileage claim does not create an accounting reversal"
    ]) {
      expect(claimBusinessMileageGuide).toContain(currentBehaviour);
    }
  });

  it("publishes the complete uploading-receipts article with workflow-specific behaviour", () => {
    const expectedHeadings = [
      "Introduction",
      "Why attach receipts and supporting documents?",
      "Where attachments are available in Simple Books",
      "Attach a receipt to a bill",
      "Attach a receipt to an expense",
      "Attach evidence to a mileage claim",
      "Upload a document with AI scanning",
      "Save and view an attachment",
      "Replace an attachment while editing",
      "Delete a record and its attachment",
      "Supported file types and size limits",
      "Worked examples",
      "Common attachment mistakes",
      "Summary"
    ];

    expect(uploadingReceiptsGuide).toContain(
      "<title>Uploading receipts in Simple Books | Simple Books Guides</title>"
    );
    expect(uploadingReceiptsGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/uploading-receipts">'
    );
    expect(uploadingReceiptsGuide).toContain("<span>10 minute read</span>");
    expect(uploadingReceiptsGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(uploadingReceiptsGuide).toContain(
      '"articleSection":"Expenses & Mileage"'
    );
    expect(uploadingReceiptsGuide).toContain(
      '"keywords":"upload receipts, attach receipts to expenses'
    );
    expect(uploadingReceiptsGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(uploadingReceiptsGuide, /<h1>/g)).toBe(1);
    expect(occurrences(uploadingReceiptsGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(uploadingReceiptsGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "how-to-record-a-bill",
      "how-to-record-a-business-expense",
      "how-to-claim-business-mileage",
      "using-ai-invoice-scanning"
    ]) {
      expect(uploadingReceiptsGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "Manual bill attachment:</strong> PDF only. No app-level maximum file size is currently enforced.",
      "Manual expense attachment:</strong> PDF only, up to 10 MB.",
      "Manual mileage attachment:</strong> PDF, JPG, JPEG or PNG, up to 10 MB.",
      "AI Scan Bill and Scan Receipt:</strong> PDF, JPG, JPEG, PNG or WEBP, up to 10 MB.",
      "the current Bills implementation does not attempt to delete its stored attachment",
      "does not restore or block deletion of the underlying record"
    ]) {
      expect(uploadingReceiptsGuide).toContain(currentBehaviour);
    }
  });

  it("publishes the complete AI invoice-scanning article with bill and expense differences", () => {
    const expectedHeadings = [
      "Introduction",
      "What AI invoice scanning does",
      "Supported file types and size limits",
      "Open AI invoice scanning",
      "Upload a document",
      "How extracted information is reviewed",
      "Using the extracted details",
      "What information AI can populate",
      "Manual review before saving",
      "What happens to the scanned document",
      "Limitations of the current implementation",
      "Worked examples",
      "Common scanning mistakes",
      "Summary"
    ];

    expect(usingAiInvoiceScanningGuide).toContain(
      "<title>Using AI invoice scanning in Simple Books | Simple Books Guides</title>"
    );
    expect(usingAiInvoiceScanningGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/using-ai-invoice-scanning">'
    );
    expect(usingAiInvoiceScanningGuide).toContain("<span>11 minute read</span>");
    expect(usingAiInvoiceScanningGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(usingAiInvoiceScanningGuide).toContain(
      '"articleSection":"Expenses & Mileage"'
    );
    expect(usingAiInvoiceScanningGuide).toContain(
      '"keywords":"AI invoice scanning, scan invoices'
    );
    expect(usingAiInvoiceScanningGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(usingAiInvoiceScanningGuide, /<h1>/g)).toBe(1);
    expect(occurrences(usingAiInvoiceScanningGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(usingAiInvoiceScanningGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "how-to-record-a-bill",
      "how-to-record-a-business-expense",
      "uploading-receipts"
    ]) {
      expect(usingAiInvoiceScanningGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "JPG or JPEG image",
      "The maximum size is 10 MB",
      "Scan Bill does not use Merchant as a fallback for Supplier.",
      "Merchant / Supplier</strong> from Merchant, or from Supplier when Merchant is empty.",
      "Currency, Total, Document Type and Confidence are displayed for review but are not copied into form fields.",
      "You cannot apply scanned details while editing an existing bill or expense.",
      "enforcement of a monthly scanning allowance is disabled"
    ]) {
      expect(usingAiInvoiceScanningGuide).toContain(currentBehaviour);
    }
  });

  it("publishes the complete project-profitability article with current calculations", () => {
    const expectedHeadings = [
      "Introduction",
      "What project profitability means in Simple Books",
      "Create and open a project",
      "Allocate invoice income to a project",
      "Allocate bills to a project",
      "Allocate expenses and mileage",
      "How project income, costs and margin are calculated",
      "Use the Projects portfolio overview",
      "Understand project charts and attention flags",
      "Review an individual project",
      "Understand budgets and project progress",
      "How transaction changes affect profitability",
      "How the main Dashboard relates to projects",
      "Worked examples",
      "Common project profitability mistakes",
      "Summary"
    ];

    expect(trackingProjectProfitabilityGuide).toContain(
      "<title>Tracking project profitability in Simple Books | Simple Books Guides</title>"
    );
    expect(trackingProjectProfitabilityGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/tracking-project-profitability">'
    );
    expect(trackingProjectProfitabilityGuide).toContain("<span>12 minute read</span>");
    expect(trackingProjectProfitabilityGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(trackingProjectProfitabilityGuide).toContain(
      '"@type":"TechArticle"'
    );
    expect(trackingProjectProfitabilityGuide).toContain(
      '"articleSection":"Projects"'
    );
    expect(trackingProjectProfitabilityGuide).toContain(
      '"keywords":"project profitability, track project costs'
    );
    expect(trackingProjectProfitabilityGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(trackingProjectProfitabilityGuide, /<h1>/g)).toBe(1);
    expect(occurrences(trackingProjectProfitabilityGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(trackingProjectProfitabilityGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "how-to-create-an-invoice",
      "how-to-record-a-bill",
      "how-to-record-a-business-expense",
      "how-to-claim-business-mileage",
      "understanding-profit-and-loss"
    ]) {
      expect(trackingProjectProfitabilityGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "Total invoiced minus Total costs.",
      "the expense’s saved <strong>Gross amount</strong>",
      "Paid, Unpaid, Draft, Submitted and Approved labels alter status breakdowns where shown, but not total income",
      "Below 75% is labelled <strong>Within budget</strong>.",
      "The main Dashboard has no project filter, project profit card or project profitability chart.",
      "The current delete workflow does not reassign or delete invoices, bills, expenses or mileage records"
    ]) {
      expect(trackingProjectProfitabilityGuide).toContain(currentBehaviour);
    }
  });

  it("publishes the complete double-entry bookkeeping article with current journals and reports", () => {
    const expectedHeadings = [
      "Introduction",
      "What double-entry bookkeeping is",
      "The accounting equation",
      "Assets, liabilities and equity explained",
      "Debits and credits in simple language",
      "Why every transaction has two equal entries",
      "How Simple Books creates journals",
      "How invoices create journal entries",
      "How bills create journal entries",
      "How expenses create journal entries",
      "How mileage creates journal entries",
      "VAT journals",
      "Trade Receivables and Trade Payables",
      "Why marking an invoice or bill as Paid changes operational status only",
      "How the Trial Balance is produced",
      "How the General Ledger is produced",
      "How Profit & Loss is produced",
      "How the Balance Sheet is produced",
      "Operational pages and accounting reports",
      "Worked examples",
      "Common mistakes and misunderstandings",
      "Summary"
    ];

    expect(doubleEntryBookkeepingGuide).toContain(
      "<title>What is double-entry bookkeeping? | Simple Books Guides</title>"
    );
    expect(doubleEntryBookkeepingGuide).toContain(
      '<meta name="description" content="Learn how double-entry bookkeeping works in Simple Books, including debits, credits, journals and the reports built from accounting entries.">'
    );
    expect(doubleEntryBookkeepingGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/what-is-double-entry-bookkeeping">'
    );
    expect(doubleEntryBookkeepingGuide).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/guides/what-is-double-entry-bookkeeping">'
    );
    expect(doubleEntryBookkeepingGuide).toContain("<span>15 minute read</span>");
    expect(doubleEntryBookkeepingGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(doubleEntryBookkeepingGuide).toContain('"@type":"BreadcrumbList"');
    expect(doubleEntryBookkeepingGuide).toContain('"@type":"TechArticle"');
    expect(doubleEntryBookkeepingGuide).toContain('"articleSection":"Accounting"');
    expect(doubleEntryBookkeepingGuide).toContain(
      '"keywords":"double-entry bookkeeping, debits and credits'
    );
    expect(doubleEntryBookkeepingGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(doubleEntryBookkeepingGuide, /<h1>/g)).toBe(1);
    expect(occurrences(doubleEntryBookkeepingGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(doubleEntryBookkeepingGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "understanding-the-trial-balance",
      "understanding-the-general-ledger",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet",
      "understanding-the-dashboard",
      "tracking-project-profitability"
    ]) {
      expect(doubleEntryBookkeepingGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "debits <strong>1100 Trade Receivables</strong> for the gross total",
      "credits <strong>2000 Trade Payables</strong> for the gross total",
      "credits <strong>2200 Employee Reimbursements Payable</strong> for the gross amount",
      "There is no VAT Input line in the current mileage journal.",
      "VAT Input is an Asset account and VAT Output is a Liability account",
      "The current Trial Balance does not provide a date filter",
      "marking an invoice or bill Paid does not record movement through Bank and does not reverse the original journal",
      "do not create a reversal or delete its existing journal",
      "No debit to Bank or credit clearing Trade Receivables is created.",
      "No credit to Bank or debit clearing Trade Payables is created.",
      "Project allocation supports operational project reporting; it does not add a project journal line."
    ]) {
      expect(doubleEntryBookkeepingGuide).toContain(currentBehaviour);
    }
  });

  it("publishes the complete Trial Balance guide from the current journal implementation", () => {
    const expectedHeadings = [
      "Introduction",
      "What is a Trial Balance?",
      "Why businesses use a Trial Balance",
      "How Simple Books creates the Trial Balance",
      "How source records generate ledger entries",
      "Accounts included in the report",
      "Debit and credit balances explained",
      "Why the Trial Balance should balance",
      "Common reasons a Trial Balance does not balance",
      "Relationship to the General Ledger",
      "Relationship to the Profit & Loss Statement",
      "Relationship to the Balance Sheet",
      "Worked examples",
      "Current implementation limitations",
      "Common mistakes",
      "Summary"
    ];

    expect(trialBalanceGuide).toContain(
      "<title>Understanding the Trial Balance in Simple Books | Simple Books Guides</title>"
    );
    expect(trialBalanceGuide).toContain(
      '<meta name="description" content="Learn how the Simple Books Trial Balance turns invoice, bill, expense and mileage journals into debit and credit account balances.">'
    );
    expect(trialBalanceGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/understanding-the-trial-balance">'
    );
    expect(trialBalanceGuide).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/guides/understanding-the-trial-balance">'
    );
    expect(trialBalanceGuide).toContain("<span>14 minute read</span>");
    expect(trialBalanceGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(trialBalanceGuide).toContain('"@type":"BreadcrumbList"');
    expect(trialBalanceGuide).toContain('"@type":"TechArticle"');
    expect(trialBalanceGuide).toContain('"articleSection":"Accounting"');
    expect(trialBalanceGuide).toContain(
      '"keywords":"trial balance, debit and credit balances'
    );
    expect(trialBalanceGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(trialBalanceGuide, /<h1>/g)).toBe(1);
    expect(occurrences(trialBalanceGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(trialBalanceGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "what-is-double-entry-bookkeeping",
      "understanding-the-general-ledger",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet"
    ]) {
      expect(trialBalanceGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "The Trial Balance is generated from General Ledger postings",
      "Account balance</strong> = accumulated debits minus accumulated credits.",
      "debit <strong>1100 Trade Receivables</strong> for the gross total",
      "credit <strong>2000 Trade Payables</strong> for the gross total",
      "credit <strong>2200 Employee Reimbursements Payable</strong> for the gross amount",
      "The current mileage journal has no VAT line.",
      "The current product has no user-facing manual-journal workflow.",
      "the current Trial Balance has no date filter",
      "deleting an invoice, bill, expense or mileage source does not currently create a reversal",
      "the operational record can remain while its journal is absent",
      "one malformed loaded journal makes the Trial Balance unavailable"
    ]) {
      expect(trialBalanceGuide).toContain(currentBehaviour);
    }

    expect(trialBalanceGuide).toContain(
      '<span>Previous guide</span><strong>What is double-entry bookkeeping?</strong>'
    );
    expect(trialBalanceGuide).toContain(
      '<span>Next guide</span><strong>Understanding the General Ledger in Simple Books</strong>'
    );
    expect(guidesIndex).toContain(
      'data-search="Understanding the Trial Balance in Simple Books Learn how the Simple Books Trial Balance turns invoice, bill, expense and mileage journals into debit and credit account balances. Accounting trial balance debit and credit balances general ledger account balances Simple Books"'
    );
  });

  it("publishes the complete General Ledger guide from the current journal implementation", () => {
    const expectedHeadings = [
      "Introduction",
      "What is a General Ledger?",
      "Why businesses use a General Ledger",
      "How Simple Books creates ledger entries",
      "How journal entries are stored and loaded",
      "Journal entries shown in the ledger",
      "Debit and credit postings explained",
      "Running account balances",
      "Filtering by account and date",
      "Relationship to the Trial Balance",
      "Relationship to the Profit & Loss Statement",
      "Relationship to the Balance Sheet",
      "Worked examples",
      "Common mistakes",
      "Current implementation limitations",
      "Summary"
    ];

    expect(generalLedgerGuide).toContain(
      "<title>Understanding the General Ledger in Simple Books | Simple Books Guides</title>"
    );
    expect(generalLedgerGuide).toContain(
      '<meta name="description" content="Learn how the Simple Books General Ledger displays journal postings, account activity, debit and credit entries, and running balances.">'
    );
    expect(generalLedgerGuide).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/guides/understanding-the-general-ledger">'
    );
    expect(generalLedgerGuide).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/guides/understanding-the-general-ledger">'
    );
    expect(generalLedgerGuide).toContain("<span>15 minute read</span>");
    expect(generalLedgerGuide).toContain(
      '<time datetime="2026-07-30">30 July 2026</time>'
    );
    expect(generalLedgerGuide).toContain('"@type":"BreadcrumbList"');
    expect(generalLedgerGuide).toContain('"@type":"TechArticle"');
    expect(generalLedgerGuide).toContain('"articleSection":"Accounting"');
    expect(generalLedgerGuide).toContain(
      '"keywords":"general ledger, ledger entries, journal postings'
    );
    expect(generalLedgerGuide).not.toMatch(
      /Coming soon|currently being prepared|placeholder/i
    );
    expect(occurrences(generalLedgerGuide, /<h1>/g)).toBe(1);
    expect(occurrences(generalLedgerGuide, /<h2>/g)).toBe(
      expectedHeadings.length
    );

    for (const heading of expectedHeadings) {
      expect(generalLedgerGuide).toContain(
        `<h2>${heading.replace(/&/g, "&amp;")}</h2>`
      );
    }

    for (const slug of [
      "what-is-double-entry-bookkeeping",
      "understanding-the-trial-balance",
      "understanding-profit-and-loss",
      "understanding-the-balance-sheet"
    ]) {
      expect(generalLedgerGuide).toContain(`href="/guides/${slug}"`);
    }

    for (const currentBehaviour of [
      "debit <strong>1100 Trade Receivables</strong> for the gross total",
      "credit <strong>2000 Trade Payables</strong> for the gross total",
      "credit <strong>2200 Employee Reimbursements Payable</strong> for the gross amount",
      "The current mileage journal has no VAT line.",
      "stored journal includes the owning user ID, journal ID, journal date, source type, source ID",
      "keeps only lines whose account code exactly matches the selection",
      "New running balance = previous running balance + debit − credit.",
      "Date From</strong> and <strong>Date To</strong> are optional and inclusive",
      "The filtered running balance therefore starts at zero",
      "Every Trial Balance account code links to the General Ledger",
      "Current delete workflows do not reverse or delete the linked journal.",
      "one invalid loaded journal or invalid journal date makes the General Ledger unavailable"
    ]) {
      expect(generalLedgerGuide).toContain(currentBehaviour);
    }

    expect(generalLedgerGuide).toContain(
      '<span>Previous guide</span><strong>Understanding the Trial Balance in Simple Books</strong>'
    );
    expect(generalLedgerGuide).toContain(
      '<span>Next guide</span><strong>Understanding Profit &amp; Loss</strong>'
    );
    expect(guidesIndex).toContain(
      'data-search="Understanding the General Ledger in Simple Books Learn how the Simple Books General Ledger displays journal postings, account activity, debit and credit entries, and running balances. Accounting general ledger ledger entries journal postings running balance account codes Simple Books"'
    );
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
    expect(guideRewrites).toHaveLength(24);
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
