import { auth, db } from "/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  buildBusinessInsights,
  trendSentence
} from "./business-insights-calculations.js?v=20260806-insights-phase3";
import { createActivityIdempotencyKey, logActivityEvent } from "./activity-logger.js";
import { trackBeginCheckout } from "./analytics-events.js?v=20260802-analytics1";
import {
  businessInsightsPresentation,
  loadBusinessInsightsAccess
} from "./business-insights-access.js?v=20260902-stripe-live2";
import { loadBusinessInsightsData } from "./business-insights-data.js?v=20260807-dashboard-health1";
import {
  partialJournalDataMessage
} from "/resources/js/journal-source.js?v=20260806-insights2";
import { firebaseFunctionUrl } from "/resources/js/firebase-runtime.js";

const CHECKOUT_FUNCTION_URL = firebaseFunctionUrl("createCheckoutSession");
const money = value => value === null ? "Not available" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value) || 0);
const number = value => new Intl.NumberFormat("en-GB").format(Number(value) || 0);
let currentUser = null;
let checkoutOpening = false;
let upgradePromptLogged = false;
let upgradeClickLogged = false;
let actionableViewLogged = false;
let forecastsViewLogged = false;

function escapeHtml(value){
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function logUpgradePromptView(){
  if(upgradePromptLogged) return;
  upgradePromptLogged = true;
  void logActivityEvent("business_insights_upgrade_prompt_viewed", createActivityIdempotencyKey());
}

function renderHealth(health, showBreakdown){
  const target = document.getElementById("healthContent");
  if(health.score === null){
    target.innerHTML = `<div class="insights-neutral"><strong>Not enough data yet</strong><p>${escapeHtml(health.explanation)}</p></div>`;
    return;
  }
  target.innerHTML = `<div class="score-layout">
    <div class="score-ring" role="img" aria-label="Business Health score ${health.score} out of 100, ${escapeHtml(health.status)}"><strong>${health.score}</strong><span>/ 100</span></div>
    <div><span class="status-badge status-${health.status.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(health.status)}</span><p>${escapeHtml(health.explanation)}</p><p class="score-affects">Your score reflects overdue invoices, recent income and costs, profitability, projects and budget pressure.</p></div>
  </div>${showBreakdown ? `<details class="calculation-details"><summary>View score breakdown</summary><ul>${health.components.map(item => `<li><span>${escapeHtml(item.label)}</span><strong>${item.points > 0 ? "+" : ""}${item.points} points</strong></li>`).join("")}</ul><p>The score starts at 60. Each component adds or deducts capped points, and the result is limited to 0–100.</p></details>` : ""}`;
}

function renderPriorities(priorities){
  const target = document.getElementById("prioritiesContent");
  if(!priorities.length){
    target.innerHTML = `<div class="positive-empty"><strong>No urgent issues detected from the available data.</strong><p>Keep your records up to date to maintain this view.</p></div>`;
    return;
  }
  target.innerHTML = `<ol class="priority-list">${priorities.map(item => `<li class="priority priority-${item.severity}"><span class="severity">${escapeHtml(item.severity)}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.explanation)}</p></div>${item.href ? `<a href="${escapeHtml(item.href)}">Review <span class="sr-only">${escapeHtml(item.title)}</span></a>` : ""}</li>`).join("")}</ol>`;
}

function renderActionable(presentation){
  const detailedSection = document.getElementById("actionableSection");
  const previewSection = document.getElementById("actionablePreviewSection");
  detailedSection.hidden = !presentation.visibility.actionableDetails;
  previewSection.hidden = !presentation.visibility.actionablePreview;
  let rendered = false;
  if(presentation.visibility.actionableDetails){
    const recommendations = presentation.actionable;
    document.getElementById("actionableContent").innerHTML = recommendations.length
      ? `<div class="actionable-grid">${recommendations.map(item => `<article class="actionable-card actionable-${escapeHtml(item.status)}"><span class="insight-category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.headline)}</h3><p>${escapeHtml(item.supporting)}</p>${item.href ? `<a href="${escapeHtml(item.href)}">Review <span class="sr-only">${escapeHtml(item.headline)}</span></a>` : ""}</article>`).join("")}</div>`
      : `<div class="insights-neutral"><strong>No actionable recommendations are available yet.</strong><p>Add more invoices, bills, expenses, projects or VAT data.</p></div>`;
    rendered = recommendations.length > 0;
  }
  if(presentation.visibility.actionablePreview){
    const teasers = presentation.actionableTeasers;
    document.getElementById("actionablePreviewContent").innerHTML = teasers.length
      ? `<ul class="teaser-list">${teasers.map(teaser => `<li>${escapeHtml(teaser)}</li>`).join("")}</ul>`
      : `<p class="teaser-empty">Add more records to unlock personalised recommendations.</p>`;
    rendered = teasers.length > 0;
  }
  if(rendered && !actionableViewLogged){
    actionableViewLogged = true;
    void logActivityEvent("business_insights_actionable_viewed", createActivityIdempotencyKey());
  }
}

