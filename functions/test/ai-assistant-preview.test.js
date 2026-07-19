/* eslint-disable max-len */

"use strict";

const assert = require("node:assert/strict");
const {summarizeBusinessData} = require("../lib/business-summary");
const {countNoun, pluralize, verbForCount} = require("../lib/grammar");
const {
  createPreviewResponse,
  routeQuestion,
  validateCallableData,
} = require("../ai-assistant-preview");

const now = new Date("2026-07-19T12:00:00.000Z");
const data = {
  clients: [{id: "c1", name: "Acme Ltd"}],
  invoices: [
    {id: "i1", status: "Unpaid", total: 120, date: "2026-07-01", dueDate: "2026-07-10", client: "  Acme   Ltd ", projectId: "p1"},
    {id: "i2", status: "Unpaid", total: 80, date: "2026-07-02", dueDate: "2026-08-01", client: "JKL 2Ltd", projectId: "p1"},
  ],
  bills: [
    {id: "b1", status: "Unpaid", total: 50, billDate: "2026-07-01", dueDate: "2026-07-26", projectId: "p1"},
    {id: "b2", status: "Unpaid", total: 30, billDate: "2026-06-01", dueDate: "2026-07-01", projectId: "p1"},
  ],
  expenses: [
    {id: "e1", type: "expense", date: "2026-07-03", net: 100, vat: 20, gross: 120, category: "Software", projectId: "p1"},
    {id: "e2", type: "expense", date: "2026-06-03", net: 50, vat: 10, gross: 60, category: "Software"},
    {id: "m1", type: "mileage", date: "2026-07-04", miles: 20, ratePerMile: 0.5, amount: 10, projectId: "p1"},
  ],
  projects: [{id: "p1", name: "Project One", status: "Active", budget: 300, endDate: "2026-12-31"}],
  budgets: [
    {id: "bu1", name: "Overall", budgetType: "overall", startDate: "2026-07-01", endDate: "2026-07-31", plannedAmount: 200, projectId: "p1"},
    {id: "bu2", name: "Software", budgetType: "category", category: "Software", startDate: "2026-07-01", endDate: "2026-07-31", plannedAmount: 150},
  ],
};

const summary = summarizeBusinessData(data, {}, {now});

assert.equal(pluralize(1, "invoice"), "invoice");
assert.equal(pluralize(2, "invoice"), "invoices");
assert.equal(countNoun(1, "day"), "1 day");
assert.equal(countNoun(2, "warning"), "2 warnings");
assert.equal(verbForCount(1, "is", "are"), "is");

assert.equal(summary.invoices.overdueCount, 1);
assert.equal(summary.invoices.overdueValue, 120);
assert.equal(summary.invoices.outstandingCount, 2);
assert.equal(summary.invoices.outstandingValue, 200);
assert.equal(summary.invoices.largestCustomers.find((customer) => customer.name.includes("Acme")).outstandingInvoiceCount, 1);
assert.equal(summary.warnings.filter((warning) => warning.code === "unmatched-clients")[0].count, 1);
assert.equal(summary.bills.outstandingCount, 2);
assert.equal(summary.bills.outstandingValue, 80);
assert.equal(summary.bills.upcomingCount, 1);
assert.equal(summary.bills.upcomingValue, 50);
assert.equal(summary.expenses.monthlyTotals.find((item) => item.month === "2026-07").grossValue, 120);
assert.equal(summary.expenses.monthlyTotals.find((item) => item.month === "2026-07").mileageAmount, 10);
assert.equal(summary.projects.revenue, 200);
assert.equal(summary.projects.costs, 210);
assert.equal(summary.projects.profit, -10);
assert.equal(summary.projects.marginPercent, -5);
assert.equal(summary.budgets.exceededCount, 0);
assert.equal(summary.budgets.nearLimitCount, 2);
assert.equal(summary.budgets.actualValue, 300);
assert.equal(summary.cashflow.expectedReceipts, 200);
assert.equal(summary.cashflow.expectedPayments, 80);
assert.equal(summary.cashflow.closingBalance, 120);
assert.equal(summary.cashflow.lowestBalance, 0);

const legacy = summarizeBusinessData({
  invoices: [{status: "Unpaid", amount: 75, date: "2026-07-01", dueDate: "2026-08-01"}],
  bills: [{status: "Unpaid", net: 40, billDate: "2026-07-01", dueDate: "2026-08-01"}],
}, {}, {now});
assert.equal(legacy.invoices.outstandingValue, 75);
assert.equal(legacy.bills.outstandingValue, 40);

