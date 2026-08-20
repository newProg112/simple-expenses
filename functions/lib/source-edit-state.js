/* eslint-disable max-len, require-jsdoc */

"use strict";

const {BILL_FIELDS, INVOICE_EDIT_FIELDS} = require("./source-create-schema");

const COMMON_STATE_FIELDS = ["createdAt", "updatedAt", "paidAt", "bankSettlement"];
const STATE_FIELDS = Object.freeze({
  invoice: Object.freeze([...INVOICE_EDIT_FIELDS, "invoiceNumber", "status", ...COMMON_STATE_FIELDS]),
  bill: Object.freeze([...BILL_FIELDS, "invoiceNumber", ...COMMON_STATE_FIELDS]),
});

function editStateProjection(recordType, source) {
  const fields = STATE_FIELDS[recordType];
  if (!fields || !source || typeof source !== "object" || Array.isArray(source)) return null;
  const result = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
  }
  return result;
}

module.exports = {STATE_FIELDS, editStateProjection};
