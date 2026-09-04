/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  EVENT_PRESENTATION,
  getRecentActivity,
  normalizeEmail,
} = require("./admin-activity");
const {
  GROWTH_RANGE_MONTHS,
  PRO_MONTHLY_PRICE_PENCE,
  buildAdminMetrics,
} = require("./admin-metrics");
const {
  parseAdminUidAllowList,
  parseDemoIdentifiers,
} = require("./admin-authorization");

const FOUNDER_ANALYTICS_SCHEMA_VERSION = 1;
const DEFAULT_FOUNDER_ACTIVITY_LIMIT = 20;
const MAX_FOUNDER_ACTIVITY_LIMIT = 30;

class FounderAnalyticsProjectionError extends Error {
  constructor(code) {
    super("Founder Analytics source data is invalid.");
    this.name = "FounderAnalyticsProjectionError";
    this.code = code;
  }
}

function projectionError(code) {
  return new FounderAnalyticsProjectionError(code);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value, code) {
  if (!Number.isInteger(value) || value < 0) throw projectionError(code);
  return value;
}

function canonicalIsoTimestamp(value, code) {
  if (typeof value !== "string") throw projectionError(code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw projectionError(code);
  }
  return value;
}

function parseFounderActivityLimit(value) {
  if (value === undefined) return DEFAULT_FOUNDER_ACTIVITY_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_FOUNDER_ACTIVITY_LIMIT) {
    const error = new TypeError("Founder Analytics activity limit is invalid.");
    error.code = "invalid-argument";
    throw error;
  }
  return value;
}

function authExcludingAdminUids(auth, adminUids) {
  if (!auth || typeof auth.listUsers !== "function") {
    throw new TypeError("A Firebase Auth Admin service is required.");
  }
  if (!(adminUids instanceof Set)) {
    throw new TypeError("A parsed admin UID allow-list is required.");
  }
  return {
    async listUsers(maxResults, pageToken) {
      const page = await auth.listUsers(maxResults, pageToken);
      const users = Array.isArray(page && page.users) ? page.users : [];
      return {
        users: users.filter((user) => !adminUids.has(user && user.uid)),
        pageToken: page && page.pageToken ? page.pageToken : undefined,
      };
    },
  };
}

function projectOverview(metricsResult) {
  const metrics = isObject(metricsResult) && isObject(metricsResult.metrics) ?
    metricsResult.metrics : null;
  if (!metrics) throw projectionError("invalid-overview");

  const totalUsers = nonNegativeInteger(metrics.totalUsers, "invalid-overview");
  const starterUsers = nonNegativeInteger(metrics.starterUsers, "invalid-overview");
  const proUsers = nonNegativeInteger(metrics.proUsers, "invalid-overview");
  const activePaidSubscriptions = nonNegativeInteger(
      metrics.activePaidSubscriptions,
      "invalid-overview",
  );
  const estimatedMrrMinorUnits = nonNegativeInteger(
      metrics.estimatedMrrPence,
      "invalid-overview",
  );

  if (starterUsers + proUsers !== totalUsers ||
    activePaidSubscriptions > proUsers ||
    estimatedMrrMinorUnits !== activePaidSubscriptions * PRO_MONTHLY_PRICE_PENCE ||
    metrics.currency !== "GBP") {
    throw projectionError("inconsistent-overview");
  }

  return {
    totalUsers,
    starterUsers,
    proUsers,
    activePaidSubscriptions,
    estimatedMrrMinorUnits,
    currency: "GBP",
  };
}

function monthOrdinal(monthKey) {
  if (typeof monthKey !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    return null;
  }
  const [year, month] = monthKey.split("-").map(Number);
  return year * 12 + month - 1;
}

