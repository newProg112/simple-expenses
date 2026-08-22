/* eslint-disable require-jsdoc */

"use strict";

const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

class AccountDeletionError extends Error {
  constructor(code) {
    super("Account deletion stage could not be completed.");
    this.name = "AccountDeletionError";
    this.deletionCode = SAFE_ERROR_CODE_PATTERN.test(String(code || "")) ?
      String(code) : "account-deletion-failed";
  }
}

function deletionErrorCode(error, fallback = "account-deletion-failed") {
  const code = String(error && error.deletionCode || "");
  return SAFE_ERROR_CODE_PATTERN.test(code) ? code : fallback;
}

module.exports = {
  AccountDeletionError,
  deletionErrorCode,
};
