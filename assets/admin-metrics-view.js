export function safeMetricCount(value){
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function formatEstimatedMrr(pence, currency = "GBP"){
  const safePence = safeMetricCount(pence);
  const safeCurrency = currency === "GBP" ? currency : "GBP";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safePence / 100);
}

export function formatAdminDate(value){
  if(typeof value !== "string" || !value) return "Not available";
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function formatSubscriptionStatus(value){
  if(typeof value !== "string" || !value) return "Not set";
  return value
    .split("_")
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function filterSignupsByEmail(signups, query){
  if(!Array.isArray(signups)) return [];
  const term = typeof query === "string" ? query.trim().toLowerCase() : "";
  if(!term) return signups.slice();
  return signups.filter(signup =>
    String(signup?.email || "").toLowerCase().includes(term)
  );
}

function validChartPoint(point){
  return point && /^\d{4}-(0[1-9]|1[0-2])$/.test(point.monthKey) &&
    typeof point.label === "string" && point.label.trim() &&
    Number.isInteger(point.count) && point.count >= 0;
}

export function buildAdminChartModel(charts, metrics){
  if(!charts || charts.rangeMonths !== 12 ||
    !Array.isArray(charts.monthlySignups) ||
    !Array.isArray(charts.cumulativeUsers) ||
    charts.monthlySignups.length !== 12 ||
    charts.cumulativeUsers.length !== 12) return null;

  const monthly = charts.monthlySignups;
  const cumulative = charts.cumulativeUsers;
  for(let index = 0; index < 12; index += 1){
    if(!validChartPoint(monthly[index]) || !validChartPoint(cumulative[index]) ||
      monthly[index].monthKey !== cumulative[index].monthKey ||
      monthly[index].label !== cumulative[index].label ||
      (index > 0 && monthly[index - 1].monthKey >= monthly[index].monthKey) ||
      (index > 0 && cumulative[index].count < cumulative[index - 1].count)) return null;
  }

  const starter = charts.planDistribution?.starter;
  const pro = charts.planDistribution?.pro;
  const totalUsers = metrics?.totalUsers;
  if(!Number.isInteger(starter) || starter < 0 ||
    !Number.isInteger(pro) || pro < 0 ||
    starter !== metrics?.starterUsers || pro !== metrics?.proUsers ||
    starter + pro !== totalUsers ||
    cumulative[11].count !== totalUsers) return null;

  return Object.freeze({
    labels: monthly.map(point => point.label),
    monthlyValues: monthly.map(point => point.count),
    cumulativeValues: cumulative.map(point => point.count),
    planValues: [starter, pro],
    totalUsers
  });
}

export function chartSummaryItems(labels, values, suffix){
  if(!Array.isArray(labels) || !Array.isArray(values) || labels.length !== values.length) return [];
  return labels.map((label, index) => `${label}: ${safeMetricCount(values[index])} ${suffix}`);
}

export function validateAdminUserSearchQuery(value){
  if(typeof value !== "string"){
    return Object.freeze({ valid: false, query: "", message: "Enter an email, full name or exact Firebase UID." });
  }
  const query = value.trim();
  if(query.length < 1){
    return Object.freeze({ valid: false, query, message: "Enter an email, full name or exact Firebase UID." });
  }
  if(query.length > 320){
    return Object.freeze({ valid: false, query, message: "Search text must be 320 characters or fewer." });
  }
  return Object.freeze({ valid: true, query, message: "" });
}

export function adminUserSearchErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated") return Object.freeze({ kind: "unauthenticated" });
  if(code === "permission-denied") return Object.freeze({ kind: "permission-denied" });
  if(code === "failed-precondition"){
    return Object.freeze({
      kind: "configuration",
      title: "Customer search is not configured",
      message: "The backend owner and demo identifiers must be configured before all users can be searched."
    });
  }
  return Object.freeze({
    kind: "general",
    title: "Customer search unavailable",
    message: "The secure customer search service is unavailable. Try again in a moment."
  });
}

const diagnosticMessages = Object.freeze({
  "missing-profile": "No profile document is available for this account.",
  "plan-not-set": "No plan has been recorded for this account.",
  "subscription-status-not-set": "No subscription status has been recorded for this account.",
  "stripe-customer-not-linked": "A Stripe customer is not linked to this account.",
  "no-ai-usage-this-month": "No successful AI Assistant usage is recorded for the current month.",
  "no-invoice-scan-usage-this-month": "No successful invoice scan usage is recorded for the current month."
});

export function supportDiagnosticMessages(codes){
  if(!Array.isArray(codes)) return [];
  return codes
    .filter(code => Object.hasOwn(diagnosticMessages, code))
    .map(code => diagnosticMessages[code]);
}

function firstDefined(...values){
  return values.find(value => value !== undefined);
}

export function normalizeAdminUserDetailsPayload(payload){
  const initial = payload && typeof payload === "object" ? payload : {};
  const source = initial.data && typeof initial.data === "object" && !initial.account
    ? initial.data
    : initial;
  const accountSource = source.account && typeof source.account === "object" ? source.account : {};
  const planSource = source.plan && typeof source.plan === "object" ? source.plan : {};
  const usageSource = source.usage && typeof source.usage === "object" ? source.usage : {};
  return Object.freeze({
    account: Object.freeze({
      uid: firstDefined(accountSource.uid, source.uid, ""),
      email: firstDefined(accountSource.email, source.email, ""),
      fullName: firstDefined(accountSource.fullName, source.fullName, source.displayName, ""),
      businessName: firstDefined(accountSource.businessName, source.businessName, ""),
      signupDate: firstDefined(accountSource.signupDate, source.signupDate, source.createdDate, null),
      lastSignInDate: firstDefined(accountSource.lastSignInDate, source.lastSignInDate, source.lastSignInTime, null),
      disabled: firstDefined(accountSource.disabled, source.disabled, null),
      emailVerified: firstDefined(accountSource.emailVerified, source.emailVerified, null),
      demo: firstDefined(accountSource.demo, source.demo, null),
      admin: firstDefined(accountSource.admin, source.admin, null),
      badges: Array.isArray(accountSource.badges)
        ? accountSource.badges.slice()
        : (Array.isArray(source.accountStatus) ? source.accountStatus.slice() : [])
    }),
    plan: Object.freeze({
      currentPlan: firstDefined(planSource.currentPlan, source.currentPlan,
        typeof source.plan === "string" ? source.plan : undefined, ""),
      subscriptionStatus: firstDefined(planSource.subscriptionStatus, source.subscriptionStatus, ""),
      currentPeriodEnd: firstDefined(planSource.currentPeriodEnd, source.currentPeriodEnd, null),
      activePaidSubscription: firstDefined(planSource.activePaidSubscription, source.activePaidSubscription, null)
    }),
    usage: Object.freeze({
      monthKey: firstDefined(usageSource.monthKey, source.monthKey, ""),
      aiAssistantSuccessfulUses: firstDefined(usageSource.aiAssistantSuccessfulUses, source.aiAssistantSuccessfulUses, null),
      aiAssistantAllowance: firstDefined(usageSource.aiAssistantAllowance, source.aiAssistantAllowance, null),
      invoiceScanningSuccessfulUses: firstDefined(usageSource.invoiceScanningSuccessfulUses, source.invoiceScanningSuccessfulUses, null),
      invoiceScanningAllowance: firstDefined(usageSource.invoiceScanningAllowance, source.invoiceScanningAllowance, null),
      activeProjects: firstDefined(usageSource.activeProjects, source.activeProjects, null)
    }),
    recentActivity: Array.isArray(source.recentActivity) ? source.recentActivity.slice(0, 20) : [],
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics.slice() : []
  });
}

export function buildCustomerSummary(details){
  const source = normalizeAdminUserDetailsPayload(details);
  const account = source.account || {};
  const plan = source.plan || {};
  const usage = source.usage || {};
  const visibleText = value => typeof value === "string" && value.trim() ? value.trim() : "Not available";
  const visibleCount = value => typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(safeMetricCount(value))
    : "Not available";
  return [
    "Simple Books customer summary",
    "",
    `Firebase UID: ${visibleText(account.uid)}`,
    `Email: ${visibleText(account.email)}`,
    `Full name: ${visibleText(account.fullName)}`,
    `Business name: ${visibleText(account.businessName)}`,
    `Account status: ${Array.isArray(account.badges) && account.badges.length ? account.badges.join(", ") : "Not available"}`,
    `Plan: ${visibleText(plan.currentPlan)}`,
    `Subscription status: ${plan.subscriptionStatus ? formatSubscriptionStatus(plan.subscriptionStatus) : "Not available"}`,
    `Created: ${formatAdminDate(account.signupDate)}`,
    `Last sign in: ${formatAdminDate(account.lastSignInDate)}`,
    `AI Assistant usage this month: ${visibleCount(usage.aiAssistantSuccessfulUses)} of ${visibleCount(usage.aiAssistantAllowance)}`,
    `Invoice scans this month: ${visibleCount(usage.invoiceScanningSuccessfulUses)} of ${visibleCount(usage.invoiceScanningAllowance)}`,
    `Active projects: ${visibleCount(usage.activeProjects)}`
  ].join("\n");
}

export function adminUserDetailsErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated"){
    return Object.freeze({ kind: "unauthenticated" });
  }
  if(code === "permission-denied"){
    return Object.freeze({ kind: "permission-denied" });
  }
  if(code === "not-found"){
    return Object.freeze({
      kind: "not-found",
      title: "No customer found",
      message: "No customer account matches this UID or email."
    });
  }
  return Object.freeze({
    kind: "general",
    title: "Customer details unavailable",
    message: "The secure customer lookup service is unavailable. Try again in a moment."
  });
}

export function adminMetricsErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated"){
    return Object.freeze({ kind: "unauthenticated" });
  }
  if(code === "permission-denied"){
    return Object.freeze({ kind: "permission-denied" });
  }
  if(code === "failed-precondition"){
    return Object.freeze({
      kind: "configuration",
      title: "Admin metrics are not configured",
      message: "The backend owner and demo identifiers must be configured before metrics can be loaded."
    });
  }
  return Object.freeze({
    kind: "general",
    title: "Metrics could not be loaded",
    message: "The secure admin metrics service is unavailable. Try again in a moment."
  });
}
