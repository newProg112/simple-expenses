import { auth, functions } from "/firebase-config.js";
import { adminAccessDecision } from "./admin-access.js";
import {
  ACTIVITY_PRESENTATION,
  activityErrorState,
  filterActivityEvents,
  formatActivityExactTime,
  formatActivityRelativeTime
} from "./admin-activity-view.js?v=20260802-admin5a";
import {
  buildFeatureUsageChartModel,
  featureUsageErrorState
} from "./admin-feature-usage-view.js?v=20260802-admin5b";
import {
  adminMetricsErrorState,
  adminUserDetailsErrorState,
  adminUserSearchErrorState,
  buildAdminChartModel,
  buildCustomerSummary,
  chartSummaryItems,
  filterSignupsByEmail,
  formatAdminDate,
  formatEstimatedMrr,
  formatSubscriptionStatus,
  safeMetricCount,
  supportDiagnosticMessages,
  validateAdminUserSearchQuery
} from "./admin-metrics-view.js?v=20260802-admin4b";
import {
  createDemoEnvironmentController,
  DEMO_COUNT_LABELS,
  DEMO_COUNT_ORDER
} from "./admin-demo-environment.js?v=20260804-demo-admin1";
import {
  createDemoAnalyticsLoader,
  demoAnalyticsErrorState,
  formatDemoSessionDuration,
  normalizeDemoAnalyticsPayload
} from "./admin-demo-analytics-view.js?v=20260805-demo-analytics2";
import {
  createCustomerAnalyticsLoader,
  customerAnalyticsErrorState,
  normalizeCustomerAnalyticsPayload
} from "./admin-customer-analytics-view.js?v=20260805-customer-analytics1";
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
const growthOverview = document.getElementById("growthOverview");
const activityFilter = document.getElementById("activityFilter");
const activityList = document.getElementById("activityList");
const activityLoading = document.getElementById("activityLoading");
const activityError = document.getElementById("activityError");
const activityEmpty = document.getElementById("activityEmpty");
const activityMore = document.getElementById("activityMore");
const activityStatus = document.getElementById("activityStatus");
const refreshActivityButton = document.getElementById("refreshActivityButton");
const retryActivityButton = document.getElementById("retryActivityButton");
const showMoreActivityButton = document.getElementById("showMoreActivityButton");
const featureUsageRange = document.getElementById("featureUsageRange");
const featureUsageLoading = document.getElementById("featureUsageLoading");
const featureUsageError = document.getElementById("featureUsageError");
const featureUsageData = document.getElementById("featureUsageData");
const featureUsageZero = document.getElementById("featureUsageZero");
const featureUsageUnavailable = document.getElementById("featureUsageUnavailable");
const featureUsageChartShell = document.getElementById("featureUsageChartShell");
const featureUsageTableBody = document.getElementById("featureUsageTableBody");
const featureUsageStatus = document.getElementById("featureUsageStatus");
const retryFeatureUsageButton = document.getElementById("retryFeatureUsageButton");
const demoTargetUid = document.getElementById("demoTargetUid");
const seedDemoDataButton = document.getElementById("seedDemoDataButton");
const demoEnvironmentFeedback = document.getElementById("demoEnvironmentFeedback");
const demoEnvironmentCounts = document.getElementById("demoEnvironmentCounts");
const demoAnalyticsRange = document.getElementById("demoAnalyticsRange");
const demoAnalyticsLoading = document.getElementById("demoAnalyticsLoading");
const demoAnalyticsError = document.getElementById("demoAnalyticsError");
const demoAnalyticsEmpty = document.getElementById("demoAnalyticsEmpty");
const demoAnalyticsData = document.getElementById("demoAnalyticsData");
const retryDemoAnalyticsButton = document.getElementById("retryDemoAnalyticsButton");
const demoPagesTableBody = document.getElementById("demoPagesTableBody");
const demoEventsTableBody = document.getElementById("demoEventsTableBody");
const customerAnalyticsRange = document.getElementById("customerAnalyticsRange");
const customerAnalyticsLoading = document.getElementById("customerAnalyticsLoading");
const customerAnalyticsError = document.getElementById("customerAnalyticsError");
const customerAnalyticsEmpty = document.getElementById("customerAnalyticsEmpty");
const customerAnalyticsData = document.getElementById("customerAnalyticsData");
const retryCustomerAnalyticsButton = document.getElementById("retryCustomerAnalyticsButton");
const customerAdoptionTableBody = document.getElementById("customerAdoptionTableBody");
const customerFeaturesTableBody = document.getElementById("customerFeaturesTableBody");
const customerPlanTableBody = document.getElementById("customerPlanTableBody");
const callGetAdminMetrics = httpsCallable(functions, "getAdminMetrics");
const callGetAdminRecentActivity = httpsCallable(functions, "getAdminRecentActivity");
const callGetAdminFeatureUsage = httpsCallable(functions, "getAdminFeatureUsage");
const callGetAdminUserDetails = httpsCallable(functions, "getAdminUserDetails");
const callSearchAdminUsers = httpsCallable(functions, "searchAdminUsers");
const callSeedAdminDemoEnvironment = httpsCallable(functions, "seedAdminDemoEnvironment");
const callGetAdminDemoAnalytics = httpsCallable(functions, "getAdminDemoAnalytics");
const callGetAdminCustomerAnalytics = httpsCallable(functions, "getAdminCustomerAnalytics");
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
let activityRequest = null;
let activityRecords = [];
let activityCursor = null;
let featureUsageRequest = null;
let featureUsageChart = null;
const adminCharts = new Map();
const demoAnalyticsCharts = new Map();
let customerAnalyticsChart = null;

