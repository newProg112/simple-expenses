/* eslint-disable max-len, require-jsdoc */

"use strict";

const assert = require("node:assert/strict");
const {summarizeBusinessData} = require("../lib/business-summary");
const {
  DEFAULT_OPENAI_MODEL,
  SYSTEM_PROMPT,
  buildOpenAIRequest,
  configuredModel,
  finite,
  sanitizeBusinessSummary,
} = require("../lib/assistant-prompt");
const {
  cleanAiAnswer,
  handleAssistantRequest,
  providerErrorDetails,
} = require("../ai-assistant");

const now = new Date("2026-07-19T12:00:00.000Z");
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const summary = summarizeBusinessData({
  clients: [{id: "client-internal-id", name: "Acme owner@example.com"}],
  invoices: [{
    id: "invoice-internal-id",
    status: "Unpaid",
    total: 120,
    date: "2026-07-01",
    dueDate: "2026-07-10",
    client: "Acme owner@example.com",
    projectId: "project-internal-id",
    attachmentUrl: "https://storage.example.test/invoice.pdf",
  }],
  bills: [{
    id: "bill-internal-id",
    status: "Unpaid",
    total: 50,
    billDate: "2026-07-01",
    dueDate: "2026-07-26",
    projectId: "project-internal-id",
  }],
  expenses: [{
    id: "expense-internal-id",
    type: "expense",
    date: "2026-07-03",
    gross: 24,
    category: "Software",
    projectId: "project-internal-id",
  }],
  projects: [{
    id: "project-internal-id",
    name: "Website project",
    reference: "PRIVATE-REF",
    status: "Active",
    budget: 500,
  }],
  budgets: [{
    id: "budget-internal-id",
    name: "Monthly budget",
    budgetType: "overall",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    plannedAmount: 300,
    projectId: "project-internal-id",
  }],
  profile: {
    businessName: "Private business",
    email: "private@example.com",
  },
}, {}, {now});

summary.uid = "uid-must-not-leak";
summary.firestorePath = "users/uid-must-not-leak/invoices";
summary.attachments = [{url: "https://storage.example.test/file"}];
summary.warnings.push({
  code: "test-warning",
  area: "invoices",
  count: 1,
  message: "Contact private@example.com at https://storage.example.test/file",
});

const categories = [
  "overdue-invoices", "customer-balances", "bills", "expenses",
  "project-profitability", "budgets", "cashflow", "priorities",
  "overall-summary", "unsupported",
];
categories.forEach((category) => {
  const serialized = JSON.stringify(sanitizeBusinessSummary(summary, category));
  assert.equal(serialized.includes("uid-must-not-leak"), false);
  assert.equal(serialized.includes("invoice-internal-id"), false);
  assert.equal(serialized.includes("project-internal-id"), false);
  assert.equal(serialized.includes("PRIVATE-REF"), false);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("owner@example.com"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("attachment"), false);
  assert.equal(serialized.includes("firestorePath"), false);
  assert.equal(serialized.includes("projectId"), false);
  assert.equal(serialized.includes("budgetId"), false);
});

const invoiceSummary = sanitizeBusinessSummary(summary, "overdue-invoices");
assert.equal(invoiceSummary.invoices.overdueValue, 120);
assert.equal(Object.hasOwn(invoiceSummary, "projects"), false);
const projectSummary = sanitizeBusinessSummary(summary, "project-profitability");
assert.equal(projectSummary.projects.highestProfit.name, "Website project");
assert.equal(Object.hasOwn(projectSummary, "invoices"), false);
const unsupportedSummary = sanitizeBusinessSummary(summary, "unsupported");
assert.deepEqual(Object.keys(unsupportedSummary), ["meta", "supportedAreas"]);
assert.equal(Object.hasOwn(unsupportedSummary.meta, "includedRecordCounts"), false);

assert.equal(finite(null), null);
assert.equal(finite(undefined), null);
assert.equal(finite(""), null);
assert.equal(finite("  \t"), null);
assert.equal(finite("12.50"), 12.5);
assert.equal(finite(-3), -3);
assert.equal(finite(true), null);
assert.equal(finite({valueOf: () => 12}), null);
assert.equal(finite("not-a-number"), null);
assert.equal(finite(Infinity), null);
const missingNumbers = sanitizeBusinessSummary({
  meta: {},
  invoices: {overdueValue: " ", overdueCount: "invalid"},
}, "overdue-invoices");
assert.equal(missingNumbers.invoices.overdueValue, null);
assert.equal(missingNumbers.invoices.overdueCount, null);

