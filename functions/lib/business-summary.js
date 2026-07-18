/* eslint-disable max-len, require-jsdoc */

"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CASHFLOW_DAYS = 90;
const UPCOMING_BILL_DAYS = 7;
const COLLECTION_FIELDS = {
  invoices: [
    "status", "total", "amount", "vat", "date", "invoiceDate",
    "createdAt", "dueDate", "client", "customerName", "projectId",
  ],
  bills: [
    "status", "total", "net", "vat", "billDate", "createdAt",
    "dueDate", "supplier", "projectId",
  ],
  expenses: [
    "type", "date", "createdAt", "net", "netAmount", "vat",
    "vatAmount", "vatRate", "gross", "grossAmount", "total", "amount",
    "mileageAmount", "miles", "ratePerMile", "mileageRate", "category",
    "projectId",
  ],
  projects: ["name", "reference", "status", "budget", "endDate"],
  budgets: [
    "name", "status", "budgetType", "category", "projectId", "startDate",
    "endDate", "plannedAmount",
  ],
  clients: ["name"],
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(record, fields) {
  for (const field of fields) {
    const value = finiteNumber(record[field]);
    if (value !== null) return value;
  }

  return null;
}

function sumFinite(first, second) {
  const firstValue = finiteNumber(first);
  const secondValue = finiteNumber(second);
  if (firstValue === null || secondValue === null) return null;
  return firstValue + secondValue;
}

function roundCurrency(value) {
  const number = finiteNumber(value);
  return Number((number === null ? 0 : number).toFixed(2));
}

function roundMetric(value, places) {
  const number = finiteNumber(value);
  return Number((number === null ? 0 : number).toFixed(places));
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
  ));
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : startOfUtcDay(value);
  }

  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return parseDate(value.toDate());
      } catch (error) {
        return null;
      }
    }

    if (typeof value.seconds === "number") {
      return parseDate(new Date(value.seconds * 1000));
    }
  }

  const text = String(value).trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
    ));
    return date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3]) ? date : null;
  }

  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    return parseDate(`${match[3]}-${match[2]}-${match[1]}`);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return date ? date.toISOString().slice(0, 7) : "";
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS));
}

function recordDate(record, fields) {
  for (const field of fields) {
    if (record[field]) return parseDate(record[field]);
  }
  return null;
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-GB");
}

function displayName(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function isPaid(record) {
  return String(record.status || "Unpaid").trim().toLowerCase() === "paid";
}

function invoiceValue(record) {
  const total = firstFinite(record, ["total"]);
  if (total !== null) return total;
  return sumFinite(record.amount, record.vat) || 0;
}

function billValue(record) {
  const total = firstFinite(record, ["total"]);
  if (total !== null) return total;
  return sumFinite(record.net, record.vat) || 0;
}

function expenseNet(record) {
  return firstFinite(record, ["net", "netAmount"]) || 0;
}

function expenseVat(record) {
  const stored = firstFinite(record, ["vat", "vatAmount"]);
  if (stored !== null) return stored;
  const net = expenseNet(record);
  const rate = firstFinite(record, ["vatRate"]);
  return rate === null ? 0 : net * rate;
}

function expenseGross(record) {
  const gross = firstFinite(record, ["gross", "grossAmount", "total"]);
  if (gross !== null) return gross;
  return expenseNet(record) + expenseVat(record);
}

function mileageValue(record) {
  const amount = firstFinite(record, ["amount", "mileageAmount", "gross"]);
  if (amount !== null) return amount;
  const miles = firstFinite(record, ["miles"]);
  const rate = firstFinite(record, ["ratePerMile", "mileageRate"]);
  return miles === null || rate === null ? 0 : miles * rate;
}

function hasInvalidNumber(record, fields) {
  return fields.some((field) => record[field] !== undefined &&
    record[field] !== null && record[field] !== "" &&
    finiteNumber(record[field]) === null);
}

function createWarning(code, area, count, message) {
  return {code, area, count, message};
}

function normalizeScope(scope, now, warnings) {
  const supplied = scope && typeof scope === "object" ? scope : {};
  const dateFrom = supplied.dateFrom ? parseDate(supplied.dateFrom) : null;
  const dateTo = supplied.dateTo ? parseDate(supplied.dateTo) : null;

  if (supplied.dateFrom && !dateFrom) {
    warnings.push(createWarning(
        "invalid-scope-date-from",
        "scope",
        1,
        "The supplied dateFrom value was invalid and was ignored.",
    ));
  }

  if (supplied.dateTo && !dateTo) {
    warnings.push(createWarning(
        "invalid-scope-date-to",
        "scope",
        1,
        "The supplied dateTo value was invalid and was ignored.",
    ));
  }

  let normalizedFrom = dateFrom;
  let normalizedTo = dateTo;
  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    warnings.push(createWarning(
        "reversed-scope-dates",
        "scope",
        1,
        "dateFrom was after dateTo, so the two scope dates were swapped.",
    ));
    const temporary = normalizedFrom;
    normalizedFrom = normalizedTo;
    normalizedTo = temporary;
  }

  const openingValue = finiteNumber(supplied.openingCashBalance);
  let openingCashBalance = 0;
  if (supplied.openingCashBalance !== undefined) {
    if (openingValue === null || openingValue < 0) {
      warnings.push(createWarning(
          "invalid-opening-balance",
          "cashflow",
          1,
          "The opening cash balance was invalid, so zero was used.",
      ));
    } else {
      openingCashBalance = openingValue;
    }
  }

  return {
    dateFrom: normalizedFrom,
    dateTo: normalizedTo,
    projectId: String(supplied.projectId || ""),
    openingCashBalance,
    openingBalanceSupplied: supplied.openingCashBalance !== undefined,
    now: startOfUtcDay(now),
  };
}

