const EVENT_PARAMETER_RULES = Object.freeze({
  sign_up: Object.freeze({ method: Object.freeze(["email"]) }),
  login: Object.freeze({ method: Object.freeze(["email"]) }),
  invoice_created: Object.freeze({
    plan: Object.freeze(["starter", "pro"]),
    has_vat: "boolean",
    item_count_bucket: Object.freeze(["1", "2-3", "4+"])
  }),
  invoice_scanned: Object.freeze({
    plan: Object.freeze(["starter", "pro"]),
    file_type: Object.freeze(["pdf", "jpg", "jpeg", "png", "other"])
  }),
  ai_question_asked: Object.freeze({ plan: Object.freeze(["starter", "pro"]) }),
  begin_checkout: Object.freeze({
    currency: Object.freeze(["GBP"]),
    value: Object.freeze([15]),
    plan: Object.freeze(["pro"])
  })
});

export const ALLOWED_ANALYTICS_EVENTS = Object.freeze(
  Object.keys(EVENT_PARAMETER_RULES)
);

export function normalizeAnalyticsPlan(value){
  return String(value || "").trim().toLowerCase() === "pro" ? "pro" : "starter";
}

export function invoiceItemCountBucket(value){
  const count = Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : 1;
  if(count === 1) return "1";
  if(count <= 3) return "2-3";
  return "4+";
}

export function normalizeAnalyticsFileType(value){
  const source = String(value || "").trim().toLowerCase().split(/[?#]/, 1)[0];
  const extension = source.includes(".") ? source.slice(source.lastIndexOf(".") + 1) : source;
  return ["pdf", "jpg", "jpeg", "png"].includes(extension) ? extension : "other";
}

export function sanitizeAnalyticsParameters(eventName, parameters){
  const rules = EVENT_PARAMETER_RULES[eventName];
  if(!rules) return null;
  const source = parameters && typeof parameters === "object" && !Array.isArray(parameters)
    ? parameters
    : {};
  const safe = {};

  for(const [key, rule] of Object.entries(rules)){
    const value = source[key];
    if(rule === "boolean"){
      if(typeof value === "boolean") safe[key] = value;
    }else if(rule.includes(value)){
      safe[key] = value;
    }
  }

  return safe;
}

export function analyticsRuntimeDisabled(runtime = globalThis){
  if(!runtime || !runtime.location) return true;
  const hostname = String(runtime.location.hostname || "").toLowerCase();
  if(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true;
  try{
    if(runtime.sessionStorage?.getItem("simpleBooksUseFirebaseEmulators") === "true") return true;
  }catch(_error){
    return true;
  }
  return Boolean(runtime.__FIREBASE_DEFAULTS__?.emulatorHosts);
}

export function createAnalyticsTracker({
  analytics,
  logEvent,
  runtime = globalThis,
  now = () => Date.now(),
  dedupeWindowMs = 1000,
  warn = () => {}
} = {}){
  const recentEvents = new Map();

  return async function trackAnalyticsEvent(eventName, parameters = {}){
    let safeParameters;
    try{
      safeParameters = sanitizeAnalyticsParameters(eventName, parameters);
      if(!safeParameters || analyticsRuntimeDisabled(runtime) || !analytics || typeof logEvent !== "function"){
        return false;
      }
    }catch(_error){
      return false;
    }

    const fingerprint = `${eventName}:${JSON.stringify(safeParameters)}`;
    const timestamp = now();
    const previousTimestamp = recentEvents.get(fingerprint);
    if(previousTimestamp !== undefined && timestamp - previousTimestamp < dedupeWindowMs) return false;
    recentEvents.set(fingerprint, timestamp);

    try{
      await Promise.resolve(logEvent(analytics, eventName, safeParameters));
      return true;
    }catch(_error){
      warn(`Analytics event unavailable: ${eventName}`);
      return false;
    }
  };
}

export { EVENT_PARAMETER_RULES };
