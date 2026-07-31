/* eslint-disable max-len, require-jsdoc */

"use strict";

class AdminConfigurationError extends Error {
  constructor(code) {
    super("Admin metrics configuration is invalid.");
    this.name = "AdminConfigurationError";
    this.code = code;
  }
}

function commaSeparatedValues(value, missingCode) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminConfigurationError(missingCode);
  }

  const values = value.split(",").map((item) => item.trim());
  if (values.some((item) => !item)) {
    throw new AdminConfigurationError("malformed-configuration");
  }
  return values;
}

function validUid(uid) {
  return typeof uid === "string" && uid.length <= 128 &&
    Boolean(uid) && !uid.includes("/") && !/\s/.test(uid);
}

function parseAdminUidAllowList(value) {
  const values = commaSeparatedValues(value, "missing-admin-uids");
  if (values.some((uid) => !validUid(uid))) {
    throw new AdminConfigurationError("malformed-admin-uids");
  }
  return new Set(values);
}

function parseDemoIdentifiers(value) {
  const values = commaSeparatedValues(value, "missing-demo-identifiers");
  const uids = new Set();
  const emails = new Set();

  values.forEach((identifier) => {
    const separator = identifier.indexOf(":");
    const type = separator > 0 ? identifier.slice(0, separator).trim() : "";
    const configuredValue = separator > 0 ?
      identifier.slice(separator + 1).trim() : "";

    if (type === "uid" && validUid(configuredValue)) {
      uids.add(configuredValue);
      return;
    }
    if (type === "email" &&
      configuredValue.length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredValue)) {
      emails.add(configuredValue.toLowerCase());
      return;
    }
    throw new AdminConfigurationError("malformed-demo-identifiers");
  });

  return Object.freeze({uids, emails});
}

function adminAuthorizationDecision(authContext, configuredAdminUids) {
  if (!authContext || typeof authContext.uid !== "string" ||
    !authContext.uid) {
    return "unauthenticated";
  }

  const allowedUids = parseAdminUidAllowList(configuredAdminUids);
  return allowedUids.has(authContext.uid) ? "allowed" : "permission-denied";
}

function isDemoAuthUser(user, identifiers) {
  if (!user || !identifiers) return false;
  const email = typeof user.email === "string" ?
    user.email.trim().toLowerCase() : "";
  return identifiers.uids.has(user.uid) ||
    Boolean(email && identifiers.emails.has(email));
}

module.exports = {
  AdminConfigurationError,
  adminAuthorizationDecision,
  isDemoAuthUser,
  parseAdminUidAllowList,
  parseDemoIdentifiers,
};