function matchesProject(record, scope) {
  return !scope.projectId || String(record.projectId || "") === scope.projectId;
}

function inDateScope(date, scope) {
  if (!date) return !scope.dateFrom && !scope.dateTo;
  if (scope.dateFrom && date < scope.dateFrom) return false;
  if (scope.dateTo && date > scope.dateTo) return false;
  return true;
}

function filterRecords(records, fields, scope) {
  return records.filter((record) => matchesProject(record, scope) &&
    inDateScope(recordDate(record, fields), scope));
}

function sortedMonthly(map, mapper) {
  return Array.from(map.entries())
      .sort((first, second) => first[0].localeCompare(second[0]))
      .map(([month, value]) => mapper(month, value));
}

function summarizeInvoices(records, clients, scope, warnings) {
  const today = scope.now;
  const paid = records.filter(isPaid);
  const outstanding = records.filter((record) => !isPaid(record));
  const overdue = outstanding.filter((record) => {
    const dueDate = parseDate(record.dueDate);
    return dueDate && dueDate < today;
  });
  const monthly = new Map();
  const customers = new Map();
  const knownClients = new Set(clients.map((client) => normalizeName(client.name)).filter(Boolean));
  const unmatchedClients = new Set();

  records.forEach((invoice) => {
    const value = invoiceValue(invoice);
    const date = recordDate(invoice, ["date", "invoiceDate", "createdAt"]);
    const month = monthKey(date);
    if (month) {
      const current = monthly.get(month) || {raisedCount: 0, raisedValue: 0, paidValue: 0, outstandingValue: 0};
      current.raisedCount += 1;
      current.raisedValue += value;
      if (isPaid(invoice)) current.paidValue += value;
      else current.outstandingValue += value;
      monthly.set(month, current);
    }

    const name = displayName(invoice.client || invoice.customerName, "Unknown customer");
    const key = normalizeName(name) || "unknown customer";
    const customer = customers.get(key) || {name, invoiceCount: 0, raisedValue: 0, outstandingValue: 0};
    customer.invoiceCount += 1;
    customer.raisedValue += value;
    if (!isPaid(invoice)) customer.outstandingValue += value;
    customers.set(key, customer);

    if (key !== "unknown customer" && !knownClients.has(key)) unmatchedClients.add(name);
  });

  if (unmatchedClients.size) {
    warnings.push(createWarning(
        "unmatched-clients",
        "invoices",
        unmatchedClients.size,
        `${unmatchedClients.size} invoice customer name(s) did not match a saved client by name.`,
    ));
  }

  const ageing = {
    notYetDue: {count: 0, value: 0},
    days1To30: {count: 0, value: 0},
    days31To60: {count: 0, value: 0},
    days61Plus: {count: 0, value: 0},
    missingDueDate: {count: 0, value: 0},
  };

  outstanding.forEach((invoice) => {
    const value = invoiceValue(invoice);
    const dueDate = parseDate(invoice.dueDate);
    let bucket = "notYetDue";
    if (!dueDate) bucket = "missingDueDate";
    else {
      const daysOverdue = Math.floor((today - dueDate) / DAY_MS);
      if (daysOverdue > 60) bucket = "days61Plus";
      else if (daysOverdue > 30) bucket = "days31To60";
      else if (daysOverdue > 0) bucket = "days1To30";
    }
    ageing[bucket].count += 1;
    ageing[bucket].value += value;
  });

  Object.values(ageing).forEach((bucket) => {
    bucket.value = roundCurrency(bucket.value);
  });

  return {
    raisedCount: records.length,
    raisedValue: roundCurrency(records.reduce((sum, record) => sum + invoiceValue(record), 0)),
    paidCount: paid.length,
    paidValue: roundCurrency(paid.reduce((sum, record) => sum + invoiceValue(record), 0)),
    outstandingCount: outstanding.length,
    outstandingValue: roundCurrency(outstanding.reduce((sum, record) => sum + invoiceValue(record), 0)),
    overdueCount: overdue.length,
    overdueValue: roundCurrency(overdue.reduce((sum, record) => sum + invoiceValue(record), 0)),
    monthlyTotals: sortedMonthly(monthly, (month, value) => ({
      month,
      raisedCount: value.raisedCount,
      raisedValue: roundCurrency(value.raisedValue),
      paidValue: roundCurrency(value.paidValue),
      outstandingValue: roundCurrency(value.outstandingValue),
    })),
    largestCustomers: Array.from(customers.values())
        .map((customer) => ({
          name: customer.name,
          invoiceCount: customer.invoiceCount,
          raisedValue: roundCurrency(customer.raisedValue),
          outstandingValue: roundCurrency(customer.outstandingValue),
        }))
        .sort((first, second) => second.raisedValue - first.raisedValue || first.name.localeCompare(second.name))
        .slice(0, 10),
    ageingBuckets: ageing,
  };
}

