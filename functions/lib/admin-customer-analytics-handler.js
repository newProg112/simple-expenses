/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseAdminUidAllowList,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {buildAdminCustomerAnalytics, parseCustomerAnalyticsRange} = require("./admin-customer-analytics");

function createAdminCustomerAnalyticsHandler(options) {
  const source = options || {};
  const analyticsBuilder = source.analyticsBuilder || buildAdminCustomerAnalytics;
  return async (request) => {
    let authorization;
    let demoIdentifiers;
    let adminUids;
    try {
      authorization = adminAuthorizationDecision(request && request.auth, source.adminUidConfiguration);
      adminUids = parseAdminUidAllowList(source.adminUidConfiguration);
      demoIdentifiers = parseDemoIdentifiers(source.demoConfiguration);
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        throw new HttpsError("failed-precondition", "Customer Analytics is not configured.");
      }
      throw error;
    }
    if (authorization === "unauthenticated") {
      throw new HttpsError("unauthenticated", "You must be signed in to view Customer Analytics.");
    }
    if (authorization !== "allowed") {
      throw new HttpsError("permission-denied", "You do not have permission to view Customer Analytics.");
    }
    const data = request && request.data;
    if (data && (typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => key !== "range"))) {
      throw new HttpsError("invalid-argument", "Unknown Customer Analytics query fields.");
    }
    let range;
    try {
      range = parseCustomerAnalyticsRange(data && data.range);
    } catch (_error) {
      throw new HttpsError("invalid-argument", "Select an approved Customer Analytics range.");
    }
    try {
      return await analyticsBuilder({
        auth: source.auth,
        firestore: source.firestore,
        demoIdentifiers,
        adminUids,
        range,
        now: source.now ? source.now() : new Date(),
        timestampFactory: source.timestampFactory,
        diagnosticsLogger: (details) => source.logger?.info?.("Customer Analytics cohort diagnostics", details),
      });
    } catch (error) {
      source.logger?.error?.("Customer Analytics aggregation failed", {
        code: error && error.code ? String(error.code) : "unknown",
      });
      throw new HttpsError("internal", "Customer Analytics could not be loaded.");
    }
  };
}

module.exports = {createAdminCustomerAnalyticsHandler};