assert.equal(configuredModel({}), DEFAULT_OPENAI_MODEL);
assert.equal(configuredModel({OPENAI_MODEL: "gpt-test-model"}), "gpt-test-model");
assert.match(SYSTEM_PROMPT, /only source of business facts and numbers/);
assert.match(SYSTEM_PROMPT, /Do not provide accounting, tax or legal advice/);
assert.match(SYSTEM_PROMPT, /Answer only the user's question/);
assert.match(SYSTEM_PROMPT, /Do not infer causation/);
assert.match(SYSTEM_PROMPT, /do not repeat every supplied figure/i);
assert.match(SYSTEM_PROMPT, /Keep the answer concise/);

const providerRequest = buildOpenAIRequest(
    summary,
    "Which invoices are overdue? Email owner@example.com",
    "overdue-invoices",
    {},
);
const providerPayload = JSON.stringify(providerRequest);
assert.equal(providerRequest.model, DEFAULT_OPENAI_MODEL);
assert.equal(providerRequest.store, false);
assert.equal(providerRequest.reasoning.effort, "low");
assert.equal(providerRequest.max_output_tokens, 500);
assert.equal(Object.hasOwn(providerRequest, "tools"), false);
assert.equal(Object.hasOwn(providerRequest, "stream"), false);
assert.equal(providerPayload.includes("owner@example.com"), false);
assert.equal(providerPayload.includes("uid-must-not-leak"), false);
assert.equal(providerPayload.includes("https://storage"), false);
assert.equal(providerPayload.includes("\"projects\""), false);

const repeated = (item, count) => Array.from({length: count}, () => item);
const expandedSummary = {
  ...summary,
  invoices: {
    ...summary.invoices,
    monthlyTotals: repeated(summary.invoices.monthlyTotals[0], 24),
    largestCustomers: repeated(summary.invoices.largestCustomers[0], 50),
  },
  bills: {
    ...summary.bills,
    supplierTotals: repeated(summary.bills.supplierTotals[0], 50),
    monthlyTotals: repeated(summary.bills.monthlyTotals[0], 24),
  },
  expenses: {
    ...summary.expenses,
    categoryTotals: repeated(summary.expenses.categoryTotals[0], 50),
    monthlyTotals: repeated(summary.expenses.monthlyTotals[0], 24),
  },
  projects: {
    ...summary.projects,
    items: repeated(summary.projects.items[0], 50),
    requiringAttention: repeated(summary.projects.items[0], 50),
  },
  budgets: {
    ...summary.budgets,
    items: repeated(summary.budgets.items[0], 50),
    topOverspends: repeated(summary.budgets.items[0], 50),
  },
  cashflow: {
    ...summary.cashflow,
    runningBalance: repeated(summary.cashflow.runningBalance[0], 100),
  },
};
const fullLength = JSON.stringify(expandedSummary).length;
const payloadLengths = Object.fromEntries(categories.map((category) => [
  category,
  JSON.stringify(sanitizeBusinessSummary(expandedSummary, category)).length,
]));
categories.forEach((category) => {
  assert.ok(payloadLengths[category] < fullLength * 0.4);
});

assert.equal(cleanAiAnswer("Short answer."), "Short answer.");
const sentenceBounded = cleanAiAnswer(`${"A".repeat(750)}. ${"word ".repeat(150)}`);
assert.ok(sentenceBounded.endsWith("."));
assert.ok(sentenceBounded.length <= 1200);
const wordBounded = cleanAiAnswer("word ".repeat(400));
assert.ok(wordBounded.endsWith("…"));
assert.ok(wordBounded.length <= 1200);
assert.equal(wordBounded.endsWith("d…"), true);
assert.deepEqual(providerErrorDetails({name: "RateLimitError", status: 429, body: "private"}), {
  errorName: "RateLimitError",
  providerStatus: 429,
});

const callableRequest = {
  auth: {uid: "authenticated-uid-never-sent"},
  data: {
    requestId,
    question: "Which invoices are overdue?",
    scope: {},
  },
};
const silentLogger = {error() {}, info() {}, warn() {}};

async function run() {
  let capturedRequest = null;
  const aiResponse = await handleAssistantRequest(callableRequest, {
    firestore: {},
    now,
    buildBusinessSummary: async () => summary,
    openaiClient: {
      responses: {
        create: async (request) => {
          capturedRequest = request;
          return {output_text: "One invoice is overdue, totalling £120.00."};
        },
      },
    },
    environment: {},
    logger: silentLogger,
  });

  assert.equal(aiResponse.success, true);
  assert.equal(aiResponse.mode, "ai");
  assert.equal(aiResponse.answer, "One invoice is overdue, totalling £120.00.");
  assert.equal(aiResponse.category, "overdue-invoices");
  assert.equal(aiResponse.sources[0].module, "Invoices");
  assert.equal(JSON.stringify(capturedRequest).includes("authenticated-uid-never-sent"), false);
  assert.equal(JSON.stringify(capturedRequest).includes("invoice-internal-id"), false);

  let fallbackLog = null;
  const fallback = await handleAssistantRequest(callableRequest, {
    firestore: {},
    now,
    buildBusinessSummary: async () => summary,
    openaiClient: {
      responses: {
        create: async () => {
          const error = new Error("Provider details must not escape");
          error.name = "ProviderError";
          error.status = 503;
          error.response = {body: "private provider response"};
          throw error;
        },
      },
    },
    environment: {},
    logger: {
      ...silentLogger,
      warn: (message, details) => {
        fallbackLog = {message, details};
      },
    },
  });

  assert.equal(fallback.success, true);
  assert.equal(fallback.mode, "deterministic-fallback");
  assert.match(fallback.answer, /^1 invoice is overdue/);
  assert.equal(JSON.stringify(fallback).includes("Provider details"), false);
  assert.deepEqual(fallbackLog.details, {
    errorName: "ProviderError",
    providerStatus: 503,
  });
  assert.equal(JSON.stringify(fallbackLog).includes("private provider response"), false);

  await assert.rejects(
      handleAssistantRequest({data: callableRequest.data}, {}),
      (error) => error.code === "unauthenticated" && !String(error.message).includes("Firebase"),
  );

  await assert.rejects(
      handleAssistantRequest(callableRequest, {
        firestore: {},
        logger: silentLogger,
        buildBusinessSummary: async () => {
          throw new Error("users/private/path");
        },
      }),
      (error) => error.code === "unavailable" && !String(error.message).includes("users/private/path"),
  );

  console.log("Category payload sample (full source summary " + fullLength + " chars): " +
    JSON.stringify(payloadLengths));
  console.log("AI assistant provider and fallback checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
