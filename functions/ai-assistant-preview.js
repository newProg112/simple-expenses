/* eslint-disable max-len, require-jsdoc */

"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {buildBusinessSummary} = require("./lib/business-summary");
const {countNoun, verbForCount} = require("./lib/grammar");

const REGION = "us-central1";
const MAX_QUESTION_LENGTH = 2000;
const MAX_REQUEST_ID_LENGTH = 64;
const MAX_PROJECT_ID_LENGTH = 128;
const MAX_WARNINGS = 10;
const MAX_VISIBLE_WARNINGS = 5;
const MAX_ANSWER_LENGTH = 1200;
const MAX_INSIGHTS = 10;
const MAX_FACTS = 10;
const DISCLAIMER = "Business information only. This is not accounting, tax or legal advice.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ALLOWED_REQUEST_KEYS = new Set(["requestId", "question", "scope"]);
const ALLOWED_SCOPE_KEYS = new Set([
  "dateFrom",
  "dateTo",
  "projectId",
  "openingCashBalance",
]);
const SOURCES = {
  invoices: {module: "Invoices", href: "/resources/tools/invoice-generator.html"},
  bills: {module: "Bills", href: "/resources/tools/bills.html"},
  expenses: {module: "Expenses", href: "/resources/tools/expenses.html"},
  projects: {module: "Projects", href: "/resources/tools/projects.html"},
  budgets: {module: "Budgets", href: "/resources/tools/budgets.html"},
  cashflow: {module: "Cashflow", href: "/resources/tools/cashflow.html"},
};
const WARNING_AREAS = {
  "overall-summary": new Set(["scope", "invoices", "bills", "expenses", "projects"]),
  "overdue-invoices": new Set(["scope", "invoices"]),
  "customer-balances": new Set(["scope", "invoices", "clients"]),
  "bills": new Set(["scope", "bills"]),
  "expenses": new Set(["scope", "expenses"]),
  "project-profitability": new Set(["scope", "projects", "invoices", "bills", "expenses"]),
  "budgets": new Set(["scope", "budgets", "projects", "bills", "expenses"]),
  "cashflow": new Set(["scope", "cashflow", "invoices", "bills"]),
  "priorities": new Set(["scope", "invoices", "bills", "expenses", "projects", "budgets", "cashflow"]),
  "unsupported": new Set(),
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function validateScope(value) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new HttpsError("invalid-argument", "scope must be an object when supplied.");
  }

  const unexpected = Object.keys(value).filter((key) => !ALLOWED_SCOPE_KEYS.has(key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", "scope contains unsupported fields.");
  }

  const scope = {};
  if (value.dateFrom !== undefined) {
    if (!validIsoDate(value.dateFrom)) {
      throw new HttpsError("invalid-argument", "scope.dateFrom must use YYYY-MM-DD.");
    }
    scope.dateFrom = value.dateFrom;
  }

  if (value.dateTo !== undefined) {
    if (!validIsoDate(value.dateTo)) {
      throw new HttpsError("invalid-argument", "scope.dateTo must use YYYY-MM-DD.");
    }
    scope.dateTo = value.dateTo;
  }

  if (scope.dateFrom && scope.dateTo && scope.dateFrom > scope.dateTo) {
    throw new HttpsError("invalid-argument", "scope.dateFrom cannot be after scope.dateTo.");
  }

  if (value.projectId !== undefined) {
    if (typeof value.projectId !== "string" ||
      !value.projectId || value.projectId.length > MAX_PROJECT_ID_LENGTH ||
      !PROJECT_ID_PATTERN.test(value.projectId)) {
      throw new HttpsError("invalid-argument", "scope.projectId is invalid.");
    }
    scope.projectId = value.projectId;
  }

  if (value.openingCashBalance !== undefined) {
    if (typeof value.openingCashBalance !== "number" ||
      !Number.isFinite(value.openingCashBalance) ||
      value.openingCashBalance < 0 || value.openingCashBalance > 1e12) {
      throw new HttpsError("invalid-argument", "scope.openingCashBalance must be a valid non-negative number.");
    }
    scope.openingCashBalance = value.openingCashBalance;
  }

  return scope;
}

