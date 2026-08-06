import { normaliseInvoiceDate, roundMoney } from "/resources/js/business-logic.js";
import { profitLossViewFromJournals } from "/resources/js/profit-loss-view.js";
import { formatTrialBalanceGbp } from "/resources/js/trial-balance-view.js";

const DAY_MS = 86400000;
const PRIORITY_ORDER = Object.freeze({ high: 0, medium: 1, positive: 2 });

export function formatInsightsGbp(value){
  return formatTrialBalanceGbp(Number(value) || 0);
}

export function trendSentence(trend){
  const text = String(trend?.comparisonText || "No comparison available");
  return `${text}${/[.!?]$/.test(text) ? "" : "."}`;
}

function finite(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value){
  return normaliseInvoiceDate(value).date;
}

function dayNumber(value){
  const date = dateValue(value);
  return date ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS : null;
}

function statusIsPaid(record){
  return String(record?.status || "").trim().toLowerCase() === "paid";
}

function invoiceDate(record){
  return record?.date || record?.invoiceDate || record?.createdAt;
}

function billDate(record){
  return record?.billDate || record?.date || record?.createdAt;
}

function expenseAmount(record){
  if(String(record?.type || "").toLowerCase() === "mileage"){
    return finite(record?.amount ?? record?.mileageAmount ?? record?.gross);
  }
  return finite(record?.gross ?? record?.grossAmount ?? record?.total ?? (finite(record?.net) + finite(record?.vat)));
}

function inRange(value, start, end){
  const day = dayNumber(value);
  return day !== null && day >= dayNumber(start) && day <= dayNumber(end);
}

