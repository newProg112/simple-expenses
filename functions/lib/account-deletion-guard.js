/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");

const ACCOUNT_DELETION_JOBS_COLLECTION = "accountDeletionJobs";
const ACCOUNT_DELETION_MARKER_FIELD = "deletionInProgress";

function snapshotExists(snapshot) {
  return Boolean(snapshot && (typeof snapshot.exists === "function" ?
    snapshot.exists() : snapshot.exists));
}

function deletionIsBlocked(jobSnapshot, accountSnapshot) {
  if (snapshotExists(jobSnapshot)) return true;
  if (!snapshotExists(accountSnapshot)) return false;
  const account = accountSnapshot.data() || {};
  return account[ACCOUNT_DELETION_MARKER_FIELD] === true;
}

function deletionBlockedError() {
  return new HttpsError(
      "failed-precondition",
      "This account is being deleted and can no longer be changed.",
      {reason: "account-deletion-in-progress"},
  );
}

function createAccountDeletionGuard(firestore) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore service is required for the account deletion guard.");
  }

  function references(uid) {
    return {
      job: firestore.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(uid),
      account: firestore.collection("users").doc(uid),
    };
  }

  async function assertAccountNotDeleting(uid) {
    const refs = references(uid);
    const [jobSnapshot, accountSnapshot] = await Promise.all([
      refs.job.get(),
      refs.account.get(),
    ]);
    if (deletionIsBlocked(jobSnapshot, accountSnapshot)) {
      throw deletionBlockedError();
    }
  }

  async function assertAccountNotDeletingInTransaction(
      transaction,
      uid,
      suppliedAccountSnapshot,
  ) {
    if (!transaction || typeof transaction.get !== "function") {
      throw new TypeError("A Firestore transaction is required for the account deletion guard.");
    }
    const refs = references(uid);
    const jobSnapshot = await transaction.get(refs.job);
    const accountSnapshot = suppliedAccountSnapshot ||
      await transaction.get(refs.account);
    if (deletionIsBlocked(jobSnapshot, accountSnapshot)) {
      throw deletionBlockedError();
    }
  }

  return Object.freeze({
    assertAccountNotDeleting,
    assertAccountNotDeletingInTransaction,
    references,
  });
}

module.exports = {
  ACCOUNT_DELETION_JOBS_COLLECTION,
  ACCOUNT_DELETION_MARKER_FIELD,
  createAccountDeletionGuard,
  deletionBlockedError,
  deletionIsBlocked,
  snapshotExists,
};