function validateCallableData(value) {
  if (!isPlainObject(value)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }

  const unexpected = Object.keys(value).filter((key) => !ALLOWED_REQUEST_KEYS.has(key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", "Request data contains unsupported fields.");
  }

  if (typeof value.requestId !== "string" ||
    value.requestId.length > MAX_REQUEST_ID_LENGTH ||
    !UUID_PATTERN.test(value.requestId)) {
    throw new HttpsError("invalid-argument", "requestId must be a valid UUID.");
  }

  if (typeof value.question !== "string") {
    throw new HttpsError("invalid-argument", "question must be a string.");
  }

  const question = value.question.trim();
  if (!question) {
    throw new HttpsError("invalid-argument", "question cannot be empty.");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new HttpsError("resource-exhausted", `question cannot exceed ${MAX_QUESTION_LENGTH} characters.`);
  }

  return {
    requestId: value.requestId,
    question,
    scope: validateScope(value.scope),
  };
}

function normalizeQuestion(question) {
  return question.toLocaleLowerCase("en-GB")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

function containsAny(question, phrases) {
  return phrases.some((phrase) => question.includes(phrase));
}

function containsWord(question, words) {
  const questionWords = new Set(question.split(" "));
  return words.some((word) => questionWords.has(word));
}

function isObviouslyUnrelatedQuestion(question, normalized) {
  const raw = String(question || "").trim().toLocaleLowerCase("en-GB");
  if (/^(?:(?:what is|calculate|solve)\s+)?-?\d+(?:\.\d+)?\s*(?:\+|-|\*|\/|x|\u00d7|\u00f7)\s*-?\d+(?:\.\d+)?\??$/.test(raw)) {
    return true;
  }
  return containsAny(normalized, [
    "tell me a joke", "write a joke", "make a joke", "write me a poem",
    "write a poem", "write me a story", "write a story", "write a song",
    "creative writing", "write a haiku", "write a limerick",
    "give me a riddle", "quiz me", "trivia question", "who invented",
    "history of",
  ]);
}

function routeQuestion(question) {
  const normalized = normalizeQuestion(question);
  if (isObviouslyUnrelatedQuestion(question, normalized)) return "unsupported";
  const hasDataIntent = containsAny(normalized, [
    "my ", "our ", "which", "how much", "how many", "total",
    "show", "list", "compare", "this month", "last month", "this year",
    "last year", "current", "today", "doing", "performing", "status",
    "active",
  ]);

  if (containsAny(normalized, [
    "focus on today", "focus today", "priorities", "priority", "needs attention",
  ])) return "priorities";

  if (containsWord(normalized, ["customer", "customers", "client", "clients"]) &&
    containsAny(normalized, ["owe", "owes", "owing", "balance"])) {
    return "customer-balances";
  }

  if (containsWord(normalized, ["budget", "budgets"]) && (hasDataIntent || containsAny(normalized, [
    "close", "exceed", "remaining", "spent", "used", "overspend", "within",
  ]))) return "budgets";

  if (containsWord(normalized, ["project", "projects"]) &&
    (hasDataIntent || containsAny(normalized, ["profit", "profitable", "loss", "margin"]))) {
    return "project-profitability";
  }

  if ((containsWord(normalized, ["expense", "expenses", "mileage"]) ||
    containsAny(normalized, ["spending category", "expense category"])) &&
    (hasDataIntent || containsAny(normalized, ["spending", "category", "claim", "miles"]))) {
    return "expenses";
  }

  if (containsWord(normalized, ["bill", "bills", "supplier", "suppliers"]) &&
    (hasDataIntent || containsAny(normalized, ["due", "unpaid", "outstanding", "paid", "supplier"]))) {
    return "bills";
  }

  if (containsWord(normalized, ["invoice", "invoices", "invoiced", "invoicing"]) &&
    (hasDataIntent || containsAny(normalized, ["overdue", "outstanding", "unpaid", "owe", "paid", "raised"]))) {
    return "overdue-invoices";
  }

  if (containsAny(normalized, [
    "cashflow", "cash flow", "cash position", "expected receipt", "expected payment",
  ]) && (hasDataIntent || containsAny(normalized, [
    "negative", "positive", "low", "forecast", "expected", "affect",
  ]))) return "cashflow";

  if (containsAny(normalized, [
    "summarise", "summarize", "summary", "overview", "performance", "business this month",
  ]) && hasDataIntent) return "overall-summary";

  if (containsWord(normalized, ["customer", "customers", "client", "clients"]) && hasDataIntent) {
    return "customer-balances";
  }

  if (containsWord(normalized, ["business", "revenue", "profit", "margin"]) && hasDataIntent) {
    return "overall-summary";
  }

  return "unsupported";
}

function safeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Object.is(number, -0)) return 0;
  return number;
}