function summarizeBills(records, scope) {
  const today = scope.now;
  const upcomingEnd = addUtcDays(today, UPCOMING_BILL_DAYS);
  const paid = records.filter(isPaid);
  const outstanding = records.filter((record) => !isPaid(record));
  const upcoming = outstanding.filter((record) => {
    const dueDate = parseDate(record.dueDate);
    return dueDate && dueDate >= today && dueDate <= upcomingEnd;
  });
  const suppliers = new Map();
  const monthly = new Map();

  records.forEach((bill) => {
    const value = billValue(bill);
    const supplierName = displayName(bill.supplier, "Unknown supplier");
    const supplierKey = normalizeName(supplierName) || "unknown supplier";
    const supplier = suppliers.get(supplierKey) || {supplier: supplierName, billCount: 0, totalValue: 0, outstandingValue: 0};
    supplier.billCount += 1;
    supplier.totalValue += value;
    if (!isPaid(bill)) supplier.outstandingValue += value;
    suppliers.set(supplierKey, supplier);

    const month = monthKey(recordDate(bill, ["billDate", "createdAt"]));
    if (month) {
      const current = monthly.get(month) || {billCount: 0, totalValue: 0, paidValue: 0, outstandingValue: 0};
      current.billCount += 1;
      current.totalValue += value;
      if (isPaid(bill)) current.paidValue += value;
      else current.outstandingValue += value;
      monthly.set(month, current);
    }
  });

  return {
    billCount: records.length,
    totalValue: roundCurrency(records.reduce((sum, bill) => sum + billValue(bill), 0)),
    outstandingCount: outstanding.length,
    outstandingValue: roundCurrency(outstanding.reduce((sum, bill) => sum + billValue(bill), 0)),
    paidCount: paid.length,
    paidValue: roundCurrency(paid.reduce((sum, bill) => sum + billValue(bill), 0)),
    upcomingCount: upcoming.length,
    upcomingValue: roundCurrency(upcoming.reduce((sum, bill) => sum + billValue(bill), 0)),
    upcomingWindowDays: UPCOMING_BILL_DAYS,
    supplierTotals: Array.from(suppliers.values())
        .map((supplier) => ({
          supplier: supplier.supplier,
          billCount: supplier.billCount,
          totalValue: roundCurrency(supplier.totalValue),
          outstandingValue: roundCurrency(supplier.outstandingValue),
        }))
        .sort((first, second) => second.totalValue - first.totalValue || first.supplier.localeCompare(second.supplier)),
    monthlyTotals: sortedMonthly(monthly, (month, value) => ({
      month,
      billCount: value.billCount,
      totalValue: roundCurrency(value.totalValue),
      paidValue: roundCurrency(value.paidValue),
      outstandingValue: roundCurrency(value.outstandingValue),
    })),
  };
}

