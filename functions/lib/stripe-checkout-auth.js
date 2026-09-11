/* eslint-disable max-len, require-jsdoc */

"use strict";

const {HttpsError} = require("firebase-functions/v2/https");

function usableAuthEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email || email.length > 254 || /\s/.test(email)) return "";
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    return "";
  }
  return email;
}

function authenticatedCheckoutIdentity(request) {
  const auth = request && request.auth;
  const uid = auth && typeof auth.uid === "string" ? auth.uid.trim() : "";
  if (!uid) {
    throw new HttpsError(
        "unauthenticated",
        "You must be signed in to start checkout.",
    );
  }
  const email = usableAuthEmail(auth.token && auth.token.email);
  if (!email) {
    throw new HttpsError(
        "failed-precondition",
        "Your authenticated account must have an email address before starting checkout.",
        {reason: "authenticated-email-required"},
    );
  }
  return Object.freeze({uid, email});
}

module.exports = {
  authenticatedCheckoutIdentity,
  usableAuthEmail,
};