function boundedText(value, maximumLength) {
  return String(value === undefined || value === null ? "" : value)
      .slice(0, maximumLength);
}

function formatGbp(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeNumber(value));
}

function formatNumber(value, maximumFractionDigits) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: maximumFractionDigits === undefined ? 2 : maximumFractionDigits,
  }).format(safeNumber(value));
}

function countText(count, singular, plural) {
  return countNoun(safeNumber(count), singular, plural, (number) =>
    formatNumber(number, 0));
}

function fact(id, label, value, formattedValue) {
  return {id, label, value: safeNumber(value), formattedValue};
}

function insight(title, detail) {
  return {title, detail};
}

function selectedSources(keys) {
  return [...new Set(keys)].map((key) => SOURCES[key]).filter(Boolean);
}

function safeWarnings(summary, category) {
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  const areas = WARNING_AREAS[category] || WARNING_AREAS.unsupported;
  const relevant = warnings.filter((warning) => {
    const code = String(warning.code || "");
    if (!areas.has(String(warning.area || ""))) return false;
    if (code === "unmatched-clients") {
      return ["overall-summary", "overdue-invoices", "customer-balances"]
          .includes(category);
    }
    if (code === "unknown-project-references") {
      return ["project-profitability", "budgets", "priorities"].includes(category);
    }
    return true;
  })
      .sort((first, second) => {
        const firstSerious = /(?:read-failed|invalid-numbers)/.test(String(first.code || "")) ? 0 : 1;
        const secondSerious = /(?:read-failed|invalid-numbers)/.test(String(second.code || "")) ? 0 : 1;
        return firstSerious - secondSerious;
      });
  const hasAdditional = relevant.length > MAX_VISIBLE_WARNINGS;
  const visibleLimit = hasAdditional ? MAX_VISIBLE_WARNINGS - 1 : MAX_VISIBLE_WARNINGS;
  const visible = relevant.slice(0, visibleLimit).map((warning) => ({
    code: boundedText(warning.code || "data-warning", 80),
    area: boundedText(warning.area || "general", 80),
    message: boundedText(
        warning.message || "Some business records could not be included.",
        500,
    ),
  }));
  if (hasAdditional) {
    const additionalCount = relevant.length - visible.length;
    visible.push({
      code: "additional-data-issues",
      area: "general",
      message: `${countText(additionalCount, "additional data issue")} ${verbForCount(additionalCount, "exists", "exist")}; some may affect completeness.`,
    });
  }
  return visible.slice(0, MAX_WARNINGS);
}

