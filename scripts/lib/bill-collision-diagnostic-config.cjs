"use strict";

const BILL_COLLISION_DIAGNOSTIC_TARGET = Object.freeze({
  projectId: "simple-books-office",
  databaseId: "(default)",
});

const BILL_COLLISION_PRODUCTION_STATE = Object.freeze({
  totalBills: 50,
  collisionGroups: 3,
  collisionRecords: 11,
  collisionGroupSizes: Object.freeze([2, 3, 6]),
});

const BILL_COLLISION_LIMITS = Object.freeze({
  referenceCensusDocuments: 51,
  collisionDetailDocuments: 11,
  demoAccountDocuments: 3,
  accountingJournalDocuments: 11,
  totalDocuments: 75,
  readOperations: 4,
  queryPages: 1,
});

const BILL_DETAIL_FIELDS = Object.freeze([
  "billNumber", "invoiceNumber", "supplier", "billDate", "dueDate", "category",
  "net", "vatRate", "vat", "total", "status", "projectId",
  "attachmentPath", "attachmentUrl", "attachmentName", "bankSettlement",
]);

module.exports = Object.freeze({
  BILL_COLLISION_DIAGNOSTIC_TARGET,
  BILL_COLLISION_LIMITS,
  BILL_COLLISION_PRODUCTION_STATE,
  BILL_DETAIL_FIELDS,
});