const routes = new Map([
  ["What should I focus on today?", "priorities"],
  ["Which customers owe me the most?", "customer-balances"],
  ["Are any budgets close to being exceeded?", "budgets"],
  ["Which projects are least profitable?", "project-profitability"],
  ["How do this month's expenses compare with last month?", "expenses"],
  ["What bills are due soon?", "bills"],
  ["Summarise my business this month.", "overall-summary"],
  ["What could affect my cashflow?", "cashflow"],
  ["Which invoices are overdue?", "overdue-invoices"],
  ["How much did I invoice this month?", "overdue-invoices"],
  ["How much mileage did I claim this month?", "expenses"],
  ["How are my projects doing?", "project-profitability"],
  ["How is my business doing?", "overall-summary"],
  ["What is an invoice?", "unsupported"],
  ["Tell me a joke about invoices", "unsupported"],
  ["Calculate 2 + 2", "unsupported"],
  ["How much is a billion?", "unsupported"],
  ["Give me an overview of Rome", "unsupported"],
  ["What is business performance?", "unsupported"],
  ["Who invented invoices?", "unsupported"],
  ["Write me a poem about bookkeeping", "unsupported"],
]);
routes.forEach((category, question) => {
  assert.equal(routeQuestion(question), category);
  assert.equal(routeQuestion(question.toUpperCase().replace(/\?$/, "!!!")), category);
});

const requestId = "123e4567-e89b-42d3-a456-426614174000";
assert.throws(() => validateCallableData({requestId, question: "   "}), /question cannot be empty/);
assert.throws(() => validateCallableData({requestId, question: "x".repeat(2001)}), /cannot exceed 2000/);
assert.equal(validateCallableData({requestId, question: "Bills?"}).question, "Bills?");

const invoiceResponse = createPreviewResponse(summary, "overdue-invoices");
assert.match(invoiceResponse.answer, /^1 invoice is overdue/);
assert.equal(invoiceResponse.warnings.some((warning) => warning.code === "unmatched-clients"), true);
const billResponse = createPreviewResponse(summary, "bills");
assert.match(billResponse.answer, /^1 unpaid bill is due/);
const projectResponse = createPreviewResponse(summary, "project-profitability");
assert.match(projectResponse.insights[2].detail, /^0 projects require attention/);
const oneProject = {
  ...summary,
  projects: {...summary.projects, requiringAttention: [summary.projects.items[0]]},
};
assert.match(createPreviewResponse(oneProject, "project-profitability").insights[2].detail, /^1 project requires attention/);
const oneBudget = {
  ...summary,
  budgets: {...summary.budgets, exceededCount: 1, nearLimitCount: 0},
};
assert.match(createPreviewResponse(oneBudget, "budgets").answer, /^1 budget has reached/);
const unsupported = createPreviewResponse(summary, "unsupported");
assert.deepEqual(unsupported.warnings, []);

const warningSummary = {...summary, warnings: [
  {code: "collection-read-failed", area: "invoices", message: "Invoice read failed."},
  {code: "budget-note", area: "budgets", message: "Budget note."},
]};
assert.deepEqual(createPreviewResponse(warningSummary, "bills").warnings, []);
assert.equal(createPreviewResponse(warningSummary, "budgets").warnings[0].code, "budget-note");
assert.equal(createPreviewResponse(warningSummary, "cashflow").warnings[0].code, "collection-read-failed");
const manyWarnings = {
  ...summary,
  warnings: Array.from({length: 7}, (_, index) => ({
    code: index === 0 ? "collection-read-failed" : `invoice-note-${index}`,
    area: "invoices",
    message: `Invoice note ${index}.`,
  })),
};
const boundedWarnings = createPreviewResponse(manyWarnings, "overdue-invoices").warnings;
assert.equal(boundedWarnings.length, 5);
assert.equal(boundedWarnings[0].code, "collection-read-failed");
assert.equal(boundedWarnings[4].code, "additional-data-issues");

const priorities = createPreviewResponse(summary, "priorities");
assert.deepEqual(priorities.insights.map((item) => item.title), [
  "Overdue invoices",
  "Bills due soon",
  "Budgets near their limit",
]);
assert.ok(priorities.sources.every((source) => source.href.startsWith("/resources/tools/")));
const emptyPriorities = createPreviewResponse(
    summarizeBusinessData({}, {}, {now}),
    "priorities",
);
assert.equal(emptyPriorities.answer, "No urgent issues were identified from the business areas currently supported by this preview.");

console.log("AI assistant deterministic regression checks passed.");
