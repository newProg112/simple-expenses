import { auth, functions } from "/firebase-config.js";
import { adminAccessDecision } from "./admin-access.js";
import {
  adminMetricsErrorState,
  formatAdminDate,
  formatEstimatedMrr,
  formatSubscriptionStatus,
  safeMetricCount
} from "./admin-metrics-view.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const stateIds = ["checkingState", "signedOutState", "deniedState", "errorState"];
const metricValueIds = [
  "totalUsersValue",
  "starterUsersValue",
  "proUsersValue",
  "estimatedMrrValue",
  "activePaidValue",
  "aiUsageValue",
  "scanUsageValue"
];
const adminContent = document.getElementById("adminContent");
const metricsData = document.getElementById("metricsData");
const metricsLoading = document.getElementById("metricsLoading");
const metricsFailure = document.getElementById("metricsFailure");
const metricsFailureTitle = document.getElementById("metricsFailureTitle");
const metricsFailureMessage = document.getElementById("metricsFailureMessage");
const recentSignupsBody = document.getElementById("recentSignupsBody");
const refreshMetricsButton = document.getElementById("refreshMetricsButton");
const metricsUpdatedAt = document.getElementById("metricsUpdatedAt");
const callGetAdminMetrics = httpsCallable(functions, "getAdminMetrics");
let metricsRequest = null;
let authGeneration = 0;
let resolvedAuthUid = "";
let currentAdminUser = null;

function showState(stateId){
  for(const id of stateIds){
    document.getElementById(id).hidden = id !== stateId;
  }
  currentAdminUser = null;
  adminContent.hidden = true;
  window.SimpleBooksAppShell?.setVisible(false);
}

function showAdminDashboard(){
  for(const id of stateIds){
    document.getElementById(id).hidden = true;
  }
  adminContent.hidden = false;
  window.SimpleBooksAppShell?.setVisible(true);
}

function clearRenderedMetrics(){
  for(const id of metricValueIds){
    document.getElementById(id).textContent = "—";
  }
  recentSignupsBody.replaceChildren();
  metricsUpdatedAt.textContent = "";
  metricsData.hidden = true;
}

function setMetricsLoading(){
  clearRenderedMetrics();
  metricsFailure.hidden = true;
  metricsLoading.hidden = false;
  refreshMetricsButton.disabled = true;
  refreshMetricsButton.textContent = "Refreshing…";
}

function createTableCell(label, value){
  const cell = document.createElement("td");
  cell.dataset.label = label;
  cell.textContent = value;
  return cell;
}

function renderRecentSignups(signups){
  recentSignupsBody.replaceChildren();
  if(!Array.isArray(signups) || signups.length === 0){
    const row = document.createElement("tr");
    const cell = createTableCell(
      "Recent signups",
      "No non-demo users are available yet."
    );
    cell.colSpan = 6;
    row.append(cell);
    recentSignupsBody.append(row);
    return;
  }

  for(const signup of signups.slice(0, 10)){
    const row = document.createElement("tr");
    const statusCell = createTableCell(
      "Subscription status",
      formatSubscriptionStatus(signup?.subscriptionStatus)
    );
    statusCell.className = "subscription-status-cell";
    row.append(
      createTableCell("User", String(signup?.email || "Not available")),
      createTableCell("Plan", signup?.plan === "Pro" ? "Pro" : "Starter"),
      createTableCell("Joined", formatAdminDate(signup?.joinedAt)),
      statusCell,
      createTableCell("AI usage", String(safeMetricCount(signup?.aiAssistantSuccessfulUses))),
      createTableCell("Scan usage", String(safeMetricCount(signup?.invoiceScanningSuccessfulUses)))
    );
    recentSignupsBody.append(row);
  }
}

function renderAdminMetrics(payload){
  const metrics = payload?.metrics || {};
  document.getElementById("totalUsersValue").textContent =
    String(safeMetricCount(metrics.totalUsers));
  document.getElementById("starterUsersValue").textContent =
    String(safeMetricCount(metrics.starterUsers));
  document.getElementById("proUsersValue").textContent =
    String(safeMetricCount(metrics.proUsers));
  document.getElementById("estimatedMrrValue").textContent =
    formatEstimatedMrr(metrics.estimatedMrrPence, metrics.currency);
  document.getElementById("activePaidValue").textContent =
    String(safeMetricCount(metrics.activePaidSubscriptions));
  document.getElementById("aiUsageValue").textContent =
    String(safeMetricCount(metrics.aiAssistantSuccessfulUses));
  document.getElementById("scanUsageValue").textContent =
    String(safeMetricCount(metrics.invoiceScanningSuccessfulUses));
  renderRecentSignups(payload?.recentSignups);
  metricsUpdatedAt.textContent = payload?.generatedAt
    ? `Updated ${formatAdminDate(payload.generatedAt)} · Usage month ${String(payload.monthKey || "")}`
    : "Metrics loaded";
  metricsLoading.hidden = true;
  metricsFailure.hidden = true;
  metricsData.hidden = false;
}

function showMetricsFailure(error){
  clearRenderedMetrics();
  metricsLoading.hidden = true;
  const state = adminMetricsErrorState(error);

  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }

  metricsFailureTitle.textContent = state.title;
  metricsFailureMessage.textContent = state.message;
  metricsFailure.hidden = false;
}

function loadAdminMetrics(){
  if(metricsRequest || !currentAdminUser) return metricsRequest;
  const requestGeneration = authGeneration;
  setMetricsLoading();

  metricsRequest = callGetAdminMetrics({})
    .then(result => {
      if(requestGeneration === authGeneration && currentAdminUser){
        renderAdminMetrics(result.data);
      }
    })
    .catch(error => {
      if(requestGeneration === authGeneration){
        showMetricsFailure(error);
      }
    })
    .finally(() => {
      metricsRequest = null;
      if(requestGeneration === authGeneration && currentAdminUser){
        refreshMetricsButton.disabled = false;
        refreshMetricsButton.textContent = "Refresh";
      }
    });

  return metricsRequest;
}

refreshMetricsButton.addEventListener("click", () => loadAdminMetrics());

onAuthStateChanged(
  auth,
  user => {
    const nextAuthUid = user?.uid || "";
    if(nextAuthUid !== resolvedAuthUid){
      authGeneration += 1;
      resolvedAuthUid = nextAuthUid;
    }
    const decision = adminAccessDecision(user);

    if(decision === "signed-out"){
      showState("signedOutState");
      window.location.replace("/login.html");
      return;
    }
    if(decision === "denied"){
      showState("deniedState");
      return;
    }

    currentAdminUser = user;
    showAdminDashboard();
    loadAdminMetrics();
  },
  error => {
    authGeneration += 1;
    resolvedAuthUid = "";
    console.error("Admin authentication check failed", error);
    showState("errorState");
  }
);