function boundedResponse(response) {
  return {
    ...response,
    answer: boundedText(response.answer, MAX_ANSWER_LENGTH),
    insights: response.insights.slice(0, MAX_INSIGHTS).map((item) => ({
      title: boundedText(item.title, 160),
      detail: boundedText(item.detail, 500),
    })),
    facts: response.facts.slice(0, MAX_FACTS).map((item) => ({
      id: boundedText(item.id, 160),
      label: boundedText(item.label, 200),
      value: safeNumber(item.value),
      formattedValue: boundedText(item.formattedValue, 120),
    })),
    sources: response.sources.slice(0, Object.keys(SOURCES).length),
    warnings: response.warnings.slice(0, MAX_WARNINGS),
  };
}

function responseBase(summary, category) {
  return {
    category,
    answer: "",
    insights: [],
    facts: [],
    sources: [],
    warnings: safeWarnings(summary, category),
  };
}

function overallResponse(summary) {
  const response = responseBase(summary, "overall-summary");
  const invoices = summary.invoices;
  const bills = summary.bills;
  const expenses = summary.expenses;
  const projects = summary.projects;
  response.answer = `Simple Books currently shows ${formatGbp(invoices.outstandingValue)} in outstanding invoices, ${formatGbp(bills.outstandingValue)} in outstanding bills and ${formatGbp(expenses.grossValue)} in recorded expenses for the selected scope.`;
  response.insights = [
    insight("Outstanding invoices", `${countText(invoices.outstandingCount, "invoice")} totalling ${formatGbp(invoices.outstandingValue)}.`),
    insight("Outstanding bills", `${countText(bills.outstandingCount, "bill")} totalling ${formatGbp(bills.outstandingValue)}.`),
    insight("Project position", `Supported project figures show ${formatGbp(projects.profit)} in operational profit.`),
  ];
  response.facts = [
    fact("invoices.outstandingValue", "Outstanding invoice value", invoices.outstandingValue, formatGbp(invoices.outstandingValue)),
    fact("bills.outstandingValue", "Outstanding bill value", bills.outstandingValue, formatGbp(bills.outstandingValue)),
    fact("expenses.grossValue", "Recorded expense gross value", expenses.grossValue, formatGbp(expenses.grossValue)),
    fact("projects.profit", "Operational project profit", projects.profit, formatGbp(projects.profit)),
  ];
  response.sources = selectedSources(["invoices", "bills", "expenses", "projects"]);
  return response;
}

function invoiceResponse(summary) {
  const response = responseBase(summary, "overdue-invoices");
  const invoices = summary.invoices;
  response.answer = invoices.overdueCount === 0 ?
    "No invoices are overdue." :
    `${countText(invoices.overdueCount, "invoice")} ${verbForCount(invoices.overdueCount, "is", "are")} overdue, totalling ${formatGbp(invoices.overdueValue)}.`;
  response.insights = [
    insight("Overdue value", `${formatGbp(invoices.overdueValue)} is overdue.`),
    insight("All outstanding invoices", `${countText(invoices.outstandingCount, "invoice")} ${verbForCount(invoices.outstandingCount, "remains", "remain")} outstanding, totalling ${formatGbp(invoices.outstandingValue)}.`),
  ];
  response.facts = [
    fact("invoices.overdueCount", "Overdue invoice count", invoices.overdueCount, formatNumber(invoices.overdueCount, 0)),
    fact("invoices.overdueValue", "Overdue invoice value", invoices.overdueValue, formatGbp(invoices.overdueValue)),
    fact("invoices.outstandingCount", "Outstanding invoice count", invoices.outstandingCount, formatNumber(invoices.outstandingCount, 0)),
    fact("invoices.outstandingValue", "Outstanding invoice value", invoices.outstandingValue, formatGbp(invoices.outstandingValue)),
  ];
  response.sources = selectedSources(["invoices"]);
  return response;
}

