/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {
  ACCOUNT_DELETION_STAGE,
  ACCOUNT_DELETION_STATUS,
  validExistingJob,
} = require("./account-deletion-handler");
const {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  ACCOUNT_DELETION_MARKER_FIELD,
  snapshotExists,
} = require("./account-deletion-guard");

const SAFE_DELETION_PHASE = Object.freeze({
  [ACCOUNT_DELETION_STAGE.REQUESTED]: "starting",
  [ACCOUNT_DELETION_STAGE.STRIPE]: "cancelling_subscription",
  [ACCOUNT_DELETION_STAGE.STORAGE]: "removing_files",
  [ACCOUNT_DELETION_STAGE.FIRESTORE]: "removing_account_data",
  [ACCOUNT_DELETION_STAGE.AUTH]: "finalising",
});

function safeDeletionStatus(job, uid, account = {}) {
  if (!job) {
    return account[ACCOUNT_DELETION_MARKER_FIELD] === true ?
      {status: "needs_attention"} : {status: "not_requested"};
  }
  if (job.uid !== uid || job.status === ACCOUNT_DELETION_STATUS.NEEDS_ATTENTION ||
    job.stage === ACCOUNT_DELETION_STAGE.NEEDS_ATTENTION) {
    return {status: "needs_attention"};
  }
  if (job.status === ACCOUNT_DELETION_STATUS.COMPLETED &&
    job.stage === ACCOUNT_DELETION_STAGE.COMPLETED) {
    return {status: "completed"};
  }
  if (!validExistingJob(job, uid) || job.status !== ACCOUNT_DELETION_STATUS.ACTIVE) {
    return {status: "needs_attention"};
  }
  return {
    status: "processing",
    phase: SAFE_DELETION_PHASE[job.stage] || "starting",
  };
}

function createGetAccountDeletionStatusHandler(options = {}) {
  if (!options.firestore || typeof options.firestore.collection !== "function") {
    throw new TypeError("Account deletion status dependencies are incomplete.");
  }
  return async function getAccountDeletionStatus(request) {
    const uid = request && request.auth && request.auth.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "You must be signed in to check account deletion.");
    }
    const jobReference = options.firestore
        .collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(uid);
    const accountReference = options.firestore.collection("users").doc(uid);
    const [jobSnapshot, accountSnapshot] = await Promise.all([
      jobReference.get(),
      accountReference.get(),
    ]);
    return Object.freeze(safeDeletionStatus(
        snapshotExists(jobSnapshot) ? jobSnapshot.data() || {} : null,
        uid,
        snapshotExists(accountSnapshot) ? accountSnapshot.data() || {} : {},
    ));
  };
}

module.exports = {
  SAFE_DELETION_PHASE,
  createGetAccountDeletionStatusHandler,
  safeDeletionStatus,
};
