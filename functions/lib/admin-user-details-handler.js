/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseAdminUidAllowList,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {AdminUserNotFoundError, buildAdminUserDetails} = require("./admin-user-details");
const {privacySafeErrorCode} = require("./admin-metrics-handler");

function requestedUserSelector(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 1) return null;
  if (keys[0] === "uid" && typeof data.uid === "string") {
    const uid = data.uid.trim();
    return uid && uid.length <= 128 && !uid.includes("/") && !/\s/.test(uid) ? {uid} : null;
  }
  if (keys[0] === "email" && typeof data.email === "string") {
    const email = data.email.trim().toLowerCase();
    return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? {email} : null;
  }
  return null;
}

function createAdminUserDetailsHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const detailsBuilder = source.detailsBuilder || buildAdminUserDetails;
  return async (request) => {
    let authorization;
    let adminUids;
    let demoIdentifiers;
    try {
      authorization = adminAuthorizationDecision(request && request.auth, source.adminUidConfiguration);
      if (authorization === "allowed") {
        adminUids = parseAdminUidAllowList(source.adminUidConfiguration);
        demoIdentifiers = parseDemoIdentifiers(source.demoConfiguration);
      }
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin user lookup configuration rejected", {code: error.code});
        throw new HttpsError("failed-precondition", "Admin User Management is not configured.");
      }
      throw error;
    }
    if (authorization === "unauthenticated") throw new HttpsError("unauthenticated", "You must be signed in to view users.");
    if (authorization !== "allowed") throw new HttpsError("permission-denied", "You do not have permission to view users.");
    const selector = requestedUserSelector(request && request.data);
    if (!selector) throw new HttpsError("invalid-argument", "A valid UID or email is required.");
    try {
      const result = await detailsBuilder({
        auth: source.auth,
        firestore: source.firestore,
        selector,
        adminUids,
        demoIdentifiers,
        proPriceId: source.proPriceId,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Admin user details returned");
      return result;
    } catch (error) {
      if (error instanceof AdminUserNotFoundError) throw new HttpsError("not-found", "User was not found.");
      log.error("Admin user details lookup failed", {code: privacySafeErrorCode(error)});
      throw new HttpsError("internal", "User details could not be loaded.");
    }
  };
}

module.exports = {createAdminUserDetailsHandler, requestedUserSelector};