function projectMonthlySignups(metricsResult, generatedAt) {
  const charts = isObject(metricsResult) && isObject(metricsResult.charts) ?
    metricsResult.charts : null;
  const source = charts && charts.monthlySignups;
  if (!charts || charts.rangeMonths !== GROWTH_RANGE_MONTHS ||
    !Array.isArray(source) || source.length !== GROWTH_RANGE_MONTHS) {
    throw projectionError("invalid-monthly-signups");
  }

  let previousOrdinal = null;
  const projected = source.map((item) => {
    if (!isObject(item)) throw projectionError("invalid-monthly-signups");
    const ordinal = monthOrdinal(item.monthKey);
    if (ordinal === null ||
      (previousOrdinal !== null && ordinal !== previousOrdinal + 1)) {
      throw projectionError("invalid-monthly-signups");
    }
    previousOrdinal = ordinal;
    return {
      monthKey: item.monthKey,
      count: nonNegativeInteger(item.count, "invalid-monthly-signups"),
    };
  });

  if (projected.at(-1).monthKey !== generatedAt.slice(0, 7)) {
    throw projectionError("invalid-monthly-signups");
  }
  return projected;
}

function projectRecentActivity(activityResult) {
  const events = isObject(activityResult) && Array.isArray(activityResult.events) ?
    activityResult.events : null;
  if (!events || events.length > MAX_FOUNDER_ACTIVITY_LIMIT) {
    throw projectionError("invalid-recent-activity");
  }

  let previousTime = Infinity;
  return events.map((event) => {
    if (!isObject(event) ||
      typeof event.eventType !== "string" ||
      !Object.hasOwn(EVENT_PRESENTATION, event.eventType)) {
      throw projectionError("invalid-recent-activity");
    }
    const createdAt = canonicalIsoTimestamp(
        event.createdAt,
        "invalid-recent-activity",
    );
    const time = new Date(createdAt).getTime();
    if (time > previousTime) throw projectionError("invalid-recent-activity");
    previousTime = time;
    const displayEmail = normalizeEmail(event.displayEmail);
    return {
      eventType: event.eventType,
      createdAt,
      summary: EVENT_PRESENTATION[event.eventType].summary,
      displayEmail: displayEmail || null,
    };
  });
}

function projectFounderAnalyticsSnapshot({
  generatedAt,
  metricsResult,
  activityResult,
}) {
  const timestamp = canonicalIsoTimestamp(generatedAt, "invalid-generated-at");
  return {
    schemaVersion: FOUNDER_ANALYTICS_SCHEMA_VERSION,
    generatedAt: timestamp,
    overview: projectOverview(metricsResult),
    monthlySignups: projectMonthlySignups(metricsResult, timestamp),
    recentActivity: projectRecentActivity(activityResult),
  };
}

async function buildFounderAnalyticsSnapshot(options = {}) {
  const now = options.now === undefined ? new Date() : options.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("A valid Founder Analytics snapshot date is required.");
  }
  const snapshotNow = new Date(now.getTime());
  const adminUids = parseAdminUidAllowList(options.adminUidConfiguration);
  const demoIdentifiers = parseDemoIdentifiers(options.demoConfiguration);
  const activityLimit = parseFounderActivityLimit(options.activityLimit);
  const metricsBuilder = options.metricsBuilder || buildAdminMetrics;
  const activityReader = options.activityReader || getRecentActivity;

  const [metricsResult, activityResult] = await Promise.all([
    metricsBuilder({
      auth: authExcludingAdminUids(options.auth, adminUids),
      firestore: options.firestore,
      demoIdentifiers,
      proPriceId: options.proPriceId,
      expectedMode: options.expectedMode,
      now: snapshotNow,
    }),
    activityReader({
      firestore: options.firestore,
      demoIdentifiers,
      limit: activityLimit,
      timestampFactory: options.timestampFactory,
      documentIdField: options.documentIdField,
    }),
  ]);

  return projectFounderAnalyticsSnapshot({
    generatedAt: snapshotNow.toISOString(),
    metricsResult,
    activityResult,
  });
}

module.exports = {
  DEFAULT_FOUNDER_ACTIVITY_LIMIT,
  FOUNDER_ANALYTICS_SCHEMA_VERSION,
  FounderAnalyticsProjectionError,
  MAX_FOUNDER_ACTIVITY_LIMIT,
  authExcludingAdminUids,
  buildFounderAnalyticsSnapshot,
  parseFounderActivityLimit,
  projectFounderAnalyticsSnapshot,
};
