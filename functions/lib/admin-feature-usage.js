/* eslint-disable max-len, require-jsdoc */

"use strict";

const {isDemoAuthUser} = require("./admin-authorization");
const {safeTimestamp} = require("./admin-activity");

const DEFAULT_FEATURE_USAGE_RANGE = "30d";
const FEATURE_USAGE_RANGES = Object.freeze({
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "all": null,
});
const FEATURE_USAGE_ITEMS = Object.freeze([
  {key: "invoice_created", label: "Invoices created"},
  {key: "invoice_scanned", label: "Invoice scans"},
  {key: "ai_question_asked", label: "AI Assistant"},
  {key: "user_logged_in", label: "Customer logins"},
  {key: "user_signed_up", label: "New accounts"},
  {key: "checkout_started", label: "Checkout started"},
  {key: "upgraded_to_pro", label: "Upgrades to Pro"},
  {key: "subscription_cancelled", label: "Subscription cancellations"},
]);
const FEATURE_KEYS = new Set(FEATURE_USAGE_ITEMS.map((item) => item.key));

function parseFeatureUsageRange(value) {
  const range = value === undefined ? DEFAULT_FEATURE_USAGE_RANGE : value;
  if (typeof range !== "string" || !Object.hasOwn(FEATURE_USAGE_RANGES, range)) {
    const error = new Error("Invalid feature usage range.");
    error.code = "invalid-argument";
    throw error;
  }
  return range;
}

function rangeStartDate(range, now) {
  const days = FEATURE_USAGE_RANGES[range];
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function buildAdminFeatureUsage({
  firestore,
  demoIdentifiers,
  range,
  now,
  timestampFactory,
}) {
  const approvedRange = parseFeatureUsageRange(range);
  const generatedAt = new Date(now);
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Invalid feature usage generation time.");
  }
  let query = firestore.collection("adminActivityEvents");
  const startDate = rangeStartDate(approvedRange, generatedAt);
  if (startDate) {
    query = query.where(
        "createdAt",
        ">=",
        timestampFactory.fromDate(startDate),
    );
  }
  query = query.select("eventType", "createdAt", "uid", "displayEmail");
  const snapshot = await query.get();
  const counts = new Map(FEATURE_USAGE_ITEMS.map((item) => [item.key, 0]));
  snapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    if (!FEATURE_KEYS.has(data.eventType) ||
      !data.createdAt || typeof data.createdAt.toDate !== "function" ||
      !safeTimestamp(data.createdAt)) return;
    if (isDemoAuthUser({uid: data.uid, email: data.displayEmail}, demoIdentifiers)) return;
    counts.set(data.eventType, counts.get(data.eventType) + 1);
  });
  const items = FEATURE_USAGE_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    count: counts.get(item.key),
  }));
  return {
    range: approvedRange,
    generatedAt: generatedAt.toISOString(),
    totalTrackedActions: items.reduce((total, item) => total + item.count, 0),
    items,
  };
}

module.exports = {
  DEFAULT_FEATURE_USAGE_RANGE,
  FEATURE_USAGE_ITEMS,
  FEATURE_USAGE_RANGES,
  buildAdminFeatureUsage,
  parseFeatureUsageRange,
  rangeStartDate,
};