function summarizeExpenses(records) {
  const expenseRecords = records.filter((record) => record.type !== "mileage");
  const mileageRecords = records.filter((record) => record.type === "mileage");
  const categories = new Map();
  const monthly = new Map();

  expenseRecords.forEach((expense) => {
    const net = expenseNet(expense);
    const vat = expenseVat(expense);
    const gross = expenseGross(expense);
    const categoryName = displayName(expense.category, "General");
    const categoryKey = normalizeName(categoryName) || "general";
    const category = categories.get(categoryKey) || {category: categoryName, count: 0, net: 0, vat: 0, gross: 0};
    category.count += 1;
    category.net += net;
    category.vat += vat;
    category.gross += gross;
    categories.set(categoryKey, category);

    const month = monthKey(recordDate(expense, ["date", "createdAt"]));
    if (month) {
      const current = monthly.get(month) || {expenseCount: 0, net: 0, vat: 0, gross: 0, mileageAmount: 0, mileageMiles: 0};
      current.expenseCount += 1;
      current.net += net;
      current.vat += vat;
      current.gross += gross;
      monthly.set(month, current);
    }
  });

  mileageRecords.forEach((mileage) => {
    const month = monthKey(recordDate(mileage, ["date", "createdAt"]));
    if (!month) return;
    const current = monthly.get(month) || {expenseCount: 0, net: 0, vat: 0, gross: 0, mileageAmount: 0, mileageMiles: 0};
    current.mileageAmount += mileageValue(mileage);
    current.mileageMiles += firstFinite(mileage, ["miles"]) || 0;
    monthly.set(month, current);
  });

  return {
    expenseCount: expenseRecords.length,
    netValue: roundCurrency(expenseRecords.reduce((sum, record) => sum + expenseNet(record), 0)),
    vatValue: roundCurrency(expenseRecords.reduce((sum, record) => sum + expenseVat(record), 0)),
    grossValue: roundCurrency(expenseRecords.reduce((sum, record) => sum + expenseGross(record), 0)),
    categoryTotals: Array.from(categories.values())
        .map((category) => ({
          category: category.category,
          count: category.count,
          netValue: roundCurrency(category.net),
          vatValue: roundCurrency(category.vat),
          grossValue: roundCurrency(category.gross),
        }))
        .sort((first, second) => second.grossValue - first.grossValue || first.category.localeCompare(second.category)),
    monthlyTotals: sortedMonthly(monthly, (month, value) => ({
      month,
      expenseCount: value.expenseCount,
      netValue: roundCurrency(value.net),
      vatValue: roundCurrency(value.vat),
      grossValue: roundCurrency(value.gross),
      mileageAmount: roundCurrency(value.mileageAmount),
      mileageMiles: roundMetric(value.mileageMiles, 1),
    })),
    mileage: {
      claimCount: mileageRecords.length,
      miles: roundMetric(mileageRecords.reduce((sum, record) => sum + (firstFinite(record, ["miles"]) || 0), 0), 1),
      amount: roundCurrency(mileageRecords.reduce((sum, record) => sum + mileageValue(record), 0)),
    },
  };
}

function projectSummary(project, invoices, bills, expenses, now) {
  const projectId = String(project.id || "");
  const allocatedInvoices = invoices.filter((record) => String(record.projectId || "") === projectId);
  const allocatedBills = bills.filter((record) => String(record.projectId || "") === projectId);
  const allocatedExpenses = expenses.filter((record) => String(record.projectId || "") === projectId);
  const expenseClaims = allocatedExpenses.filter((record) => record.type !== "mileage");
  const mileageClaims = allocatedExpenses.filter((record) => record.type === "mileage");
  const revenue = allocatedInvoices.reduce((sum, record) => sum + invoiceValue(record), 0);
  const billCosts = allocatedBills.reduce((sum, record) => sum + billValue(record), 0);
  const expenseCosts = expenseClaims.reduce((sum, record) => sum + expenseGross(record), 0);
  const mileageCosts = mileageClaims.reduce((sum, record) => sum + mileageValue(record), 0);
  const costs = billCosts + expenseCosts + mileageCosts;
  const profit = revenue - costs;
  const budget = firstFinite(project, ["budget"]) || 0;
  const budgetUsedPercent = budget > 0 ? (costs / budget) * 100 : 0;
  const attentionReasons = [];

  if (budget <= 0) attentionReasons.push("No budget set");
  else if (budgetUsedPercent >= 100) attentionReasons.push("Project budget reached or exceeded");

  const endDate = parseDate(project.endDate);
  if (String(project.status || "Active") === "Active" && endDate && endDate < now) {
    attentionReasons.push("Active project is past its end date");
  }
  if (costs > 0 && allocatedInvoices.length === 0) {
    attentionReasons.push("Costs recorded but no invoices");
  }

  return {
    projectId,
    name: displayName(project.name, "Unnamed project"),
    reference: String(project.reference || ""),
    status: String(project.status || "Active"),
    revenue: roundCurrency(revenue),
    billCosts: roundCurrency(billCosts),
    expenseCosts: roundCurrency(expenseCosts),
    mileageCosts: roundCurrency(mileageCosts),
    costs: roundCurrency(costs),
    profit: roundCurrency(profit),
    marginPercent: roundMetric(revenue ? (profit / revenue) * 100 : 0, 2),
    budget: roundCurrency(budget),
    budgetUsedPercent: roundMetric(budgetUsedPercent, 2),
    budgetRemaining: roundCurrency(budget - costs),
    invoiceCount: allocatedInvoices.length,
    attentionReasons,
  };
}

