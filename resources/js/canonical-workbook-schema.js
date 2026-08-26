export const WORKBOOK_SCHEMA_VERSION = 1;

const REQUIRED_INPUT = "required";
const OPTIONAL_INPUT = "optional";
const NO_INPUT = "none";

function column(header, options = {}) {
  const relationship = options.relationship
    ? Object.freeze({ ...options.relationship })
    : null;

  return Object.freeze({
    header,
    input: options.input || OPTIONAL_INPUT,
    dataType: options.dataType || "text",
    relationship,
    calculated: options.calculated === true,
    importIgnored: options.importIgnored === true,
    aliases: Object.freeze([...(options.aliases || [])]),
    enumValues: Object.freeze([...(options.enumValues || [])]),
    ...(options.requiredWhen
      ? { requiredWhen: Object.freeze({ ...options.requiredWhen }) }
      : {})
  });
}

function sheet(name, columns, options = {}) {
  return Object.freeze({
    name,
    importIgnored: options.importIgnored === true,
    columns: Object.freeze(columns)
  });
}

const CLIENT_STATUSES = ["Lead", "Active", "Dormant"];
const PAYMENT_STATUSES = ["Unpaid", "Paid"];
const CLAIM_STATUSES = ["Draft", "Submitted", "Approved", "Paid"];
const PROJECT_STATUSES = ["Active", "Completed", "On Hold"];
const BILL_CATEGORIES = [
  "General",
  "Utilities",
  "Professional fees",
  "Software/subscriptions",
  "Travel/mileage",
  "Other"
];
const EXPENSE_CATEGORIES = [
  "General",
  "Travel",
  "Meals",
  "Office",
  "Software",
  "Utilities",
  "Professional fees",
  "Other"
];
const BUDGET_CATEGORIES = [...EXPENSE_CATEGORIES, "Mileage"];
const VAT_RATES = [0.2, 0.05, 0];

