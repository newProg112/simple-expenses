/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
} = require("./admin-authorization");
const {
  buildFounderAnalyticsSnapshot,
  parseFounderActivityLimit,
} = require("./founder-analytics");
const {privacySafeErrorCode} = require("./admin-metrics-handler");

function validateFounderAnalyticsData(data) {
  if (data === undefined || data === null) {
    return {activityLimit: parseFounderActivityLimit(undefined)};
  }
  if (typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).some((key) => key !== "activityLimit")) {
    throw new HttpsError(
        "invalid-argument",
        "Founder Analytics accepts only an activity limit.",
    );
  }
  try {
    return {activityLimit: parseFounderActivityLimit(data.activityLimit)};
  } catch (error) {
    if (error && error.code === "invalid-argument") {
      throw new HttpsError(
          "invalid-argument",
          "Activity limit must be an integer from 1 to 30.",
      );
    }
    throw error;
  }
}

function createFounderAnalyticsHandler(options = {}) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const snapshotBuilder = source.snapshotBuilder || buildFounderAnalyticsSnapshot;

  return async (request) => {
    let authorization;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Founder Analytics configuration rejected", {
          code: error.code,
        });
        throw new HttpsError(
            "failed-precondition",
            "Founder Analytics are not configured.",
        );
      }
      throw error;
    }

    if (authorization === "unauthenticated") {
      throw new HttpsError(
          "unauthenticated",
          "You must be signed in to view Founder Analytics.",
      );
    }
    if (authorization !== "allowed") {
      throw new HttpsError(
          "permission-denied",
          "You do not have permission to view Founder Analytics.",
      );
    }

    const input = validateFounderAnalyticsData(request && request.data);
    try {
      const result = await snapshotBuilder({
        auth: source.auth,
        firestore: source.firestore,
        adminUidConfiguration: source.adminUidConfiguration,
        demoConfiguration: source.demoConfiguration,
        proPriceId: source.proPriceId,
        expectedMode: source.expectedMode,
        activityLimit: input.activityLimit,
        timestampFactory: source.timestampFactory,
        documentIdField: source.documentIdField,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Founder Analytics snapshot generated", {
        schemaVersion: result.schemaVersion,
        totalUsers: result.overview.totalUsers,
        recentActivityCount: result.recentActivity.length,
      });
      return result;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof AdminConfigurationError) {
        log.error("Founder Analytics configuration rejected", {
          code: error.code,
        });
        throw new HttpsError(
            "failed-precondition",
            "Founder Analytics are not configured.",
        );
      }
      log.error("Founder Analytics snapshot generation failed", {
        code: privacySafeErrorCode(error),
      });
      throw new HttpsError(
          "internal",
          "Founder Analytics could not be loaded.",
      );
    }
  };
}

module.exports = {
  createFounderAnalyticsHandler,
  validateFounderAnalyticsData,
};