function summarizeProjects(projects, invoices, bills, expenses, scope) {
  const selectedProjects = scope.projectId ?
    projects.filter((project) => String(project.id || "") === scope.projectId) :
    projects;
  const summaries = selectedProjects
      .map((project) => projectSummary(project, invoices, bills, expenses, scope.now))
      .sort((first, second) => first.name.localeCompare(second.name));
  const ranked = summaries.filter((project) => project.revenue || project.costs);
  const byHighestProfit = [...ranked].sort((first, second) => second.profit - first.profit || first.name.localeCompare(second.name));
  const byLowestProfit = [...ranked].sort((first, second) => first.profit - second.profit || first.name.localeCompare(second.name));
  const totalRevenue = summaries.reduce((sum, project) => sum + project.revenue, 0);
  const totalCosts = summaries.reduce((sum, project) => sum + project.costs, 0);
  const totalProfit = totalRevenue - totalCosts;

  return {
    projectCount: summaries.length,
    revenue: roundCurrency(totalRevenue),
    costs: roundCurrency(totalCosts),
    profit: roundCurrency(totalProfit),
    marginPercent: roundMetric(totalRevenue ? (totalProfit / totalRevenue) * 100 : 0, 2),
    highestProfit: byHighestProfit.length ? byHighestProfit[0] : null,
    lowestProfit: byLowestProfit.length ? byLowestProfit[0] : null,
    requiringAttention: summaries.filter((project) => project.attentionReasons.length),
    items: summaries,
    assumptions: [
      "Revenue is based on all allocated invoice totals, regardless of payment status.",
      "Costs include allocated bill totals, expense gross values and mileage claim amounts.",
      "Project profit is an operational Simple Books figure, not formal accounting profit.",
    ],
  };
}

function normalizeCategory(value) {
  return String(value || "").trim().toLocaleLowerCase("en-GB");
}

function budgetTransaction(record, source) {
  if (source === "bill") {
    return {
      source,
      id: String(record.id || ""),
      date: parseDate(record.billDate),
      amount: billValue(record),
      category: "",
      projectId: String(record.projectId || ""),
    };
  }

  const mileage = record.type === "mileage";
  return {
    source: mileage ? "mileage" : "expense",
    id: String(record.id || ""),
    date: parseDate(record.date),
    amount: mileage ? mileageValue(record) : expenseGross(record),
    category: mileage ? "mileage" : normalizeCategory(record.category),
    projectId: String(record.projectId || ""),
  };
}

