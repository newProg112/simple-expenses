/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
} = require("./admin-authorization");
const {
  buildAdminDemoAnalytics,
  parseDemoAnalyticsRange,
} = require("./admin-demo-analytics");

function createAdminDemoAnalyticsHandler(options) {
  const source = options || {};
  const analyticsBuilder = source.analyticsBuilder || buildAdminDemoAnalytics;
  return async (request) => {
    let authorization;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        throw new HttpsError("failed-precondition", "Admin Demo Analytics is not configured.");
      }
      throw error;
    }
    if (authorization === "unauthenticated") {
      throw new HttpsError("unauthenticated", "You must be signed in to view Demo Analytics.");
    }
    if (authorization !== "allowed") {
      throw new HttpsError("permission-denied", "You do not have permission to view Demo Analytics.");
    }
    const data = request && request.data;
    if (data && (typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => key !== "range"))) {
      throw new HttpsError("invalid-argument", "Unknown Demo Analytics query fields.");
    }
    let range;
    try {
      range = parseDemoAnalyticsRange(data && data.range);
    } catch (_error) {
      throw new HttpsError("invalid-argument", "Select an approved Demo Analytics range.");
    }
    try {
      return await analyticsBuilder({
        firestore: source.firestore,
        range,
        now: source.now ? source.now() : new Date(),
        timestampFactory: source.timestampFactory,
      });
    } catch (error) {
      source.logger?.error?.("Admin Demo Analytics aggregation failed", {
        code: error && error.code ? String(error.code) : "unknown",
      });
      throw new HttpsError("internal", "Demo Analytics could not be loaded.");
    }
  };
}

module.exports = {createAdminDemoAnalyticsHandler};
