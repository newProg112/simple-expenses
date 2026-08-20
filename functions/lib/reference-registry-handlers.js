/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");
const {ReferenceRegistryError} = require("./reference-registry-service");

function authenticatedUid(request) {
  const uid = request && request.auth && request.auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to manage document references.");
  }
  return uid;
}

function callableData(request, allowedFields) {
  const data = request && request.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).some((field) => !allowedFields.has(field))) {
    throw new HttpsError("invalid-argument", "Reference request data is invalid.");
  }
  return data;
}

function callableError(error) {
  if (error instanceof HttpsError) return error;
  if (!(error instanceof ReferenceRegistryError)) {
    return new HttpsError("internal", "The reference lifecycle operation could not be completed.");
  }
  const codes = {
    "invalid-argument": "invalid-argument",
    "source-not-found": "not-found",
    "reference-conflict": "already-exists",
    "source-reference-unclaimed": "failed-precondition",
    "bank-settled-source": "failed-precondition",
    "registry-integrity-error": "data-loss",
  };
  return new HttpsError(codes[error.code] || "internal", error.message, {
    reason: error.code,
  });
}

function createReferenceRegistryHandlers(service) {
  if (!service || typeof service.claimReference !== "function" ||
    typeof service.changeReference !== "function" ||
    typeof service.retireReferenceForDelete !== "function") {
    throw new TypeError("A reference registry lifecycle service is required.");
  }

  async function run(request, fields, operation) {
    const uid = authenticatedUid(request);
    const data = callableData(request, fields);
    try {
      return await operation({...data, uid});
    } catch (error) {
      throw callableError(error);
    }
  }

  return Object.freeze({
    claimReference: (request) => run(
        request,
        new Set(["recordType", "sourceId", "reference", "requestId"]),
        service.claimReference,
    ),
    changeReference: (request) => run(
        request,
        new Set(["recordType", "sourceId", "newReference", "requestId"]),
        service.changeReference,
    ),
    retireReferenceForDelete: (request) => run(
        request,
        new Set(["recordType", "sourceId", "requestId"]),
        service.retireReferenceForDelete,
    ),
  });
}

module.exports = {
  callableError,
  createReferenceRegistryHandlers,
};
