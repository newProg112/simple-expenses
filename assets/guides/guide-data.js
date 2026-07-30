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
    description: "Learn how to create an invoice for a customer in Simple Books, add VAT and payment terms, save it, make a PDF and record payment.",
    keywords: ["how to create an invoice", "small business invoice", "customer invoice", "Simple Books", "VAT", "payment terms"],
    readTime: 10,
    lastUpdated: "2026-07-29",
    featured: true,
    format: "how-to"
  },
  {
    slug: "how-to-mark-an-invoice-as-paid",
    title: "How to mark an invoice as paid",
    category: "Invoicing",
    description: "Learn how to mark an invoice as paid in Simple Books, confirm payment, update invoice status and understand which totals and reports change.",
    keywords: ["how to mark an invoice as paid", "mark invoice paid", "record invoice payment", "paid invoice in Simple Books"],
    readTime: 7,
    lastUpdated: "2026-07-29",
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
    slug: "how-to-record-a-bill",
    title: "How to record a bill",
    category: "Bills",
    description: "Learn how to record a supplier bill in Simple Books, add VAT, save it before payment and understand how it affects your accounts.",
    keywords: ["how to record a bill", "supplier bill", "accounts payable", "input VAT", "pay a bill", "Simple Books"],
    readTime: 10,
    lastUpdated: "2026-07-29",
    format: "how-to"
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
    slug: "how-to-record-a-business-expense",
    title: "How to record a business expense",
    category: "Expenses & Mileage",
    description: "Learn how to record a business expense in Simple Books, add VAT and receipts, use AI scanning and understand the accounting entries.",
    keywords: ["how to record a business expense", "business expenses", "expense claim", "receipt", "input VAT", "Simple Books"],
    readTime: 11,
    lastUpdated: "2026-07-29",
    format: "how-to"
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
    slug: "how-to-claim-business-mileage",
    title: "How to claim business mileage",
    category: "Expenses & Mileage",
    description: "Learn how to record a business mileage claim in Simple Books, calculate the amount, attach evidence and understand the accounting entries.",
    keywords: ["how to claim business mileage", "business mileage claim", "mileage rate", "miles travelled", "travel expenses", "Simple Books"],
    readTime: 9,
    lastUpdated: "2026-07-29",
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
    title: "Uploading receipts in Simple Books",
    category: "Expenses & Mileage",
    description: "Learn how to upload receipts, attach supporting documents and manage saved files on bills, expenses and mileage claims in Simple Books.",
    keywords: ["upload receipts", "attach receipts to expenses", "save receipt documents", "upload a receipt in Simple Books", "attachment"],
    readTime: 10,
    format: "how-to",
    lastUpdated: "2026-07-30"
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