const sheets = [
  sheet("Summary", [], { importIgnored: true }),
  sheet("Clients", [
    column("Client Name", {
      input: REQUIRED_INPUT,
      aliases: ["Name"]
    }),
    column("Email"),
    column("Phone"),
    column("Address", {
      aliases: [
        "Client Address",
        "Address Line 1",
        "Address Line 2",
        "Town/City",
        "Postcode",
        "Country"
      ]
    }),
    column("Payment Terms"),
    column("Status", { enumValues: CLIENT_STATUSES }),
    column("Follow Up Date", {
      dataType: "date",
      aliases: ["Follow Up"]
    }),
    column("Last Contacted Date", {
      dataType: "date",
      aliases: ["Last Contacted"]
    }),
    column("Notes")
  ]),
  sheet("Invoices", [
    column("Invoice Number", {
      input: REQUIRED_INPUT,
      aliases: ["Invoice No", "Number"]
    }),
    column("Client Name", {
      input: REQUIRED_INPUT,
      relationship: { sheet: "Clients", column: "Client Name" },
      aliases: ["Client"]
    }),
    column("Invoice Date", {
      input: REQUIRED_INPUT,
      dataType: "date",
      aliases: ["Date"]
    }),
    column("Payment Terms"),
    column("Due Date", { dataType: "date" }),
    column("Project Reference", {
      relationship: { sheet: "Projects", column: "Project Reference" }
    }),
    column("VAT Rate", {
      dataType: "percentage",
      enumValues: VAT_RATES
    }),
    column("Net", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true,
      aliases: ["Amount"]
    }),
    column("VAT", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true
    }),
    column("Total", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true
    }),
    column("Status", { enumValues: PAYMENT_STATUSES }),
    column("Recurring", { enumValues: ["No", "Yes"] }),
    column("Recurring Frequency", {
      enumValues: ["Monthly", "Quarterly", "Yearly"]
    }),
    column("Next Invoice Date", { dataType: "date" }),
    column("Reminder Date", { dataType: "date" })
  ]),
  sheet("Invoice Items", [
    column("Invoice Number", {
      input: REQUIRED_INPUT,
      relationship: { sheet: "Invoices", column: "Invoice Number" }
    }),
    column("Line Number", {
      input: REQUIRED_INPUT,
      dataType: "integer"
    }),
    column("Description", { input: REQUIRED_INPUT }),
    column("Net Amount", {
      input: REQUIRED_INPUT,
      dataType: "money"
    })
  ]),
  sheet("Bills", [
    column("Supplier", { input: REQUIRED_INPUT }),
    column("Bill Number", { aliases: ["Bill No", "Number"] }),
    column("Bill Date", {
      input: REQUIRED_INPUT,
      dataType: "date",
      aliases: ["Date"]
    }),
    column("Due Date", { dataType: "date" }),
    column("Category", { enumValues: BILL_CATEGORIES }),
    column("Project Reference", {
      relationship: { sheet: "Projects", column: "Project Reference" }
    }),
    column("Net", {
      input: REQUIRED_INPUT,
      dataType: "money",
      aliases: ["Amount"]
    }),
    column("VAT Rate", {
      dataType: "percentage",
      enumValues: VAT_RATES
    }),
    column("VAT", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true
    }),
    column("Total", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true
    }),
    column("Status", { enumValues: PAYMENT_STATUSES }),
    column("Notes")
  ]),
  sheet("Expenses", [
    column("Date", { input: REQUIRED_INPUT, dataType: "date" }),
    column("Merchant", {
      input: REQUIRED_INPUT,
      aliases: ["Supplier", "Supplier / Merchant"]
    }),
    column("Category", { enumValues: EXPENSE_CATEGORIES }),
    column("Description"),
    column("Project Reference", {
      relationship: { sheet: "Projects", column: "Project Reference" }
    }),
    column("Net", {
      input: REQUIRED_INPUT,
      dataType: "money",
      aliases: ["Net Amount", "Amount"]
    }),
    column("VAT Rate", {
      dataType: "percentage",
      enumValues: VAT_RATES
    }),
    column("VAT", {
      dataType: "money",
      aliases: ["VAT Amount"]
    }),
    column("Gross", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true,
      aliases: ["Gross Amount", "Total"]
    }),
    column("Status", { enumValues: CLAIM_STATUSES }),
    column("Notes")
  ]),
  sheet("Mileage", [
    column("Date", { input: REQUIRED_INPUT, dataType: "date" }),
    column("From", { input: REQUIRED_INPUT }),
    column("To", { input: REQUIRED_INPUT }),
    column("Business Purpose", { aliases: ["Purpose"] }),
    column("Project Reference", {
      relationship: { sheet: "Projects", column: "Project Reference" }
    }),
    column("Miles", { input: REQUIRED_INPUT, dataType: "number" }),
    column("Rate Per Mile", {
      dataType: "money",
      aliases: ["Mileage Rate", "Rate"]
    }),
    column("Amount", {
      input: NO_INPUT,
      dataType: "money",
      calculated: true,
      aliases: ["Mileage Amount"]
    }),
    column("Status", { enumValues: CLAIM_STATUSES }),
    column("Notes")
  ]),
  sheet("Projects", [
    column("Project Reference", { input: REQUIRED_INPUT }),
    column("Project Name", { input: REQUIRED_INPUT }),
    column("Client Name", {
      relationship: { sheet: "Clients", column: "Client Name" }
    }),
    column("Description"),
    column("Status", { enumValues: PROJECT_STATUSES }),
    column("Start Date", { dataType: "date" }),
    column("End Date", { dataType: "date" }),
    column("Project Budget", { dataType: "money" })
  ]),
  sheet("Budgets", [
    column("Budget Name", { input: REQUIRED_INPUT }),
    column("Period Type", {
      input: REQUIRED_INPUT,
      enumValues: ["Monthly", "Quarterly", "Annual", "Custom"]
    }),
    column("Start Date", { input: REQUIRED_INPUT, dataType: "date" }),
    column("End Date", { input: REQUIRED_INPUT, dataType: "date" }),
    column("Budget Type", {
      input: REQUIRED_INPUT,
      enumValues: ["Overall", "Category"]
    }),
    column("Category", {
      enumValues: BUDGET_CATEGORIES,
      requiredWhen: { column: "Budget Type", equals: "Category" }
    }),
    column("Project Reference", {
      relationship: { sheet: "Projects", column: "Project Reference" }
    }),
    column("Planned Amount", {
      input: REQUIRED_INPUT,
      dataType: "money"
    }),
    column("Status", { enumValues: ["Active", "Completed"] })
  ])
];

export const CANONICAL_WORKBOOK_SCHEMA = Object.freeze({
  id: "simple-books-canonical-workbook",
  version: WORKBOOK_SCHEMA_VERSION,
  constraints: Object.freeze({
    maximumInvoiceItemsPerInvoice: 3
  }),
  sheets: Object.freeze(sheets)
});