function customerResponse(summary) {
  const response = responseBase(summary, "customer-balances");
  const customers = [...summary.invoices.largestCustomers]
      .filter((customer) => safeNumber(customer.outstandingValue) > 0)
      .sort((first, second) => safeNumber(second.outstandingValue) - safeNumber(first.outstandingValue) || first.name.localeCompare(second.name))
      .slice(0, 5);

  if (!customers.length) {
    response.answer = "No outstanding customer balances were identified from the currently included invoices.";
  } else {
    response.answer = `${customers[0].name} has the largest outstanding invoice balance at ${formatGbp(customers[0].outstandingValue)}.`;
    response.insights = customers.map((customer) => insight(
        customer.name,
        `${formatGbp(customer.outstandingValue)} outstanding across ${countText(customer.outstandingInvoiceCount === undefined ? customer.invoiceCount : customer.outstandingInvoiceCount, "invoice")}.`,
    ));
    response.facts = customers.map((customer, index) => fact(
        `invoices.customerBalances.${index + 1}`,
        `${customer.name} outstanding balance`,
        customer.outstandingValue,
        formatGbp(customer.outstandingValue),
    ));
  }
  response.sources = selectedSources(["invoices"]);
  return response;
}

function billsResponse(summary) {
  const response = responseBase(summary, "bills");
  const bills = summary.bills;
  response.answer = bills.upcomingCount === 0 ?
    "No unpaid bills are due within the next seven days." :
    `${countText(bills.upcomingCount, "unpaid bill")} ${verbForCount(bills.upcomingCount, "is", "are")} due within the next seven days, totalling ${formatGbp(bills.upcomingValue)}.`;
  response.insights = [
    insight("All unpaid bills", `${countText(bills.outstandingCount, "bill")} ${verbForCount(bills.outstandingCount, "remains", "remain")} unpaid, totalling ${formatGbp(bills.outstandingValue)}.`),
  ];
  response.facts = [
    fact("bills.upcomingCount", "Bills due soon", bills.upcomingCount, formatNumber(bills.upcomingCount, 0)),
    fact("bills.upcomingValue", "Value of bills due soon", bills.upcomingValue, formatGbp(bills.upcomingValue)),
    fact("bills.outstandingCount", "Outstanding bill count", bills.outstandingCount, formatNumber(bills.outstandingCount, 0)),
    fact("bills.outstandingValue", "Outstanding bill value", bills.outstandingValue, formatGbp(bills.outstandingValue)),
  ];
  response.sources = selectedSources(["bills"]);
  return response;
}

function previousMonth(month) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return date.toISOString().slice(0, 7);
}

function expensesResponse(summary) {
  const response = responseBase(summary, "expenses");
  const expenses = summary.expenses;
  const currentMonth = String(summary.meta.generatedAt).slice(0, 7);
  const priorMonth = previousMonth(currentMonth);
  const current = expenses.monthlyTotals.find((item) => item.month === currentMonth) || {grossValue: 0};
  const previous = expenses.monthlyTotals.find((item) => item.month === priorMonth) || {grossValue: 0};
  let direction = "the same as";
  if (safeNumber(current.grossValue) > safeNumber(previous.grossValue)) direction = "higher than";
  else if (safeNumber(current.grossValue) < safeNumber(previous.grossValue)) direction = "lower than";

  response.answer = `Recorded gross expenses for ${currentMonth} are ${formatGbp(current.grossValue)}, which is ${direction} ${priorMonth}'s ${formatGbp(previous.grossValue)}.`;
  response.insights = [
    insight("Current month", `${currentMonth} recorded expenses total ${formatGbp(current.grossValue)}.`),
    insight("Previous month", `${priorMonth} recorded expenses total ${formatGbp(previous.grossValue)}.`),
  ];
  if (expenses.categoryTotals.length) {
    const category = expenses.categoryTotals[0];
    response.insights.push(insight("Largest expense category", `${category.category} is the largest category at ${formatGbp(category.grossValue)}.`));
  }
  response.facts = [
    fact(`expenses.monthlyTotals.${currentMonth}`, `${currentMonth} gross expenses`, current.grossValue, formatGbp(current.grossValue)),
    fact(`expenses.monthlyTotals.${priorMonth}`, `${priorMonth} gross expenses`, previous.grossValue, formatGbp(previous.grossValue)),
    fact("expenses.grossValue", "Gross expenses in selected scope", expenses.grossValue, formatGbp(expenses.grossValue)),
    fact("expenses.mileage.amount", "Mileage claim amount", expenses.mileage.amount, formatGbp(expenses.mileage.amount)),
  ];
  response.sources = selectedSources(["expenses"]);
  return response;
}