function setCustomerAnalyticsState(state){
  customerAnalyticsLoading.hidden = state !== "loading";
  customerAnalyticsError.hidden = state !== "error";
  customerAnalyticsEmpty.hidden = state !== "empty";
  customerAnalyticsData.hidden = !["loaded", "empty"].includes(state);
}

function renderCustomerTable(body, rows){
  body.replaceChildren();
  for(const values of rows){
    const row = document.createElement("tr");
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if(index === 0) cell.scope = "row";
      cell.textContent = String(value);
      row.append(cell);
    });
    body.append(row);
  }
}

function renderCustomerAnalytics(payload){
  customerAnalyticsChart?.destroy();
  customerAnalyticsChart = null;
  const model = normalizeCustomerAnalyticsPayload(payload);
  const summary = model.summary;
  document.getElementById("customerActiveAccountsValue").textContent = String(summary.activeCustomerAccounts);
  document.getElementById("customerNewSignupsValue").textContent = String(summary.newSignUps);
  document.getElementById("customerActiveStarterValue").textContent = String(summary.activeStarterAccounts);
  document.getElementById("customerActiveProValue").textContent = String(summary.activeProAccounts);
  document.getElementById("customerConversionValue").textContent = `${summary.starterToProConversionRate.toFixed(1)}%`;
  document.getElementById("customerActionsValue").textContent = String(summary.totalTrackedCustomerActions);
  renderCustomerTable(customerAdoptionTableBody, model.adoption.length
    ? model.adoption.map(item => [item.label, item.count])
    : [["No reliably tracked product actions", 0]]);
  renderCustomerTable(customerFeaturesTableBody, model.features.length
    ? model.features.map(item => [item.label, item.count, `${item.share.toFixed(1)}%`])
    : [["No measured feature actions", 0, "0.0%"]]);
  renderCustomerTable(customerPlanTableBody, [
    ["Starter", model.planAdoption.starter.count, `${model.planAdoption.starter.percentageOfKnown.toFixed(1)}%`],
    ["Pro", model.planAdoption.pro.count, `${model.planAdoption.pro.percentageOfKnown.toFixed(1)}%`],
    ["Unknown or missing", model.planAdoption.unknown.count, "Excluded"]
  ]);
  document.getElementById("customerPlanConversion").textContent = `Current conversion rate: ${model.planAdoption.conversionRate.toFixed(1)}% of ${model.planAdoption.knownAccounts} known-plan accounts.`;
  document.getElementById("customerAnalyticsUpdatedAt").textContent = model.generatedAt
    ? `Updated ${formatAdminDate(model.generatedAt)} | UTC date range`
    : "Customer Analytics loaded";
  document.getElementById("customerAnalyticsCapped").hidden = !model.caps.incomplete;
  const limitations = document.getElementById("customerAnalyticsLimitations");
  limitations.replaceChildren(...model.limitations.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  setCustomerAnalyticsState(summary.totalTrackedCustomerActions === 0 ? "empty" : "loaded");
  const ChartLibrary = window.Chart;
  if(typeof ChartLibrary !== "function" || model.daily.length === 0){
    showChartEmpty("customerActivityChart", "customerActivityChartEmpty", model.daily.length ? "Charts are unavailable. Aggregate values remain available." : "No customer activity dates to plot.");
    return;
  }
  const options = baseChartOptions();
  options.plugins.legend = {display: true};
  customerAnalyticsChart = new ChartLibrary(prepareChart("customerActivityChart", "customerActivityChartEmpty"), {
    type: "line",
    data: {
      labels: model.daily.map(item => formatDemoDay(item.date)),
      datasets: [
        {label: "Active accounts", data: model.daily.map(item => item.activeAccounts), borderColor: "#0077b6", backgroundColor: "rgba(0,119,182,.12)", tension: .2, fill: false},
        {label: "Tracked actions", data: model.daily.map(item => item.trackedActions), borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,.12)", tension: .2, fill: false}
      ]
    },
    options
  });
}

function showCustomerAnalyticsFailure(error){
  const state = customerAnalyticsErrorState(error);
  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }
  document.getElementById("customerAnalyticsErrorTitle").textContent = state.title;
  document.getElementById("customerAnalyticsErrorMessage").textContent = state.message;
  setCustomerAnalyticsState("error");
}