function renderForecasts(presentation){
  const detailedSection = document.getElementById("forecastsSection");
  const previewSection = document.getElementById("forecastPreviewSection");
  detailedSection.hidden = !presentation.visibility.forecastDetails;
  previewSection.hidden = !presentation.visibility.forecastPreview;
  let meaningful = false;
  if(presentation.visibility.forecastDetails){
    const cards = presentation.forecasts;
    document.getElementById("forecastsContent").innerHTML = `<div class="forecast-grid">${cards.map(card => `<article class="forecast-card forecast-${escapeHtml(card.status)}"><span class="forecast-label">${escapeHtml(card.label)}</span><h3>${escapeHtml(card.title)}</h3><strong class="forecast-value">${escapeHtml(card.value)}</strong><p>${escapeHtml(card.explanation)}</p><small>${escapeHtml(card.basis)}</small>${card.href ? `<a href="${escapeHtml(card.href)}">Review <span class="sr-only">${escapeHtml(card.title)}</span></a>` : ""}</article>`).join("")}</div>`;
    meaningful = cards.some(card => card.available);
  }
  if(presentation.visibility.forecastPreview){
    const teasers = presentation.forecastTeasers;
    document.getElementById("forecastPreviewContent").innerHTML = teasers.length
      ? `<ul class="teaser-list">${teasers.map(teaser => `<li>${escapeHtml(teaser)}</li>`).join("")}</ul>`
      : `<p class="teaser-empty">Add more current records to unlock forecast projections.</p>`;
    meaningful = teasers.length > 0;
  }
  if(meaningful && !forecastsViewLogged){
    forecastsViewLogged = true;
    void logActivityEvent("business_insights_forecasts_viewed", createActivityIdempotencyKey());
  }
}

