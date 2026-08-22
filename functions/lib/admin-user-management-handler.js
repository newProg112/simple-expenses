/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {AdminConfigurationError, adminAuthorizationDecision} = require("./admin-authorization");
const {privacySafeErrorCode} = require("./admin-metrics-handler");
const {readAdminUserTimeline, resetMonthlyUsage, updateAdminNotes, validUid} = require("./admin-user-management");

function authorize(request, configuration, action) {
  let decision;
  try {
    decision = adminAuthorizationDecision(request && request.auth, configuration);
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      throw new HttpsError("failed-precondition", "Admin User Management is not configured.");
    }
    throw error;
  }
  if (decision === "unauthenticated") throw new HttpsError("unauthenticated", `You must be signed in to ${action}.`);
  if (decision !== "allowed") throw new HttpsError("permission-denied", `You do not have permission to ${action}.`);
  return request.auth.uid;
}

function exactData(data, fields) {
  return data && typeof data === "object" && !Array.isArray(data) &&
    Object.keys(data).every((key) => fields.includes(key));
}

function callableFailure(error, fallback, log) {
  if (error instanceof HttpsError) return error;
  if (error && error.code === "invalid-argument") return new HttpsError("invalid-argument", error.message);
  log.error(fallback, {code: privacySafeErrorCode(error)});
  return new HttpsError("internal", fallback);
}

function createUpdateAdminUserNotesHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  return async (request) => {
    const adminUid = authorize(request, source.adminUidConfiguration, "update admin notes");
    const data = request && request.data;
    if (!exactData(data, ["uid", "notes"]) || !validUid(data.uid) || typeof data.notes !== "string") {
      throw new HttpsError("invalid-argument", "A valid UID and admin notes are required.");
    }
    try {
      if (source.deletionGuard) {
        await source.deletionGuard.assertAccountNotDeleting(data.uid);
      }
      const result = await (source.notesUpdater || updateAdminNotes)({
        firestore: source.firestore, fieldValue: source.fieldValue,
        uid: data.uid, notes: data.notes, adminUid,
      });
      log.info("Admin user notes updated");
      return result;
    } catch (error) {
      throw callableFailure(error, "Admin notes could not be saved.", log);
    }
  };
}

function createResetAdminUserUsageHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  return async (request) => {
    const adminUid = authorize(request, source.adminUidConfiguration, "reset customer usage");
    const data = request && request.data;
    if (!exactData(data, ["uid", "usageType"]) || !validUid(data.uid) ||
      !["aiAssistant", "invoiceScanning"].includes(data.usageType)) {
      throw new HttpsError("invalid-argument", "A valid UID and usage counter are required.");
    }
    try {
      if (source.deletionGuard) {
        await source.deletionGuard.assertAccountNotDeleting(data.uid);
      }
      const result = await (source.usageResetter || resetMonthlyUsage)({
        firestore: source.firestore, fieldValue: source.fieldValue,
        uid: data.uid, usageType: data.usageType, adminUid,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Admin user usage reset", {usageType: data.usageType});
      return result;
    } catch (error) {
      throw callableFailure(error, "Customer usage could not be reset.", log);
    }
  };
}

function createAdminUserTimelineHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}};
  return async (request) => {
    authorize(request, source.adminUidConfiguration, "view customer activity");
    const data = request && request.data;
    if (!exactData(data, ["uid", "limit", "cursor"]) || !validUid(data.uid)) {
      throw new HttpsError("invalid-argument", "A valid timeline query is required.");
    }
    try {
      return await (source.timelineReader || readAdminUserTimeline)({
        firestore: source.firestore, uid: data.uid, limit: data.limit, cursor: data.cursor,
        timestampFactory: source.timestampFactory, documentIdField: source.documentIdField,
      });
    } catch (error) {
      throw callableFailure(error, "Customer activity could not be loaded.", log);
    }
  };
}

module.exports = {
  authorize,
  createAdminUserTimelineHandler,
  createResetAdminUserUsageHandler,
  createUpdateAdminUserNotesHandler,
  exactData,
};