function summarizeBudgets(budgets, bills, expenses, scope) {
  const transactions = [
    ...bills.map((record) => budgetTransaction(record, "bill")),
    ...expenses.map((record) => budgetTransaction(record, "expense")),
  ].filter((transaction) => transaction.date);

  const relevantBudgets = budgets.filter((budget) => {
    if (scope.projectId && String(budget.projectId || "") !== scope.projectId) return false;
    const start = parseDate(budget.startDate);
    const end = parseDate(budget.endDate);
    if (scope.dateFrom && end && end < scope.dateFrom) return false;
    if (scope.dateTo && start && start > scope.dateTo) return false;
    return true;
  });

  const items = relevantBudgets.map((budget) => {
    const start = parseDate(budget.startDate);
    const end = parseDate(budget.endDate);
    const budgetCategory = normalizeCategory(budget.category);
    const contributing = transactions.filter((transaction) => {
      if (!start || !end || transaction.date < start || transaction.date > end) return false;
      if (budget.projectId && transaction.projectId !== String(budget.projectId)) return false;
      if (budget.budgetType === "category") {
        if (transaction.source === "bill" || !budgetCategory) return false;
        return transaction.category === budgetCategory;
      }
      return true;
    });
    const planned = firstFinite(budget, ["plannedAmount"]) || 0;
    const actual = contributing.reduce((sum, transaction) => sum + transaction.amount, 0);
    const percentageUsed = planned > 0 ? (actual / planned) * 100 : 0;
    let status = "within";
    if (percentageUsed >= 100) status = "exceeded";
    else if (percentageUsed >= 80) status = "near-limit";

    return {
      budgetId: String(budget.id || ""),
      name: displayName(budget.name, "Unnamed budget"),
      status: String(budget.status || "Active"),
      budgetType: String(budget.budgetType || "overall"),
      category: String(budget.category || ""),
      projectId: String(budget.projectId || ""),
      startDate: start ? isoDate(start) : "",
      endDate: end ? isoDate(end) : "",
      planned: roundCurrency(planned),
      actual: roundCurrency(actual),
      remaining: roundCurrency(planned - actual),
      overspend: roundCurrency(Math.max(actual - planned, 0)),
      percentageUsed: roundMetric(percentageUsed, 2),
      position: status,
      contributingTransactionCount: contributing.length,
    };
  }).sort((first, second) => first.name.localeCompare(second.name));

  return {
    budgetCount: items.length,
    withinBudgetCount: items.filter((budget) => budget.position === "within").length,
    nearLimitCount: items.filter((budget) => budget.position === "near-limit").length,
    exceededCount: items.filter((budget) => budget.position === "exceeded").length,
    plannedValue: roundCurrency(items.reduce((sum, budget) => sum + budget.planned, 0)),
    actualValue: roundCurrency(items.reduce((sum, budget) => sum + budget.actual, 0)),
    remainingValue: roundCurrency(items.reduce((sum, budget) => sum + budget.remaining, 0)),
    topOverspends: items.filter((budget) => budget.overspend > 0)
        .sort((first, second) => second.overspend - first.overspend || first.name.localeCompare(second.name))
        .slice(0, 10),
    items,
    assumptions: [
      "Budget actuals use bill totals, expense gross values and mileage claim amounts.",
      "Category budgets exclude bills because bill records do not have a category field.",
      "Near limit means at least 80% used and less than 100% used.",
      "Budget actuals include contributing records regardless of their payment or approval status.",
    ],
  };
}

function summarizeCashflow(invoices, bills, scope) {
  const forecastStart = scope.dateFrom || scope.now;
  const forecastEnd = scope.dateTo || addUtcDays(forecastStart, DEFAULT_CASHFLOW_DAYS);
  const includeOverdue = !scope.dateFrom;

  function forecastRecords(records, amountFunction) {
    return records.filter((record) => matchesProject(record, scope) && !isPaid(record))
        .map((record) => ({
          dueDate: parseDate(record.dueDate),
          amount: amountFunction(record),
        }))
        .filter((record) => record.dueDate && record.dueDate <= forecastEnd &&
          (includeOverdue || record.dueDate >= forecastStart));
  }

  const receipts = forecastRecords(invoices, invoiceValue);
  const payments = forecastRecords(bills, billValue);
  const events = [
    ...receipts.map((record) => ({date: record.dueDate < forecastStart ? forecastStart : record.dueDate, receipts: record.amount, payments: 0})),
    ...payments.map((record) => ({date: record.dueDate < forecastStart ? forecastStart : record.dueDate, receipts: 0, payments: record.amount})),
  ];
  const days = new Map();

  events.forEach((event) => {
    const key = isoDate(event.date);
    const day = days.get(key) || {date: key, receipts: 0, payments: 0};
    day.receipts += event.receipts;
    day.payments += event.payments;
    days.set(key, day);
  });

  let balance = scope.openingCashBalance;
  let lowestBalance = balance;
  let lowestBalanceDate = isoDate(forecastStart);
  const runningBalance = Array.from(days.values())
      .sort((first, second) => first.date.localeCompare(second.date))
      .map((day) => {
        const netMovement = day.receipts - day.payments;
        balance += netMovement;
        if (balance < lowestBalance) {
          lowestBalance = balance;
          lowestBalanceDate = day.date;
        }
        return {
          date: day.date,
          receipts: roundCurrency(day.receipts),
          payments: roundCurrency(day.payments),
          netMovement: roundCurrency(netMovement),
          balance: roundCurrency(balance),
        };
      });

  const expectedReceipts = receipts.reduce((sum, record) => sum + record.amount, 0);
  const expectedPayments = payments.reduce((sum, record) => sum + record.amount, 0);

  return {
    forecastStart: isoDate(forecastStart),
    forecastEnd: isoDate(forecastEnd),
    scenarioOpeningBalance: roundCurrency(scope.openingCashBalance),
    openingBalanceSupplied: scope.openingBalanceSupplied,
    expectedReceiptCount: receipts.length,
    expectedReceipts: roundCurrency(expectedReceipts),
    expectedPaymentCount: payments.length,
    expectedPayments: roundCurrency(expectedPayments),
    netMovement: roundCurrency(expectedReceipts - expectedPayments),
    closingBalance: roundCurrency(scope.openingCashBalance + expectedReceipts - expectedPayments),
    lowestBalance: roundCurrency(lowestBalance),
    lowestBalanceDate,
    runningBalance,
    importantAssumptions: [
      scope.openingBalanceSupplied ?
        "The opening balance is a user-supplied scenario value." :
        "No opening balance was supplied, so zero was used.",
      "Expected receipts use unpaid invoice totals and their due dates.",
      "Expected payments use unpaid bill totals and their due dates.",
      includeOverdue ?
        "Overdue items are included and applied on the forecast start date." :
        "An explicit dateFrom was supplied, so earlier overdue items are excluded.",
      scope.dateTo ?
        "The forecast end comes from the supplied dateTo scope." :
        `The forecast uses the default ${DEFAULT_CASHFLOW_DAYS}-day horizon.`,
      "Expenses and mileage are not included in the current cashflow calculation.",
    ],
  };
}

