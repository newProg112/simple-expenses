import { normaliseInvoiceDate, roundMoney } from "/resources/js/business-logic.js";

const DAY_MS = 86400000;
const INSIGHT_ORDER = Object.freeze([
  "upcoming-bills", "slowest-customer", "lowest-project", "vat-position",
  "top-customer", "expense-category", "best-project"
]);

function finiteMoney(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dayNumber(value){
  const date = normaliseInvoiceDate(value).date;
  return date ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS : null;
}

function inRange(value, start, end){
  const day = dayNumber(value);
  const first = dayNumber(start);
  const last = dayNumber(end);
  return day !== null && first !== null && last !== null && day >= first && day <= last;
}

function nameValue(value){
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name && !/^unnamed\b/i.test(name) ? name : "";
}

function normalizedName(value){
  return nameValue(value).toLocaleLowerCase("en-GB");
}

function recordId(record){
  return String(record?.id || "");
}

function percentage(amount, total){
  return total > 0 ? Math.round(amount / total * 1000) / 10 : null;
}

function invoiceRevenue(invoice){
  const net = finiteMoney(invoice?.amount ?? invoice?.net ?? invoice?.netAmount);
  if(net !== null) return net;
  const total = finiteMoney(invoice?.total ?? invoice?.gross ?? invoice?.grossAmount);
  const vat = Number(invoice?.vat ?? invoice?.vatAmount);
  if(total !== null && Number.isFinite(vat) && vat >= 0 && vat < total) return roundMoney(total - vat);
  return total;
}

function expenseAmount(expense){
  const mileage = String(expense?.type || "").trim().toLowerCase() === "mileage";
  return finiteMoney(mileage
    ? (expense?.amount ?? expense?.mileageAmount ?? expense?.gross)
    : (expense?.gross ?? expense?.grossAmount ?? expense?.total ?? expense?.amount));
}

function insight(id, category, status, headline, supporting, href, teaser){
  return Object.freeze({ id, category, status, headline, supporting, href, teaser });
}

export function calculateTopCustomer(invoices = [], period = {}){
  const groups = new Map();
  for(const invoice of Array.isArray(invoices) ? invoices : []){
    if(!inRange(invoice?.date || invoice?.invoiceDate || invoice?.createdAt, period.currentStart, period.currentEnd)) continue;
    const name = nameValue(invoice?.client || invoice?.clientName || invoice?.customerName);
    const amount = invoiceRevenue(invoice);
    if(!name || amount === null) continue;
    const key = normalizedName(name);
    const current = groups.get(key) || { name, amount:0, firstId:recordId(invoice) };
    current.amount = roundMoney(current.amount + amount);
    if(name.localeCompare(current.name, "en-GB") < 0) current.name = name;
    current.firstId = [current.firstId, recordId(invoice)].filter(Boolean).sort()[0] || "";
    groups.set(key, current);
  }
  const ranked = [...groups.values()].sort((left, right) =>
    right.amount - left.amount || normalizedName(left.name).localeCompare(normalizedName(right.name)) || left.firstId.localeCompare(right.firstId));
  const total = roundMoney(ranked.reduce((sum, item) => sum + item.amount, 0));
  return ranked.length && total > 0 ? { ...ranked[0], total, percentage:percentage(ranked[0].amount, total) } : null;
}

export function calculateLargestExpenseCategory(expenses = [], period = {}){
  const groups = new Map();
  for(const expense of Array.isArray(expenses) ? expenses : []){
    if(!inRange(expense?.date || expense?.expenseDate || expense?.createdAt, period.currentStart, period.currentEnd)) continue;
    const isMileage = String(expense?.type || "").trim().toLowerCase() === "mileage";
    const category = nameValue(isMileage ? "Mileage" : expense?.category);
    const amount = expenseAmount(expense);
    if(!category || amount === null) continue;
    const key = normalizedName(category);
    const current = groups.get(key) || { category, amount:0, firstId:recordId(expense) };
    current.amount = roundMoney(current.amount + amount);
    if(category.localeCompare(current.category, "en-GB") < 0) current.category = category;
    current.firstId = [current.firstId, recordId(expense)].filter(Boolean).sort()[0] || "";
    groups.set(key, current);
  }
  const ranked = [...groups.values()].sort((left, right) =>
    right.amount - left.amount || normalizedName(left.category).localeCompare(normalizedName(right.category)) || left.firstId.localeCompare(right.firstId));
  const total = roundMoney(ranked.reduce((sum, item) => sum + item.amount, 0));
  return ranked.length && total > 0 ? { ...ranked[0], total, percentage:percentage(ranked[0].amount, total) } : null;
}

export function selectProjectPerformance(projectSummaries = []){
  const eligible = (Array.isArray(projectSummaries) ? projectSummaries : []).filter(project =>
    String(project?.status || "").trim().toLowerCase() === "active" && nameValue(project?.name) &&
    Number(project?.revenue) > 0 && Number(project?.costs) > 0 && Number.isFinite(Number(project?.margin)));
  const strongest = [...eligible].sort((left, right) =>
    right.margin - left.margin || right.profit - left.profit || right.revenue - left.revenue ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || recordId(left).localeCompare(recordId(right)))[0] || null;
  const lossMaking = eligible.filter(project => project.profit < 0).sort((left, right) =>
    left.margin - right.margin || left.profit - right.profit || right.costs - left.costs ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || recordId(left).localeCompare(recordId(right)))[0] || null;
  const lowestPositive = eligible.length >= 2 ? [...eligible].filter(project => project.profit >= 0).sort((left, right) =>
    left.margin - right.margin || left.profit - right.profit || left.revenue - right.revenue ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || recordId(left).localeCompare(recordId(right)))[0] || null : null;
  return { best:strongest, lowest:lossMaking || lowestPositive };
}

export function calculateSlowestPayingCustomer(invoices = []){
  const groups = new Map();
  for(const invoice of Array.isArray(invoices) ? invoices : []){
    if(String(invoice?.status || "").trim().toLowerCase() !== "paid") continue;
    const name = nameValue(invoice?.client || invoice?.clientName || invoice?.customerName);
    const issued = dayNumber(invoice?.date || invoice?.invoiceDate || invoice?.createdAt);
    const paid = dayNumber(invoice?.paidAt || invoice?.paidDate || invoice?.paymentDate || invoice?.datePaid);
    if(!name || issued === null || paid === null || paid < issued) continue;
    const elapsed = paid - issued;
    if(!Number.isFinite(elapsed)) continue;
    const key = normalizedName(name);
    const current = groups.get(key) || { name, days:[], firstId:recordId(invoice) };
    current.days.push(elapsed);
    current.firstId = [current.firstId, recordId(invoice)].filter(Boolean).sort()[0] || "";
    groups.set(key, current);
  }
  return [...groups.values()].filter(item => item.days.length >= 2).map(item => ({
    name:item.name,
    invoiceCount:item.days.length,
    averageDays:Math.round(item.days.reduce((sum, value) => sum + value, 0) / item.days.length * 10) / 10,
    firstId:item.firstId
  })).sort((left, right) => right.averageDays - left.averageDays || right.invoiceCount - left.invoiceCount ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || left.firstId.localeCompare(right.firstId))[0] || null;
}

export function calculateUpcomingBills(bills = [], referenceDate = new Date()){
  const today = dayNumber(referenceDate);
  if(today === null) return null;
  const qualifying = (Array.isArray(bills) ? bills : []).filter(bill => {
    const due = dayNumber(bill?.dueDate);
    const amount = finiteMoney(bill?.total ?? bill?.gross ?? bill?.amount);
    return String(bill?.status || "").trim().toLowerCase() !== "paid" && amount !== null && due !== null && due >= today && due <= today + 7;
  });
  const amount = roundMoney(qualifying.reduce((sum, bill) => sum + finiteMoney(bill?.total ?? bill?.gross ?? bill?.amount), 0));
  return qualifying.length ? { count:qualifying.length, amount } : null;
}

export function calculateVatPosition(journals = [], vatRegistered = false, period = {}, accountingAvailable = true){
  if(!vatRegistered) return { state:"not-registered" };
  if(!accountingAvailable) return { state:"insufficient-data" };
  let output = 0;
  let input = 0;
  let qualifyingLines = 0;
  for(const journal of Array.isArray(journals) ? journals : []){
    if(!inRange(journal?.date, period.currentStart, period.currentEnd) || !Array.isArray(journal?.lines)) continue;
    for(const line of journal.lines){
      const code = String(line?.accountCode || "").trim();
      const debit = Number(line?.debit);
      const credit = Number(line?.credit);
      if(![debit, credit].every(value => Number.isFinite(value) && value >= 0)) continue;
      if(code === "2100") { output += credit - debit; qualifyingLines += 1; }
      if(code === "1200") { input += debit - credit; qualifyingLines += 1; }
    }
  }
  if(!qualifyingLines) return { state:"insufficient-data" };
  const amount = roundMoney(output - input);
  return { state:Math.abs(amount) < 0.01 ? "nil" : amount > 0 ? "payable" : "reclaimable", amount:Math.abs(amount), output:roundMoney(output), input:roundMoney(input) };
}

export function buildActionableInsights(data = {}, options = {}){
  const period = options.period || {};
  const money = options.formatMoney || (value => String(value));
  const percent = value => `${Number(value).toLocaleString("en-GB", { maximumFractionDigits:1 })}%`;
  const results = [];
  const upcoming = calculateUpcomingBills(data.bills, options.referenceDate);
  if(upcoming) results.push(insight("upcoming-bills", "Cash flow", "attention", "Supplier bills are due soon", `${upcoming.count} supplier ${upcoming.count === 1 ? "bill" : "bills"} totalling ${money(upcoming.amount)} ${upcoming.count === 1 ? "is" : "are"} due within the next 7 days.`, "/resources/tools/bills.html", "An upcoming supplier bills insight is available."));
  const slowest = calculateSlowestPayingCustomer(data.invoices);
  if(slowest) results.push(insight("slowest-customer", "Payment timing", "attention", `${slowest.name} has the longest recorded payment time`, `${slowest.name} takes an average of ${slowest.averageDays.toLocaleString("en-GB", { maximumFractionDigits:1 })} days to pay across ${slowest.invoiceCount} recorded invoices.`, "/resources/tools/invoice-generator.html", "A customer payment timing insight is available."));
  const projects = selectProjectPerformance(options.projectSummaries);
  if(projects.lowest){
    const loss = projects.lowest.profit < 0;
    results.push(insight("lowest-project", "Project profitability", loss ? "attention" : "neutral", `${projects.lowest.name} has the lowest active-project margin`, `${projects.lowest.name} has a recorded ${loss ? "loss" : "profit"} of ${money(Math.abs(projects.lowest.profit))} and a ${percent(projects.lowest.margin)} margin.`, `/resources/tools/project-details.html?id=${encodeURIComponent(projects.lowest.id)}`, "A project profitability recommendation is available."));
  }
  const vat = calculateVatPosition(data.journals, options.vatRegistered, period, data.accountingAvailable !== false);
  if(!["not-registered", "insufficient-data"].includes(vat.state)){
    const headline = vat.state === "payable" ? "Estimated VAT is payable" : vat.state === "reclaimable" ? "Estimated VAT is reclaimable" : "Estimated VAT is approximately nil";
    const amountText = vat.state === "nil" ? "The recorded VAT position is approximately nil." : `The estimated VAT ${vat.state === "payable" ? "payable" : "reclaimable"} is ${money(vat.amount)}.`;
    results.push(insight("vat-position", "VAT estimate", vat.state === "payable" ? "neutral" : "opportunity", headline, `${amountText} Estimate based on recorded Simple Books transactions; review before filing.`, "/resources/tools/profit-loss.html", "A VAT position estimate is available."));
  }
  const top = calculateTopCustomer(data.invoices, period);
  if(top) results.push(insight("top-customer", "Revenue concentration", "opportunity", `${top.name} is the top customer by recorded revenue`, `${top.name} generated ${money(top.amount)}, representing ${percent(top.percentage)} of recorded revenue this month.`, "/resources/tools/invoice-generator.html", "A customer concentration insight is available."));
  const category = calculateLargestExpenseCategory(data.expenses, period);
  if(category) results.push(insight("expense-category", "Expense mix", "neutral", `${category.category} is the largest expense category`, `${category.category} totalled ${money(category.amount)}, representing ${percent(category.percentage)} of recorded expenses this month.`, "/resources/tools/expenses.html", "An expense category insight is available."));
  if(projects.best) results.push(insight("best-project", "Project profitability", "positive", `${projects.best.name} is the strongest active project`, `${projects.best.name} has ${money(projects.best.profit)} profit and a ${percent(projects.best.margin)} margin.`, `/resources/tools/project-details.html?id=${encodeURIComponent(projects.best.id)}`, "A strong project performance insight is available."));
  return Object.freeze({
    recommendations:Object.freeze(results.sort((left, right) => INSIGHT_ORDER.indexOf(left.id) - INSIGHT_ORDER.indexOf(right.id)).slice(0, 6)),
    teasers:Object.freeze(results.map(item => item.teaser).filter((value, index, values) => values.indexOf(value) === index).slice(0, 2)),
    vatState:vat.state
  });
}