const customerAnalyticsLoader = createCustomerAnalyticsLoader({
  request: async range => {
    const requestGeneration = authGeneration;
    const result = await callGetAdminCustomerAnalytics({range});
    return {payload: result.data, requestGeneration};
  },
  onLoading: () => {
    setCustomerAnalyticsState("loading");
    customerAnalyticsRange.disabled = true;
  },
  onSuccess: result => {
    customerAnalyticsRange.disabled = false;
    if(result.requestGeneration === authGeneration && currentAdminUser) renderCustomerAnalytics(result.payload);
  },
  onError: error => {
    customerAnalyticsRange.disabled = false;
    showCustomerAnalyticsFailure(error);
  }
});

function loadCustomerAnalytics({force = false} = {}){
  if(!currentAdminUser) return Promise.resolve(null);
  return customerAnalyticsLoader.load(customerAnalyticsRange.value, {force});
}

function destroyDemoAnalyticsCharts(){
  for(const chart of demoAnalyticsCharts.values()) chart.destroy();
  demoAnalyticsCharts.clear();
}

function renderDemoAnalyticsChart(canvasId, emptyId, configuration){
  const canvas = prepareChart(canvasId, emptyId);
  const ChartLibrary = window.Chart;
  if(typeof ChartLibrary !== "function"){
    showChartEmpty(canvasId, emptyId, "Charts are unavailable. The accessible data tables remain available.");
    return;
  }
  demoAnalyticsCharts.get(canvasId)?.destroy();
  demoAnalyticsCharts.set(canvasId, new ChartLibrary(canvas, configuration));
}

function setDemoAnalyticsState(state){
  demoAnalyticsLoading.hidden = state !== "loading";
  demoAnalyticsError.hidden = state !== "error";
  demoAnalyticsEmpty.hidden = state !== "empty";
  demoAnalyticsData.hidden = state !== "loaded";
}

function renderDemoAnalyticsTable(body, items, cells){
  body.replaceChildren();
  for(const item of items){
    const row = document.createElement("tr");
    cells(item).forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if(index === 0) cell.scope = "row";
      cell.textContent = String(value);
      row.append(cell);
    });
    body.append(row);
  }
}

function formatDemoDay(value){
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"})
    : value;
}