function trendCard(label, trend, helper){
  const sentence = trendSentence(trend);
  return `<article class="trend-card trend-${trend.favourability}" aria-label="${escapeHtml(label)}: ${escapeHtml(money(trend.current))}. ${escapeHtml(sentence)} ${escapeHtml(trend.favourability)} movement."><h3>${escapeHtml(label)}</h3><strong>${escapeHtml(money(trend.current))}</strong><p class="trend-direction">${escapeHtml(sentence)}</p><small>${escapeHtml(helper)}</small></article>`;
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

function renderSnapshot(snapshot, visibility){
  const target = document.getElementById("snapshotContent");
  target.classList.toggle("snapshot-grid-starter", visibility.snapshotLayout === "compact");
  const preview = [
    metric("Outstanding invoices", money(snapshot.outstandingInvoiceTotal)),
    metric("Overdue invoices", number(snapshot.overdueInvoiceCount), money(snapshot.overdueInvoiceValue)),
    metric("Unpaid bills", money(snapshot.unpaidBillsTotal)),
    metric("Active projects", number(snapshot.activeProjects))
  ];
  if(!visibility.fullSnapshot){
    target.innerHTML = preview.join("");
    return;
  }
  const full = [
    ...preview.slice(0, 3),
    metric("Month-to-date revenue", money(snapshot.currentMonthRevenue)),
    metric("Month-to-date expenses", money(snapshot.currentMonthExpenses)),
    metric(snapshot.currentMonthProfit !== null && snapshot.currentMonthProfit < 0 ? "Month-to-date loss" : "Month-to-date profit", money(snapshot.currentMonthProfit)),
    preview[3],
    metric("Loss-making active projects", number(snapshot.lossMakingProjects)),
    metric("Budgets near or over limit", number(snapshot.pressuredBudgets))
  ];
  target.innerHTML = full.join("");
}

function renderEmpty(){
  document.getElementById("insightsMain").hidden = true;
  const empty = document.getElementById("emptyState");
  empty.hidden = false;
  empty.innerHTML = `<h2>Start building your business picture</h2><p>Add invoices, bills, expenses or projects to start seeing business insights.</p><div class="empty-actions"><a class="button" href="/resources/tools/invoice-generator.html">Add an invoice</a><a class="button secondary" href="/resources/tools/expenses.html">Add an expense</a><a class="button secondary" href="/resources/tools/projects.html">Add a project</a></div>`;
}

export function renderBusinessInsights(model, access, failures = [], notices = []){
  const presentation = businessInsightsPresentation(model, access);
  const visibility = presentation.visibility;
  const accessLabel = document.getElementById("pageAccessLabel");
  accessLabel.hidden = !access.demo;
  accessLabel.textContent = access.demo ? "Pro Demo · Not billed" : "";
  if(!model.hasData){
    renderEmpty();
    renderActionable(presentation);
    renderForecasts(presentation);
    const empty = document.getElementById("emptyState");
    const upgrade = document.getElementById("insightsUpgradePanel");
    upgrade.hidden = !visibility.upgradePrompt;
    const actionable = visibility.actionableDetails
      ? document.getElementById("actionableSection")
      : document.getElementById("actionablePreviewSection");
    const forecasts = visibility.forecastDetails
      ? document.getElementById("forecastsSection")
      : document.getElementById("forecastPreviewSection");
    empty.after(actionable, forecasts, ...(visibility.upgradePrompt ? [upgrade] : []));
    const partialMessage = partialJournalDataMessage(failures, notices);
    if(partialMessage){
      const warning = document.getElementById("partialWarning");
      warning.hidden = false;
      warning.textContent = partialMessage;
      empty.before(warning);
    }
    if(visibility.upgradePrompt) logUpgradePromptView();
    return;
  }
  renderHealth(model.health, visibility.scoreBreakdown);
  renderPriorities(presentation.priorities);
  renderActionable(presentation);
  renderForecasts(presentation);
  renderSnapshot(presentation.snapshot, visibility);
  document.getElementById("prioritiesIntro").textContent = visibility.fullAccess
    ? "Up to five current items, ordered by severity and value."
    : "Your two highest-priority items from the available data.";
  document.getElementById("trendsSection").hidden = !visibility.trends;
  document.getElementById("methodologySection").hidden = !visibility.methodology;
  const upgradePanel = document.getElementById("insightsUpgradePanel");
  upgradePanel.hidden = !visibility.upgradePrompt;
  if(visibility.trends) renderTrends(model.trends);
  document.getElementById("insightsMain").hidden = false;
  const partialMessage = partialJournalDataMessage(failures, notices);
  if(partialMessage){
    const warning = document.getElementById("partialWarning");
    warning.hidden = false;
    warning.textContent = partialMessage;
  }
  if(visibility.upgradePrompt) logUpgradePromptView();
}

async function startBusinessInsightsCheckout(){
  if(checkoutOpening || !currentUser) return;
  const button = document.getElementById("upgradeInsightsButton");
  const checkoutStatus = document.getElementById("upgradeCheckoutStatus");
  checkoutOpening = true;
  button.disabled = true;
  button.textContent = "Opening…";
  checkoutStatus.classList.remove("error");
  checkoutStatus.textContent = "Opening secure Stripe Checkout. Please wait…";
  if(!upgradeClickLogged){
    upgradeClickLogged = true;
    void logActivityEvent("business_insights_upgrade_clicked", createActivityIdempotencyKey());
  }
  let redirecting = false;
  try{
    const idToken = await currentUser.getIdToken();
    const response = await fetch(CHECKOUT_FUNCTION_URL, {
      method:"POST",
      headers:{ "Authorization":`Bearer ${idToken}`, "Content-Type":"application/json" }
    });
    if(!response.ok) throw new Error("Checkout session could not be created.");
    const session = await response.json();
    if(!session.url) throw new Error("Checkout session URL was missing.");
    await trackBeginCheckout();
    redirecting = true;
    window.location.href = session.url;
  }catch(error){
    console.error("Business Insights Stripe Checkout start failed", error);
    checkoutStatus.textContent = "Sorry, checkout could not be started. Please try again.";
    checkoutStatus.classList.add("error");
  }finally{
    if(!redirecting){
      checkoutOpening = false;
      button.disabled = false;
      button.textContent = "Upgrade to Pro";
    }
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
    currentUser = user;
    const accessPromise = loadBusinessInsightsAccess(user, { db, doc, getDoc }).catch(cause => {
      const error = new Error("Business Insights access could not be resolved.", { cause });
      error.code = "business-insights-access-unavailable";
      throw error;
    });
    const [{ data, failures, notices }, access] = await Promise.all([
      loadBusinessInsightsData(user, { db, collection, getDocs, query, where }),
      accessPromise
    ]);
    if(notices.length) console.warn("Business Insights skipped malformed accounting journal records.");
    renderBusinessInsights(buildBusinessInsights({ ...data, vatRegistered:access.vatRegistered }), access, failures, notices);
    loading.hidden = true;
    status.textContent = failures.length || notices.length ? "Business Insights loaded with some partial data." : "Business Insights loaded.";
    void logActivityEvent("business_insights_viewed", createActivityIdempotencyKey());
  }catch(error){
    console.error("Could not resolve Business Insights access or data", error);
    loading.hidden = true;
    const errorState = document.getElementById("errorState");
    const accessFailure = error?.code === "business-insights-access-unavailable";
    document.getElementById("errorTitle").textContent = accessFailure
      ? "We could not confirm your Business Insights access"
      : "We could not load Business Insights";
    document.getElementById("errorMessage").textContent = accessFailure
      ? "Your plan access could not be confirmed. Check your connection and try again."
      : "Your records have not been changed. Check your connection and try again.";
    errorState.hidden = false;
    status.textContent = "Business Insights access or data could not be loaded.";
  }
}

document.getElementById("retryInsights")?.addEventListener("click", () => window.location.reload());
document.getElementById("upgradeInsightsButton")?.addEventListener("click", startBusinessInsightsCheckout);
void initialise();