function projectsResponse(summary) {
  const response = responseBase(summary, "project-profitability");
  const projects = summary.projects;
  const lowest = projects.lowestProfit;
  if (!lowest) {
    response.answer = "No project revenue or cost figures are currently available for the selected scope.";
  } else {
    response.answer = `${lowest.name} has the lowest supported operational project profit at ${formatGbp(lowest.profit)}, with a margin of ${formatNumber(lowest.marginPercent)}%.`;
    response.insights = [
      insight("Lowest project profit", `${lowest.name}: ${formatGbp(lowest.profit)}.`),
      insight("Project margin", `${lowest.name}: ${formatNumber(lowest.marginPercent)}%.`),
      insight("Projects requiring attention", `${countText(projects.requiringAttention.length, "project")} ${verbForCount(projects.requiringAttention.length, "requires", "require")} attention under the current rules.`),
    ];
    response.facts = [
      fact("projects.lowestProfit.profit", "Lowest project profit", lowest.profit, formatGbp(lowest.profit)),
      fact("projects.lowestProfit.marginPercent", "Lowest-profit project margin", lowest.marginPercent, `${formatNumber(lowest.marginPercent)}%`),
      fact("projects.requiringAttention.count", "Projects requiring attention", projects.requiringAttention.length, formatNumber(projects.requiringAttention.length, 0)),
    ];
  }
  response.sources = selectedSources(["projects"]);
  return response;
}

function budgetsResponse(summary) {
  const response = responseBase(summary, "budgets");
  const budgets = summary.budgets;
  response.answer = budgets.exceededCount === 0 && budgets.nearLimitCount === 0 ?
    "No budgets are close to or above their planned limits." :
    `${countText(budgets.exceededCount, "budget")} ${verbForCount(budgets.exceededCount, "has", "have")} reached or exceeded the planned amount; ${countText(budgets.nearLimitCount, "budget")} ${verbForCount(budgets.nearLimitCount, "is", "are")} near the limit.`;
  response.insights = [
    insight("Exceeded budgets", `${countText(budgets.exceededCount, "budget")} ${verbForCount(budgets.exceededCount, "has", "have")} used at least 100% of the planned amount.`),
    insight("Near-limit budgets", `${countText(budgets.nearLimitCount, "budget")} ${verbForCount(budgets.nearLimitCount, "is", "are")} between 80% and 100% used.`),
    insight("Overall budget position", `${formatGbp(budgets.actualValue)} actual against ${formatGbp(budgets.plannedValue)} planned.`),
  ];
  if (budgets.topOverspends.length) {
    const top = budgets.topOverspends[0];
    response.insights.push(insight("Largest overspend", `${top.name} is over its planned amount by ${formatGbp(top.overspend)}.`));
  }
  response.facts = [
    fact("budgets.exceededCount", "Exceeded budget count", budgets.exceededCount, formatNumber(budgets.exceededCount, 0)),
    fact("budgets.nearLimitCount", "Near-limit budget count", budgets.nearLimitCount, formatNumber(budgets.nearLimitCount, 0)),
    fact("budgets.plannedValue", "Total planned budget", budgets.plannedValue, formatGbp(budgets.plannedValue)),
    fact("budgets.actualValue", "Total budget actual", budgets.actualValue, formatGbp(budgets.actualValue)),
  ];
  response.sources = selectedSources(["budgets"]);
  return response;
}