function renderDemoAnalyticsCharts(model){
  const dailyLabels = model.daily.map(item => formatDemoDay(item.date));
  const activityOptions = baseChartOptions();
  activityOptions.plugins.legend = {display: true};
  renderDemoAnalyticsChart("demoActivityChart", "demoActivityChartEmpty", {
    type: "line",
    data: {
      labels: dailyLabels,
      datasets: [
        {label: "Sessions", data: model.daily.map(item => item.sessions), borderColor: "#0077b6", backgroundColor: "rgba(0,119,182,.12)", tension: .25, fill: false},
        {label: "Page views", data: model.daily.map(item => item.pageViews), borderColor: "#7c3aed", backgroundColor: "rgba(124,58,237,.12)", tension: .25, fill: false}
      ]
    },
    options: activityOptions
  });

  if(model.pages.length === 0){
    showChartEmpty("demoPagesChart", "demoPagesChartEmpty", "No demo page views in this time range.");
    return;
  }
  renderDemoAnalyticsChart("demoPagesChart", "demoPagesChartEmpty", {
    type: "bar",
    data: {
      labels: model.pages.map(item => item.label),
      datasets: [{
        label: "Page views",
        data: model.pages.map(item => item.count),
        backgroundColor: "#0077b6",
        borderColor: "#075985",
        borderWidth: 1
      }]
    },
    options: {
      ...baseChartOptions(),
      indexAxis: "y",
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: context => {
          const page = model.pages[context.dataIndex];
          return `${page.count} views (${page.percentage.toFixed(1)}%)`;
        }}}
      },
      scales: {
        x: {beginAtZero: true, ticks: {precision: 0, stepSize: 1}},
        y: {grid: {display: false}}
      }
    }
  });
}

function renderDemoAnalytics(payload){
  destroyDemoAnalyticsCharts();
  const model = normalizeDemoAnalyticsPayload(payload);
  if(model.eventsProcessed === 0){
    setDemoAnalyticsState("empty");
    return;
  }
  const metrics = model.metrics;
  document.getElementById("demoLoginsValue").textContent = String(metrics.demoLogins);
  document.getElementById("demoSessionsValue").textContent = String(metrics.demoSessions);
  document.getElementById("demoPageViewsValue").textContent = String(metrics.totalPageViews);
  document.getElementById("demoAveragePagesValue").textContent = metrics.averagePagesPerSession.toFixed(2);
  document.getElementById("demoAverageDurationValue").textContent = formatDemoSessionDuration(metrics.averageSessionDurationSeconds);
  document.getElementById("demoSinglePageValue").textContent = String(metrics.singlePageSessions);
  renderDemoAnalyticsTable(demoPagesTableBody, model.pages, item => [item.label, item.count, `${item.percentage.toFixed(1)}%`]);
  renderDemoAnalyticsTable(demoEventsTableBody, model.eventBreakdown, item => [item.eventName, item.count]);
  document.getElementById("demoAnalyticsUpdatedAt").textContent = model.generatedAt
    ? `Updated ${formatAdminDate(model.generatedAt)} | ${model.eventsProcessed} validated events processed`
    : `${model.eventsProcessed} validated events processed`;
  document.getElementById("demoAnalyticsTruncated").hidden = !model.truncated;
  setDemoAnalyticsState("loaded");
  renderDemoAnalyticsCharts(model);
}

function showDemoAnalyticsFailure(error){
  const state = demoAnalyticsErrorState(error);
  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }
  document.getElementById("demoAnalyticsErrorTitle").textContent = state.title;
  document.getElementById("demoAnalyticsErrorMessage").textContent = state.message;
  setDemoAnalyticsState("error");
}

const demoAnalyticsLoader = createDemoAnalyticsLoader({
  request: async range => {
    const requestGeneration = authGeneration;
    const result = await callGetAdminDemoAnalytics({range});
    return {payload: result.data, requestGeneration};
  },
  onLoading: () => {
    setDemoAnalyticsState("loading");
    demoAnalyticsRange.disabled = true;
  },
  onSuccess: result => {
    demoAnalyticsRange.disabled = false;
    if(result.requestGeneration === authGeneration && currentAdminUser){
      renderDemoAnalytics(result.payload);
    }
  },
  onError: error => {
    demoAnalyticsRange.disabled = false;
    showDemoAnalyticsFailure(error);
  }
});

function loadDemoAnalytics({force = false} = {}){
  if(!currentAdminUser) return Promise.resolve(null);
  return demoAnalyticsLoader.load(demoAnalyticsRange.value, {force});
}

function renderDemoEnvironmentCounts(counts){
  demoEnvironmentCounts.replaceChildren();
  if(!counts || typeof counts !== "object"){
    demoEnvironmentCounts.hidden = true;
    return;
  }

  for(const key of DEMO_COUNT_ORDER){
    const item = document.createElement("span");
    item.className = "demo-environment-count";
    const value = Number.isFinite(Number(counts[key])) ? Number(counts[key]) : 0;
    item.append(`${DEMO_COUNT_LABELS[key]}: `);
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    item.append(strong);
    demoEnvironmentCounts.append(item);
  }
  demoEnvironmentCounts.hidden = false;
}

