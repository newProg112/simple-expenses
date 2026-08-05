function safeCount(value){
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function safeDecimal(value){
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function safeLabel(value, fallback){
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : fallback;
}

export function normalizeDemoAnalyticsPayload(payload){
  const source = payload && typeof payload === "object" ? payload : {};
  const metrics = source.metrics && typeof source.metrics === "object" ? source.metrics : {};
  const pages = Array.isArray(source.pages) ? source.pages : [];
  const daily = Array.isArray(source.daily) ? source.daily : [];
  const eventBreakdown = Array.isArray(source.eventBreakdown) ? source.eventBreakdown : [];
  return {
    range: ["7d", "30d", "all"].includes(source.range) ? source.range : "30d",
    generatedAt: typeof source.generatedAt === "string" ? source.generatedAt : "",
    metrics: {
      demoLogins: safeCount(metrics.demoLogins),
      demoSessions: safeCount(metrics.demoSessions),
      totalPageViews: safeCount(metrics.totalPageViews),
      averagePagesPerSession: safeDecimal(metrics.averagePagesPerSession),
      averageSessionDurationSeconds: safeDecimal(metrics.averageSessionDurationSeconds),
      singlePageSessions: safeCount(metrics.singlePageSessions)
    },
    pages: pages.map(item => ({
      label: safeLabel(item?.label, "Unknown page"),
      count: safeCount(item?.count),
      percentage: Math.min(100, safeDecimal(item?.percentage))
    })).filter(item => item.count > 0),
    daily: daily.map(item => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date) ? item.date : "",
      sessions: safeCount(item?.sessions),
      pageViews: safeCount(item?.pageViews)
    })).filter(item => item.date),
    eventBreakdown: eventBreakdown.map(item => ({
      eventName: safeLabel(item?.eventName, "Unknown event"),
      count: safeCount(item?.count)
    })).filter(item => item.count > 0),
    eventsProcessed: safeCount(source.eventsProcessed),
    truncated: source.truncated === true
  };
}

export function formatDemoSessionDuration(seconds){
  const totalSeconds = Math.max(0, Math.round(safeDecimal(seconds)));
  if(totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if(minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function demoAnalyticsErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated") return {kind: "unauthenticated"};
  if(code === "permission-denied") return {kind: "permission-denied"};
  if(code === "failed-precondition"){
    return {kind: "error", title: "Demo Analytics is not configured", message: "The secure owner configuration needs attention."};
  }
  return {kind: "error", title: "Demo Analytics could not be loaded", message: "Check your connection and try again."};
}

export function createDemoAnalyticsLoader({request, onLoading, onSuccess, onError} = {}){
  const cache = new Map();
  let activeRequest = null;

  function load(range, {force = false} = {}){
    if(activeRequest) return activeRequest;
    if(!force && cache.has(range)){
      const cached = cache.get(range);
      onSuccess?.(cached, {cached: true});
      return Promise.resolve(cached);
    }
    onLoading?.();
    activeRequest = Promise.resolve()
      .then(() => request(range))
      .then(payload => {
        cache.set(range, payload);
        onSuccess?.(payload, {cached: false});
        return payload;
      })
      .catch(error => {
        onError?.(error);
        return null;
      })
      .finally(() => {
        activeRequest = null;
      });
    return activeRequest;
  }

  return {
    load,
    clear(){
      cache.clear();
    },
    isLoading(){
      return Boolean(activeRequest);
    }
  };
}