function addDataQualityWarnings(data, projects, warnings) {
  const dateChecks = [
    {area: "invoices", records: data.invoices, fields: ["date", "invoiceDate", "createdAt"]},
    {area: "bills", records: data.bills, fields: ["billDate", "createdAt"]},
    {area: "expenses", records: data.expenses, fields: ["date", "createdAt"]},
    {area: "budgets", records: data.budgets, fields: ["startDate"]},
  ];

  dateChecks.forEach((check) => {
    const missing = check.records.filter((record) => !recordDate(record, check.fields)).length;
    if (missing) {
      warnings.push(createWarning(
          "missing-or-invalid-dates",
          check.area,
          missing,
          `${missing} ${check.area} record(s) had no valid activity date.`,
      ));
    }
  });

  const missingInvoiceDueDates = data.invoices.filter((record) => !isPaid(record) && !parseDate(record.dueDate)).length;
  if (missingInvoiceDueDates) {
    warnings.push(createWarning(
        "missing-invoice-due-dates",
        "invoices",
        missingInvoiceDueDates,
        `${missingInvoiceDueDates} outstanding invoice(s) had no valid due date.`,
    ));
  }

  const missingBillDueDates = data.bills.filter((record) => !isPaid(record) && !parseDate(record.dueDate)).length;
  if (missingBillDueDates) {
    warnings.push(createWarning(
        "missing-bill-due-dates",
        "bills",
        missingBillDueDates,
        `${missingBillDueDates} outstanding bill(s) had no valid due date.`,
    ));
  }

  const numericChecks = [
    {area: "invoices", records: data.invoices, fields: ["amount", "vat", "total"]},
    {area: "bills", records: data.bills, fields: ["net", "vat", "total"]},
    {area: "expenses", records: data.expenses, fields: ["net", "vat", "gross", "amount", "miles", "ratePerMile"]},
    {area: "projects", records: data.projects, fields: ["budget"]},
    {area: "budgets", records: data.budgets, fields: ["plannedAmount"]},
  ];

  numericChecks.forEach((check) => {
    const invalid = check.records.filter((record) => hasInvalidNumber(record, check.fields)).length;
    if (invalid) {
      warnings.push(createWarning(
          "invalid-numbers",
          check.area,
          invalid,
          `${invalid} ${check.area} record(s) contained an invalid numeric value; safe fallbacks were used.`,
      ));
    }
  });

  const projectIds = new Set(projects.map((project) => String(project.id || "")));
  const transactionRecords = [...data.invoices, ...data.bills, ...data.expenses];
  const unknownProjects = new Set(transactionRecords
      .map((record) => String(record.projectId || ""))
      .filter((projectId) => projectId && !projectIds.has(projectId)));
  if (unknownProjects.size) {
    warnings.push(createWarning(
        "unknown-project-references",
        "projects",
        unknownProjects.size,
        `${unknownProjects.size} unknown project reference(s) were found on financial records.`,
    ));
  }
}

function safeProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    businessName: String(source.businessName || ""),
    businessType: String(source.businessType || ""),
    vatRegistered: String(source.vatRegistered || ""),
  };
}

