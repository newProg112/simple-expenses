/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {JsonBackupRestoreError} = require("./json-backup-restore-service");

function mapRestoreError(error) {
  if (error instanceof HttpsError) return error;
  const codes = {
    UNAUTHENTICATED: "unauthenticated", INVALID_REQUEST: "invalid-argument", INVALID_BACKUP: "invalid-argument",
    NON_EMPTY_DESTINATION: "failed-precondition", JOB_CONFLICT: "already-exists", RESTORE_IN_PROGRESS: "aborted",
    VERIFICATION_FAILED: "data-loss",
  };
  if (error instanceof JsonBackupRestoreError) return new HttpsError(codes[error.code] || "internal", error.message, {reason: error.code, ...error.details});
  console.error("Unexpected JSON backup restore failure", error);
  return new HttpsError("internal", "The JSON backup restore failed.");
}

function createJsonBackupRestoreHandler(restore) {
  if (typeof restore !== "function") throw new TypeError("A JSON backup restore service is required.");
  return async function restoreJsonBackupV2Handler(request) {
    if (!request || !request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "You must be signed in to restore a backup.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((field) => !["jobId", "backup"].includes(field))) throw new HttpsError("invalid-argument", "Restore request data is invalid.");
    try {
      return await restore({uid: request.auth.uid, jobId: data.jobId, backup: data.backup});
    } catch (error) {
      throw mapRestoreError(error);
    }
  };
}

module.exports = {createJsonBackupRestoreHandler, mapRestoreError};
