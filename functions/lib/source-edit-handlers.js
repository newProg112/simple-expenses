/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {ReferenceRegistryError} = require("./reference-registry-service");

function mapEditError(error) {
  if (error instanceof HttpsError) return error;
  if (!(error instanceof ReferenceRegistryError)) return new HttpsError("internal", "The document could not be updated.");
  const codes = {
    "invalid-argument": "invalid-argument",
    "reference-conflict": "already-exists",
    "legacy-reference-conflict": "already-exists",
    "retired-reference": "failed-precondition",
    "legacy-conflict": "failed-precondition",
    "source-reference-unclaimed": "failed-precondition",
    "registry-integrity-error": "data-loss",
    "edit-integrity-error": "data-loss",
    "idempotency-conflict": "failed-precondition",
    "source-not-found": "not-found",
    "stale-source": "aborted",
    "bank-settled-source": "failed-precondition",
  };
  return new HttpsError(codes[error.code] || "internal", error.message, {reason: error.code});
}

function createSourceEditHandlers(updateSource) {
  if (typeof updateSource !== "function") throw new TypeError("A source edit service is required.");
  async function run(request, recordType) {
    if (!request || !request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "You must be signed in to update documents.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((field) => !["sourceId", "payload", "expectedState", "requestId"].includes(field))) {
      throw new HttpsError("invalid-argument", "Edit request data is invalid.");
    }
    try {
      return await updateSource({...data, recordType, uid: request.auth.uid});
    } catch (error) {
      throw mapEditError(error);
    }
  }
  return Object.freeze({
    updateInvoiceWithReference: (request) => run(request, "invoice"),
    updateBillWithReference: (request) => run(request, "bill"),
  });
}

module.exports = {createSourceEditHandlers, mapEditError};
