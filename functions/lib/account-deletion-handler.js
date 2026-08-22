/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  AdminConfigurationError,
  isDemoAuthUser,
  parseAdminUidAllowList,
  parseDemoIdentifiers,
} = require("./admin-authorization");
const {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  snapshotExists,
} = require("./account-deletion-guard");
const {REQUEST_ID_PATTERN} = require("./reference-registry-service");

const ACCOUNT_DELETION_SCHEMA_VERSION = 1;
const ACCOUNT_DELETION_STAGE = Object.freeze({
  REQUESTED: "requested",
  STRIPE: "stripe",
  STORAGE: "storage",
  FIRESTORE: "firestore",
  AUTH: "auth",
  COMPLETED: "completed",
  NEEDS_ATTENTION: "needs_attention",
});
const ACCOUNT_DELETION_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  NEEDS_ATTENTION: "needs_attention",
});
const RECENT_AUTH_WINDOW_SECONDS = 5 * 60;
const FUTURE_AUTH_CLOCK_SKEW_SECONDS = 60;

function validateRequestData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).sort().join(",") !== "confirmation,requestId") {
    throw new HttpsError("invalid-argument", "Delete account request data is invalid.");
  }
  if (data.confirmation !== "DELETE") {
    throw new HttpsError("invalid-argument", "Type DELETE exactly to confirm account deletion.");
  }
  const requestId = String(data.requestId || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new HttpsError("invalid-argument", "A valid request ID is required.");
  }
  return Object.freeze({requestId});
}

function requireRecentAuthentication(authContext, now = new Date()) {
  const authTime = Number(authContext && authContext.token && authContext.token.auth_time);
  const nowSeconds = Math.floor(new Date(now).getTime() / 1000);
  const ageSeconds = nowSeconds - authTime;
  if (!Number.isInteger(authTime) || !Number.isFinite(nowSeconds) ||
    ageSeconds < -FUTURE_AUTH_CLOCK_SKEW_SECONDS ||
    ageSeconds > RECENT_AUTH_WINDOW_SECONDS) {
    throw new HttpsError(
        "failed-precondition",
        "Sign in again before deleting your account.",
        {reason: "recent-authentication-required"},
    );
  }
}

function protectedConfiguration(source) {
  try {
    const configuration = {
      adminUids: parseAdminUidAllowList(source.adminUidConfiguration),
      demoIdentifiers: parseDemoIdentifiers(source.demoConfiguration),
      protectedUids: parseAdminUidAllowList(source.protectedUidConfiguration),
    };
    if (!configuration.demoIdentifiers.uids.size) {
      throw new AdminConfigurationError("missing-demo-uid");
    }
    return configuration;
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      throw new HttpsError(
          "failed-precondition",
          "Account deletion protection is not configured.",
          {reason: "protected-account-configuration-invalid"},
      );
    }
    throw error;
  }
}

function assertAccountMayBeDeleted({uid, authUser, account, configuration}) {
  if (configuration.adminUids.has(uid) ||
    configuration.protectedUids.has(uid) ||
    account.demoMode === true || account.deletionProtected === true ||
    isDemoAuthUser(authUser, configuration.demoIdentifiers)) {
    throw new HttpsError(
        "permission-denied",
        "This protected account cannot be deleted through the customer deletion flow.",
        {reason: "protected-account"},
    );
  }
}

function validExistingJob(job, uid) {
  return job && job.schemaVersion === ACCOUNT_DELETION_SCHEMA_VERSION &&
    job.uid === uid && typeof job.requestId === "string" &&
    REQUEST_ID_PATTERN.test(job.requestId) &&
    Object.values(ACCOUNT_DELETION_STAGE).includes(job.stage) &&
    Object.values(ACCOUNT_DELETION_STATUS).includes(job.status);
}

function createRequestAccountDeletionHandler(options = {}) {
  const source = options;
  if (!source.firestore || typeof source.firestore.runTransaction !== "function" ||
    !source.auth || typeof source.auth.getUser !== "function" ||
    !source.fieldValue || typeof source.fieldValue.serverTimestamp !== "function" ||
    typeof source.enqueueDeletionTask !== "function") {
    throw new TypeError("Account deletion handler dependencies are incomplete.");
  }

  return async function requestAccountDeletion(request) {
    const uid = request && request.auth && request.auth.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
    }
    const input = validateRequestData(request.data);
    requireRecentAuthentication(request.auth, source.now ? source.now() : new Date());
    const configuration = protectedConfiguration(source);

    let authUser;
    try {
      authUser = await source.auth.getUser(uid);
    } catch (error) {
      const code = String(error && error.code || "");
      throw new HttpsError(
          code === "auth/user-not-found" ? "not-found" : "internal",
          code === "auth/user-not-found" ?
            "This Firebase account no longer exists." :
            "The account could not be verified for deletion.",
      );
    }

    const jobReference = source.firestore
        .collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(uid);
    const accountReference = source.firestore.collection("users").doc(uid);
    const result = await source.firestore.runTransaction(async (transaction) => {
      const [jobSnapshot, accountSnapshot] = await Promise.all([
        transaction.get(jobReference),
        transaction.get(accountReference),
      ]);
      const account = snapshotExists(accountSnapshot) ?
        accountSnapshot.data() || {} : {};
      assertAccountMayBeDeleted({uid, authUser, account, configuration});

      if (snapshotExists(jobSnapshot)) {
        const job = jobSnapshot.data() || {};
        if (!validExistingJob(job, uid)) {
          throw new HttpsError(
              "data-loss",
              "The existing account deletion job is invalid and requires support.",
              {reason: "account-deletion-job-invalid"},
          );
        }
        return {
          accepted: true,
          resumed: true,
          stage: job.stage,
          status: job.status,
        };
      }

      const timestamp = source.fieldValue.serverTimestamp();
      transaction.create(jobReference, {
        schemaVersion: ACCOUNT_DELETION_SCHEMA_VERSION,
        uid,
        requestId: input.requestId,
        stage: ACCOUNT_DELETION_STAGE.REQUESTED,
        status: ACCOUNT_DELETION_STATUS.ACTIVE,
        retryCount: 0,
        requestedAt: timestamp,
        updatedAt: timestamp,
        lastErrorCode: "",
      });
      transaction.set(accountReference, {
        uid,
        deletionInProgress: true,
        accountDeletionState: ACCOUNT_DELETION_STAGE.REQUESTED,
        deletionRequestedAt: timestamp,
        updatedAt: timestamp,
      }, {merge: true});
      return {
        accepted: true,
        resumed: false,
        stage: ACCOUNT_DELETION_STAGE.REQUESTED,
        status: ACCOUNT_DELETION_STATUS.ACTIVE,
      };
    });

    if (result.status === ACCOUNT_DELETION_STATUS.ACTIVE) {
      try {
        await source.enqueueDeletionTask(uid);
      } catch (_error) {
        throw new HttpsError(
            "unavailable",
            "Account deletion was saved but could not be queued. Retry this request.",
            {reason: "account-deletion-enqueue-failed"},
        );
      }
    }
    return Object.freeze(result);
  };
}

module.exports = {
  ACCOUNT_DELETION_SCHEMA_VERSION,
  ACCOUNT_DELETION_STAGE,
  ACCOUNT_DELETION_STATUS,
  FUTURE_AUTH_CLOCK_SKEW_SECONDS,
  RECENT_AUTH_WINDOW_SECONDS,
  assertAccountMayBeDeleted,
  createRequestAccountDeletionHandler,
  protectedConfiguration,
  requireRecentAuthentication,
  validateRequestData,
  validExistingJob,
};