function cashflowResponse(summary) {
  const response = responseBase(summary, "cashflow");
  const cashflow = summary.cashflow;
  response.answer = `The forecast includes ${formatGbp(cashflow.expectedReceipts)} in receipts and ${formatGbp(cashflow.expectedPayments)} in payments, giving a closing balance of ${formatGbp(cashflow.closingBalance)}.`;
  response.insights = [
    insight("Expected receipts", `${countText(cashflow.expectedReceiptCount, "receipt")} ${verbForCount(cashflow.expectedReceiptCount, "totals", "total")} ${formatGbp(cashflow.expectedReceipts)}.`),
    insight("Expected payments", `${countText(cashflow.expectedPaymentCount, "payment")} ${verbForCount(cashflow.expectedPaymentCount, "totals", "total")} ${formatGbp(cashflow.expectedPayments)}.`),
    insight("Lowest forecast balance", `${formatGbp(cashflow.lowestBalance)} on ${cashflow.lowestBalanceDate}.`),
  ];
  response.facts = [
    fact("cashflow.expectedReceipts", "Expected receipts", cashflow.expectedReceipts, formatGbp(cashflow.expectedReceipts)),
    fact("cashflow.expectedPayments", "Expected payments", cashflow.expectedPayments, formatGbp(cashflow.expectedPayments)),
    fact("cashflow.closingBalance", "Forecast closing balance", cashflow.closingBalance, formatGbp(cashflow.closingBalance)),
    fact("cashflow.lowestBalance", "Lowest forecast balance", cashflow.lowestBalance, formatGbp(cashflow.lowestBalance)),
  ];
  response.sources = selectedSources(["cashflow", "invoices", "bills"]);
  return response;
}

function prioritiesResponse(summary) {
  const response = responseBase(summary, "priorities");
  const priorities = [];
  const facts = [];
  const sources = [];

  if (summary.budgets.exceededCount > 0) {
    priorities.push(insight("Exceeded budgets", `${countText(summary.budgets.exceededCount, "budget")} ${verbForCount(summary.budgets.exceededCount, "has", "have")} reached or exceeded the planned amount.`));
    facts.push(fact("budgets.exceededCount", "Exceeded budget count", summary.budgets.exceededCount, formatNumber(summary.budgets.exceededCount, 0)));
    sources.push("budgets");
  }
  if (summary.cashflow.closingBalance < 0) {
    priorities.push(insight("Negative forecast balance", `The closing scenario balance is ${formatGbp(summary.cashflow.closingBalance)}.`));
    facts.push(fact("cashflow.closingBalance", "Forecast closing balance", summary.cashflow.closingBalance, formatGbp(summary.cashflow.closingBalance)));
    sources.push("cashflow");
  }
  if (summary.invoices.overdueCount > 0) {
    priorities.push(insight("Overdue invoices", `${countText(summary.invoices.overdueCount, "invoice")} ${verbForCount(summary.invoices.overdueCount, "is", "are")} overdue, totalling ${formatGbp(summary.invoices.overdueValue)}.`));
    facts.push(fact("invoices.overdueValue", "Overdue invoice value", summary.invoices.overdueValue, formatGbp(summary.invoices.overdueValue)));
    sources.push("invoices");
  }
  if (summary.bills.upcomingCount > 0) {
    priorities.push(insight("Bills due soon", `${countText(summary.bills.upcomingCount, "bill")} ${verbForCount(summary.bills.upcomingCount, "is", "are")} due within seven days, totalling ${formatGbp(summary.bills.upcomingValue)}.`));
    facts.push(fact("bills.upcomingValue", "Bills due soon value", summary.bills.upcomingValue, formatGbp(summary.bills.upcomingValue)));
    sources.push("bills");
  }
  if (summary.projects.requiringAttention.length > 0) {
    priorities.push(insight("Projects requiring attention", `${countText(summary.projects.requiringAttention.length, "project")} ${verbForCount(summary.projects.requiringAttention.length, "requires", "require")} attention under the current rules.`));
    facts.push(fact("projects.requiringAttention.count", "Projects requiring attention", summary.projects.requiringAttention.length, formatNumber(summary.projects.requiringAttention.length, 0)));
    sources.push("projects");
  }
  if (summary.budgets.nearLimitCount > 0) {
    priorities.push(insight("Budgets near their limit", `${countText(summary.budgets.nearLimitCount, "budget")} ${verbForCount(summary.budgets.nearLimitCount, "is", "are")} between 80% and 100% used.`));
    facts.push(fact("budgets.nearLimitCount", "Near-limit budget count", summary.budgets.nearLimitCount, formatNumber(summary.budgets.nearLimitCount, 0)));
    sources.push("budgets");
  }
  if (response.warnings.length > 0) {
    priorities.push(insight("Data quality", `${countText(response.warnings.length, "warning")} may affect the supported figures.`));
  }

  response.answer = priorities.length ?
    `${countText(priorities.length, "item")} ${verbForCount(priorities.length, "needs", "need")} your attention, shown in priority order.` :
    "No urgent issues were identified from the business areas currently supported by this preview.";
  response.insights = priorities.slice(0, 7);
  response.facts = facts.slice(0, 7);
  response.sources = selectedSources(sources);
  return response;
}

