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
