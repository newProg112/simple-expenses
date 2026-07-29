// This is the single source used by the generator, browser filters, and tests.
export const GUIDE_CATEGORIES = [
  "Getting Started",
  "Invoicing",
  "Bills",
  "Expenses & Mileage",
  "Projects",
  "Accounting",
  "VAT"
];

export const GUIDES = [
  {
    slug: "welcome-to-simple-books",
    title: "Welcome to Simple Books",
    category: "Getting Started",
    description: "Get to know Simple Books and the everyday business tasks you can manage in one place.",
    keywords: ["overview", "first steps", "small business", "bookkeeping"],
    readTime: 4,
    format: "article"
  },
  {
    slug: "setting-up-your-business",
    title: "Setting up your business",
    category: "Getting Started",
    description: "Learn which business details to add before you start creating records and reports.",
    keywords: ["business profile", "company details", "setup", "preferences"],
    readTime: 5,
    format: "how-to"
  },
  {
    slug: "understanding-the-dashboard",
    title: "Understanding the dashboard",
    category: "Getting Started",
    description: "Understand the dashboard totals, shortcuts and recent business activity.",
    keywords: ["overview", "totals", "activity", "navigation"],
    readTime: 5,
    format: "article"
  },
  {
    slug: "how-to-create-an-invoice",
    title: "How to create an invoice",
    category: "Invoicing",
    description: "Follow the core steps for preparing and saving a clear customer invoice.",
    keywords: ["sales", "customer", "invoice number", "due date"],
    readTime: 6,
    featured: true,
    format: "how-to"
  },
  {
    slug: "how-to-mark-an-invoice-as-paid",
    title: "How to mark an invoice as paid",
    category: "Invoicing",
    description: "Keep invoice status and outstanding customer balances up to date.",
    keywords: ["payment", "paid status", "customer balance", "receivables"],
    readTime: 4,
    format: "how-to"
  },
  {
    slug: "understanding-overdue-invoices",
    title: "Understanding overdue invoices",
    category: "Invoicing",
    description: "Learn when an invoice becomes overdue and how to keep on top of late payments.",
    keywords: ["late payment", "due date", "receivables", "customer"],
    readTime: 5,
    format: "article"
  },
  {
    slug: "recording-supplier-bills",
    title: "Recording supplier bills",
    category: "Bills",
    description: "See how to record money your business owes to suppliers.",
    keywords: ["supplier", "purchase", "accounts payable", "due date"],
    readTime: 6,
    format: "how-to"
  },
  {
    slug: "managing-unpaid-bills",
    title: "Managing unpaid bills",
    category: "Bills",
    description: "Organise outstanding supplier bills and keep payment dates visible.",
    keywords: ["supplier", "unpaid", "payment", "accounts payable"],
    readTime: 5,
    format: "article"
  },
  {
    slug: "recording-business-expenses",
    title: "Recording business expenses",
    category: "Expenses & Mileage",
    description: "Capture day-to-day business costs with the details needed for reliable records.",
    keywords: ["costs", "purchases", "VAT", "categories"],
    readTime: 6,
    featured: true,
    format: "how-to"
  },
  {
    slug: "claiming-business-mileage",
    title: "Claiming business mileage",
    category: "Expenses & Mileage",
    description: "Record business journeys and calculate a clear mileage claim.",
    keywords: ["journey", "miles", "vehicle", "HMRC"],
    readTime: 6,
    format: "how-to"
  },
  {
    slug: "uploading-receipts",
    title: "Uploading receipts",
    category: "Expenses & Mileage",
    description: "Attach supporting receipts to keep expense records complete and easy to review.",
    keywords: ["attachment", "image", "evidence", "document"],
    readTime: 4,
    format: "how-to"
  },
  {
    slug: "using-ai-invoice-scanning",
    title: "Using AI invoice scanning",
    category: "Expenses & Mileage",
    description: "Learn how document scanning can help draft bill and expense details for your review.",
    keywords: ["AI", "scan", "document", "receipt", "automation"],
    readTime: 5,
    format: "how-to"
  },
  {
    slug: "tracking-project-profitability",
    title: "Tracking project profitability",
    category: "Projects",
    description: "Connect project income and costs to understand how work is performing.",
    keywords: ["project", "income", "costs", "margin", "profit"],
    readTime: 7,
    format: "article"
  },
  {
    slug: "what-is-double-entry-bookkeeping",
    title: "What is double-entry bookkeeping?",
    category: "Accounting",
    description: "Understand why every accounting transaction has equal debit and credit entries.",
    keywords: ["debit", "credit", "journal", "accounts"],
    readTime: 7,
    format: "article"
  },
  {
    slug: "understanding-the-trial-balance",
    title: "Understanding the Trial Balance",
    category: "Accounting",
    description: "Learn what a Trial Balance shows and why balanced totals matter.",
    keywords: ["debits", "credits", "accounts", "report"],
    readTime: 6,
    format: "article"
  },
  {
    slug: "understanding-the-general-ledger",
    title: "Understanding the General Ledger",
    category: "Accounting",
    description: "Explore the detailed account activity behind your financial reports.",
    keywords: ["account", "journal", "transactions", "running balance"],
    readTime: 7,
    format: "article"
  },
  {
    slug: "understanding-profit-and-loss",
    title: "Understanding Profit & Loss",
    category: "Accounting",
    description: "See how income, expenses and the resulting profit or loss fit together.",
    keywords: ["income statement", "revenue", "expenses", "net profit"],
    readTime: 7,
    featured: true,
    format: "article"
  },
  {
    slug: "understanding-the-balance-sheet",
    title: "Understanding the Balance Sheet",
    category: "Accounting",
    description: "Understand the relationship between assets, liabilities and equity.",
    keywords: ["assets", "liabilities", "equity", "financial position"],
    readTime: 7,
    format: "article"
  },
  {
    slug: "what-is-vat",
    title: "What is VAT?",
    category: "VAT",
    description: "Learn the basic purpose of VAT and the terms small businesses commonly encounter.",
    keywords: ["Value Added Tax", "HMRC", "registration", "VAT rate"],
    readTime: 6,
    featured: true,
    format: "article"
  },
  {
    slug: "input-vat-and-output-vat",
    title: "Understanding input VAT and output VAT",
    category: "VAT",
    description: "Understand VAT on purchases, VAT on sales and how the two amounts relate.",
    keywords: ["input tax", "output tax", "purchases", "sales", "VAT return"],
    readTime: 6,
    format: "article"
  }
];

export const GUIDE_LAST_UPDATED = "2026-07-29";

export function guideUrl(guide) {
  return `/guides/${guide.slug}`;
}

export function relatedGuides(currentGuide, limit = 3) {
  return GUIDES
    .filter((guide) => guide.slug !== currentGuide.slug)
    .sort((left, right) => {
      const leftSameCategory = left.category === currentGuide.category ? 0 : 1;
      const rightSameCategory = right.category === currentGuide.category ? 0 : 1;
      return leftSameCategory - rightSameCategory;
    })
    .slice(0, limit);
}