function renderDemoEnvironmentState(state){
  const running = state?.state === "running";
  demoTargetUid.disabled = running;
  seedDemoDataButton.disabled = running;
  seedDemoDataButton.textContent = running ? "Seeding Demo Data…" : "Seed Demo Data";
  demoEnvironmentFeedback.dataset.state = state?.state || "idle";

  if(state?.state === "success"){
    const cleared = Number(state.result?.clearedDocuments) || 0;
    const written = Number(state.result?.writtenDocuments) || 0;
    demoEnvironmentFeedback.textContent = `Complete. Cleared ${cleared} managed documents and wrote ${written} canonical documents.`;
    renderDemoEnvironmentCounts(state.result?.counts);
    return;
  }

  if(state?.state === "error"){
    const stage = state.stage ? `${state.stage[0].toUpperCase()}${state.stage.slice(1)} failed: ` : "";
    demoEnvironmentFeedback.textContent = `${stage}${state.message}`;
    renderDemoEnvironmentCounts(null);
    return;
  }

  demoEnvironmentFeedback.textContent = state?.message || "Enter the official demo account UID to begin.";
  if(state?.state !== "running") renderDemoEnvironmentCounts(null);
}

const demoEnvironmentController = createDemoEnvironmentController({
  isAdmin: () => adminAccessDecision(currentAdminUser) === "allowed",
  confirmAction: message => window.confirm(message),
  execute: async ({ targetUid }) => {
    const response = await callSeedAdminDemoEnvironment({ targetUid });
    return response.data;
  },
  onState: renderDemoEnvironmentState
});

function destroyFeatureUsageChart(){
  featureUsageChart?.destroy();
  featureUsageChart = null;
}

function setFeatureUsageState(state){
  featureUsageLoading.hidden = state !== "loading";
  featureUsageError.hidden = state !== "error";
  featureUsageData.hidden = !["loaded", "zero", "unavailable"].includes(state);
  featureUsageZero.hidden = state !== "zero";
  featureUsageUnavailable.hidden = state !== "unavailable";
  featureUsageChartShell.hidden = state !== "loaded";
}

function renderFeatureUsageTable(items){
  featureUsageTableBody.replaceChildren();
  for(const item of items){
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = item.label;
    const count = document.createElement("td");
    count.textContent = String(item.count);
    row.append(label, count);
    featureUsageTableBody.append(row);
  }
}

const featureUsageValueLabels = {
  id: "featureUsageValueLabels",
  afterDatasetsDraw(chart){
    const context = chart.ctx;
    const values = chart.data.datasets[0]?.data || [];
    context.save();
    context.fillStyle = "#334155";
    context.font = "700 12px system-ui";
    context.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((bar, index) => {
      const x = Math.min(bar.x + 8, chart.chartArea.right - 18);
      context.fillText(String(values[index] || 0), x, bar.y);
    });
    context.restore();
  }
};

function renderFeatureUsage(payload){
  destroyFeatureUsageChart();
  const model = buildFeatureUsageChartModel(payload?.items);
  document.getElementById("featureUsageTotal").textContent = String(model.totalTrackedActions);
  const mostUsed = document.getElementById("featureUsageMostUsed");
  mostUsed.hidden = !model.mostUsedFeature;
  document.getElementById("featureUsageMostUsedValue").textContent = model.mostUsedFeature;
  renderFeatureUsageTable(model.items);
  featureUsageStatus.textContent = `${model.totalTrackedActions} tracked actions across ${model.items.length} features.`;
  if(model.totalTrackedActions === 0){
    setFeatureUsageState("zero");
    return;
  }
  const ChartLibrary = window.Chart;
  if(typeof ChartLibrary !== "function"){
    setFeatureUsageState("unavailable");
    return;
  }
  setFeatureUsageState("loaded");
  featureUsageChart = new ChartLibrary(document.getElementById("featureUsageChart"), {
    type: "bar",
    data: {
      labels: model.labels,
      datasets: [{
        label: "Tracked actions",
        data: model.counts,
        backgroundColor: "#0077b6",
        borderColor: "#075985",
        borderWidth: 1
      }]
    },
    plugins: [featureUsageValueLabels],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : {duration: 300},
      layout: {padding: {right: 36}},
      plugins: {
        legend: {display: false},
        tooltip: {callbacks: {label: context => `Tracked actions: ${context.parsed.x}`}}
      },
      scales: {
        x: {beginAtZero: true, ticks: {precision: 0, stepSize: 1}},
        y: {grid: {display: false}}
      }
    }
  });
}

