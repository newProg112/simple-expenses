/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {ReferenceRegistryError} = require("./reference-registry-service");

function mapDeleteError(error) {
  if (error instanceof HttpsError) return error;
  if (!(error instanceof ReferenceRegistryError)) return new HttpsError("internal", "The document could not be deleted.");
  const codes = {
    "invalid-argument": "invalid-argument",
    "reference-conflict": "failed-precondition",
    "source-reference-unclaimed": "failed-precondition",
    "registry-integrity-error": "data-loss",
    "delete-integrity-error": "data-loss",
    "idempotency-conflict": "failed-precondition",
    "source-not-found": "not-found",
    "stale-source": "aborted",
    "bank-settled-source": "failed-precondition",
  };
  return new HttpsError(codes[error.code] || "internal", error.message, {reason: error.code});
}

function createSourceDeleteHandlers(deleteSource) {
  if (typeof deleteSource !== "function") throw new TypeError("A source delete service is required.");
  async function run(request, recordType) {
    if (!request || !request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "You must be signed in to delete documents.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((field) => !["sourceId", "expectedState", "requestId"].includes(field))) {
      throw new HttpsError("invalid-argument", "Delete request data is invalid.");
    }
    try {
      return await deleteSource({...data, recordType, uid: request.auth.uid});
    } catch (error) {
      throw mapDeleteError(error);
    }
  }
  return Object.freeze({
    deleteInvoiceWithReference: (request) => run(request, "invoice"),
    deleteBillWithReference: (request) => run(request, "bill"),
  });
}

module.exports = {createSourceDeleteHandlers, mapDeleteError};
