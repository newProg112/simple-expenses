/* eslint-disable max-len, require-jsdoc */

"use strict";

const {EVENT_PRESENTATION, safeTimestamp} = require("./admin-activity");
const {calendarMonthKey} = require("./plan-entitlements");

const ADMIN_NOTES_COLLECTION = "adminUserNotes";
const ADMIN_NOTES_MAX_LENGTH = 4000;
const TIMELINE_DEFAULT_LIMIT = 25;
const TIMELINE_MAX_LIMIT = 100;
const USAGE_FIELDS = Object.freeze({
  aiAssistant: {
    field: "aiAssistantSuccessfulUses",
    eventType: "admin_ai_usage_reset",
  },
  invoiceScanning: {
    field: "invoiceScanningSuccessfulUses",
    eventType: "admin_invoice_scanning_usage_reset",
  },
});
const ADMIN_ACTION_PRESENTATION = Object.freeze({
  admin_ai_usage_reset: {summary: "An administrator reset the monthly AI Assistant usage."},
  admin_invoice_scanning_usage_reset: {summary: "An administrator reset the monthly invoice scanning usage."},
});

function validUid(value) {
  return typeof value === "string" && Boolean(value) && value.length <= 128 &&
    !value.includes("/") && !/\s/.test(value);
}

function cleanNotes(value) {
  if (typeof value !== "string" || value.length > ADMIN_NOTES_MAX_LENGTH) {
    const error = new Error(`Admin notes must be ${ADMIN_NOTES_MAX_LENGTH} characters or fewer.`);
    error.code = "invalid-argument";
    throw error;
  }
  return [...value].filter((character) => character === "\n" || character === "\t" || character.charCodeAt(0) >= 32)
      .join("").trim();
}

function adminNotesReference(firestore, uid) {
  return firestore.collection(ADMIN_NOTES_COLLECTION).doc(uid);
}

function approvedAdminNotes(snapshot) {
  const data = snapshot && snapshot.exists ? snapshot.data() || {} : {};
  return {
    text: typeof data.notes === "string" ? data.notes.slice(0, ADMIN_NOTES_MAX_LENGTH) : "",
    updatedAt: safeTimestamp(data.updatedAt),
    updatedByAdminUid: validUid(data.updatedByAdminUid) ? data.updatedByAdminUid : "",
  };
}

async function readAdminNotes(firestore, uid) {
  const snapshot = await adminNotesReference(firestore, uid).get();
  return approvedAdminNotes(snapshot);
}

async function updateAdminNotes({firestore, fieldValue, uid, notes, adminUid}) {
  const value = cleanNotes(notes);
  const reference = adminNotesReference(firestore, uid);
  await reference.set({
    notes: value,
    updatedAt: fieldValue.serverTimestamp(),
    updatedByAdminUid: adminUid,
  }, {merge: false});
  const persisted = approvedAdminNotes(await reference.get());
  if (persisted.text !== value || !persisted.updatedAt ||
    persisted.updatedByAdminUid !== adminUid) {
    throw new Error("The persisted admin note could not be verified.");
  }
  return {
    saved: true,
    notes: persisted.text,
    updatedAt: persisted.updatedAt,
    updatedByAdminUid: persisted.updatedByAdminUid,
  };
}

async function resetMonthlyUsage({firestore, fieldValue, uid, usageType, adminUid, now = new Date()}) {
  const definition = USAGE_FIELDS[usageType];
  if (!definition) {
    const error = new Error("A supported usage counter is required.");
    error.code = "invalid-argument";
    throw error;
  }
  const monthKey = calendarMonthKey(now);
  const usageReference = firestore.collection("userProfiles").doc(uid).collection("usage").doc(monthKey);
  const eventReference = firestore.collection("adminActivityEvents").doc();
  const batch = firestore.batch();
  batch.set(usageReference, {
    [definition.field]: 0,
    updatedAt: fieldValue.serverTimestamp(),
  }, {merge: true});
  batch.set(eventReference, {
    eventType: definition.eventType,
    createdAt: fieldValue.serverTimestamp(),
    uid,
    adminUid,
    plan: "starter",
    displayEmail: "",
    summary: ADMIN_ACTION_PRESENTATION[definition.eventType].summary,
    metadata: {},
  });
  await batch.commit();
  return {reset: true, usageType, monthKey, auditEventCreated: true};
}

function parseTimelineLimit(value) {
  if (value === undefined) return TIMELINE_DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > TIMELINE_MAX_LIMIT) {
    const error = new Error(`Timeline limit must be between 1 and ${TIMELINE_MAX_LIMIT}.`);
    error.code = "invalid-argument";
    throw error;
  }
  return value;
}

function encodeTimelineCursor(value) {
  if (!value) return null;
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseTimelineCursor(value, timestampFactory) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 600) {
    const error = new Error("Invalid timeline cursor.");
    error.code = "invalid-argument";
    throw error;
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (_error) {
    decoded = null;
  }
  const date = new Date(decoded && decoded.timestamp);
  if (!decoded || !validUid(decoded.id) || !Number.isFinite(date.getTime()) ||
    date.toISOString() !== decoded.timestamp) {
    const error = new Error("Invalid timeline cursor.");
    error.code = "invalid-argument";
    throw error;
  }
  return {timestamp: timestampFactory.fromDate(date), id: decoded.id};
}

async function readAdminUserTimeline({firestore, uid, limit, cursor, timestampFactory, documentIdField}) {
  const pageLimit = parseTimelineLimit(limit);
  const parsedCursor = parseTimelineCursor(cursor, timestampFactory);
  let query = firestore.collection("adminActivityEvents")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .orderBy(documentIdField, "desc");
  if (parsedCursor) query = query.startAfter(parsedCursor.timestamp, parsedCursor.id);
  const snapshot = await query.limit(pageLimit + 1).get();
  const events = [];
  for (const documentSnapshot of snapshot.docs.slice(0, pageLimit)) {
    const data = documentSnapshot.data() || {};
    const presentation = EVENT_PRESENTATION[data.eventType] || ADMIN_ACTION_PRESENTATION[data.eventType];
    const timestamp = safeTimestamp(data.createdAt);
    if (!presentation || !timestamp) continue;
    events.push({eventType: data.eventType, timestamp, summary: presentation.summary});
  }
  const last = snapshot.docs[Math.min(pageLimit, snapshot.docs.length) - 1];
  const lastTimestamp = last && safeTimestamp((last.data() || {}).createdAt);
  return {
    events,
    nextCursor: snapshot.docs.length > pageLimit && last && lastTimestamp ?
      encodeTimelineCursor({timestamp: lastTimestamp, id: last.id}) : null,
  };
}

module.exports = {
  ADMIN_NOTES_COLLECTION,
  ADMIN_NOTES_MAX_LENGTH,
  ADMIN_ACTION_PRESENTATION,
  adminNotesReference,
  approvedAdminNotes,
  TIMELINE_DEFAULT_LIMIT,
  TIMELINE_MAX_LIMIT,
  USAGE_FIELDS,
  cleanNotes,
  encodeTimelineCursor,
  parseTimelineCursor,
  parseTimelineLimit,
  readAdminNotes,
  readAdminUserTimeline,
  resetMonthlyUsage,
  updateAdminNotes,
  validUid,
};