function showFeatureUsageFailure(error){
  destroyFeatureUsageChart();
  const state = featureUsageErrorState(error);
  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }
  document.getElementById("featureUsageErrorTitle").textContent = state.title;
  document.getElementById("featureUsageErrorMessage").textContent = state.message;
  setFeatureUsageState("error");
}

function loadFeatureUsage(){
  if(featureUsageRequest || !currentAdminUser) return featureUsageRequest;
  const requestGeneration = authGeneration;
  const requestedRange = featureUsageRange.value;
  destroyFeatureUsageChart();
  setFeatureUsageState("loading");
  featureUsageRange.disabled = true;
  featureUsageRequest = callGetAdminFeatureUsage({range: requestedRange})
    .then(result => {
      if(requestGeneration === authGeneration && currentAdminUser){
        renderFeatureUsage(result.data);
      }
    })
    .catch(error => {
      if(requestGeneration === authGeneration) showFeatureUsageFailure(error);
    })
    .finally(() => {
      featureUsageRequest = null;
      if(requestGeneration === authGeneration && currentAdminUser){
        featureUsageRange.disabled = false;
      }
    });
  return featureUsageRequest;
}

function setActivityState(state){
  activityLoading.hidden = state !== "loading";
  activityError.hidden = state !== "error";
  activityEmpty.hidden = state !== "empty";
  activityList.hidden = state !== "loaded";
}

function createActivityItem(record){
  const presentation = ACTIVITY_PRESENTATION[record?.eventType];
  if(!presentation) return null;
  const item = document.createElement("li");
  item.className = "activity-item";
  const marker = document.createElement("span");
  marker.className = "activity-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = presentation.marker;
  const identity = document.createElement("div");
  const title = document.createElement("p");
  title.className = "activity-title";
  title.textContent = presentation.title;
  const email = document.createElement("p");
  email.className = "activity-email";
  email.textContent = record.displayEmail || "User email unavailable";
  identity.append(title, email);
  const summary = document.createElement("p");
  summary.className = "activity-summary";
  summary.textContent = String(record.summary || "Activity completed.");
  const time = document.createElement("time");
  time.className = "activity-time";
  time.dateTime = record.createdAt;
  time.title = formatActivityExactTime(record.createdAt);
  time.textContent = formatActivityRelativeTime(record.createdAt);
  item.append(marker, identity, summary, time);
  return item;
}

function renderActivity(){
  const visibleRecords = filterActivityEvents(activityRecords, activityFilter.value);
  activityList.replaceChildren();
  for(const record of visibleRecords){
    const item = createActivityItem(record);
    if(item) activityList.append(item);
  }
  setActivityState(visibleRecords.length ? "loaded" : "empty");
  activityMore.hidden = !activityCursor;
  activityStatus.textContent = `${visibleRecords.length} recent activity event${visibleRecords.length === 1 ? "" : "s"} shown.`;
}

function showActivityFailure(error){
  const state = activityErrorState(error);
  if(state.kind === "unauthenticated"){
    showState("signedOutState");
    window.location.replace("/login.html");
    return;
  }
  if(state.kind === "permission-denied"){
    showState("deniedState");
    return;
  }
  document.getElementById("activityErrorTitle").textContent = state.title;
  document.getElementById("activityErrorMessage").textContent = state.message;
  setActivityState("error");
  activityMore.hidden = true;
}

