/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("crypto");
const {isDemoAuthUser} = require("./admin-authorization");

const ACTIVITY_COLLECTION = "adminActivityEvents";
const DEFAULT_ACTIVITY_LIMIT = 30;
const MAX_ACTIVITY_LIMIT = 100;
const FRONTEND_EVENT_TYPES = new Set([
  "user_logged_in",
  "invoice_created",
  "invoice_scanned",
  "ai_question_asked",
  "checkout_started",
  "bill_created",
  "expense_created",
  "mileage_created",
  "project_created",
  "budget_created",
  "accountant_pack_generated",
  "trial_balance_viewed",
  "general_ledger_viewed",
  "profit_and_loss_viewed",
  "balance_sheet_viewed",
  "business_insights_viewed",
  "business_insights_actionable_viewed",
  "business_insights_forecasts_viewed",
  "business_insights_upgrade_prompt_viewed",
  "business_insights_upgrade_clicked",
]);
const CUSTOMER_ANALYTICS_EVENT_TYPES = new Set([
  "bill_created",
  "expense_created",
  "mileage_created",
  "project_created",
  "budget_created",
  "accountant_pack_generated",
  "trial_balance_viewed",
  "general_ledger_viewed",
  "profit_and_loss_viewed",
  "balance_sheet_viewed",
  "business_insights_viewed",
  "business_insights_actionable_viewed",
  "business_insights_forecasts_viewed",
  "business_insights_upgrade_prompt_viewed",
  "business_insights_upgrade_clicked",
]);
const EVENT_PRESENTATION = Object.freeze({
  user_signed_up: {summary: "A new Simple Books account was registered."},
  user_logged_in: {summary: "A customer signed in to Simple Books."},
  invoice_created: {summary: "An invoice was successfully created."},
  invoice_scanned: {summary: "An invoice document was successfully scanned."},
  ai_question_asked: {summary: "The AI Assistant returned a successful answer."},
  checkout_started: {summary: "A valid Pro checkout session was started."},
  upgraded_to_pro: {summary: "A customer upgraded to the Pro plan."},
  subscription_cancelled: {summary: "A Pro subscription was cancelled."},
  bill_created: {summary: "A bill was successfully created."},
  expense_created: {summary: "An expense was successfully created."},
  mileage_created: {summary: "A mileage claim was successfully created."},
  project_created: {summary: "A project was successfully created."},
  budget_created: {summary: "A budget was successfully created."},
  accountant_pack_generated: {summary: "An Accountant Pack was successfully generated."},
  trial_balance_viewed: {summary: "The Trial Balance report was opened."},
  general_ledger_viewed: {summary: "The General Ledger report was opened."},
  profit_and_loss_viewed: {summary: "The Profit & Loss report was opened."},
  balance_sheet_viewed: {summary: "The Balance Sheet report was opened."},
  business_insights_viewed: {summary: "Business Insights was opened."},
  business_insights_actionable_viewed: {summary: "Actionable Business Insights were shown."},
  business_insights_forecasts_viewed: {summary: "Business Insights forecasts were shown."},
  business_insights_upgrade_prompt_viewed: {summary: "Business Insights Pro information was shown."},
  business_insights_upgrade_clicked: {summary: "The Business Insights Pro upgrade was selected."},
});
const ALLOWED_REQUEST_FIELDS = new Set(["eventType", "idempotencyKey"]);

function normalizePlan(value) {
  return String(value || "").trim().toLowerCase() === "pro" ? "pro" : "starter";
}

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validateIdempotencyKey(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    const error = new Error("Invalid activity idempotency key.");
    error.code = "invalid-argument";
    throw error;
  }
  return value;
}

function validateFrontendActivityRequest(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("Activity event data is required.");
    error.code = "invalid-argument";
    throw error;
  }
  const keys = Object.keys(data);
  if (keys.some((key) => !ALLOWED_REQUEST_FIELDS.has(key))) {
    const error = new Error("Unknown activity event fields.");
    error.code = "invalid-argument";
    throw error;
  }
  if (!FRONTEND_EVENT_TYPES.has(data.eventType)) {
    const error = new Error("Unsupported activity event type.");
    error.code = "invalid-argument";
    throw error;
  }
  return {
    eventType: data.eventType,
    idempotencyKey: validateIdempotencyKey(data.idempotencyKey),
  };
}

function activityDocumentId(uid, eventType, idempotencyKey, now = new Date()) {
  const rapidDuplicateWindow = Math.floor(now.getTime() / 30000);
  const uniquePart = idempotencyKey || String(rapidDuplicateWindow);
  return crypto.createHash("sha256")
      .update(`${uid}\n${eventType}\n${uniquePart}`)
      .digest("hex");
}

async function trustedActivityIdentity({auth, firestore, uid}) {
  const [user, profileSnapshot] = await Promise.all([
    auth.getUser(uid),
    firestore.collection("userProfiles").doc(uid).get(),
  ]);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  return {
    uid,
    displayEmail: normalizeEmail(user.email || profile.email),
    plan: normalizePlan(profile.currentPlan),
  };
}

