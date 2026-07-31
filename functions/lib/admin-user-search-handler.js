/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  adminAuthorizationDecision,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {privacySafeErrorCode} = require("./admin-metrics-handler");
const {searchAdminUsers} = require("./admin-user-search");

const ADMIN_USER_SEARCH_QUERY_MAX_LENGTH = 320;

function validSearchQuery(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    typeof data.query !== "string") return "";
  const query = data.query.trim();
  return query.length >= 2 &&
    query.length <= ADMIN_USER_SEARCH_QUERY_MAX_LENGTH ? query : "";
}

function createAdminUserSearchHandler(options) {
  const source = options || {};
  const log = source.logger || {error: () => {}, info: () => {}};
  const searchBuilder = source.searchBuilder || searchAdminUsers;

  return async (request) => {
    let authorization;
    let demoIdentifiers;
    try {
      authorization = adminAuthorizationDecision(
          request && request.auth,
          source.adminUidConfiguration,
      );
      if (authorization === "allowed") {
        demoIdentifiers = parseDemoIdentifiers(source.demoConfiguration);
      }
    } catch (error) {
      if (error instanceof AdminConfigurationError) {
        log.error("Admin user search configuration rejected", {
          code: error.code,
        });
        throw new HttpsError(
            "failed-precondition",
            "Admin customer search is not configured.",
        );
      }
      throw error;
    }

    if (authorization === "unauthenticated") {
      throw new HttpsError(
          "unauthenticated",
          "You must be signed in to search customers.",
      );
    }
    if (authorization !== "allowed") {
      throw new HttpsError(
          "permission-denied",
          "You do not have permission to search customers.",
      );
    }

    const query = validSearchQuery(request && request.data);
    if (!query) {
      throw new HttpsError(
          "invalid-argument",
          "Search query must contain between 2 and 320 characters.",
      );
    }

    try {
      const result = await searchBuilder({
        auth: source.auth,
        firestore: source.firestore,
        demoIdentifiers,
        query,
        now: source.now ? source.now() : new Date(),
      });
      log.info("Admin user search completed", {
        resultCount: result.results.length,
      });
      return result;
    } catch (error) {
      log.error("Admin user search failed", {
        code: privacySafeErrorCode(error),
      });
      throw new HttpsError("internal", "Customer search could not be loaded.");
    }
  };
}

module.exports = {
  ADMIN_USER_SEARCH_QUERY_MAX_LENGTH,
  createAdminUserSearchHandler,
  validSearchQuery,
};
