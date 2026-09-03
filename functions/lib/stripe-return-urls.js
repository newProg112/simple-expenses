/* eslint-disable max-len, require-jsdoc */

"use strict";

const PRODUCTION_STRIPE_FRONTEND_ORIGIN = "https://simple-books.co.uk";
const EMULATOR_STRIPE_FRONTEND_ORIGIN = "http://localhost:5500";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

class StripeReturnUrlConfigurationError extends Error {
  constructor() {
    super("Stripe rehearsal frontend origin must be a loopback HTTP origin.");
    this.name = "StripeReturnUrlConfigurationError";
    this.code = "stripe-return-url-invalid";
  }
}

function validatedLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new StripeReturnUrlConfigurationError();
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    url.username || url.password || url.pathname !== "/" ||
    url.search || url.hash) {
    throw new StripeReturnUrlConfigurationError();
  }
  return url.origin;
}

function stripeBillingReturnUrls(environment = process.env) {
  const emulator = environment.FUNCTIONS_EMULATOR === "true";
  const frontendOrigin = emulator ? validatedLoopbackOrigin(
      environment.STRIPE_REHEARSAL_FRONTEND_ORIGIN ||
      EMULATOR_STRIPE_FRONTEND_ORIGIN,
  ) : PRODUCTION_STRIPE_FRONTEND_ORIGIN;
  return Object.freeze({
    emulator,
    frontendOrigin,
    successUrl: `${frontendOrigin}/account.html?checkout=success`,
    cancelUrl: `${frontendOrigin}/account.html?checkout=cancelled`,
    billingPortalReturnUrl: `${frontendOrigin}/account.html`,
  });
}

module.exports = {
  EMULATOR_STRIPE_FRONTEND_ORIGIN,
  PRODUCTION_STRIPE_FRONTEND_ORIGIN,
  StripeReturnUrlConfigurationError,
  stripeBillingReturnUrls,
  validatedLoopbackOrigin,
};