async function writeActivityEvent({
  firestore,
  fieldValue,
  identity,
  eventType,
  idempotencyKey,
  now = new Date(),
}) {
  if (!Object.hasOwn(EVENT_PRESENTATION, eventType)) {
    throw new Error("Unsupported trusted activity event type.");
  }
  const documentId = activityDocumentId(
      identity.uid,
      eventType,
      idempotencyKey,
      now,
  );
  const customerAnalyticsOnly = CUSTOMER_ANALYTICS_EVENT_TYPES.has(eventType);
  const record = {
    eventType,
    createdAt: fieldValue.serverTimestamp(),
    uid: identity.uid,
    ...(!customerAnalyticsOnly ? {
      displayEmail: normalizeEmail(identity.displayEmail),
      plan: normalizePlan(identity.plan),
      summary: EVENT_PRESENTATION[eventType].summary,
      metadata: {},
    } : {}),
  };
  try {
    await firestore.collection(ACTIVITY_COLLECTION).doc(documentId).create(record);
    return {created: true};
  } catch (error) {
    if (error && (error.code === 6 || error.code === "already-exists")) {
      return {created: false};
    }
    throw error;
  }
}

function safeTimestamp(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseActivityLimit(value) {
  if (value === undefined) return DEFAULT_ACTIVITY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    const error = new Error("Invalid activity limit.");
    error.code = "invalid-argument";
    throw error;
  }
  return Math.min(limit, MAX_ACTIVITY_LIMIT);
}

function parseCursor(value, timestampFactory) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 600) {
    const error = new Error("Invalid activity cursor.");
    error.code = "invalid-argument";
    throw error;
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (_error) {
    decoded = null;
  }
  const date = new Date(decoded && decoded.createdAt);
  if (!decoded || typeof decoded.id !== "string" || decoded.id.length > 1500 ||
    !Number.isFinite(date.getTime()) || date.toISOString() !== decoded.createdAt) {
    const error = new Error("Invalid activity cursor.");
    error.code = "invalid-argument";
    throw error;
  }
  return {timestamp: timestampFactory.fromDate(date), id: decoded.id};
}

function encodeCursor(value) {
  if (!value || !value.createdAt || !value.id) return null;
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function approvedActivityRecord(documentSnapshot) {
  const data = documentSnapshot.data() || {};
  if (!Object.hasOwn(EVENT_PRESENTATION, data.eventType)) return null;
  const createdAt = safeTimestamp(data.createdAt);
  if (!createdAt) return null;
  return {
    eventType: data.eventType,
    createdAt,
    displayEmail: normalizeEmail(data.displayEmail),
    plan: normalizePlan(data.plan),
    summary: EVENT_PRESENTATION[data.eventType].summary,
    metadata: {},
  };
}

async function getRecentActivity({
  firestore,
  demoIdentifiers,
  limit,
  cursor,
  timestampFactory,
  documentIdField,
}) {
  const pageLimit = parseActivityLimit(limit);
  const cursorTimestamp = parseCursor(cursor, timestampFactory);
  let query = firestore.collection(ACTIVITY_COLLECTION)
      .orderBy("createdAt", "desc")
      .orderBy(documentIdField, "desc");
  if (cursorTimestamp) {
    query = query.startAfter(cursorTimestamp.timestamp, cursorTimestamp.id);
  }
  const snapshot = await query.limit(Math.min(pageLimit * 3 + 1, 301)).get();
  const approved = [];
  let lastScannedCursor = null;
  let hasMore = false;
  for (const documentSnapshot of snapshot.docs) {
    const data = documentSnapshot.data() || {};
    const recordTimestamp = safeTimestamp(data.createdAt);
    const recordCursor = recordTimestamp ? {
      createdAt: recordTimestamp,
      id: documentSnapshot.id,
    } : null;
    if (isDemoAuthUser({uid: data.uid, email: data.displayEmail}, demoIdentifiers)) {
      lastScannedCursor = recordCursor || lastScannedCursor;
      continue;
    }
    const record = approvedActivityRecord(documentSnapshot);
    if (!record) {
      lastScannedCursor = recordCursor || lastScannedCursor;
      continue;
    }
    if (approved.length === pageLimit) {
      hasMore = true;
      break;
    }
    approved.push(record);
    lastScannedCursor = recordCursor || lastScannedCursor;
  }
  if (!hasMore && snapshot.docs.length === Math.min(pageLimit * 3 + 1, 301)) {
    hasMore = true;
  }
  return {
    events: approved,
    nextCursor: hasMore ? encodeCursor(lastScannedCursor) : null,
  };
}

module.exports = {
  ACTIVITY_COLLECTION,
  CUSTOMER_ANALYTICS_EVENT_TYPES,
  DEFAULT_ACTIVITY_LIMIT,
  EVENT_PRESENTATION,
  FRONTEND_EVENT_TYPES,
  MAX_ACTIVITY_LIMIT,
  activityDocumentId,
  encodeCursor,
  getRecentActivity,
  normalizeEmail,
  normalizePlan,
  parseActivityLimit,
  safeTimestamp,
  trustedActivityIdentity,
  validateFrontendActivityRequest,
  writeActivityEvent,
};
