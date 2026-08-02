/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {
  getRecentActivity,
  trustedActivityIdentity,
  validateFrontendActivityRequest,
  writeActivityEvent,
} = require("./admin-activity");

function callableError(error, fallbackMessage) {
  if (error instanceof HttpsError) return error;
  if (error && error.code === "invalid-argument") {
    return new HttpsError("invalid-argument", error.message);
  }
  return new HttpsError("internal", fallbackMessage);
}

function createActivityLoggerHandler(options) {
  const source = options || {};
  return async (request) => {
    if (!request || !request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to record activity.");
    }
    try {
      const input = validateFrontendActivityRequest(request.data);
      const identity = await trustedActivityIdentity({
        auth: source.auth,
        firestore: source.firestore,
        uid: request.auth.uid,
      });
      return await writeActivityEvent({
        firestore: source.firestore,
        fieldValue: source.fieldValue,
        identity,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        now: source.now ? source.now() : new Date(),
      });
    } catch (error) {
      throw callableError(error, "Activity could not be recorded.");
    }
  };
}

function createAdminRecentActivityHandler(options) {
  const source = options || {};
  return async (request) => {
    let authorization;
    let demoIdentifiers;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
      demoIdentifiers = parseDemoIdentifiers(source.demoConfiguration);
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        throw new HttpsError("failed-precondition", "Admin activity is not configured.");
      }
      throw error;
    }
    if (authorization === "unauthenticated") {
      throw new HttpsError("unauthenticated", "You must be signed in to view admin activity.");
    }
    if (authorization !== "allowed") {
      throw new HttpsError("permission-denied", "You do not have permission to view admin activity.");
    }
    const data = request && request.data;
    if (data && (typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => !["limit", "cursor"].includes(key)))) {
      throw new HttpsError("invalid-argument", "Unknown activity query fields.");
    }
    try {
      return await getRecentActivity({
        firestore: source.firestore,
        demoIdentifiers,
        limit: data && data.limit,
        cursor: data && data.cursor,
        timestampFactory: source.timestampFactory,
        documentIdField: source.documentIdField,
      });
    } catch (error) {
      throw callableError(error, "Recent activity could not be loaded.");
    }
  };
}

module.exports = {
  createActivityLoggerHandler,
  createAdminRecentActivityHandler,
};