function loadRecentActivity({append = false} = {}){
  if(activityRequest || !currentAdminUser) return activityRequest;
  const requestGeneration = authGeneration;
  if(!append){
    activityRecords = [];
    activityCursor = null;
    setActivityState("loading");
  }
  refreshActivityButton.disabled = true;
  showMoreActivityButton.disabled = true;
  activityRequest = callGetAdminRecentActivity({
    limit: 30,
    ...(append && activityCursor ? {cursor: activityCursor} : {})
  }).then(result => {
    if(requestGeneration !== authGeneration || !currentAdminUser) return;
    const events = Array.isArray(result.data?.events) ? result.data.events : [];
    activityRecords = append ? activityRecords.concat(events) : events;
    activityCursor = typeof result.data?.nextCursor === "string" ? result.data.nextCursor : null;
    renderActivity();
  }).catch(error => {
    if(requestGeneration === authGeneration) showActivityFailure(error);
  }).finally(() => {
    activityRequest = null;
    if(requestGeneration === authGeneration && currentAdminUser){
      refreshActivityButton.disabled = false;
      showMoreActivityButton.disabled = false;
    }
  });
  return activityRequest;
}

function destroyAdminCharts(){
  for(const chart of adminCharts.values()) chart.destroy();
  adminCharts.clear();
}

function clearGrowthChartContent(){
  destroyAdminCharts();
  for(const id of ["monthlySignupsSummary", "cumulativeUsersSummary", "planDistributionSummary"]){
    document.getElementById(id).replaceChildren();
  }
  for(const id of ["monthlySignupsEmpty", "cumulativeUsersEmpty", "planDistributionEmpty"]){
    const empty = document.getElementById(id);
    empty.textContent = "";
    empty.hidden = true;
  }
  document.getElementById("planDistributionText").textContent = "";
}

function replaceSummaryList(id, items){
  const list = document.getElementById(id);
  list.replaceChildren();
  for(const text of items){
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
}

function showChartEmpty(canvasId, emptyId, message){
  document.getElementById(canvasId).hidden = true;
  const empty = document.getElementById(emptyId);
  empty.textContent = message;
  empty.hidden = false;
}

function prepareChart(canvasId, emptyId){
  const canvas = document.getElementById(canvasId);
  canvas.hidden = false;
  document.getElementById(emptyId).hidden = true;
  return canvas;
}

function renderChart(canvasId, emptyId, configuration){
  const canvas = prepareChart(canvasId, emptyId);
  const ChartLibrary = window.Chart;
  if(typeof ChartLibrary !== "function"){
    showChartEmpty(canvasId, emptyId, "Charts are unavailable. The accessible data summary remains available.");
    return;
  }
  adminCharts.get(canvasId)?.destroy();
  adminCharts.set(canvasId, new ChartLibrary(canvas, configuration));
}

function baseChartOptions(){
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: context => `${context.dataset.label}: ${context.parsed.y ?? context.parsed}` } }
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { grid: { display: false } }
    }
  };
}

