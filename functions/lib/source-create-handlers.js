/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {ReferenceRegistryError} = require("./reference-registry-service");

function mapError(error) {
  if (error instanceof HttpsError) return error;
  if (!(error instanceof ReferenceRegistryError)) return new HttpsError("internal", "The document could not be created.");
  const codes = {
    "invalid-argument": "invalid-argument", "reference-conflict": "already-exists",
    "legacy-reference-conflict": "already-exists",
    "source-conflict": "already-exists", "idempotency-conflict": "failed-precondition",
    "retired-reference": "failed-precondition", "legacy-conflict": "failed-precondition",
    "create-integrity-error": "data-loss",
  };
  return new HttpsError(codes[error.code] || "internal", error.message, {reason: error.code});
}

function createSourceCreateHandlers(createSource) {
  if (typeof createSource !== "function") throw new TypeError("A source create service is required.");
  async function run(request, recordType) {
    if (!request || !request.auth || !request.auth.uid) throw new HttpsError("unauthenticated", "You must be signed in to create documents.");
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((field) => !["sourceId", "payload", "requestId"].includes(field))) {
      throw new HttpsError("invalid-argument", "Create request data is invalid.");
    }
    try {
      return await createSource({...data, recordType, uid: request.auth.uid});
    } catch (error) {
      throw mapError(error);
    }
  }
  return Object.freeze({
    createInvoiceWithReference: (request) => run(request, "invoice"),
    createBillWithReference: (request) => run(request, "bill"),
  });
}

module.exports = {createSourceCreateHandlers, mapError};
