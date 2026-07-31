/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
} = require("./admin-authorization");
const {
  AdminUserNotFoundError,
  buildAdminUserDetails,
} = require("./admin-user-details");
const {privacySafeErrorCode} = require("./admin-metrics-handler");

function requestedEmail(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const keys = Object.keys(data);
  if (keys.length !== 1 || keys[0] !== "email") return "";
  if (typeof data.email !== "string") return "";
  const email = data.email.trim();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ?
    email : "";
}

function createAdminUserDetailsHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const detailsBuilder = source.detailsBuilder || buildAdminUserDetails;

  return async (request) => {
    let authorization;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin user lookup configuration rejected", {
          code: error.code,
        });
        throw new HttpsError(
            "failed-precondition",
            "Admin customer lookup is not configured.",
        );
      }
      throw error;
    }

    if (authorization === "unauthenticated") {
      throw new HttpsError(
          "unauthenticated",
          "You must be signed in to look up customers.",
      );
    }
    if (authorization !== "allowed") {
      throw new HttpsError(
          "permission-denied",
          "You do not have permission to look up customers.",
      );
    }

    const email = requestedEmail(request && request.data);
    if (!email) {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }

    try {
      const result = await detailsBuilder({
        auth: source.auth,
        firestore: source.firestore,
        email,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Admin user details returned");
      return result;
    } catch (error) {
      if (error instanceof AdminUserNotFoundError) {
        throw new HttpsError("not-found", "Customer was not found.");
      }
      log.error("Admin user details lookup failed", {
        code: privacySafeErrorCode(error),
      });
      throw new HttpsError(
          "internal",
          "Customer details could not be loaded.",
      );
    }
  };
}

module.exports = {
  createAdminUserDetailsHandler,
  requestedEmail,
};