function renderGrowthCharts(payload){
  destroyAdminCharts();
  const model = buildAdminChartModel(payload?.charts, payload?.metrics);
  const summaries = ["monthlySignupsSummary", "cumulativeUsersSummary", "planDistributionSummary"];
  summaries.forEach(id => replaceSummaryList(id, []));
  document.getElementById("planDistributionText").textContent = "";
  if(!model){
    showChartEmpty("monthlySignupsChart", "monthlySignupsEmpty", "Growth data is unavailable for this snapshot.");
    showChartEmpty("cumulativeUsersChart", "cumulativeUsersEmpty", "Growth data is unavailable for this snapshot.");
    showChartEmpty("planDistributionChart", "planDistributionEmpty", "Plan data is unavailable for this snapshot.");
    return;
  }

  replaceSummaryList("monthlySignupsSummary", chartSummaryItems(model.labels, model.monthlyValues, "new accounts"));
  replaceSummaryList("cumulativeUsersSummary", chartSummaryItems(model.labels, model.cumulativeValues, "total accounts"));
  if(model.monthlyValues.every(value => value === 0)){
    showChartEmpty("monthlySignupsChart", "monthlySignupsEmpty", "No new sign-ups in the displayed months.");
  }else{
    renderChart("monthlySignupsChart", "monthlySignupsEmpty", {
      type: "bar",
      data: { labels: model.labels, datasets: [{ label: "New sign-ups", data: model.monthlyValues, backgroundColor: "#0077b6", borderColor: "#075985", borderWidth: 1 }] },
      options: baseChartOptions()
    });
  }

  if(model.totalUsers === 0){
    showChartEmpty("cumulativeUsersChart", "cumulativeUsersEmpty", "No registered non-demo accounts yet.");
    showChartEmpty("planDistributionChart", "planDistributionEmpty", "No current plan data yet.");
    document.getElementById("planDistributionText").textContent = "Starter 0 · Pro 0";
  }else{
    renderChart("cumulativeUsersChart", "cumulativeUsersEmpty", {
      type: "line",
      data: { labels: model.labels, datasets: [{ label: "Total users", data: model.cumulativeValues, borderColor: "#0077b6", backgroundColor: "#0077b6", borderWidth: 2, pointRadius: 3, pointStyle: "circle", tension: 0, fill: false }] },
      options: baseChartOptions()
    });
    const starterPercent = Math.round((model.planValues[0] / model.totalUsers) * 100);
    const proPercent = 100 - starterPercent;
    document.getElementById("planDistributionText").textContent = `Starter ${model.planValues[0]} (${starterPercent}%) · Pro ${model.planValues[1]} (${proPercent}%)`;
    renderChart("planDistributionChart", "planDistributionEmpty", {
      type: "doughnut",
      data: { labels: ["Starter", "Pro"], datasets: [{ label: "Current users", data: model.planValues, backgroundColor: ["#0077b6", "#7c3aed"], borderColor: "#ffffff", borderWidth: 2 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 300 },
        plugins: { legend: { display: true, position: "bottom", labels: { usePointStyle: true } }, tooltip: { callbacks: { label: context => `${context.label}: ${context.parsed}` } } }
      }
    });
  }
  replaceSummaryList("planDistributionSummary", [
    `Starter: ${model.planValues[0]} users`,
    `Pro: ${model.planValues[1]} users`
  ]);
}

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
  clearGrowthChartContent();
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
  renderGrowthCharts(payload);
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

refreshMetricsButton.addEventListener("click", () => {
  loadAdminMetrics();
  loadRecentActivity();
  loadFeatureUsage();
  loadDemoAnalytics({force: true});
  loadCustomerAnalytics({force: true});
});
refreshActivityButton.addEventListener("click", () => loadRecentActivity());
retryActivityButton.addEventListener("click", () => loadRecentActivity());
showMoreActivityButton.addEventListener("click", () => loadRecentActivity({append: true}));
activityFilter.addEventListener("change", renderActivity);
featureUsageRange.addEventListener("change", loadFeatureUsage);
retryFeatureUsageButton.addEventListener("click", loadFeatureUsage);
demoAnalyticsRange.addEventListener("change", () => loadDemoAnalytics());
retryDemoAnalyticsButton.addEventListener("click", () => loadDemoAnalytics({force: true}));
customerAnalyticsRange.addEventListener("change", () => loadCustomerAnalytics());
retryCustomerAnalyticsButton.addEventListener("click", () => loadCustomerAnalytics({force: true}));
seedDemoDataButton.addEventListener("click", () => {
  demoEnvironmentController.run(demoTargetUid.value);
});
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

if(typeof ResizeObserver === "function"){
  const chartResizeObserver = new ResizeObserver(() => {
    for(const chart of adminCharts.values()) chart.resize();
    for(const chart of demoAnalyticsCharts.values()) chart.resize();
    customerAnalyticsChart?.resize();
  });
  chartResizeObserver.observe(growthOverview);
  chartResizeObserver.observe(document.getElementById("demoAnalyticsSection"));
  chartResizeObserver.observe(document.getElementById("customerAnalyticsSection"));
}

onAuthStateChanged(
  auth,
  user => {
    const nextAuthUid = user?.uid || "";
    if(nextAuthUid !== resolvedAuthUid){
      closeCustomerPanel();
      demoAnalyticsLoader.clear();
      customerAnalyticsLoader.clear();
      searchGeneration += 1;
      authGeneration += 1;
      resolvedAuthUid = nextAuthUid;
    }
    const decision = adminAccessDecision(user);
    if(decision === "signed-out"){
      currentAdminUser = null;
      showState("signedOutState");
      window.location.replace("/login.html");
      return;
    }
    if(decision === "denied"){
      currentAdminUser = null;
      showState("deniedState");
      return;
    }
    currentAdminUser = user;
    showAdminDashboard();
    loadAdminMetrics();
    loadRecentActivity();
    loadFeatureUsage();
    loadDemoAnalytics();
    loadCustomerAnalytics();
  },
  error => {
    authGeneration += 1;
    searchGeneration += 1;
    resolvedAuthUid = "";
    console.error("Admin authentication check failed", error);
    showState("errorState");
  }
);
