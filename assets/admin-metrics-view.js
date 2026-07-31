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

export function validateAdminUserSearchQuery(value){
  if(typeof value !== "string"){
    return Object.freeze({ valid: false, query: "", message: "Enter at least 2 characters to search all users." });
  }
  const query = value.trim();
  if(query.length < 2){
    return Object.freeze({ valid: false, query, message: "Enter at least 2 characters to search all users." });
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

export function buildCustomerSummary(details){
  const source = details || {};
  return [
    "Simple Books customer summary",
    "",
    `Email: ${String(source.email || "Not available")}`,
    `Plan: ${source.plan === "Pro" ? "Pro" : "Starter"}`,
    `Subscription status: ${formatSubscriptionStatus(source.subscriptionStatus)}`,
    `Created: ${formatAdminDate(source.createdDate)}`,
    `Last sign in: ${formatAdminDate(source.lastSignInTime)}`,
    `AI Assistant usage this month: ${safeMetricCount(source.aiAssistantSuccessfulUses)}`,
    `Invoice scans this month: ${safeMetricCount(source.invoiceScanningSuccessfulUses)}`,
    `Stripe customer linked: ${source.stripeCustomerPresent === true ? "Yes" : "No"}`
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
      message: "No customer account matches this email."
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
