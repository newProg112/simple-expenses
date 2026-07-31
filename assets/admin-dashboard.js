import { auth, functions } from "/firebase-config.js";
import { adminAccessDecision } from "./admin-access.js";
import {
  adminMetricsErrorState,
  adminUserDetailsErrorState,
  filterSignupsByEmail,
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
const customerSearch = document.getElementById("customerSearch");
const customerSearchStatus = document.getElementById("customerSearchStatus");
const customerPanelBackdrop = document.getElementById("customerPanelBackdrop");
const customerPanel = document.getElementById("customerPanel");
const customerPanelClose = document.getElementById("customerPanelClose");
const customerPanelLoading = document.getElementById("customerPanelLoading");
const customerPanelFailure = document.getElementById("customerPanelFailure");
const customerPanelFailureTitle = document.getElementById("customerPanelFailureTitle");
const customerPanelFailureMessage = document.getElementById("customerPanelFailureMessage");
const customerPanelData = document.getElementById("customerPanelData");
const refreshMetricsButton = document.getElementById("refreshMetricsButton");
const metricsUpdatedAt = document.getElementById("metricsUpdatedAt");
const callGetAdminMetrics = httpsCallable(functions, "getAdminMetrics");
const callGetAdminUserDetails = httpsCallable(functions, "getAdminUserDetails");
let metricsRequest = null;
let customerDetailsRequest = 0;
let recentSignupRecords = [];
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
  recentSignupRecords = [];
  customerSearchStatus.textContent = "";
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
      recentSignupRecords.length === 0
        ? "No non-demo users are available yet."
        : "No recent signups match that email."
    );
    cell.colSpan = 6;
    row.append(cell);
    recentSignupsBody.append(row);
    return;
  }

  for(const signup of signups.slice(0, 10)){
    const row = document.createElement("tr");
    row.className = "customer-row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `View customer summary for ${String(signup?.email || "this customer")}`);
    const openRow = () => openCustomerSummary(String(signup?.email || ""));
    row.addEventListener("click", openRow);
    row.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        openRow();
      }
    });
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
  recentSignupRecords = Array.isArray(payload?.recentSignups)
    ? payload.recentSignups.slice(0, 10)
    : [];
  renderFilteredRecentSignups();
  metricsUpdatedAt.textContent = payload?.generatedAt
    ? `Updated ${formatAdminDate(payload.generatedAt)} · Usage month ${String(payload.monthKey || "")}`
    : "Metrics loaded";
  metricsLoading.hidden = true;
  metricsFailure.hidden = true;
  metricsData.hidden = false;
}

function renderFilteredRecentSignups(){
  const filtered = filterSignupsByEmail(
    recentSignupRecords,
    customerSearch.value
  );
  renderRecentSignups(filtered);
  customerSearchStatus.textContent = recentSignupRecords.length === 0
    ? ""
    : `${filtered.length} of ${recentSignupRecords.length} recent signups shown`;
}

function setCustomerPanelState(state){
  customerPanelLoading.hidden = state !== "loading";
  customerPanelFailure.hidden = state !== "failure";
  customerPanelData.hidden = state !== "data";
}

function closeCustomerPanel(){
  customerDetailsRequest += 1;
  customerPanel.hidden = true;
  customerPanelBackdrop.hidden = true;
  document.body.classList.remove("customer-panel-open");
}

function renderCustomerDetails(details){
  document.getElementById("customerEmailValue").textContent = String(details?.email || "Not available");
  document.getElementById("customerPlanValue").textContent = details?.plan === "Pro" ? "Pro" : "Starter";
  document.getElementById("customerSubscriptionValue").textContent = formatSubscriptionStatus(details?.subscriptionStatus);
  document.getElementById("customerCreatedValue").textContent = formatAdminDate(details?.createdDate);
  document.getElementById("customerLastSignInValue").textContent = formatAdminDate(details?.lastSignInTime);
  document.getElementById("customerAiUsageValue").textContent = String(safeMetricCount(details?.aiAssistantSuccessfulUses));
  document.getElementById("customerScanUsageValue").textContent = String(safeMetricCount(details?.invoiceScanningSuccessfulUses));
  document.getElementById("customerPeriodEndValue").textContent = formatAdminDate(details?.currentPeriodEnd);
  document.getElementById("customerStripeValue").textContent = details?.stripeCustomerPresent === true ? "Yes" : "No";
  setCustomerPanelState("data");
}

function showCustomerPanelFailure(error){
  const state = adminUserDetailsErrorState(error);
  if(state.kind === "unauthenticated"){
    closeCustomerPanel();
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    closeCustomerPanel();
    showState("deniedState");
    return;
  }
  customerPanelFailureTitle.textContent = state.title;
  customerPanelFailureMessage.textContent = state.message;
  setCustomerPanelState("failure");
}

function openCustomerSummary(email){
  if(!currentAdminUser || !email) return;
  const requestId = ++customerDetailsRequest;
  customerPanel.hidden = false;
  customerPanelBackdrop.hidden = false;
  document.body.classList.add("customer-panel-open");
  setCustomerPanelState("loading");
  customerPanel.focus();

  callGetAdminUserDetails({ email })
    .then(result => {
      if(requestId === customerDetailsRequest && currentAdminUser){
        renderCustomerDetails(result.data);
      }
    })
    .catch(error => {
      if(requestId === customerDetailsRequest){
        showCustomerPanelFailure(error);
      }
    });
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
customerSearch.addEventListener("input", renderFilteredRecentSignups);
customerPanelClose.addEventListener("click", closeCustomerPanel);
customerPanelBackdrop.addEventListener("click", closeCustomerPanel);
document.addEventListener("keydown", event => {
  if(event.key === "Escape" && !customerPanel.hidden) closeCustomerPanel();
});

onAuthStateChanged(
  auth,
  user => {
    const nextAuthUid = user?.uid || "";
    if(nextAuthUid !== resolvedAuthUid){
      closeCustomerPanel();
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
