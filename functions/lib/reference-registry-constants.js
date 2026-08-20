"use strict";

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_STATES = Object.freeze({
  ACTIVE: "active",
  RETIRED: "retired",
  LEGACY_CONFLICT: "legacy-conflict",
});
const REQUEST_ID_PATTERN = new RegExp([
  "^[0-9a-f]{8}",
  "-[0-9a-f]{4}",
  "-[1-5][0-9a-f]{3}",
  "-[89ab][0-9a-f]{3}",
  "-[0-9a-f]{12}$",
].join(""), "i");

module.exports = Object.freeze({
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_STATES,
  REQUEST_ID_PATTERN,
});
