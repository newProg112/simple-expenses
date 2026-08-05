/* eslint-disable max-len, require-jsdoc */

"use strict";

const DEFAULT_DEMO_ANALYTICS_RANGE = "30d";
const DEMO_ANALYTICS_RANGES = Object.freeze({
  "7d": 7,
  "30d": 30,
  "all": null,
});
const DEMO_ANALYTICS_COLLECTION = "demoAnalyticsEvents";
const DEMO_ANALYTICS_QUERY_LIMIT = 10000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const PAGE_LABELS = Object.freeze({
  "/unknown": "Unknown Page",
  "/dashboard": "Dashboard",
  "/resources/tools/invoice-generator": "Invoices",
  "/resources/tools/client-tracker": "Clients",
  "/resources/tools/bills": "Bills",
  "/resources/tools/expenses": "Expenses",
  "/resources/tools/projects": "Projects",
  "/resources/tools/budgets": "Budgets",
  "/resources/tools/cashflow": "Cashflow",
  "/resources/tools/trial-balance": "Trial Balance",
  "/resources/tools/general-ledger": "General Ledger",
  "/resources/tools/profit-loss": "Profit & Loss",
  "/resources/tools/balance-sheet": "Balance Sheet",
  "/account": "Account",
});
const PAGE_PATH_ALIASES = Object.freeze({
  "/invoices": "/resources/tools/invoice-generator",
  "/clients": "/resources/tools/client-tracker",
  "/bills": "/resources/tools/bills",
  "/expenses": "/resources/tools/expenses",
  "/projects": "/resources/tools/projects",
  "/budgets": "/resources/tools/budgets",
  "/cashflow": "/resources/tools/cashflow",
  "/trial-balance": "/resources/tools/trial-balance",
  "/general-ledger": "/resources/tools/general-ledger",
  "/profit-loss": "/resources/tools/profit-loss",
  "/balance-sheet": "/resources/tools/balance-sheet",
});

function parseDemoAnalyticsRange(value) {
  const range = value === undefined ? DEFAULT_DEMO_ANALYTICS_RANGE : value;
  if (typeof range !== "string" || !Object.hasOwn(DEMO_ANALYTICS_RANGES, range)) {
    const error = new Error("Invalid demo analytics range.");
    error.code = "invalid-argument";
    throw error;
  }
  return range;
}

function utcDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function utcRangeStart(range, now) {
  const days = DEMO_ANALYTICS_RANGES[range];
  if (days === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * DAY_MS);
}

