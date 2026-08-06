import { auth, db } from "/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildBusinessInsights } from "./business-insights-calculations.js?v=20260806-insights2";
import { createActivityIdempotencyKey, logActivityEvent } from "./activity-logger.js";
import {
  loadOwnedJournals,
  partialJournalDataMessage
} from "/resources/js/journal-source.js?v=20260806-insights2";

const COLLECTIONS = Object.freeze(["invoices", "bills", "expenses", "projects", "budgets"]);
const money = value => value === null ? "Not available" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value) || 0);
const number = value => new Intl.NumberFormat("en-GB").format(Number(value) || 0);

function escapeHtml(value){
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function rows(snapshot){
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
}

export async function loadBusinessInsightsData(user, services = { db, collection, getDocs, query, where }){
  const requests = COLLECTIONS.map(name => services.getDocs(services.collection(services.db, "users", user.uid, name)));
  requests.push(loadOwnedJournals(services.db, user.uid, services));
  const results = await Promise.allSettled(requests);
  const data = {};
  const failures = [];
  const notices = [];
  COLLECTIONS.forEach((name, index) => {
    if(results[index].status === "fulfilled") data[name] = rows(results[index].value);
    else { data[name] = []; failures.push(name); }
  });
  const journalResult = results[COLLECTIONS.length];
  if(journalResult.status === "fulfilled"){
    data.journals = journalResult.value.journals;
    data.accountingAvailable = true;
    if(journalResult.value.skippedCount){
      const count = journalResult.value.skippedCount;
      notices.push(`${count} malformed accounting ${count === 1 ? "journal was" : "journals were"} skipped`);
    }
  }else{
    data.journals = [];
    data.accountingAvailable = false;
    failures.push("accounting journals");
  }
  if(failures.length === results.length) throw new Error("No Business Insights data could be loaded.");
  return { data, failures, notices };
}

function renderHealth(health){
  const target = document.getElementById("healthContent");
  if(health.score === null){
    target.innerHTML = `<div class="insights-neutral"><strong>Not enough data yet</strong><p>${escapeHtml(health.explanation)}</p></div>`;
    return;
  }
  target.innerHTML = `<div class="score-layout">
    <div class="score-ring" role="img" aria-label="Business Health score ${health.score} out of 100, ${escapeHtml(health.status)}"><strong>${health.score}</strong><span>/ 100</span></div>
    <div><span class="status-badge status-${health.status.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(health.status)}</span><p>${escapeHtml(health.explanation)}</p></div>
  </div>
  <details class="calculation-details"><summary>View score breakdown</summary><ul>${health.components.map(item => `<li><span>${escapeHtml(item.label)}</span><strong>${item.points > 0 ? "+" : ""}${item.points} points</strong></li>`).join("")}</ul><p>The score starts at 60. Each component adds or deducts capped points, and the result is limited to 0–100.</p></details>`;
}

function renderPriorities(priorities){
  const target = document.getElementById("prioritiesContent");
  if(!priorities.length){
    target.innerHTML = `<div class="positive-empty"><strong>No urgent issues detected from the available data.</strong><p>Keep your records up to date to maintain this view.</p></div>`;
    return;
  }
  target.innerHTML = `<ol class="priority-list">${priorities.map(item => `<li class="priority priority-${item.severity}"><span class="severity">${escapeHtml(item.severity)}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p></div>${item.href ? `<a href="${escapeHtml(item.href)}">Review <span class="sr-only">${escapeHtml(item.title)}</span></a>` : ""}</li>`).join("")}</ol>`;
}

function trendCard(label, trend, helper){
  const movement = trend.direction === "none" ? "No comparison" : trend.direction === "flat" ? "No change" : `${trend.direction === "up" ? "Up" : "Down"}${trend.percentage === null ? "" : ` ${trend.percentage}%`}`;
  return `<article class="trend-card trend-${trend.favourability}" aria-label="${escapeHtml(label)}: ${escapeHtml(money(trend.current))}. ${escapeHtml(trend.comparisonText)}. ${escapeHtml(trend.favourability)} movement."><h3>${escapeHtml(label)}</h3><strong>${escapeHtml(money(trend.current))}</strong><p><span class="trend-direction">${escapeHtml(movement)}</span> — ${escapeHtml(trend.comparisonText)}</p><small>${escapeHtml(helper)}</small></article>`;
}

function renderTrends(trends){
  document.getElementById("trendsContent").innerHTML = [
    trendCard("Revenue", trends.revenue, "Higher revenue is generally favourable."),
    trendCard("Expenses", trends.expenses, "Lower expenses are treated as favourable."),
    trendCard("Profit", trends.profit, "Calculated from validated accounting journals."),
    trendCard("Outstanding invoices", trends.outstandingInvoices, "Lower outstanding value is treated as favourable.")
  ].join("");
}

function metric(label, value, note = ""){
  return `<div class="snapshot-metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function renderSnapshot(snapshot){
  document.getElementById("snapshotContent").innerHTML = [
    metric("Outstanding invoices", money(snapshot.outstandingInvoiceTotal)),
    metric("Overdue invoices", number(snapshot.overdueInvoiceCount), money(snapshot.overdueInvoiceValue)),
    metric("Unpaid bills", money(snapshot.unpaidBillsTotal)),
    metric("Month-to-date revenue", money(snapshot.currentMonthRevenue)),
    metric("Month-to-date expenses", money(snapshot.currentMonthExpenses)),
    metric(snapshot.currentMonthProfit !== null && snapshot.currentMonthProfit < 0 ? "Month-to-date loss" : "Month-to-date profit", money(snapshot.currentMonthProfit)),
    metric("Active projects", number(snapshot.activeProjects)),
    metric("Loss-making active projects", number(snapshot.lossMakingProjects)),
    metric("Budgets near or over limit", number(snapshot.pressuredBudgets))
  ].join("");
}

function renderEmpty(){
  document.getElementById("insightsMain").hidden = true;
  const empty = document.getElementById("emptyState");
  empty.hidden = false;
  empty.innerHTML = `<h2>Start building your business picture</h2><p>Add invoices, bills, expenses or projects to start seeing business insights.</p><div class="empty-actions"><a class="button" href="/resources/tools/invoice-generator.html">Add an invoice</a><a class="button secondary" href="/resources/tools/expenses.html">Add an expense</a><a class="button secondary" href="/resources/tools/projects.html">Add a project</a></div>`;
}

export function renderBusinessInsights(model, failures = [], notices = []){
  if(!model.hasData){ renderEmpty(); return; }
  renderHealth(model.health);
  renderPriorities(model.priorities);
  renderTrends(model.trends);
  renderSnapshot(model.snapshot);
  document.getElementById("insightsMain").hidden = false;
  const partialMessage = partialJournalDataMessage(failures, notices);
  if(partialMessage){
    const warning = document.getElementById("partialWarning");
    warning.hidden = false;
    warning.textContent = partialMessage;
  }
}

async function initialise(){
  const loading = document.getElementById("loadingState");
  const status = document.getElementById("pageStatus");
  try{
    const user = auth.currentUser || await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, current => { unsubscribe(); resolve(current); });
    });
    if(!user) return;
    const { data, failures, notices } = await loadBusinessInsightsData(user);
    if(notices.length) console.warn("Business Insights skipped malformed accounting journal records.");
    renderBusinessInsights(buildBusinessInsights(data), failures, notices);
    loading.hidden = true;
    status.textContent = failures.length || notices.length ? "Business Insights loaded with some partial data." : "Business Insights loaded.";
    const eventKey = createActivityIdempotencyKey();
    void logActivityEvent("business_insights_viewed", eventKey);
  }catch(error){
    console.error("Could not load Business Insights", error);
    loading.hidden = true;
    const errorState = document.getElementById("errorState");
    errorState.hidden = false;
    status.textContent = "Business Insights could not be loaded.";
  }
}

document.getElementById("retryInsights")?.addEventListener("click", () => window.location.reload());
void initialise();
