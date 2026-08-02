/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {
  buildAdminFeatureUsage,
  parseFeatureUsageRange,
} = require("./admin-feature-usage");

function createAdminFeatureUsageHandler(options) {
  const source = options || {};
  const usageBuilder = source.usageBuilder || buildAdminFeatureUsage;
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
        throw new HttpsError("failed-precondition", "Admin feature usage is not configured.");
      }
      throw error;
    }
    if (authorization === "unauthenticated") {
      throw new HttpsError("unauthenticated", "You must be signed in to view feature usage.");
    }
    if (authorization !== "allowed") {
      throw new HttpsError("permission-denied", "You do not have permission to view feature usage.");
    }
    const data = request && request.data;
    if (data && (typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => key !== "range"))) {
      throw new HttpsError("invalid-argument", "Unknown feature usage query fields.");
    }
    let range;
    try {
      range = parseFeatureUsageRange(data && data.range);
    } catch (error) {
      throw new HttpsError("invalid-argument", "Select an approved feature usage range.");
    }
    try {
      return await usageBuilder({
        firestore: source.firestore,
        demoIdentifiers,
        range,
        now: source.now ? source.now() : new Date(),
        timestampFactory: source.timestampFactory,
      });
    } catch (_error) {
      throw new HttpsError("internal", "Feature usage could not be loaded.");
    }
  };
}

module.exports = {createAdminFeatureUsageHandler};
