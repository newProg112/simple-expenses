"use strict";

// Repository evidence:
// - .firebaserc maps the default Firebase project to simple-books-office.
// - firebase.json defines a single unqualified Firestore configuration, and all
//   application/server code uses the default Firestore database.
const APPROVED_PRODUCTION_AUDIT_TARGET = Object.freeze({
  projectId: "simple-books-office",
  databaseId: "(default)",
});

const PRODUCTION_NODE_MAJOR = 22;
const PRODUCTION_REQUIRED_LIMITS = Object.freeze([
  "maxDocuments",
  "maxPages",
  "maxUids",
  "maxElapsedMs",
]);

module.exports = Object.freeze({
  APPROVED_PRODUCTION_AUDIT_TARGET,
  PRODUCTION_NODE_MAJOR,
  PRODUCTION_REQUIRED_LIMITS,
});
