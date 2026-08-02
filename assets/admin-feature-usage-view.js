export const FEATURE_USAGE_DEFINITIONS = Object.freeze([
  {key: "invoice_created", label: "Invoices created"},
  {key: "invoice_scanned", label: "Invoice scans"},
  {key: "ai_question_asked", label: "AI Assistant"},
  {key: "user_logged_in", label: "Customer logins"},
  {key: "user_signed_up", label: "New accounts"},
  {key: "checkout_started", label: "Checkout started"},
  {key: "upgraded_to_pro", label: "Upgrades to Pro"},
  {key: "subscription_cancelled", label: "Subscription cancellations"}
]);

function safeCount(value){
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export function normalizeFeatureUsageItems(items){
  const source = new Map();
  if(Array.isArray(items)){
    for(const item of items){
      if(item && typeof item.key === "string" && !source.has(item.key)){
        source.set(item.key, safeCount(item.count));
      }
    }
  }
  return FEATURE_USAGE_DEFINITIONS.map(definition => ({
    ...definition,
    count: source.get(definition.key) || 0
  }));
}

export function sortFeatureUsageItems(items){
  const order = new Map(FEATURE_USAGE_DEFINITIONS.map((item, index) => [item.key, index]));
  return normalizeFeatureUsageItems(items).sort((left, right) =>
    right.count - left.count || order.get(left.key) - order.get(right.key)
  );
}

export function buildFeatureUsageChartModel(items){
  const sorted = sortFeatureUsageItems(items);
  return {
    labels: sorted.map(item => item.label),
    counts: sorted.map(item => item.count),
    items: sorted,
    totalTrackedActions: sorted.reduce((total, item) => total + item.count, 0),
    mostUsedFeature: sorted[0]?.count > 0 ? sorted[0].label : ""
  };
}

export function featureUsageErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated") return {kind: "unauthenticated"};
  if(code === "permission-denied") return {kind: "permission-denied"};
  if(code === "failed-precondition"){
    return {kind: "error", title: "Feature usage is not configured", message: "The secure owner and demo-account configuration needs attention."};
  }
  return {kind: "error", title: "Feature usage could not be loaded", message: "Check your connection and try again."};
}