export function comparisonPeriods(referenceDate = new Date()){
  const reference = dateValue(referenceDate) || new Date();
  const currentStart = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const currentEnd = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const previousStart = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  const previousLastDay = new Date(reference.getFullYear(), reference.getMonth(), 0).getDate();
  const previousEnd = new Date(
    previousStart.getFullYear(),
    previousStart.getMonth(),
    Math.min(reference.getDate(), previousLastDay)
  );
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function reportForPeriod(journals, start, end){
  return profitLossViewFromJournals(journals, {
    dateFrom: normaliseInvoiceDate(start).inputValue,
    dateTo: normaliseInvoiceDate(end).inputValue
  });
}

export function calculateTrend(current, previous, favourableWhen = "up", available = true, zeroBaselineName = "value"){
  const currentValue = current === null || current === undefined ? null : roundMoney(current);
  const previousValue = previous === null || previous === undefined ? null : roundMoney(previous);
  if(!available){
    return { current: currentValue, previous: previousValue, change: null, percentage: null, direction: "none", favourability: "neutral", comparisonText: "No comparison available" };
  }
  const change = roundMoney(currentValue - previousValue);
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const percentage = previousValue === 0 ? null : Math.round(Math.abs(change / previousValue) * 1000) / 10;
  const favourability = direction === "flat" ? "neutral" : direction === favourableWhen ? "favourable" : "unfavourable";
  const comparisonText = previousValue === 0
    ? (currentValue === 0
      ? "No comparison available"
      : `${formatInsightsGbp(Math.abs(change))} ${change > 0 ? "higher" : "lower"}; no ${zeroBaselineName} was recorded in the comparison period`)
    : `${direction === "up" ? "Up" : direction === "down" ? "Down" : "No change"}${percentage === null || direction === "flat" ? "" : ` ${percentage}%`} from the comparison period`;
  return { current: currentValue, previous: previousValue, change, percentage, direction, favourability, comparisonText };
}

export function calculateProjectSummaries(projects = [], invoices = [], bills = [], expenses = []){
  return (Array.isArray(projects) ? projects : []).map(project => {
    const projectId = String(project?.id || "");
    const revenue = invoices.filter(item => String(item?.projectId || "") === projectId).reduce((sum, item) => sum + finite(item?.total), 0);
    const billCosts = bills.filter(item => String(item?.projectId || "") === projectId).reduce((sum, item) => sum + finite(item?.total), 0);
    const otherCosts = expenses.filter(item => String(item?.projectId || "") === projectId).reduce((sum, item) => sum + expenseAmount(item), 0);
    const costs = roundMoney(billCosts + otherCosts);
    const profit = roundMoney(revenue - costs);
    return {
      id: projectId,
      name: String(project?.name || "Unnamed project"),
      status: String(project?.status || "Active"),
      revenue: roundMoney(revenue),
      costs,
      profit,
      margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null
    };
  });
}

function budgetTransaction(record, source){
  const isMileage = source === "expense" && String(record?.type || "").toLowerCase() === "mileage";
  return {
    date: source === "bill" ? billDate(record) : record?.date,
    amount: source === "bill" ? finite(record?.total ?? (finite(record?.net) + finite(record?.vat))) : expenseAmount(record),
    category: isMileage ? "mileage" : String(record?.category || "").trim().toLowerCase(),
    projectId: String(record?.projectId || ""),
    source: isMileage ? "mileage" : source
  };
}

export function calculateBudgetSummaries(budgets = [], bills = [], expenses = []){
  const transactions = [
    ...(Array.isArray(bills) ? bills : []).map(item => budgetTransaction(item, "bill")),
    ...(Array.isArray(expenses) ? expenses : []).map(item => budgetTransaction(item, "expense"))
  ];
  return (Array.isArray(budgets) ? budgets : []).map(budget => {
    const planned = finite(budget?.plannedAmount);
    const category = String(budget?.category || "").trim().toLowerCase();
    const actual = transactions.filter(transaction => {
      if(!inRange(transaction.date, budget?.startDate, budget?.endDate)) return false;
      if(budget?.projectId && transaction.projectId !== String(budget.projectId)) return false;
      if(budget?.budgetType === "category") return transaction.source !== "bill" && category && transaction.category === category;
      return true;
    }).reduce((sum, transaction) => sum + transaction.amount, 0);
    const percentageUsed = planned > 0 ? Math.round((actual / planned) * 1000) / 10 : 0;
    return {
      id: String(budget?.id || ""),
      name: String(budget?.name || "Unnamed budget"),
      status: String(budget?.status || "Active"),
      planned: roundMoney(planned),
      actual: roundMoney(actual),
      percentageUsed,
      pressure: planned > 0 && percentageUsed >= 80
    };
  });
}

export function calculateSnapshot(data = {}, referenceDate = new Date()){
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const bills = Array.isArray(data.bills) ? data.bills : [];
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const projects = calculateProjectSummaries(data.projects, invoices, bills, expenses);
  const budgets = calculateBudgetSummaries(data.budgets, bills, expenses);
  const { currentStart, currentEnd } = comparisonPeriods(referenceDate);
  const overdueInvoices = invoices.filter(invoice => !statusIsPaid(invoice) && dayNumber(invoice?.dueDate) !== null && dayNumber(invoice.dueDate) < dayNumber(referenceDate));
  const outstandingInvoices = invoices.filter(invoice => !statusIsPaid(invoice));
  const unpaidBills = bills.filter(bill => !statusIsPaid(bill));
  const currentReport = reportForPeriod(Array.isArray(data.journals) ? data.journals : [], currentStart, currentEnd);
  const accountingAvailable = data.accountingAvailable !== false;
  const hasCurrentReport = accountingAvailable && !["error", "invalidDate"].includes(currentReport.state);
  return {
    outstandingInvoiceTotal: roundMoney(outstandingInvoices.reduce((sum, item) => sum + finite(item?.total), 0)),
    overdueInvoiceCount: overdueInvoices.length,
    overdueInvoiceValue: roundMoney(overdueInvoices.reduce((sum, item) => sum + finite(item?.total), 0)),
    unpaidBillsTotal: roundMoney(unpaidBills.reduce((sum, item) => sum + finite(item?.total), 0)),
    currentMonthRevenue: hasCurrentReport ? (currentReport.totalIncome ?? 0) : null,
    currentMonthExpenses: hasCurrentReport ? (currentReport.totalExpenses ?? 0) : null,
    currentMonthProfit: hasCurrentReport ? (currentReport.netResult ?? 0) : null,
    activeProjects: projects.filter(item => item.status.toLowerCase() === "active").length,
    lossMakingProjects: projects.filter(item => item.status.toLowerCase() === "active" && item.profit < 0).length,
    pressuredBudgets: budgets.filter(item => item.status.toLowerCase() === "active" && item.pressure).length,
    projects,
    budgets
  };
}

export function calculateTrends(data = {}, referenceDate = new Date()){
  const journals = Array.isArray(data.journals) ? data.journals : [];
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const periods = comparisonPeriods(referenceDate);
  const currentReport = reportForPeriod(journals, periods.currentStart, periods.currentEnd);
  const previousReport = reportForPeriod(journals, periods.previousStart, periods.previousEnd);
  const accountingAvailable = data.accountingAvailable !== false;
  const reportAvailable = report => accountingAvailable && !["noData", "error", "invalidDate"].includes(report.state);
  const reportValue = (report, key) => accountingAvailable && !["error", "invalidDate"].includes(report.state)
    ? (report[key] ?? 0)
    : null;
  const currentOutstanding = invoices.filter(item => !statusIsPaid(item) && inRange(invoiceDate(item), periods.currentStart, periods.currentEnd)).reduce((sum, item) => sum + finite(item?.total), 0);
  const previousOutstanding = invoices.filter(item => !statusIsPaid(item) && inRange(invoiceDate(item), periods.previousStart, periods.previousEnd)).reduce((sum, item) => sum + finite(item?.total), 0);
  return {
    revenue: calculateTrend(reportValue(currentReport, "totalIncome"), reportValue(previousReport, "totalIncome"), "up", reportAvailable(currentReport) && reportAvailable(previousReport), "revenue"),
    expenses: calculateTrend(reportValue(currentReport, "totalExpenses"), reportValue(previousReport, "totalExpenses"), "down", reportAvailable(currentReport) && reportAvailable(previousReport), "expenses"),
    profit: calculateTrend(reportValue(currentReport, "netResult"), reportValue(previousReport, "netResult"), "up", reportAvailable(currentReport) && reportAvailable(previousReport), "profit or loss"),
    outstandingInvoices: calculateTrend(currentOutstanding, previousOutstanding, "down", invoices.some(item => inRange(invoiceDate(item), periods.previousStart, periods.currentEnd)), "outstanding balance")
  };
}

export function healthStatus(score){
  if(score === null || score === undefined) return "Not enough data yet";
  if(score >= 80) return "Strong";
  if(score >= 60) return "Healthy";
  if(score >= 40) return "Needs attention";
  return "At risk";
}

export function calculateHealthScore(data = {}, referenceDate = new Date()){
  const recordCount = ["invoices", "bills", "expenses", "projects", "budgets", "journals"]
    .reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
  if(recordCount === 0) return { score: null, status: healthStatus(null), components: [], explanation: "Add some records to build a meaningful view." };
  const snapshot = calculateSnapshot(data, referenceDate);
  const trends = calculateTrends(data, referenceDate);
  const components = [];
  const overdueRatio = snapshot.outstandingInvoiceTotal > 0 ? snapshot.overdueInvoiceValue / snapshot.outstandingInvoiceTotal : 0;
  components.push({ key: "overdue", label: "Overdue invoices", points: overdueRatio === 0 ? 12 : overdueRatio >= 0.5 ? -15 : overdueRatio >= 0.2 ? -8 : -3, maximum: 15 });
  components.push({ key: "revenue", label: "Revenue trend", points: trends.revenue.favourability === "favourable" ? 10 : trends.revenue.favourability === "unfavourable" ? -10 : 0, maximum: 10 });
  components.push({ key: "expenses", label: "Expense trend", points: trends.expenses.favourability === "favourable" ? 8 : trends.expenses.favourability === "unfavourable" ? -8 : 0, maximum: 8 });
  components.push({ key: "profit", label: "Current profitability", points: snapshot.currentMonthProfit === null ? 0 : snapshot.currentMonthProfit > 0 ? 12 : snapshot.currentMonthProfit < 0 ? -12 : 0, maximum: 12 });
  const activeProjects = snapshot.projects.filter(item => item.status.toLowerCase() === "active" && item.revenue > 0);
  const lossProjects = activeProjects.filter(item => item.profit < 0);
  components.push({ key: "projects", label: "Project profitability", points: !activeProjects.length ? 0 : lossProjects.length ? -10 : 8, maximum: 10 });
  const activeBudgets = snapshot.budgets.filter(item => item.status.toLowerCase() === "active" && item.planned > 0);
  const pressured = activeBudgets.filter(item => item.pressure);
  components.push({ key: "budgets", label: "Budget pressure", points: !activeBudgets.length ? 0 : pressured.some(item => item.percentageUsed >= 100) ? -10 : pressured.length ? -5 : 8, maximum: 10 });
  const score = Math.min(100, Math.max(0, Math.round(60 + components.reduce((sum, item) => sum + item.points, 0))));
  return { score, status: healthStatus(score), components, explanation: "Based on recent revenue, expenses, overdue invoices, budgets and project performance." };
}

function priority(id, severity, rank, title, explanation, href){
  return { id, severity, rank, title, explanation, href };
}

export function generatePriorities(data = {}, referenceDate = new Date()){
  const snapshot = calculateSnapshot(data, referenceDate);
  const trends = calculateTrends(data, referenceDate);
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const bills = Array.isArray(data.bills) ? data.bills : [];
  const overdueInvoices = invoices.filter(item => !statusIsPaid(item) && dayNumber(item?.dueDate) !== null && dayNumber(item.dueDate) < dayNumber(referenceDate));
  const overdueBills = bills.filter(item => !statusIsPaid(item) && dayNumber(item?.dueDate) !== null && dayNumber(item.dueDate) < dayNumber(referenceDate));
  const dueSoonBills = bills.filter(item => {
    const due = dayNumber(item?.dueDate);
    const today = dayNumber(referenceDate);
    return !statusIsPaid(item) && due !== null && due >= today && due <= today + 7;
  });
  const candidates = [];
  if(overdueInvoices.length) candidates.push(priority("overdue-invoices", "high", snapshot.overdueInvoiceValue, `Review ${overdueInvoices.length} overdue ${overdueInvoices.length === 1 ? "invoice" : "invoices"}.`, `They total £${snapshot.overdueInvoiceValue.toFixed(2)} and may benefit from a follow-up.`, "/resources/tools/invoice-generator.html"));
  if(overdueBills.length) candidates.push(priority("overdue-bills", "high", overdueBills.reduce((sum, item) => sum + finite(item?.total), 0), `Review ${overdueBills.length} overdue ${overdueBills.length === 1 ? "bill" : "bills"}.`, "These supplier payments are past their recorded due dates.", "/resources/tools/bills.html"));
  const lossProject = snapshot.projects.filter(item => item.status.toLowerCase() === "active" && item.profit < 0).sort((a, b) => a.profit - b.profit || a.name.localeCompare(b.name))[0];
  if(lossProject) candidates.push(priority(`project-loss-${lossProject.id}`, "high", Math.abs(lossProject.profit), `${lossProject.name} is currently making a loss.`, `Recorded costs exceed invoiced revenue by £${Math.abs(lossProject.profit).toFixed(2)}.`, `/resources/tools/project-details.html?id=${encodeURIComponent(lossProject.id)}`));
  const overBudget = snapshot.budgets.filter(item => item.status.toLowerCase() === "active" && item.percentageUsed >= 100).sort((a, b) => b.percentageUsed - a.percentageUsed || a.name.localeCompare(b.name))[0];
  const nearBudget = snapshot.budgets.filter(item => item.status.toLowerCase() === "active" && item.percentageUsed >= 80 && item.percentageUsed < 100).sort((a, b) => b.percentageUsed - a.percentageUsed || a.name.localeCompare(b.name))[0];
  if(overBudget) candidates.push(priority(`budget-${overBudget.id}`, "high", overBudget.percentageUsed, `${overBudget.name} is over its recorded budget.`, `${overBudget.percentageUsed.toFixed(1)}% of the planned amount has been used.`, "/resources/tools/budgets.html"));
  else if(nearBudget) candidates.push(priority(`budget-${nearBudget.id}`, "medium", nearBudget.percentageUsed, `${nearBudget.name} is approaching its limit.`, `${nearBudget.percentageUsed.toFixed(1)}% of the planned amount has been used.`, "/resources/tools/budgets.html"));
  if(dueSoonBills.length) candidates.push(priority("bills-due-soon", "medium", dueSoonBills.reduce((sum, item) => sum + finite(item?.total), 0), `${dueSoonBills.length} ${dueSoonBills.length === 1 ? "bill is" : "bills are"} due within 7 days.`, "Check the recorded due dates when planning upcoming payments.", "/resources/tools/bills.html"));
  const lowMargin = snapshot.projects.filter(item => item.status.toLowerCase() === "active" && item.revenue > 0 && item.profit >= 0 && item.margin < 15).sort((a, b) => a.margin - b.margin || a.name.localeCompare(b.name))[0];
  if(lowMargin) candidates.push(priority(`project-margin-${lowMargin.id}`, "medium", 100 - lowMargin.margin, `${lowMargin.name} has a low current margin.`, `Its source-record margin is ${lowMargin.margin.toFixed(1)}%.`, `/resources/tools/project-details.html?id=${encodeURIComponent(lowMargin.id)}`));
  if(trends.expenses.favourability === "unfavourable" && trends.expenses.percentage !== null && trends.expenses.percentage >= 20) candidates.push(priority("expenses-rising", "medium", trends.expenses.percentage, "Expenses have risen in the comparison period.", trends.expenses.comparisonText + ".", "/resources/tools/expenses.html"));
  if(trends.revenue.favourability === "unfavourable" && trends.revenue.percentage !== null && trends.revenue.percentage >= 20) candidates.push(priority("revenue-declining", "medium", trends.revenue.percentage, "Revenue is lower in the comparison period.", trends.revenue.comparisonText + ".", "/resources/tools/invoice-generator.html"));
  if(!candidates.length && trends.revenue.favourability === "favourable" && trends.expenses.favourability !== "unfavourable") candidates.push(priority("healthy-growth", "positive", 0, "Revenue is moving in a positive direction.", "Revenue is growing without a sharper rise in recorded expenses.", "/dashboard.html"));
  return candidates.sort((a, b) => PRIORITY_ORDER[a.severity] - PRIORITY_ORDER[b.severity] || b.rank - a.rank || a.id.localeCompare(b.id)).slice(0, 5);
}

export function buildBusinessInsights(data = {}, referenceDate = new Date()){
  const recordCount = ["invoices", "bills", "expenses", "projects", "budgets", "journals"].reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);
  return {
    hasData: recordCount > 0,
    health: calculateHealthScore(data, referenceDate),
    priorities: generatePriorities(data, referenceDate),
    trends: calculateTrends(data, referenceDate),
    snapshot: calculateSnapshot(data, referenceDate)
  };
}
