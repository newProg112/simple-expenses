import { auth, functions } from "/firebase-config.js";
import { adminAccessDecision } from "./admin-access.js";
import {
  adminMetricsErrorState,
  adminUserDetailsErrorState,
  adminUserSearchErrorState,
  buildCustomerSummary,
  filterSignupsByEmail,
  formatAdminDate,
  formatEstimatedMrr,
  formatSubscriptionStatus,
  safeMetricCount,
  supportDiagnosticMessages,
  validateAdminUserSearchQuery
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
const recentSignupsTitle = document.getElementById("recentSignupsTitle");
const recentSignupsBody = document.getElementById("recentSignupsBody");
const customerSearchForm = document.getElementById("customerSearchForm");
const customerSearch = document.getElementById("customerSearch");
const customerSearchButton = document.getElementById("customerSearchButton");
const customerSearchClear = document.getElementById("customerSearchClear");
const customerSearchStatus = document.getElementById("customerSearchStatus");
const customerPanelBackdrop = document.getElementById("customerPanelBackdrop");
const customerPanel = document.getElementById("customerPanel");
const customerPanelClose = document.getElementById("customerPanelClose");
const customerPanelLoading = document.getElementById("customerPanelLoading");
const customerPanelFailure = document.getElementById("customerPanelFailure");
const customerPanelFailureTitle = document.getElementById("customerPanelFailureTitle");
const customerPanelFailureMessage = document.getElementById("customerPanelFailureMessage");
const customerPanelData = document.getElementById("customerPanelData");
const customerDiagnosticsSection = document.getElementById("customerDiagnosticsSection");
const customerDiagnosticsList = document.getElementById("customerDiagnosticsList");
const customerCopyEmail = document.getElementById("customerCopyEmail");
const customerCopySummary = document.getElementById("customerCopySummary");
const customerRefresh = document.getElementById("customerRefresh");
const customerClipboardStatus = document.getElementById("customerClipboardStatus");
const refreshMetricsButton = document.getElementById("refreshMetricsButton");
const metricsUpdatedAt = document.getElementById("metricsUpdatedAt");
const callGetAdminMetrics = httpsCallable(functions, "getAdminMetrics");
const callGetAdminUserDetails = httpsCallable(functions, "getAdminUserDetails");
const callSearchAdminUsers = httpsCallable(functions, "searchAdminUsers");
let metricsRequest = null;
let searchRequest = null;
let searchGeneration = 0;
let customerDetailsRequest = 0;
let recentSignupRecords = [];
let currentCustomerDetails = null;
let currentCustomerEmail = "";
let customerPanelTrigger = null;
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

function createCustomerEmailCell(record){
  const cell = document.createElement("td");
  cell.dataset.label = "User";
  const button = document.createElement("button");
  button.className = "customer-open-button";
  button.type = "button";
  button.textContent = String(record?.email || "Not available");
  button.addEventListener("click", () =>
    openCustomerSummary(String(record?.email || ""), button)
  );
  cell.append(button);
  return cell;
}

function renderCustomerRows(records, emptyMessage){
  recentSignupsBody.replaceChildren();
  if(!Array.isArray(records) || records.length === 0){
    const row = document.createElement("tr");
    const cell = createTableCell("Customers", emptyMessage);
    cell.colSpan = 7;
    row.append(cell);
    recentSignupsBody.append(row);
    return;
  }

  for(const record of records.slice(0, 20)){
    const row = document.createElement("tr");
    const statusCell = createTableCell(
      "Subscription status",
      formatSubscriptionStatus(record?.subscriptionStatus)
    );
    statusCell.className = "subscription-status-cell";
    row.append(
      createCustomerEmailCell(record),
      createTableCell("Plan", record?.plan === "Pro" ? "Pro" : "Starter"),
      createTableCell("Joined", formatAdminDate(record?.joinedAt)),
      createTableCell("Last sign in", formatAdminDate(record?.lastSignInAt)),
      statusCell,
      createTableCell("AI usage", String(safeMetricCount(record?.aiAssistantSuccessfulUses))),
      createTableCell("Scan usage", String(safeMetricCount(record?.invoiceScanningSuccessfulUses)))
    );
    recentSignupsBody.append(row);
  }
}

function renderFilteredRecentSignups(){
  recentSignupsTitle.textContent = "Recent sign-ups";
  const filtered = filterSignupsByEmail(recentSignupRecords, customerSearch.value);
  renderCustomerRows(
    filtered,
    recentSignupRecords.length === 0
      ? "No non-demo users are available yet."
      : "No recent sign-ups match that email."
  );
  customerSearchStatus.textContent = recentSignupRecords.length === 0
    ? ""
    : `${filtered.length} of ${recentSignupRecords.length} recent sign-ups shown. Use Search all users for the full account list.`;
}

function renderAdminMetrics(payload){
  const metrics = payload?.metrics || {};
  document.getElementById("totalUsersValue").textContent = String(safeMetricCount(metrics.totalUsers));
  document.getElementById("starterUsersValue").textContent = String(safeMetricCount(metrics.starterUsers));
  document.getElementById("proUsersValue").textContent = String(safeMetricCount(metrics.proUsers));
  document.getElementById("estimatedMrrValue").textContent = formatEstimatedMrr(metrics.estimatedMrrPence, metrics.currency);
  document.getElementById("activePaidValue").textContent = String(safeMetricCount(metrics.activePaidSubscriptions));
  document.getElementById("aiUsageValue").textContent = String(safeMetricCount(metrics.aiAssistantSuccessfulUses));
  document.getElementById("scanUsageValue").textContent = String(safeMetricCount(metrics.invoiceScanningSuccessfulUses));
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

function renderSearchMessage(title, message){
  recentSignupsBody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.dataset.label = "Customer search";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("span");
  description.textContent = message;
  cell.append(heading, document.createElement("br"), description);
  row.append(cell);
  recentSignupsBody.append(row);
}

function showSearchFailure(error){
  const state = adminUserSearchErrorState(error);
  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }
  recentSignupsTitle.textContent = "Search results";
  renderSearchMessage(state.title, state.message);
  customerSearchStatus.textContent = state.message;
}

function runAdminUserSearch(){
  const validation = validateAdminUserSearchQuery(customerSearch.value);
  if(!validation.valid){
    searchGeneration += 1;
    renderFilteredRecentSignups();
    customerSearchStatus.textContent = validation.message;
    return null;
  }
  if(searchRequest || !currentAdminUser) return searchRequest;

  const requestGeneration = ++searchGeneration;
  recentSignupsTitle.textContent = "Search results";
  renderSearchMessage("Searching all users", "Securely checking registered customer emails…");
  customerSearchStatus.textContent = "Searching all registered users…";
  customerSearchButton.disabled = true;

  searchRequest = callSearchAdminUsers({ query: validation.query })
    .then(result => {
      if(requestGeneration !== searchGeneration || !currentAdminUser) return;
      const records = Array.isArray(result.data?.results) ? result.data.results : [];
      renderCustomerRows(records, "No matching users found");
      customerSearchStatus.textContent = records.length === 0
        ? "No matching users found"
        : `${records.length} matching ${records.length === 1 ? "user" : "users"} found.`;
    })
    .catch(error => {
      if(requestGeneration === searchGeneration) showSearchFailure(error);
    })
    .finally(() => {
      searchRequest = null;
      if(currentAdminUser) customerSearchButton.disabled = false;
    });
  return searchRequest;
}

function handleSearchInput(){
  searchGeneration += 1;
  renderFilteredRecentSignups();
  const validation = validateAdminUserSearchQuery(customerSearch.value);
  if(customerSearch.value && !validation.valid){
    customerSearchStatus.textContent = validation.message;
  }else if(validation.valid){
    customerSearchStatus.textContent += " Ready to search all registered users.";
  }
}

function clearCustomerSearch(){
  searchGeneration += 1;
  customerSearch.value = "";
  renderFilteredRecentSignups();
  customerSearchStatus.textContent = "Showing recent sign-ups.";
  customerSearch.focus();
}

function setCustomerPanelState(state){
  customerPanelLoading.hidden = state !== "loading";
  customerPanelFailure.hidden = state !== "failure";
  customerPanelData.hidden = state !== "data";
  customerCopyEmail.disabled = state !== "data";
  customerCopySummary.disabled = state !== "data";
}

function closeCustomerPanel(){
  customerDetailsRequest += 1;
  customerPanel.hidden = true;
  customerPanelBackdrop.hidden = true;
  document.body.classList.remove("customer-panel-open");
  const returnFocus = customerPanelTrigger;
  customerPanelTrigger = null;
  if(returnFocus?.isConnected) returnFocus.focus();
}

function renderCustomerDiagnostics(codes){
  const messages = supportDiagnosticMessages(codes);
  customerDiagnosticsList.replaceChildren();
  for(const message of messages){
    const item = document.createElement("li");
    item.textContent = message;
    customerDiagnosticsList.append(item);
  }
  customerDiagnosticsSection.hidden = messages.length === 0;
}

function renderCustomerDetails(details){
  currentCustomerDetails = details;
  document.getElementById("customerEmailValue").textContent = String(details?.email || "Not available");
  document.getElementById("customerPlanValue").textContent = details?.plan === "Pro" ? "Pro" : "Starter";
  document.getElementById("customerSubscriptionValue").textContent = formatSubscriptionStatus(details?.subscriptionStatus);
  document.getElementById("customerCreatedValue").textContent = formatAdminDate(details?.createdDate);
  document.getElementById("customerLastSignInValue").textContent = formatAdminDate(details?.lastSignInTime);
  document.getElementById("customerAiUsageValue").textContent = String(safeMetricCount(details?.aiAssistantSuccessfulUses));
  document.getElementById("customerScanUsageValue").textContent = String(safeMetricCount(details?.invoiceScanningSuccessfulUses));
  document.getElementById("customerPeriodEndValue").textContent = formatAdminDate(details?.currentPeriodEnd);
  document.getElementById("customerStripeValue").textContent = details?.stripeCustomerPresent === true ? "Yes" : "No";
  renderCustomerDiagnostics(details?.diagnostics);
  customerClipboardStatus.textContent = "";
  setCustomerPanelState("data");
}

function showCustomerPanelFailure(error){
  currentCustomerDetails = null;
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

function loadCustomerDetails(email){
  if(!currentAdminUser || !email) return null;
  const requestId = ++customerDetailsRequest;
  currentCustomerEmail = email;
  currentCustomerDetails = null;
  customerClipboardStatus.textContent = "";
  customerRefresh.disabled = true;
  setCustomerPanelState("loading");

  return callGetAdminUserDetails({ email })
    .then(result => {
      if(requestId === customerDetailsRequest && currentAdminUser){
        renderCustomerDetails(result.data);
      }
    })
    .catch(error => {
      if(requestId === customerDetailsRequest) showCustomerPanelFailure(error);
    })
    .finally(() => {
      if(requestId === customerDetailsRequest && currentAdminUser){
        customerRefresh.disabled = false;
      }
    });
}

function openCustomerSummary(email, trigger){
  if(!currentAdminUser || !email) return;
  customerPanelTrigger = trigger || document.activeElement;
  customerPanel.hidden = false;
  customerPanelBackdrop.hidden = false;
  document.body.classList.add("customer-panel-open");
  customerPanel.focus();
  loadCustomerDetails(email);
}

async function copyCustomerText(text){
  customerClipboardStatus.textContent = "";
  try{
    if(!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
    customerClipboardStatus.textContent = "Copied";
  }catch{
    customerClipboardStatus.textContent = "Copy failed. Select and copy the visible details manually.";
  }
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
      if(requestGeneration === authGeneration) showMetricsFailure(error);
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
customerSearch.addEventListener("input", handleSearchInput);
customerSearchForm.addEventListener("submit", event => {
  event.preventDefault();
  runAdminUserSearch();
});
customerSearchClear.addEventListener("click", clearCustomerSearch);
customerPanelClose.addEventListener("click", closeCustomerPanel);
customerPanelBackdrop.addEventListener("click", closeCustomerPanel);
customerRefresh.addEventListener("click", () => loadCustomerDetails(currentCustomerEmail));
customerCopyEmail.addEventListener("click", () => {
  if(currentCustomerDetails?.email) copyCustomerText(currentCustomerDetails.email);
});
customerCopySummary.addEventListener("click", () => {
  if(currentCustomerDetails) copyCustomerText(buildCustomerSummary(currentCustomerDetails));
});
document.addEventListener("keydown", event => {
  if(event.key === "Escape" && !customerPanel.hidden) closeCustomerPanel();
});

onAuthStateChanged(
  auth,
  user => {
    const nextAuthUid = user?.uid || "";
    if(nextAuthUid !== resolvedAuthUid){
      closeCustomerPanel();
      searchGeneration += 1;
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
    searchGeneration += 1;
    resolvedAuthUid = "";
    console.error("Admin authentication check failed", error);
    showState("errorState");
  }
);