function summarizeBusinessData(data, scope, options) {
  const source = data && typeof data === "object" ? data : {};
  const nowValue = options && options.now ? new Date(options.now) : new Date();
  const validNow = Number.isNaN(nowValue.getTime()) ? new Date() : nowValue;
  const warnings = Array.isArray(source.loadWarnings) ? [...source.loadWarnings] : [];
  const normalized = {
    invoices: Array.isArray(source.invoices) ? source.invoices : [],
    bills: Array.isArray(source.bills) ? source.bills : [],
    expenses: Array.isArray(source.expenses) ? source.expenses : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    budgets: Array.isArray(source.budgets) ? source.budgets : [],
    clients: Array.isArray(source.clients) ? source.clients : [],
    profile: source.profile || {},
  };
  const normalizedScope = normalizeScope(scope, validNow, warnings);
  const scopedInvoices = filterRecords(normalized.invoices, ["date", "invoiceDate", "createdAt"], normalizedScope);
  const scopedBills = filterRecords(normalized.bills, ["billDate", "createdAt"], normalizedScope);
  const scopedExpenses = filterRecords(normalized.expenses, ["date", "createdAt"], normalizedScope);

  addDataQualityWarnings(normalized, normalized.projects, warnings);
  const invoiceSummary = summarizeInvoices(scopedInvoices, normalized.clients, normalizedScope, warnings);
  const billSummary = summarizeBills(scopedBills, normalizedScope);
  const expenseSummary = summarizeExpenses(scopedExpenses);
  const projectSummaryResult = summarizeProjects(normalized.projects, scopedInvoices, scopedBills, scopedExpenses, normalizedScope);
  const budgetSummary = summarizeBudgets(normalized.budgets, scopedBills, scopedExpenses, normalizedScope);
  const cashflowSummary = summarizeCashflow(normalized.invoices, normalized.bills, normalizedScope);

  warnings.sort((first, second) =>
    String(first.area).localeCompare(String(second.area)) ||
    String(first.code).localeCompare(String(second.code)) ||
    String(first.message).localeCompare(String(second.message)),
  );

  return {
    meta: {
      generatedAt: validNow.toISOString(),
      currency: "GBP",
      scope: {
        dateFrom: normalizedScope.dateFrom ? isoDate(normalizedScope.dateFrom) : null,
        dateTo: normalizedScope.dateTo ? isoDate(normalizedScope.dateTo) : null,
        projectId: normalizedScope.projectId || null,
        openingCashBalance: roundCurrency(normalizedScope.openingCashBalance),
      },
      sourceRecordCounts: {
        invoices: normalized.invoices.length,
        bills: normalized.bills.length,
        expensesAndMileage: normalized.expenses.length,
        projects: normalized.projects.length,
        budgets: normalized.budgets.length,
        clients: normalized.clients.length,
      },
      includedRecordCounts: {
        invoices: scopedInvoices.length,
        bills: scopedBills.length,
        expensesAndMileage: scopedExpenses.length,
      },
      businessProfile: safeProfile(normalized.profile),
    },
    invoices: invoiceSummary,
    bills: billSummary,
    expenses: expenseSummary,
    projects: projectSummaryResult,
    budgets: budgetSummary,
    cashflow: cashflowSummary,
    warnings,
  };
}

async function safeReadCollection(reference, name, warnings) {
  try {
    let query = reference.collection(name);
    if (typeof query.select === "function") {
      query = query.select(...COLLECTION_FIELDS[name]);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    }));
  } catch (error) {
    warnings.push(createWarning(
        "collection-read-failed",
        name,
        1,
        `The ${name} collection could not be read; its summary section may be incomplete.`,
    ));
    return [];
  }
}

async function safeReadProfile(reference, warnings) {
  try {
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      warnings.push(createWarning(
          "profile-not-found",
          "profile",
          1,
          "The business profile was not found.",
      ));
      return {};
    }
    return safeProfile(snapshot.data() || {});
  } catch (error) {
    warnings.push(createWarning(
        "profile-read-failed",
        "profile",
        1,
        "The business profile could not be read.",
    ));
    return {};
  }
}

async function loadBusinessData(firestore, uid) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore instance is required.");
  }
  if (!uid || typeof uid !== "string") {
    throw new TypeError("An authenticated Firebase uid is required.");
  }

  const warnings = [];
  const userReference = firestore.collection("users").doc(uid);
  const collectionNames = ["invoices", "bills", "expenses", "projects", "budgets", "clients"];
  const results = await Promise.all([
    ...collectionNames.map((name) => safeReadCollection(userReference, name, warnings)),
    safeReadProfile(userReference, warnings),
  ]);

  return {
    invoices: results[0],
    bills: results[1],
    expenses: results[2],
    projects: results[3],
    budgets: results[4],
    clients: results[5],
    profile: results[6],
    loadWarnings: warnings,
  };
}

async function buildBusinessSummary(firestore, uid, scope, options) {
  const data = await loadBusinessData(firestore, uid);
  return summarizeBusinessData(data, scope || {}, options || {});
}

module.exports = {
  buildBusinessSummary,
  summarizeBusinessData,
};