function safeStoredTimestamp(value) {
  try {
    const date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch (_error) {
    return null;
  }
}

function safeText(value, maximum) {
  if (typeof value !== "string") return "";
  return [...value]
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("")
      .trim()
      .slice(0, maximum);
}

function normalizePagePath(value) {
  const source = safeText(value, 512);
  if (!source) return "/unknown";
  let pathname;
  try {
    pathname = new URL(source, "https://simple-books.invalid").pathname;
    pathname = decodeURIComponent(pathname);
  } catch (_error) {
    pathname = source.split(/[?#]/, 1)[0];
  }
  pathname = `/${pathname}`.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  pathname = pathname.replace(/\/index\.html$/, "").replace(/\.html$/, "");
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (pathname === "/dashboard/" || pathname === "/dashboard.html") return "/dashboard";
  return PAGE_PATH_ALIASES[pathname] || pathname || "/";
}

function readablePageLabel(path) {
  const normalized = normalizePagePath(path);
  if (PAGE_LABELS[normalized]) return PAGE_LABELS[normalized];
  const segment = normalized.split("/").filter(Boolean).at(-1) || "Unknown page";
  const readable = segment
      .replace(/[-_]+/g, " ")
      .replace(/[^a-z0-9 &]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return readable || "Unknown page";
}

function isPageViewEvent(eventName) {
  return eventName.endsWith(" viewed");
}

function sanitizeDocuments(documents, startDate, now) {
  const startTime = startDate ? startDate.getTime() : -Infinity;
  const endTime = now.getTime();
  const events = [];
  for (const documentSnapshot of documents) {
    const data = documentSnapshot && typeof documentSnapshot.data === "function" ? documentSnapshot.data() || {} : {};
    const timestamp = safeStoredTimestamp(data.timestamp);
    const uid = safeText(data.uid, 128);
    const eventName = safeText(data.eventName, 120);
    if (!timestamp || timestamp.getTime() < startTime || timestamp.getTime() > endTime || !uid || !eventName) continue;
    events.push({
      timestamp,
      uid,
      eventName,
      page: normalizePagePath(data.page),
    });
  }
  return events.sort((left, right) => left.timestamp - right.timestamp || left.uid.localeCompare(right.uid));
}

function sessionizeEvents(events) {
  const byUid = new Map();
  for (const event of events) {
    if (!byUid.has(event.uid)) byUid.set(event.uid, []);
    byUid.get(event.uid).push(event);
  }
  const sessions = [];
  const finish = (session) => {
    if (!session) return;
    sessions.push({
      start: session.start,
      end: session.last < session.start ? session.start : session.last,
      pageViews: session.pageViews,
    });
  };
  for (const uidEvents of byUid.values()) {
    uidEvents.sort((left, right) => left.timestamp - right.timestamp);
    let current = null;
    for (const event of uidEvents) {
      const time = event.timestamp.getTime();
      const inactive = current && time - current.last.getTime() > SESSION_TIMEOUT_MS;
      if (current && (event.eventName === "Login" || inactive)) {
        finish(current);
        current = null;
      }
      if (!current) {
        current = {start: event.timestamp, last: event.timestamp, pageViews: 0};
      }
      current.last = event.timestamp;
      if (isPageViewEvent(event.eventName)) current.pageViews += 1;
      if (event.eventName === "Logout") {
        finish(current);
        current = null;
      }
    }
    finish(current);
  }
  return sessions.sort((left, right) => left.start - right.start);
}

function fixedDailyBuckets(range, now, events) {
  const days = DEMO_ANALYTICS_RANGES[range];
  if (days !== null) {
    const start = utcRangeStart(range, now);
    return Array.from({length: days}, (_item, index) => ({
      date: utcDayKey(start.getTime() + index * DAY_MS),
      sessions: 0,
      pageViews: 0,
    }));
  }
  return [...new Set(events.map((event) => utcDayKey(event.timestamp)).filter(Boolean))]
      .sort()
      .map((date) => ({date, sessions: 0, pageViews: 0}));
}

function aggregateDemoAnalytics(events, range, now, truncated = false) {
  const sessions = sessionizeEvents(events);
  const pageCounts = new Map();
  const eventCounts = new Map();
  let pageViews = 0;
  let logins = 0;
  for (const event of events) {
    eventCounts.set(event.eventName, (eventCounts.get(event.eventName) || 0) + 1);
    if (event.eventName === "Login") logins += 1;
    if (isPageViewEvent(event.eventName)) {
      pageViews += 1;
      pageCounts.set(event.page, (pageCounts.get(event.page) || 0) + 1);
    }
  }
  const durationTotal = sessions.reduce((total, session) => total + Math.max(0, session.end - session.start), 0);
  const daily = fixedDailyBuckets(range, now, events);
  const dailyByDate = new Map(daily.map((item) => [item.date, item]));
  for (const session of sessions) {
    const bucket = dailyByDate.get(utcDayKey(session.start));
    if (bucket) bucket.sessions += 1;
  }
  for (const event of events) {
    if (!isPageViewEvent(event.eventName)) continue;
    const bucket = dailyByDate.get(utcDayKey(event.timestamp));
    if (bucket) bucket.pageViews += 1;
  }
  const pages = [...pageCounts.entries()]
      .map(([path, count]) => ({
        path,
        label: readablePageLabel(path),
        count,
        percentage: pageViews ? Math.round(count / pageViews * 1000) / 10 : 0,
      }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const eventBreakdown = [...eventCounts.entries()]
      .map(([eventName, count]) => ({eventName, count}))
      .sort((left, right) => right.count - left.count || left.eventName.localeCompare(right.eventName));
  return {
    metrics: {
      demoLogins: logins,
      demoSessions: sessions.length,
      totalPageViews: pageViews,
      averagePagesPerSession: sessions.length ? Math.round(pageViews / sessions.length * 100) / 100 : 0,
      averageSessionDurationSeconds: sessions.length ? Math.round(durationTotal / sessions.length / 1000) : 0,
      singlePageSessions: sessions.filter((session) => session.pageViews === 1).length,
    },
    pages,
    daily,
    eventBreakdown,
    eventsProcessed: events.length,
    truncated: Boolean(truncated),
  };
}

async function buildAdminDemoAnalytics({firestore, range, now, timestampFactory}) {
  const approvedRange = parseDemoAnalyticsRange(range);
  const generatedAt = new Date(now);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("Invalid generation time.");
  const startDate = utcRangeStart(approvedRange, generatedAt);
  let query = firestore.collection(DEMO_ANALYTICS_COLLECTION);
  if (startDate) query = query.where("timestamp", ">=", timestampFactory.fromDate(startDate));
  query = query
      .where("timestamp", "<=", timestampFactory.fromDate(generatedAt))
      .orderBy("timestamp", "desc")
      .limit(DEMO_ANALYTICS_QUERY_LIMIT + 1)
      .select("timestamp", "uid", "eventName", "page");
  const snapshot = await query.get();
  const truncated = snapshot.docs.length > DEMO_ANALYTICS_QUERY_LIMIT;
  const documents = truncated ? snapshot.docs.slice(0, DEMO_ANALYTICS_QUERY_LIMIT) : snapshot.docs;
  const events = sanitizeDocuments(documents, startDate, generatedAt);
  return {
    range: approvedRange,
    generatedAt: generatedAt.toISOString(),
    ...aggregateDemoAnalytics(events, approvedRange, generatedAt, truncated),
  };
}

module.exports = {
  DEFAULT_DEMO_ANALYTICS_RANGE,
  DEMO_ANALYTICS_COLLECTION,
  DEMO_ANALYTICS_QUERY_LIMIT,
  DEMO_ANALYTICS_RANGES,
  SESSION_TIMEOUT_MS,
  aggregateDemoAnalytics,
  buildAdminDemoAnalytics,
  normalizePagePath,
  parseDemoAnalyticsRange,
  readablePageLabel,
  sanitizeDocuments,
  sessionizeEvents,
  utcRangeStart,
};
