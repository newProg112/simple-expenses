/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {buildAdminMetrics} = require("./admin-metrics");

function privacySafeErrorCode(error) {
  if (error && typeof error.code === "string" && error.code) {
    return error.code.slice(0, 80);
  }
  if (error && typeof error.name === "string" && error.name) {
    return error.name.slice(0, 80);
  }
  return "unknown";
}

function createAdminMetricsHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const metricsBuilder = source.metricsBuilder || buildAdminMetrics;

  return async (request) => {
    let authorization;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin metrics configuration rejected", {code: error.code});
        throw new HttpsError(
            "failed-precondition",
            "Admin metrics are not configured.",
        );
      }
      throw error;
    }

    if (authorization === "unauthenticated") {
      throw new HttpsError(
          "unauthenticated",
          "You must be signed in to view admin metrics.",
      );
    }
    if (authorization !== "allowed") {
      throw new HttpsError(
          "permission-denied",
          "You do not have permission to view admin metrics.",
      );
    }

    let demoIdentifiers;
    try {
      demoIdentifiers = parseDemoIdentifiers(source.demoConfiguration);
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin metrics configuration rejected", {code: error.code});
        throw new HttpsError(
            "failed-precondition",
            "Admin metrics are not configured.",
        );
      }
      throw error;
    }

    try {
      const result = await metricsBuilder({
        auth: source.auth,
        firestore: source.firestore,
        demoIdentifiers,
        proPriceId: source.proPriceId,
        expectedMode: source.expectedMode,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Admin metrics generated", {
        totalUsers: result.metrics.totalUsers,
        recentSignupCount: result.recentSignups.length,
      });
      return result;
    } catch (error) {
      log.error("Admin metrics generation failed", {
        code: privacySafeErrorCode(error),
      });
      throw new HttpsError(
          "internal",
          "Admin metrics could not be loaded.",
      );
    }
  };
}

module.exports = {
  createAdminMetricsHandler,
  privacySafeErrorCode,
};
