import { normaliseInvoiceDate, roundMoney } from "/resources/js/business-logic.js";
import { profitLossViewFromJournals } from "/resources/js/profit-loss-view.js";
import { calculateVatPosition } from "./business-insights-actionable.js";

const DAY_MS = 86400000;

function dayNumber(value){
  const date = normaliseInvoiceDate(value).date;
  return date ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS : null;
}

function dateInput(value){
  return normaliseInvoiceDate(value).inputValue;
}

function validMoney(value){
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveMoney(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cleanName(value){
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name && !/^unnamed\b/i.test(name) ? name : "";
}

function normalizedName(value){
  return cleanName(value).toLocaleLowerCase("en-GB");
}

function currentMonth(referenceDate){
  const reference = normaliseInvoiceDate(referenceDate).date;
  if(!reference) return null;
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const totalDays = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  const previousStart = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  const previousDays = new Date(reference.getFullYear(), reference.getMonth(), 0).getDate();
  const previousEnd = new Date(previousStart.getFullYear(), previousStart.getMonth(), Math.min(reference.getDate(), previousDays));
  return { start, end, elapsedDays:reference.getDate(), totalDays, previousStart, previousEnd };
}

function report(journals, start, end){
  return profitLossViewFromJournals(journals, { dateFrom:dateInput(start), dateTo:dateInput(end) });
}

export function calculateMonthEndForecasts(journals = [], referenceDate = new Date(), accountingAvailable = true){
  const period = currentMonth(referenceDate);
  if(!accountingAvailable) return { state:"source-unavailable", revenue:null, expenses:null, profit:null, period };
  if(!period || period.elapsedDays <= 0 || period.totalDays < period.elapsedDays) return { state:"calculation-unavailable", revenue:null, expenses:null, profit:null, period };
  const current = report(Array.isArray(journals) ? journals : [], period.start, period.end);
  const previous = report(Array.isArray(journals) ? journals : [], period.previousStart, period.previousEnd);
  if(["error", "invalidDate"].includes(current.state)) return { state:"calculation-unavailable", revenue:null, expenses:null, profit:null, period };
  const projection = (value, qualifying) => qualifying ? roundMoney(value / period.elapsedDays * period.totalDays) : null;
  const revenue = current.incomeRows?.length ? {
    state:"available", toDate:roundMoney(current.totalIncome), projected:projection(current.totalIncome, true),
    dailyAverage:roundMoney(current.totalIncome / period.elapsedDays), comparison:null
  } : { state:"insufficient-data" };
  const expenses = current.expenseRows?.length ? {
    state:"available", toDate:roundMoney(current.totalExpenses), projected:projection(current.totalExpenses, true),
    dailyAverage:roundMoney(current.totalExpenses / period.elapsedDays), comparison:null
  } : { state:"insufficient-data" };
  if(revenue.state === "available" && previous.incomeRows?.length){
    const previousValue = roundMoney(previous.totalIncome);
    revenue.comparison = previousValue === 0 ? null : {
      previous:previousValue,
      percentage:Math.round((revenue.toDate - previousValue) / Math.abs(previousValue) * 1000) / 10
    };
  }
  if(expenses.state === "available" && previous.expenseRows?.length){
    const previousValue = roundMoney(previous.totalExpenses);
    expenses.comparison = previousValue === 0 ? null : {
      previous:previousValue,
      percentage:Math.round((expenses.toDate - previousValue) / Math.abs(previousValue) * 1000) / 10
    };
  }
  const profit = revenue.state === "available" && expenses.state === "available"
    ? { state:"available", projected:roundMoney(revenue.projected - expenses.projected) }
    : { state:"insufficient-data" };
  return { state:"available", revenue, expenses, profit, period };
}

export function calculateObligationForecast(bills = [], referenceDate = new Date(), sourceAvailable = true){
  if(!sourceAvailable) return { state:"source-unavailable" };
  const today = dayNumber(referenceDate);
  if(today === null) return { state:"calculation-unavailable" };
  const buckets = { overdue:[], next7:[], days8To30:[] };
  for(const bill of Array.isArray(bills) ? bills : []){
    if(String(bill?.status || "").trim().toLowerCase() === "paid") continue;
    const due = dayNumber(bill?.dueDate);
    const amount = positiveMoney(bill?.total ?? bill?.gross ?? bill?.amount);
    if(due === null || amount === null) continue;
    if(due < today) buckets.overdue.push(amount);
    else if(due <= today + 7) buckets.next7.push(amount);
    else if(due <= today + 30) buckets.days8To30.push(amount);
  }
  const total = values => roundMoney(values.reduce((sum, value) => sum + value, 0));
  return {
    state:"available",
    overdue:{ count:buckets.overdue.length, amount:total(buckets.overdue) },
    next7:{ count:buckets.next7.length, amount:total(buckets.next7) },
    days8To30:{ count:buckets.days8To30.length, amount:total(buckets.days8To30) }
  };
}

export function calculateBudgetForecasts(budgetSummaries = [], budgets = [], referenceDate = new Date(), sourceAvailable = true){
  if(!sourceAvailable) return { state:"source-unavailable", budgets:[] };
  const today = dayNumber(referenceDate);
  if(today === null) return { state:"calculation-unavailable", budgets:[] };
  const sourceById = new Map((Array.isArray(budgets) ? budgets : []).map(item => [String(item?.id || ""), item]));
  const forecasts = [];
  for(const summary of Array.isArray(budgetSummaries) ? budgetSummaries : []){
    const source = sourceById.get(String(summary?.id || "")) || {};
    if(String(summary?.status || "").trim().toLowerCase() !== "active") continue;
    const start = dayNumber(source?.startDate);
    const end = dayNumber(source?.endDate);
    const planned = positiveMoney(summary?.planned);
    const spent = validMoney(summary?.actual);
    if(start === null || end === null || end < start || planned === null || spent === null || spent === 0 || today < start || today > end) continue;
    const totalDays = end - start + 1;
    const elapsedDays = today - start + 1;
    if(totalDays <= 0 || elapsedDays <= 0) continue;
    const projected = roundMoney(spent / elapsedDays * totalDays);
    const difference = roundMoney(projected - planned);
    forecasts.push({
      id:String(summary.id || ""), name:cleanName(summary.name) || "Budget", planned:roundMoney(planned), spent:roundMoney(spent),
      percentageUsed:Math.round(spent / planned * 1000) / 10,
      percentageElapsed:Math.round(elapsedDays / totalDays * 1000) / 10,
      projected, difference, status:difference > 0 ? "projected-over" : "on-track"
    });
  }
  forecasts.sort((left, right) => right.difference - left.difference || right.projected - left.projected ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || left.id.localeCompare(right.id));
  return {
    state:forecasts.length ? "available" : "insufficient-data",
    budgets:forecasts,
    selected:forecasts[0] || null,
    projectedOverCount:forecasts.filter(item => item.difference > 0).length,
    onTrackCount:forecasts.filter(item => item.difference <= 0).length
  };
}

export function calculatePaymentBehaviour(invoices = [], referenceDate = new Date(), sourceAvailable = true){
  if(!sourceAvailable) return { state:"source-unavailable", customers:[] };
  const today = dayNumber(referenceDate);
  if(today === null) return { state:"calculation-unavailable", customers:[] };
  const groups = new Map();
  for(const invoice of Array.isArray(invoices) ? invoices : []){
    const name = cleanName(invoice?.client || invoice?.clientName || invoice?.customerName);
    if(!name) continue;
    const key = normalizedName(name);
    const group = groups.get(key) || { name, id:String(invoice?.id || ""), paid:[], overdue:0 };
    if(name.localeCompare(group.name, "en-GB") < 0) group.name = name;
    group.id = [group.id, String(invoice?.id || "")].filter(Boolean).sort()[0] || "";
    const issued = dayNumber(invoice?.date || invoice?.invoiceDate || invoice?.createdAt);
    const due = dayNumber(invoice?.dueDate);
    const paid = dayNumber(invoice?.paidAt || invoice?.paidDate || invoice?.paymentDate || invoice?.datePaid);
    if(String(invoice?.status || "").trim().toLowerCase() === "paid"){
      if(issued !== null && paid !== null && paid >= issued){
        group.paid.push({ daysToPay:paid - issued, daysAfterDue:due !== null ? paid - due : null, late:due !== null && paid > due });
      }
    }else if(due !== null && due < today){
      group.overdue += 1;
    }
    groups.set(key, group);
  }
  const customers = [...groups.values()].filter(group => group.paid.length >= 2).map(group => {
    const dueHistory = group.paid.filter(item => item.daysAfterDue !== null);
    const lateCount = group.paid.filter(item => item.late).length;
    const lateRatio = dueHistory.length ? lateCount / dueHistory.length : 0;
    const risk = group.overdue >= 2 || (dueHistory.length >= 2 && lateRatio >= 0.5)
      ? "Frequently late"
      : group.overdue > 0 || lateCount > 0 ? "Sometimes late" : "Usually on time";
    return {
      name:group.name, id:group.id, risk, invoiceCount:group.paid.length, latePaidCount:lateCount, overdueCount:group.overdue,
      averageDaysToPay:Math.round(group.paid.reduce((sum, item) => sum + item.daysToPay, 0) / group.paid.length * 10) / 10,
      averageDaysAfterDue:dueHistory.length ? Math.round(dueHistory.reduce((sum, item) => sum + item.daysAfterDue, 0) / dueHistory.length * 10) / 10 : null
    };
  });
  const severity = { "Frequently late":0, "Sometimes late":1, "Usually on time":2 };
  customers.sort((left, right) => severity[left.risk] - severity[right.risk] || right.overdueCount - left.overdueCount ||
    (right.averageDaysAfterDue ?? -Infinity) - (left.averageDaysAfterDue ?? -Infinity) || right.averageDaysToPay - left.averageDaysToPay ||
    normalizedName(left.name).localeCompare(normalizedName(right.name)) || left.id.localeCompare(right.id));
  return { state:customers.length ? "available" : "insufficient-history", customers, selected:customers[0] || null };
}

function forecastCard(id, label, title, value, status, explanation, basis, href, available = true){
  return Object.freeze({ id, label, title, value, status, explanation, basis, href, available });
}

export function buildForecasts(data = {}, options = {}){
  const money = options.formatMoney || (value => String(value));
  const availability = data.sourceAvailability || {};
  const month = calculateMonthEndForecasts(data.journals, options.referenceDate, data.accountingAvailable !== false);
  const obligations = calculateObligationForecast(data.bills, options.referenceDate, availability.bills !== false);
  const budgets = calculateBudgetForecasts(options.budgetSummaries, data.budgets, options.referenceDate, availability.budgets !== false);
  const payments = calculatePaymentBehaviour(data.invoices, options.referenceDate, availability.invoices !== false);
  const vat = calculateVatPosition(data.journals, options.vatRegistered, options.period, data.accountingAvailable !== false);
  const unavailable = (id, label, title, text, href) => forecastCard(id, label, title, "Unavailable", "unavailable", text, "More reliable source data is required.", href, false);
  const journalUnavailableText = type => month.state === "source-unavailable"
    ? "Accounting journals could not be loaded."
    : month.state === "calculation-unavailable"
      ? "The available accounting journals could not be calculated safely."
      : `No qualifying current-month ${type} journals were recorded.`;
  const cards = [];
  cards.push(month.revenue?.state === "available"
    ? forecastCard("revenue", "Projection", "Expected month-end revenue", money(month.revenue.projected), "positive", `${money(month.revenue.toDate)} recorded over ${month.period.elapsedDays} elapsed days.${month.revenue.comparison ? ` That is ${Math.abs(month.revenue.comparison.percentage)}% ${month.revenue.comparison.percentage >= 0 ? "higher" : "lower"} than the equivalent previous-month period.` : " No equivalent-period comparison is available."}`, "Straight-line projection from validated journal revenue.", "/resources/tools/profit-loss.html")
    : unavailable("revenue", "Projection unavailable", "Expected month-end revenue", journalUnavailableText("revenue"), "/resources/tools/profit-loss.html"));
  cards.push(month.expenses?.state === "available"
    ? forecastCard("expenses", "Projection", "Expected month-end expenses", money(month.expenses.projected), "neutral", `${money(month.expenses.toDate)} recorded over ${month.period.elapsedDays} elapsed days.${month.expenses.comparison ? ` That is ${Math.abs(month.expenses.comparison.percentage)}% ${month.expenses.comparison.percentage >= 0 ? "higher" : "lower"} than the equivalent previous-month period.` : " No equivalent-period comparison is available."}`, "Straight-line projection from validated journal expenses.", "/resources/tools/profit-loss.html")
    : unavailable("expenses", "Projection unavailable", "Expected month-end expenses", journalUnavailableText("expense"), "/resources/tools/profit-loss.html"));
  cards.push(month.profit?.state === "available"
    ? forecastCard("profit", "Projection", "Expected month-end profit", money(month.profit.projected), month.profit.projected < 0 ? "negative" : "positive", "Projected revenue less projected expenses.", "Uses only the two validated journal projections above.", "/resources/tools/profit-loss.html")
    : unavailable("profit", "Projection unavailable", "Expected month-end profit", month.state === "source-unavailable" ? "Accounting journals could not be loaded." : "Both revenue and expense projections are required.", "/resources/tools/profit-loss.html"));
  cards.push(obligations.state === "available"
    ? forecastCard("obligations", "Recorded obligations", "Upcoming bills and obligations", money(roundMoney(obligations.next7.amount + obligations.days8To30.amount)), obligations.overdue.count ? "warning" : "neutral", `${obligations.next7.count} due in 0–7 days (${money(obligations.next7.amount)}); ${obligations.days8To30.count} due in 8–30 days (${money(obligations.days8To30.amount)}); ${obligations.overdue.count} overdue (${money(obligations.overdue.amount)}).`, "Unpaid gross bills in non-overlapping due-date buckets.", "/resources/tools/bills.html")
    : unavailable("obligations", obligations.state === "source-unavailable" ? "Source unavailable" : "Calculation unavailable", "Upcoming bills and obligations", obligations.state === "source-unavailable" ? "Bill records could not be loaded." : "The due-date buckets could not be calculated safely.", "/resources/tools/bills.html"));
  const vatText = vat.state === "payable" ? `Estimated payable: ${money(vat.amount)}` : vat.state === "reclaimable" ? `Estimated reclaimable: ${money(vat.amount)}` : vat.state === "nil" ? "Approximately nil" : "Unavailable";
  cards.push(!["not-registered", "insufficient-data"].includes(vat.state)
    ? forecastCard("vat", "Estimate", "Estimated VAT to set aside", vatText, vat.state === "payable" ? "warning" : "neutral", "Estimated from recorded Simple Books transactions. This is not a VAT return. Review before filing.", "Validated current-period VAT Output (2100) less VAT Input (1200).", "/resources/tools/profit-loss.html")
    : unavailable("vat", "Estimate unavailable", "Estimated VAT to set aside", vat.state === "not-registered" ? "The business is not recorded as VAT registered." : data.accountingAvailable === false ? "Accounting journals could not be loaded." : "Sufficient valid current-period VAT journals are not available.", "/resources/tools/profit-loss.html"));
  const selectedBudget = budgets.selected;
  cards.push(budgets.state === "available"
    ? forecastCard("budget", "Projection", "Budget month-end projection", money(selectedBudget.projected), selectedBudget.difference > 0 ? "negative" : "positive", `${selectedBudget.name} is projected ${selectedBudget.difference > 0 ? `${money(selectedBudget.difference)} over` : `${money(Math.abs(selectedBudget.difference))} under`} its ${money(selectedBudget.planned)} limit. ${budgets.projectedOverCount} qualifying budget${budgets.projectedOverCount === 1 ? " is" : "s are"} projected over; ${budgets.onTrackCount} on track.`, `${selectedBudget.percentageUsed}% used after ${selectedBudget.percentageElapsed}% of its period.`, "/resources/tools/budgets.html")
    : unavailable("budget", budgets.state === "source-unavailable" ? "Source unavailable" : budgets.state === "calculation-unavailable" ? "Calculation unavailable" : "Projection unavailable", "Budget month-end projection", budgets.state === "source-unavailable" ? "Budget records could not be loaded." : budgets.state === "calculation-unavailable" ? "The budget period could not be calculated safely." : "No active budget has valid dates, positive spend and a meaningful elapsed period.", "/resources/tools/budgets.html"));
  const customer = payments.selected;
  cards.push(payments.state === "available"
    ? forecastCard("payments", "Recorded behaviour", "Customer payment behaviour", customer.risk, customer.risk === "Frequently late" ? "warning" : customer.risk === "Usually on time" ? "positive" : "neutral", `${customer.name}: ${customer.invoiceCount} qualifying paid invoices, ${customer.latePaidCount} paid late and ${customer.overdueCount} currently overdue. Average payment time is ${customer.averageDaysToPay} days${customer.averageDaysAfterDue === null ? "." : `; average timing is ${Math.abs(customer.averageDaysAfterDue)} days ${customer.averageDaysAfterDue > 0 ? "after" : "before or on"} the due date.`}`, "Risk label is based only on recorded payment history.", "/resources/tools/invoice-generator.html")
    : unavailable("payments", payments.state === "source-unavailable" ? "Source unavailable" : payments.state === "calculation-unavailable" ? "Calculation unavailable" : "Insufficient history", "Customer payment behaviour", payments.state === "source-unavailable" ? "Invoice history could not be loaded." : payments.state === "calculation-unavailable" ? "Payment timing could not be calculated safely." : "At least two reliably dated paid invoices are required for a named customer.", "/resources/tools/invoice-generator.html"));
  cards.push(unavailable("cash", "Unavailable", "Cash outlook unavailable", "A reliable saved opening bank balance and recorded cash settlement movements are required.", "/resources/tools/cashflow.html"));
  const teasers = [
    month.revenue?.state === "available" ? "A month-end revenue projection is available." : "",
    month.expenses?.state === "available" ? "A month-end expense projection is available." : "",
    month.profit?.state === "available" ? "A month-end profit projection is available." : "",
    obligations.state === "available" && obligations.next7.count + obligations.days8To30.count + obligations.overdue.count > 0 ? "An upcoming obligations forecast is available." : "",
    !["not-registered", "insufficient-data"].includes(vat.state) ? "A VAT estimate is available." : "",
    budgets.state === "available" ? "A budget projection is available." : "",
    payments.state === "available" ? "A customer payment-behaviour forecast is available." : ""
  ].filter(Boolean).slice(0, 2);
  return Object.freeze({ cards:Object.freeze(cards), teasers:Object.freeze(teasers), meaningful:cards.some(card => card.available), calculations:Object.freeze({ month, obligations, vat, budgets, payments, cash:{ state:"unavailable-no-authoritative-source" } }) });
}