function unsupportedResponse(summary) {
  const response = responseBase(summary, "unsupported");
  response.answer = "I can currently provide deterministic previews about invoices, bills, expenses, projects, budgets and cashflow. Try one of the suggested questions.";
  return response;
}

function createPreviewResponse(summary, category) {
  const generators = {
    "overall-summary": overallResponse,
    "overdue-invoices": invoiceResponse,
    "customer-balances": customerResponse,
    "bills": billsResponse,
    "expenses": expensesResponse,
    "project-profitability": projectsResponse,
    "budgets": budgetsResponse,
    "cashflow": cashflowResponse,
    "priorities": prioritiesResponse,
    "unsupported": unsupportedResponse,
  };
  return boundedResponse((generators[category] || unsupportedResponse)(summary));
}

async function handlePreviewRequest(request, dependencies) {
  if (!request || !request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use the business assistant preview.");
  }

  const validated = validateCallableData(request.data);
  const category = routeQuestion(validated.question);
  const suppliedDependencies = dependencies || {};
  const summaryBuilder = suppliedDependencies.buildBusinessSummary || buildBusinessSummary;
  const firestore = suppliedDependencies.firestore || admin.firestore();

  try {
    const summary = await summaryBuilder(
        firestore,
        request.auth.uid,
        validated.scope,
        {now: new Date()},
    );
    const preview = createPreviewResponse(summary, category);

    logger.info("Business assistant preview completed", {
      requestId: validated.requestId.slice(0, 12),
      category,
      warningCount: preview.warnings.length,
    });

    return {
      success: true,
      mode: "deterministic-preview",
      requestId: validated.requestId,
      ...preview,
      disclaimer: DISCLAIMER,
      dataAsOf: summary.meta.generatedAt,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("Business assistant preview failed", {
      requestId: validated.requestId.slice(0, 12),
      category,
      errorCode: error && error.code ? String(error.code) : "summary-failed",
    });
    throw new HttpsError(
        "unavailable",
        "The secure business-summary service is currently unavailable.",
    );
  }
}

const askBusinessAssistantPreview = onCall(
    {
      region: REGION,
      maxInstances: 5,
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    (request) => handlePreviewRequest(request),
);

module.exports = {
  askBusinessAssistantPreview,
  createPreviewResponse,
  handlePreviewRequest,
  routeQuestion,
  validateCallableData,
};
